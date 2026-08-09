//! Ce que l'ordonnancement des jauges permet, exploré exhaustivement.
//!
//! 4^6 = 4 096 combinaisons de bandes, six jauges : assez petit pour chercher
//! l'optimum sans heuristique. Sert à savoir ce que la neuroévolution *devrait*
//! trouver, donc à juger si elle y arrive.

use breeding_sim::config::Prices;
use breeding_sim::economy::mount_xp_for_level;
use breeding_sim::schedule::{GAUGE_NAMES, GAUGES, schedule};

fn main() {
    let economy = Prices::load_default().expect("economy.toml").economy;
    let budget = economy.horizon_hours.unwrap_or(300.0);
    let overhead = economy.overhead_hours;
    let enclos = economy.sync_enclos as f64;

    println!("Budget {budget:.0} h, {:.0} min entre fournées, {enclos:.0} enclos.\n", overhead * 60.0);
    println!("--- bandes uniformes ---");
    println!("{:<8} {:>6} {:>9} {:>10} {:>9} {:>12}", "niveau", "bande", "durée", "fournées", "coût/f.", "coût total");
    for level in [23u16, 67, 120] {
        for band in 0..4 {
            let plan = schedule(&economy, [band; GAUGES], mount_xp_for_level(level));
            let hours = plan.hours + overhead;
            let batches = (budget / hours) as u32;
            let cost = plan.cost_per_enclos * enclos;
            println!(
                "{level:<8} {band:>6} {:>8.2}h {batches:>10} {:>9.0} {:>12.0}",
                hours, cost, cost * f64::from(batches)
            );
        }
    }

    // L'optimum, cherché à la main : ce que la bande par jauge autorise.
    println!("\n--- meilleure combinaison, par niveau ---");
    println!("{:<8} {:>8} {:>10} {:>9} {:>12}  bandes", "niveau", "durée", "fournées", "coût/f.", "coût total");
    for level in [1u16, 23, 40, 67, 100] {
        let xp = mount_xp_for_level(level);
        let mut best: Option<([usize; GAUGES], f64, u32, f64)> = None;
        for code in 0..4usize.pow(GAUGES as u32) {
            let mut bands = [0usize; GAUGES];
            let mut rest = code;
            for band in &mut bands {
                *band = rest % 4;
                rest /= 4;
            }
            let plan = schedule(&economy, bands, xp);
            let hours = plan.hours + overhead;
            let batches = (budget / hours) as u32;
            let total = plan.cost_per_enclos * enclos * f64::from(batches);
            // On cherche le plus de fournées possible, puis le moins cher à
            // nombre de fournées égal. C'est un critère grossier — le vrai
            // arbitrage se joue sur le score — mais il montre la frontière.
            let better = match best {
                None => true,
                Some((_, _, best_batches, best_total)) => {
                    batches > best_batches || (batches == best_batches && total < best_total)
                }
            };
            if better {
                best = Some((bands, hours, batches, plan.cost_per_enclos * enclos));
            }
        }
        let (bands, hours, batches, cost) = best.expect("au moins une combinaison");
        let names: Vec<String> = (0..GAUGES)
            .map(|g| format!("{}={}", &GAUGE_NAMES[g][..3], bands[g]))
            .collect();
        println!(
            "{level:<8} {hours:>7.2}h {batches:>10} {cost:>9.0} {:>12.0}  {}",
            cost * f64::from(batches),
            names.join(" ")
        );
    }
}
