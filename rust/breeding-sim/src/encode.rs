//! Ce que le réseau voit d'une écurie, et comment on le met à jour vite.
//!
//! ## Le biais rentre ici, pas dans l'algorithme
//!
//! NEAT n'a pas besoin qu'on choisisse la forme de la fonction, mais il lui
//! faut un vecteur d'entrée de **taille fixe**. Or une écurie est un multiensemble
//! de taille variable. Quelqu'un doit donc décider quoi en résumer, et ce
//! quelqu'un c'est nous : c'est le seul endroit du chantier où l'on réinjecte du
//! jugement.
//!
//! On s'en tient donc à un **recensement** : des comptes bruts, pas des scores.
//! Aucune entrée ne dit « ce coup est bon » ; elles disent « il y a tant de
//! femelles fécondes en génération 7 ». Les interactions, c'est au réseau de les
//! trouver — sinon on aurait juste réécrit `scoreOf` avec des poids.
//!
//! La seule entrée qui n'est pas un compte est le bloc de **complétude des
//! recettes**, et il mérite sa justification : sans lui, rien ne distingue une
//! écurie qui tient les deux composants d'une couleur de l'étage suivant d'une
//! écurie qui n'en tient qu'un. C'est la différence entre pouvoir monter et ne
//! pas pouvoir, et aucun histogramme par génération ne la porte.
//!
//! ## Les comptes sont fractionnaires
//!
//! La recherche de l'étape 2 évalue des fournées **en espérance** plutôt que
//! tirées : un croisement ne rend pas une couleur mais une distribution, et on
//! l'ajoute telle quelle. C'est déterministe — donc deux évaluations du même
//! candidat rendent le même chiffre — et c'est ce qui permet de comparer des
//! compositions sans jouer les dés.
//!
//! ## La mise à jour est incrémentale
//!
//! Réencoder l'écurie pour chaque candidat coûterait `O(montures)` alors qu'un
//! croisement ne touche qu'une poignée de compteurs. On applique donc des
//! **deltas**, précalculés une fois par paire de signatures et par fournée :
//! une paire donnée produit toujours le même effet attendu, quel que soit le
//! candidat qui l'emploie.

use crate::economy::Economy;
use crate::pairing::{Mate, mating_outcomes};
use crate::stable::{Sex, Stable};
use crate::trees::{Catalog, ColorId};

/// Générations 1 à 10. L'entrée 0 n'existe pas et reste à zéro.
pub const MAX_GENERATION: usize = 10;

/// La taille du vecteur d'entrée. Fixe, c'est ce que NEAT exige.
pub const FEATURES: usize = 50;

const FERTILE_MALES: usize = 0;
const FERTILE_FEMALES: usize = 10;
const STERILES: usize = 20;
const CARRIED: usize = 30;
const READY_NEXT: usize = 40;
const READY_AFTER: usize = 43;
const FRONTIER: usize = 46;
const DISTINCT: usize = 47;
const HEADCOUNT: usize = 48;
const KAMAS: usize = 49;

/// Le recensement d'une écurie, en comptes bruts et fractionnaires.
#[derive(Clone, Debug)]
pub struct Census {
    fertile_males: [f64; MAX_GENERATION + 1],
    fertile_females: [f64; MAX_GENERATION + 1],
    steriles: [f64; MAX_GENERATION + 1],
    /// Histogramme de la génération **portée**, ascendance comprise, sur les
    /// fécondes. C'est elle qui dit ce que l'écurie peut viser, et non la
    /// couleur possédée.
    carried: [f64; MAX_GENERATION + 1],
    /// Effectif fécond attendu par couleur. Sert à savoir ce qu'on « tient »
    /// pour la complétude des recettes.
    held: Vec<f64>,
    headcount: f64,
    kamas: f64,
    /// La génération de chaque couleur, recopiée à plat.
    ///
    /// Sans elle, chaque naissance appliquée referait une indirection dans le
    /// catalogue — négligeable une fois, mesurable sur les millions
    /// d'applications que la recherche demande.
    generations: Vec<u8>,
}

impl Census {
    pub fn of(catalog: &Catalog, stable: &Stable, kamas: i64) -> Self {
        let mut census = Self {
            fertile_males: [0.0; MAX_GENERATION + 1],
            fertile_females: [0.0; MAX_GENERATION + 1],
            steriles: [0.0; MAX_GENERATION + 1],
            carried: [0.0; MAX_GENERATION + 1],
            held: vec![0.0; catalog.len()],
            headcount: 0.0,
            kamas: kamas as f64,
            generations: (0..catalog.len() as ColorId)
                .map(|color| catalog.generation(color))
                .collect(),
        };

        for mount in &stable.mounts {
            let generation = catalog.generation(mount.color) as usize;
            census.headcount += 1.0;
            if !mount.fertile {
                census.steriles[generation] += 1.0;
                continue;
            }
            match mount.sex {
                Sex::Male => census.fertile_males[generation] += 1.0,
                Sex::Female => census.fertile_females[generation] += 1.0,
            }
            census.carried[mount.carried_generation(catalog) as usize] += 1.0;
            census.held[mount.color as usize] += 1.0;
        }

        census
    }

    /// La frontière : le plus haut rang **porté** par une féconde.
    #[inline]
    pub fn frontier(&self) -> usize {
        (1..=MAX_GENERATION)
            .rev()
            .find(|&generation| self.carried[generation] > 1e-9)
            .unwrap_or(0)
    }

    #[inline]
    fn holds(&self, color: ColorId) -> bool {
        self.held[color as usize] > 1e-9
    }

    /// Quelle part des recettes de ce rang est complète, à moitié, ou vide.
    ///
    /// Trois nombres qui somment à 1. Sans eux le réseau ne peut pas distinguer
    /// « il me manque un composant » de « il me manque les deux », qui sont
    /// pourtant deux situations opposées — la première se débloque en un
    /// croisement, la seconde en plusieurs.
    fn readiness(&self, catalog: &Catalog, generation: usize) -> [f64; 3] {
        if generation == 0 || generation > catalog.top_generation() as usize {
            return [0.0; 3];
        }
        let mut buckets = [0.0f64; 3];
        let mut total = 0.0;
        for color in catalog.ids_at_generation(generation as u8) {
            for &[a, b] in &catalog.color(color).recipes {
                let held = usize::from(self.holds(a)) + usize::from(self.holds(b));
                buckets[held] += 1.0;
                total += 1.0;
            }
        }
        if total > 0.0 {
            for bucket in &mut buckets {
                *bucket /= total;
            }
        }
        buckets
    }

    /// Le vecteur que le réseau reçoit.
    ///
    /// Les comptes passent par `log1p` : une écurie de deux cents montures ne
    /// doit pas saturer les entrées d'une écurie de dix, et l'écart qui compte
    /// entre 0 et 1 monture est plus grand que celui entre 100 et 101.
    pub fn features(&self, catalog: &Catalog, economy: &Economy) -> [f64; FEATURES] {
        let mut out = [0.0; FEATURES];

        for generation in 1..=MAX_GENERATION {
            let slot = generation - 1;
            out[FERTILE_MALES + slot] = self.fertile_males[generation].max(0.0).ln_1p();
            out[FERTILE_FEMALES + slot] = self.fertile_females[generation].max(0.0).ln_1p();
            out[STERILES + slot] = self.steriles[generation].max(0.0).ln_1p();
            out[CARRIED + slot] = self.carried[generation].max(0.0).ln_1p();
        }

        let frontier = self.frontier();
        let next = self.readiness(catalog, frontier + 1);
        let after = self.readiness(catalog, frontier + 2);
        out[READY_NEXT..READY_NEXT + 3].copy_from_slice(&next);
        out[READY_AFTER..READY_AFTER + 3].copy_from_slice(&after);

        out[FRONTIER] = frontier as f64 / MAX_GENERATION as f64;
        out[DISTINCT] = self.held.iter().filter(|&&c| c > 1e-9).count() as f64
            / catalog.len().max(1) as f64;
        out[HEADCOUNT] = self.headcount.max(0.0).ln_1p();
        // Normalisé sur le capital de départ : l'échelle reste lisible et une
        // partie qui a triplé sa mise se lit « 3 ».
        out[KAMAS] = self.kamas / economy.starting_kamas.max(1) as f64;

        out
    }
}

/// L'effet attendu d'un croisement sur le recensement.
///
/// Précalculé une fois par paire de signatures et par fournée : deux montures
/// de même couleur et même ascendance produisent exactement la même
/// distribution, et la recherche réemploie la paire des dizaines de fois.
#[derive(Clone, Debug)]
pub struct PairDelta {
    pub male_generation: usize,
    pub female_generation: usize,
    pub male_carried: usize,
    pub female_carried: usize,
    pub male_color: ColorId,
    pub female_color: ColorId,
    /// `(couleur, probabilité, génération portée par le bébé)`.
    pub births: Vec<(ColorId, f64, usize)>,
    /// Ce que la naissance vaut en espérance, à la liquidation.
    pub expected_value: f64,
}

impl PairDelta {
    pub fn of(catalog: &Catalog, economy: &Economy, male: &Mate, female: &Mate) -> Option<Self> {
        let outcomes = mating_outcomes(catalog, male, female);
        if outcomes.is_empty() {
            return None;
        }

        let male_carried = ancestry_generation(catalog, male);
        let female_carried = ancestry_generation(catalog, female);

        let mut births = Vec::with_capacity(outcomes.len());
        let mut expected_value = 0.0;
        for outcome in &outcomes {
            // La génération que le bébé **porte** : sa couleur, et celles de ses
            // deux parents — c'est exactement l'ascendance que le jeu retient,
            // et c'est elle qui décide de ce qu'il pourra viser.
            let carried = catalog
                .generation(outcome.color)
                .max(catalog.generation(male.color))
                .max(catalog.generation(female.color)) as usize;
            births.push((outcome.color, outcome.probability, carried));
            expected_value +=
                outcome.probability * economy.value_of(catalog, outcome.color) as f64;
        }

        Some(Self {
            male_generation: catalog.generation(male.color) as usize,
            female_generation: catalog.generation(female.color) as usize,
            male_carried,
            female_carried,
            male_color: male.color,
            female_color: female.color,
            births,
            expected_value,
        })
    }
}

#[inline]
fn ancestry_generation(catalog: &Catalog, mate: &Mate) -> usize {
    let own = catalog.generation(mate.color);
    let carried = match mate.parents {
        None => own,
        Some([a, b]) => own.max(catalog.generation(a)).max(catalog.generation(b)),
    };
    carried as usize
}

impl Census {
    /// Applique un croisement. Les deux parents deviennent stériles, le bébé
    /// arrive en espérance.
    pub fn apply_crossing(&mut self, delta: &PairDelta) {
        self.fertile_males[delta.male_generation] -= 1.0;
        self.fertile_females[delta.female_generation] -= 1.0;
        self.steriles[delta.male_generation] += 1.0;
        self.steriles[delta.female_generation] += 1.0;
        self.carried[delta.male_carried] -= 1.0;
        self.carried[delta.female_carried] -= 1.0;
        self.held[delta.male_color as usize] -= 1.0;
        self.held[delta.female_color as usize] -= 1.0;

        for &(color, probability, carried) in &delta.births {
            let generation = self.generation_slot(color);
            // Le sexe tombe à pile ou face, donc la naissance attendue est une
            // demi-monture de chaque côté. C'est ce qui permet à la recherche de
            // voir qu'un croisement de plus rééquilibre le parc.
            self.fertile_males[generation] += probability * 0.5;
            self.fertile_females[generation] += probability * 0.5;
            self.carried[carried] += probability;
            self.held[color as usize] += probability;
        }
        self.headcount += 1.0;
    }

    /// Le pendant exact, pour que la recherche locale puisse défaire un coup
    /// sans réencoder l'écurie.
    pub fn undo_crossing(&mut self, delta: &PairDelta) {
        self.fertile_males[delta.male_generation] += 1.0;
        self.fertile_females[delta.female_generation] += 1.0;
        self.steriles[delta.male_generation] -= 1.0;
        self.steriles[delta.female_generation] -= 1.0;
        self.carried[delta.male_carried] += 1.0;
        self.carried[delta.female_carried] += 1.0;
        self.held[delta.male_color as usize] += 1.0;
        self.held[delta.female_color as usize] += 1.0;

        for &(color, probability, carried) in &delta.births {
            let generation = self.generation_slot(color);
            self.fertile_males[generation] -= probability * 0.5;
            self.fertile_females[generation] -= probability * 0.5;
            self.carried[carried] -= probability;
            self.held[color as usize] -= probability;
        }
        self.headcount -= 1.0;
    }

    /// Un gen 1 anonyme entre au parc.
    pub fn apply_purchase(&mut self, color: ColorId, sex: Sex, price: i64) {
        match sex {
            Sex::Male => self.fertile_males[1] += 1.0,
            Sex::Female => self.fertile_females[1] += 1.0,
        }
        self.carried[1] += 1.0;
        self.held[color as usize] += 1.0;
        self.headcount += 1.0;
        self.kamas -= price as f64;
    }

    /// Une monture part en ambre.
    pub fn apply_sacrifice(
        &mut self,
        generation: usize,
        carried: usize,
        color: ColorId,
        sex: Option<Sex>,
        value: i64,
    ) {
        match sex {
            Some(Sex::Male) => {
                self.fertile_males[generation] -= 1.0;
                self.carried[carried] -= 1.0;
                self.held[color as usize] -= 1.0;
            }
            Some(Sex::Female) => {
                self.fertile_females[generation] -= 1.0;
                self.carried[carried] -= 1.0;
                self.held[color as usize] -= 1.0;
            }
            None => self.steriles[generation] -= 1.0,
        }
        self.headcount -= 1.0;
        self.kamas += value as f64;
    }

    /// Un clonage : deux stériles entrent, une féconde ressort.
    pub fn apply_cloning(&mut self, generation: usize, carried: usize, color: ColorId) {
        self.steriles[generation] -= 2.0;
        // Le sexe du survivant est connu de l'appelant, mais à ce niveau de
        // résumé on répartit : la recherche ne choisit pas le sexe d'un clone.
        self.fertile_males[generation] += 0.5;
        self.fertile_females[generation] += 0.5;
        self.carried[carried] += 1.0;
        self.held[color as usize] += 1.0;
        self.headcount -= 1.0;
    }

    #[inline]
    fn generation_slot(&self, color: ColorId) -> usize {
        self.generations[color as usize] as usize
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::economy::{Draws, starting_stable};
    use crate::trees::muldo;

    #[test]
    fn le_recensement_compte_ce_que_l_ecurie_porte() {
        let catalog = muldo();
        let economy = Economy::default();
        let stable = starting_stable(&catalog, &economy, &Draws::new(3));
        let census = Census::of(&catalog, &stable, 10_000_000);

        assert_eq!(census.headcount, 100.0);
        assert_eq!(census.frontier(), stable.frontier(&catalog) as usize);

        let features = census.features(&catalog, &economy);
        assert_eq!(features.len(), FEATURES);
        assert!(features.iter().all(|f| f.is_finite()));
        assert!((features[KAMAS] - 1.0).abs() < 1e-12);
    }

    #[test]
    fn les_trois_parts_de_completude_somment_a_un() {
        let catalog = muldo();
        let economy = Economy::default();
        let stable = starting_stable(&catalog, &economy, &Draws::new(8));
        let census = Census::of(&catalog, &stable, 10_000_000);
        let features = census.features(&catalog, &economy);

        let next: f64 = features[READY_NEXT..READY_NEXT + 3].iter().sum();
        assert!(
            (next - 1.0).abs() < 1e-9 || next == 0.0,
            "complétude de l'étage suivant : {next}"
        );
    }

    /// Défaire un croisement doit rendre exactement le recensement d'avant.
    /// C'est ce qui permet à la recherche locale d'explorer sans réencoder.
    #[test]
    fn appliquer_puis_defaire_ne_laisse_pas_de_trace() {
        let catalog = muldo();
        let economy = Economy::default();
        let stable = starting_stable(&catalog, &economy, &Draws::new(5));
        let mut census = Census::of(&catalog, &stable, 10_000_000);
        let before = census.features(&catalog, &economy);

        let groups = stable.fertile_groups();
        let male = groups.iter().find(|g| g.sex == Sex::Male).expect("un mâle");
        let female = groups
            .iter()
            .find(|g| g.sex == Sex::Female)
            .expect("une femelle");
        let delta = PairDelta::of(&catalog, &economy, &male.sample, &female.sample)
            .expect("un croisement possible");

        census.apply_crossing(&delta);
        let during = census.features(&catalog, &economy);
        assert_ne!(before, during, "le croisement doit se voir");

        census.undo_crossing(&delta);
        let after = census.features(&catalog, &economy);
        for (index, (a, b)) in before.iter().zip(&after).enumerate() {
            assert!((a - b).abs() < 1e-9, "entrée {index} : {a} ≠ {b}");
        }
    }

    #[test]
    fn un_croisement_consomme_deux_fecondites_et_en_rend_une() {
        let catalog = muldo();
        let economy = Economy::default();
        let stable = starting_stable(&catalog, &economy, &Draws::new(6));
        let mut census = Census::of(&catalog, &stable, 10_000_000);

        let fertile = |c: &Census| -> f64 {
            c.fertile_males.iter().sum::<f64>() + c.fertile_females.iter().sum::<f64>()
        };
        let before = fertile(&census);

        let groups = stable.fertile_groups();
        let male = groups.iter().find(|g| g.sex == Sex::Male).expect("un mâle");
        let female = groups
            .iter()
            .find(|g| g.sex == Sex::Female)
            .expect("une femelle");
        let delta = PairDelta::of(&catalog, &economy, &male.sample, &female.sample).expect("ok");

        census.apply_crossing(&delta);
        assert!(
            (fertile(&census) - (before - 1.0)).abs() < 1e-9,
            "deux fécondités consommées, une rendue : {} → {}",
            before,
            fertile(&census)
        );
    }
}
