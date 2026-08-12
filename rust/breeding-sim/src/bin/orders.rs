//! Dans quel ordre lancer les croisements — les cinq ordres, mesurés.
//!
//! ```sh
//! cargo run --release -p breeding-sim --bin orders
//! ```
//!
//! ## La question
//!
//! Les places d'enclos sont le facteur rare : `capacity` en borne le nombre par
//! fournée, et **le premier servi mange le budget du dernier**. L'échelle sait
//! quoi produire — l'arbre le lui dit, et la règle d'admissibilité écarte le
//! reste — mais rien dans l'arbre ne dit dans quel *ordre*. C'est la dernière
//! inconnue de la politique écrite à la main, et cinq réponses se défendent :
//!
//! | | ordre | seuil |
//! | --- | --- | --- |
//! | ancien défaut | haut→bas, étage vidé | impaires seulement |
//! | 1 | bas→haut, étage vidé | partout |
//! | 2 | haut→bas, étage vidé | aucun |
//! | 3 | haut→bas, un par étage par tour | aucun |
//! | 4 | du plus fourni au moins fourni | aucun |
//!
//! Le cas 2 est l'ancien défaut **moins son seuil** : la comparaison isole donc
//! aussi ce que le seuil rapportait, ce qu'aucune mesure ne disait. Réponse :
//! rien, il coûtait. Le cas 2 **est** devenu le défaut, et ce binaire reste le
//! relevé qui l'a décidé.
//!
//! ## Ce que la mesure ne touche pas
//!
//! Un seul bouton. La règle d'admissibilité, le choix du retard relatif à
//! l'intérieur d'un étage, la moisson, les achats de gen 1 et le clonage sont
//! identiques pour les cinq. En particulier le « on complète avec les gen 1 qui
//! manquent le plus » du cas 1 n'est **pas** appliqué : c'est la phase d'achat,
//! aujourd'hui un tourniquet aveugle sur les blocs, donc un troisième levier.
//! L'inclure ici mêlerait deux effets.
//!
//! ## Pourquoi apparier les graines
//!
//! La dispersion d'une partie dépasse largement l'écart entre deux ordres — les
//! déciles du dépôt vont de 47 à 75 M pour une médiane à 60. Comparer deux
//! médianes indépendantes ne trancherait rien. On rejoue donc **la même graine**
//! sous les deux ordres et on lit la loi des écarts : `t` dit si l'écart survit
//! au bruit, et le compte de parties gagnées dit s'il est général ou porté par
//! quelques tirages.

use breeding_sim::audit::Audit;
use breeding_sim::config::Prices;
use breeding_sim::economy::{Economy, MAX_UNITS, RunOutcome, Strategy, play};
use breeding_sim::ladder::{Gating, Ladder, LadderPolicy, Ordering, Route};
use breeding_sim::trees::muldo;

const SEEDS: u32 = 200;

struct Variant {
    name: &'static str,
    ordering: Ordering,
    gating: Gating,
}

/// L'ancien défaut en premier : c'est lui qui sert de témoin à tous les écarts.
/// Il n'est plus ce que la politique fait — le cas 2 l'a remplacé — mais c'est
/// contre lui que la décision s'est prise, donc c'est lui qui reste la référence.
const CANDIDATES: [Variant; 6] = [
    Variant {
        name: "ancien  haut→bas, seuil impair",
        ordering: Ordering::TopDown,
        gating: Gating::OddOnly,
    },
    Variant {
        name: "1.  bas→haut, seuil partout",
        ordering: Ordering::BottomUp,
        gating: Gating::Everywhere,
    },
    Variant {
        name: "2.  haut→bas, sans seuil",
        ordering: Ordering::TopDown,
        gating: Gating::Off,
    },
    Variant {
        name: "3.  haut→bas, un par étage",
        ordering: Ordering::RoundRobin,
        gating: Gating::Off,
    },
    Variant {
        name: "4.  plus fourni d'abord (couleur)",
        ordering: Ordering::BigToSmall,
        gating: Gating::Off,
    },
    Variant {
        name: "4'. plus fourni d'abord (étage)",
        ordering: Ordering::BigToSmallByRank,
        gating: Gating::Off,
    },
];

/// La médiane, au quantile arrondi — la convention de `bench.rs`.
///
/// Sur 200 graines les deux conventions plausibles désignent des rangs
/// différents, 99 et 100, et l'écart se lit : 70,77 M contre 70,80 M pour la
/// même politique. Publier les deux serait pire qu'un chiffre approximatif, donc
/// on prend celle du banc.
fn median(values: &mut [f64]) -> f64 {
    values.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    values[((values.len() - 1) as f64 * 0.5).round() as usize]
}

fn mean(values: &[f64]) -> f64 {
    values.iter().sum::<f64>() / values.len() as f64
}

/// Ce qu'une même graine donne sous deux ordres. `t` est la statistique de
/// Student sur les écarts appariés : au-delà de 2 en valeur absolue, l'écart
/// n'est pas du bruit.
struct Paired {
    delta: f64,
    stderr: f64,
    t: f64,
    wins: usize,
}

fn paired(candidate: &[f64], witness: &[f64]) -> Paired {
    let deltas: Vec<f64> = candidate
        .iter()
        .zip(witness)
        .map(|(a, b)| a - b)
        .collect();
    let n = deltas.len() as f64;
    let delta = mean(&deltas);
    let variance = deltas.iter().map(|d| (d - delta).powi(2)).sum::<f64>() / (n - 1.0);
    let stderr = (variance / n).sqrt();
    Paired {
        delta,
        stderr,
        // Un écart nul sur toutes les graines donne `0/0` : deux ordres qui ne
        // se distinguent jamais valent t = 0, pas NaN.
        t: if stderr > 0.0 { delta / stderr } else { 0.0 },
        wins: deltas.iter().filter(|d| **d > 0.0).count(),
    }
}

/// Une partie par graine, sous un ordre donné. `tuned` remonte le niveau des
/// montures au dernier cran gratuit : c'est le régime réaliste, et il change le
/// nombre de fournées, donc possiblement l'arbitrage entre étages.
fn run(economy: &Economy, ladder: &Ladder, variant: &Variant, tuned: bool) -> Vec<RunOutcome> {
    let catalog = muldo();
    (0..SEEDS)
        .map(|seed| {
            let mut policy = LadderPolicy::with_ladder(ladder.clone())
                .with_ordering(variant.ordering, variant.gating);
            if tuned {
                policy = policy
                    .with_strategies([Strategy::default(); MAX_UNITS])
                    .tuned_for(economy);
            }
            play(&catalog, economy, &mut policy, seed)
        })
        .collect()
}

/// Les croisements que le jeu annoncerait « rien à gagner ».
///
/// Zéro par construction — la règle d'admissibilité les écarte avant que l'ordre
/// n'entre en jeu — mais c'est la propriété que l'échelle revendique, et un
/// réordonnancement est exactement le genre de changement qui pourrait la casser
/// sans que le score bouge. On la recompte donc pour chaque ordre.
fn barren(economy: &Economy, ladder: &Ladder, variant: &Variant) -> usize {
    let catalog = muldo();
    (0..25u32)
        .map(|seed| {
            let mut audit = Audit::new(
                LadderPolicy::with_ladder(ladder.clone())
                    .with_ordering(variant.ordering, variant.gating),
            );
            play(&catalog, economy, &mut audit, seed);
            audit.tally.barren + audit.tally.impossible
        })
        .sum()
}

fn table(label: &str, economy: &Economy, ladder: &Ladder, tuned: bool) {
    println!("\n=== {label} ===");
    println!(
        "{:<34} {:>10} {:>10} {:>7} {:>7} {:>10} {:>7} {:>9}",
        "ordre", "médiane", "moyenne", "crois.", "gen10", "écart", "t", "gagne"
    );
    println!("{}", "-".repeat(102));

    let witness: Vec<f64> = run(economy, ladder, &CANDIDATES[0], tuned)
        .iter()
        .map(|o| o.score as f64)
        .collect();

    for (at, variant) in CANDIDATES.iter().enumerate() {
        let outcomes = run(economy, ladder, variant, tuned);
        let scores: Vec<f64> = outcomes.iter().map(|o| o.score as f64).collect();
        let crossings = mean(&outcomes.iter().map(|o| o.crossings as f64).collect::<Vec<_>>());
        let gen10 = mean(&outcomes.iter().map(|o| o.gen10_held as f64).collect::<Vec<_>>());
        let comparison = paired(&scores, &witness);

        // Le témoin ne se compare pas à lui-même : afficher `+0,00 M, t = 0`
        // laisserait croire à une mesure là où il n'y a qu'une définition.
        let (gap, t, wins) = if at == 0 {
            ("     témoin".to_string(), String::new(), String::new())
        } else {
            (
                format!("{:+7.2} M", comparison.delta / 1e6),
                format!("{:>7.2}", comparison.t),
                format!("{:>4}/{SEEDS}", comparison.wins),
            )
        };
        println!(
            "{:<34} {:>8.2} M {:>8.2} M {:>7.0} {:>7.2} {gap:>10} {t:>7} {wins:>9}",
            variant.name,
            median(&mut scores.clone()) / 1e6,
            mean(&scores) / 1e6,
            crossings,
            gen10,
        );
        if at > 0 && comparison.t.abs() > 2.0 {
            println!(
                "{:>45}erreur type {:.2} M",
                "",
                comparison.stderr / 1e6
            );
        }
    }
}

/// Le seuil ou l'ordre : lequel des deux porte l'écart ?
///
/// La question se pose parce que le cas 1 change les deux à la fois — il monte
/// du bas *et* ajourne partout — et qu'on ne saurait pas lequel a parlé. On
/// croise donc les trois portées de seuil avec les trois ordres « étage vidé ».
fn grid(economy: &Economy, ladder: &Ladder, tuned: bool) {
    println!("\n=== seuil × ordre (médiane, pool hérité) ===");
    println!(
        "{:<24} {:>12} {:>12} {:>12}",
        "ordre", "impaires", "partout", "aucun"
    );
    println!("{}", "-".repeat(64));
    for (name, ordering) in [
        ("haut→bas", Ordering::TopDown),
        ("bas→haut", Ordering::BottomUp),
        ("un par étage", Ordering::RoundRobin),
        ("plus fourni (couleur)", Ordering::BigToSmall),
        ("plus fourni (étage)", Ordering::BigToSmallByRank),
    ] {
        let cells: Vec<String> = [Gating::OddOnly, Gating::Everywhere, Gating::Off]
            .into_iter()
            .map(|gating| {
                let variant = Variant {
                    name,
                    ordering,
                    gating,
                };
                let mut scores: Vec<f64> = run(economy, ladder, &variant, tuned)
                    .iter()
                    .map(|o| o.score as f64)
                    .collect();
                format!("{:>10.2} M", median(&mut scores) / 1e6)
            })
            .collect();
        println!("{name:<24} {}", cells.join(" "));
    }
}

/// Ce que le seuil vaut, cran par cran.
///
/// `RUNG_THRESHOLD = 10` est venu du dicté et sa propre doc le dit : « c'est le
/// premier réglage à faire varier ». La grille répond « aucun seuil » ; reste à
/// savoir si c'est le 10 qui est mauvais ou l'idée d'ajourner. Un balayage le
/// tranche, et il est bon marché — le seuil ne coûte rien à changer.
///
/// Zéro n'ajourne jamais : `formable < 0` est impossible sur un compte. La
/// première ligne est donc `Gating::Off` par un autre chemin, ce qui sert de
/// contrôle interne au balayage.
fn sweep(economy: &Economy, ladder: &Ladder, tuned: bool) {
    println!("\n=== seuil, cran par cran (haut→bas, impaires, pool hérité) ===");
    println!(
        "{:<8} {:>10} {:>10} {:>8} {:>10} {:>8} {:>10}",
        "seuil", "médiane", "moyenne", "gen10", "écart", "t", "gagne"
    );
    println!("{}", "-".repeat(70));

    let catalog = muldo();
    // La portée est **forcée** à `OddOnly` : c'est le seul réglage où le seuil
    // parle encore. S'appuyer sur le défaut a rendu ce balayage muet le jour où
    // le défaut est passé à `Off` — neuf lignes rigoureusement identiques, et
    // rien pour le dire.
    let sweep_one = |threshold: usize| -> Vec<RunOutcome> {
        (0..SEEDS)
            .map(|seed| {
                let mut policy = LadderPolicy::with_ladder(ladder.clone())
                    .with_ordering(Ordering::TopDown, Gating::OddOnly);
                policy.threshold = threshold;
                if tuned {
                    policy = policy
                        .with_strategies([Strategy::default(); MAX_UNITS])
                        .tuned_for(economy);
                }
                play(&catalog, economy, &mut policy, seed)
            })
            .collect()
    };

    let witness: Vec<f64> = sweep_one(0).iter().map(|o| o.score as f64).collect();

    for threshold in [0usize, 2, 4, 6, 8, 10, 14, 20, 30] {
        let outcomes = sweep_one(threshold);
        let scores: Vec<f64> = outcomes.iter().map(|o| o.score as f64).collect();
        let gen10 = mean(&outcomes.iter().map(|o| o.gen10_held as f64).collect::<Vec<_>>());
        let comparison = paired(&scores, &witness);
        let (gap, t, wins) = if threshold == 0 {
            ("   témoin".to_string(), String::new(), String::new())
        } else {
            (
                format!("{:+7.2} M", comparison.delta / 1e6),
                format!("{:>6.2}", comparison.t),
                format!("{:>4}/{SEEDS}", comparison.wins),
            )
        };
        println!(
            "{threshold:<8} {:>8.2} M {:>8.2} M {gen10:>8.2} {gap:>10} {t:>8} {wins:>10}",
            median(&mut scores.clone()) / 1e6,
            mean(&scores) / 1e6,
        );
    }
}

fn main() {
    let prices = match Prices::load_default() {
        Ok(prices) => prices,
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(1);
        }
    };
    let base = prices.economy;
    // Le pool est ce qui décide de tout ici : avec cent muldos de la gen 2 à la
    // gen 9, les étages hauts ont des ingrédients dès la première fournée et
    // l'ordre arbitre un vrai conflit. En partant de cent gen 1, il n'y a rien à
    // arbitrer avant longtemps — c'est le régime où l'ordre devrait ne rien
    // faire, et c'est donc le contrôle.
    let mut scratch = base;
    scratch.pool_generations = (1, 1);

    let ladder = Ladder::of(&muldo(), Route::Shared);

    println!(
        "{SEEDS} graines appariées, économie {}, horizon {} h, {} places de parc.",
        Prices::default_path().display(),
        base.horizon_hours.unwrap_or(0.0),
        base.total_crossings()
    );
    if let Some(gaps) = prices.report_gaps() {
        println!("⚠ {gaps}");
    }

    table("pool hérité, niveau par défaut", &base, &ladder, false);
    table("pool hérité, niveau réglé", &base, &ladder, true);
    table("départ de zéro, niveau réglé", &scratch, &ladder, true);

    grid(&base, &ladder, true);
    sweep(&base, &ladder, true);

    println!("\n=== croisements sans cible, 25 graines ===");
    for variant in &CANDIDATES {
        let count = barren(&base, &ladder, variant);
        let verdict = if count == 0 { "aucun" } else { "⚠ FUITE" };
        println!("{:<34} {count:>6}  {verdict}", variant.name);
    }
}
