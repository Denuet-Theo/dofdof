//! Fige la durée et le coût des **4 096 répartitions de bandes**, à plusieurs
//! niveaux, pour verrouiller le portage de `schedule.rs`.
//!
//! ```sh
//! cargo run --release -p breeding-neat --bin dump-schedule -- \
//!   ../scripts/fixtures/schedule-parity.json
//! ```
//!
//! Cinquième référence du portage, et la seule qui ne dépende d'aucun champion :
//! c'est de l'ordonnancement pur. Elle est donc aussi la plus exhaustive — tout le
//! domaine y passe, pas un échantillon.
//!
//! Les cadences et les prix par jauge voyagent avec, pour que le portage n'ait rien
//! à deviner de l'économie qui a produit ces durées.

use breeding_sim::config::Prices;
use breeding_sim::economy::mount_xp_for_level;
use breeding_sim::schedule::{GAUGES, schedule, slots};

const LEVELS: [u16; 5] = [0, 26, 42, 60, 120];

fn main() {
    let target = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "../scripts/fixtures/schedule-parity.json".into());

    let economy = Prices::load_default()
        .map(|prices| prices.economy)
        .unwrap_or_else(|error| {
            eprintln!("{error}");
            std::process::exit(1);
        });

    let mut cases = Vec::with_capacity(4096 * LEVELS.len());
    for code in 0..4096u32 {
        let mut bands = [0usize; GAUGES];
        let mut rest = code;
        for slot in bands.iter_mut() {
            *slot = (rest % 4) as usize;
            rest /= 4;
        }
        for level in LEVELS {
            let xp = mount_xp_for_level(level);
            let plan = schedule(&economy, bands, xp);
            // Les créneaux du seul premier niveau et d'un niveau chargé : les
            // figer tous ferait un fichier de vingt mégaoctets pour redire la même
            // mécanique.
            let placed = if level == 0 || level == 60 {
                slots(&economy, bands, xp)
                    .iter()
                    .map(|slot| {
                        serde_json::json!([slot.gauge, slot.points, slot.start, slot.end])
                    })
                    .collect::<Vec<_>>()
            } else {
                Vec::new()
            };
            cases.push(serde_json::json!({
                "bands": bands.to_vec(),
                "level": level,
                "hours": plan.hours,
                "costPerEnclos": plan.cost_per_enclos,
                "climber": plan.climber,
                "slots": placed,
            }));
        }
    }

    let document = serde_json::json!({
        "bandRates": (0..4).map(|band| economy.band_rate(band)).collect::<Vec<_>>(),
        "gaugePrices": (0..GAUGES)
            .map(|gauge| (0..4).map(|band| economy.gauge_price(gauge, band)).collect::<Vec<_>>())
            .collect::<Vec<_>>(),
        "cases": cases,
    });
    match std::fs::write(&target, serde_json::to_string(&document).unwrap_or_default()) {
        Ok(()) => println!("{} ordonnancements écrits dans {target}", cases.len()),
        Err(error) => {
            eprintln!("{target} : {error}");
            std::process::exit(1);
        }
    }
}
