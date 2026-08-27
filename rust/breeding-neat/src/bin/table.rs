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
    play_from,
};
use breeding_sim::stable::Stable;
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
/// Le niveau imposé par défaut à toutes les lignes. `--niveau n` le remplace.
const LEVEL: u16 = 60;

/// Le niveau retenu pour ce tirage : `--niveau n`, sinon `LEVEL`.
fn level() -> u16 {
    flag("--niveau")
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(LEVEL)
}

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
            level: level(),
            optimakina_from: 11,
        },
    )
}

/// La valeur d'un argument nommé : `--clef valeur`.
fn flag(name: &str) -> Option<String> {
    let args: Vec<String> = std::env::args().collect();
    args.iter()
        .position(|arg| arg == name)
        .and_then(|at| args.get(at + 1))
        .cloned()
}

/// Le nom de la famille, pour l'en-tête du recensement.
fn wanted_family(_wanted: &[f64; 11], _held: &[f64; 11]) -> String {
    std::env::args().nth(1).unwrap_or_else(|| "muldo".to_string())
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
    /// Le score **sans la liquidation finale** : ce que la partie a réellement
    /// encaissé, plus les primes, moins les malus.
    ///
    /// Pourquoi ça compte : liquider l'écurie au dernier instant vend tout le
    /// parc d'un coup, ce qu'aucun éleveur ne fait. C'est le terme qui payait la
    /// thésaurisation — une politique qui accumule sans rien vendre se voyait
    /// créditer son stock au prix du marché, à la fin, gratuitement. Retiré, le
    /// score ne compte plus que les kamas passés par la caisse.
    banked: f64,
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
    let mut banked: Vec<f64> = outcomes
        .iter()
        .map(|o| (o.score - o.liquidation) as f64)
        .collect();
    Row {
        banked: median(&mut banked),
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

fn run<P: Policy>(
    catalog: &Catalog,
    economy: &Economy,
    start: Option<&Stable>,
    make: impl Fn() -> P + Sync,
) -> Vec<RunOutcome> {
    (0..SEEDS)
        .into_par_iter()
        .map(|seed| {
            let mut policy = make();
            match start {
                // L'écurie réelle : le marché reste tiré par la graine, seul le
                // point de départ change. Voir `play_from`.
                Some(held) => play_from(catalog, economy, &mut policy, seed, held),
                None => play(catalog, economy, &mut policy, seed),
            }
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
    if std::env::args().any(|arg| arg == "--paliers-regles") {
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

    // `--heures n` : l'horizon en heures, qui prime sur le mode du fichier.
    let economy = match flag("--heures").and_then(|value| value.parse::<f64>().ok()) {
        Some(hours) => {
            let mut economy = economy;
            economy.horizon_hours = Some(hours);
            economy
        }
        None => economy,
    };

    // `--solde-steriles` : la règle **uniforme**. Tout le monde solde ce que
    // l'éleveur solde vraiment — ses gen 9 et gen 10 stériles — et rien d'autre.
    //
    // Sans elle on compare des conventions comptables et non des stratégies :
    // liquider tout crédite le stock de qui n'a jamais vendu, ne rien liquider
    // punit qui a gardé des stériles que l'éleveur aurait écoulées.
    let economy = if std::env::args().any(|arg| arg == "--solde-steriles") {
        let mut economy = economy;
        economy.liquidation_rule = breeding_sim::economy::Liquidation::SterileSummit;
        economy
    } else {
        economy
    };

    // `--ecurie fichier.ndjson` : partir du parc réel de l'éleveur.
    let imported = flag("--ecurie").map(|path| {
        let json = std::fs::read_to_string(&path).unwrap_or_else(|error| {
            eprintln!("{path} : {error}");
            std::process::exit(1);
        });
        breeding_sim::import::from_export(&json, &wanted, &catalog).unwrap_or_else(|error| {
            eprintln!("{error}");
            std::process::exit(1);
        })
    });
    let start = imported.as_ref().map(|held| &held.stable);
    if let Some(held) = imported.as_ref() {
        let mut by_generation = std::collections::BTreeMap::new();
        for mount in &held.stable.mounts {
            *by_generation
                .entry(catalog.generation(mount.color))
                .or_insert(0usize) += 1;
        }
        println!(
            "ecurie reelle : {} montures · {} fertiles · par generation {:?}",
            held.stable.len(),
            held.stable.mounts.iter().filter(|m| m.fertile).count(),
            by_generation
        );
        if held.unknown > 0 || held.other_families > 0 {
            println!(
                "  ignorees : {} couleur(s) hors catalogue · {} autre(s) famille(s)",
                held.unknown, held.other_families
            );
        }
    }

    let plan = Ladder::of(&catalog, Route::default());
    // `--niveaux 60,80,100` : le balayage **apparié** du niveau.
    //
    // Pourquoi apparié, et pourquoi des barres d'erreur : sur l'écurie de
    // l'éleveur, les niveaux 80, 100 et 120 rendent 85,15 / 86,30 / 85,49 M —
    // 1 % d'écart sur 86 M. Une médiane nue ne dit pas si c'est un classement ou
    // un tirage. Les parties étant déterministes par graine, on compare **graine
    // par graine** contre un niveau de référence : l'écart moyen et son erreur
    // type tranchent là où trois médianes ne tranchent pas.
    if let Some(list) = flag("--niveaux") {
        let levels: Vec<u16> = list
            .split(',')
            .filter_map(|piece| piece.trim().parse::<u16>().ok())
            .collect();
        if levels.is_empty() {
            eprintln!("--niveaux attend une liste, par exemple 60,80,100");
            std::process::exit(1);
        }

        // Les gains encaissés graine par graine, et les fournées réellement jouées.
        //
        // Le compte est une **colonne** et non un en-tête : en mode heures, monter
        // plus haut allonge le chargement, donc deux niveaux ne jouent pas le même
        // nombre de fournées sur le même horizon. Un seul chiffre en tête laisserait
        // croire que la comparaison est à effort égal alors qu'elle ne l'est pas.
        let banked: Vec<(u16, Vec<f64>, f64)> = levels
            .iter()
            .map(|&lvl| {
                let outcomes = run(&catalog, &economy, start, || {
                    let mut policy = LadderPolicy::with_ladder(plan.clone());
                    policy.harvest_stocked = true;
                    AtLevel(
                        policy,
                        Strategy {
                            bands: [0; 6],
                            level: lvl,
                            optimakina_from: 11,
                        },
                    )
                });
                let per_seed = outcomes
                    .iter()
                    .map(|o| (o.score - o.liquidation) as f64)
                    .collect();
                let loads = mean(outcomes.iter().map(|o| f64::from(o.loads_paid)));
                (lvl, per_seed, loads)
            })
            .collect();

        // La référence : la meilleure moyenne. Les autres se comparent à elle.
        let mean_of = |values: &[f64]| values.iter().sum::<f64>() / values.len() as f64;
        let best = banked
            .iter()
            .max_by(|a, b| {
                mean_of(&a.1)
                    .partial_cmp(&mean_of(&b.1))
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
            .expect("au moins un niveau");

        println!(
            "{} graines · encaisse, apparie contre le niveau {}",
            SEEDS, best.0
        );
        println!(
            "{:>7} {:>9} {:>11} {:>11} {:>12} {:>9} {:>8}",
            "niveau", "fournees", "median", "moyenne", "ecart", "err. type", "t"
        );
        println!("{}", "-".repeat(64));
        for (lvl, values, loads) in &banked {
            let mut sorted = values.clone();
            let median = median(&mut sorted);
            let deltas: Vec<f64> = values
                .iter()
                .zip(&best.1)
                .map(|(mine, reference)| mine - reference)
                .collect();
            let mean = mean_of(&deltas);
            let n = deltas.len() as f64;
            let variance =
                deltas.iter().map(|d| (d - mean).powi(2)).sum::<f64>() / (n - 1.0).max(1.0);
            let stderr = (variance / n).sqrt();
            let t = if stderr > 0.0 { mean / stderr } else { 0.0 };
            println!(
                "{:>7} {:>9.0} {:>9.2} M {:>9.2} M {:>10.2} M {:>7.2} M {:>8.2}",
                lvl,
                loads,
                median / 1e6,
                mean_of(values) / 1e6,
                mean / 1e6,
                stderr / 1e6,
                t
            );
        }
        return;
    }

    // `--recensement` : ce qui **reste** en écurie à la fin, par génération, et ce
    // que le plan en voulait.
    //
    // La question que ça répond : sur le volkorne et la dragodinde, jouer plus
    // longtemps appauvrit — l'écurie double en quatre mois pendant que le gain
    // baisse. L'éleveur le dit de son côté : « j'ai des montures qu'il ne sait pas
    // employer ». Reste à savoir lesquelles, parce que le remède n'est pas le même
    // selon qu'elles sont hors du plan (la moisson devrait les écouler) ou au plan
    // mais en trop (la route ne les consomme pas).
    if std::env::args().any(|arg| arg == "--recensement") {
        let outcomes = run(&catalog, &economy, start, || {
            let mut policy = LadderPolicy::with_ladder(plan.clone());
            policy.harvest_stocked = true;
            pinned(policy)
        });
        let mut held = [0f64; 11];
        for outcome in &outcomes {
            for (slot, count) in outcome.held_by_generation.iter().enumerate() {
                held[slot] += f64::from(*count) / outcomes.len() as f64;
            }
        }
        // Ce que le plan réclame, par génération : la demande de l'échelle.
        let mut wanted = [0f64; 11];
        for (color, demand) in plan.demand.iter() {
            let slot = usize::from(catalog.generation(*color)).min(10);
            wanted[slot] += *demand;
        }
        println!(
            "{} · {:.0} fournees · niveau {} · ecurie finale moyenne",
            wanted_family(&wanted, &held),
            mean(outcomes.iter().map(|o| f64::from(o.loads_paid))),
            level()
        );
        println!("{:>4} {:>10} {:>10}", "gen", "tenu", "demande");
        println!("{}", "-".repeat(26));
        for generation in 1..=10 {
            if held[generation] < 0.05 && wanted[generation] < 0.05 {
                continue;
            }
            println!(
                "{:>4} {:>10.1} {:>10.1}",
                generation, held[generation], wanted[generation]
            );
        }
        println!(
            "{:>4} {:>10.1} {:>10.1}",
            "tot",
            held.iter().sum::<f64>(),
            wanted.iter().sum::<f64>()
        );
        return;
    }

    // `--couleurs n` : le rang `n`, couleur par couleur.
    //
    // Le compte par génération dit qu'un rang déborde. Celui-ci dit **laquelle**,
    // et c'est la question qui tranche quand une seule couleur du rang compose
    // quelque chose au-dessus : si ce qui s'entasse est celle qui mène ailleurs,
    // le problème est la conversion ; si ce sont les autres, c'est la production.
    if let Some(rank) = flag("--couleurs").and_then(|v| v.parse::<u8>().ok()) {
        let outcomes = run(&catalog, &economy, start, || {
            let mut policy = LadderPolicy::with_ladder(plan.clone());
            policy.harvest_stocked = true;
            pinned(policy)
        });
        let runs = outcomes.len() as f64;
        let mut held = vec![0f64; catalog.len()];
        for outcome in &outcomes {
            for (color, count) in outcome.held_by_color.iter().enumerate() {
                if color < held.len() {
                    held[color] += f64::from(*count) / runs;
                }
            }
        }
        println!(
            "{} · {:.0} fournees · gen {rank}, couleur par couleur",
            std::env::args().nth(1).unwrap_or_default(),
            mean(outcomes.iter().map(|o| f64::from(o.loads_paid)))
        );
        println!("{:<24} {:>8} {:>9}  {}", "couleur", "tenu", "demande", "compose");
        println!("{}", "-".repeat(56));
        let mut rows: Vec<(f64, String, f64, bool)> = (0..catalog.len() as u16)
            .filter(|&color| catalog.generation(color) == rank)
            .map(|color| {
                // Compose-t-elle quelque chose plus haut ? La question de
                // l'éleveur : sur la dragodinde une seule gen 4 le fait.
                let leads = catalog.colors().iter().any(|other| {
                    other.generation > rank
                        && other.recipes.iter().any(|recipe| recipe.contains(&color))
                });
                (
                    held[usize::from(color)],
                    catalog.slug(color).to_string(),
                    plan.demand.get(&color).copied().unwrap_or(0.0),
                    leads,
                )
            })
            .collect();
        rows.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
        for (tenu, slug, demande, leads) in rows {
            println!(
                "{:<24} {:>8.1} {:>9.1}  {}",
                slug,
                tenu,
                demande,
                if leads { "oui" } else { "CUL-DE-SAC" }
            );
        }
        return;
    }

    // `--seule` : seulement « échelle + tes changements ». Les autres lignes
    // coûtent le même temps de calcul et ne répondent pas à la question posée
    // quand on balaie les niveaux.
    let only = std::env::args().any(|arg| arg == "--seule");
    if only {
        let outcomes = run(&catalog, &economy, start, || {
            let mut policy = LadderPolicy::with_ladder(plan.clone());
            policy.harvest_stocked = true;
            pinned(policy)
        });
        let r = row("3. echelle + tes changements", &outcomes);
        println!(
            "niveau {:>3} · {:>5.0} fournees · encaisse {:>8.2} M · score {:>8.2} M ·              croisem. {:>5.0} · gen 10 {:>5.1} · ecurie {:>4.0}",
            level(),
            r.loads,
            r.banked / 1e6,
            r.score / 1e6,
            r.crossings,
            r.top,
            r.peak,
        );
        return;
    }

    let mut rows = vec![
        row("plancher : ne rien faire", &run(&catalog, &economy, start, || pinned(NeverBreeds))),
        row(
            "1. glouton",
            &run(&catalog, &economy, start, || pinned(Greedy::new(Objective::Gen10Profit))),
        ),
        row(
            "2. echelle seule",
            &run(&catalog, &economy, start, || {
                let mut policy = LadderPolicy::with_ladder(plan.clone());
                policy.harvest_stocked = false;
                pinned(policy)
            }),
        ),
        row(
            "3. echelle + changements",
            &run(&catalog, &economy, start, || {
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
        &run(&catalog, &economy, start, || {
            let mut policy = LadderPolicy::with_ladder(plan.clone())
                .with_strategies([Strategy::default(); MAX_UNITS])
                .tuned_for(&economy);
            policy.harvest_stocked = true;
            Unpinned(policy)
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
        &run(&catalog, &economy, start, || pinned(Searching::new(NetValue(&network)))),
    ));
    rows.push(row(
        "temoin : valeur myope",
        &run(&catalog, &economy, start, || pinned(Searching::new(Myopic))),
    ));

    if economy.liquidation_rule == breeding_sim::economy::Liquidation::SterileSummit {
        println!("(regle uniforme : seules les gen 9 et 10 steriles sont soldees)");
    }
    if economy.daily_price_recovery == 0.0 {
        println!("(reprise quotidienne neutralisee)");
    }
    let horizon = match economy.horizon_hours {
        Some(hours) => format!("{hours:.0} h"),
        None => format!("{} fournées = {} montures fertile→féconde", economy.batches, economy.batches * 60),
    };
    println!("famille {wanted} · {SEEDS} graines · niveau {} partout · {horizon}", level());
    println!(
        "{:<30} {:>11} {:>12} {:>9} {:>9} {:>8} {:>8} {:>8}  {}",
        "strategie", "score med.", "encaisse", "croisem.", "fournees", "gen 10", "ecurie", "refuses", "motif dominant"
    );
    println!("{}", "-".repeat(110));
    for r in &rows {
        println!(
            "{:<30} {:>9.2} M {:>10.2} M {:>9.0} {:>9.0} {:>8.1} {:>8.0} {:>8.1}  {}",
            r.label,
            r.score / 1e6,
            r.banked / 1e6,
            r.crossings,
            r.loads,
            r.top,
            r.peak,
            r.rejected,
            r.motive,
        );
    }
}
