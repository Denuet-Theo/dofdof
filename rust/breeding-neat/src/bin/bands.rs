//! Ce qu'une répartition de bandes coûte en temps, et le niveau qu'elle offre.
//!
//! ```sh
//! ./target/release/bands 331111
//! ```
//!
//! ## Les deux étages de la réponse
//!
//! La durée d'une fournée n'est pas une propriété des bandes seules : la Mangeoire
//! occupe une des deux places de l'enclos, donc monter les montures **allonge** la
//! fournée dès que ses points dépassent ce que les autres jauges laissent passer.
//!
//! On donne donc les deux : le plancher — la durée à niveau nul, imposée par les
//! stats et la sérénité — puis le niveau que la Mangeoire livre **sans rien
//! coûter**, c'est-à-dire le plus haut qui tienne dans ce plancher. Au-delà, chaque
//! niveau se paie en heures, et la table le chiffre.
//!
//! `mount_xp_for_level` est `3,795 × niveau^2,329` : la courbe est très convexe,
//! donc le niveau gratuit est bien plus haut qu'on ne l'attend et les derniers
//! niveaux sont hors de prix.

use breeding_sim::config::Prices;
use breeding_sim::economy::{MAX_MOUNT_LEVEL, mount_xp_for_level};
use breeding_sim::schedule::{GAUGE_NAMES, schedule};

fn main() {
    let digits = std::env::args().nth(1).unwrap_or_else(|| "331111".into());
    let bands: Vec<usize> = digits
        .chars()
        .filter_map(|c| c.to_digit(10).map(|d| d as usize))
        .collect();
    if bands.len() != GAUGE_NAMES.len() {
        eprintln!(
            "il faut {} chiffres, dans l'ordre {}",
            GAUGE_NAMES.len(),
            GAUGE_NAMES.join(" ")
        );
        std::process::exit(1);
    }
    let mut fixed = [0usize; 6];
    fixed.copy_from_slice(&bands[..6]);

    // Jamais `Economy::default()` : les leviers y sont inertes.
    let economy = Prices::load_default()
        .map(|prices| prices.economy)
        .unwrap_or_else(|error| {
            eprintln!("{error}");
            std::process::exit(1);
        });

    println!("bandes {digits} —");
    for (name, band) in GAUGE_NAMES.iter().zip(fixed) {
        println!("  {name:<12} bande {band}");
    }

    let floor = schedule(&economy, fixed, 0.0);
    println!(
        "\nplancher (niveau 0) : {:.2} h · {:.0} kamas de carburant par enclos",
        floor.hours, floor.cost_per_enclos
    );

    // Le plus haut niveau qui n'allonge pas la fournée. Recherche linéaire : deux
    // cents essais d'arithmétique, ce n'est pas la peine de dichotomiser.
    let free = (1..=MAX_MOUNT_LEVEL)
        .take_while(|&level| {
            schedule(&economy, fixed, mount_xp_for_level(level)).hours <= floor.hours + 1e-9
        })
        .last()
        .unwrap_or(0);
    println!(
        "niveau offert       : {free} — la Mangeoire le livre dans le plancher, \
         sans une minute de plus"
    );
    println!(
        "  soit un taux de réussite de {:.1} %",
        economy.success_rate(free, false) * 100.0
    );

    println!("\n{:>7} {:>12} {:>10} {:>12} {:>10}", "niveau", "points", "heures", "kamas/encl.", "réussite");
    for level in [free, 60, 80, 100, 120, 150, 200] {
        if level == 0 {
            continue;
        }
        let plan = schedule(&economy, fixed, mount_xp_for_level(level));
        println!(
            "{level:>7} {:>12.0} {:>10.2} {:>12.0} {:>9.1} %",
            mount_xp_for_level(level),
            plan.hours,
            plan.cost_per_enclos,
            economy.success_rate(level, false) * 100.0
        );
    }
}
