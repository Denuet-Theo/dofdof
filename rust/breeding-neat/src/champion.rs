//! Relire un génome écrit par l'entraînement.
//!
//! Trois binaires en ont besoin — `replay` pour mesurer, `plan` pour émettre
//! l'ordonnancement, et l'entraînement lui-même pour reprendre — et une
//! troisième copie de la même lecture aurait fini par diverger sur un champ.
//!
//! La lecture est **tolérante par le bas** : un fichier écrit avant que les
//! stratégies existent se relit avec le réglage neutre, ce qui rejoue
//! exactement les mesures d'alors au lieu de refuser de s'ouvrir.

use breeding_sim::economy::{MAX_UNITS, Strategy};
use serde_json::Value;

use crate::neat::{Connection, Genome};

/// Lit un génome depuis `champion.json`, ou depuis un `finalists.json` en
/// choisissant son rang (1 pour le premier).
pub fn load(path: &str, rank: usize) -> Result<Genome, String> {
    let json = std::fs::read_to_string(path).map_err(|e| format!("{path}: {e}"))?;
    let parsed: Value = serde_json::from_str(&json).map_err(|e| format!("{path}: {e}"))?;

    // `finalists.json` est un tableau ; `champion.json` un objet. Accepter les
    // deux permet de rejouer une stratégie alternative sans convertir le
    // fichier à la main.
    // L'arité, avant de reconstruire quoi que ce soit. Un génome numérote ses
    // nœuds depuis la couche d'entrée — le biais vaut `FEATURES`, la sortie
    // `FEATURES + 1` — donc un artefact d'une autre arité ne se lit pas de
    // travers : il se lit **sans rien dire**, et tous ses liens pointent à côté.
    if let Some(features) = parsed["features"].as_u64() {
        if features as usize != breeding_sim::encode::FEATURES {
            return Err(format!(
                "{path} : champion à {features} entrées, le simulateur en déclare {}. \
                 Il faut réentraîner — un génome n'est pas transposable d'un encodage \
                 à l'autre.",
                breeding_sim::encode::FEATURES
            ));
        }
    }

    let root = match parsed.as_array() {
        Some(list) => list
            .get(rank.saturating_sub(1))
            .cloned()
            .ok_or_else(|| format!("{path}: pas de finaliste au rang {rank}"))?,
        None => parsed,
    };

    from_value(&root).ok_or_else(|| format!("{path}: ce n'est pas un génome"))
}

/// Reconstruit un génome depuis sa forme JSON, ou `None` si les champs
/// structurels manquent.
pub fn from_value(root: &Value) -> Option<Genome> {
    let hidden = root["hidden"]
        .as_array()?
        .iter()
        .filter_map(|v| v.as_u64().map(|n| n as usize))
        .collect();
    let connections = root["connections"]
        .as_array()?
        .iter()
        .map(|c| Connection {
            from: c["from"].as_u64().unwrap_or(0) as usize,
            to: c["to"].as_u64().unwrap_or(0) as usize,
            weight: c["weight"].as_f64().unwrap_or(0.0),
            enabled: c["enabled"].as_bool().unwrap_or(false),
            innovation: c["innovation"].as_u64().unwrap_or(0),
        })
        .collect();

    Some(Genome {
        hidden,
        connections,
        strategies: strategies_from(root),
    })
}

/// Une stratégie par unité. Absentes d'un fichier écrit avant qu'elles
/// existent : on retombe alors sur le réglage neutre.
fn strategies_from(root: &Value) -> [Strategy; MAX_UNITS] {
    let mut strategies = [Strategy::default(); MAX_UNITS];
    if let Some(list) = root["strategies"].as_array() {
        for (unit, value) in list.iter().take(MAX_UNITS).enumerate() {
            if let Some(bands) = value["bands"].as_array() {
                for (gauge, band) in bands.iter().take(6).enumerate() {
                    strategies[unit].bands[gauge] = band.as_u64().unwrap_or(0) as usize;
                }
            }
            strategies[unit].level = value["level"].as_u64().unwrap_or(0) as u16;
            strategies[unit].optimakina_from = value["optimakina_from"].as_u64().unwrap_or(11) as u8;
        }
    }
    strategies
}
