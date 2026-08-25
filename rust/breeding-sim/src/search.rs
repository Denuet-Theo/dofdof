//! Chercher la composition de la fournée, au lieu de noter les coups un par un.
//!
//! ## Ce qui remplace `scoreOf`
//!
//! La politique actuelle note chaque appariement isolément, trie, et remplit le
//! parc par ordre décroissant. La vingt-cinquième décision ignore donc les
//! vingt-quatre précédentes — c'est pourquoi elle prend les deux orientations du
//! meilleur coup jusqu'à saturation, sans jamais se demander si la dixième copie
//! du même croisement vaut encore quelque chose.
//!
//! Ici il n'y a plus de score par coup. Il y a une **composition** — un ensemble
//! de croisements, d'achats, de clonages et de sacrifices — et une fonction de
//! valeur qui juge **l'écurie que la fournée laisse derrière elle**. La
//! recherche explore les compositions, la fonction de valeur les départage.
//!
//! ## Pourquoi la valeur juge l'état, et pas le coup
//!
//! C'est ce qui la sort de la myopie qui a tué toutes les versions de `scoreOf`.
//! Une gen 9 gardée en réserve avec sa partenaire de lignée ne rapporte aucun
//! kama et ne gagne aucune génération : un score par coup ne peut pas la
//! valoriser. Une fonction de l'état, si — à condition qu'on la lui apprenne,
//! ce qui est le travail de `breeding-neat`.
//!
//! ## L'espérance plutôt que le tirage
//!
//! Un candidat est évalué sur l'écurie **attendue**, pas tirée : chaque
//! croisement ajoute sa distribution d'issues en comptes fractionnaires. Deux
//! évaluations du même candidat rendent donc le même chiffre, et la recherche
//! compare des compositions au lieu de comparer des coups de dés.
//!
//! ## La recherche est une montée de colline, pas un glouton
//!
//! Un glouton par emplacement demanderait, à chaque place, d'évaluer tous les
//! candidats — vingt-cinq fois dix mille évaluations par fournée. On tire donc
//! des **mutations au hasard** (ajouter, retirer, échanger une action) et on
//! garde ce qui améliore. Le tirage est uniforme sur ce qui est disponible :
//! aucune heuristique de qualité ne sert à élaguer, sans quoi on réintroduirait
//! par la porte de derrière exactement ce qu'on cherche à faire découvrir.

use std::collections::HashMap;
use std::sync::Arc;

use crate::economy::{Economy, MAX_UNITS, Rng, Strategy, UnitPlan, UnitView};
use crate::encode::{Census, PairDelta};
use crate::pairing::{Mate, MateSignature};
use crate::ladder::{LadderPolicy, Route, Summit};
use crate::stable::{Sex, Stable};
use crate::trees::{Catalog, ColorId};

/// Ce qui juge une écurie. C'est la seule chose que la neuroévolution remplace.
pub trait ValueFn {
    fn value(&self, census: &Census, catalog: &Catalog, economy: &Economy) -> f64;
}

/// La valeur myope : ce que l'écurie rendrait si on liquidait tout de suite.
///
/// Sans aucun réglage — c'est littéralement la fonction de score de la partie.
/// Elle sert de témoin : une valeur apprise qui ne la bat pas n'a rien appris
/// que l'arithmétique ne donnait déjà.
pub struct Myopic;

impl ValueFn for Myopic {
    fn value(&self, census: &Census, catalog: &Catalog, economy: &Economy) -> f64 {
        census.expected_score(economy, catalog.top_generation())
    }
}

/// D'où vient une monture engagée dans un croisement.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Side {
    /// Un groupe de l'écurie, désigné par son indice.
    Have(usize),
    /// Un gen 1 anonyme qu'on achète pour l'occasion.
    Buy(ColorId),
}

struct Candidate {
    male: Side,
    female: Side,
    delta: Arc<PairDelta>,
}

/// Des montures interchangeables : même couleur, même ascendance, même sexe — et
/// **même état de cycle**.
///
/// Le cycle entre dans la clé parce qu'il change le prix et non la cible : deux
/// Doré de même ascendance visent la même chose, mais celle qui doit encore son
/// cycle coûte une place d'enclos et l'autre non. Les confondre ferait choisir au
/// hasard entre gratuit et payant.
struct Group {
    sex: Option<Sex>,
    generation: usize,
    carried: usize,
    color: ColorId,
    parents: Option<[ColorId; 2]>,
    value: i64,
    /// Son cycle de fécondité est payé : elle s'accouple sans passer par l'enclos.
    cycled: bool,
    members: Vec<usize>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Action {
    Cross(usize),
    /// Deux groupes stériles de même génération. Égaux si le clone est sûr.
    Clone(usize, usize),
    SacrificeFertile(usize),
    SacrificeSterile(usize),
    /// Mettre une fertile en enclos **sans la croiser** : elle en sort féconde et
    /// reste en écurie.
    ///
    /// C'est la seule action réellement nouvelle du découplage, et elle n'a de sens
    /// que parce que la fécondité ne se perd qu'à la naissance. Une place occupée
    /// ainsi n'est pas un croisement de moins : c'est un croisement de plus **au
    /// tour suivant**, gratuit, dès que le partenaire existe.
    Cycle(usize),
}

pub struct SearchConfig {
    /// Mutations tirées par fournée.
    pub iterations: usize,
    /// Proposer des sacrifices, c'est-à-dire l'extraction en ambre.
    ///
    /// À `false` pour le tapis roulant de l'étape 1 : l'ambre convertit du stock
    /// en kamas, donc c'est un arbitrage **économique**, et cette étape-là n'a pas
    /// d'économie. L'y laisser ouverte sans la récompenser était le seul régime
    /// qui n'ait de sens ni dans un cas ni dans l'autre — l'action ne pouvait que
    /// détruire une reproduction.
    ///
    /// On la ferme dans la recherche plutôt qu'en filtrant le plan après coup :
    /// filtrer laisserait le recensement porter un sacrifice qui n'a pas lieu, et
    /// la fonction de valeur jugerait alors une écurie qui n'existe pas.
    pub sacrifices: bool,
}

impl Default for SearchConfig {
    fn default() -> Self {
        Self {
            iterations: 1500,
            sacrifices: true,
        }
    }
}

/// Le moteur de recherche, réutilisé d'une fournée à l'autre pour son cache.
pub struct Searcher {
    /// `mating_outcomes` mémoïsé sur les deux ascendances. Deux montures de même
    /// signature produisent exactement la même distribution, et les mêmes
    /// signatures reviennent sans cesse d'une fournée à l'autre — même
    /// raisonnement que le `shapeCache` du TypeScript, et sans lui la recherche
    /// passe son temps à recalculer des lignées.
    cache: HashMap<(MateSignature, MateSignature, u16, u8), Option<Arc<PairDelta>>>,
    pub config: SearchConfig,
    /// Ce que l'échelle accepte, ou `None` — et `None` est le défaut.
    ///
    /// ## Le décalage que ça ferme
    ///
    /// L'écran passe déjà ce filtre (`SearchConfig.admissible`, côté TypeScript) :
    /// il ne joue **que** les croisements que l'échelle autorise. L'entraînement,
    /// lui, n'en passait aucun. Le champion apprenait donc à choisir dans un
    /// espace **plus large** que celui où il joue, et une part de ce qu'il a
    /// appris — préférer des croisements que l'écran lui refusera — est
    /// inutilisable par construction.
    ///
    /// C'est la troisième forme du même défaut, après l'ambre et la fécondation :
    /// une décision que l'environnement d'entraînement ne pose pas comme l'app la
    /// pose. Voir `AGENTS.md`, « What decides what ».
    ///
    /// Fermé par défaut, et il le faut : `check-search.mjs` compare des plans
    /// entiers au portage, qui n'ouvre le filtre que depuis l'écran.
    pub admissible: Option<LadderPolicy>,
}

impl Default for Searcher {
    fn default() -> Self {
        Self::new(SearchConfig::default())
    }
}

struct State {
    census: Census,
    actions: Vec<Action>,
    fertile_free: Vec<usize>,
    sterile_free: Vec<usize>,
    /// Combien de chaque groupe fertile reste **à féconder** dans cette fournée.
    ///
    /// Distinct de `fertile_free` : féconder ne consomme pas la monture, elle reste
    /// disponible pour un croisement — mais on ne peut pas la féconder deux fois,
    /// et sans ce compteur la recherche gaspillerait des places à repayer un cycle
    /// déjà payé.
    cyclable_free: Vec<usize>,
    crossings: usize,
    /// Places d'enclos engagées.
    ///
    /// C'est la **vraie** contrainte, et elle a remplacé le compte de croisements.
    /// Un croisement paie une place par parent qui doit encore son cycle : deux
    /// fertiles coûtent deux places comme avant, deux fécondes n'en coûtent
    /// aucune. Compter les croisements plafonnait donc quelque chose qui n'est pas
    /// rare — l'accouplement est un clic — au lieu de ce qui l'est : l'enclos.
    places: usize,
    /// Les Optimakina engagées, suivies à part : leur prix dépend du rang visé
    /// par chaque croisement, donc il ne se déduit pas du nombre de places.
    optimakina_cost: i64,
}

#[derive(Clone, Copy)]
enum Mutation {
    Add(Action),
    Remove(usize, Action),
    Swap(usize, Action, Action),
}

impl Searcher {
    pub fn new(config: SearchConfig) -> Self {
        Self {
            cache: HashMap::new(),
            config,
            admissible: None,
        }
    }

    fn delta(
        &mut self,
        catalog: &Catalog,
        economy: &Economy,
        male: &Mate,
        female: &Mate,
        strategy: Strategy,
    ) -> Option<Arc<PairDelta>> {
        // Le niveau et le seuil d'Optimakina entrent dans la clé : ils changent
        // le taux, donc la distribution, donc tout ce que le delta porte.
        let key = (
            (male.color, male.parents),
            (female.color, female.parents),
            strategy.level,
            strategy.optimakina_from,
        );
        if let Some(hit) = self.cache.get(&key) {
            return hit.clone();
        }
        let computed = PairDelta::of(
            catalog,
            economy,
            male,
            female,
            strategy.level,
            strategy.optimakina_from,
        )
        .map(Arc::new);
        self.cache.insert(key, computed.clone());
        computed
    }

    /// Compose la fournée que la fonction de valeur préfère.
    pub fn plan(
        &mut self,
        view: &UnitView<'_>,
        rng: &mut Rng,
        value: &dyn ValueFn,
    ) -> UnitPlan {
        let catalog = view.catalog;
        let economy = view.economy;
        let strategy = view.strategy;

        let (fertile, sterile) = partition(catalog, economy, view.stable);
        let candidates = self.candidates(catalog, economy, &fertile, strategy);
        if candidates.is_empty() && sterile.is_empty() {
            return UnitPlan::default();
        }

        let mut state = State {
            census: Census::of(catalog, economy, view.stable, view.kamas),
            actions: Vec::new(),
            fertile_free: fertile.iter().map(|g| g.members.len()).collect(),
            sterile_free: sterile.iter().map(|g| g.members.len()).collect(),
            cyclable_free: fertile
                .iter()
                .map(|g| if g.cycled { 0 } else { g.members.len() })
                .collect(),
            crossings: 0,
            places: 0,
            optimakina_cost: 0,
        };
        state.census.set_places(0, view.capacity);
        let mut best = value.value(&state.census, catalog, economy);

        for _ in 0..self.config.iterations {
            let Some(mutation) = propose(
                &state,
                &candidates,
                &fertile,
                &sterile,
                view.capacity,
                self.config.sacrifices,
                rng,
            )
            else {
                continue;
            };

            mutation.apply(&mut state, &candidates, &fertile, &sterile, economy);
            // Les places engagées entrent dans le recensement juste avant qu'on le
            // note. Posées et non suivies : `state.places` en tient déjà le compte,
            // et deux compteurs à garder d'accord sur des milliers d'annulations
            // finiraient par diverger sans que rien ne le dise.
            state.census.set_places(state.places, view.capacity);
            let scored = if feasible(&state, economy, view.unit, strategy, view.capacity) {
                value.value(&state.census, catalog, economy)
            } else {
                f64::NEG_INFINITY
            };

            if scored > best {
                best = scored;
            } else {
                mutation.undo(&mut state, &candidates, &fertile, &sterile, economy);
            }
        }

        materialise(&state, &candidates, &fertile, &sterile, view.stable.len())
    }

    fn candidates(
        &mut self,
        catalog: &Catalog,
        economy: &Economy,
        fertile: &[Group],
        strategy: Strategy,
    ) -> Vec<Candidate> {
        let mate_of = |group: &Group| Mate {
            color: group.color,
            level: economy.mount_level,
            parents: group.parents,
        };
        let bought = |color: ColorId| Mate {
            color,
            level: economy.mount_level,
            parents: None,
        };

        // Les gen 1 achetables : sans ascendance, donc une seule signature par
        // couleur. À 1 000 contre 150 000 la fournée, c'est le moyen le moins
        // cher de ne pas laisser une place vide — et c'est la marge que le
        // glouton n'exploite pas.
        let starters: Vec<ColorId> = catalog.ids_at_generation(1).collect();
        let males: Vec<usize> = (0..fertile.len())
            .filter(|&i| fertile[i].sex == Some(Sex::Male))
            .collect();
        let females: Vec<usize> = (0..fertile.len())
            .filter(|&i| fertile[i].sex == Some(Sex::Female))
            .collect();

        let mut pairs: Vec<(Side, Side, Mate, Mate)> = Vec::new();
        for &m in &males {
            for &f in &females {
                pairs.push((
                    Side::Have(m),
                    Side::Have(f),
                    mate_of(&fertile[m]),
                    mate_of(&fertile[f]),
                ));
            }
            for &color in &starters {
                pairs.push((
                    Side::Have(m),
                    Side::Buy(color),
                    mate_of(&fertile[m]),
                    bought(color),
                ));
            }
        }
        for &f in &females {
            for &color in &starters {
                pairs.push((
                    Side::Buy(color),
                    Side::Have(f),
                    bought(color),
                    mate_of(&fertile[f]),
                ));
            }
        }
        for &male_color in &starters {
            for &female_color in &starters {
                pairs.push((
                    Side::Buy(male_color),
                    Side::Buy(female_color),
                    bought(male_color),
                    bought(female_color),
                ));
            }
        }

        let mut out = Vec::with_capacity(pairs.len());
        for (male_side, female_side, male, female) in pairs {
            // La règle de l'échelle entre **dans** la recherche et non après elle :
            // filtrer le plan rendu laisserait la montée dépenser ses places en
            // croisements qu'on jette ensuite. Même raison que côté écran.
            if let Some(policy) = self.admissible.as_mut()
                && !policy.admits(catalog, &male, &female)
            {
                continue;
            }
            if let Some(delta) = self.delta(catalog, economy, &male, &female, strategy) {
                out.push(Candidate {
                    male: male_side,
                    female: female_side,
                    delta,
                });
            }
        }
        out
    }
}

impl Mutation {
    fn apply(
        self,
        state: &mut State,
        candidates: &[Candidate],
        fertile: &[Group],
        sterile: &[Group],
        economy: &Economy,
    ) {
        match self {
            Mutation::Add(action) => {
                apply_effects(state, action, candidates, fertile, sterile, economy);
                state.actions.push(action);
            }
            Mutation::Remove(at, old) => {
                revert_effects(state, old, candidates, fertile, sterile, economy);
                state.actions.swap_remove(at);
            }
            Mutation::Swap(at, old, new) => {
                revert_effects(state, old, candidates, fertile, sterile, economy);
                state.actions.swap_remove(at);
                apply_effects(state, new, candidates, fertile, sterile, economy);
                state.actions.push(new);
            }
        }
    }

    /// L'inverse exact. La fournée est un **ensemble** : rétablir l'ordre
    /// n'importe pas, rétablir le multiensemble et le recensement, si.
    fn undo(
        self,
        state: &mut State,
        candidates: &[Candidate],
        fertile: &[Group],
        sterile: &[Group],
        economy: &Economy,
    ) {
        match self {
            Mutation::Add(action) => {
                state.actions.pop();
                revert_effects(state, action, candidates, fertile, sterile, economy);
            }
            Mutation::Remove(_, old) => {
                apply_effects(state, old, candidates, fertile, sterile, economy);
                state.actions.push(old);
            }
            Mutation::Swap(_, old, new) => {
                state.actions.pop();
                revert_effects(state, new, candidates, fertile, sterile, economy);
                apply_effects(state, old, candidates, fertile, sterile, economy);
                state.actions.push(old);
            }
        }
    }
}

fn apply_effects(
    state: &mut State,
    action: Action,
    candidates: &[Candidate],
    fertile: &[Group],
    sterile: &[Group],
    economy: &Economy,
) {
    match action {
        Action::Cross(index) => {
            let candidate = &candidates[index];
            for (side, sex) in [(candidate.male, Sex::Male), (candidate.female, Sex::Female)] {
                match side {
                    Side::Have(group) => {
                        state.fertile_free[group] -= 1;
                        if fertile[group].cycled {
                            // Une féconde consommée quitte le stock immédiat sans
                            // coûter de place : c'est tout le gain du report.
                            state
                                .census
                                .cycle(fertile[group].generation, sex, -1.0);
                        } else {
                            state.cyclable_free[group] -= 1;
                        }
                    }
                    Side::Buy(color) => {
                        state
                            .census
                            .purchase(color, sex, economy.starter_price, 1.0)
                    }
                }
            }
            state.census.apply_crossing(&candidate.delta);
            state.crossings += 1;
            state.places += places_of(candidate, fertile);
            state.optimakina_cost += candidate.delta.optimakina_cost;
        }
        Action::Cycle(group) => {
            state.cyclable_free[group] -= 1;
            state.places += 1;
            let g = &fertile[group];
            if let Some(sex) = g.sex {
                state.census.cycle(g.generation, sex, 1.0);
            }
        }
        Action::Clone(a, b) => {
            state.sterile_free[a] -= 1;
            state.sterile_free[b] -= 1;
            let g = &sterile[a];
            state.census.cloning(g.generation, g.carried, g.color, g.value, 1.0);
        }
        Action::SacrificeFertile(group) => {
            state.fertile_free[group] -= 1;
            let g = &fertile[group];
            state
                .census
                .sacrifice(g.generation, g.carried, g.color, g.sex, g.value, 1.0);
        }
        Action::SacrificeSterile(group) => {
            state.sterile_free[group] -= 1;
            let g = &sterile[group];
            state
                .census
                .sacrifice(g.generation, g.carried, g.color, None, g.value, 1.0);
        }
    }
}

fn revert_effects(
    state: &mut State,
    action: Action,
    candidates: &[Candidate],
    fertile: &[Group],
    sterile: &[Group],
    economy: &Economy,
) {
    match action {
        Action::Cross(index) => {
            let candidate = &candidates[index];
            state.census.undo_crossing(&candidate.delta);
            for (side, sex) in [(candidate.male, Sex::Male), (candidate.female, Sex::Female)] {
                match side {
                    Side::Have(group) => {
                        state.fertile_free[group] += 1;
                        if fertile[group].cycled {
                            state.census.cycle(fertile[group].generation, sex, 1.0);
                        } else {
                            state.cyclable_free[group] += 1;
                        }
                    }
                    Side::Buy(color) => {
                        state
                            .census
                            .purchase(color, sex, economy.starter_price, -1.0)
                    }
                }
            }
            state.crossings -= 1;
            state.places -= places_of(candidate, fertile);
            state.optimakina_cost -= candidate.delta.optimakina_cost;
        }
        Action::Cycle(group) => {
            state.cyclable_free[group] += 1;
            state.places -= 1;
            let g = &fertile[group];
            if let Some(sex) = g.sex {
                state.census.cycle(g.generation, sex, -1.0);
            }
        }
        Action::Clone(a, b) => {
            state.sterile_free[a] += 1;
            state.sterile_free[b] += 1;
            let g = &sterile[a];
            state.census.cloning(g.generation, g.carried, g.color, g.value, -1.0);
        }
        Action::SacrificeFertile(group) => {
            state.fertile_free[group] += 1;
            let g = &fertile[group];
            state
                .census
                .sacrifice(g.generation, g.carried, g.color, g.sex, g.value, -1.0);
        }
        Action::SacrificeSterile(group) => {
            state.sterile_free[group] += 1;
            let g = &sterile[group];
            state
                .census
                .sacrifice(g.generation, g.carried, g.color, None, g.value, -1.0);
        }
    }
}

/// Places d'enclos qu'un croisement engage : une par parent qui doit son cycle.
///
/// Zéro quand les deux parents sont déjà fécondes — l'accouplement est alors un
/// clic, sans gestation ni séjour en enclos. Une monture achetée arrive fertile,
/// donc elle compte toujours.
fn places_of(candidate: &Candidate, fertile: &[Group]) -> usize {
    [candidate.male, candidate.female]
        .into_iter()
        .filter(|side| match side {
            Side::Have(group) => !fertile[*group].cycled,
            Side::Buy(_) => true,
        })
        .count()
}

fn feasible(state: &State, economy: &Economy, unit: usize, strategy: Strategy, capacity: usize) -> bool {
    if state.places > capacity {
        return false;
    }
    // Le chargement se paie dès qu'une **place** est occupée, et non dès qu'un
    // croisement est lancé. La distinction n'existait pas avant le découplage : un
    // chargement sans croisement était impossible. Elle compte maintenant, sinon
    // féconder serait gratuit et la politique banquerait sans rien payer — un
    // optimum qui n'existe que dans la mesure.
    let load = if state.places > 0 {
        (economy.unit_load(unit, strategy).0 + state.optimakina_cost) as f64
    } else {
        0.0
    };
    state.census.kamas() - load >= 0.0
}

fn partition(catalog: &Catalog, economy: &Economy, stable: &Stable) -> (Vec<Group>, Vec<Group>) {
    let mut fertile: Vec<Group> = Vec::new();
    let mut sterile: Vec<Group> = Vec::new();
    let mut fertile_index: HashMap<(MateSignature, Sex, bool), usize> = HashMap::new();
    let mut sterile_index: HashMap<MateSignature, usize> = HashMap::new();

    for (position, mount) in stable.mounts.iter().enumerate() {
        let signature = mount.signature();
        let make = |sex: Option<Sex>| Group {
            sex,
            generation: catalog.generation(mount.color) as usize,
            carried: mount.carried_generation(catalog) as usize,
            color: mount.color,
            parents: mount.parents,
            value: economy.value_of(catalog, mount.color),
            cycled: mount.cycled,
            members: Vec::new(),
        };

        if mount.fertile {
            let at = *fertile_index
                .entry((signature, mount.sex, mount.cycled))
                .or_insert_with(|| {
                    fertile.push(make(Some(mount.sex)));
                    fertile.len() - 1
                });
            fertile[at].members.push(position);
        } else {
            let at = *sterile_index.entry(signature).or_insert_with(|| {
                sterile.push(make(None));
                sterile.len() - 1
            });
            sterile[at].members.push(position);
        }
    }

    (fertile, sterile)
}

#[allow(clippy::too_many_arguments)]
fn propose(
    state: &State,
    candidates: &[Candidate],
    fertile: &[Group],
    sterile: &[Group],
    capacity: usize,
    sacrifices: bool,
    rng: &mut Rng,
) -> Option<Mutation> {
    let roll = rng.next_f64();
    let pick = |rng: &mut Rng, count: usize| -> usize {
        ((rng.next_f64() * count as f64) as usize).min(count.saturating_sub(1))
    };

    if !state.actions.is_empty() && roll < 0.15 {
        let at = pick(rng, state.actions.len());
        return Some(Mutation::Remove(at, state.actions[at]));
    }

    let action = random_action(state, candidates, fertile, sterile, capacity, sacrifices, rng)?;
    if !state.actions.is_empty() && roll < 0.30 {
        let at = pick(rng, state.actions.len());
        return Some(Mutation::Swap(at, state.actions[at], action));
    }
    Some(Mutation::Add(action))
}

#[allow(clippy::too_many_arguments)]
fn random_action(
    state: &State,
    candidates: &[Candidate],
    fertile: &[Group],
    sterile: &[Group],
    capacity: usize,
    sacrifices: bool,
    rng: &mut Rng,
) -> Option<Action> {
    let pick = |rng: &mut Rng, count: usize| -> usize {
        ((rng.next_f64() * count as f64) as usize).min(count.saturating_sub(1))
    };
    let kind = rng.next_f64();

    // Un croisement le plus souvent : c'est la décision qui porte la partie.
    //
    // Le plafond ne se lit plus sur le nombre de croisements : un croisement de
    // deux fécondes ne coûte aucune place, donc il reste proposable même sur un
    // enclos plein. C'est ce qui rend le report profitable au lieu d'être
    // simplement possible.
    if kind < 0.65 && !candidates.is_empty() {
        // Quelques essais plutôt qu'un balayage : les candidats indisponibles
        // sont minoritaires, et balayer coûterait plus cher que retirer.
        for _ in 0..8 {
            let index = pick(rng, candidates.len());
            let candidate = &candidates[index];
            if available(state, candidate, fertile)
                && state.places + places_of(candidate, fertile) <= capacity
            {
                return Some(Action::Cross(index));
            }
        }
        return None;
    }

    // Féconder sans croiser. Tirée aussi souvent que le clonage : c'est une
    // décision de même nature — préparer plutôt que produire — et rien ne dit
    // encore laquelle des deux paie le plus.
    if kind < 0.80 && state.places < capacity {
        let usable: Vec<usize> = (0..fertile.len())
            .filter(|&i| state.cyclable_free[i] > 0)
            .collect();
        if usable.is_empty() {
            return None;
        }
        return Some(Action::Cycle(usable[pick(rng, usable.len())]));
    }

    if kind < 0.92 {
        let usable: Vec<usize> = (0..sterile.len())
            .filter(|&i| state.sterile_free[i] > 0)
            .collect();
        if usable.is_empty() {
            return None;
        }
        let first = usable[pick(rng, usable.len())];
        let partners: Vec<usize> = usable
            .iter()
            .copied()
            .filter(|&j| {
                sterile[j].generation == sterile[first].generation
                    && (j != first || state.sterile_free[j] >= 2)
            })
            .collect();
        if partners.is_empty() {
            return None;
        }
        return Some(Action::Clone(first, partners[pick(rng, partners.len())]));
    }

    if !sacrifices {
        return None;
    }

    // Un sacrifice, fertile ou stérile. Une gen 1 ne rend rien, donc on ne la
    // propose pas — ce n'est pas une préférence, c'est zéro.
    let from_fertile = rng.next_f64() < 0.5;
    let pool = if from_fertile { fertile } else { sterile };
    let free = if from_fertile {
        &state.fertile_free
    } else {
        &state.sterile_free
    };
    let usable: Vec<usize> = (0..pool.len())
        .filter(|&i| free[i] > 0 && pool[i].value > 0)
        .collect();
    if usable.is_empty() {
        return None;
    }
    let chosen = usable[pick(rng, usable.len())];
    Some(if from_fertile {
        Action::SacrificeFertile(chosen)
    } else {
        Action::SacrificeSterile(chosen)
    })
}

/// Un candidat dont les deux parents sont encore à prendre.
///
/// « Encore à prendre » demande **deux** compteurs, et l'oubli du second a coûté
/// cher. `fertile_free` dit ce qui n'a pas encore été croisé ni sacrifié ;
/// `cyclable_free` dit ce qui n'a été ni croisé ni **mis en banque**. Un groupe
/// dont toutes les montures ont été fécondées dans cette fournée a donc encore du
/// `fertile_free` — la fécondation ne consomme pas la reproduction — mais plus une
/// seule monture disponible.
///
/// Croiser quand même faisait tomber `cyclable_free` sous zéro. Il est `usize` :
/// il repassait par le haut, à `usize::MAX`, et le groupe restait « fécondable »
/// pour toujours. La recherche banquait alors des montures qui n'existent pas,
/// `materialise` les laissait tomber faute de membre à nommer, et la fonction de
/// valeur notait une écurie que le plan ne produit pas — exactement ce que ce
/// module se promet de ne jamais faire.
///
/// Une monture **déjà féconde** est le cas normal où les deux compteurs
/// divergent : son cycle est payé, `cyclable_free` vaut zéro par construction, et
/// il ne dit donc rien de sa disponibilité.
fn available(state: &State, candidate: &Candidate, fertile: &[Group]) -> bool {
    let free = |side: Side| match side {
        Side::Have(group) => {
            state.fertile_free[group] > 0
                && (fertile[group].cycled || state.cyclable_free[group] > 0)
        }
        Side::Buy(_) => true,
    };
    free(candidate.male) && free(candidate.female)
}

fn materialise(
    state: &State,
    candidates: &[Candidate],
    fertile: &[Group],
    sterile: &[Group],
    stable_len: usize,
) -> UnitPlan {
    let mut plan = UnitPlan::default();

    // La recherche a raisonné sur des compteurs ; on rattache ici des montures
    // concrètes. Toutes les membres d'un groupe sont interchangeables par
    // construction, donc l'ordre n'a aucune importance.
    let mut fertile_pool: Vec<Vec<usize>> = fertile.iter().map(|g| g.members.clone()).collect();
    let mut sterile_pool: Vec<Vec<usize>> = sterile.iter().map(|g| g.members.clone()).collect();
    // Combien de fécondations déjà nommées dans chaque groupe, pour piocher par le
    // début sans retirer du pool des croisements.
    let mut cycled_taken: Vec<usize> = vec![0; fertile.len()];
    let mut next_purchase = stable_len;

    for action in &state.actions {
        match *action {
            Action::Cross(index) => {
                let candidate = &candidates[index];
                let mut take = |side: Side, sex: Sex, plan: &mut UnitPlan| match side {
                    Side::Have(group) => fertile_pool[group].pop(),
                    Side::Buy(color) => {
                        plan.purchases.push((color, sex));
                        let at = next_purchase;
                        next_purchase += 1;
                        Some(at)
                    }
                };
                let male = take(candidate.male, Sex::Male, &mut plan);
                let female = take(candidate.female, Sex::Female, &mut plan);
                if let (Some(male), Some(female)) = (male, female) {
                    plan.crossings.push([male, female]);
                    plan.optimakina.push(candidate.delta.optimakina_cost > 0);
                }
            }
            Action::Clone(a, b) => {
                if let (Some(first), Some(second)) = (sterile_pool[a].pop(), sterile_pool[b].pop())
                {
                    plan.clonings.push([first, second]);
                }
            }
            Action::SacrificeFertile(group) => {
                if let Some(index) = fertile_pool[group].pop() {
                    plan.sacrifices.push(index);
                }
            }
            Action::SacrificeSterile(group) => {
                if let Some(index) = sterile_pool[group].pop() {
                    plan.sacrifices.push(index);
                }
            }
            // Une fécondation ne retire rien du vivier : la monture reste
            // disponible pour un croisement de la même fournée. On ne peut donc pas
            // la sortir du pool — mais il ne faut pas non plus nommer deux fois la
            // même monture.
            //
            // Les croisements piochent par la fin (`pop`), les fécondations par le
            // début. Elles ne peuvent pas se rencontrer : `cyclable_free` part de
            // l'effectif du groupe et les deux actions le décrémentent, donc leur
            // somme ne dépasse jamais cet effectif.
            Action::Cycle(group) => {
                let at = cycled_taken[group];
                if let Some(&index) = fertile[group].members.get(at) {
                    cycled_taken[group] += 1;
                    plan.cycles.push(index);
                }
            }
        }
    }

    plan
}

/// La politique qui joue la recherche, quelle que soit la fonction de valeur.
///
/// C'est **le seul point d'entrée** de tout ce qui suit : la valeur myope et la
/// valeur apprise par neuroévolution n'en diffèrent que par `V`. Ce qui remplit
/// la fournée ne change pas ; ce qui juge le résultat, si.
pub struct Searching<V: ValueFn> {
    pub searcher: Searcher,
    pub value: V,
    /// Une stratégie par unité de production. Elles viennent du génome, pas de
    /// la recherche : voir `breeding-neat`, `Genome`.
    pub strategies: [Strategy; MAX_UNITS],
}

impl<V: ValueFn> Searching<V> {
    pub fn new(value: V) -> Self {
        Self::with_iterations(value, SearchConfig::default().iterations)
    }

    /// Ferme l'extraction en ambre. Voir `SearchConfig::sacrifices`.
    pub fn without_sacrifices(mut self) -> Self {
        self.searcher.config.sacrifices = false;
        self
    }

    /// N'autoriser que les croisements de l'échelle. Voir `Searcher::admissible`.
    ///
    /// La couronne se pose ici, une fois : `aims_at` ne répond juste que sur un
    /// plan couronné, et la recherche n'a pas d'endroit où le faire plus tard.
    pub fn under_ladder(mut self, catalog: &Catalog, economy: &Economy, route: Route) -> Self {
        let mut policy = LadderPolicy::new(catalog, route);
        // Le projet **pèse** sur la couronne au lieu de l'imposer : `crown_at` lit
        // `economy.project` et `crown_preference`, donc le filtre et la fitness
        // visent la même couleur sans qu'on force quoi que ce soit ici. C'est ce que
        // `with_forced_crown` faisait, et sa propre doc dit qu'il est un instrument
        // de mesure et non un réglage de jeu. Voir `Economy::crown_preference`.
        // Le sommet s'ouvre **ici aussi**, et pas seulement à l'écran.
        //
        // `SearchConfig.admissible` côté TypeScript filtre avec `'target'` : sans
        // le même réglage de ce côté-ci, la recherche Rust refuserait les
        // croisements que l'écran compose, et le champion s'entraînerait dans un
        // espace plus étroit que celui où il joue. C'est exactement la famille de
        // défauts de #236 — mesurer, entraîner ou noter une politique dans un
        // régime qui n'est pas le sien — et c'est ce que #225 avait laissé ouvert
        // en ne portant que le côté écran. Les deux portes bougent ensemble.
        policy = policy.with_summit(Summit::Target);
        policy.crown(catalog, economy);
        self.searcher.admissible = Some(policy);
        self
    }

    pub fn with_iterations(value: V, iterations: usize) -> Self {
        Self {
            searcher: Searcher::new(SearchConfig {
                iterations,
                ..SearchConfig::default()
            }),
            value,
            // Par défaut : la bande la moins chère, le niveau de l'économie,
            // aucune Optimakina — le réglage le plus neutre possible, et celui
            // qui garde la valeur myope comparable d'une économie à l'autre.
            strategies: [Strategy::default(); MAX_UNITS],
        }
    }

    /// Fixe la stratégie de chaque unité de production.
    pub fn with_strategies(mut self, strategies: [Strategy; MAX_UNITS]) -> Self {
        self.strategies = strategies;
        self
    }
}

impl<V: ValueFn> crate::economy::Policy for Searching<V> {
    fn name(&self) -> &str {
        "recherche"
    }
    fn strategy(&self, unit: usize) -> Strategy {
        self.strategies[unit.min(MAX_UNITS - 1)]
    }

    fn plan(&mut self, view: &UnitView<'_>, rng: &mut Rng) -> UnitPlan {
        let value = &self.value;
        self.searcher.plan(view, rng, value)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::economy::{Draws, NeverBreeds, play, starting_stable};
    use crate::trees::muldo;

    #[test]
    fn la_recherche_ne_produit_que_des_plans_acceptes() {
        let catalog = muldo();
        let economy = Economy::default();
        for seed in [1, 2, 7, 42] {
            let outcome = play(
                &catalog,
                &economy,
                &mut Searching::new(Myopic),
                seed,
            );
            assert_eq!(
                outcome.rejected_loads, 0,
                "graine {seed} : {} fournées refusées",
                outcome.rejected_loads
            );
        }
    }

    #[test]
    fn la_recherche_bat_le_plancher() {
        let catalog = muldo();
        let economy = Economy::default();
        let floor = play(&catalog, &economy, &mut NeverBreeds, 3).score;
        let searched = play(
            &catalog,
            &economy,
            &mut Searching::new(Myopic),
            3,
        )
        .score;
        assert!(
            searched > floor,
            "recherche {searched} contre plancher {floor}"
        );
    }

    /// La sonde linéaire, en fonction de valeur.
    ///
    /// `Myopic` ne lit que les kamas et la liquidation, or féconder ne touche ni
    /// l'un ni l'autre : la note ne bouge pas, la mutation n'améliore pas, elle est
    /// rejetée. Aucun test bâti sur la valeur myope ne peut donc voir une
    /// fécondation, et c'est ce trou qui a laissé passer le débordement de
    /// `cyclable_free` — voir `available`.
    struct Probe;

    impl ValueFn for Probe {
        fn value(&self, census: &Census, _catalog: &Catalog, _economy: &Economy) -> f64 {
            census.linear_probe()
        }
    }

    /// Une monture ne se dépense qu'une fois par fournée.
    ///
    /// Elle peut être croisée, mise en banque, clonée ou sacrifiée — pas deux à la
    /// fois, et l'enclos ne l'accueille qu'une fois. Tous les indices d'un plan sont
    /// donc distincts, et un doublon est le symptôme visible d'un compteur qui a
    /// débordé.
    ///
    /// Ce test travaille sur deux fronts. L'assertion attrape le doublon ; la
    /// compilation de test, qui vérifie les débordements d'entier, attrape la cause
    /// une exécution plus tôt en faisant paniquer `cyclable_free`. En `--release`
    /// il n'y a pas de panique — le compteur repasse simplement par le haut, et
    /// c'est ainsi que le défaut a vécu.
    #[test]
    fn un_plan_ne_nomme_jamais_deux_fois_la_meme_monture() {
        let catalog = muldo();
        let economy = Economy::default();
        let config = crate::sample::SampleConfig::default();

        for seed in [2u32, 5, 11, 23, 47, 96] {
            let stable = crate::sample::sample_stable(
                &catalog,
                &mut Rng::new(seed.wrapping_mul(2_654_435_761)),
                &config,
            );
            let view = UnitView {
                catalog: &catalog,
                economy: &economy,
                stable: &stable,
                kamas: 30_000_000,
                unit: 0,
                strategy: Strategy::default(),
                capacity: 25,
            };
            let plan = Searcher::default().plan(&view, &mut Rng::new(seed), &Probe);

            let mut seen = std::collections::HashSet::new();
            let mut named: Vec<usize> = plan.cycles.clone();
            named.extend(plan.sacrifices.iter().copied());
            named.extend(plan.clonings.iter().flatten().copied());
            named.extend(plan.crossings.iter().flatten().copied());
            for index in named {
                assert!(
                    seen.insert(index),
                    "graine {seed} : la monture {index} est dépensée deux fois — \
                     {} croisements, {} fécondations",
                    plan.crossings.len(),
                    plan.cycles.len(),
                );
            }
        }
    }

    /// Le recensement doit revenir exactement où il était quand une mutation est
    /// rejetée — sinon la recherche dérive et évalue un état qui n'existe pas.
    #[test]
    fn une_mutation_rejetee_ne_laisse_aucune_trace() {
        let catalog = muldo();
        let economy = Economy::default();
        let stable = starting_stable(&catalog, &economy, &Draws::new(9));
        let mut searcher = Searcher::new(SearchConfig { iterations: 0, ..SearchConfig::default() });

        let (fertile, sterile) = partition(&catalog, &economy, &stable);
        let candidates = searcher.candidates(&catalog, &economy, &fertile, Strategy::default());
        assert!(!candidates.is_empty());

        let mut state = State {
            census: Census::of(&catalog, &economy, &stable, 10_000_000),
            actions: Vec::new(),
            fertile_free: fertile.iter().map(|g| g.members.len()).collect(),
            sterile_free: sterile.iter().map(|g| g.members.len()).collect(),
            cyclable_free: fertile
                .iter()
                .map(|g| if g.cycled { 0 } else { g.members.len() })
                .collect(),
            crossings: 0,
            places: 0,
            optimakina_cost: 0,
        };
        let before = state.census.features(&catalog, &economy);
        let free_before = state.fertile_free.clone();
        let cyclable_before = state.cyclable_free.clone();

        let mut rng = Rng::new(5);
        for _ in 0..200 {
            if let Some(mutation) =
                propose(&state, &candidates, &fertile, &sterile, 25, true, &mut rng)
            {
                mutation.apply(&mut state, &candidates, &fertile, &sterile, &economy);
                mutation.undo(&mut state, &candidates, &fertile, &sterile, &economy);
            }
        }

        let after = state.census.features(&catalog, &economy);
        for (index, (a, b)) in before.iter().zip(&after).enumerate() {
            assert!((a - b).abs() < 1e-6, "entrée {index} : {a} ≠ {b}");
        }
        assert_eq!(free_before, state.fertile_free);
        // Les places et le vivier à féconder doivent revenir aussi : une
        // fécondation défaite qui laisserait une place engagée ferait juger toutes
        // les compositions suivantes contre un enclos qu'on croit plus rempli
        // qu'il n'est.
        assert_eq!(cyclable_before, state.cyclable_free);
        assert_eq!(state.places, 0);
        assert!(state.actions.is_empty());
        assert_eq!(state.crossings, 0);
    }
}
