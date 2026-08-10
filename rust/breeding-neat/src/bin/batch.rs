//! Ce qu'une fournée **produit**, selon le niveau des montures.
//!
//! ```sh
//! cargo run --release -p breeding-neat --bin batch -- champion-t2.json
//! ```
//!
//! ## Le seul chiffre que l'écran ne peut pas calculer seul
//!
//! Choisir ses bandes de jauge est un arbitrage entre ce qu'une fournée coûte et
//! ce qu'elle rapporte. L'app sait déjà chiffrer le coût — `bestFuelFor` balaie les
//! carburants aux prix du jour, et les prix changent tous les jours. Ce qu'elle ne
//! peut pas savoir, c'est ce qu'une fournée **rapporte**, parce que ça demande de
//! faire tourner la politique.
//!
//! D'où ce relevé, et ce qu'il a de particulier : il est en **unités physiques**.
//! Des génétons, des naissances, des gen 10 — jamais des kamas. Un chiffre en
//! kamas serait daté du marché qui l'a produit et périmerait au premier changement
//! de cours ; des génétons ne périment pas, et c'est l'app qui les prix.
//!
//! ## Pourquoi le niveau et pas les bandes
//!
//! Les bandes ne changent **pas** ce qu'une fournée produit : elles changent sa
//! durée et son prix. La biologie n'en dépend pas — le taux de réussite suit
//! `0,3 + 0,0015 × (niveau A + niveau B)`, donc seul le niveau entre.
//!
//! C'est ce qui rend la mesure bon marché. Une dizaine de niveaux suffisent, là où
//! balayer les 4 096 combinaisons de bandes en resimulant chacune demanderait des
//! heures — pour rien, puisque `schedule()` répond à cette moitié-là par
//! arithmétique. Voir `bin/gauges`, qui la tient déjà.

use breeding_neat::champion;
use breeding_neat::neat::Network;
use breeding_sim::config::Prices;
use breeding_sim::economy::{Economy, mount_xp_for_level};
use breeding_sim::encode::Census;
use breeding_sim::loading::RankedLoader;
use breeding_sim::schedule::{GAUGES, schedule};
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

/// Les graines de départage. Le scellé ne sert qu'une fois, à la fin.
const SEEDS: std::ops::Range<u32> = 800_000..800_040;

/// Les niveaux relevés. Assez serrés en bas, où la courbe du taux est raide.
const LEVELS: [u16; 8] = [1, 20, 40, 67, 100, 140, 170, 200];

fn main() {
    let path = std::env::args().nth(1).unwrap_or_else(|| "champion.json".into());
    let genome = match champion::load(&path, 1) {
        Ok(genome) => genome,
        Err(error) => {
            eprintln!("{error}\nCe relevé a besoin du champion de l'étape 1.");
            std::process::exit(1);
        }
    };
    let catalog = muldo();
    let economy = Prices::load_default()
        .map(|prices| prices.economy)
        .unwrap_or_else(|error| {
            eprintln!("{error}");
            std::process::exit(1);
        });
    let network = Network::compile(&genome);

    println!(
        "Production d'une fournée selon le niveau — {} graines, chargeur « portée puis niveau »,\n\
         appariement par le champion de l'étape 1 ({path}).\n\
         Unités physiques : l'app les prix elle-même, avec ses cours du jour.\n",
        SEEDS.len()
    );
    println!(
        "{:>7} {:>7} {:>12} {:>11} {:>11} {:>11}   {:>9} {:>10}",
        "niveau", "taux", "génétons/f.", "crois./f.", "naiss./f.", "gen10/f.", "durée b0", "durée b3"
    );
    println!("{}", "-".repeat(94));

    let mut rates: Vec<(u16, f64, [usize; GAUGES], f64)> = Vec::new();
    for level in LEVELS {
        let config = TreadmillConfig {
            // C'est **`level`** qu'il faut fixer, pas `promotion_levels` : le taux
            // suit la stratégie, parce que la Mangeoire monte la fournée entière.
            // Le champ `level` d'une monture n'entre dans l'appariement nulle part
            // — première version de ce relevé, courbe parfaitement plate.
            level,
            promotion_levels: (level, level),
            ..Default::default()
        };
        let runs: Vec<_> = SEEDS
            .clone()
            .collect::<Vec<u32>>()
            .par_iter()
            .map(|&seed| {
                let mut policy = Searching::with_iterations(NetValue(&network), 800)
                    .with_strategies(genome.strategies);
                let mut loader = RankedLoader;
                play_treadmill_with(&catalog, &economy, &mut policy, &mut loader, seed, &config)
            })
            .collect();

        let n = runs.len() as f64;
        let cycles = config.cycles as f64;
        let per_batch = |f: &dyn Fn(&breeding_sim::treadmill::TreadmillOutcome) -> f64| {
            runs.iter().map(|o| f(o)).sum::<f64>() / n / cycles
        };

        // L'autre moitié de l'arbitrage, pour situer : ce que la même fournée
        // **dure** aux deux extrêmes de bande. Le prix, lui, dépend des cours et
        // n'a donc rien à faire ici.
        let hours = |band: usize| {
            schedule(&economy, [band; GAUGES], mount_xp_for_level(level)).hours
        };

        // Et l'arbitrage complet, aux prix **du fichier**, pour donner un ordre de
        // grandeur. Balayage exhaustif des 4 096 combinaisons : c'est de
        // l'arithmétique, quelques millisecondes, aucune simulation. L'app refait
        // exactement ce calcul avec ses cours à elle, et le refait à chaque fois
        // qu'un cours bouge.
        let genetons = per_batch(&|o| o.genetons as f64);
        let tops = per_batch(&|o| o.gen10_harvested as f64);
        let revenue = genetons * economy.geneton_value + tops * economy.top_value as f64;
        let enclos = (config.places / economy.slots_per_enclos.max(1)) as f64;
        let mut best: Option<(f64, [usize; GAUGES], f64)> = None;
        for combo in 0..4usize.pow(GAUGES as u32) {
            let mut bands = [0usize; GAUGES];
            let mut rest = combo;
            for band in bands.iter_mut() {
                *band = rest % 4;
                rest /= 4;
            }
            let plan = schedule(&economy, bands, mount_xp_for_level(level));
            let duration = plan.hours + economy.overhead_hours;
            if duration <= 0.0 {
                continue;
            }
            let rate = (revenue - plan.cost_per_enclos * enclos) / duration;
            if best.is_none_or(|(top, _, _)| rate > top) {
                best = Some((rate, bands, duration));
            }
        }
        let (rate, bands, duration) = best.expect("au moins une combinaison");
        rates.push((level, rate, bands, duration));

        println!(
            "{level:>7} {:>6.1} % {:>12.1} {:>11.1} {:>11.1} {:>11.2}   {:>8.1}h {:>9.1}h",
            economy.success_rate(level, false) * 100.0,
            per_batch(&|o| o.genetons as f64),
            per_batch(&|o| o.crossings as f64),
            per_batch(&|o| o.births as f64),
            per_batch(&|o| o.gen10_harvested as f64),
            hours(0),
            hours(3),
        );
    }

    println!(
        "\n--- l'arbitrage complet, **aux prix du fichier** ---\n\
         Balayage exhaustif des 4 096 combinaisons de bandes : de l'arithmétique, pas une\n\
         simulation. L'app refait ce calcul avec ses cours, et le refait quand ils bougent."
    );
    println!(
        "{:>7} {:>14} {:>10} {:>28}",
        "niveau", "kamas/heure", "durée", "bandes (Baf Car Fou Dra Abr Man)"
    );
    println!("{}", "-".repeat(64));
    let top = rates
        .iter()
        .max_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal))
        .map(|(level, ..)| *level);
    for (level, rate, bands, duration) in &rates {
        println!(
            "{level:>7} {:>14} {:>9.1}h {:>28}{}",
            format!("{:.0}", rate),
            duration,
            bands.iter().map(|b| b.to_string()).collect::<Vec<_>>().join(" "),
            if Some(*level) == top { "   ← optimum" } else { "" }
        );
    }
}
