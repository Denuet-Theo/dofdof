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
    /// Prix au point des jauges de sérénité (Baffeur/Caresseur) et de
    /// statistiques (Foudroyeur/Dragofesse). Un cycle en demande 15 010 des
    /// premières et 60 000 des secondes, par enclos — d'où deux prix et non un.
    pub serenity_per_point: Option<f64>,
    pub stats_per_point: Option<f64>,
}

#[derive(Clone, Debug)]
pub struct Prices {
    /// Le modèle simplifié, celui que le simulateur joue aujourd'hui.
    pub economy: Economy,
    pub horizon: Horizon,
    pub slots_per_enclos: usize,
    /// Manipulation incompressible entre deux fournées, en heures. Plancher dur
    /// sur la cadence : accélérer le carburant butera toujours dessus.
    pub overhead_hours: f64,
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

                let slots_per_enclos = get(&["fournee", "places_par_enclos"], 10.0) as usize;
        let overhead_hours = get(&["fournee", "minutes_entre_fournees"], 0.0) / 60.0;

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
            ..default
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

        // Une section absente est un trou comme un autre : sans ce `unwrap_or`,
        // supprimer `[mangeoire]` du fichier ferait disparaître le prix **et**
        // l'avertissement, et la mesure tournerait en silence sur une économie
        // amputée.
        let mangeoire = match root.get("mangeoire") {
            Some(table) => price_per_point(table, "prix du point de Mangeoire", &mut missing),
            None => {
                missing.push("prix du point de Mangeoire".into());
                None
            }
        };

        // La table de prix par jauge : six jauges, quatre bandes. C'est elle
        // qui permet de payer cher le chemin critique et rien d'autre.
        let gauge_names = [
            "baffeur",
            "caresseur",
            "foudroyeur",
            "dragofesse",
            "abreuvoir",
            "mangeoire",
        ];
        let mut gauge_prices = [[0.0f64; 4]; 6];
        for (index, name) in gauge_names.iter().enumerate() {
            match root
                .get("carburant")
                .and_then(|table| table.get(name))
                .and_then(toml::Value::as_array)
            {
                Some(row) if row.len() >= 4 => {
                    for band in 0..4 {
                        gauge_prices[index][band] = row[band].as_float().unwrap_or_else(|| {
                            row[band].as_integer().unwrap_or(0) as f64
                        });
                    }
                }
                _ => missing.push(format!("prix par bande de la jauge {name}")),
            }
        }
        let mut band_rates = [1.0, 2.0, 3.0, 4.0];
        if let Some(rates) = root
            .get("carburant")
            .and_then(|table| table.get("points_par_seconde"))
            .and_then(toml::Value::as_array)
            && rates.len() >= 4
        {
            for band in 0..4 {
                band_rates[band] = rates[band]
                    .as_integer()
                    .map(|value| value as f64)
                    .or_else(|| rates[band].as_float())
                    .unwrap_or(band_rates[band]);
            }
        }

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
                    serenity_per_point: number(band, &["prix_par_point_serenite"])
                        .filter(|value| *value >= 0.0),
                    stats_per_point: number(band, &["prix_par_point_stats"])
                        .filter(|value| *value >= 0.0),
                });
            }
        }

        // Les quatre leviers, reversés dans l'économie. Tant qu'un prix manque,
        // `levers_active()` reste faux et le simulateur retombe sur le forfait
        // à plat — les mesures publiées avant restent alors comparables.
        let mut economy = economy;
        economy.horizon_hours = match horizon {
            Horizon::Hours(hours) => Some(f64::from(hours)),
            Horizon::Batches(_) => None,
        };
        economy.overhead_hours = overhead_hours;
        economy.mangeoire_per_point = mangeoire.unwrap_or(0.0);
        // La taille d'une unité d'Extrait, gardée telle quelle.
        //
        // Le calcul ci-dessus la divise aussitôt en prix au point, ce qui suffit
        // pour arbitrer mais pas pour faire une liste de courses : on n'achète
        // pas 20 460 points, on achète sept Extraits. Absente si le fichier
        // donne directement `prix_par_point`, et on ne devine pas le
        // conditionnement dans ce cas.
        economy.mangeoire_points_per_unit = root
            .get("mangeoire")
            .and_then(|table| table.get("points_par_unite"))
            .and_then(toml::Value::as_float)
            .or_else(|| {
                root.get("mangeoire")
                    .and_then(|table| table.get("points_par_unite"))
                    .and_then(toml::Value::as_integer)
                    .map(|points| points as f64)
            })
            .filter(|points| *points > 0.0)
            .unwrap_or(0.0);
        economy.mangeoire_per_mount = root
            .get("mangeoire")
            .and_then(|table| table.get("par_monture"))
            .and_then(toml::Value::as_bool)
            .unwrap_or(false);
        economy.optimakina_bonus = get(&["optimakina", "bonus"], 0.1);

        // Les génétons : le co-produit d'un croisement réussi, et le levier qui
        // manquait le plus à cette économie.
        let per_unit = get(&["genetons", "genetons_par_unite"], 10.0).max(1.0);
        let tax = get(&["genetons", "taxe_hdv"], 0.02);
        let net = |price: f64| price / per_unit * (1.0 - tax);
        economy.geneton_value = net(get(&["genetons", "prix_unitaire"], 0.0));
        if economy.geneton_value <= 0.0 {
            missing.push("prix du parchemin d'échange des génétons".into());
        }
        economy.geneton_range = (
            net(get(&["genetons", "prix_unitaire_min"], 0.0)),
            net(get(&["genetons", "prix_unitaire_max"], 0.0)),
        );
        // Les fenêtres de disponibilité. Deux formes de journée nommées et un motif
        // de semaine qui les compose : une semaine de vacances se dit en mettant
        // sept fois la même forme, sans toucher au reste.
        //
        // Absentes, `availability` reste à zéro, ce qui vaut disponibilité continue
        // — le modèle d'avant. C'est voulu : un fichier qui ne parle pas de
        // disponibilité ne doit pas se retrouver avec une contrainte qu'il n'a pas
        // demandée.
        let shape = |name: &str| -> Option<[(f64, f64); crate::economy::MAX_WINDOWS_PER_DAY]> {
            let rows = root
                .get("disponibilite")
                .and_then(|table| table.get(name))
                .and_then(toml::Value::as_array)?;
            let mut out = [(0.0, 0.0); crate::economy::MAX_WINDOWS_PER_DAY];
            for (slot, row) in rows.iter().take(crate::economy::MAX_WINDOWS_PER_DAY).enumerate() {
                let pair = row.as_array().filter(|pair| pair.len() >= 2)?;
                let hour = |value: &toml::Value| -> f64 {
                    value
                        .as_float()
                        .or_else(|| value.as_integer().map(|n| n as f64))
                        .unwrap_or(0.0)
                };
                out[slot] = (hour(&pair[0]), hour(&pair[1]));
            }
            Some(out)
        };
        if let Some(pattern) = root
            .get("disponibilite")
            .and_then(|table| table.get("jours"))
            .and_then(toml::Value::as_array)
        {
            for (day, name) in pattern
                .iter()
                .take(crate::economy::DAYS_PER_WEEK)
                .enumerate()
            {
                match name.as_str().and_then(shape) {
                    Some(windows) => economy.availability[day] = windows,
                    None => missing.push(format!(
                        "forme de journée « {} » pour le jour {day}",
                        name.as_str().unwrap_or("?")
                    )),
                }
            }
        }

        economy.top_value_range = (
            get(&["valeurs", "gen10_min"], economy.top_value as f64) as i64,
            get(&["valeurs", "gen10_max"], economy.top_value as f64) as i64,
        );
        economy.amber_range = (
            get(&["valeurs", "ambre_min"], economy.amber_per_generation as f64) as i64,
            get(&["valeurs", "ambre_max"], economy.amber_per_generation as f64) as i64,
        );

        // Ce qu'on facture à un croisement qui ne pouvait pas monter. Absent, il
        // reste à zéro : le compte est tenu de toute façon, seul le prix est un
        // choix, et les mesures publiées ne doivent pas bouger sous les pieds de
        // qui n'a rien demandé.
        economy.barren_crossing_malus = get(
            &["valeurs", "malus_croisement_sterile"],
            economy.barren_crossing_malus as f64,
        ) as i64;

        // La prime du succès de collection, par génération. Absente, elle vaut zéro
        // partout et la fitness est celle d'avant — les mesures publiées tiennent.
        //
        // `succes.gen1 = 100000` … `succes.gen10 = 2000000`. On lit clé par clé
        // plutôt qu'un tableau : un tableau de onze entrées dont on décale un cran
        // se relit sans erreur et paie la mauvaise génération, ce qui est
        // exactement le genre de chiffre qu'on finit par croire.
        for generation in 1..=10usize {
            let key = format!("gen{generation}");
            economy.collection_bonus[generation] =
                get(&["succes", key.as_str()], 0.0) as i64;
        }

        // Ce qu'une couronne pèse devant le score. Absent, l'ordre lexicographique
        // d'avant — cent millions, soit plus qu'une partie entière liquide.
        economy.crown_weight = get(&["projet", "poids_couronne"], 100_000_000.0);

        // La profondeur de marché. Absente, elle vaut zéro et la liquidation reste
        // linéaire — le barème de toutes les mesures publiées avant elle.
        economy.sale_price_decay = get(&["marche", "baisse_par_vente"], 0.0);
        economy.daily_price_recovery = get(&["marche", "hausse_par_jour"], 0.0);

        economy.slots_per_enclos = slots_per_enclos;
        economy.sync_enclos = get(&["fournee", "enclos_synchronises"], 5.0) as usize;
        economy.free_enclos = get(&["fournee", "enclos_libres"], 0.0) as usize;
        economy.gauge_prices = gauge_prices;
        economy.band_rates = band_rates;
        economy.cycle_serenity_points =
            get(&["cycle", "montee_serenite"], 10_000.0) + get(&["cycle", "descente_serenite"], 5_001.0);
        economy.cycle_stat_points = 3.0 * get(&["cycle", "points_par_stat"], 20_000.0);
        for (generation, price) in &optimakina {
            economy.optimakina[usize::from(*generation).min(10)] = *price;
        }
        for (index, band) in fuel.iter().take(4).enumerate() {
            economy.bands[index] = crate::economy::Band {
                cap: band.cap,
                hours: band.hours_per_batch,
                serenity_per_point: band.serenity_per_point.unwrap_or(0.0),
                stats_per_point: band.stats_per_point.unwrap_or(0.0),
            };
        }

        Ok(Self {
            economy,
            horizon,
            slots_per_enclos,
            overhead_hours,
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
        assert_eq!(prices.economy.unit_crossings(0), 25, "50 places, deux par croisement");
        assert_eq!(prices.economy.starter_price, 1_000);
        assert_eq!(prices.economy.mount_level, 67);
        assert_eq!(prices.slots_per_enclos, 10);
        // Les cinq minutes incompressibles entre deux fournées.
        assert!((prices.overhead_hours - 5.0 / 60.0).abs() < 1e-12);
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
        assert_eq!(prices.economy.unit_crossings(0), 25);
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

    /// Le fichier livré est complet : les quatre bandes et la Mangeoire ont
    /// leur prix, relevés à l'HDV le 2026-08-08 et croisés avec les points de
    /// recharge de DofusDB.
    #[test]
    fn le_fichier_livre_n_a_plus_de_trou() {
        let prices = Prices::load_default().expect("chargement");
        assert_eq!(prices.report_gaps(), None);
        assert!(prices.mangeoire_per_point.is_some());

        // Six jauges, quatre bandes, tout renseigné. La bande se choisit jauge
        // par jauge, d'où une table et non une liste de bandes.
        assert!(prices.economy.per_gauge_prices());
        for (gauge, row) in prices.economy.gauge_prices.iter().enumerate() {
            for (band, price) in row.iter().enumerate() {
                assert!(
                    *price > 0.0,
                    "jauge {gauge}, bande {band} : prix manquant"
                );
            }
        }
        assert_eq!(prices.economy.band_rates, [1.0, 2.0, 3.0, 4.0]);
    }

    /// L'Abreuvoir est **moins cher en bande 1 qu'en bande 0** tout en allant
    /// deux fois plus vite : sa bande basse est strictement dominée.
    ///
    /// Ce test existe parce que c'est le seul gain que le modèle à bande unique
    /// ne pouvait pas exprimer, et parce qu'il sert de contrôle sur la politique
    /// évoluée : si elle laisse l'Abreuvoir en bande 0, c'est que la mutation
    /// par jauge n'explore pas.
    #[test]
    fn la_bande_basse_de_l_abreuvoir_est_dominee() {
        use crate::schedule::ABREUVOIR;
        let prices = Prices::load_default().expect("chargement");
        let row = prices.economy.gauge_prices[ABREUVOIR];
        assert!(
            row[1] < row[0],
            "bande 1 à {} devrait être moins chère que la bande 0 à {}",
            row[1],
            row[0]
        );
    }

    /// Mais la machinerie qui annonce les trous doit rester vivante — sans quoi
    /// le jour où un prix disparaîtra du fichier, la mesure se fera en silence
    /// sur une économie incomplète.
    #[test]
    fn un_prix_absent_est_toujours_annonce() {
        let prices = Prices::parse("[partie]\nkamas_de_depart = 10000000\n").expect("parse");
        let report = prices.report_gaps().expect("tout manque, donc ça se dit");
        assert!(report.contains("Mangeoire"), "{report}");
        assert!(report.contains("economy.toml"), "{report}");
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
        // Le fichier livré compte en temps mural : c'est la vitesse de jauge qui
        // décide combien de fournées on joue, et c'est tout l'enjeu du levier.
        let prices = Prices::load_default().expect("chargement");
        assert_eq!(prices.horizon, Horizon::Hours(300));
        assert_eq!(prices.economy.horizon_hours, Some(300.0));

        let en_tours = Prices::parse("[partie]\nmode = \"fournees\"\nfournees = 100\n")
            .expect("parse");
        assert_eq!(en_tours.horizon, Horizon::Batches(100));
        assert_eq!(en_tours.economy.horizon_hours, None);
        // Et le fichier livré porte bien le budget réel.
        assert_eq!(
            Prices::load_default().expect("chargement").horizon,
            Horizon::Hours(300),
            "le budget est désormais un temps mural"
        );
    }
}
