//! Quel réglage de l'échelle tient la plus petite écurie, et ce qu'il coûte.
//!
//! ```sh
//! cargo run --release -p breeding-sim --bin knobs
//! ```
//!
//! ## La question
//!
//! La stratégie est arrêtée — l'échelle, la moisson, gen 9 puis recyclage. Ce qui
//! reste libre, ce sont les douze réglages de `LadderPolicy`, et l'écurie du jeu
//! ne tient que 250 places quand la politique en culmine à plus de trois cents.
//!
//! On ne cherche donc pas le meilleur score : on cherche **ce qu'un réglage fait à
//! l'effectif**, et ce que le score paie pour l'obtenir.
//!
//! ## Pourquoi un balayage et non la neuroévolution
//!
//! L'espace est petit et discret : cinq ordres, trois portes, trois sommets et
//! cinq drapeaux. Énumérer est exact ; faire évoluer serait plus lent, plus bruité,
//! et sélectionnerait la chance — un champion annoncé à 124,88 M a rendu 97,83 M au
//! départage. C'est l'argument de `bin/gauges`, qui balaie ses 4 096 combinaisons
//! sans heuristique précisément pour dire ce que la recherche *devrait* trouver.
//!
//! ## Un balayage par coordonnée, et pourquoi pas le produit
//!
//! Le produit complet fait 2 880 configurations. À 175 ms la partie et cent
//! graines, c'est quatre heures — et il dirait surtout du bruit, puisque la plupart
//! des réglages ne se parlent pas. On bouge donc **un réglage à la fois** depuis la
//! référence : trente configurations, et la réponse à la seule question qui compte
//! d'abord — lequel de ces douze leviers touche l'effectif.
//!
//! Ce que ça ne trouve pas : une interaction entre deux réglages. Si un levier
//! ressort, le produit sur ce sous-ensemble-là devient abordable et vaut le coup.

use breeding_sim::config::Prices;
use breeding_sim::economy::{Economy, MAX_UNITS, RunOutcome, Strategy, play};
use breeding_sim::ladder::{
    Crowning, Gating, LadderPolicy, Ordering, Purchasing, Route, Summit, Tuning,
};
use breeding_sim::trees::muldo;

/// Les graines de départage. Jamais les scellées : on compare des réglages.
const SEEDS: std::ops::Range<u32> = 800_000..800_100;

fn median(values: &mut [f64]) -> f64 {
    values.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    values[(values.len() - 1) / 2]
}

fn mean(values: impl Iterator<Item = f64>) -> f64 {
    let collected: Vec<f64> = values.collect();
    collected.iter().sum::<f64>() / collected.len().max(1) as f64
}

/// La référence : la stratégie livrée. Tout le reste s'en écarte d'un cran.
fn baseline(economy: &Economy) -> LadderPolicy {
    let catalog = muldo();
    let mut policy = LadderPolicy::new(&catalog, Route::default())
        .with_strategies([Strategy::default(); MAX_UNITS])
        .tuned_for(economy);
    // Ce qu'on a arrêté : la dernière fécondité des couleurs stockées.
    policy.harvest_stocked = true;
    policy
}

struct Row {
    label: String,
    score: f64,
    peak_mean: f64,
    peak_max: usize,
    retrievals: f64,
}

fn measure(label: &str, economy: &Economy, make: impl Fn() -> LadderPolicy) -> Row {
    let catalog = muldo();
    let outcomes: Vec<RunOutcome> = SEEDS
        .map(|seed| {
            let mut policy = make();
            play(&catalog, economy, &mut policy, seed)
        })
        .collect();
    let mut scores: Vec<f64> = outcomes.iter().map(|o| o.score as f64).collect();
    Row {
        label: label.to_string(),
        score: median(&mut scores),
        peak_mean: mean(outcomes.iter().map(|o| o.peak_stable as f64)),
        peak_max: outcomes.iter().map(|o| o.peak_stable).max().unwrap_or(0),
        retrievals: mean(outcomes.iter().map(|o| o.retrievals)),
    }
}

fn main() {
    let economy = Prices::load_default()
        .map(|prices| prices.economy)
        .unwrap_or_else(|error| {
            eprintln!("{error}");
            std::process::exit(1);
        });

    if economy.stable_places == 0 {
        eprintln!("economy.toml ne pose aucune place d'écurie ([ecurie] places).");
        std::process::exit(1);
    }

    println!(
        "{} parties par réglage, graines de départage {:?}.",
        SEEDS.len(),
        SEEDS
    );
    println!(
        "Écurie de {} places. On cherche l'effectif, pas le score.\n",
        economy.stable_places
    );

    let mut rows = vec![measure("référence (la stratégie livrée)", &economy, || {
        baseline(&economy)
    })];

    // --- un réglage à la fois -----------------------------------------------
    for (label, ordering) in [
        ("ordre = BottomUp", Ordering::BottomUp),
        ("ordre = RoundRobin", Ordering::RoundRobin),
        ("ordre = BigToSmall", Ordering::BigToSmall),
        ("ordre = BigToSmallByRank", Ordering::BigToSmallByRank),
    ] {
        rows.push(measure(label, &economy, || {
            let base = baseline(&economy);
            let gating = base.gating;
            base.with_ordering(ordering, gating)
        }));
    }
    for (label, gating) in [
        ("porte = Everywhere", Gating::Everywhere),
        ("porte = Off", Gating::Off),
    ] {
        rows.push(measure(label, &economy, || {
            let base = baseline(&economy);
            let ordering = base.ordering;
            base.with_ordering(ordering, gating)
        }));
    }
    for (label, summit) in [
        ("sommet = Hold", Summit::Hold),
        ("sommet = Duplicate", Summit::Duplicate),
    ] {
        rows.push(measure(label, &economy, || {
            baseline(&economy).with_summit(summit)
        }));
    }
    for (label, threshold) in [("seuil = 0", 0usize), ("seuil = 5", 5), ("seuil = 20", 20)] {
        rows.push(measure(label, &economy, || {
            let mut base = baseline(&economy);
            base.threshold = threshold;
            base
        }));
    }
    rows.push(measure("achats = MostBehind", &economy, || {
        let mut base = baseline(&economy);
        base.purchasing = Purchasing::MostBehind;
        base
    }));
    rows.push(measure("couronne = PriceOnly", &economy, || {
        let mut base = baseline(&economy);
        base.crowning = Crowning::PriceOnly;
        base
    }));
    rows.push(measure("réglage = BandAndLevel", &economy, || {
        let mut base = baseline(&economy);
        base.tuning = Tuning::BandAndLevel;
        base
    }));
    for (label, set) in [
        ("moisson = off", 0u8),
        ("moisson stockée = off", 1),
        ("clonage aveugle au sexe", 2),
        ("clone_top = off", 3),
        ("clone entre lignées = off", 4),
    ] {
        rows.push(measure(label, &economy, || {
            let mut base = baseline(&economy);
            match set {
                0 => base.harvesting = false,
                1 => base.harvest_stocked = false,
                2 => base.sex_blind_cloning = true,
                3 => base.clone_top = false,
                _ => base.clone_across_lineages = false,
            }
            base
        }));
    }

    // --- la table, rangée par effectif ---------------------------------------
    let reference = rows[0].peak_mean;
    let ref_score = rows[0].score;
    let mut sorted: Vec<&Row> = rows.iter().collect();
    sorted.sort_by(|a, b| a.peak_mean.partial_cmp(&b.peak_mean).unwrap_or(std::cmp::Ordering::Equal));

    println!(
        "{:<32} {:>11} {:>11} {:>10} {:>10} {:>9} {:>9}",
        "réglage", "écurie moy", "écurie max", "Δ effectif", "score méd.", "Δ score", "retraits"
    );
    println!("{}", "-".repeat(98));
    for row in sorted {
        println!(
            "{:<32} {:>11.0} {:>11} {:>+10.0} {:>9.2} M {:>+8.2} M {:>9.0}",
            row.label,
            row.peak_mean,
            row.peak_max,
            row.peak_mean - reference,
            row.score / 1e6,
            (row.score - ref_score) / 1e6,
            row.retrievals,
        );
    }
    // --- le produit, sur les seuls réglages qui ont bougé ---------------------
    //
    // Le balayage par coordonnée dit lesquels comptent ; il ne dit rien de leurs
    // interactions. Quatre ordres, deux portes, deux couronnes et le clonage
    // aveugle au sexe : trente-deux configurations, dix minutes, et c'est là que
    // se trouve la combinaison si elle existe. Les six réglages mesurés
    // **exactement nuls** n'y sont pas — les reprendre serait payer du bruit.
    println!("\n--- le produit sur ce qui a bougé ---");
    let mut combos: Vec<Row> = Vec::new();
    for (oname, ordering) in [
        ("TopDown", Ordering::TopDown),
        ("BottomUp", Ordering::BottomUp),
        ("RoundRobin", Ordering::RoundRobin),
        ("BigToSmallByRank", Ordering::BigToSmallByRank),
    ] {
        for (gname, gating) in [("odd", Gating::OddOnly), ("partout", Gating::Everywhere)] {
            for (cname, crowning) in [
                ("partenaire", Crowning::PartnerThenPrice),
                ("prix", Crowning::PriceOnly),
            ] {
                for (sname, blind) in [("sexé", false), ("aveugle", true)] {
                    let label = format!("{oname}/{gname}/{cname}/{sname}");
                    combos.push(measure(&label, &economy, || {
                        let mut base = baseline(&economy);
                        base.crowning = crowning;
                        base.sex_blind_cloning = blind;
                        base.with_ordering(ordering, gating)
                    }));
                }
            }
        }
    }
    // Rangé par effectif : c'est ce qu'on cherche. Le score départage à égalité.
    combos.sort_by(|a, b| {
        a.peak_mean
            .partial_cmp(&b.peak_mean)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then(b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal))
    });
    println!(
        "{:<34} {:>11} {:>11} {:>10} {:>10} {:>9}",
        "ordre/porte/couronne/clonage", "écurie moy", "écurie max", "Δ effectif", "score méd.", "Δ score"
    );
    println!("{}", "-".repeat(90));
    for row in combos.iter().take(12) {
        println!(
            "{:<34} {:>11.0} {:>11} {:>+10.0} {:>9.2} M {:>+8.2} M",
            row.label,
            row.peak_mean,
            row.peak_max,
            row.peak_mean - reference,
            row.score / 1e6,
            (row.score - ref_score) / 1e6,
        );
    }
    let best_score = combos
        .iter()
        .max_by(|a, b| a.score.partial_cmp(&b.score).unwrap_or(std::cmp::Ordering::Equal));
    if let Some(row) = best_score {
        println!(
            "\nMeilleur score du produit : {} — {:.2} M ({:+.2} M) pour {:.0} montures.",
            row.label,
            row.score / 1e6,
            (row.score - ref_score) / 1e6,
            row.peak_mean
        );
    }
    let under = combos.iter().filter(|r| r.peak_max <= economy.stable_places).count();
    println!(
        "Combinaisons qui tiennent dans les {} places **au pire cas** : {} sur {}.",
        economy.stable_places,
        under,
        combos.len()
    );

    println!(
        "\nΔ contre la référence, qui tient {:.0} montures au pic pour {:.2} M.",
        reference,
        ref_score / 1e6
    );
    println!(
        "Un réglage n'est intéressant que s'il descend l'effectif **sans** rendre le score :\n\
         l'écurie du jeu tient {} places.",
        economy.stable_places
    );
}
