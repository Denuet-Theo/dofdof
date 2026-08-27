//! Les **quatre stratégies**, une famille, un coût de fournée identique.
//!
//! ```sh
//! cargo run --release -p breeding-neat --bin table [famille]
//! ```
//!
//! ## Pourquoi un binaire de plus
//!
//! `bench` publie une baseline et vit dans `breeding-sim`, qui ne voit pas
//! `champion.json` — la dépendance va dans l'autre sens, et c'est pour ça que
//! `replay` habite ici. Remodeler `bench` pour une comparaison ponctuelle
//! abîmerait des chiffres publiés ; celui-ci répond à une question précise et
//! s'assume jetable.
//!
//! ## Ce qui est tenu égal, et pourquoi ça manquait
//!
//! Toutes les lignes jouent **le même réglage** : bande la moins chère, niveau
//! imposé, aucune Optimakina. Sans ça la comparaison mélange deux choses —
//! `Greedy::strategy` rend `Strategy::default()` en dur, niveau 0, tandis que
//! l'échelle appelle `tuned_for` et se choisit le sien. Le prix d'un enclos suit
//! le niveau par la Mangeoire, donc l'écart de score mesurait autant le prix payé
//! que la politique jouée. Le moteur lit `Policy::strategy` à chaque unité
//! (`economy.rs:1953`), donc envelopper la politique suffit : elle planifie ce
//! qu'elle veut, elle paie ce qu'on lui impose.
//!
//! ## L'horizon
//!
//! `economy.toml` décide. Pour un budget de **gestes** plutôt que d'heures,
//! `mode = "fournees"` : 200 fournées à 60 places font 12 000 montures passées de
//! fertile à féconde, ce que l'éleveur compte réellement.
//!
//! ## Le champion hors muldo
//!
//! Il a été entraîné sur le muldo. Le pointer sur une autre famille mesure « ce
//! que fait ce champion-ci ailleurs », pas « ce qu'un champion pourrait y faire » —
//! la compétence `neat-training` dit de **réentraîner** et non de porter. Les
//! cellules volkorne et dragodinde sont donc indicatives, et la sortie le dit.

use breeding_neat::champion;
use breeding_neat::neat::Network;
use breeding_sim::baseline::{Greedy, Objective};
use breeding_sim::config::Prices;
use breeding_sim::economy::{
    Economy, NeverBreeds, Policy, Rejected, Rng, RunOutcome, Strategy, UnitPlan, UnitView, play,
};
use breeding_sim::encode::Census;
use breeding_sim::economy::MAX_UNITS;
use breeding_sim::ladder::{Ladder, LadderPolicy, Route};
use breeding_sim::search::{Myopic, Searching, ValueFn};
use breeding_sim::trees::{Catalog, family};
use rayon::prelude::*;

const SEEDS: u32 = 200;
/// Où chercher le champion. `champion.json` nu dépend du répertoire courant, et
/// s'est déjà résolu nulle part depuis la racine du dépôt : la ligne demandée
/// est partie en un avertissement, table imprimée comme si elle était complète.
/// Le versionné vient en dernier — il est identique à l'artefact d'entraînement
/// et présent sur un clone neuf.
const CHAMPIONS: [&str; 4] = [
    "champion.json",
    "rust/champion.json",
    "src/lib/dofus/breeding/champion.json",
    "../src/lib/dofus/breeding/champion.json",
];

/// Le premier chemin lisible, ou l'échec. **Pas** d'avertissement : une ligne
/// manquante dans un tableau de comparaison se lit comme une ligne perdante.
fn champion_path() -> Result<&'static str, String> {
    CHAMPIONS
        .into_iter()
        .find(|path| std::path::Path::new(path).exists())
        .ok_or_else(|| format!("aucun champion trouvé, essayé : {}", CHAMPIONS.join(", ")))
}
/// Le niveau imposé à toutes les lignes.
const LEVEL: u16 = 60;

struct NetValue<'a>(&'a Network);

impl ValueFn for NetValue<'_> {
    fn value(&self, census: &Census, catalog: &Catalog, economy: &Economy) -> f64 {
        self.0.value(&census.features(catalog, economy))
    }
}

/// Impose le réglage : voir l'en-tête.
struct AtLevel<P>(P, Strategy);

impl<P: Policy> Policy for AtLevel<P> {
    fn name(&self) -> &str {
        self.0.name()
    }
    fn strategy(&self, _unit: usize) -> Strategy {
        self.1
    }
    fn plan(&mut self, view: &UnitView<'_>, rng: &mut Rng) -> UnitPlan {
        self.0.plan(view, rng)
    }
}

/// Laisse la politique répondre elle-même sur son réglage.
struct Unpinned<P>(P);

impl<P: Policy> Policy for Unpinned<P> {
    fn name(&self) -> &str {
        self.0.name()
    }
    fn strategy(&self, unit: usize) -> Strategy {
        self.0.strategy(unit)
    }
    fn plan(&mut self, view: &UnitView<'_>, rng: &mut Rng) -> UnitPlan {
        self.0.plan(view, rng)
    }
}

fn pinned<P: Policy>(inner: P) -> AtLevel<P> {
    AtLevel(
        inner,
        Strategy {
            bands: [0; 6],
            level: LEVEL,
            optimakina_from: 11,
        },
    )
}

fn median(values: &mut [f64]) -> f64 {
    values.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    values[(values.len() - 1) / 2]
}

fn mean(values: impl Iterator<Item = f64>) -> f64 {
    let collected: Vec<f64> = values.collect();
    collected.iter().sum::<f64>() / collected.len().max(1) as f64
}

struct Row {
    label: String,
    score: f64,
    crossings: f64,
    loads: f64,
    top: f64,
    peak: f64,
    /// Les chargements refusés, et le motif qui domine. Une partie ne s'arrête
    /// pas quand l'argent manque : elle s'arrête quand **tous** les enclos ont
    /// pris trois avertissements (`IDLE_LIMIT`, `economy.rs:1911`) — et un enclos
    /// exclu ne revient jamais. Distinguer « refusé » de « rien à proposer » dit
    /// si l'arrêt est une pénurie réelle ou une règle du banc.
    rejected: f64,
    motive: String,
}

fn row(label: &str, outcomes: &[RunOutcome]) -> Row {
    let mut scores: Vec<f64> = outcomes.iter().map(|o| o.score as f64).collect();
    let mut by_reason = [0u64; Rejected::REASONS];
    for outcome in outcomes {
        for (slot, count) in outcome.rejected_by_reason.iter().enumerate() {
            by_reason[slot] += u64::from(*count);
        }
    }
    let motive = by_reason
        .iter()
        .enumerate()
        .max_by_key(|(_, count)| **count)
        .filter(|(_, count)| **count > 0)
        .map(|(slot, _)| Rejected::LABELS[slot].to_string())
        .unwrap_or_else(|| "rien a proposer".to_string());
    Row {
        rejected: mean(outcomes.iter().map(|o| f64::from(o.rejected_loads))),
        motive,
        label: label.to_string(),
        score: median(&mut scores),
        crossings: mean(outcomes.iter().map(|o| o.crossings as f64)),
        loads: mean(outcomes.iter().map(|o| f64::from(o.loads_paid))),
        top: mean(outcomes.iter().map(|o| o.gen10_held as f64)),
        peak: mean(outcomes.iter().map(|o| o.peak_stable as f64)),
    }
}

fn run<P: Policy>(catalog: &Catalog, economy: &Economy, make: impl Fn() -> P + Sync) -> Vec<RunOutcome> {
    (0..SEEDS)
        .into_par_iter()
        .map(|seed| {
            let mut policy = make();
            play(catalog, economy, &mut policy, seed)
        })
        .collect()
}

fn main() {
    let wanted = std::env::args().nth(1).unwrap_or_else(|| "muldo".to_string());
    let catalog = family(&wanted);
    // `for_family` et non `.economy` : la ressource d'extraction se vend
    // 20 000 / 21 000 / 18 000 selon la famille (#289). Prendre le prix nu
    // facture les trois au tarif muldo, ce qui laisse les classements internes
    // intacts mais rend les **magnitudes entre familles** fausses — soit
    // précisément ce qu'un tableau comparant des familles prétend montrer.
    let economy = Prices::load_default()
        .map(|prices| prices.for_family(&wanted))
        .unwrap_or_else(|error| {
            eprintln!("{error}");
            std::process::exit(1);
        });

    // L'horizon en **fournées**, passé en argument plutôt qu'écrit dans
    // `economy.toml` : un budget de gestes est une question posée à la volée, et
    // muter un fichier partagé pour la poser l'a laissé modifié deux fois
    // aujourd'hui. `economy.horizon_hours = None` sélectionne le mode fournées.
    let economy = match std::env::args().nth(2).and_then(|arg| arg.parse::<u32>().ok()) {
        Some(loads) => {
            let mut economy = economy;
            economy.horizon_hours = None;
            economy.batches = loads;
            economy
        }
        None => economy,
    };

    // `--niveau` : ce que `tuned_for` choisirait, sans rien simuler. Le niveau
    // imposé plus haut ne fait pas partie de son balayage
    // (`ladder.rs:1759` : 1, 12, 23, 36, 50, 67, 85, 100, 120), donc la ligne
    // « échelle » du tableau mesure une configuration que l'app ne peut pas
    // produire. Savoir quel palier elle retient vraiment dit si l'écart vient du
    // palier ou de la politique.
    if std::env::args().any(|arg| arg == "--niveau") {
        let tuned = LadderPolicy::with_ladder(Ladder::of(&catalog, Route::default()))
            .with_strategies([Strategy::default(); MAX_UNITS])
            .tuned_for(&economy);
        let levels: Vec<u16> = (0..MAX_UNITS).map(|unit| tuned.strategy(unit).level).collect();
        println!("{wanted:<12} paliers retenus par tuned_for : {levels:?}");
        println!(
            "{wanted:<12} ressource {} · bande {:?} · sommet {} · geneton {}",
            economy.amber_per_generation,
            economy.amber_range,
            economy.top_value,
            economy.geneton_value,
        );
        return;
    }

    let economy = if std::env::args().any(|arg| arg == "--sans-reprise") {
        let mut economy = economy;
        economy.daily_price_recovery = 0.0;
        economy
    } else {
        economy
    };

    let plan = Ladder::of(&catalog, Route::default());
    let mut rows = vec![
        row("plancher : ne rien faire", &run(&catalog, &economy, || pinned(NeverBreeds))),
        row(
            "1. glouton",
            &run(&catalog, &economy, || pinned(Greedy::new(Objective::Gen10Profit))),
        ),
        row(
            "2. echelle seule",
            &run(&catalog, &economy, || {
                let mut policy = LadderPolicy::with_ladder(plan.clone());
                policy.harvest_stocked = false;
                pinned(policy)
            }),
        ),
        row(
            "3. echelle + changements",
            &run(&catalog, &economy, || {
                let mut policy = LadderPolicy::with_ladder(plan.clone());
                policy.harvest_stocked = true;
                pinned(policy)
            }),
        ),
    ];

    // La même politique à **ses** paliers plutôt qu'au palier imposé. `tuned_for`
    // retient 36 puis 50, jamais 60 — 60 n'est pas dans son balayage
    // (`ladder.rs:1759`). L'écart entre cette ligne et la précédente est donc le
    // prix du réglage, et non celui de la politique : c'est la seule paire du
    // tableau qui isole le palier.
    rows.push(row(
        "3'. idem, ses propres paliers",
        &run(&catalog, &economy, || {
            let mut policy = LadderPolicy::with_ladder(plan.clone())
                .with_strategies([Strategy::default(); MAX_UNITS])
                .tuned_for(&economy);
            policy.harvest_stocked = true;
            Unpinned(policy)
        }),
    ));

    rows.push(row(
        "3\"'. idem, mais vend le sommet",
        &run(&catalog, &economy, || {
            let mut policy = LadderPolicy::with_ladder(plan.clone());
            policy.harvest_stocked = true;
            policy.sell_top = true;
            pinned(policy)
        }),
    ));

    let genome = champion_path()
        .and_then(|path| champion::load(path, 1))
        .unwrap_or_else(|error| {
            eprintln!("{error}");
            std::process::exit(1);
        });
    let network = Network::compile(&genome);
    rows.push(row(
        "4. champion",
        &run(&catalog, &economy, || pinned(Searching::new(NetValue(&network)))),
    ));
    rows.push(row(
        "temoin : valeur myope",
        &run(&catalog, &economy, || pinned(Searching::new(Myopic))),
    ));

    if economy.daily_price_recovery == 0.0 {
        println!("(reprise quotidienne neutralisee)");
    }
    let horizon = match economy.horizon_hours {
        Some(hours) => format!("{hours:.0} h"),
        None => format!("{} fournées = {} montures fertile→féconde", economy.batches, economy.batches * 60),
    };
    println!("famille {wanted} · {SEEDS} graines · niveau {LEVEL} partout · {horizon}");
    println!(
        "{:<30} {:>11} {:>9} {:>9} {:>8} {:>8} {:>8}  {}",
        "strategie", "score med.", "croisem.", "fournees", "gen 10", "ecurie", "refuses", "motif dominant"
    );
    println!("{}", "-".repeat(104));
    for r in &rows {
        println!(
            "{:<30} {:>9.2} M {:>9.0} {:>9.0} {:>8.1} {:>8.0} {:>8.1}  {}",
            r.label,
            r.score / 1e6,
            r.crossings,
            r.loads,
            r.top,
            r.peak,
            r.rejected,
            r.motive,
        );
    }
}
