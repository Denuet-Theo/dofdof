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
//! Le sommet est à `Summit::Target`, son défaut des deux côtés depuis le 27/08.
//! Ce régime-là agit par l'**admissibilité** — `aims_at` contre la couronne — et il
//! est porté, donc la référence le couvre. Ce qu'elle ne couvre pas est la
//! composition de `Summit::Duplicate` : `LadderPolicy::summit` sort au premier test
//! hors de ce régime, donc ni elle ni `summit_partner` ne s'exécutent, et aucun cas
//! de référence ne peut les atteindre. C'est écrit dans `.cargo/mutants.toml`, où
//! leurs mutants sont exclus pour cette raison.
//!
//! La moisson, elle, est **allumée** — elle l'est par défaut, et le portage l'a
//! maintenant.
//!
//! Les **clonages** et les **sacrifices** sont comparés depuis que
//! `clone_by_generation` est porté. Ils ne l'étaient pas, et cette exemption
//! cachait que l'échelle TypeScript n'extrayait rien du tout.
//!
//! ## Les cas viennent d'ailleurs
//!
//! `breeding_neat::parity::ladder_policy_cases` les fabrique, et
//! `tests/ladder_policy_parity.rs` vérifie que le Rust rejoue le fichier écrit
//! ici. Un dumper et un test qui fabriquent « les mêmes » cas chacun de son côté
//! finissent par ne plus les fabriquer pareil.

use breeding_neat::parity::all_cases;
use breeding_sim::economy::UnitPlan;
use breeding_sim::stable::Sex;
use breeding_sim::trees::Catalog;

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

    let mut cases = Vec::new();
    for (_, catalog, family_cases) in all_cases() {
        for case in &family_cases {
            let mounts: Vec<serde_json::Value> = case
                .stable
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
                "family": case.family,
                "harvestStocked": case.harvest_stocked,
                "cloneTop": case.clone_top,
                "kamas": case.kamas,
                "capacity": case.capacity,
                // Ce que la politique retire du solde pour ouvrir la fournée, et
                // qui borne donc ce qu'elle peut acheter. C'est `batch_cost` et
                // non `unit_load` : la première est le forfait que `LadderPolicy`
                // déduit, la seconde le carburant que `feasible` facture à la
                // recherche. Les confondre faisait acheter le portage à côté du
                // Rust sur 20 cas.
                "loadKamas": case.economy.batch_cost,
                "mountLevel": case.economy.mount_level,
                "economy": {
                    "starterPrice": case.economy.starter_price,
                    "genetonValue": case.economy.geneton_value,
                    "optimakinaBonus": case.economy.optimakina_bonus,
                    "values": (0..catalog.len())
                        .map(|color| serde_json::json!([
                            catalog.slug(color as u16),
                            case.economy.value_of(&catalog, color as u16)
                        ]))
                        .collect::<Vec<_>>(),
                },
                "crown": catalog.slug(case.crown),
                "mounts": mounts,
                "plan": plan_json(&catalog, &case.plan),
            }));
        }
    }

    let document = serde_json::json!({ "cases": cases });
    match std::fs::write(&target, serde_json::to_string(&document).unwrap_or_default()) {
        Ok(()) => println!("{} fournées écrites dans {target}", cases.len()),
        Err(error) => {
            eprintln!("{target} : {error}");
            std::process::exit(1);
        }
    }
}
