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

use breeding_neat::neat::{Connection, Genome, Network};
use breeding_sim::baseline::{Greedy, Objective};
use breeding_sim::config::Prices;
use breeding_sim::economy::{Economy, MAX_UNITS, Policy, RunOutcome, Strategy, play};
use breeding_sim::encode::Census;
use breeding_sim::search::{Myopic, Searching, ValueFn};
use breeding_sim::trees::{Catalog, muldo};
use rayon::prelude::*;
use serde_json::Value;

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

fn load(path: &str) -> Result<Genome, String> {
    let json = std::fs::read_to_string(path).map_err(|e| format!("{path}: {e}"))?;
    let parsed: Value = serde_json::from_str(&json).map_err(|e| format!("{path}: {e}"))?;

    // `finalists.json` est un tableau ; un troisième argument choisit le rang.
    // C'est ce qui permet de rejouer une stratégie alternative et de comparer
    // les **comportements** et pas seulement les scores.
    let root = match parsed.as_array() {
        Some(list) => {
            let rank = std::env::args()
                .nth(3)
                .and_then(|arg| arg.parse::<usize>().ok())
                .unwrap_or(1)
                .saturating_sub(1);
            list.get(rank)
                .cloned()
                .ok_or_else(|| format!("{path}: pas de finaliste au rang {}", rank + 1))?
        }
        None => parsed,
    };

    let hidden = root["hidden"]
        .as_array()
        .ok_or("`hidden` absent")?
        .iter()
        .filter_map(|v| v.as_u64().map(|n| n as usize))
        .collect();
    let connections = root["connections"]
        .as_array()
        .ok_or("`connections` absent")?
        .iter()
        .map(|c| Connection {
            from: c["from"].as_u64().unwrap_or(0) as usize,
            to: c["to"].as_u64().unwrap_or(0) as usize,
            weight: c["weight"].as_f64().unwrap_or(0.0),
            enabled: c["enabled"].as_bool().unwrap_or(false),
            innovation: c["innovation"].as_u64().unwrap_or(0),
        })
        .collect();

    Ok(Genome {
        hidden,
        connections,
        // Les réglages stratégiques du champion. Absents d'un fichier écrit
        // avant qu'ils existent : on retombe alors sur l'économie simplifiée,
        // ce qui rejoue exactement les mesures d'alors.
        strategies: {
            // Une stratégie par unité. Un champion écrit avant qu'elles
            // existent retombe sur le réglage neutre.
            let mut strategies = [Strategy::default(); MAX_UNITS];
            if let Some(list) = root["strategies"].as_array() {
                for (unit, value) in list.iter().take(MAX_UNITS).enumerate() {
                    if let Some(bands) = value["bands"].as_array() {
                        for (gauge, band) in bands.iter().take(6).enumerate() {
                            strategies[unit].bands[gauge] = band.as_u64().unwrap_or(0) as usize;
                        }
                    }
                    strategies[unit].level = value["level"].as_u64().unwrap_or(0) as u16;
                    strategies[unit].optimakina_from =
                        value["optimakina_from"].as_u64().unwrap_or(11) as u8;
                }
            }
            strategies
        },
    })
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
    let genome = match load(&path) {
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
                let mut policy = Searching::new(NetValue(&network)).with_strategies(genome.strategies);
                play(&catalog, &economy, &mut policy, seed)
            })
            .collect();
        reports.push(("recherche / NEAT".to_string(), outcomes));
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
        "{:<20} {:>14} {:>16} {:>14}",
        "politique", "solde final", "liquidation", "dont gen 10"
    );
    println!("{}", "-".repeat(68));
    for (label, outcomes) in &reports {
        let gen10_value = mean(outcomes.iter().map(|o| o.gen10_held as f64)) * 500_000.0;
        println!(
            "{label:<20} {:>14} {:>16} {:>14}",
            format!("{:.2} M", mean(outcomes.iter().map(|o| o.balance_before_liquidation as f64)) / 1e6),
            format!("{:.2} M", mean(outcomes.iter().map(|o| o.liquidation as f64)) / 1e6),
            format!("{:.2} M", gen10_value / 1e6),
        );
    }
}
