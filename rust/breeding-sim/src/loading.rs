//! Qui choisit les montures à féconder — et faut-il l'apprendre.
//!
//! ## La question, et pourquoi elle se mesure avant de s'écrire
//!
//! Le tapis de `treadmill.rs` promeut **au hasard** : il tient lieu d'enclos sans
//! prétendre décider. L'étape 2 consiste à remplacer ce tirage par un choix — et
//! avant de lui construire un réseau, il faut savoir si un choix appris bat une
//! règle écrite à la main. Sinon on paierait des heures de recherche pour
//! retrouver « prends les plus hautes ».
//!
//! ## Une seule fournée, toutes les places
//!
//! Le parc ne se pilote plus en deux unités désynchronisées. C'est une contrainte
//! d'usage et non de calcul, et `economy.rs` la pose déjà pour le découpage en
//! unités : « six rythmes différents demandent une intervention toutes les trois
//! minutes, et une politique inexécutable ne vaut rien ». Deux vagues à suivre,
//! c'est déjà trop pour qui joue en guilde.
//!
//! Donc un chargement par cycle, sur `enclos × 10` places.
//!
//! ## Ce qui n'est *pas* à décider
//!
//! Combien en féconder. Le transfert de points se paie **à l'enclos** et les dix
//! places en profitent également — « un enclos à moitié vide coûte donc deux fois
//! plus par monture ». Remplir est donc dominant, et la seule vraie question est
//! **lesquelles**, quand il y a plus de fertiles que de places.
//!
//! ## Le soupçon que cette mesure existe pour vérifier
//!
//! `Census::cycle` ne touche que `cycled_males[génération]` et
//! `cycled_females[génération]`. La fonction de valeur voit donc une fécondation
//! comme « une féconde de plus au rang G, sexe S », **et rien d'autre**.
//!
//! Elle ne peut pas distinguer une gen 1 capturée d'une gen 1 portant
//! `[Doré-Pourpre, Doré-Orchidée]`, qui vise la gen 3 et vaut infiniment plus.
//! Or c'est le motif le plus rentable du jeu — `stable.ts` le chiffre à 26 % moins
//! cher par Roux.
//!
//! Prédiction, donc : un chargeur trié sur la génération **portée** devrait battre
//! le chargeur guidé par la valeur. Si c'est le cas, ce n'est pas que le réseau
//! est mal entraîné — c'est que le vecteur d'entrée ne porte pas ce qu'il faudrait
//! pour décider, et il faudra l'étendre avant d'entraîner quoi que ce soit.

use crate::economy::{Economy, Rng};
use crate::encode::Census;
use crate::search::ValueFn;
use crate::stable::{Sex, Stable};
use crate::trees::Catalog;

/// Ce qui décide des montures à mettre en enclos.
pub trait Loader {
    fn name(&self) -> &str;
    /// Les indices à féconder, au plus `places`. Toutes fertiles et non cyclées.
    fn choose(
        &mut self,
        catalog: &Catalog,
        economy: &Economy,
        stable: &Stable,
        places: usize,
        rng: &mut Rng,
    ) -> Vec<usize>;
}

/// Les candidates : ce qui garde sa reproduction et doit encore son cycle.
fn candidates(stable: &Stable) -> Vec<usize> {
    stable
        .mounts
        .iter()
        .enumerate()
        .filter(|(_, mount)| mount.fertile && !mount.cycled)
        .map(|(index, _)| index)
        .collect()
}

/// Au hasard — ce que le tapis faisait, et le plancher à battre.
///
/// Ce n'est pas une politique mais l'absence de politique : si rien ne le bat, il
/// n'y a pas de décision à prendre et l'étape 2 n'existe pas.
pub struct RandomLoader;

impl Loader for RandomLoader {
    fn name(&self) -> &str {
        "au hasard"
    }
    fn choose(
        &mut self,
        _catalog: &Catalog,
        _economy: &Economy,
        stable: &Stable,
        places: usize,
        rng: &mut Rng,
    ) -> Vec<usize> {
        let mut pool = candidates(stable);
        let mut out = Vec::with_capacity(places.min(pool.len()));
        for _ in 0..places.min(pool.len()) {
            let at = ((rng.next_f64() * pool.len() as f64) as usize).min(pool.len() - 1);
            out.push(pool.swap_remove(at));
        }
        out
    }
}

/// La règle écrite à la main : la génération **portée** d'abord, le niveau ensuite.
///
/// Portée et non possédée, et c'est tout l'enjeu : une gen 1 dont un parent est
/// gen 9 porte un 9, et c'est elle qui ouvre la gen 10. Trier sur la couleur
/// jetterait exactement les montures les plus précieuses de l'écurie — c'est
/// l'objet de #59, et c'est ce que la fonction de valeur ne peut pas voir.
///
/// Le niveau départage ensuite parce qu'il achète le taux de réussite :
/// `0,3 + 0,0015 × (niveau A + niveau B)`.
pub struct RankedLoader;

impl Loader for RankedLoader {
    fn name(&self) -> &str {
        "portée puis niveau"
    }
    fn choose(
        &mut self,
        catalog: &Catalog,
        _economy: &Economy,
        stable: &Stable,
        places: usize,
        _rng: &mut Rng,
    ) -> Vec<usize> {
        let mut pool = candidates(stable);
        pool.sort_by(|&a, &b| {
            let key = |index: usize| {
                let mount = &stable.mounts[index];
                (mount.carried_generation(catalog), mount.level)
            };
            key(b).cmp(&key(a))
        });
        pool.truncate(places);
        pool
    }
}

/// Guidé par la fonction de valeur de l'étape 1.
///
/// Glouton sur la valeur marginale, et il peut se le permettre : le recensement
/// ne retient d'une fécondation que `(génération, sexe)`, donc il n'y a au plus
/// que vingt effets distincts à évaluer par place — pas un par monture.
///
/// Cette économie **est** la limite du procédé. Deux montures de même génération
/// et même sexe sont indiscernables pour lui, quelle que soit leur ascendance.
pub struct ValueLoader<'a, V: ValueFn> {
    pub value: &'a V,
}

impl<V: ValueFn> Loader for ValueLoader<'_, V> {
    fn name(&self) -> &str {
        "valeur de l'étape 1"
    }
    fn choose(
        &mut self,
        catalog: &Catalog,
        economy: &Economy,
        stable: &Stable,
        places: usize,
        _rng: &mut Rng,
    ) -> Vec<usize> {
        let pool = candidates(stable);
        if pool.is_empty() {
            return Vec::new();
        }

        // Regroupées par ce que la valeur sait distinguer, et rien de plus.
        let mut buckets: Vec<((usize, Sex), Vec<usize>)> = Vec::new();
        for index in pool {
            let mount = &stable.mounts[index];
            let key = (catalog.generation(mount.color) as usize, mount.sex);
            match buckets.iter_mut().find(|(k, _)| *k == key) {
                Some((_, members)) => members.push(index),
                None => buckets.push((key, vec![index])),
            }
        }
        // À valeur égale entre deux montures d'un même groupe, autant prendre la
        // mieux montée : le niveau achète le taux, et il ne coûte rien ici.
        for (_, members) in &mut buckets {
            members.sort_by_key(|&index| std::cmp::Reverse(stable.mounts[index].level));
        }

        let mut census = Census::of(catalog, economy, stable, 0);
        let mut out = Vec::with_capacity(places);
        for _ in 0..places {
            let mut best: Option<(usize, f64)> = None;
            for (at, ((generation, sex), members)) in buckets.iter().enumerate() {
                if members.is_empty() {
                    continue;
                }
                census.cycle(*generation, *sex, 1.0);
                let scored = self.value.value(&census, catalog, economy);
                census.cycle(*generation, *sex, -1.0);
                if best.is_none_or(|(_, top)| scored > top) {
                    best = Some((at, scored));
                }
            }
            let Some((at, _)) = best else { break };
            let ((generation, sex), members) = &mut buckets[at];
            let Some(index) = members.pop() else { break };
            census.cycle(*generation, *sex, 1.0);
            out.push(index);
        }
        out
    }
}
