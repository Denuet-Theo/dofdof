//! Fige des écuries **entières** et les 74 entrées qu'elles produisent.
//!
//! ```sh
//! cargo run --release -p breeding-neat --bin dump-census -- \
//!   ../scripts/fixtures/census-parity.json
//! ```
//!
//! `dump-network` verrouillait l'arithmétique du réseau ; celui-ci verrouille ce
//! qu'on lui donne à manger, et c'est la moitié risquée. Une entrée décalée d'un
//! cran, un `log1p` oublié, une normalisation prise sur la mauvaise référence, et
//! le réseau rend un nombre parfaitement plausible qui ne veut rien dire — rien
//! dans une compilation ne le dit, et aucun écran ne le montre.
//!
//! Les écuries viennent de `sample.rs`, donc avec ses goulots et ses porteuses de
//! raccourci : on veut que la référence couvre les cas qui font travailler
//! l'encodage — génération portée au-dessus de la couleur, recettes à moitié
//! tenues, fécondes mêlées aux fertiles — et pas seulement des écuries plates.
//!
//! Le marché est **tiré par cas** : les trois entrées de prix sont normalisées sur
//! le milieu de leur fourchette, donc un marché figé les laisserait toutes à 1 et
//! ne vérifierait rien de cette normalisation.

use breeding_sim::config::Prices;
use breeding_sim::economy::{Draws, Rng};
use breeding_sim::encode::Census;
use breeding_sim::sample::{SampleConfig, sample_stable};
use breeding_sim::stable::Sex;
use breeding_sim::trees::muldo;

const CASES: usize = 120;

fn main() {
    let target = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "../scripts/fixtures/census-parity.json".into());

    let catalog = muldo();
    let base = Prices::load_default()
        .map(|prices| prices.economy)
        .unwrap_or_else(|error| {
            eprintln!("{error}");
            std::process::exit(1);
        });
    let config = SampleConfig::default();

    let mut cases = Vec::with_capacity(CASES);
    for case in 0..CASES as u32 {
        let economy = base.for_run(&catalog, &Draws::new(case.wrapping_mul(2_246_822_519)));
        let stable = sample_stable(&catalog, &mut Rng::new(case.wrapping_mul(2_654_435_761)), &config);
        // Un solde qui varie d'un cas à l'autre : `KAMAS` est normalisé sur la
        // mise de départ, et le laisser constant ne vérifierait pas la division.
        let kamas = (case as i64 % 7) * 3_000_000;
        let census = Census::of(&catalog, &economy, &stable, kamas);

        let mounts: Vec<serde_json::Value> = stable
            .mounts
            .iter()
            .map(|mount| {
                serde_json::json!({
                    "color": catalog.slug(mount.color),
                    "sex": if mount.sex == Sex::Male { "M" } else { "F" },
                    "fertile": mount.fertile,
                    "cycled": mount.cycled,
                    "parents": mount.parents.map(|[a, b]| [catalog.slug(a), catalog.slug(b)]),
                })
            })
            .collect();

        cases.push(serde_json::json!({
            "kamas": kamas,
            // Tout ce que l'encodage réclame au marché, pour que le portage n'ait
            // rien à deviner de l'économie qui a produit ces entrées.
            "economy": {
                "startingKamas": economy.starting_kamas,
                "amberPerGeneration": economy.amber_per_generation,
                "amberRange": [economy.amber_range.0, economy.amber_range.1],
                "genetonValue": economy.geneton_value,
                "genetonRange": [economy.geneton_range.0, economy.geneton_range.1],
                "topValue": economy.top_value,
                "topValueRange": [economy.top_value_range.0, economy.top_value_range.1],
                // Le barème couleur par couleur : les gen 10 ne valent pas toutes
                // pareil, et la liquidation en dépend.
                "values": (0..catalog.len())
                    .map(|color| {
                        serde_json::json!([
                            catalog.slug(color as u16),
                            economy.value_of(&catalog, color as u16)
                        ])
                    })
                    .collect::<Vec<_>>(),
            },
            "mounts": mounts,
            "features": census.features(&catalog, &economy).to_vec(),
        }));
    }

    let document = serde_json::json!({ "features": breeding_sim::encode::FEATURES, "cases": cases });
    match std::fs::write(&target, serde_json::to_string(&document).unwrap_or_default()) {
        Ok(()) => println!("{CASES} écuries écrites dans {target}"),
        Err(error) => {
            eprintln!("{target} : {error}");
            std::process::exit(1);
        }
    }
}
