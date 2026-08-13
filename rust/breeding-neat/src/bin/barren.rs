//! Ce qu'on paie pour des croisements qui ne pouvaient pas monter.
//!
//! ```sh
//! cargo run --release -p breeding-neat --bin barren
//! ```
//!
//! ## La question
//!
//! Le score est `solde + liquidation`. La liquidation compte les montures gardées,
//! donc une politique qui empile du stock marque, même si son stock est né de
//! croisements qui ne pouvaient rien donner de neuf. Un couple dont la cible n'est
//! nommée par personne est en régime « recopie » : toute la masse de réussite
//! retombe sur l'ascendance, et le poulain naît au mieux à la génération que les
//! parents portaient déjà. La place d'enclos, le carburant et la fécondité sont
//! payés pour un tirage qui ne peut pas faire avancer l'écurie.
//!
//! On mesure donc deux choses que le score seul ne sépare pas : **combien** de
//! croisements de ce genre chaque politique lance, et ce que le classement devient
//! quand on les facture.
//!
//! ## Pourquoi une seule passe suffit
//!
//! `barren_crossing_malus` est un terme de **score**, pas une dépense : il ne
//! touche ni la solvabilité ni les décisions, donc la partie jouée est la même quel
//! que soit son prix. Le score à un prix quelconque se recalcule alors depuis
//! `score` et `barren_crossings` d'une unique partie, et le balayage des prix est
//! gratuit. C'est aussi la garantie qu'on lit un re-classement et non un jeu
//! différent.
//!
//! La médiane est reprise **par prix** sur les scores ajustés graine à graine, et
//! non déduite de la médiane à zéro : la politique la plus stérile n'est pas
//! forcément celle de la partie médiane.

use breeding_neat::champion;
use breeding_neat::neat::Network;
use breeding_sim::baseline::{Greedy, Objective};
use breeding_sim::config::Prices;
use breeding_sim::economy::{Economy, MAX_UNITS, Policy, RunOutcome, Strategy, play};
use breeding_sim::encode::Census;
use breeding_sim::ladder::{Ladder, LadderPolicy, Route};
use breeding_sim::search::{Myopic, Searching, ValueFn};
use breeding_sim::trees::{Catalog, muldo};
use rayon::prelude::*;

/// Les graines de départage. Jamais les scellées : on compare des politiques,
/// c'est exactement le job du départage.
const SEEDS: std::ops::Range<u32> = 800_000..800_200;

/// Les prix balayés, en kamas par croisement stérile. Le premier est le régime
/// actuel, et il doit reproduire les chiffres publiés.
const MALUS: [i64; 4] = [0, 500_000, 1_000_000, 2_000_000];

struct NetValue<'a>(&'a Network);

impl ValueFn for NetValue<'_> {
    fn value(&self, census: &Census, catalog: &Catalog, economy: &Economy) -> f64 {
        self.0.value(&census.features(catalog, economy))
    }
}

fn median(values: &mut [f64]) -> f64 {
    values.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    values[(values.len() - 1) / 2]
}

fn mean(values: impl Iterator<Item = f64>) -> f64 {
    let collected: Vec<f64> = values.collect();
    collected.iter().sum::<f64>() / collected.len().max(1) as f64
}

/// Le score d'une partie une fois la stérilité facturée.
fn charged(outcome: &RunOutcome, malus: i64) -> f64 {
    (outcome.score - malus * outcome.barren_crossings as i64) as f64
}

fn run(
    label: &str,
    economy: &Economy,
    make: impl Fn() -> Box<dyn Policy> + Sync,
) -> (String, Vec<RunOutcome>) {
    let catalog = muldo();
    let outcomes = SEEDS
        .collect::<Vec<u32>>()
        .par_iter()
        .map(|&seed| {
            let mut policy = make();
            play(&catalog, economy, policy.as_mut(), seed)
        })
        .collect();
    (label.to_string(), outcomes)
}

fn main() {
    let economy = Prices::load_default()
        .map(|prices| prices.economy)
        .unwrap_or_else(|error| {
            // Mesurer sur une économie autre que celle du fichier serait pire que
            // ne pas mesurer.
            eprintln!("{error}");
            std::process::exit(1);
        });

    if economy.barren_crossing_malus != 0 {
        // Sinon la colonne « 0 » ne serait pas le régime publié et tout le tableau
        // mentirait sur sa propre référence.
        eprintln!(
            "economy.toml facture déjà {} par croisement stérile. \
             Ce binaire balaie le prix lui-même et attend une référence à zéro.",
            economy.barren_crossing_malus
        );
        std::process::exit(1);
    }

    let mut reports = vec![
        run("glouton / gen10_balanced", &economy, || {
            Box::new(Greedy::new(Objective::Gen10Balanced))
        }),
        run("glouton / profit", &economy, || {
            Box::new(Greedy::new(Objective::Profit))
        }),
        run("recherche / valeur myope", &economy, || {
            Box::new(Searching::new(Myopic))
        }),
        {
            let shared = Ladder::of(&muldo(), Route::Shared);
            run("echelle / cas 1 (pivot)", &economy, move || {
                Box::new(LadderPolicy::with_ladder(shared.clone()))
            })
        },
        {
            let ladder = Ladder::of(&muldo(), Route::default());
            run("echelle / niveau réglé", &economy, move || {
                Box::new(
                    LadderPolicy::with_ladder(ladder.clone())
                        .with_strategies([Strategy::default(); MAX_UNITS])
                        .tuned_for(&economy),
                )
            })
        },
    ];

    // Le champion à part : le réseau ne traverse pas la frontière du
    // `Box<dyn Policy>` sans emprunt. Absent ou d'un autre encodage, on continue
    // sans lui plutôt que de renoncer aux quatre autres lignes.
    match champion::load("champion.json", 1) {
        Ok(genome) => {
            let network = Network::compile(&genome);
            let catalog = muldo();
            let outcomes = SEEDS
                .collect::<Vec<u32>>()
                .par_iter()
                .map(|&seed| {
                    let mut policy =
                        Searching::new(NetValue(&network)).with_strategies(genome.strategies);
                    play(&catalog, &economy, &mut policy, seed)
                })
                .collect();
            reports.push(("recherche / NEAT".to_string(), outcomes));
        }
        Err(error) => eprintln!("champion ignoré : {error}"),
    }

    println!(
        "{} parties par politique, graines de départage {:?}.",
        SEEDS.len(),
        SEEDS
    );
    println!(
        "Un croisement stérile est un couple dont la cible n'est nommée par personne :\n\
         toute la masse de réussite retombe sur l'ascendance.\n"
    );

    // Le solde à côté de la liquidation : le score les additionne, mais une
    // politique qui finit sans un kama et ne marque que par son stock n'est pas
    // dans la même situation qu'une qui a encaissé.
    println!(
        "{:<26} {:>9} {:>9} {:>7} {:>10} {:>10} {:>10} {:>7}",
        "politique", "crois.", "stériles", "part", "gen10", "solde", "liquid.", "stock"
    );
    println!("{}", "-".repeat(94));
    for (label, outcomes) in &reports {
        let crossings = mean(outcomes.iter().map(|o| o.crossings as f64));
        let barren = mean(outcomes.iter().map(|o| o.barren_crossings as f64));
        let balance = mean(outcomes.iter().map(|o| o.balance_before_liquidation as f64));
        let liquidation = mean(outcomes.iter().map(|o| o.liquidation as f64));
        println!(
            "{label:<26} {crossings:>9.0} {barren:>9.0} {:>6.0}% {:>10.1} {:>10} {:>10} {:>6.0}%",
            if crossings > 0.0 {
                barren / crossings * 100.0
            } else {
                0.0
            },
            mean(outcomes.iter().map(|o| o.gen10_held as f64)),
            format!("{:.2} M", balance / 1e6),
            format!("{:.2} M", liquidation / 1e6),
            if balance + liquidation > 0.0 {
                liquidation / (balance + liquidation) * 100.0
            } else {
                0.0
            },
        );
    }

    println!("\nScore médian, par prix du croisement stérile :");
    print!("{:<26}", "politique");
    for malus in MALUS {
        print!("{:>13}", format!("{} k", malus / 1_000));
    }
    println!("{:>10}", "écart");
    println!("{}", "-".repeat(26 + 13 * MALUS.len() + 10));

    // Le classement à chaque prix, pour dire si le malus re-classe ou seulement
    // rabote. Un écart identique pour tout le monde ne changerait rien.
    let mut ranking_at: Vec<Vec<String>> = Vec::new();
    for malus in MALUS {
        let mut scored: Vec<(String, f64)> = reports
            .iter()
            .map(|(label, outcomes)| {
                let mut scores: Vec<f64> =
                    outcomes.iter().map(|o| charged(o, malus)).collect();
                (label.clone(), median(&mut scores))
            })
            .collect();
        scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        ranking_at.push(scored.into_iter().map(|(label, _)| label).collect());
    }

    for (label, outcomes) in &reports {
        print!("{label:<26}");
        let mut first = 0.0;
        for (index, malus) in MALUS.iter().enumerate() {
            let mut scores: Vec<f64> = outcomes.iter().map(|o| charged(o, *malus)).collect();
            let score = median(&mut scores);
            if index == 0 {
                first = score;
            }
            print!("{:>13}", format!("{:.2} M", score / 1e6));
        }
        let mut last: Vec<f64> = outcomes
            .iter()
            .map(|o| charged(o, *MALUS.last().unwrap()))
            .collect();
        println!("{:>10}", format!("{:+.2} M", (median(&mut last) - first) / 1e6));
    }

    println!("\nClassement, par prix :");
    for (index, malus) in MALUS.iter().enumerate() {
        println!(
            "  {:>9} : {}",
            format!("{} k", malus / 1_000),
            ranking_at[index].join(" > ")
        );
    }
}
