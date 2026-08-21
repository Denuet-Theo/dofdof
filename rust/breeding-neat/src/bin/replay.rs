//! Rejouer le champion pour voir **ce qu'il fait**, pas seulement ce qu'il vaut.
//!
//! ```sh
//! cargo run --release -p breeding-neat --bin replay
//! ```
//!
//! Un écart de score dit qu'une politique est meilleure ; il ne dit pas
//! pourquoi. Or c'est le pourquoi qu'on vient chercher : tout ce chantier existe
//! parce que douze PR ont réécrit une heuristique devinée, et le seul moyen d'en
//! sortir vraiment est de comprendre ce que la recherche a trouvé pour pouvoir
//! le réécrire à la main — ou au moins le défendre.
//!
//! On rejoue donc les mêmes graines avec les trois politiques et on compare non
//! pas les scores mais les **comportements** : combien de croisements, combien
//! d'achats, combien de gen 10, combien de couleurs distinctes en fin de partie.

use breeding_neat::champion;
use breeding_neat::neat::Network;
use breeding_sim::baseline::{Greedy, Objective};
use breeding_sim::config::Prices;
use breeding_sim::economy::{Economy, Policy, RunOutcome, play};
use breeding_sim::encode::Census;
use breeding_sim::search::{Myopic, Searching, ValueFn};
use breeding_sim::ladder::Route;
use breeding_sim::trees::{Catalog, muldo};
use rayon::prelude::*;

/// Par défaut les graines scellées. Un second argument déplace la plage, ce
/// qui permet de rejouer sur des graines **du domaine d'entraînement** et de
/// séparer deux explications d'un écart : la malédiction du vainqueur, ou un
/// jeu de test plus difficile que la moyenne.
fn seeds() -> std::ops::Range<u32> {
    let start = std::env::args()
        .nth(2)
        .and_then(|arg| arg.parse().ok())
        .unwrap_or(900_000u32);
    start..start + 200
}

struct NetValue<'a>(&'a Network);

impl ValueFn for NetValue<'_> {
    fn value(&self, census: &Census, catalog: &Catalog, economy: &Economy) -> f64 {
        self.0.value(&census.features(catalog, economy))
    }
}

/// Le champion, moins ce que coûtent les fécondes qu'il n'a pas dépensées.
///
/// Une féconde en stock est une place d'enclos déjà payée qui n'a rien produit.
/// Le réseau, lui, la compte comme un actif : ses poids sur `cycled_*` sont
/// francs et positifs, et ils viennent du tapis roulant, où `Action::Cycle`
/// n'était **jamais proposable** (`capacity: 0`) et où la fécondité tombait au
/// hasard. Il n'a donc jamais été noté ni sur en fabriquer, ni sur en garder.
///
/// On ne devine pas le bon poids : on le balaye et on lit le score.
struct PenalisedNet<'a>(&'a Network, f64);

impl ValueFn for PenalisedNet<'_> {
    fn value(&self, census: &Census, catalog: &Catalog, economy: &Economy) -> f64 {
        self.0.value(&census.features(catalog, economy)) - self.1 * census.cycled_held()
    }
}

/// Le rang à lire dans un `finalists.json`. C'est ce qui permet de rejouer une
/// stratégie alternative et de comparer les **comportements** et pas seulement
/// les scores.
/// Jouer sous les contraintes de l'échelle — le régime de l'écran.
///
/// Sans ça on compare un champion entraîné sous l'échelle à des parties jouées
/// sans elle, et le chiffre ne veut rien dire : le même génome a rendu 48,84 M
/// au départage et 31,44 M dans un tableau non contraint.
///
/// Le glouton n'est pas concerné : ce n'est pas une recherche, il ne passe pas
/// par `Searcher`, donc rien ne peut l'y contraindre. Sa ligne le dit.
fn under_ladder() -> bool {
    std::env::args().any(|arg| arg == "--ladder")
}

fn rank() -> usize {
    std::env::args()
        .nth(3)
        .and_then(|arg| arg.parse::<usize>().ok())
        .unwrap_or(1)
}

fn mean(values: impl Iterator<Item = f64>) -> f64 {
    let collected: Vec<f64> = values.collect();
    collected.iter().sum::<f64>() / collected.len().max(1) as f64
}

fn median(values: &mut [f64]) -> f64 {
    values.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    values[values.len() / 2]
}

fn run(label: &str, make: impl Fn() -> Box<dyn Policy> + Sync) -> (String, Vec<RunOutcome>) {
    let catalog = muldo();
    let economy = Prices::load_default()
        .map(|prices| prices.economy)
        .unwrap_or_else(|error| {
            // Mesurer sur une économie différente de celle du fichier serait pire
            // que ne pas mesurer : on s'arrête.
            eprintln!("{error}");
            std::process::exit(1);
        });
    let outcomes = seeds().collect::<Vec<u32>>()
        .par_iter()
        .map(|&seed| {
            let mut policy = make();
            play(&catalog, &economy, policy.as_mut(), seed)
        })
        .collect();
    (label.to_string(), outcomes)
}

fn main() {
    let path = std::env::args().nth(1).unwrap_or("champion.json".into());
    let genome = match champion::load(&path, rank()) {
        Ok(genome) => genome,
        Err(error) => {
            eprintln!(
                "{error}\nLancer d'abord l'entraînement :\n  \
                 cargo run --release -p breeding-neat -- --minutes 60"
            );
            std::process::exit(1);
        }
    };
    let network = Network::compile(&genome);

    let mut reports = vec![
        run("glouton", || {
            Box::new(Greedy::new(Objective::Gen10Balanced))
        }),
        run("recherche / myope", || Box::new(Searching::new(Myopic))),
    ];
    // Le réseau ne traverse pas la frontière du `Box<dyn Policy>` sans emprunt,
    // donc on le joue à part.
    {
        let catalog = muldo();
        let economy = Prices::load_default()
        .map(|prices| prices.economy)
        .unwrap_or_else(|error| {
            // Mesurer sur une économie différente de celle du fichier serait pire
            // que ne pas mesurer : on s'arrête.
            eprintln!("{error}");
            std::process::exit(1);
        });
        let outcomes = seeds()
            .collect::<Vec<u32>>()
            .par_iter()
            .map(|&seed| {
                let mut policy =
                    Searching::new(NetValue(&network)).with_strategies(genome.strategies);
                if under_ladder() {
                    policy = policy.under_ladder(&catalog, &economy, Route::default());
                }
                play(&catalog, &economy, &mut policy, seed)
            })
            .collect();
        reports.push(("recherche / NEAT".to_string(), outcomes));

        // Le balayage de la pénalité, sur les mêmes graines et la même économie.
        // 3 est ce que l'app applique (`UNSPENT_FERTILITY`) ; 1 et 10 encadrent,
        // et montrent que la courbe sature — au-delà de 3 le plan ne bouge plus.
        for lambda in [1.0_f64, 3.0, 10.0] {
            let outcomes = seeds()
                .collect::<Vec<u32>>()
                .par_iter()
                .map(|&seed| {
                    let mut policy = Searching::new(PenalisedNet(&network, lambda))
                        .with_strategies(genome.strategies);
                    play(&catalog, &economy, &mut policy, seed)
                })
                .collect();
            reports.push((format!("NEAT / pénalité {lambda}"), outcomes));
        }
    }

    println!("{} parties par politique, graines {:?}\n", seeds().len(), seeds());
    println!(
        "{:<20} {:>10} {:>9} {:>9} {:>9} {:>8} {:>8} {:>9}",
        "politique", "score méd.", "crois.", "achats", "sacrif.", "clones", "gen10", "charg."
    );
    println!("{}", "-".repeat(88));
    for (label, outcomes) in &reports {
        let mut scores: Vec<f64> = outcomes.iter().map(|o| o.score as f64).collect();
        println!(
            "{label:<20} {:>10} {:>9.0} {:>9.0} {:>9.0} {:>8.0} {:>8.1} {:>9.0}",
            format!("{:.2} M", median(&mut scores) / 1e6),
            mean(outcomes.iter().map(|o| o.crossings as f64)),
            mean(outcomes.iter().map(|o| o.purchases as f64)),
            mean(outcomes.iter().map(|o| o.sacrifices as f64)),
            mean(outcomes.iter().map(|o| o.clonings as f64)),
            mean(outcomes.iter().map(|o| o.gen10_held as f64)),
            mean(outcomes.iter().map(|o| f64::from(o.loads_paid))),
        );
    }

    println!("\nD'où vient le score :");
    println!(
        "{:<20} {:>14} {:>16} {:>14} {:>12} {:>14} {:>14}",
        "politique", "solde final", "liquidation", "dont gen 10", "couleurs", "prime succès", "remise marché"
    );
    println!("{}", "-".repeat(112));
    for (label, outcomes) in &reports {
        let gen10_value = mean(outcomes.iter().map(|o| o.gen10_held as f64)) * 500_000.0;
        // La collection est une colonne à part et non un terme fondu dans la
        // liquidation : elle ne se vend pas, elle se possède une fois. Sans elle on
        // lirait un score qui a bougé sans pouvoir dire de combien de couleurs.
        println!(
            "{label:<20} {:>14} {:>16} {:>14} {:>12} {:>14} {:>14}",
            format!("{:.2} M", mean(outcomes.iter().map(|o| o.balance_before_liquidation as f64)) / 1e6),
            format!("{:.2} M", mean(outcomes.iter().map(|o| o.liquidation as f64)) / 1e6),
            format!("{:.2} M", gen10_value / 1e6),
            format!("{:.1}", mean(outcomes.iter().map(|o| o.collection_done as f64))),
            format!("{:.2} M", mean(outcomes.iter().map(|o| o.collection_bonus as f64)) / 1e6),
            format!("{:.2} M", mean(outcomes.iter().map(|o| o.market_discount as f64)) / 1e6),
        );
    }
}
