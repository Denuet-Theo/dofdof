//! Fige ce que le réseau répond, pour que le portage TypeScript ait quelque chose
//! à contredire.
//!
//! ```sh
//! cargo run --release -p breeding-neat --bin dump-network -- champion-t2.json \
//!   ../src/lib/dofus/breeding/network-parity.json
//! ```
//!
//! Même raisonnement que `dump-parity-fixtures.ts` en sens inverse : là-bas c'est
//! le TypeScript qui fait foi sur la loi d'appariement, parce qu'elle est
//! **mesurée en jeu** et qu'il la porte depuis toujours. Ici c'est le Rust, parce
//! que les poids sortent de sa recherche.
//!
//! Ce qui compte est qu'il y ait une référence dans les deux sens : deux
//! implémentations d'une même règle divergent en silence, et rien dans une
//! compilation ne le dit.
//!
//! Les vecteurs sont tirés uniformément sur `[-3, 3]` plutôt que sur des valeurs
//! plausibles, et c'est délibéré : on vérifie l'arithmétique du réseau, pas son
//! comportement. Un désaccord doit sauter aux yeux même loin du domaine appris.

use breeding_neat::champion;
use breeding_neat::neat::{Network, Rng};
use breeding_sim::encode::FEATURES;

const CASES: usize = 500;

fn main() {
    let mut args = std::env::args().skip(1);
    let source = args.next().unwrap_or_else(|| "champion.json".into());
    let target = args
        .next()
        .unwrap_or_else(|| "../src/lib/dofus/breeding/network-parity.json".into());

    let genome = match champion::load(&source, 1) {
        Ok(genome) => genome,
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(1);
        }
    };
    let network = Network::compile(&genome);
    let mut rng = Rng::new(20_260_817);

    let mut cases = Vec::with_capacity(CASES);
    for _ in 0..CASES {
        let inputs: Vec<f64> = (0..FEATURES)
            .map(|_| (rng.f64() * 6.0) - 3.0)
            .collect();
        let mut fixed = [0.0f64; FEATURES];
        fixed.copy_from_slice(&inputs);
        cases.push(serde_json::json!({
            "inputs": inputs,
            "value": network.value(&fixed),
        }));
    }

    let document = serde_json::json!({
        "features": FEATURES,
        "source": source,
        "cases": cases,
    });
    match std::fs::write(
        &target,
        serde_json::to_string(&document).unwrap_or_default(),
    ) {
        Ok(()) => println!("{CASES} cas écrits dans {target}"),
        Err(error) => {
            eprintln!("{target} : {error}");
            std::process::exit(1);
        }
    }
}
