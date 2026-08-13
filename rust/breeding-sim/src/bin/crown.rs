//! Le choix de la couronne a-t-il de la marge ? La question avant la réorientation.
//!
//! ```sh
//! cargo run --release -p breeding-sim --bin crown
//! ```
//!
//! ## Ce qu'on cherche à savoir, et pourquoi dans cet ordre
//!
//! `Ladder::crown` choisit **une** gen 10 à la première fournée — la mieux payée
//! du jour — puis taille le plan dessus et n'y revient jamais. L'en-tête de
//! `ladder.rs` note le défaut : « il ne se réoriente pas… si Prune sort bien et
//! Émeraude mal, rien ne bascule la route vers Corail ».
//!
//! La tentation est d'écrire tout de suite une règle de bascule. C'est l'ordre
//! coûteux. Une règle est un mécanisme — un critère, une hystérésis pour ne pas
//! osciller, un moment où l'appliquer — et rien de tout ça ne vaut d'être écrit
//! si le choix de départ n'a pas de marge.
//!
//! On mesure donc d'abord le **plafond** : forcer chaque gen 10 candidate à tour
//! de rôle sur la même graine, et garder la meilleure **après coup**. C'est ce
//! qu'un oracle gagnerait, donc ce qu'aucune règle ne peut dépasser. Si l'écart à
//! la couronne du prix est nul, la réorientation est sans objet et l'affaire est
//! close pour le prix de vingt lignes.
//!
//! ## Ce que le plafond ne dit pas
//!
//! Il est **optimiste par construction** : l'oracle connaît le résultat de la
//! partie avant de choisir, ce qu'aucune politique ne saura jamais. Un plafond de
//! 5 M ne promet pas 5 M, il autorise à chercher. Un plafond nul, lui, ferme la
//! question.

use breeding_sim::config::Prices;
use breeding_sim::economy::{Economy, MAX_UNITS, Strategy, play};
use breeding_sim::ladder::{Crowning, Ladder, LadderPolicy, Route};
use breeding_sim::trees::{Catalog, ColorId, muldo};

const SEEDS: u32 = 200;

fn mean(values: &[f64]) -> f64 {
    values.iter().sum::<f64>() / values.len() as f64
}

fn median(values: &mut [f64]) -> f64 {
    values.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    values[((values.len() - 1) as f64 * 0.5).round() as usize]
}

/// Une partie, couronne imposée ou non.
fn run(
    catalog: &Catalog,
    economy: &Economy,
    ladder: &Ladder,
    crown: Option<ColorId>,
    seed: u32,
    tuned: bool,
) -> f64 {
    let mut policy = LadderPolicy::with_ladder(ladder.clone());
    if let Some(color) = crown {
        policy = policy.with_forced_crown(color);
    }
    if tuned {
        policy = policy
            .with_strategies([Strategy::default(); MAX_UNITS])
            .tuned_for(economy);
    }
    play(catalog, economy, &mut policy, seed).score as f64
}

fn report(label: &str, economy: &Economy, ladder: &Ladder, tuned: bool) {
    let catalog = muldo();
    let candidates = Ladder::crown_candidates(&catalog, &ladder.blocks);

    println!("\n=== {label} ===");
    println!("{} gen 10 candidates : {:?}", candidates.len(), candidates);
    // La décomposition de chaque candidate : sa gen 9 cible et sa gen 1 partenaire.
    // Le travail de l'arbre ne dépend que de la gen 9 ; si les scores diffèrent à
    // gen 9 égale, c'est le **partenaire** qui décide, donc ce que deviennent les
    // ratés du dernier croisement.
    for &color in &candidates {
        if let Some(recipe) = catalog.color(color).recipes.first() {
            let [a, b] = *recipe;
            let (high, low) = if catalog.generation(a) > catalog.generation(b) { (a, b) } else { (b, a) };
            println!(
                "    {} = {} (gen {}) x {} (gen 1)",
                catalog.slug(color),
                catalog.slug(high),
                catalog.generation(high),
                catalog.slug(low)
            );
        }
    }
    if candidates.len() < 2 {
        println!("  moins de deux choix : il n'y a rien à réorienter.");
        return;
    }

    // Par candidat : ce qu'il rapporte s'il est imposé toute la partie. Sert à
    // voir si l'un domine, ce qui rendrait la couronne du prix simplement fausse
    // plutôt qu'améliorable au cas par cas.
    let mut per_candidate: Vec<(ColorId, Vec<f64>)> = candidates
        .iter()
        .map(|&color| {
            let scores: Vec<f64> = (0..SEEDS)
                .map(|seed| run(&catalog, economy, ladder, Some(color), seed, tuned))
                .collect();
            (color, scores)
        })
        .collect();

    let baseline: Vec<f64> = (0..SEEDS)
        .map(|seed| run(&catalog, economy, ladder, None, seed, tuned))
        .collect();

    // Le travail que chaque couronne réclame, calculé sur l'arbre et non mesuré :
    // c'est le candidat au rôle de critère. S'il prédit le classement à prix
    // plats, `crown` a de quoi arbitrer sans rien deviner.
    let work: std::collections::HashMap<ColorId, f64> = candidates
        .iter()
        .map(|&color| {
            let mut probe = ladder.clone();
            probe.crown_at(&catalog, economy, Some(color));
            (color, probe.work_per_summit())
        })
        .collect();

    // Combien de couleurs voulues du plan **contiennent** chaque gen 1 partenaire.
    // Hypothèse : plus le partenaire sert ailleurs, plus les ratés du dernier
    // croisement retombent sur quelque chose que le plan réclame.
    println!("\n  emploi des gen 1 partenaires dans le plan :");
    let mut partners: Vec<ColorId> = candidates
        .iter()
        .filter_map(|&c| {
            catalog.color(c).recipes.first().map(|&[a, b]| {
                if catalog.generation(a) > catalog.generation(b) { b } else { a }
            })
        })
        .collect();
    partners.sort_unstable();
    partners.dedup();
    {
        let mut probe = ladder.clone();
        probe.crown_at(&catalog, economy, Some(candidates[0]));
        for &partner in &partners {
            let uses = probe
                .recipe_of
                .values()
                .filter(|recipe| recipe.contains(&partner))
                .count();
            let in_block = probe.blocks.iter().filter(|b| b.contains(&partner)).count();
            println!(
                "    {:<12} : {uses} recettes du plan, {in_block} bloc(s)",
                catalog.slug(partner)
            );
        }
    }

    println!(
        "\n{:<28} {:>11} {:>11} {:>8}   écart au prix (moyenne)",
        "couronne", "médiane", "moyenne", "travail"
    );
    println!("{}", "-".repeat(88));
    println!(
        "{:<28} {:>9.2} M {:>9.2} M {:>8}   témoin",
        "prix du jour (défaut)",
        median(&mut baseline.clone()) / 1e6,
        mean(&baseline) / 1e6,
        ""
    );
    for (color, scores) in &per_candidate {
        let delta = mean(scores) - mean(&baseline);
        println!(
            "{:<28} {:>9.2} M {:>9.2} M {:>8.1}   {:+8.2} M",
            format!("imposée : {color:?}"),
            median(&mut scores.clone()) / 1e6,
            mean(scores) / 1e6,
            work.get(color).copied().unwrap_or(0.0),
            delta / 1e6
        );
    }

    // L'oracle : par graine, la meilleure des couronnes imposées.
    let mut oracle = Vec::with_capacity(SEEDS as usize);
    let mut chosen: std::collections::HashMap<ColorId, usize> = std::collections::HashMap::new();
    let mut beats_price = 0;
    for seed in 0..SEEDS as usize {
        let mut best = (f64::NEG_INFINITY, per_candidate[0].0);
        for (color, scores) in &per_candidate {
            if scores[seed] > best.0 {
                best = (scores[seed], *color);
            }
        }
        *chosen.entry(best.1).or_default() += 1;
        if best.0 > baseline[seed] {
            beats_price += 1;
        }
        oracle.push(best.0);
    }

    let deltas: Vec<f64> = oracle
        .iter()
        .zip(&baseline)
        .map(|(a, b)| a - b)
        .collect();
    let n = deltas.len() as f64;
    let delta = mean(&deltas);
    let variance = deltas.iter().map(|d| (d - delta).powi(2)).sum::<f64>() / (n - 1.0);
    let stderr = (variance / n).sqrt();

    println!(
        "\noracle (meilleure couronne connue après coup) : {:+.2} M ± {:.2}, \
         bat le prix sur {beats_price}/{SEEDS} graines",
        delta / 1e6,
        stderr / 1e6
    );
    println!("  médiane de l'oracle : {:.2} M", median(&mut oracle.clone()) / 1e6);

    // Quelle couronne l'oracle retient, et à quelle fréquence. Si c'est presque
    // toujours la même, la réorientation n'a rien à voir là-dedans : c'est le
    // critère de `crown` qui choisit mal, et ça se corrige sans rien réorienter.
    let mut tally: Vec<(ColorId, usize)> = chosen.into_iter().collect();
    tally.sort_by_key(|&(color, count)| (std::cmp::Reverse(count), color));
    println!("  l'oracle choisit :");
    for (color, count) in tally {
        println!("    {color:?} : {count}/{SEEDS}");
    }

    // ## La décomposition qui décide de la suite
    //
    // Le plafond de l'oracle mélange deux choses très différentes :
    //
    // - ce qu'un **meilleur critère fixe** rapporterait, c'est-à-dire choisir une
    //   fois pour toutes mieux que « la mieux payée ». Disponible tout de suite,
    //   sans rien réorienter ;
    // - ce qui ne s'obtient qu'en **réagissant** à la partie, donc le seul motif
    //   d'écrire une bascule.
    //
    // Les confondre ferait construire un mécanisme pour un gain qu'un `if` aurait
    // donné. On sépare donc, en prenant le meilleur candidat *à moyenne sur toutes
    // les graines* : c'est le meilleur choix statique possible, et il est lui aussi
    // optimiste — il connaît la moyenne à l'avance.
    let best_static = per_candidate
        .iter()
        .map(|(color, scores)| (mean(scores), *color))
        .fold((f64::NEG_INFINITY, per_candidate[0].0), |best, next| {
            if next.0 > best.0 { next } else { best }
        });
    let base_mean = mean(&baseline);
    let static_gain = best_static.0 - base_mean;
    let oracle_gain = delta;

    println!("\n  décomposition du plafond :");
    println!(
        "    meilleur choix **fixe** ({:?}) : {:+.2} M  ({:.0} % du plafond)",
        best_static.1,
        static_gain / 1e6,
        if oracle_gain > 0.0 { static_gain / oracle_gain * 100.0 } else { 0.0 }
    );
    println!(
        "    ce qui exige de **réagir**        : {:+.2} M  ({:.0} % du plafond)",
        (oracle_gain - static_gain) / 1e6,
        if oracle_gain > 0.0 { (oracle_gain - static_gain) / oracle_gain * 100.0 } else { 0.0 }
    );

    // ## Le contrôle qui décide si ce plafond veut dire quelque chose
    //
    // L'oracle prend le **max sur vingt** candidats à chaque graine. Même si les
    // vingt couronnes se valaient exactement, ce max dépasserait n'importe lequel
    // d'entre eux : c'est de la sélection de bruit, pas un gain. Un plafond de
    // 11 M pourrait donc n'être qu'un artefact de méthode.
    //
    // Ce qui tranche : **où se classe la règle du prix** parmi les vingt, graine
    // par graine. Si elle est déjà première ou deuxième presque partout, il n'y a
    // rien à réorienter et le plafond est un mirage. Si elle est au milieu, le
    // choix est réellement mauvais sur cette graine-là, et une règle qui saurait
    // le voir gagnerait.
    let mut ranks: Vec<usize> = Vec::with_capacity(SEEDS as usize);
    let mut spread: Vec<f64> = Vec::with_capacity(SEEDS as usize);
    for seed in 0..SEEDS as usize {
        let mut scores: Vec<f64> = per_candidate.iter().map(|(_, s)| s[seed]).collect();
        // Rang de la règle du prix : combien de candidats la battent, plus un.
        let better = scores.iter().filter(|&&s| s > baseline[seed]).count();
        ranks.push(better + 1);
        // L'étendue entre le meilleur et le médian des candidats : ce que la
        // graine offre réellement comme choix.
        scores.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        let top = scores[scores.len() - 1];
        let mid = scores[scores.len() / 2];
        spread.push(top - mid);
    }
    let mean_rank = ranks.iter().sum::<usize>() as f64 / ranks.len() as f64;
    let first = ranks.iter().filter(|&&r| r == 1).count();
    let top_three = ranks.iter().filter(|&&r| r <= 3).count();

    println!("\n  contrôle — le max sur {} candidats est biaisé vers le haut :", per_candidate.len());
    println!(
        "    rang moyen de la règle du prix : {mean_rank:.1} sur {} \
         (1re sur {first}/{SEEDS}, top 3 sur {top_three}/{SEEDS})",
        per_candidate.len()
    );
    println!(
        "    écart meilleur − médian des candidats : {:.2} M en moyenne",
        mean(&spread) / 1e6
    );

    per_candidate.clear();
}

fn main() {
    let prices = Prices::load_default().expect("economy.toml");
    let base = prices.economy;
    let mut scratch = base;
    scratch.pool_generations = (1, 1);

    let ladder = Ladder::of(&muldo(), Route::default());

    println!(
        "{SEEDS} graines appariées. La couronne est tirée par partie \
         (`Economy::for_run` donne un prix par gen 10), donc le meilleur choix \
         change d'une graine à l'autre."
    );

    report("pool hérité, niveau réglé", &base, &ladder, true);
    report("départ de zéro, niveau réglé", &scratch, &ladder, true);

    // ## Le test qui dit d'où vient le plafond
    //
    // Passer les prix de l'uniforme à la cloche (#129) n'a coûté que 9 % du
    // plafond : 11,46 M devenus 10,42 M. Si celui-ci venait des prix, il aurait
    // fondu. Reste une seule explication à écarter, et elle se teste en deux
    // lignes : **aplatir les prix**. Toutes les gen 10 au même tarif, donc aucune
    // raison de préférer l'une pour ce qu'elle rapporte.
    //
    // Ce qui survit alors ne peut venir que de la **difficulté d'atteinte** : les
    // sous-arbres des vingt candidates ne coûtent pas le même travail, et `crown`
    // choisit sur le prix au lieu de choisir sur ce coût.
    let mut flat = base;
    flat.top_value_range = (flat.top_value, flat.top_value);
    report("prix aplatis — toutes à 600 000", &flat, &ladder, true);

    // ## Le critère, mis à l'épreuve
    //
    // Le relevé ci-dessus dit que le **partenaire** décide, pas le prix.
    // `Crowning::PartnerThenPrice` prend donc le partenaire le plus employé par le
    // plan, puis le mieux payé parmi les candidates qui le portent. Reste à savoir
    // si ce que ça gagne en difficulté d'atteinte dépasse ce que ça abandonne en
    // prix — les gen 10 vont de 300 000 à 1 000 000, donc forcer le partenaire
    // coûte parfois cher.
    println!("\n=== le critère : « partenaire puis prix » − « prix seul » ===");
    duel("pool hérité, niveau réglé", &base, &ladder, true);
    duel("pool hérité, niveau défaut", &base, &ladder, false);
    duel("départ de zéro, niveau réglé", &scratch, &ladder, true);
}

/// Le critère contre le prix seul, sur graines appariées.
fn duel(label: &str, economy: &Economy, ladder: &Ladder, tuned: bool) {
    let catalog = muldo();
    let run = |mode: Crowning, seed: u32| {
        let mut policy = LadderPolicy::with_ladder(ladder.clone());
        policy.crowning = mode;
        if tuned {
            policy = policy
                .with_strategies([Strategy::default(); MAX_UNITS])
                .tuned_for(economy);
        }
        play(&catalog, economy, &mut policy, seed)
    };

    let seeds = 1_000u32;
    let mut deltas = Vec::new();
    let mut wins = 0;
    // Les égalités comptent : quand le prix tombe déjà sur le bon partenaire, les
    // deux critères jouent la même partie. Les confondre avec des défaites ferait
    // lire « gagne la moitié du temps » là où il gagne la plupart des parties où il
    // change quelque chose.
    let mut ties = 0;
    let mut gen10 = (0.0, 0.0);
    for seed in 0..seeds {
        let after = run(Crowning::PartnerThenPrice, seed);
        let before = run(Crowning::PriceOnly, seed);
        let delta = after.score as f64 - before.score as f64;
        if delta > 0.0 {
            wins += 1;
        } else if delta == 0.0 {
            ties += 1;
        }
        deltas.push(delta);
        gen10.0 += after.gen10_held as f64;
        gen10.1 += before.gen10_held as f64;
    }

    let n = deltas.len() as f64;
    let delta = mean(&deltas);
    let variance = deltas.iter().map(|d| (d - delta).powi(2)).sum::<f64>() / (n - 1.0);
    let stderr = (variance / n).sqrt();
    println!(
        "{label:<32} {:+7.2} M ± {:.2}, t = {:>6.2}, gagne {wins:>4}/{} décidées sur {seeds} ({ties} nulles), gen10 {:.2} → {:.2}",
        delta / 1e6,
        stderr / 1e6,
        if stderr > 0.0 { delta / stderr } else { 0.0 },
        seeds - ties,
        gen10.1 / n,
        gen10.0 / n,
    );
}
