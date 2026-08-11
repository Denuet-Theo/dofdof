//! La durée de fournée des 4 096 répartitions de bandes, à quatre niveaux.
//!
//! ```sh
//! ./target/release/sweep-schedule > avant.txt
//! # … modifier `schedule.rs` ou `economy.toml` …
//! ./target/release/sweep-schedule > apres.txt
//! diff <(cut -d' ' -f2- avant.txt) <(cut -d' ' -f2- apres.txt)
//! ```
//!
//! Un ordonnanceur se juge sur l'ensemble de son domaine, pas sur l'exemple qui a
//! motivé le changement. C'est ce balayage qui a montré qu'une première version
//! préemptive raccourcissait 2 193 fournées **et en allongeait 512** — une
//! amélioration qui n'en était pas une, et que le cas d'école ne pouvait pas
//! révéler.
//!
//! Pure arithmétique, aucune simulation : il tourne en une seconde et ne dérange
//! pas un entraînement en cours.
use breeding_sim::config::Prices;
use breeding_sim::economy::mount_xp_for_level;
use breeding_sim::schedule::schedule;
fn main() {
    let economy = Prices::load_default().map(|p| p.economy).unwrap();
    for code in 0..4096u32 {
        let mut bands = [0usize; 6];
        let mut rest = code;
        for slot in bands.iter_mut() {
            *slot = (rest % 4) as usize;
            rest /= 4;
        }
        let mut line = format!("{code}");
        for level in [0u16, 42, 60, 100] {
            let plan = schedule(&economy, bands, mount_xp_for_level(level));
            line.push_str(&format!(" {:.6}", plan.hours));
        }
        println!("{line}");
    }
}
