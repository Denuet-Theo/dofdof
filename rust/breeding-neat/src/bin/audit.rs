//! Combien de ce que chaque politique propose ne pouvait **rien** rapporter —
//! et ce que chacune vaut selon qu'on hérite d'un parc ou qu'on parte de rien.
//!
//! ```sh
//! cargo run --release -p breeding-neat --bin audit -- champion-r5.json
//! ```
//!
//! ## Le déchet
//!
//! Relevé en jeu : le champion propose des accouplements que la fenêtre annonce
//! « rien à gagner » — `Doré-Amande [Amande, Amande] × Doré anonyme`, zéro
//! géneton, trois issues toutes sous la cible. Deux fécondités définitivement
//! dépensées pour une monture qu'on avait déjà. Un score de simulation ne peut
//! pas le montrer, puisque c'est précisément le coup que le simulateur
//! récompense : `Census::apply_crossing` crédite l'espérance de liquidation du
//! bébé pour un coût marginal nul.
//!
//! ## Les deux départs
//!
//! La partie donne par défaut cent muldos répartis de la gen 2 à la gen 9.
//! L'échelle, elle, construit depuis la gen 1 : elle n'a d'emploi que pour les
//! couleurs de son plan, donc elle laisse l'héritage dormir. Le second tableau
//! rejoue tout avec cent gen 1 anonymes — même horizon, même budget, mais plus
//! rien à hériter. C'est ce qui sépare « notre logique est fausse » de « notre
//! logique est aveugle à l'héritage ».
//!
//! ## Le champion est facultatif
//!
//! Les trois dernières lignes de chaque tableau demandent un génome, et un
//! génome ne se relit qu'à arité d'encodage égale — un artefact d'avant un
//! changement du recensement se refuse au lieu de se lire de travers. Le
//! binaire le dit et publie les autres lignes plutôt que de s'arrêter : ce
//! qu'on mesure ici ne dépend pas de lui.

use breeding_neat::champion;
use breeding_neat::neat::Network;
use breeding_sim::audit::Audit;
use breeding_sim::baseline::{Greedy, Objective};
use breeding_sim::config::Prices;
use breeding_sim::economy::{Economy, Policy, Rng, Strategy, UnitPlan, UnitView, play};
use breeding_sim::encode::Census;
use breeding_sim::ladder::{LadderPolicy, Route};
use breeding_sim::search::{Myopic, Searching, ValueFn};
use breeding_sim::trees::{Catalog, muldo};

const SEEDS: u32 = 200;

struct NetValue<'a>(&'a Network);

impl ValueFn for NetValue<'_> {
    fn value(&self, census: &Census, catalog: &Catalog, economy: &Economy) -> f64 {
        self.0.value(&census.features(catalog, economy))
    }
}

/// `Audit` prend une politique par valeur ; `Box<dyn Policy>` n'implémente pas
/// `Policy`, d'où ce passe-plat.
struct PolicyBox(Box<dyn Policy>);

impl Policy for PolicyBox {
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

fn audit(name: &str, economy: &Economy, mut make: impl FnMut() -> Box<dyn Policy>) {
    let catalog = muldo();
    let (mut crossings, mut barren, mut capped) = (0usize, 0usize, 0usize);
    let mut scores = Vec::new();
    let mut gen10 = 0.0;
    let (mut head, mut ster, mut ster_value) = (0.0, 0.0, 0.0);

    for seed in 0..SEEDS {
        let mut audited = Audit::new(PolicyBox(make()));
        let outcome = play(&catalog, economy, &mut audited, seed);
        crossings += audited.tally.crossings;
        barren += audited.tally.barren;
        capped += audited.tally.capped;
        gen10 += outcome.gen10_held as f64;
        head += audited.tally.headcount as f64;
        ster += audited.tally.steriles as f64;
        ster_value += audited.tally.sterile_value as f64;
        scores.push(outcome.score as f64);
    }

    scores.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let n = f64::from(SEEDS);
    println!(
        "{:<22} {:>8.1} % {:>8.1} {:>8.0} {:>8.0} {:>7.0} % {:>10.2} M {:>11.2} M",
        name,
        // `barren` seul : depuis la boucle du sommet, `capped` compte la
        // production et non le gâchis. Voir `Tally::capped`.
        barren as f64 / crossings.max(1) as f64 * 100.0,
        gen10 / n,
        head / n,
        ster / n,
        ster / head.max(1.0) * 100.0,
        ster_value / n / 1e6,
        scores[scores.len() / 2] / 1e6,
    );
}

fn table(label: &str, economy: &Economy, path: &str) {
    let catalog = muldo();
    println!("\n=== {label} ===");
    println!(
        "{:<22} {:>10} {:>8} {:>8} {:>8} {:>9} {:>12} {:>13}",
        "politique", "perdus", "gen10", "parc", "stér.", "part", "ambre stér.", "score méd."
    );
    println!("{}", "-".repeat(80));

    audit("glouton", economy, || {
        Box::new(Greedy::new(Objective::Gen10Balanced))
    });
    audit("recherche / myope", economy, || {
        Box::new(Searching::new(Myopic))
    });
    audit("echelle", economy, || {
        Box::new(LadderPolicy::new(&catalog, Route::default()))
    });
    // Le réglage du niveau ne demande rien au champion : il se déduit de
    // l'agenda par dichotomie sur le nombre de fournées que l'horizon permet.
    audit("echelle + niveau réglé", economy, || {
        Box::new(
            LadderPolicy::new(&catalog, Route::default())
                .with_strategies([Strategy::default(); breeding_sim::economy::MAX_UNITS])
                .tuned_for(economy),
        )
    });

    let Ok(genome) = champion::load(path, 1) else {
        eprintln!("champion illisible ({path}) — les deux dernières lignes manquent");
        return;
    };
    let strategies = genome.strategies;
    audit("echelle + agenda", economy, || {
        Box::new(LadderPolicy::new(&catalog, Route::default()).with_strategies(strategies))
    });
    audit("echelle + agenda réglé", economy, || {
        Box::new(
            LadderPolicy::new(&catalog, Route::default())
                .with_strategies(strategies)
                .tuned_for(economy),
        )
    });

    // `NetValue` emprunte le réseau et l'emprunt ne survit pas à la fermeture
    // qui fabrique une politique par partie. On lui donne la durée du
    // programme : un binaire de mesure qui rend la main aussitôt après, c'est
    // une fuite sans conséquence.
    let network: &'static Network = Box::leak(Box::new(Network::compile(&genome)));
    audit("champion NEAT", economy, move || {
        Box::new(Searching::new(NetValue(network)).with_strategies(strategies)) as Box<dyn Policy>
    });
}

fn main() {
    let economy = Prices::load_default().expect("economy.toml").economy;
    let path = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "champion.json".to_string());

    println!("{SEEDS} parties par politique, graines 0..{SEEDS}");

    table("pool hérité : 100 muldos gen 2 à 9", &economy, &path);

    // Le même banc en partant de rien. Les gen 1 n'ont pas de recette, donc
    // elles naissent anonymes : cent montures sans aucune ascendance.
    let mut scratch = economy;
    scratch.pool_generations = (1, 1);
    table("départ de zéro : 100 gen 1 anonymes", &scratch, &path);
}
