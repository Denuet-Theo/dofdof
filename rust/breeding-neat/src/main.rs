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
    /// Population de départ, pour reprendre un entraînement au lieu de le
    /// refaire. Huit heures de recherche jetées à chaque lancement était une
    /// perte qu'on ne peut pas se permettre.
    resume: Option<String>,
    /// Ouvrir le jeu scellé. **Faux par défaut, et c'est tout l'intérêt.**
    ///
    /// Il était mesuré et imprimé à chaque exécution. Personne n'y sélectionnait
    /// rien — mais un chiffre qu'on relit à chaque manche finit par guider les
    /// manches suivantes, et c'est exactement la fuite que le jeu scellé existe
    /// pour empêcher. On ne peut pas décider de ne pas savoir ce qu'on a lu.
    ///
    /// À réserver à la mesure publiée, une fois le chantier fini.
    sealed: bool,
}

impl Options {
    fn parse() -> Self {
        let mut options = Self {
            minutes: 60.0,
            population: 128,
            seeds: 4,
            iterations: 600,
            seed: 20_260_808,
            resume: None,
            sealed: false,
        };
        let args: Vec<String> = std::env::args().skip(1).collect();
        let mut index = 0;
        while index < args.len() {
            // Les drapeaux sans valeur d'abord. Le parseur avance par paires, donc
            // un drapeau nu décalerait tout ce qui le suit — c'est le piège que
            // le skill signale, et il se referme en silence.
            if args[index] == "--sealed" {
                options.sealed = true;
                index += 1;
                continue;
            }
            let Some(value) = args.get(index + 1) else { break };
            match args[index].as_str() {
                "--minutes" => options.minutes = value.parse().unwrap_or(options.minutes),
                "--population" => {
                    options.population = value.parse().unwrap_or(options.population)
                }
                "--seeds" => options.seeds = value.parse().unwrap_or(options.seeds),
                "--iterations" => options.iterations = value.parse().unwrap_or(options.iterations),
                "--seed" => options.seed = value.parse().unwrap_or(options.seed),
                "--resume" => options.resume = Some(value.clone()),
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
                .with_strategies(genome.strategies);
            play(catalog, economy, &mut policy, seed).score as f64
        })
        .sum();
    total / seeds.len() as f64
}

/// Ce qu'une politique **fait**, pas ce qu'elle vaut.
///
/// Un écart de score dit qu'une stratégie est meilleure ; il ne dit pas
/// pourquoi. Et la réponse est régulièrement la même : le clonage est gratuit et
/// c'est le seul moyen de récupérer de la fécondité, donc les stratégies se
/// séparent surtout par leur assiduité à recycler.
struct Behaviour {
    crossings: f64,
    clonings: f64,
    purchases: f64,
    gen10: f64,
}

fn behaviour(
    catalog: &Catalog,
    economy: &Economy,
    genome: &Genome,
    seeds: &[u32],
    iterations: usize,
) -> Behaviour {
    let network = Network::compile(genome);
    let runs: Vec<_> = seeds
        .par_iter()
        .map(|&seed| {
            let mut policy = Searching::with_iterations(NetValue(&network), iterations)
                .with_strategies(genome.strategies);
            play(catalog, economy, &mut policy, seed)
        })
        .collect();
    let n = runs.len().max(1) as f64;
    Behaviour {
        crossings: runs.iter().map(|r| r.crossings as f64).sum::<f64>() / n,
        clonings: runs.iter().map(|r| r.clonings as f64).sum::<f64>() / n,
        purchases: runs.iter().map(|r| r.purchases as f64).sum::<f64>() / n,
        gen10: runs.iter().map(|r| r.gen10_held as f64).sum::<f64>() / n,
    }
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

/// Un génome en JSON, topologie et réglages compris.
fn genome_json(genome: &Genome) -> serde_json::Value {
    serde_json::json!({
        "hidden": genome.hidden,
        "connections": genome.connections.iter().map(|c| serde_json::json!({
            "from": c.from, "to": c.to, "weight": c.weight,
            "enabled": c.enabled, "innovation": c.innovation,
        })).collect::<Vec<_>>(),
        "strategies": genome.strategies.iter().map(|s| serde_json::json!({
            "bands": s.bands.to_vec(),
            "level": s.level,
            "optimakina_from": s.optimakina_from,
        })).collect::<Vec<_>>(),
    })
}

/// Tout ce qu'il faut pour reprendre un entraînement là où il s'est arrêté.
struct Checkpoint {
    population: Vec<Genome>,
    innovations: Innovations,
    threshold: f64,
    generations: usize,
    /// Le meilleur génome jamais vu, avec sa fitness d'entraînement.
    ///
    /// Sans lui, `champion` repart à `None` à chaque reprise et la ligne
    /// `hist.` du départage ne dit plus « le meilleur depuis le début » mais
    /// « le meilleur de cette heure-ci ». Mesuré : une manche a rendu 104,46 M
    /// au départage, la suivante 93,38 M sur la même ligne — non pas parce que
    /// le premier avait été battu, mais parce qu'il n'était plus dans la
    /// course.
    champion: Option<(Genome, f64)>,
}

fn read_checkpoint(path: &str) -> Result<Checkpoint, String> {
    let text = std::fs::read_to_string(path).map_err(|e| format!("{path} : {e}"))?;
    let root: serde_json::Value = serde_json::from_str(&text).map_err(|e| format!("{path} : {e}"))?;

    // Un tableau nu est l'ancien format « population seule » ; on l'accepte
    // encore, en reconstituant ce qu'on peut.
    let list = root["population"]
        .as_array()
        .or_else(|| root.as_array())
        .ok_or(format!("{path} : population absente"))?;
    let population: Vec<Genome> = list.iter().map(genome_from_json).collect();

    let registry = &root["innovations"];
    let innovations = if registry.is_object() {
        let rows = |key: &str, arity: usize| -> Vec<Vec<u64>> {
            registry[key]
                .as_array()
                .map(|list| {
                    list.iter()
                        .filter_map(|row| row.as_array())
                        .filter(|row| row.len() >= arity)
                        .map(|row| row.iter().map(|v| v.as_u64().unwrap_or(0)).collect())
                        .collect()
                })
                .unwrap_or_default()
        };
        Innovations::restore(
            registry["next_innovation"].as_u64().unwrap_or(0),
            registry["next_node"].as_u64().unwrap_or(0) as usize,
            rows("links", 3)
                .into_iter()
                .map(|row| (row[0] as usize, row[1] as usize, row[2]))
                .collect(),
            rows("splits", 2)
                .into_iter()
                .map(|row| (row[0], row[1] as usize))
                .collect(),
        )
    } else {
        // Ancien format : on reconstitue au mieux. Ce qui se perd est `splits` —
        // rien dans un génome ne dit **quel lien** a été coupé pour créer tel
        // nœud, donc deux lignées cesseraient de reconnaître la même mutation
        // structurelle et le croisement s'en trouverait dégradé.
        Innovations::from_population(&population)
    };

    // Absent des fichiers écrits avant que le champion soit sauvegardé : la
    // reprise repart alors sans lui, comme avant.
    let champion = root["champion"]["genome"].is_object().then(|| {
        (
            genome_from_json(&root["champion"]["genome"]),
            root["champion"]["fitness"].as_f64().unwrap_or(0.0),
        )
    });

    Ok(Checkpoint {
        population,
        innovations,
        threshold: root["threshold"].as_f64().unwrap_or(f64::NAN),
        generations: root["generations"].as_u64().unwrap_or(0) as usize,
        champion,
    })
}

fn genome_from_json(value: &serde_json::Value) -> Genome {
    let mut strategies = [breeding_sim::economy::Strategy::default(); breeding_sim::economy::MAX_UNITS];
    if let Some(list) = value["strategies"].as_array() {
        for (unit, entry) in list.iter().take(strategies.len()).enumerate() {
            if let Some(bands) = entry["bands"].as_array() {
                for (gauge, band) in bands.iter().take(6).enumerate() {
                    strategies[unit].bands[gauge] = band.as_u64().unwrap_or(0) as usize;
                }
            }
            strategies[unit].level = entry["level"].as_u64().unwrap_or(0) as u16;
            strategies[unit].optimakina_from = entry["optimakina_from"].as_u64().unwrap_or(11) as u8;
        }
    }
    Genome {
        hidden: value["hidden"]
            .as_array()
            .map(|list| list.iter().filter_map(|v| v.as_u64().map(|n| n as usize)).collect())
            .unwrap_or_default(),
        connections: value["connections"]
            .as_array()
            .map(|list| {
                list.iter()
                    .map(|c| neat::Connection {
                        from: c["from"].as_u64().unwrap_or(0) as usize,
                        to: c["to"].as_u64().unwrap_or(0) as usize,
                        weight: c["weight"].as_f64().unwrap_or(0.0),
                        enabled: c["enabled"].as_bool().unwrap_or(false),
                        innovation: c["innovation"].as_u64().unwrap_or(0),
                    })
                    .collect()
            })
            .unwrap_or_default(),
        strategies,
    }
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
    println!(
        "Budget : {:.0} minutes. Départage : {VALIDATION_SEEDS:?}. Scellé {TEST_SEEDS:?} : {}\n",
        options.minutes,
        if options.sealed {
            "OUVERT — c'est la mesure finale, elle ne se rejoue pas"
        } else {
            "gardé fermé"
        }
    );

    let mut rng = Rng::new(options.seed);
    let mut innovations = Innovations::new();
    // Le seuil s'ajuste pour tenir le nombre d'espèces visé, et il se reprend
    // avec le reste : recommencer à 2,0 après huit heures de calibration ferait
    // exploser le nombre d'espèces à la première génération.
    let mut threshold = config.compatibility_threshold;
    let mut resumed_from = 0usize;
    let mut restored_champion: Option<(Genome, f64)> = None;
    let mut population: Vec<Genome> = match options.resume.as_deref().map(read_checkpoint) {
        Some(Ok(saved)) if !saved.population.is_empty() => {
            println!(
                "reprise : {} génomes, {} générations déjà cumulées",
                saved.population.len(),
                saved.generations
            );
            innovations = saved.innovations;
            if saved.threshold.is_finite() {
                threshold = saved.threshold;
            }
            resumed_from = saved.generations;
            if let Some((_, fitness)) = &saved.champion {
                println!("  champion repris : entraîné à {}", millions(*fitness));
            }
            restored_champion = saved.champion;
            // On complète si la population demandée est plus grande, on tronque
            // sinon : le fichier ne doit pas dicter la taille.
            let mut population = saved.population;
            while population.len() < config.population {
                let mut child = population[rng.range(population.len())].clone();
                child.mutate(&config, &mut innovations, &mut rng);
                population.push(child);
            }
            population.truncate(config.population);
            population
        }
        Some(Err(error)) => {
            eprintln!("{error}");
            std::process::exit(1);
        }
        _ => (0..config.population)
            .map(|_| Genome::minimal(&mut innovations, &mut rng))
            .collect(),
    };
    let mut species: Vec<Species> = Vec::new();

    let started = Instant::now();
    let budget = options.minutes * 60.0;
    let mut generation = 0usize;
    let mut champion: Option<(Genome, f64)> = restored_champion;
    // Le meilleur de chaque espèce à la dernière génération. C'est ce qu'on
    // vient chercher en spéciant : les stratégies **alternatives**, pas
    // seulement celle qui a gagné.
    // Chaque finaliste porte le numéro de son espèce : c'est ce qui permet de
    // comparer les stratégies **entre** espèces plutôt que de lister douze
    // quasi-clones du vainqueur.
    let mut survivors: Vec<(usize, Genome, f64)> = Vec::new();

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
            .enumerate()
            .flat_map(|(species_index, entry)| {
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
                    .map(|index| (species_index, population[index].clone(), scores[index]))
                    .collect::<Vec<_>>()
            })
            .collect();
        survivors.sort_by(|a, b| b.2.partial_cmp(&a.2).unwrap_or(std::cmp::Ordering::Equal));

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
    let mut finalists: Vec<(usize, Genome, f64)> = survivors.clone();
    if let Some((genome, score)) = champion.clone() {
        // Le champion historique n'appartient à aucune espèce courante : on le
        // marque à part plutôt que de le ranger de force dans l'une d'elles.
        finalists.push((usize::MAX, genome, score));
    }
    if finalists.is_empty() {
        println!("aucun candidat — l'entraînement n'a pas tourné");
        return;
    }

    let validation: Vec<u32> = VALIDATION_SEEDS.collect();
    let mut judged: Vec<(usize, f64)> = finalists
        .par_iter()
        .enumerate()
        .map(|(index, (_, genome, _))| {
            (
                index,
                fitness(&catalog, &economy, genome, &validation, options.iterations),
            )
        })
        .collect();
    judged.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

    // --- le meilleur de chaque espèce, réglages et comportement ------------
    //
    // C'est ce qu'on vient chercher en spéciant. La table de départage brute
    // liste souvent trois quasi-clones du vainqueur ; ici chaque ligne est une
    // espèce distincte, et elle porte ce que la stratégie **fait** et pas
    // seulement ce qu'elle vaut.
    let mut best_per_species: Vec<(usize, usize, f64)> = Vec::new();
    for &(index, score) in &judged {
        let species_of = finalists[index].0;
        if !best_per_species.iter().any(|&(s, _, _)| s == species_of) {
            best_per_species.push((species_of, index, score));
        }
    }

    println!(
        "\n--- le meilleur de chaque espèce ({} espèces) ---",
        best_per_species.len()
    );
    println!(
        "{:>7} {:>10} {:<13} {:<13} {:>5} {:>8} {:>8} {:>8} {:>7}",
        "espèce", "départage", "bloc", "libre", "opti", "crois.", "clones", "achats", "gen10"
    );
    println!("{}", "-".repeat(92));
    for &(species_of, index, score) in best_per_species.iter().take(12) {
        let genome = &finalists[index].1;
        let acts = behaviour(&catalog, &economy, genome, &validation[..40], options.iterations);
        let unit = |u: usize| {
            let strategy = genome.strategies[u];
            format!(
                "{}/{}",
                strategy
                    .bands
                    .iter()
                    .map(|band| band.to_string())
                    .collect::<String>(),
                strategy.level
            )
        };
        println!(
            "{:>7} {:>10} {:<13} {:<13} {:>5} {:>8.0} {:>8.0} {:>8.0} {:>7.1}",
            if species_of == usize::MAX {
                "hist.".to_string()
            } else {
                species_of.to_string()
            },
            millions(score),
            unit(0),
            unit(1),
            if genome.strategies[0].optimakina_from > 10 {
                "—".to_string()
            } else {
                genome.strategies[0].optimakina_from.to_string()
            },
            acts.crossings,
            acts.clonings,
            acts.purchases,
            acts.gen10
        );
    }
    println!("  (bandes Baffeur Caresseur Foudroyeur Dragofesse Abreuvoir Mangeoire / niveau)");
    println!("  (comportement moyenné sur 40 graines de départage)");

    println!(
        "\n--- départage complet sur {} graines dédiées ({VALIDATION_SEEDS:?}) ---",
        validation.len()
    );
    println!(
        "{:>4} {:>11} {:>11} {:<9} {:>7} {:>6} {:>9}",
        "rang", "entraîn.", "départage", "bandes", "niveau", "opti", "fournée"
    );
    for (rank, (index, score)) in judged.iter().take(12).enumerate() {
        let (_, genome, training) = &finalists[*index];
        let (cost, _) = economy.unit_load(0, genome.strategies[0]);
        let bands: Vec<String> = genome.strategies[0].bands.iter().map(|b| b.to_string()).collect();
        println!(
            "{:>4} {:>11} {:>11} {:<9} {:>7} {:>6} {:>9}",
            rank + 1,
            millions(*training),
            millions(*score),
            bands.join(""),
            genome.strategies[0].level,
            if genome.strategies[0].optimakina_from > 10 {
                "—".to_string()
            } else {
                genome.strategies[0].optimakina_from.to_string()
            },
            cost
        );
    }
    println!("  (bandes dans l'ordre Baffeur Caresseur Foudroyeur Dragofesse Abreuvoir Mangeoire)");

    let (winner, validated) = judged[0];
    let (_, best, training_score) = finalists[winner].clone();


    // --- les portes : départage toujours, scellé sur demande ----------------
    //
    // Le scellé était mesuré et imprimé à chaque manche. C'était l'inverse de son
    // rôle : un jeu réservé à la mesure finale qu'on relit toutes les heures
    // renseigne les manches suivantes, et il n'en reste plus de chiffre
    // indépendant à publier. Il est donc derrière `--sealed`.
    //
    // Le **départage** prend sa place comme baromètre de manche. C'est le bon
    // choix : ces cent graines ne sont ni apprises ni le juge final, et elles
    // servent déjà à choisir le vainqueur, donc les lire ne coûte rien de plus.
    //
    // Une nuance à garder en tête en les lisant : le vainqueur a été **choisi**
    // sur ce jeu, donc sa ligne y est optimiste. Le glouton et la valeur myope,
    // eux, n'y sont sélectionnés sur rien — leurs chiffres sont donc les mêmes
    // qu'ailleurs, et c'est l'écart qui reste lisible.
    let network = Network::compile(&best);
    let evaluate = |label: &str, scores: &mut Vec<f64>| -> f64 {
        let (p10, median, p90) = distribution(scores);
        println!(
            "{label:<28} p10 {:>9}  médiane {:>9}  p90 {:>9}",
            millions(p10),
            millions(median),
            millions(p90)
        );
        median
    };

    let gate = |title: &str, seeds: &[u32]| -> f64 {
        println!("\n--- {title} ({} parties) ---", seeds.len());

        let mut floor: Vec<f64> = seeds
            .iter()
            .map(|&seed| play(&catalog, &economy, &mut NeverBreeds, seed).score as f64)
            .collect();

        // Les **trois** objectifs du glouton, et c'est le meilleur qui sert de
        // porte. Se comparer à `gen10_balanced` seul reviendrait à se féliciter
        // d'avoir battu un adversaire handicapé : depuis que chaque couleur de
        // gen 10 a son prix, `profit` — qui classe sur la valeur — passe devant
        // lui de huit millions, parce qu'il vise les couleurs chères là où
        // l'autre prend n'importe quelle gen 10.
        let objectives = [
            ("glouton / profit", Objective::Profit),
            ("glouton / gen10_profit", Objective::Gen10Profit),
            ("glouton / gen10_balanced", Objective::Gen10Balanced),
        ];
        let mut greedy_runs: Vec<(&str, Vec<f64>)> = objectives
            .iter()
            .map(|&(label, objective)| {
                let scores: Vec<f64> = seeds
                    .par_iter()
                    .map(|&seed| {
                        play(&catalog, &economy, &mut Greedy::new(objective), seed).score as f64
                    })
                    .collect();
                (label, scores)
            })
            .collect();
        greedy_runs.sort_by(|a, b| {
            let median = |scores: &Vec<f64>| {
                let mut sorted = scores.clone();
                distribution(&mut sorted).1
            };
            median(&b.1)
                .partial_cmp(&median(&a.1))
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        let (greedy_label, mut greedy) = greedy_runs.remove(0);
        let mut myopic: Vec<f64> = seeds
            .par_iter()
            .map(|&seed| {
                let mut policy = Searching::with_iterations(Myopic, options.iterations);
                play(&catalog, &economy, &mut policy, seed).score as f64
            })
            .collect();
        let mut evolved: Vec<f64> = seeds
            .par_iter()
            .map(|&seed| {
                let mut policy = Searching::with_iterations(NetValue(&network), options.iterations)
                    .with_strategies(best.strategies);
                play(&catalog, &economy, &mut policy, seed).score as f64
            })
            .collect();

        evaluate("ne rien faire", &mut floor);
        let greedy_median = evaluate(&format!("{greedy_label} (la baseline)"), &mut greedy);
        for (label, scores) in &mut greedy_runs {
            evaluate(&format!("  {label}"), scores);
        }
        let myopic_median = evaluate("recherche / valeur myope", &mut myopic);
        let evolved_median = evaluate("recherche / valeur NEAT", &mut evolved);

        println!(
            "écart au glouton : {:+.2} M ({:+.0} %) · écart à la valeur myope : {:+.2} M ({:+.0} %)",
            (evolved_median - greedy_median) / 1e6,
            (evolved_median - greedy_median) / greedy_median * 100.0,
            (evolved_median - myopic_median) / 1e6,
            (evolved_median - myopic_median) / myopic_median * 100.0
        );
        evolved_median
    };

    println!(
        "\nchampion : entraîné à {}, topologie {:?}, {generation} générations",
        millions(training_score),
        best.size()
    );

    let validation_seeds: Vec<u32> = VALIDATION_SEEDS.collect();
    gate("départage", &validation_seeds);

    // `None` quand le jeu n'a pas été ouvert, et l'artefact doit le dire : un
    // champion sans mesure scellée n'est pas un champion mesuré à zéro.
    let sealed_median = if options.sealed {
        let test_seeds: Vec<u32> = TEST_SEEDS.collect();
        Some(gate("graines scellées", &test_seeds))
    } else {
        println!(
            "\ngraines scellées {TEST_SEEDS:?} : **non ouvertes**. `--sealed` pour la porte \
             finale — et une seule fois, sinon il n'en reste aucun chiffre indépendant."
        );
        None
    };

    for unit in 0..economy.unit_count() {
        let strategy = best.strategies[unit];
        let (cost, hours) = economy.unit_load(unit, strategy);
        let bands: Vec<String> = strategy.bands.iter().map(|b| b.to_string()).collect();
        println!(
            "  unité {unit} ({} enclos, {} croisements) : bandes {} · niveau {} ({:.1} %) ·              Optimakina {} · {cost} kamas, {hours:.2} h",
            economy.unit_enclos(unit),
            economy.unit_crossings(unit),
            bands.join(""),
            strategy.level,
            economy.success_rate(strategy.level, false) * 100.0,
            if strategy.optimakina_from > 10 {
                "jamais".to_string()
            } else {
                format!("dès la gen {}", strategy.optimakina_from)
            }
        );
    }

    // Tous les finalistes sur disque, pas seulement le vainqueur.
    //
    // La table ci-dessus ne montre que l'unité 0 et aucun comportement, alors
    // que c'est précisément la comparaison qu'on vient chercher en spéciant :
    // deux stratégies très différentes peuvent valoir presque autant, et le seul
    // champion efface cette information. Les garder permet de les rejouer.
    let finalists_json: Vec<serde_json::Value> = judged
        .iter()
        .map(|(index, validated)| {
            let (_, genome, training) = &finalists[*index];
            serde_json::json!({
                "hidden": genome.hidden,
                "connections": genome.connections.iter().map(|c| serde_json::json!({
                    "from": c.from, "to": c.to, "weight": c.weight,
                    "enabled": c.enabled, "innovation": c.innovation,
                })).collect::<Vec<_>>(),
                "strategies": genome.strategies.iter().map(|s| serde_json::json!({
                    "bands": s.bands.to_vec(),
                    "level": s.level,
                    "optimakina_from": s.optimakina_from,
                })).collect::<Vec<_>>(),
                "training_score": training,
                "validation_score": validated,
            })
        })
        .collect();
    if std::fs::write(
        "finalists.json",
        serde_json::to_string_pretty(&serde_json::json!(finalists_json)).unwrap_or_default(),
    )
    .is_ok()
    {
        println!("{} finalistes écrits dans finalists.json", finalists_json.len());
    }

    // La population entière, pour pouvoir reprendre. C'est ce qui manquait :
    // huit heures de recherche disparaissaient à chaque fin de run, et une
    // session courte lancée ensuite repartait de zéro plutôt que d'affiner.
    if std::fs::write(
        "checkpoint.json",
        serde_json::to_string(&{
            // Le registre d'innovations part en entier plutôt que d'être
            // reconstruit : rien dans un génome ne dit **quel lien** a été coupé
            // pour créer tel nœud, donc `splits` se perdrait et deux lignées
            // cesseraient de reconnaître la même mutation structurelle.
            let (next_innovation, next_node, links, splits) = innovations.snapshot();
            serde_json::json!({
                "population": population.iter().map(genome_json).collect::<Vec<_>>(),
                "innovations": {
                    "next_innovation": next_innovation,
                    "next_node": next_node,
                    "links": links,
                    "splits": splits,
                },
                "threshold": threshold,
                "generations": resumed_from + generation,
                // Le champion voyage avec le reste, sinon chaque reprise
                // recommence à le chercher et la ligne `hist.` du départage
                // devient « le meilleur de cette heure » au lieu de « le
                // meilleur depuis le début ».
                "champion": champion.as_ref().map(|(genome, fitness)| serde_json::json!({
                    "genome": genome_json(genome),
                    "fitness": fitness,
                })),
            })
        })
        .unwrap_or_default(),
    )
    .is_ok()
    {
        println!(
            "checkpoint : {} génomes, {} générations cumulées — reprendre avec --resume checkpoint.json",
            population.len(),
            resumed_from + generation
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
        "strategies": best.strategies.iter().map(|s| serde_json::json!({
            "bands": s.bands.to_vec(),
            "level": s.level,
            "optimakina_from": s.optimakina_from,
        })).collect::<Vec<_>>(),
        "training_score": training_score,
        "validation_score": validated,
        "test_median": sealed_median,
        "generations": generation,
    });
    if std::fs::write(path, serde_json::to_string_pretty(&json).unwrap_or_default()).is_ok() {
        println!("champion écrit dans {path}");
    }
}
