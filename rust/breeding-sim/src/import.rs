//! L'écurie **réelle** de l'éleveur, lue depuis un export NDJSON de la base.
//!
//! ## Pourquoi ça existe
//!
//! Toutes les mesures publiées partent de `starting_stable` : cent gen 1
//! anonymes, niveau uniforme, sans généalogie. Un parc réel ne ressemble pas à
//! ça — il porte des gen 10 déjà obtenues, des niveaux hétérogènes, et une
//! ascendance complète qui décide de ce que chaque couple vise. Les deux régimes
//! ne classent pas forcément les politiques dans le même ordre, et rien ne
//! permettait de le vérifier.
//!
//! ## Ce que le fichier doit contenir
//!
//! Une ligne JSON par enregistrement, celles qui portent
//! `"t": "public.user_breeding_individuals"` étant les seules lues. La
//! généalogie est prise sur `parent_a_color` / `parent_b_color` : le simulateur
//! ne connaît que des **couleurs** d'ascendants, pas leurs identités.
//!
//! ## L'ordre des lignes compte
//!
//! Deux écuries identiques rangées différemment ne rendent pas le même plan :
//! l'échelle départage ses égalités par l'indice. L'ordre du fichier est donc
//! conservé tel quel, et c'est celui de l'export — pas nécessairement celui que
//! l'écran voit, qui passe par un `ORDER BY`.

use crate::stable::{Mount, Sex, Stable};
use crate::trees::Catalog;

/// Lit l'écurie d'une famille depuis un export NDJSON.
///
/// Les montures d'une autre famille sont ignorées, celles dont la couleur est
/// inconnue du catalogue aussi — mais leur nombre est rendu, parce qu'une écurie
/// silencieusement tronquée se lirait comme une écurie pauvre.
pub struct Imported {
    pub stable: Stable,
    /// Lignes de la bonne famille dont la couleur n'est pas au catalogue.
    pub unknown: usize,
    /// Montures des autres familles, ignorées.
    pub other_families: usize,
}

pub fn from_export(json: &str, family: &str, catalog: &Catalog) -> Result<Imported, String> {
    let mut stable = Stable::new();
    let mut unknown = 0;
    let mut other_families = 0;

    for (at, line) in json.lines().enumerate() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let row: serde_json::Value = serde_json::from_str(line)
            .map_err(|error| format!("ligne {} : {error}", at + 1))?;
        if row["t"].as_str() != Some("public.user_breeding_individuals") {
            continue;
        }
        let record = &row["r"];
        if record["family"].as_str() != Some(family) {
            other_families += 1;
            continue;
        }
        let Some(color) = record["color_id"].as_str().and_then(|slug| catalog.id_of(slug)) else {
            unknown += 1;
            continue;
        };
        let parents = match (
            record["parent_a_color"].as_str().and_then(|s| catalog.id_of(s)),
            record["parent_b_color"].as_str().and_then(|s| catalog.id_of(s)),
        ) {
            (Some(a), Some(b)) => Some([a, b]),
            // Une ascendance à moitié connue n'est pas une ascendance : le
            // simulateur lit toujours les deux cases ensemble.
            _ => None,
        };
        stable.push(Mount {
            color,
            sex: if record["sex"].as_str() == Some("M") {
                Sex::Male
            } else {
                Sex::Female
            },
            level: record["level"].as_u64().unwrap_or(1) as u16,
            fertile: record["fertile"].as_bool().unwrap_or(true),
            cycled: record["cycled"].as_bool().unwrap_or(false),
            parents,
        });
    }

    if stable.is_empty() {
        return Err(format!("aucune monture {family} dans l'export"));
    }
    Ok(Imported {
        stable,
        unknown,
        other_families,
    })
}
