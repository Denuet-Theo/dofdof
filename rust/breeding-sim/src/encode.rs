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
use crate::pairing::{Mate, mating_outcomes_at, pair_target_generation};
use crate::stable::{Sex, Stable};
use crate::trees::{Catalog, ColorId};

/// Générations 1 à 10. L'entrée 0 n'existe pas et reste à zéro.
pub const MAX_GENERATION: usize = 10;

/// La taille du vecteur d'entrée. Fixe, c'est ce que NEAT exige.
///
/// Passée de 54 à 74 en séparant les fécondes des fertiles. **Un génome
/// enregistré avant ce changement n'est plus chargeable** : sa couche d'entrée
/// n'a pas la bonne arité. C'est assumé — sans cette séparation, une politique ne
/// peut pas préférer une écurie dont le cycle est déjà payé à une écurie qui le
/// doit encore, et tout le pré-fécondage lui est invisible.
pub const FEATURES: usize = 75;

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
/// Le marché du jour : ambre, géneton, gen 10. Normalisés sur le milieu de leur
/// fourchette, donc autour de 1.
///
/// Sans eux la politique ne distingue pas une semaine où l'ambre est à 11 000
/// d'une où il est à 30 000 : elle apprendrait un compromis moyen et se
/// tromperait aux deux extrêmes. Et les trois ne sont pas redondants — le
/// rapport gen 10 sur ambre décide s'il faut monter jusqu'au bout ou encaisser
/// en génération 9, celui du géneton sur l'ambre décide si croiser haut paie.
const PRICE_AMBER: usize = 50;
const PRICE_GENETON: usize = 51;
const PRICE_TOP: usize = 52;
/// Ce que l'écurie vaut à la liquidation, aux prix du jour et **couleur par
/// couleur**.
///
/// Une seule entrée là où il en aurait fallu cinquante : les gen 10 ne valent
/// pas toutes pareil, mais le réseau n'a pas besoin de connaître le prix de
/// chacune — il lui suffit de savoir ce que son écurie vaut. La recherche, elle,
/// vise les couleurs chères d'elle-même, puisqu'elle maximise la valeur de
/// l'écurie attendue.
const LIQUIDATION: usize = 53;
/// Les **fécondes** par génération, sous-ensemble des fertiles.
///
/// Ajoutées en queue plutôt qu'insérées près des fertiles : les offsets existants
/// ne bougent pas, donc une lecture du vecteur écrite avant reste juste sur ce
/// qu'elle regardait.
///
/// C'est un sous-ensemble et non une partition, exprès. `FERTILE_*` continue de
/// compter **tout ce qui garde sa reproduction** — c'est ce qui dit ce que l'écurie
/// pourra produire à terme, la question que le réseau se posait déjà. Ces deux
/// entrées-ci disent ce qu'elle peut produire **sans repasser par l'enclos**, donc
/// gratuitement et tout de suite. La différence des deux est la dette de cycle,
/// que le réseau peut lire seul.
const CYCLED_MALES: usize = 54;
const CYCLED_FEMALES: usize = 64;
/// Les places d'enclos **déjà engagées**, en part de celles du parc.
///
/// La seule entrée qui ne décrive pas l'écurie mais la fournée en cours de
/// composition, et elle manquait cruellement : un croisement gratuit — deux
/// fécondes, un clic — et un croisement payant laissent exactement la même
/// écurie derrière eux. La valeur d'état ne pouvait donc pas les départager, et
/// l'économie de place, qui est toute la raison d'être du découplage du cycle,
/// lui était invisible.
///
/// Mesuré avant de l'ajouter : sur une écurie de 160 montures dont 140 fécondes,
/// le champion prenait **zéro** accouplement gratuit là où la valeur myope en
/// trouvait quarante-neuf. Il achetait quarante gen 1 à la place.
///
/// Rapportée à la capacité plutôt qu'en absolu : ce qui compte n'est pas d'avoir
/// engagé douze places, c'est qu'il en reste ou non.
const PLACES: usize = 74;

/// Le recensement d'une écurie, en comptes bruts et fractionnaires.
#[derive(Clone, Debug)]
pub struct Census {
    fertile_males: [f64; MAX_GENERATION + 1],
    fertile_females: [f64; MAX_GENERATION + 1],
    /// Les fécondes, **incluses** dans les deux tableaux ci-dessus.
    ///
    /// Redondant en apparence, et c'est le bon compromis : `apply_crossing` et
    /// `PairDelta` continuent de travailler sur « ce qui garde sa reproduction »
    /// sans rien savoir du cycle, donc la loi d'appariement — celle que le test de
    /// parité verrouille au milliardième — n'est pas touchée. Le cycle se suit à
    /// côté, là où il est décidé.
    cycled_males: [f64; MAX_GENERATION + 1],
    cycled_females: [f64; MAX_GENERATION + 1],
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
    /// Suivie en incrémental et **exacte** : sommer par génération écraserait
    /// les cinquante prix de gen 10 en un seul.
    liquidation: f64,
    /// Places engagées par la fournée en cours, et celles du parc.
    ///
    /// Posées par la recherche avant chaque évaluation plutôt que suivies ici :
    /// `search.rs` en tient déjà le compte exact, et le dupliquer dans le
    /// recensement, c'est se donner deux compteurs à garder d'accord sur des
    /// milliers d'applications et d'annulations.
    places: f64,
    capacity: f64,
    /// La génération de chaque couleur, recopiée à plat.
    ///
    /// Sans elle, chaque naissance appliquée referait une indirection dans le
    /// catalogue — négligeable une fois, mesurable sur les millions
    /// d'applications que la recherche demande.
    generations: Vec<u8>,
}

impl Census {
    pub fn of(catalog: &Catalog, economy: &Economy, stable: &Stable, kamas: i64) -> Self {
        let mut census = Self {
            fertile_males: [0.0; MAX_GENERATION + 1],
            fertile_females: [0.0; MAX_GENERATION + 1],
            cycled_males: [0.0; MAX_GENERATION + 1],
            cycled_females: [0.0; MAX_GENERATION + 1],
            steriles: [0.0; MAX_GENERATION + 1],
            carried: [0.0; MAX_GENERATION + 1],
            held: vec![0.0; catalog.len()],
            headcount: 0.0,
            kamas: kamas as f64,
            liquidation: 0.0,
            places: 0.0,
            capacity: 0.0,
            generations: (0..catalog.len() as ColorId)
                .map(|color| catalog.generation(color))
                .collect(),
        };

        for mount in &stable.mounts {
            let generation = catalog.generation(mount.color) as usize;
            census.headcount += 1.0;
            census.liquidation += economy.value_of(catalog, mount.color) as f64;
            if !mount.fertile {
                census.steriles[generation] += 1.0;
                continue;
            }
            match mount.sex {
                Sex::Male => census.fertile_males[generation] += 1.0,
                Sex::Female => census.fertile_females[generation] += 1.0,
            }
            if mount.cycled {
                match mount.sex {
                    Sex::Male => census.cycled_males[generation] += 1.0,
                    Sex::Female => census.cycled_females[generation] += 1.0,
                }
            }
            census.carried[mount.carried_generation(catalog) as usize] += 1.0;
            census.held[mount.color as usize] += 1.0;
        }

        census
    }

    /// Une monture passe fertile → féconde, ou l'inverse quand on défait.
    ///
    /// `by` est signé et fractionnaire pour la même raison que partout ailleurs
    /// ici : la recherche défait ses mutations, et un compteur qu'on ne sait pas
    /// décrémenter exactement fait dériver le recensement au fil des milliers
    /// d'essais. Voir le test `appliquer_puis_defaire_ne_laisse_pas_de_trace`.
    ///
    /// Ne touche pas `fertile_*` : la monture gardait déjà sa reproduction avant le
    /// cycle, elle la garde après. Seule sa disponibilité immédiate change.
    #[inline]
    /// Ce que la fournée en cours a déjà engagé. Voir `PLACES`.
    #[inline]
    pub fn set_places(&mut self, places: usize, capacity: usize) {
        self.places = places as f64;
        self.capacity = capacity as f64;
    }

    pub fn cycle(&mut self, generation: usize, sex: Sex, by: f64) {
        let slot = generation.min(MAX_GENERATION);
        match sex {
            Sex::Male => self.cycled_males[slot] += by,
            Sex::Female => self.cycled_females[slot] += by,
        }
    }

    /// La frontière : le plus haut rang **porté** par une monture qui garde sa
    /// reproduction.
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
            out[CYCLED_MALES + slot] = self.cycled_males[generation].max(0.0).ln_1p();
            out[CYCLED_FEMALES + slot] = self.cycled_females[generation].max(0.0).ln_1p();
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

        let (amber, geneton, top) = economy.price_references();
        out[PRICE_AMBER] = economy.amber_per_generation as f64 / amber;
        out[PRICE_GENETON] = economy.geneton_value / geneton.max(1e-9);
        out[PRICE_TOP] = economy.top_value as f64 / top;
        out[LIQUIDATION] = self.liquidation / economy.starting_kamas.max(1) as f64;
        out[PLACES] = if self.capacity > 0.0 {
            self.places / self.capacity
        } else {
            0.0
        };

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
    /// La génération visée, et ce que coûte l'Optimakina qui va avec — zéro si
    /// la stratégie n'en achète pas à ce rang.
    pub target_generation: u8,
    /// Une couleur **nomme** ce rang.
    ///
    /// Faux pour deux Ébène : la paire vise la génération 2, mais aucune recette
    /// ne s'écrit `[ebene, ebene]`, et toute la masse retombe sur la recopie. Le
    /// calcul le savait déjà — c'est la condition des génétons — mais il jetait
    /// l'information, si bien qu'un affichage lisant `target_generation` seul
    /// annonçait « gen 2 » là où il ne sortira qu'un Ébène de plus.
    pub names_target: bool,
    /// Le croisement gagne-t-il une génération ?
    ///
    /// Ce champ disait « donc le croisement peut y monter » à la suite du
    /// précédent, et cette inférence-là est tombée : au **plafond**, une paire
    /// nomme des couleurs de la génération visée sans que celle-ci dépasse ce
    /// que le couple porte déjà. Les deux se confondaient tant que ces couples
    /// étaient refusés ; ils se séparent depuis, et c'est celui-ci que les
    /// génétons et l'admissibilité veulent.
    pub climbs: bool,
    pub optimakina_cost: i64,
    /// Ce que le croisement rapporte en génétons, **en espérance** : ils ne
    /// tombent qu'en cas de succès. C'est le lien sans lequel la recherche ne
    /// verrait pas que croiser haut rapporte 250 fois plus que croiser bas.
    pub geneton_kamas: f64,
}

impl PairDelta {
    /// `level` et `optimakina_from` viennent de la stratégie de la fournée :
    /// c'est l'enclos qu'on nourrit, pas la monture, et le bonus s'achète au
    /// croisement en fonction du rang visé.
    pub fn of(
        catalog: &Catalog,
        economy: &Economy,
        male: &Mate,
        female: &Mate,
        level: u16,
        optimakina_from: u8,
    ) -> Option<Self> {
        // La cible est ce qu'une recombinaison sait nommer, et non le maximum de
        // l'ascendance plus un : voir `crossing_shares`. `None` veut dire
        // « aucune ne nomme rien », donc le poulain reprend une couleur de la
        // généalogie — il n'y a pas de delta d'accouplement à encoder.
        let target_generation = pair_target_generation(catalog, male, female)?;
        let with_optimakina = target_generation >= optimakina_from;
        let optimakina_cost = if with_optimakina {
            economy.optimakina[usize::from(target_generation).min(10)]
        } else {
            0
        };
        let rate = economy.success_rate(level, with_optimakina);

        let outcomes = mating_outcomes_at(catalog, male, female, Some(rate));
        if outcomes.is_empty() {
            return None;
        }

        // La masse de réussite vaut `rate` quand une couleur nomme la cible, et
        // zéro sinon. Les génétons demandent une condition de plus — que la
        // cible dépasse l'ascendance — et les deux ne coïncident qu'en dessous
        // du plafond.
        let names_target = outcomes
            .iter()
            .any(|outcome| outcome.kind == crate::pairing::OutcomeKind::Target);
        let climbs = names_target
            && target_generation > crate::pairing::pair_ancestry_generation(catalog, male, female);
        let geneton_kamas = rate
            * crate::economy::genetons_for_crossing(
                catalog.generation(male.color),
                catalog.generation(female.color),
                climbs,
            ) as f64
            * economy.geneton_value;

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
            target_generation,
            names_target,
            climbs,
            optimakina_cost,
            geneton_kamas,
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
        self.kamas += delta.geneton_kamas;
        self.liquidation += delta.expected_value;
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
        self.kamas -= delta.geneton_kamas;
        self.liquidation -= delta.expected_value;
    }

    /// Un gen 1 anonyme entre au parc. `sign` vaut `-1.0` pour défaire.
    pub fn purchase(&mut self, color: ColorId, sex: Sex, price: i64, sign: f64) {
        match sex {
            Sex::Male => self.fertile_males[1] += sign,
            Sex::Female => self.fertile_females[1] += sign,
        }
        self.carried[1] += sign;
        self.held[color as usize] += sign;
        self.headcount += sign;
        self.kamas -= sign * price as f64;
    }

    /// Une monture part en ambre. `sign` vaut `-1.0` pour défaire.
    pub fn sacrifice(
        &mut self,
        generation: usize,
        carried: usize,
        color: ColorId,
        sex: Option<Sex>,
        value: i64,
        sign: f64,
    ) {
        match sex {
            Some(Sex::Male) => {
                self.fertile_males[generation] -= sign;
                self.carried[carried] -= sign;
                self.held[color as usize] -= sign;
            }
            Some(Sex::Female) => {
                self.fertile_females[generation] -= sign;
                self.carried[carried] -= sign;
                self.held[color as usize] -= sign;
            }
            None => self.steriles[generation] -= sign,
        }
        self.headcount -= sign;
        self.kamas += sign * value as f64;
        self.liquidation -= sign * value as f64;
    }

    /// Un clonage : deux stériles entrent, une féconde ressort. `sign` vaut
    /// `-1.0` pour défaire.
    pub fn cloning(
        &mut self,
        generation: usize,
        carried: usize,
        color: ColorId,
        value: i64,
        sign: f64,
    ) {
        self.steriles[generation] -= 2.0 * sign;
        // Le sexe du survivant n'est pas choisi par la recherche : à ce niveau
        // de résumé on répartit une demi-monture de chaque côté.
        self.fertile_males[generation] += 0.5 * sign;
        self.fertile_females[generation] += 0.5 * sign;
        self.carried[carried] += sign;
        self.held[color as usize] += sign;
        self.headcount -= sign;
        // Le clonage consomme deux stériles et en rend un : une monture part.
        self.liquidation -= sign * value as f64;
    }

    /// Ce que l'écurie rendrait si on la liquidait maintenant, solde compris.
    ///
    /// C'est **exactement la fonction de score** de la partie, évaluée sur
    /// l'état attendu. Elle sert de fonction de valeur myope : celle qui ne voit
    /// que ce que la fournée rapporte tout de suite, sans rien accorder à ce
    /// qu'elle prépare. C'est le point de comparaison honnête pour la valeur
    /// apprise — si le réseau ne la bat pas, il n'a rien appris que l'arithmétique
    /// ne donnait déjà.
    pub fn expected_score(&self, _economy: &Economy, _top_generation: u8) -> f64 {
        self.kamas + self.liquidation
    }

    /// Une sonde linéaire sur **tous** les champs, pour le portage TypeScript.
    ///
    /// `check-search.mjs` compare des plans entiers, donc les deux recherches
    /// doivent prendre exactement les mêmes décisions d'acceptation. Le champion
    /// fait cela très bien, mais il ne dit pas *où* il regarde : sa note résume les
    /// 74 entrées en un nombre, et deux erreurs opposées s'y annulent.
    ///
    /// La valeur myope ne convient pas non plus, pour la raison inverse : elle ne
    /// lit que `kamas` et `liquidation`, si bien qu'une erreur sur `cycled_males`
    /// ou sur `carried` lui est rigoureusement invisible — c'est ce trou-là qui a
    /// laissé vivre le débordement de `cyclable_free` que `available` décrit.
    ///
    /// D'où cette sonde : elle touche chaque champ, chaque génération et chaque
    /// couleur, et n'emploie que `*` et `+`, qui sont correctement arrondis. Deux
    /// implémentations qui lui rendent le même plan tiennent donc le même
    /// recensement, champ par champ, sur les quatre cents mutations d'une fournée.
    ///
    /// Les poids n'ont aucun sens d'élevage : ils sont seulement distincts, pour
    /// qu'aucune permutation entre deux champs ne se compense.
    pub fn linear_probe(&self) -> f64 {
        let mut sum = self.kamas * 1e-6 + self.liquidation * 1e-6 + self.headcount;
        for generation in 0..=MAX_GENERATION {
            let weight = (generation + 1) as f64;
            sum += self.fertile_males[generation] * weight;
            sum += self.fertile_females[generation] * (weight + 11.0);
            sum += self.steriles[generation] * (weight + 23.0);
            sum += self.carried[generation] * (weight + 37.0);
            sum += self.cycled_males[generation] * (weight + 53.0);
            sum += self.cycled_females[generation] * (weight + 71.0);
        }
        for (color, count) in self.held.iter().enumerate() {
            sum += count * (color + 1) as f64;
        }
        sum
    }

    #[inline]
    pub fn kamas(&self) -> f64 {
        self.kamas
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
        let census = Census::of(&catalog, &economy, &stable, 10_000_000);

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
        let census = Census::of(&catalog, &economy, &stable, 10_000_000);
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
        let mut census = Census::of(&catalog, &economy, &stable, 10_000_000);
        let before = census.features(&catalog, &economy);

        let groups = stable.fertile_groups();
        let male = groups.iter().find(|g| g.sex == Sex::Male).expect("un mâle");
        let female = groups
            .iter()
            .find(|g| g.sex == Sex::Female)
            .expect("une femelle");
        let delta = PairDelta::of(&catalog, &economy, &male.sample, &female.sample, economy.mount_level, 11)
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
        let mut census = Census::of(&catalog, &economy, &stable, 10_000_000);

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
        let delta = PairDelta::of(&catalog, &economy, &male.sample, &female.sample, economy.mount_level, 11).expect("ok");

        census.apply_crossing(&delta);
        assert!(
            (fertile(&census) - (before - 1.0)).abs() < 1e-9,
            "deux fécondités consommées, une rendue : {} → {}",
            before,
            fertile(&census)
        );
    }
}
