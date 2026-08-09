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

/// Des montures interchangeables : même couleur, même ascendance, même sexe.
struct Group {
    sex: Option<Sex>,
    generation: usize,
    carried: usize,
    color: ColorId,
    parents: Option<[ColorId; 2]>,
    value: i64,
    members: Vec<usize>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Action {
    Cross(usize),
    /// Deux groupes stériles de même génération. Égaux si le clone est sûr.
    Clone(usize, usize),
    SacrificeFertile(usize),
    SacrificeSterile(usize),
}

pub struct SearchConfig {
    /// Mutations tirées par fournée.
    pub iterations: usize,
}

impl Default for SearchConfig {
    fn default() -> Self {
        Self { iterations: 1500 }
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
    crossings: usize,
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
            crossings: 0,
            optimakina_cost: 0,
        };
        let mut best = value.value(&state.census, catalog, economy);

        for _ in 0..self.config.iterations {
            let Some(mutation) = propose(&state, &candidates, &fertile, &sterile, view.capacity, rng)
            else {
                continue;
            };

            mutation.apply(&mut state, &candidates, &fertile, &sterile, economy);
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
                    Side::Have(group) => state.fertile_free[group] -= 1,
                    Side::Buy(color) => {
                        state
                            .census
                            .purchase(color, sex, economy.starter_price, 1.0)
                    }
                }
            }
            state.census.apply_crossing(&candidate.delta);
            state.crossings += 1;
            state.optimakina_cost += candidate.delta.optimakina_cost;
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
                    Side::Have(group) => state.fertile_free[group] += 1,
                    Side::Buy(color) => {
                        state
                            .census
                            .purchase(color, sex, economy.starter_price, -1.0)
                    }
                }
            }
            state.crossings -= 1;
            state.optimakina_cost -= candidate.delta.optimakina_cost;
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

fn feasible(state: &State, economy: &Economy, unit: usize, strategy: Strategy, capacity: usize) -> bool {
    if state.crossings > capacity {
        return false;
    }
    // Le chargement ne se paie que s'il porte un croisement — jauges et
    // Mangeoire comprises, puisque c'est l'enclos qu'on nourrit.
    let load = if state.crossings > 0 {
        (economy.unit_load(unit, strategy).0 + state.optimakina_cost) as f64
    } else {
        0.0
    };
    state.census.kamas() - load >= 0.0
}

fn partition(catalog: &Catalog, economy: &Economy, stable: &Stable) -> (Vec<Group>, Vec<Group>) {
    let mut fertile: Vec<Group> = Vec::new();
    let mut sterile: Vec<Group> = Vec::new();
    let mut fertile_index: HashMap<(MateSignature, Sex), usize> = HashMap::new();
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
            members: Vec::new(),
        };

        if mount.fertile {
            let at = *fertile_index
                .entry((signature, mount.sex))
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

fn propose(
    state: &State,
    candidates: &[Candidate],
    fertile: &[Group],
    sterile: &[Group],
    capacity: usize,
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

    let action = random_action(state, candidates, fertile, sterile, capacity, rng)?;
    if !state.actions.is_empty() && roll < 0.30 {
        let at = pick(rng, state.actions.len());
        return Some(Mutation::Swap(at, state.actions[at], action));
    }
    Some(Mutation::Add(action))
}

fn random_action(
    state: &State,
    candidates: &[Candidate],
    fertile: &[Group],
    sterile: &[Group],
    capacity: usize,
    rng: &mut Rng,
) -> Option<Action> {
    let pick = |rng: &mut Rng, count: usize| -> usize {
        ((rng.next_f64() * count as f64) as usize).min(count.saturating_sub(1))
    };
    let kind = rng.next_f64();

    // Un croisement le plus souvent : c'est la décision qui porte la partie.
    if kind < 0.75 && state.crossings < capacity && !candidates.is_empty() {
        // Quelques essais plutôt qu'un balayage : les candidats indisponibles
        // sont minoritaires, et balayer coûterait plus cher que retirer.
        for _ in 0..8 {
            let index = pick(rng, candidates.len());
            if available(state, &candidates[index]) {
                return Some(Action::Cross(index));
            }
        }
        return None;
    }

    if kind < 0.9 {
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

    // Un sacrifice, féconde ou stérile. Une gen 1 ne rend rien, donc on ne la
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

fn available(state: &State, candidate: &Candidate) -> bool {
    let free = |side: Side| match side {
        Side::Have(group) => state.fertile_free[group] > 0,
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

    pub fn with_iterations(value: V, iterations: usize) -> Self {
        Self {
            searcher: Searcher::new(SearchConfig { iterations }),
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

    /// Le recensement doit revenir exactement où il était quand une mutation est
    /// rejetée — sinon la recherche dérive et évalue un état qui n'existe pas.
    #[test]
    fn une_mutation_rejetee_ne_laisse_aucune_trace() {
        let catalog = muldo();
        let economy = Economy::default();
        let stable = starting_stable(&catalog, &economy, &Draws::new(9));
        let mut searcher = Searcher::new(SearchConfig { iterations: 0 });

        let (fertile, sterile) = partition(&catalog, &economy, &stable);
        let candidates = searcher.candidates(&catalog, &economy, &fertile, Strategy::default());
        assert!(!candidates.is_empty());

        let mut state = State {
            census: Census::of(&catalog, &economy, &stable, 10_000_000),
            actions: Vec::new(),
            fertile_free: fertile.iter().map(|g| g.members.len()).collect(),
            sterile_free: sterile.iter().map(|g| g.members.len()).collect(),
            crossings: 0,
            optimakina_cost: 0,
        };
        let before = state.census.features(&catalog, &economy);
        let free_before = state.fertile_free.clone();

        let mut rng = Rng::new(5);
        for _ in 0..200 {
            if let Some(mutation) =
                propose(&state, &candidates, &fertile, &sterile, 25, &mut rng)
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
        assert!(state.actions.is_empty());
        assert_eq!(state.crossings, 0);
    }
}
