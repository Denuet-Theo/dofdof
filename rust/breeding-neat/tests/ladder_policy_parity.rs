//! Le Rust rejoue-t-il la référence de fournée qui est **commitée** ?
//!
//! ## Pourquoi ce test existe
//!
//! `scripts/fixtures/ladder-policy-parity.json` était une **sortie** du Rust :
//! `npm run parity` la régénérait, `check-ladder-policy.mjs` y comparait le
//! TypeScript. Le Rust, lui, n'était comparé à rien — modifier `ladder.rs`
//! réécrivait simplement la référence, et la garde restait verte en ayant changé
//! d'avis sur ce qu'elle garde.
//!
//! Ce test ferme la boucle : la référence devient un contrat, et les deux ports
//! doivent s'y tenir. C'est aussi ce qui rend `cargo mutants` lisible sur
//! `ladder.rs` — un mutant qui survit désigne une ligne que les quarante écuries
//! n'exercent pas.
//!
//! ## Ce qu'il ne prouve pas
//!
//! Que les deux ports sont d'accord : ça, c'est le script Node. Ici on vérifie
//! seulement que le Rust n'a pas bougé sous la référence sans qu'on le dise.

use breeding_neat::parity::all_cases;
use breeding_sim::stable::Sex;
use serde_json::Value;

/// Où trouver la référence.
///
/// `CARGO_MANIFEST_DIR` est figé à la compilation : un crate rebâti ailleurs —
/// ce que fait `cargo mutants` dans sa copie — cherche `scripts/` à côté de la
/// copie, où il n'y a rien. `DOFDOF_FIXTURES` donne le dossier en absolu, comme
/// `DOFDOF_TREES` le fait pour le catalogue. Sans les deux variables, muter
/// devait se faire sur la vraie arborescence, ce qui y a déjà laissé une
/// mutation après une interruption.
fn reference() -> Value {
    let path = match std::env::var_os("DOFDOF_FIXTURES") {
        Some(dir) => std::path::PathBuf::from(dir).join("ladder-policy-parity.json"),
        None => std::path::PathBuf::from(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../scripts/fixtures"
        ))
        .join("ladder-policy-parity.json"),
    };
    let json = std::fs::read_to_string(&path).unwrap_or_else(|error| {
        panic!("{} : {error} — lancer `npm run parity` pour l'écrire", path.display());
    });
    serde_json::from_str(&json).expect("la référence est du JSON")
}

fn pairs(value: &Value) -> Vec<[usize; 2]> {
    value
        .as_array()
        .expect("une liste de couples")
        .iter()
        .map(|pair| {
            let pair = pair.as_array().expect("un couple");
            [
                pair[0].as_u64().expect("un indice") as usize,
                pair[1].as_u64().expect("un indice") as usize,
            ]
        })
        .collect()
}

fn indices(value: &Value) -> Vec<usize> {
    value
        .as_array()
        .expect("une liste d'indices")
        .iter()
        .map(|index| index.as_u64().expect("un indice") as usize)
        .collect()
}

#[test]
fn le_rust_rejoue_la_reference_commitee() {
    let families = all_cases();
    let document = reference();
    let recorded = document["cases"].as_array().expect("des cas");

    let total: usize = families.iter().map(|(_, _, cases)| cases.len()).sum();
    assert_eq!(
        total,
        recorded.len(),
        "la référence porte {} cas, le générateur en produit {total}",
        recorded.len(),
    );

    let flat: Vec<(&breeding_sim::trees::Catalog, &breeding_neat::parity::Case)> = families
        .iter()
        .flat_map(|(_, catalog, cases)| cases.iter().map(move |case| (catalog, case)))
        .collect();

    for (index, ((catalog, case), expected)) in flat.iter().zip(recorded).enumerate() {
        let plan = &expected["plan"];
        assert_eq!(
            case.harvest_stocked,
            expected["harvestStocked"].as_bool().expect("un drapeau"),
            "cas {index} : les cas ne sont pas dans le même ordre"
        );
        assert_eq!(
            case.family,
            expected["family"].as_str().expect("une famille"),
            "cas {index} : les cas ne sont pas dans le même ordre"
        );
        assert_eq!(
            case.clone_top,
            expected["cloneTop"].as_bool().expect("un drapeau"),
            "cas {index} : les cas ne sont pas dans le même ordre"
        );

        let purchases: Vec<(String, String)> = case
            .plan
            .purchases
            .iter()
            .map(|&(color, sex)| {
                (
                    catalog.slug(color).to_string(),
                    if sex == Sex::Male { "M" } else { "F" }.to_string(),
                )
            })
            .collect();
        let expected_purchases: Vec<(String, String)> = plan["purchases"]
            .as_array()
            .expect("des achats")
            .iter()
            .map(|bought| {
                let bought = bought.as_array().expect("un achat");
                (
                    bought[0].as_str().expect("une couleur").to_string(),
                    bought[1].as_str().expect("un sexe").to_string(),
                )
            })
            .collect();
        assert_eq!(purchases, expected_purchases, "cas {index} : achats");

        assert_eq!(
            case.plan.crossings,
            pairs(&plan["crossings"]),
            "cas {index} : croisements"
        );
        assert_eq!(
            case.plan.clonings,
            pairs(&plan["clonings"]),
            "cas {index} : clonages"
        );
        assert_eq!(
            case.plan.sacrifices,
            indices(&plan["sacrifices"]),
            "cas {index} : extractions"
        );
    }
}
