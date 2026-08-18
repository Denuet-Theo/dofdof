//! Fige ce que **l'échelle joue** : l'écurie qui entre, la fournée qui sort.
//!
//! ```sh
//! cargo run --release -p breeding-neat --bin dump-ladder-policy -- \
//!   ../scripts/fixtures/ladder-policy-parity.json
//! ```
//!
//! `dump-ladder` fige déjà le **plan** de l'échelle — quelles couleurs, quelles
//! recettes. Il ne dit rien de ce qu'elle en fait quand on lui donne une écurie
//! et vingt places. C'est ce que celui-ci fige, et c'est la moitié qui décide.
//!
//! ## Pourquoi la comparaison peut être exacte
//!
//! Aucun hasard n'entre : `LadderPolicy::plan` ne tire rien du `Rng`. Les listes
//! rendues sont donc une fonction de l'écurie et des prix, et le portage doit
//! rendre les mêmes entiers — pas à une tolérance près, exactement.
//!
//! Les seules divergences possibles sont des ordres : l'ordre des groupes, celui
//! des couples dans `by_target`, celui des couleurs dans un étage. C'est
//! précisément ce qu'on veut verrouiller, parce qu'aucun écran ne le montre.
//!
//! ## Ce que la référence n'inclut pas
//!
//! Le sommet reste à `Summit::Hold`, son défaut des deux côtés : la branche ne
//! s'exécute donc jamais et son absence du portage est sans effet. La moisson,
//! elle, est **allumée** — elle l'est par défaut, et le portage l'a maintenant.
//!
//! Les **clonages** et les **sacrifices** sont rendus tels quels pour mémoire,
//! mais `check-ladder-policy.mjs` ne les compare pas : ils viennent de
//! `clone_by_generation`, qui n'est pas dans ce portage-ci.

use breeding_sim::config::Prices;
use breeding_sim::economy::{Draws, Policy, Rng, Strategy, UnitPlan, UnitView, starting_stable};
use breeding_sim::ladder::{LadderPolicy, Route};
use breeding_sim::sample::{SampleConfig, sample_stable};
use breeding_sim::stable::Sex;
use breeding_sim::trees::{Catalog, muldo};

const CASES: u32 = 40;

/// Le plan tel que le portage le compare : des listes d'entiers, rien d'autre.
fn plan_json(catalog: &Catalog, plan: &UnitPlan) -> serde_json::Value {
    serde_json::json!({
        "purchases": plan.purchases.iter()
            .map(|&(color, sex)| serde_json::json!([
                catalog.slug(color),
                if sex == Sex::Male { "M" } else { "F" }
            ]))
            .collect::<Vec<_>>(),
        "crossings": plan.crossings,
        "clonings": plan.clonings,
        "sacrifices": plan.sacrifices,
    })
}

fn main() {
    let target = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "../scripts/fixtures/ladder-policy-parity.json".into());

    let catalog = muldo();
    let base = Prices::load_default()
        .map(|prices| prices.economy)
        .unwrap_or_else(|error| {
            eprintln!("{error}");
            std::process::exit(1);
        });
    let sampling = SampleConfig::default();

    let mut cases = Vec::with_capacity(CASES as usize);
    for case in 0..CASES {
        let economy = base.for_run(&catalog, &Draws::new(case.wrapping_mul(2_246_822_519)));
        let stable = if case % 2 == 0 {
            sample_stable(
                &catalog,
                &mut Rng::new(case.wrapping_mul(2_654_435_761)),
                &sampling,
            )
        } else {
            starting_stable(&catalog, &economy, &Draws::new(case.wrapping_mul(40_503)))
        };

        // Le niveau par défaut : l'échelle non réglée. `tuned_for` est un levier
        // séparé, qui n'est pas dans ce portage.
        let strategy = Strategy::default();
        let unit = 0;
        let capacity = [4usize, 10, 25, 50][case as usize % 4];
        let kamas = economy.starting_kamas * (1 + case as i64 % 3);

        let view = UnitView {
            catalog: &catalog,
            economy: &economy,
            stable: &stable,
            kamas,
            unit,
            strategy,
            capacity,
        };

        let mut policy = LadderPolicy::new(&catalog, Route::default());
        let plan = policy.plan(&view, &mut Rng::new(1));

        let mounts: Vec<serde_json::Value> = stable
            .mounts
            .iter()
            .map(|mount| {
                serde_json::json!({
                    "color": catalog.slug(mount.color),
                    "sex": if mount.sex == Sex::Male { "M" } else { "F" },
                    "fertile": mount.fertile,
                    "cycled": mount.cycled,
                    "level": mount.level,
                    "parents": mount.parents.map(|[a, b]| [catalog.slug(a), catalog.slug(b)]),
                })
            })
            .collect();

        cases.push(serde_json::json!({
            "kamas": kamas,
            "capacity": capacity,
            // Ce que la politique retire du solde pour ouvrir la fournée, et qui
            // borne donc ce qu'elle peut acheter. C'est `batch_cost` et non
            // `unit_load` : la première est le forfait que `LadderPolicy` déduit,
            // la seconde le carburant que `feasible` facture à la recherche. Les
            // confondre faisait acheter le portage à côté du Rust sur 20 cas.
            "loadKamas": economy.batch_cost,
            "mountLevel": economy.mount_level,
            "economy": {
                "starterPrice": economy.starter_price,
                "genetonValue": economy.geneton_value,
                "optimakinaBonus": economy.optimakina_bonus,
                "values": (0..catalog.len())
                    .map(|color| serde_json::json!([
                        catalog.slug(color as u16),
                        economy.value_of(&catalog, color as u16)
                    ]))
                    .collect::<Vec<_>>(),
            },
            "crown": catalog.slug(
                policy.ladder().summit.first().copied().unwrap_or_default()
            ),
            "mounts": mounts,
            "plan": plan_json(&catalog, &plan),
        }));
    }

    let document = serde_json::json!({ "cases": cases });
    match std::fs::write(&target, serde_json::to_string(&document).unwrap_or_default()) {
        Ok(()) => println!("{CASES} fournées écrites dans {target}"),
        Err(error) => {
            eprintln!("{target} : {error}");
            std::process::exit(1);
        }
    }
}
