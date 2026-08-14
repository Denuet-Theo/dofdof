//! La porte : le portage Rust doit répondre exactement ce que le TypeScript
//! répond.
//!
//! Rien de ce qui est bâti au-dessus de ce crate ne vaut si ce test ne passe
//! pas. Le simulateur, la recherche de fournée, la neuroévolution — tous
//! optimiseraient très bien une politique pour un jeu qui n'est pas celui du
//! mainteneur, et personne ne s'en apercevrait avant d'avoir joué la politique
//! en vrai.
//!
//! Les règles portées ici ne se déduisent pas : elles ont été **mesurées en
//! jeu**, relevé par relevé, sur les issues #49, #59 et #68. Les poids de
//! lignée, le partage de la masse d'échec sur `2 + w`, le régime « recopie » qui
//! rend la masse de réussite au lieu de la perdre — chacun a coûté plusieurs
//! fenêtres d'accouplement recopiées à la main. Un portage qui les approxime
//! reste plausible et donne des chiffres faux.
//!
//! La fixture est régénérée par `scripts/dump-parity-fixtures.ts`. Le TS fait
//! foi : si les deux divergent, c'est le Rust qui a tort jusqu'à preuve du
//! contraire.

use std::path::Path;

use breeding_sim::pairing::{Mate, OutcomeKind, mating_outcomes, pair_outlook};
use breeding_sim::trees::{Catalog, ColorId};
use serde_json::Value;

/// Au-delà, ce n'est plus du bruit d'arrondi mais une règle différente.
///
/// Les deux implémentations font les mêmes opérations dans le même ordre, donc
/// on attend l'égalité bit à bit sur presque tout ; la marge existe pour les
/// rares sommes dont l'ordre diffère, pas pour absorber une divergence de fond.
const TOLERANCE: f64 = 1e-9;

/// Combien d'écarts on détaille avant d'abandonner. Au-delà, la cause est
/// systématique et le premier exemple suffit à la trouver.
const MAX_REPORTED: usize = 10;

fn mate_from(catalog: &Catalog, value: &Value) -> Mate {
    let slug = value["color"].as_str().expect("`color` manquant");
    let color = catalog
        .id_of(slug)
        .unwrap_or_else(|| panic!("couleur inconnue du catalogue: {slug}"));
    let level = value["level"].as_u64().expect("`level` manquant") as u16;

    let parents = match &value["parents"] {
        Value::Null => None,
        Value::Array(pair) => {
            assert_eq!(pair.len(), 2, "une ascendance a exactement deux cases");
            let read = |v: &Value| {
                let slug = v.as_str().expect("ascendance non textuelle");
                catalog
                    .id_of(slug)
                    .unwrap_or_else(|| panic!("couleur inconnue: {slug}"))
            };
            Some([read(&pair[0]), read(&pair[1])])
        }
        other => panic!("`parents` inattendu: {other}"),
    };

    Mate {
        color,
        level,
        parents,
    }
}

/// Décrit une monture comme la fixture l'écrit, pour que le message d'échec se
/// rejoue à la main dans l'écran d'accouplement.
fn describe(catalog: &Catalog, mate: &Mate) -> String {
    match mate.parents {
        None => format!("{} niv.{} (sans ascendance)", catalog.slug(mate.color), mate.level),
        Some([a, b]) => format!(
            "{} niv.{} [{} + {}]",
            catalog.slug(mate.color),
            mate.level,
            catalog.slug(a),
            catalog.slug(b)
        ),
    }
}

fn close(a: f64, b: f64) -> bool {
    (a - b).abs() <= TOLERANCE
}

#[test]
fn le_portage_rejoue_le_typescript_au_milliardieme() {
    let fixture = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/outcomes.json");
    let json = std::fs::read_to_string(&fixture).unwrap_or_else(|e| {
        panic!(
            "fixture illisible ({e}).\n\
             Régénérer avec :\n  \
             npx tsc scripts/dump-parity-fixtures.ts --outDir \"$SCRATCH/lib\" \
             --module commonjs --target es2020 --moduleResolution node \
             --esModuleInterop --skipLibCheck --resolveJsonModule\n  \
             node \"$SCRATCH/lib/scripts/dump-parity-fixtures.js\" {}",
            fixture.display()
        )
    });
    let root: Value = serde_json::from_str(&json).expect("fixture: JSON invalide");

    let family = root["family"].as_str().expect("`family` manquant");
    let catalog = {
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../src/lib/dofus/breeding/trees.json");
        Catalog::load(path, family).expect("le catalogue doit se charger")
    };

    let cases = root["cases"].as_array().expect("`cases` manquant");
    assert!(
        cases.len() >= 1000,
        "fixture trop maigre pour être une porte: {} cas",
        cases.len()
    );

    let mut failures: Vec<String> = Vec::new();
    let mut compared_outcomes = 0usize;
    let mut recopies = 0usize;
    let mut capped = 0usize;
    let mut shortcuts = 0usize;

    for (index, case) in cases.iter().enumerate() {
        let male = mate_from(&catalog, &case["male"]);
        let female = mate_from(&catalog, &case["female"]);
        let label = || {
            let why = case["why"].as_str().map(|w| format!(" — {w}")).unwrap_or_default();
            format!(
                "cas #{index}{why}\n    mâle   : {}\n    femelle: {}",
                describe(&catalog, &male),
                describe(&catalog, &female)
            )
        };
        let mut fail = |message: String| {
            if failures.len() < MAX_REPORTED {
                failures.push(format!("{}\n    {message}", label()));
            }
        };

        // --- pairOutlook ---------------------------------------------------
        let actual = pair_outlook(&catalog, &male, &female);
        let expected = &case["outlook"];

        // `outlook` n'est plus jamais nul : le jeu ne refuse aucun accouplement,
        // il plafonne la cible au sommet de la famille (issue #185). La fixture
        // porte donc un objet à tous les cas, et la comparaison n'a plus de
        // branche pour l'absence.
        {
            let want_gen = expected["gen"].as_u64().expect("`gen`") as u8;
            let want_anc = expected["anc"].as_u64().expect("`anc`") as u8;
            let want_leap = expected["leap"].as_i64().expect("`leap`") as i16;
            let want_rate = expected["rate"].as_f64().expect("`rate`");
            let outlook = &actual;

            if outlook.target_generation != want_gen {
                fail(format!(
                    "génération visée : TS {want_gen}, Rust {}",
                    outlook.target_generation
                ));
            }
            // L'ascendance portée : elle valait `gen - 1` partout jusqu'à ce que
            // le plafond les décolle, et c'est elle qui décide des génétons.
            if outlook.ancestry_generation != want_anc {
                fail(format!(
                    "ascendance portée : TS {want_anc}, Rust {}",
                    outlook.ancestry_generation
                ));
            }
            if outlook.leap != want_leap {
                fail(format!("saut : TS {want_leap}, Rust {}", outlook.leap));
            }
            if !close(outlook.success_rate, want_rate) {
                fail(format!(
                    "taux : TS {want_rate}, Rust {}",
                    outlook.success_rate
                ));
            }

            let want_targets = expected["targets"].as_array().expect("`targets`");
            if want_targets.is_empty() {
                recopies += 1;
            }
            if want_leap > 0 {
                shortcuts += 1;
            }
            if want_gen <= want_anc {
                capped += 1;
            }

            if want_targets.len() != outlook.target_colors.len() {
                fail(format!(
                    "nombre de couleurs cibles : TS {}, Rust {} ({:?})",
                    want_targets.len(),
                    outlook.target_colors.len(),
                    outlook
                        .target_colors
                        .iter()
                        .map(|t| catalog.slug(t.color))
                        .collect::<Vec<_>>()
                ));
            } else {
                // L'ordre compte autant que les valeurs : c'est lui qui décide
                // de la couleur annoncée en tête, et donc de ce que la politique
                // croit produire.
                for (rank, want) in want_targets.iter().enumerate() {
                    let want_slug = want[0].as_str().expect("couleur cible");
                    let want_weight = want[1].as_f64().expect("poids cible");
                    let got = outlook.target_colors[rank];
                    if catalog.slug(got.color) != want_slug || !close(got.weight, want_weight) {
                        fail(format!(
                            "cible n°{rank} : TS {want_slug}@{want_weight}, Rust {}@{}",
                            catalog.slug(got.color),
                            got.weight
                        ));
                        break;
                    }
                }
            }
        }

        // --- matingOutcomes ------------------------------------------------
        let outcomes = mating_outcomes(&catalog, &male, &female);
        let want_outcomes = case["outcomes"].as_array().expect("`outcomes`");

        if want_outcomes.len() != outcomes.len() {
            fail(format!(
                "nombre d'issues : TS {}, Rust {}",
                want_outcomes.len(),
                outcomes.len()
            ));
        } else {
            for (rank, want) in want_outcomes.iter().enumerate() {
                let want_slug = want[0].as_str().expect("couleur d'issue");
                let want_probability = want[1].as_f64().expect("probabilité");
                let want_kind = match want[2].as_str().expect("kind") {
                    "t" => OutcomeKind::Target,
                    _ => OutcomeKind::Other,
                };
                let got = outcomes[rank];
                if catalog.slug(got.color) != want_slug
                    || !close(got.probability, want_probability)
                    || got.kind != want_kind
                {
                    fail(format!(
                        "issue n°{rank} : TS {want_slug}@{want_probability} {want_kind:?}, \
                         Rust {}@{} {:?}",
                        catalog.slug(got.color),
                        got.probability,
                        got.kind
                    ));
                    break;
                }
                compared_outcomes += 1;
            }

            // La fenêtre somme à 1, et c'est la propriété qui a rattrapé le bug
            // où 30 % de la masse se déversait sur la dernière ligne. On la
            // vérifie sur le Rust seul : la fixture ne peut pas la garantir.
            if !outcomes.is_empty() {
                let sum: f64 = outcomes.iter().map(|o| o.probability).sum();
                if !close(sum, 1.0) {
                    fail(format!("les issues Rust somment à {sum} au lieu de 1"));
                }
            }
        }
    }

    assert!(
        failures.is_empty(),
        "{} cas divergent du TypeScript (les {} premiers) :\n\n{}",
        failures.len(),
        failures.len().min(MAX_REPORTED),
        failures.join("\n\n")
    );

    // Une porte qui passe sans avoir rien comparé serait pire qu'absente.
    assert!(
        compared_outcomes > 10_000,
        "seulement {compared_outcomes} issues comparées"
    );
    assert!(recopies > 100, "recopies sous-représentées: {recopies}");
    assert!(shortcuts > 100, "raccourcis sous-représentés: {shortcuts}");
    assert!(capped > 10, "cibles plafonnées sous-représentées: {capped}");

    println!(
        "parité : {} cas, {compared_outcomes} issues comparées \
         ({recopies} recopies, {shortcuts} raccourcis, {capped} cibles plafonnées)",
        cases.len()
    );
}

/// Le catalogue interne doit désigner les mêmes couleurs que la fixture.
///
/// Un internement qui décale d'un rang produirait des slugs cohérents entre eux
/// et faux partout ; le test ci-dessus le verrait, mais tard et mal. Celui-ci le
/// dit tout de suite.
#[test]
fn le_catalogue_connait_toutes_les_couleurs_de_la_fixture() {
    let fixture = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/outcomes.json");
    let json = std::fs::read_to_string(&fixture).expect("fixture illisible");
    let root: Value = serde_json::from_str(&json).expect("JSON invalide");
    let catalog = {
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../src/lib/dofus/breeding/trees.json");
        Catalog::load(path, root["family"].as_str().expect("`family`")).expect("catalogue")
    };

    let mut seen: Vec<ColorId> = Vec::new();
    for case in root["cases"].as_array().expect("`cases`") {
        for side in ["male", "female"] {
            let slug = case[side]["color"].as_str().expect("`color`");
            let id = catalog
                .id_of(slug)
                .unwrap_or_else(|| panic!("{slug} absent du catalogue"));
            assert_eq!(catalog.slug(id), slug, "l'internement doit être réversible");
            if !seen.contains(&id) {
                seen.push(id);
            }
        }
    }

    assert!(
        seen.len() > 80,
        "la fixture ne touche que {} couleurs sur {}",
        seen.len(),
        catalog.len()
    );
}
