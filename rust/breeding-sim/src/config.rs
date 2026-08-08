//! Les prix, lus depuis `rust/economy.toml` plutôt qu'écrits dans le code.
//!
//! Les prix de l'HDV bougent, et une mesure ne vaut que si on peut la refaire
//! avec les prix du jour. Les figer dans une constante Rust obligerait à
//! recompiler pour changer un chiffre, et surtout rendrait invisible le fait
//! qu'un résultat dépend d'un relevé daté.
//!
//! ## Ce qui manque se dit
//!
//! Les prix qu'on n'a pas valent `-1` dans le fichier. Ce module ne les remplace
//! **jamais** en silence : il les remonte dans `missing`, et l'appelant les
//! affiche. Un simulateur qui comble un trou par une valeur plausible produit
//! des chiffres qu'on finit par croire, et c'est exactement le travers que ce
//! chantier existe pour corriger.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use crate::economy::Economy;

/// Comment se compte l'horizon d'une partie.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Horizon {
    /// Un nombre de tours fixe, quelle que soit leur durée.
    Batches(u32),
    /// Un temps mural : une fournée rapide en laisse jouer d'autres.
    Hours(u32),
}

/// Une bande de jauge et ce qu'elle coûte.
///
/// Le débit dépend de la bande où on tient la jauge, et chaque bande exige un
/// carburant dont le plafond l'atteint. C'est le levier « temps ».
#[derive(Clone, Copy, Debug)]
pub struct FuelBand {
    pub cap: i64,
    pub points_per_second: f64,
    pub hours_per_batch: f64,
    /// `None` tant que le prix n'est pas relevé.
    pub price_per_point: Option<f64>,
}

#[derive(Clone, Debug)]
pub struct Prices {
    /// Le modèle simplifié, celui que le simulateur joue aujourd'hui.
    pub economy: Economy,
    pub horizon: Horizon,
    pub slots_per_enclos: usize,
    /// Prix d'une Optimakina par génération visée.
    pub optimakina: BTreeMap<u8, i64>,
    /// Ce qu'elle ajoute au taux, en points.
    pub optimakina_bonus: f64,
    /// Kamas par point d'XP de Mangeoire. `None` tant qu'il n'est pas relevé.
    pub mangeoire_per_point: Option<f64>,
    pub fuel: Vec<FuelBand>,
    /// Ce qui manque, en clair, pour que l'appelant le dise.
    pub missing: Vec<String>,
}

fn number(table: &toml::Value, path: &[&str]) -> Option<f64> {
    let mut node = table;
    for key in path {
        node = node.get(key)?;
    }
    match node {
        toml::Value::Integer(value) => Some(*value as f64),
        toml::Value::Float(value) => Some(*value),
        _ => None,
    }
}

/// Lit un prix qui peut être donné directement ou en couple unité/points.
///
/// `-1` — ou l'absence — veut dire « pas relevé », et se propage en `None`.
fn price_per_point(table: &toml::Value, label: &str, missing: &mut Vec<String>) -> Option<f64> {
    let direct = number(table, &["prix_par_point"]).filter(|value| *value >= 0.0);
    if let Some(direct) = direct {
        return Some(direct);
    }
    let unit = number(table, &["prix_unite"]).filter(|value| *value >= 0.0);
    let points = number(table, &["points_par_unite"]).filter(|value| *value > 0.0);
    match (unit, points) {
        (Some(unit), Some(points)) => Some(unit / points),
        _ => {
            missing.push(label.to_string());
            None
        }
    }
}

impl Prices {
    /// Le chemin par défaut, relatif au crate.
    pub fn default_path() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../economy.toml")
    }

    pub fn load(path: impl AsRef<Path>) -> Result<Self, String> {
        let path = path.as_ref();
        let text = std::fs::read_to_string(path)
            .map_err(|e| format!("lecture de {} : {e}", path.display()))?;
        Self::parse(&text)
    }

    /// Charge le fichier par défaut, ou retombe sur les valeurs codées en dur.
    ///
    /// Le repli est bruyant : il rend l'erreur à l'appelant plutôt que de faire
    /// comme si de rien n'était.
    pub fn load_default() -> Result<Self, String> {
        Self::load(Self::default_path())
    }

    pub fn parse(text: &str) -> Result<Self, String> {
        // `Value` seul ne parse qu'une **valeur** ; un document est une `Table`.
        // On la réemballe pour que la navigation ci-dessous reste uniforme.
        let table: toml::Table = text.parse().map_err(|e| format!("economy.toml : {e}"))?;
        let root = toml::Value::Table(table);
        let mut missing = Vec::new();
        let default = Economy::default();

        let get = |path: &[&str], fallback: f64| number(&root, path).unwrap_or(fallback);

        let mode = root
            .get("partie")
            .and_then(|p| p.get("mode"))
            .and_then(toml::Value::as_str)
            .unwrap_or("fournees");
        let batches = get(&["partie", "fournees"], f64::from(default.batches)) as u32;
        let hours = get(&["partie", "heures"], 2084.0) as u32;
        let horizon = match mode {
            "heures" => Horizon::Hours(hours),
            _ => Horizon::Batches(batches),
        };

        let places = get(&["fournee", "places"], 50.0) as usize;
        let slots_per_enclos = get(&["fournee", "places_par_enclos"], 10.0) as usize;

        let economy = Economy {
            starting_kamas: get(&["partie", "kamas_de_depart"], default.starting_kamas as f64)
                as i64,
            starting_pool: get(&["partie", "montures_de_depart"], default.starting_pool as f64)
                as usize,
            pool_generations: (
                get(&["partie", "generation_minimale_du_pool"], 2.0) as u8,
                get(&["partie", "generation_maximale_du_pool"], 9.0) as u8,
            ),
            batches,
            batch_cost: get(&["fournee", "prix_forfaitaire"], default.batch_cost as f64) as i64,
            // Deux places par croisement : la capacité se lit sur les places,
            // pas l'inverse, parce que c'est l'enclos qui est physique.
            crossings_per_batch: places / 2,
            starter_price: get(
                &["montures", "prix_gen1_anonyme"],
                default.starter_price as f64,
            ) as i64,
            amber_per_generation: get(
                &["valeurs", "ambre_par_rang"],
                default.amber_per_generation as f64,
            ) as i64,
            top_value: get(&["valeurs", "gen10"], default.top_value as f64) as i64,
            mount_level: get(&["montures", "niveau"], f64::from(default.mount_level)) as u16,
        };

        let mut optimakina = BTreeMap::new();
        for generation in 2..=10u8 {
            if let Some(price) = number(&root, &["optimakina", &format!("gen{generation}")])
                .filter(|value| *value >= 0.0)
            {
                optimakina.insert(generation, price as i64);
            }
        }
        if optimakina.is_empty() {
            missing.push("prix des Optimakina".into());
        }

        let mangeoire = root
            .get("mangeoire")
            .and_then(|table| price_per_point(table, "prix du point de Mangeoire", &mut missing));

        let mut fuel = Vec::new();
        if let Some(bands) = root.get("carburant").and_then(toml::Value::as_array) {
            for band in bands {
                let cap = number(band, &["cap"]).unwrap_or(0.0) as i64;
                fuel.push(FuelBand {
                    cap,
                    points_per_second: number(band, &["points_par_seconde"]).unwrap_or(1.0),
                    hours_per_batch: number(band, &["heures_par_fournee"]).unwrap_or(0.0),
                    price_per_point: price_per_point(
                        band,
                        &format!("prix du point de jauge (bande {cap})"),
                        &mut missing,
                    ),
                });
            }
        }

        Ok(Self {
            economy,
            horizon,
            slots_per_enclos,
            optimakina,
            optimakina_bonus: get(&["optimakina", "bonus"], 0.1),
            mangeoire_per_point: mangeoire,
            fuel,
            missing,
        })
    }

    /// Ce que l'économie ne sait pas encore chiffrer, en une phrase par trou.
    ///
    /// À afficher au démarrage de toute mesure : un chiffre publié sur une
    /// économie incomplète doit le dire lui-même.
    pub fn report_gaps(&self) -> Option<String> {
        if self.missing.is_empty() {
            return None;
        }
        Some(format!(
            "Prix manquants ({}) : {}.\n\
             Le forfait de {} kamas par fournée s'applique donc, à niveau {} fixe — \
             les leviers « niveau », « vitesse de jauge » et leur réglage par tranche de \
             dix montures ne sont pas simulés.\n\
             Les renseigner dans rust/economy.toml.",
            self.missing.len(),
            self.missing.join(", "),
            self.economy.batch_cost,
            self.economy.mount_level,
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn le_fichier_livre_se_charge() {
        let prices = Prices::load_default().expect("economy.toml doit se charger");

        assert_eq!(prices.economy.starting_kamas, 10_000_000);
        assert_eq!(prices.economy.crossings_per_batch, 25, "50 places, deux par croisement");
        assert_eq!(prices.economy.starter_price, 1_000);
        assert_eq!(prices.economy.mount_level, 67);
        assert_eq!(prices.slots_per_enclos, 10);
    }

    #[test]
    fn les_prix_du_fichier_valent_ceux_codes_en_dur() {
        // Tant que les deux coexistent, ils doivent dire la même chose : sinon
        // une mesure lancée depuis un binaire qui n'a pas lu le fichier
        // silencieusement ne mesure pas le même jeu.
        let prices = Prices::load_default().expect("chargement");
        let hard = Economy::default();

        assert_eq!(prices.economy.starting_kamas, hard.starting_kamas);
        assert_eq!(prices.economy.batch_cost, hard.batch_cost);
        assert_eq!(prices.economy.crossings_per_batch, hard.crossings_per_batch);
        assert_eq!(prices.economy.starter_price, hard.starter_price);
        assert_eq!(prices.economy.amber_per_generation, hard.amber_per_generation);
        assert_eq!(prices.economy.top_value, hard.top_value);
        assert_eq!(prices.economy.mount_level, hard.mount_level);
        assert_eq!(prices.economy.starting_pool, hard.starting_pool);
    }

    #[test]
    fn les_optimakina_sont_toutes_relevees() {
        let prices = Prices::load_default().expect("chargement");
        for generation in 2..=10u8 {
            assert!(
                prices.optimakina.contains_key(&generation),
                "prix manquant pour la gen {generation}"
            );
        }
        assert_eq!(prices.optimakina[&2], 5_000);
        assert_eq!(prices.optimakina[&10], 149_996);
        assert!((prices.optimakina_bonus - 0.10).abs() < 1e-12);
    }

    /// Les trous doivent se voir. Aujourd'hui la Mangeoire et les quatre bandes
    /// de carburant manquent, donc cinq trous.
    #[test]
    fn ce_qui_manque_est_annonce() {
        let prices = Prices::load_default().expect("chargement");
        assert_eq!(prices.fuel.len(), 4, "les quatre bandes de jauge");
        assert!(prices.mangeoire_per_point.is_none());
        assert!(prices.fuel.iter().all(|band| band.price_per_point.is_none()));

        let report = prices.report_gaps().expect("il manque des prix");
        assert!(report.contains("Mangeoire"));
        assert!(report.contains("economy.toml"));
    }

    /// Et dès qu'un prix est renseigné, il cesse d'être annoncé manquant —
    /// y compris donné en couple unité/points.
    #[test]
    fn un_prix_renseigne_disparait_des_manques() {
        let text = r#"
[mangeoire]
prix_unite = 500
points_par_unite = 250

[[carburant]]
cap = 40000
prix_par_point = 0.02
"#;
        let prices = Prices::parse(text).expect("parse");
        assert_eq!(prices.mangeoire_per_point, Some(2.0));
        assert_eq!(prices.fuel[0].price_per_point, Some(0.02));
        assert!(
            prices.missing.iter().all(|gap| !gap.contains("Mangeoire")),
            "{:?}",
            prices.missing
        );
    }

    #[test]
    fn l_horizon_se_lit_dans_le_fichier() {
        let prices = Prices::load_default().expect("chargement");
        assert_eq!(prices.horizon, Horizon::Batches(100));

        let en_heures = Prices::parse("[partie]\nmode = \"heures\"\nheures = 2084\n")
            .expect("parse");
        assert_eq!(en_heures.horizon, Horizon::Hours(2084));
    }
}
