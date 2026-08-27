//! Le nombre de fournées **jouées** n'est pas celui qu'`economy.toml` budgète.
//!
//! ## Le défaut que ce test remplace
//!
//! `bin/table` imprimait `economy.batches` dans sa ligne « N fournees ». C'est le
//! budget du fichier, et il ne borne la partie qu'en mode fournées. En mode heures
//! — le mode par défaut d'`economy.toml` — la partie s'arrête sur les heures, et
//! le nombre imprimé n'a plus aucun rapport avec ce qui a été joué : quatre
//! horizons de 48 à 2 160 heures affichaient tous « 100 fournees » pendant que les
//! croisements passaient de 90 à 3 660.
//!
//! Ce n'est pas une coquille d'affichage. Le balayage de niveaux s'en sert pour
//! dire « à effort égal », et l'effort n'était pas égal : sur l'écurie réelle, le
//! niveau 67 jouait **28** fournées là où le niveau 50 en jouait **36**, parce que
//! monter plus haut allonge le chargement. Le classement des niveaux s'inversait
//! donc pour une raison qui n'était pas le niveau, et la ligne imprimée jurait le
//! contraire.
//!
//! ## Ce qu'il vérifie
//!
//! Les deux moitiés du fait, parce qu'une seule se satisferait d'une constante :
//! le compte joué **répond à l'horizon**, et il **répond au niveau**. Une
//! implémentation qui imprime un budget figé échoue sur les deux.

use breeding_sim::config::Prices;
use breeding_sim::economy::{play, Economy, Policy, Rng, Strategy, UnitPlan, UnitView};
use breeding_sim::ladder::{Ladder, LadderPolicy, Route};
use breeding_sim::trees::{trees_path, Catalog};

/// L'échelle, à un niveau imposé — le même réglage que `bin/table` épingle.
struct AtLevel<P>(P, Strategy);

impl<P: Policy> Policy for AtLevel<P> {
    fn name(&self) -> &str {
        self.0.name()
    }
    fn strategy(&self, _unit: usize) -> Strategy {
        self.1
    }
    fn plan(&mut self, view: &UnitView<'_>, rng: &mut Rng) -> UnitPlan {
        self.0.plan(view, rng)
    }
}

fn economy() -> Economy {
    Prices::load_default()
        .expect("economy.toml doit se charger")
        .for_family("muldo")
}

/// Les fournées jouées en moyenne sur quelques graines, à cet horizon et ce niveau.
fn loads(hours: Option<f64>, level: u16) -> f64 {
    let catalog = Catalog::load(trees_path(), "muldo").expect("le catalogue doit se charger");
    let mut economy = economy();
    economy.horizon_hours = hours;
    let plan = Ladder::of(&catalog, Route::default());
    let mut total = 0.0;
    const SEEDS: u32 = 8;
    for seed in 0..SEEDS {
        let mut policy = AtLevel(
            LadderPolicy::with_ladder(plan.clone()),
            Strategy {
                bands: [0; 6],
                level,
                optimakina_from: 11,
            },
        );
        total += f64::from(play(&catalog, &economy, &mut policy, seed).loads_paid);
    }
    total / f64::from(SEEDS)
}

#[test]
fn le_compte_joue_repond_a_l_horizon() {
    let court = loads(Some(48.0), 50);
    let long = loads(Some(480.0), 50);
    // Relevé : 6 fournées à 48 h, 54 à 480 h. Dix fois l'horizon n'en fait pas dix
    // fois plus — l'écurie s'épuise — mais franchement plus. Un budget imprimé
    // rendrait deux fois le même nombre.
    assert!(
        long > court * 2.0,
        "48 h joue {court} fournées et 480 h en joue {long} : l'horizon ne mord pas"
    );
}

#[test]
fn le_compte_joue_repond_au_niveau() {
    // À horizon d'heures égal, monter plus haut allonge le chargement et en joue
    // donc moins. Relevé à 480 h : **58** fournées au niveau 36, **14** au niveau
    // 120 — un facteur quatre. C'est le fait exact que la ligne imprimée cachait,
    // et celui qui inversait le classement des niveaux.
    //
    // En mode fournées le compte vaut exactement `economy.batches`, ce qui est
    // pourquoi le défaut a pu vivre : dans ce mode-là, le budget imprimé était juste.
    let bas = loads(Some(480.0), 36);
    let haut = loads(Some(480.0), 120);
    assert!(
        bas > haut,
        "à 480 h, le niveau 36 joue {bas} fournées et le niveau 120 en joue {haut} : \
         la montée ne coûte donc aucune heure, et comparer deux niveaux sur un budget \
         d'heures serait légitime — ce qu'il n'est pas"
    );
}

/// La ligne que `bin/table` imprime, à cet horizon.
///
/// Le seul test qui attrape le défaut d'origine : les deux précédents pinnent le
/// **fait** que la ligne contredisait, celui-ci pinne la ligne. Il lance le binaire
/// parce qu'un `println!` ne se teste pas autrement, et c'est le prix à payer pour
/// qu'un chiffre affiché à côté de mesures en soit une.
fn printed_loads(hours: u32) -> u32 {
    let output = std::process::Command::new(env!("CARGO_BIN_EXE_table"))
        .args(["muldo", "--heures", &hours.to_string(), "--niveau", "50", "--seule"])
        .output()
        .expect("bin/table doit se lancer");
    let text = String::from_utf8_lossy(&output.stdout);
    let line = text
        .lines()
        .find(|line| line.contains("fournees"))
        .unwrap_or_else(|| panic!("aucune ligne « fournees » dans :\n{text}"));
    let at = line.find("fournees").expect("le mot est là");
    line[..at]
        .split_whitespace()
        .last()
        .and_then(|word| word.parse::<u32>().ok())
        .unwrap_or_else(|| panic!("pas de compte devant « fournees » : {line}"))
}

#[test]
fn table_imprime_les_fournees_jouees() {
    let court = printed_loads(48);
    let long = printed_loads(240);
    // Sans le correctif, les deux valent `economy.batches` — 100 — et l'égalité
    // passe inaperçue parce que 100 est un nombre plausible pour les deux.
    assert_ne!(
        court, long,
        "48 h et 240 h impriment tous deux {court} fournees : c'est un budget, pas un compte"
    );
    assert!(
        court < long,
        "48 h imprime {court} fournees et 240 h en imprime {long} : l'ordre est inversé"
    );
}
