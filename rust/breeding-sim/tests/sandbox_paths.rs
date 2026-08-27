//! Aucun chemin ne remonte **au-dessus** de la racine du workspace.
//!
//! ## Le défaut, et pourquoi il était muet
//!
//! `cargo mutants` bâtit une copie du dépôt et y rejoue les tests. La copie part
//! de la racine du workspace cargo, c'est-à-dire de `rust/` : tout ce qui est
//! au-dessus — `src/lib/dofus/breeding/trees.json`, en particulier — n'y est pas.
//!
//! `CARGO_MANIFEST_DIR` est figé **à la compilation**, donc un chemin écrit
//! `env!("CARGO_MANIFEST_DIR").join("../../src/lib/dofus/breeding/trees.json")`
//! pointe, dans la copie, vers un fichier absent. `trees_path()` existe pour ça,
//! et `DOFDOF_TREES` est la porte.
//!
//! Le correctif avait été appliqué à `trees.rs` et au test de parité de
//! `breeding-neat`, et **pas** à `breeding-sim/tests/parity.rs` ni à
//! `dump-ladder.rs`. Conséquence, mesurée le 27/08 : le baseline de
//! `cargo mutants --file ladder.rs` échouait sur les deux tests de
//! `breeding-sim/tests/parity.rs`, donc **aucun mutant n'était testé du tout** —
//! 404 annoncés, zéro joué. Une couverture de mutation qui ne tourne pas ne dit
//! rien, et elle ne le dit pas bruyamment : la commande affiche « Found 404
//! mutants to test » et s'arrête.
//!
//! ## Pourquoi une garde et pas trois corrections
//!
//! Parce qu'il y en avait trois, qu'une seule avait été faite, et que le
//! quatrième site ne se distinguera pas des autres. `../economy.toml` est
//! légitime — il reste **dans** la copie — donc la règle n'est pas « pas de
//! chemin relatif », c'est « pas de chemin qui sort ». Cette garde sait faire la
//! différence ; une relecture, non.

use std::path::Path;

/// Les dossiers de sources à relire. `CARGO_MANIFEST_DIR` sert ici sans danger :
/// il ne remonte pas, donc il vaut dans la copie comme dans le dépôt.
const ROOTS: [&str; 4] = [
    "src",
    "tests",
    "../breeding-neat/src",
    "../breeding-neat/tests",
];

/// Tous les `.rs` sous ce dossier, récursivement.
fn sources(dir: &Path, into: &mut Vec<std::path::PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            sources(&path, into);
        } else if path.extension().is_some_and(|ext| ext == "rs") {
            into.push(path);
        }
    }
}

/// Une remontée qui sort de `rust/`, sur cette ligne ou la suivante.
///
/// Deux lignes et pas une : `dump-ladder.rs` écrivait le `join` sous le `env!`,
/// et une garde qui ne lit qu'une ligne l'aurait laissé passer.
fn escapes(lines: &[&str], at: usize) -> bool {
    if !lines[at].contains("CARGO_MANIFEST_DIR") {
        return false;
    }
    lines[at..(at + 3).min(lines.len())]
        .iter()
        .any(|line| line.contains("../../"))
}

/// Le repli **sanctionné** : celui qui vit dans la surcharge qui le couvre.
///
/// `trees_path()` et le test de parité de `breeding-neat` ont tous deux le droit
/// d'écrire le chemin qui sort — c'est leur dernier recours, et il n'est atteint
/// que si `DOFDOF_TREES` ou `DOFDOF_FIXTURES` est absent. La règle n'est donc pas
/// « jamais de chemin qui sort », c'est « pas de chemin qui sort **sans porte** ».
///
/// La porte doit être proche : quinze lignes au-dessus, soit le corps de la
/// fonction qui la consulte, et pas n'importe où dans le fichier — sinon un
/// fichier qui mentionne `DOFDOF_TREES` une fois s'exempterait en entier.
fn guarded(lines: &[&str], at: usize) -> bool {
    lines[at.saturating_sub(15)..=at]
        .iter()
        .any(|line| line.contains("DOFDOF_"))
}

#[test]
fn aucun_chemin_ne_sort_de_la_copie() {
    let base = Path::new(env!("CARGO_MANIFEST_DIR"));
    let mut files = Vec::new();
    for root in ROOTS {
        sources(&base.join(root), &mut files);
    }
    assert!(
        files.len() > 10,
        "seulement {} fichiers relus : la garde ne regarde pas où il faut",
        files.len()
    );

    let mut faults = Vec::new();
    for file in &files {
        // Sa propre source cite le défaut pour l'expliquer, et se dénoncerait.
        if file.ends_with("sandbox_paths.rs") {
            continue;
        }
        let Ok(text) = std::fs::read_to_string(file) else { continue };
        let lines: Vec<&str> = text.lines().collect();
        for at in 0..lines.len() {
            if escapes(&lines, at) && !guarded(&lines, at) {
                faults.push(format!("{}:{}: {}", file.display(), at + 1, lines[at].trim()));
            }
        }
    }

    assert!(
        faults.is_empty(),
        "ces chemins sortent de la racine du workspace, donc de la copie que \
         `cargo mutants` bâtit — passer par `trees_path()` et `DOFDOF_TREES` :\n{}",
        faults.join("\n")
    );
}
