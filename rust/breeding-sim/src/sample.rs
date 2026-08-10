//! Tirer une écurie **plausible**, pour entraîner une politique d'appariement.
//!
//! ## Pourquoi pas `starting_stable`
//!
//! `starting_stable` amorce une partie : cent montures tirées en gen 2 à 9, toutes
//! au même niveau, toutes fertiles, ascendance tirée dans leur propre recette.
//! C'est le bon départ pour mesurer une partie entière — et le mauvais matériau
//! pour apprendre à **apparier**, parce qu'une politique entraînée là ne sait
//! répondre qu'à cette écurie-là.
//!
//! Or la question qu'on veut savoir traiter est « voilà mon écurie, quel est le
//! meilleur coup maintenant », et l'écurie d'un éleveur ne ressemble pas à un
//! amorçage : elle est **déséquilibrée**. Il a cinq gen 3 et un seul gen 2 du type
//! qui manque, des stériles qui traînent, des fécondes en réserve.
//!
//! ## La règle, et ce qu'elle fabrique
//!
//! Elle est du mainteneur, et elle descend l'arbre au lieu de le monter :
//!
//! 1. tirer 1 à 3 montures de **génération 5 à 10** — ce sera la frontière ;
//! 2. pour chaque **couleur** rencontrée, tirer **un** de ses couples de parents ;
//! 3. ajouter 1 à 5 exemplaires de **chaque** couleur parente, sexe et état tirés ;
//! 4. remonter, en mémoïsant **par couleur**.
//!
//! Le point 4 est ce qui produit le réalisme, et c'est subtil : l'effectif d'un
//! enfant ne se propage pas à ses parents. Cinq gen 3 avec **un seul** gen 2 d'un
//! type nécessaire, c'est un goulot — exactement la situation où l'appariement
//! devient un arbitrage plutôt qu'un remplissage. Une pyramide équilibrée
//! n'apprendrait rien : tout s'y croise.
//!
//! La mémoïsation borne aussi la marche. Chaque couleur est visitée une fois, donc
//! l'écurie ne peut pas dépasser `couleurs × 5` montures quelle que soit la
//! profondeur.
//!
//! ## Les porteuses de raccourci, ajoutées à la règle
//!
//! Telle quelle, la règle ne peut jamais produire la monture qui rapporte le plus
//! dans ce jeu : le **raté qui porte plus haut que sa couleur**. Un Doré gen 1 né
//! d'un Roux manqué porte `[Doré-Pourpre, Doré-Orchidée]` et vise la gen 3 ; deux
//! d'entre eux visent la gen 3 sans consommer une seule gen 2. `stable.ts` chiffre
//! l'écart : 13,75 Roux contre 10,13, et 26 % moins cher par Roux.
//!
//! Une politique qui ne voit jamais ce motif ne peut pas l'apprendre. On en pose
//! donc, avec une probabilité, en prenant une couleur **sous** le couple et en lui
//! donnant le couple pour ascendance.
//!
//! Et on les pose **par deux, de sexes opposés**, parce que le motif ne vaut que
//! si les deux côtés sont là : un Doré `[Doré-Pourpre, Doré-Orchidée]` croisé avec
//! un Doré capturé ne vise plus rien — 89,47 % de Doré, zéro géneton. En poser un
//! seul apprendrait à reconnaître une occasion inexploitable.
//!
//! ## Ce qui reste un réglage, et pas une mesure
//!
//! - **Le niveau** est tiré uniformément sur 1..=200. Il décide du taux
//!   (`0,3 + 0,0015 × (niv A + niv B)`), donc il compte beaucoup ; mais rien ne dit
//!   à quoi ressemble la distribution des niveaux d'une vraie écurie, et
//!   l'uniforme est l'aveu honnête plutôt qu'une corrélation inventée.
//! - **L'état** est tiré uniformément sur les trois. On n'impose donc pas qu'un
//!   parent présent aux côtés de son enfant soit stérile, ce qu'une lecture
//!   stricte demanderait — un éleveur détient plusieurs exemplaires d'une couleur,
//!   et forcer la cohérence supprimerait les fécondes de haute génération, qui
//!   sont précisément ce qu'on veut savoir exploiter.

use crate::economy::Rng;
use crate::stable::{Mount, Sex, Stable};
use crate::trees::{Catalog, ColorId};

/// Les réglages du tirage. Tous sont des dials, aucun n'est une mesure.
#[derive(Clone, Copy, Debug)]
pub struct SampleConfig {
    /// Bornes du nombre de montures de tête, celles qui portent la frontière.
    pub anchors: (usize, usize),
    /// Bornes de génération des montures de tête.
    pub anchor_generations: (u8, u8),
    /// Bornes du nombre d'exemplaires ajoutés par couleur parente.
    pub per_parent: (usize, usize),
    /// Probabilité de poser une paire de porteuses de raccourci sous un couple.
    pub shortcut_chance: f64,
    pub level_range: (u16, u16),
}

impl Default for SampleConfig {
    fn default() -> Self {
        Self {
            anchors: (1, 3),
            anchor_generations: (5, 10),
            per_parent: (1, 5),
            shortcut_chance: 0.25,
            level_range: (1, 200),
        }
    }
}

/// Ce que le tirage a réellement produit.
///
/// Affiché plutôt que supposé, sur le modèle de `dump-parity-fixtures.ts` : sans
/// ce relevé on ne sait pas ce que la politique a vu à l'entraînement, et on
/// attribuerait à la politique ce qui n'est qu'un trou du générateur.
#[derive(Clone, Copy, Debug, Default)]
pub struct SampleCoverage {
    pub stables: usize,
    pub mounts: usize,
    /// Écuries dont la frontière atteint la génération 9 ou 10.
    pub high_frontier: usize,
    /// Couleurs détenues en un seul exemplaire alors qu'un enfant en tient
    /// plusieurs : le goulot qu'on cherchait à fabriquer.
    pub bottlenecks: usize,
    /// Montures dont l'ascendance dépasse la couleur.
    pub carriers: usize,
    /// Paires de porteuses de même signature et de sexes opposés — donc
    /// réellement exploitables.
    pub usable_carrier_pairs: usize,
    pub steriles: usize,
    pub cycled: usize,
}

impl SampleCoverage {
    pub fn observe(&mut self, catalog: &Catalog, stable: &Stable) {
        self.stables += 1;
        self.mounts += stable.len();
        if stable.frontier(catalog) >= 9 {
            self.high_frontier += 1;
        }
        self.steriles += stable.mounts.iter().filter(|m| !m.fertile).count();
        self.cycled += stable.mounts.iter().filter(|m| m.cycled).count();

        let mut counts: std::collections::HashMap<ColorId, usize> = std::collections::HashMap::new();
        for mount in &stable.mounts {
            *counts.entry(mount.color).or_default() += 1;
        }
        self.bottlenecks += counts.values().filter(|&&n| n == 1).count();

        // Les porteuses, et parmi elles celles qui ont un partenaire de même
        // signature et de sexe opposé. C'est cette seconde ligne qui dit si le
        // motif est exploitable, la première ne dit que s'il est visible.
        let mut by_signature: std::collections::HashMap<_, (usize, usize)> =
            std::collections::HashMap::new();
        for mount in &stable.mounts {
            if !mount.fertile || mount.carried_generation(catalog) <= catalog.generation(mount.color)
            {
                continue;
            }
            self.carriers += 1;
            let slot = by_signature.entry(mount.signature()).or_default();
            match mount.sex {
                Sex::Male => slot.0 += 1,
                Sex::Female => slot.1 += 1,
            }
        }
        self.usable_carrier_pairs += by_signature
            .values()
            .map(|(males, females)| males.min(females))
            .sum::<usize>();
    }

    pub fn report(&self) -> String {
        let per = |n: usize| n as f64 / self.stables.max(1) as f64;
        format!(
            "{} écuries, {:.1} montures en moyenne — frontière ≥ 9 : {} ({:.0} %) · \
             goulots : {:.1}/écurie · porteuses : {:.1}/écurie dont {:.2} paires \
             exploitables · stériles : {:.1} · fécondes : {:.1}",
            self.stables,
            per(self.mounts),
            self.high_frontier,
            100.0 * per(self.high_frontier),
            per(self.bottlenecks),
            per(self.carriers),
            per(self.usable_carrier_pairs),
            per(self.steriles),
            per(self.cycled),
        )
    }
}

/// Tire une écurie plausible.
pub fn sample_stable(catalog: &Catalog, rng: &mut Rng, config: &SampleConfig) -> Stable {
    let mut stable = Stable::new();
    let mut visited: Vec<bool> = vec![false; catalog.len()];
    let mut queue: Vec<ColorId> = Vec::new();

    let anchors = between(rng, config.anchors);
    for _ in 0..anchors {
        let generation = between_u8(rng, config.anchor_generations).min(catalog.top_generation());
        let choices: Vec<ColorId> = catalog.ids_at_generation(generation).collect();
        if choices.is_empty() {
            continue;
        }
        let color = choices[index_in(rng, choices.len())];
        // La tête reçoit une ascendance tirée dans sa propre recette, comme le
        // reste : sans elle, la monture la plus haute de l'écurie serait la seule
        // à ressembler à un achat.
        let parents = pick_recipe(catalog, rng, color);
        stable.push(mount(catalog, rng, config, color, parents));
        queue.push(color);
    }

    // Largeur d'abord, une couleur traitée au plus une fois. C'est le point 4 de
    // la règle, et c'est lui qui fabrique les goulots.
    while let Some(color) = queue.pop() {
        if visited[color as usize] {
            continue;
        }
        visited[color as usize] = true;

        let Some([a, b]) = pick_recipe(catalog, rng, color) else {
            continue;
        };

        for parent in [a, b] {
            let count = between(rng, config.per_parent);
            let grandparents = pick_recipe(catalog, rng, parent);
            for _ in 0..count {
                stable.push(mount(catalog, rng, config, parent, grandparents));
            }
            queue.push(parent);
        }

        // Une paire de porteuses sous ce couple : couleur prise en dessous,
        // ascendance `[a, b]`. Les deux sexes, sinon le motif ne s'apparie pas.
        if rng.next_f64() < config.shortcut_chance {
            if let Some(low) = failure_colour(catalog, rng, a, b) {
                for sex in [Sex::Male, Sex::Female] {
                    let mut carrier = mount(catalog, rng, config, low, Some([a, b]));
                    carrier.sex = sex;
                    // Une porteuse stérile ne porte plus rien d'exploitable, et
                    // c'est justement le motif qu'on veut rendre visible.
                    carrier.fertile = true;
                    stable.push(carrier);
                }
            }
        }
    }

    stable
}

/// Une couleur qu'un raté de `a × b` peut rendre, et qui porte **moins** que le
/// couple.
///
/// On la prend dans les composantes de `a` ou de `b` — ce sont les grands-parents
/// du bébé, et c'est là que le relevé de #69 les a trouvées : « les quatre
/// recombinaisons observées sont exactement les quatre paires croisées entre les
/// deux côtés ». Prendre `a` ou `b` eux-mêmes ne suffirait pas : à générations
/// égales, l'ascendance ne dépasserait pas la couleur et il n'y aurait pas de
/// raccourci.
fn failure_colour(catalog: &Catalog, rng: &mut Rng, a: ColorId, b: ColorId) -> Option<ColorId> {
    let mut pool: Vec<ColorId> = Vec::new();
    for parent in [a, b] {
        for recipe in &catalog.color(parent).recipes {
            pool.extend_from_slice(recipe);
        }
    }
    let highest = catalog.generation(a).max(catalog.generation(b));
    pool.retain(|&color| catalog.generation(color) < highest);
    if pool.is_empty() {
        return None;
    }
    Some(pool[index_in(rng, pool.len())])
}

fn pick_recipe(catalog: &Catalog, rng: &mut Rng, color: ColorId) -> Option<[ColorId; 2]> {
    let recipes = &catalog.color(color).recipes;
    if recipes.is_empty() {
        return None;
    }
    Some(recipes[index_in(rng, recipes.len())])
}

fn mount(
    catalog: &Catalog,
    rng: &mut Rng,
    config: &SampleConfig,
    color: ColorId,
    parents: Option<[ColorId; 2]>,
) -> Mount {
    let _ = catalog;
    let (low, high) = config.level_range;
    let level = low + (rng.next_f64() * f64::from(high - low + 1)) as u16;
    // Trois états équiprobables. Une stérile n'est pas un déchet : elle est la
    // matière du clonage, qui est l'autre moitié de ce que la politique décide.
    let roll = rng.next_f64();
    let (fertile, cycled) = if roll < 1.0 / 3.0 {
        (true, false)
    } else if roll < 2.0 / 3.0 {
        (true, true)
    } else {
        (false, false)
    };

    Mount {
        color,
        sex: if rng.next_f64() < 0.5 {
            Sex::Male
        } else {
            Sex::Female
        },
        level: level.min(high),
        fertile,
        cycled,
        parents,
    }
}

fn between(rng: &mut Rng, (low, high): (usize, usize)) -> usize {
    low + (rng.next_f64() * (high.saturating_sub(low) + 1) as f64) as usize
}

fn between_u8(rng: &mut Rng, (low, high): (u8, u8)) -> u8 {
    low + (rng.next_f64() * f64::from(high.saturating_sub(low) + 1)) as u8
}

fn index_in(rng: &mut Rng, count: usize) -> usize {
    ((rng.next_f64() * count as f64) as usize).min(count.saturating_sub(1))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::trees::muldo;

    #[test]
    fn le_tirage_est_reproductible() {
        let catalog = muldo();
        let config = SampleConfig::default();
        let first = sample_stable(&catalog, &mut Rng::new(7), &config);
        let second = sample_stable(&catalog, &mut Rng::new(7), &config);
        assert_eq!(first.len(), second.len());
        assert_eq!(first.mounts, second.mounts);
    }

    #[test]
    fn une_couleur_n_est_developpee_qu_une_fois() {
        let catalog = muldo();
        let config = SampleConfig::default();
        // Borne dure : chaque couleur donne au plus `per_parent.1` exemplaires par
        // parent, plus deux porteuses. Sans la mémoïsation, la marche exploserait.
        let stable = sample_stable(&catalog, &mut Rng::new(3), &config);
        assert!(
            stable.len() <= catalog.len() * (config.per_parent.1 + 2),
            "{} montures pour {} couleurs",
            stable.len(),
            catalog.len()
        );
    }

    #[test]
    fn l_ascendance_est_toujours_plus_basse_que_la_couleur_sauf_pour_les_porteuses() {
        let catalog = muldo();
        let config = SampleConfig::default();
        let mut carriers = 0;
        for seed in 0..40 {
            let stable = sample_stable(&catalog, &mut Rng::new(seed), &config);
            for mount in &stable.mounts {
                let own = catalog.generation(mount.color);
                let carried = mount.carried_generation(&catalog);
                if carried > own {
                    carriers += 1;
                }
            }
        }
        assert!(
            carriers > 0,
            "le générateur doit produire des porteuses de raccourci, sinon la \
             politique ne peut pas apprendre le motif qui paie le plus"
        );
    }

    #[test]
    fn la_couverture_voit_des_goulots_et_des_paires_exploitables() {
        let catalog = muldo();
        let config = SampleConfig::default();
        let mut coverage = SampleCoverage::default();
        for seed in 0..200 {
            let stable = sample_stable(&catalog, &mut Rng::new(seed * 31 + 1), &config);
            coverage.observe(&catalog, &stable);
        }
        assert_eq!(coverage.stables, 200);
        assert!(coverage.bottlenecks > 0, "aucun goulot : {}", coverage.report());
        assert!(
            coverage.usable_carrier_pairs > 0,
            "aucune paire de porteuses exploitable : {}",
            coverage.report()
        );
        assert!(coverage.steriles > 0, "aucune stérile, donc rien à cloner");
        assert!(coverage.cycled > 0, "aucune féconde, donc rien à croiser d'emblée");
    }
}

/// Le relevé de couverture, imprimé pour être lu.
///
/// `cargo test -p breeding-sim -- --nocapture couverture_annoncee`
#[cfg(test)]
mod report {
    use super::*;
    use crate::trees::muldo;

    #[test]
    fn couverture_annoncee() {
        let catalog = muldo();
        let config = SampleConfig::default();
        let mut coverage = SampleCoverage::default();
        for seed in 0..500u32 {
            let stable =
                sample_stable(&catalog, &mut Rng::new(seed.wrapping_mul(2_654_435_761)), &config);
            coverage.observe(&catalog, &stable);
        }
        println!("couverture : {}", coverage.report());
    }
}
