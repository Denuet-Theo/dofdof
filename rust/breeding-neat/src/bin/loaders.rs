//! Faut-il **apprendre** à charger l'enclos, ou une règle suffit-elle ?
//!
//! ```sh
//! cargo run --release -p breeding-neat --bin loaders -- champion-t2.json
//! ```
//!
//! ## Ce que la mesure décide
//!
//! L'étape 2 remplace le tirage au hasard du tapis par un choix. Avant de lui
//! construire un réseau — des heures de recherche, une seconde population, un
//! décalage de distribution à gérer — il faut savoir si un choix appris bat une
//! règle écrite à la main. Trois bras, même environnement, même politique
//! d'appariement :
//!
//! | bras | ce qu'il représente |
//! | --- | --- |
//! | **au hasard** | l'absence de décision. Si rien ne le bat, l'étape 2 n'existe pas |
//! | **portée puis niveau** | la règle qu'on écrirait sans réfléchir bien longtemps |
//! | **valeur de l'étape 1** | interroger le champion déjà entraîné, sans en entraîner un second |
//!
//! L'appariement est **le même partout** — le champion de l'étape 1 — sinon on
//! mesurerait la politique d'appariement au lieu du chargement.
//!
//! ## Le soupçon
//!
//! `Census::cycle` ne retient d'une fécondation que `(génération, sexe)`. La
//! valeur ne peut donc pas distinguer une gen 1 capturée d'une gen 1 qui porte
//! `[Doré-Pourpre, Doré-Orchidée]` et vise la gen 3 — le motif le plus rentable du
//! jeu. Si « portée puis niveau » gagne, ce n'est pas que le réseau soit mauvais :
//! c'est que le vecteur d'entrée ne porte pas de quoi décider, et il faudra
//! l'étendre **avant** d'entraîner quoi que ce soit.

use breeding_neat::champion;
use breeding_neat::neat::Network;
use breeding_sim::config::Prices;
use breeding_sim::economy::Economy;
use breeding_sim::encode::Census;
use breeding_sim::loading::{Loader, RandomLoader, RankedLoader, ValueLoader};
use breeding_sim::search::{Searching, ValueFn};
use breeding_sim::trees::{Catalog, muldo};
use breeding_sim::treadmill::{TreadmillConfig, play_treadmill_with};
use rayon::prelude::*;

struct NetValue<'a>(&'a Network);

impl ValueFn for NetValue<'_> {
    fn value(&self, census: &Census, catalog: &Catalog, economy: &Economy) -> f64 {
        self.0.value(&census.features(catalog, economy))
    }
}

/// Les graines de départage. Jamais le jeu scellé : il ne sert qu'une fois, à la
/// fin, et une mesure de conception n'est pas cette fin.
const SEEDS: std::ops::Range<u32> = 800_000..800_060;

fn millions(value: f64) -> String {
    format!("{:.2} M", value / 1e6)
}

fn main() {
    let path = std::env::args().nth(1).unwrap_or_else(|| "champion.json".into());
    let genome = match champion::load(&path, 1) {
        Ok(genome) => genome,
        Err(error) => {
            eprintln!("{error}\nCette mesure a besoin du champion de l'étape 1.");
            std::process::exit(1);
        }
    };
    let catalog = muldo();
    let economy = Prices::load_default()
        .map(|prices| prices.economy)
        .unwrap_or_else(|error| {
            // Mesurer contre une économie autre que celle du fichier est pire que
            // ne pas mesurer : un run a déjà été invalidé pour ça.
            eprintln!("{error}");
            std::process::exit(1);
        });
    let network = Network::compile(&genome);
    let config = TreadmillConfig::default();

    println!(
        "Chargeurs comparés sur {} graines de départage, {} cycles, {} places, \
         appariement par le champion de l'étape 1 ({path}).\n",
        SEEDS.len(),
        config.cycles,
        config.places
    );
    println!(
        "{:<24} {:>10} {:>10} {:>9} {:>9} {:>10} {:>7}",
        "chargeur", "kamas", "génétons", "crois.", "clones", "gen10", "queue"
    );
    println!("{}", "-".repeat(84));

    // Les kamas graine par graine, pour comparer **par paires**. Les trois bras
    // voient exactement les mêmes graines, donc l'écart appuyé sur les paires est
    // bien plus puissant qu'une différence de moyennes : il élimine la variance du
    // tirage, qui domine tout le reste ici.
    let mut per_seed: Vec<Vec<f64>> = Vec::new();
    let mut reference: Option<f64> = None;
    for arm in 0..3 {
        let runs: Vec<_> = SEEDS
            .clone()
            .collect::<Vec<u32>>()
            .par_iter()
            .map(|&seed| {
                let mut policy = Searching::with_iterations(NetValue(&network), 800)
                    .with_strategies(genome.strategies);
                let value = NetValue(&network);
                let mut random = RandomLoader;
                let mut ranked = RankedLoader;
                let mut guided = ValueLoader { value: &value };
                let loader: &mut dyn Loader = match arm {
                    0 => &mut random,
                    1 => &mut ranked,
                    _ => &mut guided,
                };
                let name = loader.name().to_string();
                let outcome =
                    play_treadmill_with(&catalog, &economy, &mut policy, loader, seed, &config);
                (name, outcome)
            })
            .collect();

        let n = runs.len() as f64;
        let mean = |f: &dyn Fn(&breeding_sim::treadmill::TreadmillOutcome) -> f64| {
            runs.iter().map(|(_, o)| f(o)).sum::<f64>() / n
        };
        let slice = (config.cycles / 5).max(1);
        let head: f64 = runs
            .iter()
            .map(|(_, o)| o.per_cycle.iter().take(slice).sum::<i64>() as f64)
            .sum();
        let tail: f64 = runs
            .iter()
            .map(|(_, o)| o.per_cycle.iter().rev().take(slice).sum::<i64>() as f64)
            .sum();

        per_seed.push(runs.iter().map(|(_, o)| o.kamas).collect());
        let kamas = mean(&|o| o.kamas);
        let gap = match reference {
            None => {
                reference = Some(kamas);
                String::new()
            }
            Some(base) => format!("  {:+.0} % sur le hasard", (kamas - base) / base.abs() * 100.0),
        };
        println!(
            "{:<24} {:>10} {:>10.0} {:>9.0} {:>9.0} {:>10.1} {:>7.2}{gap}",
            runs[0].0,
            millions(kamas),
            mean(&|o| o.genetons as f64),
            mean(&|o| o.crossings as f64),
            mean(&|o| o.clonings as f64),
            mean(&|o| o.gen10_harvested as f64),
            if head > 0.0 { tail / head } else { 0.0 },
        );
    }

    // --- la comparaison appariée -------------------------------------------
    let names = ["au hasard", "portée puis niveau", "valeur de l'étape 1"];
    println!("\n--- par paires, contre « au hasard » ---");
    for arm in 1..3 {
        let diffs: Vec<f64> = per_seed[arm]
            .iter()
            .zip(&per_seed[0])
            .map(|(a, b)| a - b)
            .collect();
        let wins = diffs.iter().filter(|d| **d > 0.0).count();
        let n = diffs.len() as f64;
        let mean = diffs.iter().sum::<f64>() / n;
        let variance = diffs.iter().map(|d| (d - mean).powi(2)).sum::<f64>() / (n - 1.0);
        // Student apparié. Au-delà de 2 en valeur absolue, l'écart n'est
        // raisonnablement plus le tirage ; en deçà, on ne conclut pas.
        let t = mean / (variance.sqrt() / n.sqrt());
        println!(
            "{:<24} gagne sur {wins}/{} graines · écart moyen {:>8} · t = {t:+.2}{}",
            names[arm],
            diffs.len(),
            millions(mean),
            if t.abs() >= 2.0 { "" } else { "  (dans le bruit)" }
        );
    }

    println!(
        "\nSi « portée puis niveau » bat « valeur de l'étape 1 », le réseau n'est pas en cause :\n\
         le recensement ne retient d'une fécondation que (génération, sexe), donc la valeur ne\n\
         voit pas l'ascendance — et c'est elle qui décide de ce qu'un croisement vise."
    );
}
