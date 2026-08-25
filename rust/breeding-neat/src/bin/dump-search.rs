//! Fige des **plans entiers** : l'écurie qui entre, la composition qui sort.
//!
//! ```sh
//! cargo run --release -p breeding-neat --bin dump-search -- champion-t2.json \
//!   ../scripts/fixtures/search-parity.json
//! ```
//!
//! Dernier garde-fou du portage, et le seul qui juge la chaîne complète : le
//! recensement, les 74 entrées, le réseau, l'effet d'un croisement et la montée de
//! colline qui les emploie. Les trois précédents comparaient des nombres à une
//! tolérance près ; celui-ci compare des listes d'entiers, donc il n'admet aucune
//! tolérance du tout.
//!
//! ## Pourquoi la comparaison peut être exacte
//!
//! `breeding_sim::economy::Rng` et `random.ts` sont le même Mulberry32 sur `u32`,
//! opération pour opération. À écurie, graine et stratégie égales, les deux
//! recherches tirent donc la même suite de mutations. Ce qui les ferait diverger
//! n'est pas l'arithmétique — c'est un `rng()` de plus ou de moins sur une branche,
//! même une qui ne sert à rien, et cette erreur-là ne se voit sur aucun écran.
//!
//! ## Trois juges, dont deux font foi
//!
//! Chaque cas est joué avec la valeur **myope**, avec la **sonde linéaire** et avec
//! le **champion**. Les deux premières sont des sommes de flottants et rien
//! d'autre : elles se comparent au bit, et ensemble elles lisent tout le
//! recensement — la myope les kamas et la liquidation, la sonde chaque champ,
//! chaque génération et chaque couleur. C'est ce qui fait le contrat.
//!
//! Le champion, lui, passe par `log1p` et par `tanh`, dont aucune norme n'impose
//! l'arrondi au plus proche. Les deux libm s'écartent de 6 ulp, ce qui suffit à
//! faire bifurquer une montée de colline sur quatre cents comparaisons. Son accord
//! est donc compté et affiché, pas exigé — voir `check-search.mjs`.
//!
//! ## Ce que les cas font varier
//!
//! Le niveau et le seuil d'Optimakina, parce qu'ils entrent dans le taux de
//! réussite. La capacité en places, pour que l'enclos soit tantôt large tantôt
//! saturé — c'est la contrainte qui décide si une fécondation est proposable. Le
//! solde, parce qu'une écurie sans kamas refuse le chargement et que `feasible`
//! est la seule branche capable de tuer une composition entière. Et l'extraction en
//! ambre, ouverte un cas sur trois, puisqu'elle change le tirage lui-même.
//!
//! Les écuries alternent entre le tirage aléatoire de `sample.rs` — porteuses de
//! raccourci, goulots, fécondes mêlées aux fertiles — et l'écurie d'amorçage, qui
//! est plus grosse et dont la généalogie est jouable.

use breeding_neat::champion;
use breeding_neat::neat::Network;
use breeding_sim::config::Prices;
use breeding_sim::economy::{Draws, Economy, Rng, Strategy, UnitPlan, UnitView, starting_stable};
use breeding_sim::encode::Census;
use breeding_sim::sample::{SampleConfig, sample_stable};
use breeding_sim::ladder::{LadderPolicy, Route, Summit};
use breeding_sim::search::{Myopic, SearchConfig, Searcher, ValueFn};
use breeding_sim::stable::Sex;
use breeding_sim::trees::{Catalog, muldo};

const CASES: u32 = 40;
/// Assez de mutations pour que la composition se remplisse et que les branches
/// « retirer » et « échanger » servent, assez peu pour que la référence se
/// régénère en quelques secondes.
const ITERATIONS: usize = 400;

/// La sonde linéaire, en fonction de valeur. Voir `Census::linear_probe`.
struct Probe;

impl ValueFn for Probe {
    fn value(&self, census: &Census, _catalog: &Catalog, _economy: &Economy) -> f64 {
        census.linear_probe()
    }
}

struct NetValue<'a>(&'a Network);

impl ValueFn for NetValue<'_> {
    fn value(&self, census: &Census, catalog: &Catalog, economy: &Economy) -> f64 {
        self.0.value(&census.features(catalog, economy))
    }
}

/// Le nom du fichier seul, pour que la référence ne dépende pas du répertoire
/// depuis lequel on l'a produite. Un chemin absolu y faisait bouger une ligne à
/// chaque régénération sans que rien d'autre ne change.
fn basename(path: &str) -> &str {
    path.rsplit('/').next().unwrap_or(path)
}

/// Le plan tel que le portage le compare : des listes d'entiers, rien d'autre.
fn plan_json(catalog: &Catalog, plan: &UnitPlan) -> serde_json::Value {
    serde_json::json!({
        "purchases": plan.purchases.iter()
            .map(|&(color, sex)| serde_json::json!([
                catalog.slug(color),
                if sex == Sex::Male { "M" } else { "F" }
            ]))
            .collect::<Vec<_>>(),
        "clonings": plan.clonings,
        "crossings": plan.crossings,
        "optimakina": plan.optimakina,
        "sacrifices": plan.sacrifices,
        "cycles": plan.cycles,
    })
}

fn main() {
    let mut args = std::env::args().skip(1);
    // Le champion **embarqué**, et non `champion-t2.json` comme avant.
    //
    // Ce défaut-là était une archive du 10/08, restée à 74 entrées quand le
    // simulateur en déclare 75. `champion::load` refuse alors le génome et le
    // binaire **sort** — donc `search-parity.json` était irrégénérable, en silence,
    // depuis que l'encodage a changé. La garde passait pendant ce temps contre la
    // référence périmée, et une conclusion fausse a été tirée avant qu'on le voie.
    //
    // L'embarqué est le bon défaut pour un générateur de référence : il est
    // **versionné**, donc présent sur un clone neuf, là où `rust/champion.json` est
    // ignoré par git et peut ne pas exister. C'est aussi celui que `refresh-parity`
    // passe sous `--check`.
    let champion_path = args
        .next()
        .unwrap_or_else(|| "../src/lib/dofus/breeding/champion.json".into());
    let target = args
        .next()
        .unwrap_or_else(|| "../scripts/fixtures/search-parity.json".into());

    let genome = champion::load(&champion_path, 0).unwrap_or_else(|error| {
        eprintln!("{error}");
        std::process::exit(1);
    });
    let network = Network::compile(&genome);
    let value = NetValue(&network);

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

        let strategy = Strategy {
            bands: [0; 6],
            // Zéro compris : c'est le réglage par défaut, et il donne un taux de
            // base — le portage doit le prendre tel quel et non le remplacer par le
            // niveau de l'économie.
            level: (case as u16 * 37) % 201,
            optimakina_from: (case as u8 % 12).max(1),
        };
        let unit = 0;
        let capacity = [4usize, 10, 25, 50][case as usize % 4];
        // Un cas sur cinq démarre presque à sec, pour que `feasible` refuse
        // réellement des compositions au lieu d'être toujours vraie.
        let kamas = if case % 5 == 0 {
            economy.unit_load(unit, strategy).0 / 2
        } else {
            economy.starting_kamas * (1 + case as i64 % 3)
        };
        let sacrifices = case % 3 != 0;
        let seed = 7_000 + case.wrapping_mul(2_654_435_761) % 1_000_000;

        let view = UnitView {
            catalog: &catalog,
            economy: &economy,
            stable: &stable,
            kamas,
            unit,
            strategy,
            capacity,
        };
        let config = || SearchConfig {
            iterations: ITERATIONS,
            sacrifices,
        };
        // **Le filtre d'admissibilité, un cas sur deux.**
        //
        // La référence ne le couvrait pas du tout : elle ne portait que
        // `admissible: None`, si bien que le filtre de l'écran — celui qui décide
        // ce que la recherche a le droit de composer — n'était vérifié d'aucun
        // côté du portage. Une divergence là ne changeait aucun chiffre affiché et
        // rien ne l'aurait dite.
        let regime = if case % 2 == 0 { "aucun" } else { "strict" };
        let searcher = || {
            let mut searcher = Searcher::new(config());
            if regime != "aucun" {
                let mut policy = LadderPolicy::new(&catalog, Route::default());
                policy = policy.with_summit(Summit::Target);
                policy.crown(&catalog, &economy);
                searcher.admissible = Some(policy);
            }
            searcher
        };
        let plan = searcher().plan(&view, &mut Rng::new(seed), &value);
        // Le même cas jugé par la valeur myope, qui est une somme de flottants et
        // rien d'autre : ni `log1p`, ni `tanh`, ni réseau. Voir l'en-tête.
        let myopic = searcher().plan(&view, &mut Rng::new(seed), &Myopic);
        // Celle qui lit tout le recensement sans transcendante : c'est elle qui
        // verrouille l'algèbre champ par champ.
        let probe = searcher().plan(&view, &mut Rng::new(seed), &Probe);

        let mounts: Vec<serde_json::Value> = stable
            .mounts
            .iter()
            .map(|mount| {
                serde_json::json!({
                    "color": catalog.slug(mount.color),
                    "sex": if mount.sex == Sex::Male { "M" } else { "F" },
                    "fertile": mount.fertile,
                    "cycled": mount.cycled,
                    "parents": mount.parents.map(|[a, b]| [catalog.slug(a), catalog.slug(b)]),
                })
            })
            .collect();

        cases.push(serde_json::json!({
            "admissible": regime,
            "seed": seed,
            "kamas": kamas,
            "capacity": capacity,
            "iterations": ITERATIONS,
            "sacrifices": sacrifices,
            "strategy": {
                "level": strategy.level,
                "optimakinaFrom": strategy.optimakina_from,
            },
            // Ce que `feasible` retire du solde dès qu'une place est occupée. On le
            // fige plutôt que de le faire recalculer : côté app il vient des jauges
            // et de leurs cours du jour, qui ne sont pas ceux d'`economy.toml`.
            "loadKamas": economy.unit_load(unit, strategy).0,
            "economy": {
                "startingKamas": economy.starting_kamas,
                "amberPerGeneration": economy.amber_per_generation,
                "amberRange": [economy.amber_range.0, economy.amber_range.1],
                "genetonValue": economy.geneton_value,
                "genetonRange": [economy.geneton_range.0, economy.geneton_range.1],
                "topValue": economy.top_value,
                "topValueRange": [economy.top_value_range.0, economy.top_value_range.1],
                "starterPrice": economy.starter_price,
                "optimakina": economy.optimakina.to_vec(),
                "optimakinaBonus": economy.optimakina_bonus,
                "values": (0..catalog.len())
                    .map(|color| serde_json::json!([
                        catalog.slug(color as u16),
                        economy.value_of(&catalog, color as u16)
                    ]))
                    .collect::<Vec<_>>(),
            },
            "mounts": mounts,
            "plan": plan_json(&catalog, &plan),
            "myopic": plan_json(&catalog, &myopic),
            "probe": plan_json(&catalog, &probe),
        }));
    }

    let document = serde_json::json!({
        "features": breeding_sim::encode::FEATURES,
        "champion": basename(&champion_path),
        "cases": cases,
    });
    match std::fs::write(&target, serde_json::to_string(&document).unwrap_or_default()) {
        Ok(()) => println!("{CASES} plans écrits dans {target}"),
        Err(error) => {
            eprintln!("{target} : {error}");
            std::process::exit(1);
        }
    }
}
