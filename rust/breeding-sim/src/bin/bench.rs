//! La porte de l'étape 1 : le nombre à battre, et ce qu'une partie coûte.
//!
//! ```sh
//! cargo run --release -p breeding-sim --bin bench
//! ```
//!
//! Publie, sur les mêmes graines pour toutes les politiques :
//!
//! - le **plancher** « ne rien faire », qui garde le capital et liquide le pool.
//!   Toute politique qui ne le bat pas détruit de la valeur ;
//! - le **glouton**, la politique actuelle, sur ses trois objectifs ;
//! - le **temps CPU par partie**, qui dimensionne l'étape 3.
//!
//! Une médiane seule mentirait : quand un tirage peut raccourcir la route de
//! plusieurs générations, la dispersion *est* l'information. D'où les déciles.

use std::time::Instant;

use breeding_sim::baseline::{Greedy, Objective};
use breeding_sim::config::Prices;
use breeding_sim::economy::{Economy, NeverBreeds, Policy, RunOutcome, play};
use breeding_sim::search::{Myopic, Searching};
use breeding_sim::trees::muldo;

const SEEDS: u32 = 200;

struct Distribution {
    median: f64,
    p10: f64,
    p90: f64,
    mean: f64,
}

fn distribution(values: &mut [f64]) -> Distribution {
    values.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let at = |q: f64| {
        let index = ((values.len() - 1) as f64 * q).round() as usize;
        values[index]
    };
    Distribution {
        median: at(0.5),
        p10: at(0.1),
        p90: at(0.9),
        mean: values.iter().sum::<f64>() / values.len() as f64,
    }
}

fn millions(kamas: f64) -> String {
    format!("{:>8.2} M", kamas / 1_000_000.0)
}

struct Report {
    name: String,
    outcomes: Vec<RunOutcome>,
    seconds_per_run: f64,
}

fn measure(name: &str, economy: &Economy, mut make: impl FnMut() -> Box<dyn Policy>) -> Report {
    let catalog = muldo();
    let economy = *economy;

    let start = Instant::now();
    let outcomes: Vec<RunOutcome> = (0..SEEDS)
        .map(|seed| {
            let mut policy = make();
            play(&catalog, &economy, policy.as_mut(), seed)
        })
        .collect();
    let elapsed = start.elapsed().as_secs_f64();

    Report {
        name: name.to_string(),
        outcomes,
        seconds_per_run: elapsed / f64::from(SEEDS),
    }
}

fn main() {
    // Les prix viennent de `rust/economy.toml`, pas du code : ils bougent, et
    // une mesure ne vaut que si on peut la refaire avec ceux du jour.
    let prices = match Prices::load_default() {
        Ok(prices) => prices,
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(1);
        }
    };
    let economy = prices.economy;

    println!(
        "Économie ({}) : {} M de départ, {} h de jeu, chargements à ~{} kamas, {} croisements de parc,",
        Prices::default_path().display(),
        economy.starting_kamas / 1_000_000,
        economy.horizon_hours.unwrap_or(0.0),
        economy.batch_cost,
        economy.total_crossings()
    );
    println!(
        "  pool de {} muldos gen {} à {}, gen 1 à {}, ambre à {}/rang, gen 10 à {}.",
        economy.starting_pool,
        economy.pool_generations.0,
        economy.pool_generations.1,
        economy.starter_price,
        economy.amber_per_generation,
        economy.top_value
    );
    println!("  {SEEDS} graines, identiques pour toutes les politiques.\n");

    // Un chiffre publié sur une économie incomplète doit le dire lui-même.
    if let Some(gaps) = prices.report_gaps() {
        println!("⚠ {gaps}\n");
    }

    let reports = vec![
        measure("ne-rien-faire", &economy, || Box::new(NeverBreeds)),
        measure("glouton / gen10_balanced", &economy, || {
            Box::new(Greedy::new(Objective::Gen10Balanced))
        }),
        measure("glouton / gen10_profit", &economy, || {
            Box::new(Greedy::new(Objective::Gen10Profit))
        }),
        measure("glouton / profit", &economy, || {
            Box::new(Greedy::new(Objective::Profit))
        }),
        measure("recherche / valeur myope", &economy, || {
            Box::new(Searching::new(Myopic))
        }),
    ];

    println!(
        "{:<26} {:>11} {:>11} {:>11} {:>11}",
        "politique", "p10", "médiane", "p90", "moyenne"
    );
    println!("{}", "-".repeat(74));
    for report in &reports {
        let mut scores: Vec<f64> = report.outcomes.iter().map(|o| o.score as f64).collect();
        let d = distribution(&mut scores);
        println!(
            "{:<26} {:>11} {:>11} {:>11} {:>11}",
            report.name,
            millions(d.p10),
            millions(d.median),
            millions(d.p90),
            millions(d.mean)
        );
    }

    println!("\n{:<26} {:>9} {:>9} {:>9} {:>9} {:>9} {:>10}",
        "politique", "crois.", "fournées", "gen max", "gen10", "sacrif.", "µs/partie");
    println!("{}", "-".repeat(84));
    for report in &reports {
        let mean = |f: fn(&RunOutcome) -> f64| -> f64 {
            report.outcomes.iter().map(f).sum::<f64>() / report.outcomes.len() as f64
        };
        let infeasible: u32 = report.outcomes.iter().map(|o| o.rejected_loads).sum();
        println!(
            "{:<26} {:>9.0} {:>9.0} {:>9.2} {:>9.2} {:>9.0} {:>10.0}",
            report.name,
            mean(|o| o.crossings as f64),
            mean(|o| f64::from(o.loads_paid)),
            mean(|o| f64::from(o.best_generation)),
            mean(|o| o.gen10_held as f64),
            mean(|o| o.sacrifices as f64),
            report.seconds_per_run * 1e6,
        );
        if infeasible > 0 {
            println!(
                "  ⚠ {infeasible} fournées refusées au total — la politique propose des plans \
                 que le moteur écarte, donc elle est mesurée sur des tours perdus."
            );
        }
    }

    // Le plancher est la seule comparaison qui ait un sens absolu.
    let floor = {
        let mut scores: Vec<f64> = reports[0].outcomes.iter().map(|o| o.score as f64).collect();
        distribution(&mut scores).median
    };
    println!("\nÉcart à « ne rien faire » (médiane) :");
    for report in reports.iter().skip(1) {
        let mut scores: Vec<f64> = report.outcomes.iter().map(|o| o.score as f64).collect();
        let median = distribution(&mut scores).median;
        println!(
            "  {:<26} {:+10.2} M  ({:+.0} %)",
            report.name,
            (median - floor) / 1_000_000.0,
            (median - floor) / floor * 100.0
        );
    }
}
