//! L'entraînement : faire évoluer la fonction de valeur qui remplit la fournée.
//!
//! ```sh
//! cargo run --release -p breeding-neat -- --minutes 60
//! ```
//!
//! ## Le bruit est l'ennemi, pas la topologie
//!
//! Une fitness est une moyenne sur des tirages. Un algorithme évolutionnaire qui
//! ne s'en protège pas sélectionne des **graines chanceuses** au lieu de bonnes
//! politiques, et il le fait silencieusement : la courbe monte, le champion ne
//! vaut rien. Trois précautions, et ce sont elles qui coûtent le plus cher en
//! calcul :
//!
//! 1. **Graines communes.** Tous les génomes d'une génération sont évalués sur
//!    exactement le même jeu de graines. Un écart de fitness est alors
//!    imputable au génome, pas au tirage. Le simulateur va plus loin : ses
//!    tirages sont indexés par `(fournée, emplacement)`, donc deux politiques
//!    qui ne font pas le même nombre de croisements voient quand même les mêmes
//!    naissances aux mêmes places.
//! 2. **Rotation.** Le jeu change à chaque génération, sinon on apprend les
//!    graines au lieu du jeu.
//! 3. **Jeu de test scellé.** Deux cents graines jamais vues à l'entraînement,
//!    ouvertes une seule fois, à la fin. C'est le seul chiffre qui compte.
//!
//! ## Ce que la porte exige
//!
//! Battre le glouton **sur les graines scellées**, d'un écart plus grand que la
//! dispersion. Si ce n'est pas le cas, on l'écrit : un résultat négatif mesuré
//! vaut mieux que la treizième intuition.

mod neat;

use std::time::Instant;

use breeding_sim::baseline::{Greedy, Objective};
use breeding_sim::economy::{Economy, NeverBreeds, play};
use breeding_sim::encode::{Census, FEATURES};
use breeding_sim::search::{Myopic, Searching, ValueFn};
use breeding_sim::trees::{Catalog, muldo};
use rayon::prelude::*;

use neat::{Config, Genome, Innovations, Network, Rng};

/// Les graines réservées à la mesure finale. Jamais tirées à l'entraînement.
const TEST_SEEDS: std::ops::Range<u32> = 900_000..900_200;

struct NetValue<'a>(&'a Network);

impl ValueFn for NetValue<'_> {
    fn value(&self, census: &Census, catalog: &Catalog, economy: &Economy) -> f64 {
        self.0.value(&census.features(catalog, economy))
    }
}

struct Options {
    minutes: f64,
    population: usize,
    seeds: usize,
    iterations: usize,
    seed: u64,
}

impl Options {
    fn parse() -> Self {
        let mut options = Self {
            minutes: 60.0,
            population: 128,
            seeds: 4,
            iterations: 600,
            seed: 20_260_808,
        };
        let args: Vec<String> = std::env::args().skip(1).collect();
        let mut index = 0;
        while index + 1 < args.len() {
            let value = &args[index + 1];
            match args[index].as_str() {
                "--minutes" => options.minutes = value.parse().unwrap_or(options.minutes),
                "--population" => {
                    options.population = value.parse().unwrap_or(options.population)
                }
                "--seeds" => options.seeds = value.parse().unwrap_or(options.seeds),
                "--iterations" => options.iterations = value.parse().unwrap_or(options.iterations),
                "--seed" => options.seed = value.parse().unwrap_or(options.seed),
                _ => {}
            }
            index += 2;
        }
        options
    }
}

/// Le score moyen d'un génome sur un jeu de graines.
fn fitness(
    catalog: &Catalog,
    economy: &Economy,
    genome: &Genome,
    seeds: &[u32],
    iterations: usize,
) -> f64 {
    let network = Network::compile(genome);
    if !network.is_connected() {
        // Un réseau dont la sortie ne reçoit rien note tout pareil : la
        // recherche n'a plus de pente et rend des fournées vides. Autant le dire
        // tout de suite plutôt que de payer cent parties pour l'apprendre.
        return f64::NEG_INFINITY;
    }
    let total: f64 = seeds
        .iter()
        .map(|&seed| {
            let mut policy = Searching::with_iterations(NetValue(&network), iterations);
            play(catalog, economy, &mut policy, seed).score as f64
        })
        .sum();
    total / seeds.len() as f64
}

struct Species {
    representative: Genome,
    members: Vec<usize>,
    best: f64,
    staleness: usize,
}

fn distribution(values: &mut [f64]) -> (f64, f64, f64) {
    values.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let at = |q: f64| values[((values.len() - 1) as f64 * q).round() as usize];
    (at(0.1), at(0.5), at(0.9))
}

fn millions(kamas: f64) -> String {
    format!("{:.2} M", kamas / 1_000_000.0)
}

fn main() {
    let options = Options::parse();
    let catalog = muldo();
    let economy = Economy::default();
    let config = Config {
        population: options.population,
        ..Config::default()
    };

    println!(
        "NEAT — population {}, {} graines par génération, {} mutations de recherche par fournée",
        options.population, options.seeds, options.iterations
    );
    println!("Budget : {:.0} minutes. Graines de test scellées : {TEST_SEEDS:?}\n", options.minutes);

    let mut rng = Rng::new(options.seed);
    let mut innovations = Innovations::new();
    let mut population: Vec<Genome> = (0..config.population)
        .map(|_| Genome::minimal(&mut innovations, &mut rng))
        .collect();
    let mut species: Vec<Species> = Vec::new();

    let started = Instant::now();
    let budget = options.minutes * 60.0;
    let mut generation = 0usize;
    let mut champion: Option<(Genome, f64)> = None;

    while started.elapsed().as_secs_f64() < budget {
        // --- graines communes, tournantes ---------------------------------
        let seeds: Vec<u32> = (0..options.seeds)
            .map(|_| (rng.next_u64() % 800_000) as u32)
            .collect();

        // --- évaluation, en parallèle sur les douze cœurs ------------------
        let scores: Vec<f64> = population
            .par_iter()
            .map(|genome| fitness(&catalog, &economy, genome, &seeds, options.iterations))
            .collect();

        let best_at = scores
            .iter()
            .enumerate()
            .max_by(|a, b| a.1.partial_cmp(b.1).unwrap_or(std::cmp::Ordering::Equal))
            .map(|(index, _)| index)
            .unwrap_or(0);
        if champion.as_ref().is_none_or(|(_, best)| scores[best_at] > *best) {
            champion = Some((population[best_at].clone(), scores[best_at]));
        }

        // --- spéciation ----------------------------------------------------
        for entry in &mut species {
            entry.members.clear();
        }
        for (index, genome) in population.iter().enumerate() {
            let home = species
                .iter()
                .position(|s| genome.distance(&s.representative, &config) < config.compatibility_threshold);
            match home {
                Some(at) => species[at].members.push(index),
                None => species.push(Species {
                    representative: genome.clone(),
                    members: vec![index],
                    best: f64::NEG_INFINITY,
                    staleness: 0,
                }),
            }
        }
        species.retain(|s| !s.members.is_empty());

        for entry in &mut species {
            let best = entry
                .members
                .iter()
                .map(|&i| scores[i])
                .fold(f64::NEG_INFINITY, f64::max);
            if best > entry.best {
                entry.best = best;
                entry.staleness = 0;
            } else {
                entry.staleness += 1;
            }
        }
        // Une espèce qui n'avance plus cesse d'être protégée — mais on en garde
        // toujours deux, sinon un plateau général vide la population.
        if species.len() > 2 {
            let mut ranked: Vec<usize> = (0..species.len()).collect();
            ranked.sort_by(|&a, &b| {
                species[b].best
                    .partial_cmp(&species[a].best)
                    .unwrap_or(std::cmp::Ordering::Equal)
            });
            let protected: Vec<usize> = ranked.into_iter().take(2).collect();
            let mut index = 0;
            species.retain(|s| {
                let keep = s.staleness < config.stagnation || protected.contains(&index);
                index += 1;
                keep
            });
        }

        // --- répartition de la descendance ---------------------------------
        // La fitness est **partagée** à l'intérieur d'une espèce : une topologie
        // nouvelle n'a pas à battre la population entière pour survivre, sans
        // quoi elle disparaîtrait avant d'avoir été affinée.
        let shares: Vec<f64> = species
            .iter()
            .map(|s| {
                let sum: f64 = s.members.iter().map(|&i| scores[i]).sum();
                (sum / s.members.len() as f64).max(0.0)
            })
            .collect();
        let total: f64 = shares.iter().sum();

        let mut next: Vec<Genome> = Vec::with_capacity(config.population);
        for (at, entry) in species.iter().enumerate() {
            let mut ranked = entry.members.clone();
            ranked.sort_by(|&a, &b| {
                scores[b]
                    .partial_cmp(&scores[a])
                    .unwrap_or(std::cmp::Ordering::Equal)
            });

            // L'élite passe telle quelle : sans elle, une mutation malheureuse
            // peut faire reculer le meilleur d'une génération à l'autre.
            if ranked.len() >= 5 {
                next.push(population[ranked[0]].clone());
            }

            let quota = if total > 0.0 {
                (shares[at] / total * config.population as f64).round() as usize
            } else {
                config.population / species.len().max(1)
            };
            let survivors = ((ranked.len() as f64 * config.survival_threshold).ceil() as usize)
                .max(1)
                .min(ranked.len());

            for _ in next.len()..(next.len() + quota).min(config.population) {
                if next.len() >= config.population {
                    break;
                }
                let first = ranked[rng.range(survivors)];
                let mut child = if rng.f64() < config.crossover_rate && survivors > 1 {
                    let second = ranked[rng.range(survivors)];
                    if scores[first] >= scores[second] {
                        Genome::crossover(&population[first], &population[second], &mut rng)
                    } else {
                        Genome::crossover(&population[second], &population[first], &mut rng)
                    }
                } else {
                    population[first].clone()
                };
                child.mutate(&config, &mut innovations, &mut rng);
                next.push(child);
            }
        }

        // Le quota arrondi ne remplit pas toujours : on complète depuis le
        // champion plutôt que de laisser la population fondre.
        while next.len() < config.population {
            let mut child = champion
                .as_ref()
                .map(|(genome, _)| genome.clone())
                .unwrap_or_else(|| Genome::minimal(&mut innovations, &mut rng));
            child.mutate(&config, &mut innovations, &mut rng);
            next.push(child);
        }
        next.truncate(config.population);

        for entry in &mut species {
            if let Some(&first) = entry.members.first() {
                entry.representative = population[first].clone();
            }
        }
        population = next;
        generation += 1;

        let mut finite: Vec<f64> = scores.iter().copied().filter(|s| s.is_finite()).collect();
        let (_, median, _) = if finite.is_empty() {
            (0.0, 0.0, 0.0)
        } else {
            distribution(&mut finite)
        };
        let (hidden, links) = population[0].size();
        println!(
            "gén {generation:>4}  meilleur {:>9}  médiane {:>9}  espèces {:>3}  \
             topologie {hidden}n/{links}l  {:.0}s",
            millions(scores[best_at]),
            millions(median),
            species.len(),
            started.elapsed().as_secs_f64()
        );
    }

    // --- la porte : les graines scellées -----------------------------------
    let Some((best, training_score)) = champion else {
        println!("aucun champion — l'entraînement n'a pas tourné");
        return;
    };

    println!("\n--- graines scellées ({} parties) ---", TEST_SEEDS.len());
    let network = Network::compile(&best);
    let evaluate = |label: &str, scores: &mut Vec<f64>| {
        let (p10, median, p90) = distribution(scores);
        println!(
            "{label:<28} p10 {:>9}  médiane {:>9}  p90 {:>9}",
            millions(p10),
            millions(median),
            millions(p90)
        );
        median
    };

    let mut floor: Vec<f64> = TEST_SEEDS
        .clone()
        .map(|seed| play(&catalog, &economy, &mut NeverBreeds, seed).score as f64)
        .collect();
    let mut greedy: Vec<f64> = TEST_SEEDS
        .clone()
        .collect::<Vec<u32>>()
        .par_iter()
        .map(|&seed| {
            play(
                &catalog,
                &economy,
                &mut Greedy::new(Objective::Gen10Balanced),
                seed,
            )
            .score as f64
        })
        .collect();
    let mut myopic: Vec<f64> = TEST_SEEDS
        .clone()
        .collect::<Vec<u32>>()
        .par_iter()
        .map(|&seed| {
            let mut policy = Searching::with_iterations(Myopic, options.iterations);
            play(&catalog, &economy, &mut policy, seed).score as f64
        })
        .collect();
    let mut evolved: Vec<f64> = TEST_SEEDS
        .clone()
        .collect::<Vec<u32>>()
        .par_iter()
        .map(|&seed| {
            let mut policy = Searching::with_iterations(NetValue(&network), options.iterations);
            play(&catalog, &economy, &mut policy, seed).score as f64
        })
        .collect();

    evaluate("ne rien faire", &mut floor);
    let greedy_median = evaluate("glouton (la baseline)", &mut greedy);
    let myopic_median = evaluate("recherche / valeur myope", &mut myopic);
    let evolved_median = evaluate("recherche / valeur NEAT", &mut evolved);

    println!(
        "\nchampion : entraîné à {}, topologie {:?}, {generation} générations",
        millions(training_score),
        best.size()
    );
    println!(
        "écart au glouton : {:+.2} M ({:+.0} %)",
        (evolved_median - greedy_median) / 1e6,
        (evolved_median - greedy_median) / greedy_median * 100.0
    );
    println!(
        "écart à la valeur myope : {:+.2} M ({:+.0} %)",
        (evolved_median - myopic_median) / 1e6,
        (evolved_median - myopic_median) / myopic_median * 100.0
    );

    let path = "champion.json";
    let json = serde_json::json!({
        "features": FEATURES,
        "hidden": best.hidden,
        "connections": best.connections.iter().map(|c| serde_json::json!({
            "from": c.from, "to": c.to, "weight": c.weight,
            "enabled": c.enabled, "innovation": c.innovation,
        })).collect::<Vec<_>>(),
        "training_score": training_score,
        "test_median": evolved_median,
        "generations": generation,
    });
    if std::fs::write(path, serde_json::to_string_pretty(&json).unwrap_or_default()).is_ok() {
        println!("champion écrit dans {path}");
    }
}
