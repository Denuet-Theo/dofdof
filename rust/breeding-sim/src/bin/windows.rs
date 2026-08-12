//! Le réglage du rythme, une fois les fenêtres de disponibilité prises en compte.
//!
//! ```sh
//! cargo run --release -p breeding-sim --bin windows
//! ```
//!
//! ## La question
//!
//! `tuned_for` choisit le niveau des montures en maximisant `horizon / durée` : le
//! plus de fournées possible **en supposant qu'on puisse agir à tout instant**.
//! Cette hypothèse vient de tomber (`Economy::availability`), et rien ne dit que
//! son choix survit.
//!
//! Ce que les fenêtres changent au problème n'est pas une pente mais une falaise.
//! Lancée à 20 h, une fournée de 5 h 30 finit à 1 h 30 et on relance aussitôt ;
//! une de 6 h 30 finit à 2 h 30, une demi-heure après la fermeture, et attend
//! jusqu'à 7 h 30. Trente minutes de dépassement coûtent cinq heures. Un
//! optimiseur aveugle aux fenêtres n'a aucune raison de préférer la première.
//!
//! ## Ce qu'on balaye
//!
//! Le niveau des montures, qui est ce que `tuned_for` règle, et la bande uniforme,
//! qui est ce qui décide grossièrement de la durée. Pour chacun : les fournées
//! réellement jouées, les heures passées à attendre une fenêtre, et le score.
//!
//! Le score est le seul juge. Plus de fournées coûte plus de carburant — la bande
//! la plus rapide vaut cinq fois la plus lente au point — donc le compte de
//! fournées ne suffit pas à trancher, et c'est précisément l'arbitrage qu'un
//! réglage à la main raterait.

use breeding_sim::config::Prices;
use breeding_sim::economy::{Economy, MAX_UNITS, Policy, Strategy, mount_xp_for_level, play};
use breeding_sim::schedule::GAUGES;
use breeding_sim::ladder::{Ladder, LadderPolicy, Route, Tuning};
use breeding_sim::schedule::schedule;
use breeding_sim::trees::muldo;

const SEEDS: u32 = 200;

fn median(values: &mut [f64]) -> f64 {
    values.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    values[((values.len() - 1) as f64 * 0.5).round() as usize]
}

fn mean(values: &[f64]) -> f64 {
    values.iter().sum::<f64>() / values.len() as f64
}

/// Une configuration jouée sur toutes les graines.
fn measure(economy: &Economy, ladder: &Ladder, strategy: Strategy) -> (f64, f64, f64, f64) {
    let catalog = muldo();
    let outcomes: Vec<_> = (0..SEEDS)
        .map(|seed| {
            let mut policy = LadderPolicy::with_ladder(ladder.clone())
                .with_strategies([strategy; MAX_UNITS]);
            play(&catalog, economy, &mut policy, seed)
        })
        .collect();
    let mut scores: Vec<f64> = outcomes.iter().map(|o| o.score as f64).collect();
    (
        median(&mut scores),
        mean(&outcomes.iter().map(|o| f64::from(o.loads_paid)).collect::<Vec<_>>()),
        mean(&outcomes.iter().map(|o| o.hours_waiting).collect::<Vec<_>>()),
        mean(&outcomes.iter().map(|o| o.gen10_held as f64).collect::<Vec<_>>()),
    )
}

/// Ce que la recherche de bande gagne, et ce qu'elle casse.
///
/// `rejected` compte les fournées que le moteur refuse faute de kamas : c'est la
/// vérification de solvabilité, et c'est elle qui a empêché de basculer le défaut.
fn duel_tuning(label: &str, economy: &Economy, ladder: &Ladder) {
    let catalog = muldo();
    let run = |tuning: Tuning, seed: u32| {
        let mut policy = LadderPolicy::with_ladder(ladder.clone())
            .with_strategies([Strategy::default(); MAX_UNITS]);
        policy.tuning = tuning;
        let policy = policy.tuned_for(economy);
        let mut policy = policy;
        play(&catalog, economy, &mut policy, seed)
    };

    let mut after = Vec::new();
    let mut before = Vec::new();
    let mut rejected = 0u32;
    let mut gen10 = (0.0, 0.0);
    for seed in 0..SEEDS {
        let a = run(Tuning::BandAndLevel, seed);
        let b = run(Tuning::LastFreeStep, seed);
        rejected += a.rejected_loads;
        gen10.0 += a.gen10_held as f64;
        gen10.1 += b.gen10_held as f64;
        after.push(a.score as f64);
        before.push(b.score as f64);
    }

    println!(
        "{label:<18} {:>8.2} M → {:>8.2} M  ({:+7.2} M), gen10 {:.1} → {:.1}, \
         {rejected} fournées refusées",
        median(&mut before.clone()) / 1e6,
        median(&mut after.clone()) / 1e6,
        (median(&mut after.clone()) - median(&mut before.clone())) / 1e6,
        gen10.1 / f64::from(SEEDS),
        gen10.0 / f64::from(SEEDS),
    );
}

fn sweep(label: &str, economy: &Economy, ladder: &Ladder, band: usize) {
    println!("\n=== {label} — bande {band} ===");
    println!(
        "{:<8} {:>8} {:>10} {:>10} {:>9} {:>9}",
        "niveau", "durée", "médiane", "fournées", "attente", "gen10"
    );
    println!("{}", "-".repeat(60));

    let mut best: Option<(f64, u16)> = None;
    for level in [1u16, 12, 23, 36, 50, 67, 85, 100, 120] {
        let strategy = Strategy {
            bands: [band; GAUGES],
            level,
            ..Strategy::default()
        };

        let plan = schedule(economy, strategy.bands, mount_xp_for_level(level));
        let hours = plan.hours + economy.overhead_hours;

        let (score, loads, waiting, gen10) = measure(economy, ladder, strategy);
        if best.is_none_or(|(top, _)| score > top) {
            best = Some((score, level));
        }
        println!(
            "{level:<8} {:>7.2}h {:>8.2} M {loads:>10.1} {waiting:>8.1}h {gen10:>9.2}",
            hours,
            score / 1e6,
        );
    }
    if let Some((score, level)) = best {
        println!("  meilleur : niveau {level} à {:.2} M", score / 1e6);
    }
}

fn main() {
    let prices = Prices::load_default().expect("economy.toml");
    let economy = prices.economy;
    let ladder = Ladder::of(&muldo(), Route::default());

    if !economy.has_windows() {
        println!("Aucune fenêtre dans economy.toml : il n'y a rien à mesurer ici.");
        return;
    }
    println!(
        "{SEEDS} graines. {:.0} h par semaine devant le jeu sur 168, soit {:.0} %.",
        economy.weekly_hours(),
        economy.weekly_hours() / 168.0 * 100.0
    );
    println!(
        "Horizon {} h. Les jauges tournent en continu ; seules les actions attendent.",
        economy.horizon_hours.unwrap_or(0.0)
    );

    // Ce que `tuned_for` choisit, pour avoir le témoin sous les yeux.
    let tuned = LadderPolicy::with_ladder(ladder.clone())
        .with_strategies([Strategy::default(); MAX_UNITS])
        .tuned_for(&economy);
    let chosen = tuned.strategy(0);
    let plan = schedule(&economy, chosen.bands, mount_xp_for_level(chosen.level));
    println!(
        "\n`tuned_for` choisit le niveau {} en bande {:?} — {:.2} h par fournée.",
        chosen.level,
        chosen.bands[0],
        plan.hours + economy.overhead_hours
    );
    let (score, loads, waiting, gen10) = measure(&economy, &ladder, chosen);
    println!(
        "  il rend {:.2} M, {loads:.1} fournées, {waiting:.1} h d'attente, {gen10:.2} gen 10.",
        score / 1e6
    );

    // ## Le levier, sur les deux régimes
    //
    // Le balayage dit qu'une autre bande vaut trente millions. Reste à savoir ce
    // qu'elle coûte ailleurs, et c'est là que se joue la décision de basculer le
    // défaut ou non.
    println!("\n=== `Tuning::BandAndLevel` − `LastFreeStep` ===");
    let mut scratch_economy = economy;
    scratch_economy.pool_generations = (1, 1);
    for (label, eco) in [("pool hérité", &economy), ("départ de zéro", &scratch_economy)] {
        duel_tuning(label, eco, &ladder);
    }

    // Les bandes uniformes, du plus lent au plus rapide.
    for band in 0..4 {
        sweep("avec fenêtres", &economy, &ladder, band);
    }

    // ## La même chose sans fenêtres
    //
    // Indispensable pour savoir ce qu'on vient de trouver. Si la bande gagnante est
    // la même sans contrainte de disponibilité, alors le défaut de `tuned_for` n'a
    // rien à voir avec les fenêtres : il ne règle que le **niveau** et laisse la
    // bande au défaut, et personne n'avait balayé la bande **au score**. Les
    // fenêtres n'auraient été que l'occasion de le voir.
    let mut open = economy;
    open.availability = [[(0.0, 0.0); breeding_sim::economy::MAX_WINDOWS_PER_DAY];
        breeding_sim::economy::DAYS_PER_WEEK];
    println!("\n\n########## sans fenêtres, pour comparer ##########");
    for band in 0..4 {
        sweep("sans fenêtres", &open, &ladder, band);
    }
}
