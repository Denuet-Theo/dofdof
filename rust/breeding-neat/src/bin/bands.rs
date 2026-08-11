//! Ce qu'une répartition de bandes coûte en temps, et le niveau qu'elle offre.
//!
//! ```sh
//! ./target/release/bands 331111        # plancher et niveau offert
//! ./target/release/bands 331111 60     # et la frise à un niveau choisi
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
//!
//! ## La frise
//!
//! Une durée totale dit combien on attend ; elle ne dit pas **pourquoi**. La frise
//! montre les deux places de l'enclos et ce qui les occupe : où sont les trous, qui
//! bloque qui, et à quel moment la Mangeoire cesse de tenir dans les creux pour
//! devenir elle-même le chemin critique.
//!
//! C'est l'ordonnancement que `slots` calculait déjà et que ce binaire jetait.
//!
//! Deux tâches se lisent d'un coup dans la frise et sont invisibles dans un total :
//! la sérénité est **coupée en deux** — une montée puis une descente, sur deux
//! jauges différentes — parce qu'une jauge hors de sa fenêtre s'arrête net au lieu
//! de ralentir ; et l'Abreuvoir ne peut démarrer qu'une fois la sérénité
//! redescendue dans sa fenêtre, ce qui explique le trou du milieu.

use breeding_sim::config::Prices;
use breeding_sim::economy::{MAX_MOUNT_LEVEL, mount_xp_for_level};
use breeding_sim::schedule::{GAUGE_NAMES, PARALLEL_SLOTS, Slot, schedule, slots};

/// La frise : **une ligne par jauge**, le temps en abscisse.
///
/// Une ligne par jauge et non par tâche, parce que c'est la jauge qu'on manipule :
/// la sérénité descend en deux fois, mais c'est le même Caresseur qu'on va
/// recharger. Deux lignes pour lui donnaient à lire deux jauges là où il n'y en a
/// qu'une.
///
/// Les créneaux viennent maintenant de l'ordonnanceur tranche par tranche, donc
/// une jauge qui s'interrompt montre ses **vrais trous** au lieu d'un bloc plein
/// assorti d'un avertissement. C'est ce que le partage de capacité rend visible :
/// deux jauges qui se relaient dessinent deux pointillés en alternance, et ce
/// dessin-là est la consigne.
fn frieze(
    placed: &[Slot],
    hours: f64,
    title: &str,
    economy: &breeding_sim::economy::Economy,
    bands: [usize; 6],
) {
    if placed.is_empty() || hours <= 0.0 {
        return;
    }
    const WIDTH: usize = 54;
    let total = hours * 3600.0;

    // Regroupées par jauge, dans l'ordre où elles entrent en scène.
    let mut order: Vec<usize> = Vec::new();
    for slot in placed {
        if !order.contains(&slot.gauge) {
            order.push(slot.gauge);
        }
    }

    println!("\n  {title} — {hours:.2} h sur {PARALLEL_SLOTS} places");
    for gauge in order {
        let mine: Vec<&Slot> = placed.iter().filter(|slot| slot.gauge == gauge).collect();
        // Une case est pleine dès qu'un créneau la recouvre à moitié : à
        // cinquante-quatre colonnes pour dix heures, une case vaut onze minutes, et
        // exiger le recouvrement entier effacerait les tranches courtes.
        let bar: String = (0..WIDTH)
            .map(|column| {
                let from = column as f64 / WIDTH as f64 * total;
                let to = (column + 1) as f64 / WIDTH as f64 * total;
                let covered: f64 = mine
                    .iter()
                    .map(|slot| (slot.end.min(to) - slot.start.max(from)).max(0.0))
                    .sum();
                if covered >= (to - from) * 0.5 { '█' } else { '·' }
            })
            .collect();
        let rate = economy.band_rate(bands[gauge]);
        let worked: f64 = if rate > 0.0 {
            mine.iter().map(|slot| slot.points).sum::<f64>() / rate
        } else {
            0.0
        };
        let points: f64 = mine.iter().map(|slot| slot.points).sum();
        let span = mine.last().map(|slot| slot.end).unwrap_or(0.0)
            - mine.first().map(|slot| slot.start).unwrap_or(0.0);
        // La colonne dit ce que la barre montre : le temps que la jauge occupe. Le
        // temps de **travail** n'apparaît que quand il diffère — une jauge qui
        // partage sa place avance à vitesse réduite, donc elle occupe plus
        // longtemps qu'elle ne travaille, et confondre les deux ferait croire à un
        // besoin de points plus gros qu'il n'est.
        let net = if span > worked + 60.0 {
            format!("  dont {:.2} h de travail", worked / 3600.0)
        } else {
            String::new()
        };
        println!(
            "  {:<11} {bar} {:>5.2} h  {:>7.0} pts{net}",
            GAUGE_NAMES[gauge],
            span / 3600.0,
            points
        );
    }

    let axis: String = (0..WIDTH)
        .map(|column| if column % 9 == 0 { '┬' } else { '─' })
        .collect();
    println!("  {:<11} {axis}", "");
    let marks: String = (0..=WIDTH / 9)
        .map(|tick| format!("{:<9.1}", hours * (tick * 9) as f64 / WIDTH as f64))
        .collect();
    println!("  {:<11} {marks} (h)", "");
}

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

    frieze(&slots(&economy, fixed, 0.0), floor.hours, "au plancher, niveau 0", &economy, fixed);
    let offered = slots(&economy, fixed, mount_xp_for_level(free));
    let offered_hours = schedule(&economy, fixed, mount_xp_for_level(free)).hours;
    frieze(&offered, offered_hours, &format!("au niveau offert, {free}"), &economy, fixed);

    // Une frise à la demande, pour voir la Mangeoire cesser de tenir dans les
    // creux et devenir elle-même le chemin critique. C'est ce que la colonne
    // « heures » du tableau chiffre sans le montrer.
    if let Some(level) = std::env::args().nth(2).and_then(|arg| arg.parse::<u16>().ok()) {
        let xp = mount_xp_for_level(level);
        frieze(
            &slots(&economy, fixed, xp),
            schedule(&economy, fixed, xp).hours,
            &format!("au niveau demandé, {level}"),
            &economy,
            fixed,
        );
    }

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
