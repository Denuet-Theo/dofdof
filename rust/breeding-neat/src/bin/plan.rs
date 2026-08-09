//! Émettre le plan que l'écran attend.
//!
//! ```sh
//! cargo run --release -p breeding-neat --bin plan -- champion-r5.json --out plan.json
//! ```
//!
//! `src/lib/dofus/breeding/timeline.ts` définit le contrat et le dit sans
//! détour : « quand le Rust saura ordonnancer, il produira ce JSON ». C'est ce
//! binaire. En face, `samplePlan()` devient ce qu'il n'aurait jamais dû cesser
//! d'être : un exemple, pas la source.
//!
//! ## Ce qu'on émet est joué, pas déduit
//!
//! On ne rejoue pas la stratégie sur le papier : on **joue une partie** avec le
//! champion et on note ce qu'il a fait fournée par fournée. Les effectifs
//! affichés — dix montures à replacer, trois stériles à cloner — sont donc ceux
//! d'une partie qui a réellement tourné, avec ses naissances tirées. Recalculer
//! des moyennes aurait donné un plan que le modèle n'a jamais suivi.
//!
//! La contrepartie est qu'un plan dépend de sa graine : `--seed` la choisit, et
//! deux graines donnent deux plans également valides. C'est honnête — l'élevage
//! est un tirage — mais il ne faut pas lire le fichier comme une prophétie.
//!
//! ## Les achats portent une date limite, pas une heure d'action
//!
//! Un `buy` se date au moment où la chose doit être **là** : les montures avant
//! qu'on charge l'enclos, le carburant avant que la jauge parte. C'est la seule
//! date utile — un aller-retour à l'HDV peut demander plusieurs passages, et
//! savoir « il te faut dix Doré dans deux heures » vaut mieux que l'apprendre
//! devant l'enclos vide.
//!
//! ## Ce qu'on n'émet pas
//!
//! Pas d'événement `refuel`. Le modèle ne connaît pas les capacités de cuve :
//! `economy.toml` porte un prix au point, pas un volume par recharge. On dit
//! donc **combien de points** il faut par jauge, ce qui est vrai, plutôt qu'un
//! nombre de recharges, qui serait inventé. L'Extrait de Mangeoire fait
//! exception : son conditionnement est dans le fichier, donc là on compte des
//! unités.

use breeding_neat::champion;
use breeding_neat::neat::Network;
use breeding_sim::config::Prices;
use breeding_sim::economy::{Batch, Economy, Strategy, mount_xp_for_level, play_recorded};
use breeding_sim::encode::Census;
use breeding_sim::schedule::{
    ABREUVOIR_GATE, GAUGE_NAMES, MANGEOIRE, SERENITY_CLIMB, SERENITY_RETURN, Slot, slots,
};
use breeding_sim::search::{Searching, ValueFn};
use breeding_sim::stable::Sex;
use breeding_sim::trees::{Catalog, ColorId, muldo};
use serde_json::{Value, json};

/// Les identifiants de jauge côté écran, dans l'ordre de `GAUGE_NAMES`.
/// L'ordre **est** le contrat : un décalage enverrait la Mangeoire sur la barre
/// du Baffeur sans que rien ne proteste.
const GAUGE_IDS: [&str; 6] = [
    "baffeur",
    "caresseur",
    "foudroyeur",
    "dragofesse",
    "abreuvoir",
    "mangeoire",
];

/// La version du contrat, à tenir avec `TIMELINE_VERSION` côté TypeScript.
const TIMELINE_VERSION: u32 = 1;

struct NetValue<'a>(&'a Network);

impl ValueFn for NetValue<'_> {
    fn value(&self, census: &Census, catalog: &Catalog, economy: &Economy) -> f64 {
        self.0.value(&census.features(catalog, economy))
    }
}

struct Options {
    path: String,
    rank: usize,
    seed: u32,
    hours: f64,
    iterations: usize,
    out: Option<String>,
}

impl Options {
    fn parse() -> Self {
        let mut options = Self {
            path: "champion.json".into(),
            rank: 1,
            seed: 900_000,
            // Douze heures suffisent à l'écran ; on en émet le double pour qu'il
            // reste quelque chose à faire défiler après une journée.
            hours: 24.0,
            iterations: 800,
            out: None,
        };
        let args: Vec<String> = std::env::args().skip(1).collect();
        let mut index = 0;
        while index < args.len() {
            let value = args.get(index + 1);
            match args[index].as_str() {
                "--seed" => {
                    options.seed = value.and_then(|v| v.parse().ok()).unwrap_or(options.seed);
                    index += 1;
                }
                "--hours" => {
                    options.hours = value.and_then(|v| v.parse().ok()).unwrap_or(options.hours);
                    index += 1;
                }
                "--rank" => {
                    options.rank = value.and_then(|v| v.parse().ok()).unwrap_or(options.rank);
                    index += 1;
                }
                "--iterations" => {
                    options.iterations =
                        value.and_then(|v| v.parse().ok()).unwrap_or(options.iterations);
                    index += 1;
                }
                "--out" => {
                    options.out = value.cloned();
                    index += 1;
                }
                other if !other.starts_with("--") => options.path = other.to_string(),
                _ => {}
            }
            index += 1;
        }
        options
    }
}

fn seconds(hours: f64) -> f64 {
    (hours * 3600.0).round()
}

/// Le libellé d'une tâche, dans les termes du jeu plutôt que dans ceux du
/// solveur : « Sérénité → +5000 » se retrouve devant l'enclos, « tâche 0 » non.
fn label_of(slot: &Slot, level: u16) -> (String, String) {
    let name = GAUGE_NAMES[slot.gauge];
    if slot.points == SERENITY_CLIMB {
        return (
            "Sérénité → ±5000".into(),
            format!(
                "10 000 points sur le {name}. Toute la fournée part d'une sérénité tirée au hasard : \
                 la plus éloignée demande la course entière. Seule la Mangeoire peut tourner pendant ce temps."
            ),
        );
    }
    if slot.points == ABREUVOIR_GATE {
        return (
            "Sérénité → ±2000".into(),
            format!("3 000 points sur le {name} : ouvre l'Abreuvoir sans couper la stat en cours."),
        );
    }
    if slot.points == SERENITY_RETURN - ABREUVOIR_GATE {
        return (
            "Sérénité → ∓1".into(),
            format!(
                "2 001 points sur le {name}. On attend que la première stat ait fini : \
                 franchir zéro la couperait net."
            ),
        );
    }
    if slot.gauge == MANGEOIRE {
        return (
            format!("Mangeoire — niveau {level}"),
            format!(
                "{:.0} points d'expérience. Occupe une des deux places : elle allonge la fournée.",
                slot.points
            ),
        );
    }
    (
        name.to_string(),
        format!("{:.0} points. Fenêtre de sérénité imposée.", slot.points),
    )
}

/// Un nombre en kamas, lisible : « 1,24 M » plutôt que « 1238400 ».
fn kamas(value: f64) -> String {
    if value >= 1e6 {
        format!("{:.2} M", value / 1e6)
    } else {
        format!("{:.0} k", value / 1e3)
    }
}

/// Un entier avec ses milliers séparés, comme partout ailleurs dans l'écran.
/// « 102183 pts » se relit deux fois ; « 102 183 pts » se lit une.
fn spaced(value: f64) -> String {
    let digits = format!("{:.0}", value.max(0.0));
    let mut out = String::with_capacity(digits.len() + digits.len() / 3);
    for (index, digit) in digits.chars().enumerate() {
        if index > 0 && (digits.len() - index) % 3 == 0 {
            out.push('\u{202f}');
        }
        out.push(digit);
    }
    out
}

/// La liste de courses d'une fournée, datée de l'instant où il faut l'avoir.
///
/// Deux lignes séparées et non une : les montures se cherchent une par une à
/// l'HDV et le carburant s'achète en pile. Les mélanger donnerait une consigne
/// qu'on ne peut pas cocher à moitié.
fn shopping_events(
    catalog: &Catalog,
    economy: &Economy,
    strategy: Strategy,
    batch: &Batch,
    enclos: usize,
    id: &str,
) -> Vec<Value> {
    let mut events = Vec::new();
    let at = seconds(batch.at_hours);

    // --- les montures ------------------------------------------------------
    if !batch.purchases.is_empty() {
        // Regroupées par couleur et par sexe, dans l'ordre où elles arrivent :
        // une liste de dix lignes « un Doré mâle » ne se lit pas.
        let mut grouped: Vec<((ColorId, Sex), usize)> = Vec::new();
        for &(color, sex) in &batch.purchases {
            match grouped.iter_mut().find(|(key, _)| *key == (color, sex)) {
                Some((_, count)) => *count += 1,
                None => grouped.push(((color, sex), 1)),
            }
        }
        let detail = grouped
            .iter()
            .map(|((color, sex), count)| {
                format!(
                    "{count} {} {}",
                    catalog.name(*color),
                    if *sex == Sex::Male { "mâle" } else { "femelle" }
                )
            })
            .collect::<Vec<_>>()
            .join(", ");

        events.push(json!({
            "id": format!("{id}-buy-mounts"),
            "kind": "buy",
            "at": at,
            "duration": 0,
            "label": format!("Acheter {} monture(s)", batch.purchases.len()),
            "count": batch.purchases.len(),
            "detail": format!(
                "{detail}. À avoir avant de charger l'enclos — environ {} au total.",
                kamas(batch.purchases.len() as f64 * economy.starter_price as f64)
            ),
        }));
    }

    // --- le carburant ------------------------------------------------------
    let level = economy.level_of(strategy);
    let placed = slots(economy, strategy.bands, mount_xp_for_level(level));
    if placed.is_empty() {
        return events;
    }

    let mut per_gauge = [0.0f64; 6];
    for slot in &placed {
        per_gauge[slot.gauge] += slot.points;
    }
    let enclos = enclos.max(1) as f64;

    let mut lines = Vec::new();
    let mut total = 0.0f64;
    for gauge in 0..6 {
        let points = per_gauge[gauge] * enclos;
        if points <= 0.0 {
            continue;
        }
        let cost = points * economy.gauge_price(gauge, strategy.bands[gauge]);
        total += cost;
        // Seule la Mangeoire a un conditionnement connu ; pour les autres on
        // donne les points, qui sont vrais, plutôt qu'un nombre de recharges,
        // qui serait inventé.
        if gauge == MANGEOIRE && economy.mangeoire_points_per_unit > 0.0 {
            let units = (points / economy.mangeoire_points_per_unit).ceil();
            lines.push(format!(
                "Mangeoire : {units:.0} Extrait(s) ({} pts, {})",
                spaced(points),
                kamas(cost)
            ));
        } else {
            lines.push(format!(
                "{} : {} pts en bande {} ({})",
                GAUGE_NAMES[gauge],
                spaced(points),
                strategy.bands[gauge],
                kamas(cost)
            ));
        }
    }

    events.push(json!({
        "id": format!("{id}-buy-fuel"),
        "kind": "buy",
        "at": at,
        "duration": 0,
        "label": format!("Carburant — {}", kamas(total)),
        "detail": format!(
            "Pour {enclos:.0} enclos. {}. À avoir avant que les jauges partent.",
            lines.join(" · ")
        ),
    }));

    events
}

/// Les événements d'un enclos pour une fournée.
fn cycle_events(
    economy: &Economy,
    strategy: Strategy,
    batch: &Batch,
    enclos: usize,
    id: &str,
) -> Vec<Value> {
    let level = economy.level_of(strategy);
    let placed = slots(economy, strategy.bands, mount_xp_for_level(level));
    let start = seconds(batch.at_hours);

    // Ce que la fournée demande **par enclos**. L'unité 0 en pilote cinq d'un
    // coup : afficher ses 25 croisements sur chaque piste ferait lire cinq fois
    // le même travail.
    let per_enclos = |total: usize| total.div_ceil(enclos.max(1));

    let mut events = vec![json!({
        "id": format!("{id}-mate"),
        "kind": "mate",
        "at": start,
        "duration": 0,
        "label": "Charger l'enclos",
        "count": per_enclos(batch.crossings) * 2,
        "detail": format!(
            "{} croisements sur cet enclos, {} sur la fournée entière.",
            per_enclos(batch.crossings),
            batch.crossings
        ),
    })];

    let mut last = 0.0f64;
    for (index, slot) in placed.iter().enumerate() {
        let (label, detail) = label_of(slot, level);
        last = last.max(slot.end);
        events.push(json!({
            "id": format!("{id}-g{index}"),
            "kind": "gauge",
            "at": start + slot.start.round(),
            "duration": (slot.end - slot.start).round(),
            "label": label,
            "detail": detail,
            "gauge": GAUGE_IDS[slot.gauge],
        }));
    }

    events.push(json!({
        "id": format!("{id}-collect"),
        "kind": "collect",
        "at": start + last.round(),
        "duration": 0,
        "label": "Récupérer la fournée",
        "count": per_enclos(batch.births),
        "detail": format!(
            "{} naissances sur cet enclos, {} sur la fournée. Les places finissent ensemble.",
            per_enclos(batch.births),
            batch.births
        ),
    }));

    events
}

fn main() {
    let options = Options::parse();
    let genome = match champion::load(&options.path, options.rank) {
        Ok(genome) => genome,
        Err(error) => {
            eprintln!(
                "{error}\nLancer d'abord l'entraînement :\n  \
                 cargo run --release -p breeding-neat -- --minutes 60"
            );
            std::process::exit(1);
        }
    };

    let catalog = muldo();
    let economy = Prices::load_default()
        .map(|prices| prices.economy)
        .unwrap_or_else(|error| {
            // Émettre un plan sur une économie autre que celle du fichier
            // donnerait des durées que le parc ne suivra pas.
            eprintln!("{error}");
            std::process::exit(1);
        });

    let network = Network::compile(&genome);
    let mut policy = Searching::with_iterations(NetValue(&network), options.iterations)
        .with_strategies(genome.strategies);
    let (outcome, batches) = play_recorded(&catalog, &economy, &mut policy, options.seed);

    let window = seconds(options.hours);
    let sync = economy.sync_enclos.max(1);

    // --- les enclos synchronisés ------------------------------------------
    let mut tracks: Vec<Value> = Vec::new();
    for enclos in 1..=sync {
        let mut events: Vec<Value> = Vec::new();
        for (round, batch) in batches.iter().filter(|b| b.unit == 0).enumerate() {
            if seconds(batch.at_hours) > window {
                break;
            }
            if batch.crossings == 0 {
                continue;
            }
            events.extend(cycle_events(
                &economy,
                genome.strategies[0],
                batch,
                sync,
                &format!("enclos-{enclos}-t{round}"),
            ));
        }
        tracks.push(json!({
            "id": format!("enclos-{enclos}"),
            "label": format!("Enclos {enclos}"),
            "events": events,
        }));
    }

    // --- l'enclos libre ----------------------------------------------------
    if economy.unit_count() > 1 {
        let mut events: Vec<Value> = Vec::new();
        for (round, batch) in batches.iter().filter(|b| b.unit == 1).enumerate() {
            if seconds(batch.at_hours) > window {
                break;
            }
            if batch.crossings == 0 {
                continue;
            }
            events.extend(cycle_events(
                &economy,
                genome.strategies[1],
                batch,
                economy.unit_enclos(1),
                &format!("libre-t{round}"),
            ));
        }
        tracks.push(json!({
            "id": "enclos-libre",
            "label": "Enclos libre",
            "events": events,
        }));
    }

    // --- l'écurie ----------------------------------------------------------
    //
    // Ses gestes ne dépendent d'aucune jauge : ils se placent dans les trous,
    // d'où une piste à part. Le clonage y est le geste central — c'est le seul
    // moyen de récupérer de la fécondité, et le score le suit presque
    // linéairement.
    let mut stable_events: Vec<Value> = Vec::new();
    for (round, batch) in batches.iter().enumerate() {
        let at = seconds(batch.at_hours);
        if at > window {
            break;
        }
        if batch.clonings > 0 {
            stable_events.push(json!({
                "id": format!("ecurie-clone-t{round}"),
                "kind": "clone",
                "at": at,
                "duration": 0,
                "label": format!("Cloner {} stérile(s)", batch.clonings),
                "count": batch.clonings,
                "detail": "Une stérile ne vaut plus rien tant qu'on ne la clone pas.",
            }));
        }
    }
    tracks.push(json!({
        "id": "ecurie",
        "label": "Écurie",
        "events": stable_events,
    }));

    // --- le marché ---------------------------------------------------------
    //
    // Piste à part, et pas un geste posé sur l'enclos concerné : une course se
    // fait une fois, pour tout le parc, et à un moment qu'on choisit. Ce qui est
    // daté n'est pas l'achat mais la **date limite**.
    let mut market_events: Vec<Value> = Vec::new();
    for (round, batch) in batches.iter().enumerate() {
        if seconds(batch.at_hours) > window {
            break;
        }
        if batch.crossings == 0 {
            continue;
        }
        market_events.extend(shopping_events(
            &catalog,
            &economy,
            genome.strategies[batch.unit.min(1)],
            batch,
            if batch.unit == 0 {
                sync
            } else {
                economy.unit_enclos(batch.unit)
            },
            &format!("marche-u{}-t{round}", batch.unit),
        ));
    }
    tracks.push(json!({
        "id": "marche",
        "label": "Marché",
        "events": market_events,
    }));

    let strategy_line = |unit: usize| {
        let s = genome.strategies[unit];
        format!(
            "{}/{}",
            s.bands
                .iter()
                .map(|b| b.to_string())
                .collect::<String>(),
            economy.level_of(s)
        )
    };

    // L'horizon dit jusqu'où le modèle s'est prononcé, et une fournée entamée
    // avant la fenêtre finit après elle. On garde le cycle entier — un enclos
    // coupé montrerait des jauges sans récupération, ce qui se lit comme un
    // oubli — et on annonce l'horizon qui le couvre réellement.
    let last_event = tracks
        .iter()
        .filter_map(|track| track["events"].as_array())
        .flatten()
        .filter_map(|event| {
            Some(event["at"].as_f64()? + event["duration"].as_f64().unwrap_or(0.0))
        })
        .fold(0.0f64, f64::max);

    let plan = json!({
        "version": TIMELINE_VERSION,
        "label": format!(
            "{} enclos en {} · enclos libre en {} · graine {}",
            sync,
            strategy_line(0),
            strategy_line(1),
            options.seed
        ),
        "horizon": window.max(last_event),
        "tracks": tracks,
    });

    let text = serde_json::to_string_pretty(&plan).unwrap_or_default();
    match options.out.as_deref() {
        Some(path) => {
            if let Err(error) = std::fs::write(path, &text) {
                eprintln!("{path} : {error}");
                std::process::exit(1);
            }
            let actionable: usize = plan["tracks"]
                .as_array()
                .map(|tracks| {
                    tracks
                        .iter()
                        .filter_map(|t| t["events"].as_array())
                        .flatten()
                        .filter(|e| e["kind"] != "gauge" && e["kind"] != "note")
                        .count()
                })
                .unwrap_or(0);
            println!(
                "plan écrit dans {path} — {} pistes, {actionable} gestes sur {:.0} h, \
                 partie jouée sur la graine {} (score {:.2} M)",
                plan["tracks"].as_array().map(Vec::len).unwrap_or(0),
                options.hours,
                options.seed,
                outcome.score as f64 / 1e6,
            );
        }
        None => println!("{text}"),
    }
}
