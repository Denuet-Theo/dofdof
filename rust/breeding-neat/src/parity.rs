//! Les cas de la **référence de fournée**, générés une seule fois pour deux
//! lecteurs.
//!
//! `dump-ladder-policy` les écrit dans `scripts/fixtures/ladder-policy-parity.json`,
//! et `tests/ladder_policy_parity.rs` vérifie que le Rust les rejoue. Le
//! TypeScript, lui, se compare au fichier. La référence est donc un **contrat à
//! deux côtés** et non une sortie du Rust : sans le test, muter `ladder.rs` ne
//! faisait que réécrire le fichier, et `npm run parity` se déclarait content.
//!
//! C'est ce qui rend `cargo mutants` interprétable ici. Un mutant qui survit
//! n'est pas un mutant équivalent : c'est une ligne de l'échelle que les
//! quarante écuries n'exercent pas, donc une divergence que la garde ne verrait
//! pas passer non plus.
//!
//! Un seul générateur pour les deux, parce qu'un dumper et un test qui
//! fabriquent « les mêmes » cas chacun de son côté finissent par ne plus les
//! fabriquer pareil, et c'est la garde qui mentirait alors.

use breeding_sim::config::Prices;
use breeding_sim::economy::{Draws, Economy, Policy, Rng, Strategy, UnitPlan, UnitView, starting_stable};
use breeding_sim::ladder::{LadderPolicy, Route};
use breeding_sim::sample::{SampleConfig, sample_stable};
use breeding_sim::stable::{Mount, Sex, Stable};
use breeding_sim::trees::{Catalog, family};

pub const CASES: u32 = 40;

/// Une écurie, ce qu'on lui donne, et la fournée que l'échelle en tire.
pub struct Case {
    /// La famille dont l'arbre a servi. La référence en couvre les trois : le
    /// **plan** l'était déjà (`check-ladder-parity.mjs`), la **fournée** ne
    /// l'était pas, et c'est elle qui décide.
    pub family: &'static str,
    pub harvest_stocked: bool,
    /// Refondre aussi les stériles du sommet. Le défaut est `true` ; les cas à
    /// `false` existent pour que `clonable` soit **évalué** — avec `clone_top`
    /// allumé le `||` court-circuite, et cinq mutants y survivaient faute que
    /// la comparaison serve jamais.
    pub clone_top: bool,
    pub kamas: i64,
    pub capacity: usize,
    pub economy: Economy,
    pub stable: Stable,
    pub plan: UnitPlan,
    pub crown: u16,
}

/// Les quarante écuries, deux configurations chacune.
///
/// Rien n'est tiré au hasard à la lecture : les graines sont fixes, donc deux
/// exécutions rendent les mêmes entiers — c'est ce qui autorise une comparaison
/// exacte plutôt qu'à une tolérance près.
pub fn ladder_policy_cases_for(family: &'static str, catalog: &Catalog) -> Vec<Case> {
    let base = Prices::load_default()
        .map(|prices| prices.economy)
        .expect("economy.toml");
    let sampling = SampleConfig::default();

    let mut cases = Vec::new();
    for case in 0..CASES {
        let economy = base.for_run(catalog, &Draws::new(case.wrapping_mul(2_246_822_519)));
        let stable = if case % 2 == 0 {
            sample_stable(
                catalog,
                &mut Rng::new(case.wrapping_mul(2_654_435_761)),
                &sampling,
            )
        } else {
            starting_stable(catalog, &economy, &Draws::new(case.wrapping_mul(40_503)))
        };

        // Le niveau par défaut — `run_case` le pose — : l'échelle non réglée.
        // `tuned_for` est un levier séparé, qui n'est pas dans ce portage.
        let capacity = [4usize, 10, 25, 50][case as usize % 4];
        let kamas = economy.starting_kamas * (1 + case as i64 % 3);

        for stocked in [false, true] {
            cases.push(run_case(
                family, catalog, &economy, &stable, kamas, capacity, stocked, true,
            ));
        }

        // Un cas **insolvable** sur cinq écuries : solde nul, donc
        // `kamas + raised < needed` et l'échelle ne garde que le clonage et
        // l'extraction. Cette branche n'était exercée par aucun des quarante
        // cas — supprimer ses deux champs ne faisait broncher personne, et le
        // portage TypeScript l'a écrite sans filet.
        if case % 5 == 0 {
            cases.push(run_case(
                family, catalog, &economy, &stable, 0, capacity, true, true,
            ));
        }

        // Un cas à `clone_top` éteint sur cinq : sans lui la comparaison de
        // `clonable` n'est jamais atteinte.
        if case % 5 == 1 {
            cases.push(run_case(
                family, catalog, &economy, &stable, kamas, capacity, true, false,
            ));
        }
    }

    // L'écurie qui exerce `clonable` pour de bon : deux stériles **au sommet**,
    // avec `clone_top` éteint puis allumé.
    //
    // Les cas échantillonnés à `clone_top = false` ne suffisaient pas : la
    // comparaison `génération < sommet` ne se distingue de `<=`, ou du `true`
    // constant, que sur une monture qui **est** au sommet. Sans gen 10 stérile
    // au vivier, deux mutants y survivaient encore.
    let economy = base.for_run(catalog, &Draws::new(11));
    for clone_top in [false, true] {
        cases.push(run_case(
            family,
            catalog,
            &economy,
            &top_sterile_stable(catalog),
            economy.starting_kamas,
            10,
            true,
            clone_top,
        ));
    }

    // L'écurie qui départage à sexe égal, construite à la main.
    //
    // Le balayage de `clone_by_generation` ne regarde que le groupe de porté
    // **minimal** : il s'arrête dès qu'un candidat porte plus. Retourner cette
    // comparaison laissait le balayage courir sur tout le vivier, ce que rien ne
    // distinguait — il faut un vivier où le groupe minimal n'offre aucun même
    // sexe, mais où un porté plus haut en offre un.
    let economy = base.for_run(catalog, &Draws::new(7));
    for stocked in [false, true] {
        cases.push(run_case(
            family,
            catalog,
            &economy,
            &tie_break_stable(catalog),
            economy.starting_kamas,
            10,
            stocked,
            true,
        ));
    }

    cases
}

#[allow(clippy::too_many_arguments)]
fn run_case(
    family: &'static str,
    catalog: &Catalog,
    economy: &Economy,
    stable: &Stable,
    kamas: i64,
    capacity: usize,
    harvest_stocked: bool,
    clone_top: bool,
) -> Case {
    let view = UnitView {
        catalog,
        economy,
        stable,
        kamas,
        unit: 0,
        strategy: Strategy::default(),
        capacity,
    };
    let mut policy = LadderPolicy::new(catalog, Route::default());
    policy.harvest_stocked = harvest_stocked;
    policy.clone_top = clone_top;
    let plan = policy.plan(&view, &mut Rng::new(1));
    let crown = policy.ladder().summit.first().copied().unwrap_or_default();
    Case {
        family,
        harvest_stocked,
        clone_top,
        kamas,
        capacity,
        economy: *economy,
        stable: stable.clone(),
        plan,
        crown,
    }
}

/// Deux stériles du **sommet**, de même sexe pour qu'un appariement soit
/// possible dès que `clone_top` l'autorise.
///
/// À `clone_top = false` elles ne se refondent pas et partent donc à
/// l'extraction ; à `true` elles se refondent et l'extraction les épargne. Les
/// deux fournées diffèrent, ce qui rend la comparaison de `clonable`
/// observable.
fn top_sterile_stable(catalog: &Catalog) -> Stable {
    let top = first_of(catalog, catalog.top_generation());
    let sterile = |sex: Sex| Mount {
        color: top,
        sex,
        level: 1,
        fertile: false,
        cycled: false,
        parents: None,
    };
    Stable {
        mounts: vec![sterile(Sex::Male), sterile(Sex::Male)],
    }
}

/// La première couleur de chaque génération demandée.
fn first_of(catalog: &Catalog, generation: u8) -> u16 {
    (0..catalog.len() as u16)
        .find(|&color| catalog.generation(color) == generation)
        .unwrap_or(0)
}

/// Quatre stériles de même génération, aux **portés différents**, dont le groupe
/// le plus bas ne contient que l'autre sexe.
///
/// Trié par porté décroissant, le vivier donne `[9 M, 5 M, 3 F, 3 F]`. La règle
/// apparie la première avec la **moins précieuse** — une femelle — parce que le
/// balayage s'arrête au premier porté supérieur. Sans cet arrêt il remonterait
/// jusqu'au mâle porté 5, et la fournée serait autre.
fn tie_break_stable(catalog: &Catalog) -> Stable {
    let own = first_of(catalog, 2);
    let high = first_of(catalog, 9);
    let middle = first_of(catalog, 5);
    let low = first_of(catalog, 3);
    let sterile = |parents: [u16; 2], sex: Sex| Mount {
        color: own,
        sex,
        level: 1,
        fertile: false,
        cycled: false,
        parents: Some(parents),
    };
    Stable {
        mounts: vec![
            sterile([high, low], Sex::Male),
            sterile([middle, low], Sex::Male),
            sterile([low, low], Sex::Female),
            sterile([low, low], Sex::Female),
        ],
    }
}

/// Les familles que la référence couvre.
pub const FAMILIES: [&str; 3] = ["muldo", "volkorne", "dragodinde"];

/// Les cas des trois familles, dans l'ordre de `FAMILIES`.
pub fn all_cases() -> Vec<(&'static str, Catalog, Vec<Case>)> {
    FAMILIES
        .into_iter()
        .map(|name| {
            let catalog = family(name);
            let cases = ladder_policy_cases_for(name, &catalog);
            (name, catalog, cases)
        })
        .collect()
}
