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

use breeding_neat::neat;

use std::time::Instant;

use breeding_sim::baseline::{Greedy, Objective};
use breeding_sim::config::Prices;
use breeding_sim::economy::{Economy, NeverBreeds, play};
use breeding_sim::encode::{Census, FEATURES};
use breeding_sim::search::{Myopic, Searching, ValueFn};
use breeding_sim::trees::{Catalog, muldo};
use rayon::prelude::*;

use neat::{Config, Genome, Innovations, Network, Rng};

/// Les graines réservées à la mesure finale. Jamais tirées à l'entraînement.
const TEST_SEEDS: std::ops::Range<u32> = 900_000..900_200;

/// Les graines de **départage**, disjointes des deux autres jeux.
///
/// L'entraînement tire dans `0..800_000` et le test scellé vit à 900_000 : ces
/// cent-là ne sont donc ni apprises ni le juge final. Elles servent à choisir
/// entre finalistes sans consommer le jeu de test — sélectionner sur les graines
/// scellées reviendrait à les brûler, et le chiffre publié ne vaudrait plus
/// rien.
const VALIDATION_SEEDS: std::ops::Range<u32> = 800_000..800_100;

/// Combien de candidats on retient par espèce avant le départage.
const FINALISTS_PER_SPECIES: usize = 3;

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
            let mut policy = Searching::with_iterations(NetValue(&network), iterations)
                .with_strategy(genome.bands, genome.level, genome.optimakina_from);
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
    let economy = Prices::load_default()
        .map(|prices| prices.economy)
        .unwrap_or_else(|error| {
            // Mesurer sur une économie différente de celle du fichier serait pire
            // que ne pas mesurer : on s'arrête.
            eprintln!("{error}");
            std::process::exit(1);
        });
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
    // Le seuil s'ajuste pour tenir le nombre d'espèces visé. C'est ce qui rend
    // la spéciation robuste à l'échelle de la distance, qui change à mesure que
    // les génomes grossissent.
    let mut threshold = config.compatibility_threshold;

    let started = Instant::now();
    let budget = options.minutes * 60.0;
    let mut generation = 0usize;
    let mut champion: Option<(Genome, f64)> = None;
    // Le meilleur de chaque espèce à la dernière génération. C'est ce qu'on
    // vient chercher en spéciant : les stratégies **alternatives**, pas
    // seulement celle qui a gagné.
    let mut survivors: Vec<(Genome, f64)> = Vec::new();

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
                .position(|s| genome.distance(&s.representative, &config) < threshold);
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

        // Trop d'espèces : on relâche. Pas assez : on resserre.
        //
        // L'ajustement est **proportionnel à l'écart** et non à pas fixe. À pas
        // fixe de 5 %, partir de 122 espèces pour en viser dix demandait une
        // cinquantaine de générations — un huitième d'un entraînement d'une
        // heure passé à se caler au lieu de chercher. Le facteur est borné pour
        // que le seuil n'oscille pas.
        if !species.is_empty() {
            let ratio = species.len() as f64 / config.target_species.max(1) as f64;
            threshold = (threshold * ratio.powf(0.3).clamp(0.75, 1.35)).max(0.02);
        }

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
        survivors = species
            .iter()
            .flat_map(|entry| {
                let mut ranked: Vec<usize> = entry
                    .members
                    .iter()
                    .copied()
                    .filter(|&index| scores[index].is_finite())
                    .collect();
                ranked.sort_by(|&a, &b| {
                    scores[b]
                        .partial_cmp(&scores[a])
                        .unwrap_or(std::cmp::Ordering::Equal)
                });
                ranked
                    .into_iter()
                    .take(FINALISTS_PER_SPECIES)
                    .map(|index| (population[index].clone(), scores[index]))
                    .collect::<Vec<_>>()
            })
            .collect();
        survivors.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

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

    // --- le départage ------------------------------------------------------
    //
    // On ne sacre pas sur la fitness d'entraînement. Elle est le **maximum** de
    // cent mille estimations bruitées — 834 générations de 128 génomes, chacune
    // moyennée sur huit parties dont l'erreur type vaut près de deux millions —
    // et prendre le plus haut de tant de tirages sélectionne la chance autant
    // que la qualité. Mesuré : un champion annoncé à 52,49 M en valait 46 sur
    // n'importe quelle plage de graines, y compris celles de son propre domaine
    // d'entraînement. L'écart n'était pas du surapprentissage — les graines
    // tournent, il n'y a rien à mémoriser — mais la malédiction du vainqueur.
    //
    // On rejoue donc les trois meilleurs de chaque espèce sur cent graines
    // dédiées, et c'est ce second passage qui tranche. Le champion historique
    // entre aussi dans la liste : il peut avoir disparu de la population.
    let mut finalists: Vec<(Genome, f64)> = survivors.clone();
    if let Some((genome, score)) = champion.clone() {
        finalists.push((genome, score));
    }
    if finalists.is_empty() {
        println!("aucun candidat — l'entraînement n'a pas tourné");
        return;
    }

    let validation: Vec<u32> = VALIDATION_SEEDS.collect();
    let mut judged: Vec<(usize, f64)> = finalists
        .par_iter()
        .enumerate()
        .map(|(index, (genome, _))| {
            (
                index,
                fitness(&catalog, &economy, genome, &validation, options.iterations),
            )
        })
        .collect();
    judged.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

    println!(
        "
--- départage sur {} graines dédiées ({VALIDATION_SEEDS:?}) ---",
        validation.len()
    );
    println!(
        "{:>4} {:>11} {:>11} {:<9} {:>7} {:>6} {:>9}",
        "rang", "entraîn.", "départage", "bandes", "niveau", "opti", "fournée"
    );
    for (rank, (index, score)) in judged.iter().take(12).enumerate() {
        let (genome, training) = &finalists[*index];
        let (cost, _) = economy.batch_plan(genome.bands, genome.level);
        let bands: Vec<String> = genome.bands.iter().map(|b| b.to_string()).collect();
        println!(
            "{:>4} {:>11} {:>11} {:<9} {:>7} {:>6} {:>9}",
            rank + 1,
            millions(*training),
            millions(*score),
            bands.join(""),
            genome.level,
            if genome.optimakina_from > 10 {
                "—".to_string()
            } else {
                genome.optimakina_from.to_string()
            },
            cost
        );
    }
    println!("  (bandes dans l'ordre Baffeur Caresseur Foudroyeur Dragofesse Abreuvoir Mangeoire)");

    let (winner, validated) = judged[0];
    let (best, training_score) = finalists[winner].clone();


    // --- la porte : les graines scellées -----------------------------------

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
            let mut policy = Searching::with_iterations(NetValue(&network), options.iterations)
                .with_strategy(best.bands, best.level, best.optimakina_from);
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

    {
        let (cost, hours) = economy.batch_plan(best.bands, best.level);
        let bands: Vec<String> = (0..breeding_sim::schedule::GAUGES)
            .map(|g| format!("{}={}", &breeding_sim::schedule::GAUGE_NAMES[g][..3], best.bands[g]))
            .collect();
        println!("  bandes : {}", bands.join(" "));
        println!(
            "  niveau {} ({:.1} % de réussite), Optimakina {}",
            best.level,
            economy.success_rate(best.level, false) * 100.0,
            if best.optimakina_from > 10 {
                "jamais".to_string()
            } else {
                format!("à partir de la gen {}", best.optimakina_from)
            }
        );
        println!(
            "  une fournée : {cost} kamas, {hours:.2} h → {} fournées tenables",
            (economy.horizon_hours.unwrap_or(0.0) / hours.max(1e-9)) as u32
        );
    }

    let path = "champion.json";
    let json = serde_json::json!({
        "features": FEATURES,
        "hidden": best.hidden,
        "connections": best.connections.iter().map(|c| serde_json::json!({
            "from": c.from, "to": c.to, "weight": c.weight,
            "enabled": c.enabled, "innovation": c.innovation,
        })).collect::<Vec<_>>(),
        "bands": best.bands.to_vec(),
        "level": best.level,
        "optimakina_from": best.optimakina_from,
        "training_score": training_score,
        "validation_score": validated,
        "test_median": evolved_median,
        "generations": generation,
    });
    if std::fs::write(path, serde_json::to_string_pretty(&json).unwrap_or_default()).is_ok() {
        println!("champion écrit dans {path}");
    }
}
