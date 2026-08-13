//! Fige le **plan de l'échelle** — les trois familles, les deux routes — pour
//! verrouiller le portage de `ladder.rs`.
//!
//! ```sh
//! cargo run --release -p breeding-neat --bin dump-ladder -- \
//!   ../scripts/fixtures/ladder-parity.json
//! ```
//!
//! Sixième référence du portage, et la deuxième — avec `dump-schedule` — à ne
//! dépendre d'aucun champion : le plan se déduit de l'arbre seul, donc son
//! domaine est fini et on le prend **en entier**, trois familles fois deux
//! routes, plutôt qu'un échantillon.
//!
//! ## Ce qu'elle attrape, et que rien d'autre ne voyait
//!
//! `check-ladder.mjs` vérifie des **invariants** — tout ingrédient voulu est
//! fabricable ou achetable, les blocs sont des cliques, un couple qui ne nomme
//! rien est refusé. Ce sont des propriétés, et un plan peut toutes les tenir en
//! étant un autre plan que celui du Rust : il suffit qu'un départage bascule.
//! L'échelle en compte trois — l'ordre des identifiants, le choix de la route,
//! la propagation de la demande — et aucun n'a de conséquence visible à
//! l'écran : le panneau affiche une liste de couleurs parfaitement plausible.
//!
//! D'où une référence qui compare le plan **couleur par couleur** au lieu de le
//! juger sur ses propriétés.
//!
//! ## Ce qu'elle ne couvre pas
//!
//! La **couronne** (`Ladder::crown`), qui choisit la gen 9 à viser et taille le
//! plan de ce qu'elle ne réclame plus. Ce qu'on fige ici est le plan **d'avant
//! le sommet** — `Ladder::of` d'un côté, `ladderOf` de l'autre — et les deux
//! côtés couronnent à part : `crown_at` en Rust, `crownedLadderOf` depuis #160
//! en TypeScript. La couronne dépend des prix de gen 10 tirés par partie
//! (`Economy::for_run`), donc la figer demanderait de figer aussi un barème, ce
//! qui est une seconde référence et pas une colonne de celle-ci.
//!
//! C'est à dire explicitement plutôt qu'à laisser croire que la parité de
//! l'échelle est entière : un plan couronné juste des deux côtés ne se déduit
//! pas d'un plan nu juste des deux côtés.

use breeding_sim::ladder::{Ladder, Route};
use breeding_sim::trees::{Catalog, ColorId};

const FAMILIES: [&str; 3] = ["muldo", "dragodinde", "volkorne"];

fn name_of(route: Route) -> &'static str {
    match route {
        Route::Shared => "shared",
        Route::Disjoint => "disjoint",
    }
}

/// Le plan, en slugs et dans l'ordre du catalogue.
///
/// Les identifiants internés ne veulent rien dire hors de ce processus, mais
/// **leur ordre** est un contrat : c'est lui qui départage les jeux de couleurs
/// à égalité, des deux côtés. On sérialise donc des slugs triés par
/// identifiant — l'ordre du JSON d'origine — et pas par alphabet.
fn plan_of(catalog: &Catalog, route: Route) -> serde_json::Value {
    let ladder = Ladder::of(catalog, route);
    let slug = |color: ColorId| catalog.slug(color).to_owned();

    let mut wanted: Vec<ColorId> = ladder.wanted.iter().copied().collect();
    wanted.sort_unstable();

    let mut recipes: Vec<ColorId> = ladder.recipe_of.keys().copied().collect();
    recipes.sort_unstable();
    let mut demanded: Vec<ColorId> = ladder.demand.keys().copied().collect();
    demanded.sort_unstable();

    serde_json::json!({
        "route": name_of(route),
        "wanted": wanted.iter().map(|&c| slug(c)).collect::<Vec<_>>(),
        "recipeOf": recipes
            .iter()
            .map(|&color| {
                let [a, b] = ladder.recipe_of[&color];
                // La paire garde son ordre : il vient de l'arbre, il est le même
                // des deux côtés, et l'aplatir masquerait une recette lue à
                // l'envers.
                serde_json::json!([slug(color), slug(a), slug(b)])
            })
            .collect::<Vec<_>>(),
        "demand": demanded
            .iter()
            .map(|&color| serde_json::json!([slug(color), ladder.demand[&color]]))
            .collect::<Vec<_>>(),
        // Blocs et sommet sont déjà ordonnés par le Rust, et le portage les
        // ordonne pareil. On les compare donc **en place** : un même ensemble
        // rendu dans un autre ordre est déjà une divergence de départage.
        "blocks": ladder
            .blocks
            .iter()
            .map(|block| block.iter().map(|&c| slug(c)).collect::<Vec<_>>())
            .collect::<Vec<_>>(),
        "summit": ladder.summit.iter().map(|&c| slug(c)).collect::<Vec<_>>(),
    })
}

fn main() {
    let target = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "../scripts/fixtures/ladder-parity.json".into());
    let trees = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../src/lib/dofus/breeding/trees.json");

    let mut families = Vec::with_capacity(FAMILIES.len());
    let mut plans = 0;
    for family in FAMILIES {
        let catalog = Catalog::load(&trees, family).unwrap_or_else(|error| {
            eprintln!("{error}");
            std::process::exit(1);
        });
        let laid: Vec<serde_json::Value> = [Route::Shared, Route::Disjoint]
            .into_iter()
            .map(|route| plan_of(&catalog, route))
            .collect();
        plans += laid.len();
        families.push(serde_json::json!({ "id": family, "plans": laid }));
    }

    // La route par défaut se **lit** sur le Rust, elle ne se redit pas ici.
    // `Route` porte un `#[default]` depuis #160, et c'est lui la référence : le
    // garde appelle `ladderOf(colors)` sans argument et compare au plan de cette
    // route-là. Écrire la constante à la main marcherait aussi et périmerait au
    // premier changement de défaut, sans que rien ne le dise.
    let document = serde_json::json!({
        "defaultRoute": name_of(Route::default()),
        "families": families,
    });
    match std::fs::write(&target, serde_json::to_string(&document).unwrap_or_default()) {
        Ok(()) => println!("{plans} plans d'échelle écrits dans {target}"),
        Err(error) => {
            eprintln!("{target} : {error}");
            std::process::exit(1);
        }
    }
}
