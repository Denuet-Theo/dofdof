//! La politique actuelle, portée telle quelle. C'est le nombre à battre.
//!
//! ## D'où elle vient
//!
//! De `next-move.ts` et `rankedCouples` (dans `loadout.ts`), qui vivent sur la
//! branche **`measure/greedy-vs-route`** et non sur `main`. C'est une distinction
//! qui compte : `main` livre encore la route pilotée par l'arbre (`planCouples`),
//! et la branche mesurait le glouton contre elle. Le glouton gagnait largement —
//! 29,2 M en 36 fournées contre 77,0 M en 89 pour la route, sur douze graines —
//! donc c'est lui la vraie référence, même s'il n'est pas fusionné.
//!
//! Porter la route aurait demandé `breedingPlan` et l'essentiel des 1 652 lignes
//! de `costs.ts`, que cette économie remplace de toute façon.
//!
//! ## Ce qu'elle fait
//!
//! Elle énumère tous les appariements que l'écurie permet, les note, et remplit
//! le parc avec les meilleurs. La note est la partie devinée — celle que douze
//! PR ont réécrite — et elle tient en deux idées :
//!
//! 1. **La hauteur d'abord, l'efficacité pour départager.** Sur un critère
//!    d'efficacité seul le glouton ne monte jamais : gagner une génération coûte
//!    cent fois moins cher entre deux gen 1 qu'entre deux gen 9, donc il refait
//!    des gen 2 indéfiniment. Le score est `portée + eff/(1+eff)`, ce qui range
//!    l'efficacité dans `[0,1[` et l'empêche de franchir un palier.
//! 2. **Fabriquer le partenaire manquant compte comme monter**, amorti par la
//!    distance. Sans amortissement le glouton fabrique le prérequis le plus
//!    profond, parce que c'est le moins cher.
//!
//! ## Ce que j'ai dû ajouter, et qui n'est pas d'elle
//!
//! **Une règle de financement.** La politique TypeScript n'a aucune notion de
//! trésorerie : rien dans `scoreOf` ne sait qu'une fournée coûte 150 000 ni
//! qu'un solde peut tomber à zéro. Sans ajout elle s'arrêterait vers la
//! soixante-sixième fournée, et on mesurerait cet oubli plutôt que sa politique
//! d'appariement.
//!
//! La règle est donc la plus neutre que j'aie trouvée : **quand le solde ne
//! paie plus la fournée, sacrifier des stériles, les mieux dotés d'abord**, ce
//! qui minimise le nombre de têtes converties. Les stériles seulement, parce
//! qu'ils ne peuvent plus rien produire — les féconds sont le capital.
//!
//! C'est un choix, il gonfle ou dégonfle la baseline, et il doit être lu comme
//! tel. Il est isolé dans `fund_the_batch` pour qu'on puisse le remplacer sans
//! toucher au classement.

use std::collections::HashMap;

use crate::economy::{BatchPlan, BatchView, Economy, Policy, Rng};
use crate::pairing::{MateSignature, PairOutlook, pair_outlook};
use crate::stable::{Sex, Stable};
use crate::trees::{Catalog, ColorId};

/// Ce que la politique maximise.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Objective {
    /// Kamas nets par heure d'enclos.
    Profit,
    /// Générations gagnées par kama dépensé.
    Gen10Profit,
    /// Générations gagnées par heure d'enclos. Le défaut de `simulate.ts`.
    Gen10Balanced,
}

/// Ce qu'on retranche à un croisement dont les issues ne sont pas modélisées.
/// Assez pour le renvoyer derrière tout croisement chiffrable, mais fini.
const UNKNOWN_OUTCOME_PENALTY: f64 = -1e9;

/// Profondeur maximale de la descente transitive des prérequis.
const MAX_DEPTH: u32 = 12;

/// Au-delà, la politique consacre une fournée à recycler ses stériles.
/// Seuil porté tel quel de `simulate.ts`.
const CLONE_THRESHOLD: usize = 12;

/// Le contexte de notation, dérivé de l'économie.
///
/// Les correspondances avec `MoveContext` du TypeScript, qui ne sont pas
/// évidentes et qu'il vaut mieux écrire :
///
/// | TypeScript | Ici | Pourquoi |
/// | --- | --- | --- |
/// | `costOf` | valeur de liquidation | consommer une monture, c'est renoncer à son ambre |
/// | `valueOf` | valeur de liquidation | même barème, c'est la seule sortie |
/// | `fuelCostPerCycle` | `150 000 / 25 / 2` = 3 000 | deux par croisement, soit 6 000 |
/// | `batchHours` / `slots` | 1 et 50 | un croisement porte 2/50 de la fournée |
/// | `recycleSteriles` | faux | le clonage est modélisé à part, pas comme une remise |
pub struct Scoring<'a> {
    pub catalog: &'a Catalog,
    pub economy: &'a Economy,
    pub objective: Objective,
    pub fuel_cost_per_cycle: f64,
    pub batch_hours: f64,
    pub slots: f64,
}

impl<'a> Scoring<'a> {
    pub fn new(catalog: &'a Catalog, economy: &'a Economy, objective: Objective) -> Self {
        let crossings = economy.crossings_per_batch.max(1) as f64;
        Self {
            catalog,
            economy,
            objective,
            fuel_cost_per_cycle: economy.batch_cost as f64 / crossings / 2.0,
            batch_hours: 1.0,
            slots: crossings * 2.0,
        }
    }

    #[inline]
    fn value_of(&self, color: ColorId) -> f64 {
        self.economy.value_of(self.catalog, color) as f64
    }
}

/// Ce qu'il manque pour franchir la frontière, et jusqu'où ça porte.
#[derive(Debug, Default)]
pub struct FrontierNeeds {
    /// Couleur manquante → sa distance à la frontière.
    pub depths: HashMap<ColorId, u32>,
    /// `frontier + 1`.
    pub reach: f64,
}

/// La frontière et ce qui manque pour la franchir.
///
/// La **frontière** est la plus haute génération que l'écurie porte, ascendance
/// comprise — et non la plus haute couleur possédée : une gen 1 dont un parent
/// est gen 9 porte un 9.
///
/// Le besoin est **transitif**. Créditer un seul niveau ne débloque rien quand
/// la chaîne en compte deux : mesuré, la montée calait sur un Turquoise-Ivoire
/// qui n'était pas fabricable non plus, faute de *ses* composants.
///
/// > `reserved` n'est pas porté. Le TypeScript le calcule, le fait transiter
/// > par la signature de `scoreOf`… et ne le lit jamais. La pénalité de réserve
/// > que les commentaires décrivent n'est donc pas implémentée là-bas non plus,
/// > et la porter ici aurait changé la baseline au lieu de la reproduire.
pub fn frontier_needs(catalog: &Catalog, stable: &Stable) -> FrontierNeeds {
    let mut held: Vec<bool> = vec![false; catalog.len()];
    let mut frontier = 0u8;
    for mount in &stable.mounts {
        if !mount.fertile {
            continue;
        }
        held[mount.color as usize] = true;
        frontier = frontier.max(mount.carried_generation(catalog));
    }

    let mut depths: HashMap<ColorId, u32> = HashMap::new();
    let mut queue: Vec<(ColorId, u32)> = Vec::new();

    // Une couleur de l'étage suivant se compose de deux couleurs. Quand l'écurie
    // porte l'une et pas l'autre, l'autre est ce qu'il faut fabriquer — et c'est
    // précisément ce qu'un classement sur la hauteur seule ne peut pas vouloir,
    // puisque la produire ne monte pas.
    if frontier < catalog.top_generation() {
        for color in catalog.ids_at_generation(frontier + 1) {
            for &[a, b] in &catalog.color(color).recipes {
                let missing = match (held[a as usize], held[b as usize]) {
                    (true, false) => Some(b),
                    (false, true) => Some(a),
                    _ => None,
                };
                if let Some(missing) = missing
                    && depths.insert(missing, 0).is_none()
                {
                    queue.push((missing, 0));
                }
            }
        }
    }

    let mut head = 0;
    while head < queue.len() {
        let (color, depth) = queue[head];
        head += 1;
        if held[color as usize] || depth >= MAX_DEPTH {
            continue;
        }
        for &[a, b] in &catalog.color(color).recipes {
            for component in [a, b] {
                if held[component as usize] || depths.contains_key(&component) {
                    continue;
                }
                depths.insert(component, depth + 1);
                queue.push((component, depth + 1));
            }
        }
    }

    FrontierNeeds {
        depths,
        reach: f64::from(frontier) + 1.0,
    }
}

/// Un croisement possible, chiffré.
#[derive(Clone, Debug)]
pub struct Move {
    pub male: MateSignature,
    pub female: MateSignature,
    pub outlook: PairOutlook,
    pub available: usize,
    pub gained: f64,
    pub cost: f64,
    pub enclos_hours: f64,
    pub expected_value: f64,
    pub score: f64,
}

/// Le score d'un coup selon l'objectif.
fn score_of(scoring: &Scoring<'_>, mv: &MoveDraft, needs: &FrontierNeeds) -> f64 {
    let unknown = if mv.outlook.target_colors.is_empty() {
        UNKNOWN_OUTCOME_PENALTY
    } else {
        0.0
    };

    if scoring.objective == Objective::Profit {
        let rate = if mv.enclos_hours > 0.0 {
            (mv.expected_value - mv.cost) / mv.enclos_hours
        } else {
            f64::NEG_INFINITY
        };
        return rate + unknown;
    }

    if unknown < 0.0 {
        return unknown;
    }

    // Gagner une génération qu'on tient déjà ne fait pas avancer.
    let progress = mv.gained * mv.outlook.success_rate;
    if progress <= 0.0 {
        return f64::NEG_INFINITY;
    }

    let efficiency = if scoring.objective == Objective::Gen10Profit {
        if mv.cost > 0.0 {
            progress / mv.cost
        } else {
            // Un coût nul est possible. Il ne doit pas rendre le score infini et
            // écraser le classement.
            progress * 1e6
        }
    } else if mv.enclos_hours > 0.0 {
        progress / mv.enclos_hours
    } else {
        0.0
    };

    // Un croisement qui **fabrique le partenaire manquant** compte comme s'il
    // montait, ou presque — amorti par sa distance à la frontière, sans quoi le
    // moins cher des prérequis, qui est toujours le plus lointain, gagne
    // toujours.
    let depth = mv
        .outlook
        .target_colors
        .iter()
        .filter_map(|t| needs.depths.get(&t.color).copied())
        .min();

    let reach = match depth {
        None => f64::from(mv.outlook.target_generation),
        Some(depth) => {
            f64::from(mv.outlook.target_generation).max(needs.reach - 0.5 - f64::from(depth) * 0.5)
        }
    };

    reach + efficiency / (1.0 + efficiency)
}

struct MoveDraft {
    outlook: PairOutlook,
    gained: f64,
    cost: f64,
    enclos_hours: f64,
    expected_value: f64,
}

/// Tous les croisements que l'écurie permet de lancer maintenant, classés.
pub fn available_moves(scoring: &Scoring<'_>, stable: &Stable, limit: usize) -> Vec<Move> {
    let needs = frontier_needs(scoring.catalog, stable);
    let groups = stable.fertile_groups();

    let males: Vec<&_> = groups.iter().filter(|g| g.sex == Sex::Male).collect();
    let females: Vec<&_> = groups.iter().filter(|g| g.sex == Sex::Female).collect();

    let mut best: HashMap<(MateSignature, MateSignature), Move> = HashMap::new();

    for male in &males {
        for female in &females {
            let Some(outlook) = pair_outlook(scoring.catalog, &male.sample, &female.sample) else {
                continue;
            };

            let held = scoring
                .catalog
                .generation(male.sample.color)
                .max(scoring.catalog.generation(female.sample.color));
            let gained = f64::from(
                outlook
                    .target_generation
                    .min(scoring.catalog.top_generation()),
            ) - f64::from(held);

            // Deux parents consommés, plus deux cycles de carburant.
            let parents = scoring.value_of(male.sample.color).max(0.0)
                + scoring.value_of(female.sample.color).max(0.0);
            let cost = parents + scoring.fuel_cost_per_cycle * 2.0;

            let enclos_hours = if scoring.slots > 0.0 {
                scoring.batch_hours * 2.0 / scoring.slots
            } else {
                scoring.batch_hours
            };

            // À défaut de savoir quelle couleur sort d'un raté, on prend la
            // mieux dotée des deux lignées : borne haute, et ça ne sert qu'à
            // départager.
            let on_target = outlook
                .target_colors
                .first()
                .map_or(0.0, |t| scoring.value_of(t.color));
            let off_target = scoring
                .value_of(male.sample.color)
                .max(scoring.value_of(female.sample.color));
            let expected_value = outlook.success_rate * on_target
                + (1.0 - outlook.success_rate) * off_target;

            let draft = MoveDraft {
                outlook,
                gained,
                cost,
                enclos_hours,
                expected_value,
            };
            let score = score_of(scoring, &draft, &needs);
            if score == f64::NEG_INFINITY || draft.outlook.target_colors.is_empty() {
                continue;
            }

            let available = male.members.len().min(female.members.len());
            let mut key = [male.signature, female.signature];
            key.sort();
            let key = (key[0], key[1]);

            match best.get_mut(&key) {
                None => {
                    best.insert(
                        key,
                        Move {
                            male: male.signature,
                            female: female.signature,
                            outlook: draft.outlook,
                            available,
                            gained: draft.gained,
                            cost: draft.cost,
                            enclos_hours: draft.enclos_hours,
                            expected_value: draft.expected_value,
                            score,
                        },
                    );
                }
                Some(current) => {
                    current.available += available;
                    if score > current.score {
                        let available = current.available;
                        *current = Move {
                            male: male.signature,
                            female: female.signature,
                            outlook: draft.outlook,
                            available,
                            gained: draft.gained,
                            cost: draft.cost,
                            enclos_hours: draft.enclos_hours,
                            expected_value: draft.expected_value,
                            score,
                        };
                    }
                }
            }
        }
    }

    let mut moves: Vec<Move> = best.into_values().collect();
    moves.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| b.outlook.target_generation.cmp(&a.outlook.target_generation))
            .then_with(|| {
                b.outlook
                    .success_rate
                    .partial_cmp(&a.outlook.success_rate)
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
            // Les signatures départagent en dernier : sans ça l'ordre dépendrait
            // du parcours d'une table de hachage, et deux exécutions du même
            // programme ne donneraient pas le même chiffre.
            .then_with(|| a.male.cmp(&b.male))
            .then_with(|| a.female.cmp(&b.female))
    });
    moves.truncate(limit);
    moves
}

/// Assez de coups pour remplir n'importe quel parc.
///
/// Le plafond **est** la politique : à 5 coups la montée revient à 15,5 M en
/// 235 fournées, à 400 coups 29,2 M en 36 fournées. Écrémer est moins cher en
/// kamas et six fois plus long en calendrier ; on remplit l'enclos.
const MOVE_LIMIT: usize = 400;

/// Remplit le parc avec les meilleurs coups, et rend les couples formés.
pub fn ranked_couples(
    scoring: &Scoring<'_>,
    stable: &Stable,
    capacity: usize,
) -> Vec<[usize; 2]> {
    if capacity < 2 {
        return Vec::new();
    }

    let mut pool: HashMap<(MateSignature, Sex), Vec<usize>> = HashMap::new();
    for (position, mount) in stable.mounts.iter().enumerate() {
        if mount.fertile {
            pool.entry((mount.signature(), mount.sex))
                .or_default()
                .push(position);
        }
    }

    let ranked = available_moves(scoring, stable, MOVE_LIMIT);
    let mut pairings = Vec::new();
    let mut used = 0;

    for mv in &ranked {
        // Les deux sens du même croisement sont deux couples distincts : ce sont
        // des montures différentes à sortir, même si le résultat est identique.
        for (first, second) in [(mv.male, mv.female), (mv.female, mv.male)] {
            while used + 2 <= capacity {
                let Some(male) = pool.get_mut(&(first, Sex::Male)).and_then(Vec::pop) else {
                    break;
                };
                let Some(female) = pool.get_mut(&(second, Sex::Female)).and_then(Vec::pop) else {
                    // Sans partenaire, la première reste disponible pour l'autre
                    // sens.
                    pool.entry((first, Sex::Male)).or_default().push(male);
                    break;
                };
                pairings.push([male, female]);
                used += 2;
            }
        }
    }

    pairings
}

/// La politique actuelle, jouable dans l'économie fermée.
pub struct Greedy {
    pub objective: Objective,
    /// Couleurs de gen 1 rachetées quand plus rien ne s'accouple, prises à tour
    /// de rôle pour diversifier les lignées.
    next_starter: usize,
}

impl Greedy {
    pub fn new(objective: Objective) -> Self {
        Self {
            objective,
            next_starter: 0,
        }
    }
}

/// Ce que le classement ne sait pas faire, et qu'il faut bien décider.
///
/// Sacrifie des stériles, **les mieux dotés d'abord**, jusqu'à pouvoir payer.
/// Les mieux dotés parce que ça minimise le nombre de têtes converties ; les
/// stériles seulement parce qu'ils ne peuvent plus rien produire.
fn fund_the_batch(view: &BatchView<'_>, needed: i64) -> Vec<usize> {
    if view.kamas >= needed {
        return Vec::new();
    }

    let mut candidates: Vec<(usize, i64)> = view
        .stable
        .mounts
        .iter()
        .enumerate()
        .filter(|(_, m)| !m.fertile)
        .map(|(index, m)| (index, view.economy.value_of(view.catalog, m.color)))
        .filter(|(_, value)| *value > 0)
        .collect();
    candidates.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));

    let mut raised = view.kamas;
    let mut chosen = Vec::new();
    for (index, value) in candidates {
        if raised >= needed {
            break;
        }
        raised += value;
        chosen.push(index);
    }
    chosen
}

/// Apparie les stériles clonables : même génération, même signature d'abord.
fn clone_pairs(view: &BatchView<'_>) -> Vec<[usize; 2]> {
    let by_generation = view.stable.steriles_by_generation(view.catalog);
    let mut pairs = Vec::new();

    for (_, members) in {
        // Ordre déterministe : une table de hachage ne garantit rien, et deux
        // exécutions doivent rendre le même chiffre.
        let mut sorted: Vec<_> = by_generation.into_iter().collect();
        sorted.sort_by_key(|(generation, _)| *generation);
        sorted
    } {
        // Le clonage garde à coup sûr la monture voulue quand les deux portent
        // la même signature ; sinon le jeu tranche à pile ou face. On groupe
        // donc par signature avant d'apparier les restes entre eux.
        let mut by_signature: HashMap<MateSignature, Vec<usize>> = HashMap::new();
        for index in members {
            by_signature
                .entry(view.stable.mounts[index].signature())
                .or_default()
                .push(index);
        }
        let mut leftovers = Vec::new();
        let mut buckets: Vec<Vec<usize>> = by_signature.into_values().collect();
        buckets.sort_by_key(|bucket| bucket.first().copied().unwrap_or(usize::MAX));

        for bucket in buckets {
            let mut iter = bucket.chunks_exact(2);
            for pair in iter.by_ref() {
                pairs.push([pair[0], pair[1]]);
            }
            leftovers.extend_from_slice(iter.remainder());
        }
        leftovers.sort_unstable();
        for pair in leftovers.chunks_exact(2) {
            pairs.push([pair[0], pair[1]]);
        }
    }

    pairs
}

impl Policy for Greedy {
    fn name(&self) -> &str {
        "glouton"
    }

    fn plan(&mut self, view: &BatchView<'_>, _rng: &mut Rng) -> BatchPlan {
        let steriles = view.stable.mounts.iter().filter(|m| !m.fertile).count();

        // Une fournée de recyclage : gratuite, et c'est le seul moyen de rendre
        // de la fécondité. Elle ne consomme pas de croisement, donc on la fait
        // en même temps plutôt qu'à la place.
        let clonings = if steriles >= CLONE_THRESHOLD {
            clone_pairs(view)
        } else {
            Vec::new()
        };

        let scoring = Scoring::new(view.catalog, view.economy, self.objective);
        let capacity = view.economy.crossings_per_batch * 2;
        let mut crossings = ranked_couples(&scoring, view.stable, capacity);

        // Les montures engagées dans un clonage ne peuvent pas servir ailleurs
        // dans la même fournée. Les clonages ne portent que des stériles et les
        // croisements que des fécondes, donc les deux ensembles sont disjoints
        // par construction — mais on ne s'en remet pas à ça.
        let mut claimed = vec![false; view.stable.len()];
        for &[a, b] in &clonings {
            claimed[a] = true;
            claimed[b] = true;
        }
        crossings.retain(|&[m, f]| !claimed[m] && !claimed[f]);

        let mut purchases = Vec::new();
        if crossings.is_empty() {
            // Plus rien ne s'accouple : on rachète une paire de gen 1, en
            // changeant de couleur à chaque fois pour ne pas refaire la même
            // lignée. Porté de `simulate.ts`.
            let starters: Vec<ColorId> = view.catalog.ids_at_generation(1).collect();
            if !starters.is_empty() {
                let color = starters[self.next_starter % starters.len()];
                self.next_starter += 1;
                purchases.push((color, Sex::Male));
                purchases.push((color, Sex::Female));
                let base = view.stable.len();
                crossings.push([base, base + 1]);
            }
        }

        let mut needed = 0;
        if !crossings.is_empty() {
            needed += view.economy.batch_cost;
        }
        needed += purchases.len() as i64 * view.economy.starter_price;

        let sacrifices = fund_the_batch(view, needed);
        let raised: i64 = sacrifices
            .iter()
            .map(|&index| {
                view.economy
                    .value_of(view.catalog, view.stable.mounts[index].color)
            })
            .sum();

        if view.kamas + raised < needed {
            // Insolvable : on ne lance rien plutôt que de proposer un plan que
            // le moteur refusera. Une fournée vide est gratuite.
            return BatchPlan {
                clonings,
                ..Default::default()
            };
        }

        // Un stérile sacrifié ne peut pas être cloné dans la même fournée.
        let sacrificed: std::collections::HashSet<usize> = sacrifices.iter().copied().collect();
        let clonings = clonings
            .into_iter()
            .filter(|[a, b]| !sacrificed.contains(a) && !sacrificed.contains(b))
            .collect();

        BatchPlan {
            purchases,
            clonings,
            crossings,
            sacrifices,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::economy::{Draws, play, starting_stable};
    use crate::trees::muldo;

    #[test]
    fn la_frontiere_et_ses_manques_se_lisent_sur_les_fecondes() {
        let catalog = muldo();
        let economy = Economy::default();
        let stable = starting_stable(&catalog, &economy, &Draws::new(4));
        let needs = frontier_needs(&catalog, &stable);

        let frontier = stable.frontier(&catalog);
        assert_eq!(needs.reach, f64::from(frontier) + 1.0);
        // Avec cent montures en gen 2 à 9, il manque forcément quelque chose
        // pour composer l'étage au-dessus.
        assert!(!needs.depths.is_empty());
    }

    #[test]
    fn le_classement_est_deterministe() {
        // Sans départage explicite, l'ordre dépendrait du parcours d'une table
        // de hachage et deux exécutions ne rendraient pas le même chiffre.
        let catalog = muldo();
        let economy = Economy::default();
        let stable = starting_stable(&catalog, &economy, &Draws::new(11));
        let scoring = Scoring::new(&catalog, &economy, Objective::Gen10Balanced);

        let first = available_moves(&scoring, &stable, 50);
        for _ in 0..5 {
            let again = available_moves(&scoring, &stable, 50);
            assert_eq!(first.len(), again.len());
            for (a, b) in first.iter().zip(&again) {
                assert_eq!(a.male, b.male);
                assert_eq!(a.female, b.female);
                assert_eq!(a.score, b.score);
            }
        }
    }

    #[test]
    fn le_glouton_remplit_le_parc_sans_reutiliser_une_monture() {
        let catalog = muldo();
        let economy = Economy::default();
        let stable = starting_stable(&catalog, &economy, &Draws::new(2));
        let scoring = Scoring::new(&catalog, &economy, Objective::Gen10Balanced);

        let couples = ranked_couples(&scoring, &stable, economy.crossings_per_batch * 2);
        assert!(!couples.is_empty(), "cent montures doivent s'apparier");
        assert!(couples.len() <= economy.crossings_per_batch);

        let mut seen = std::collections::HashSet::new();
        for [male, female] in &couples {
            assert!(seen.insert(*male), "monture {male} réutilisée");
            assert!(seen.insert(*female), "monture {female} réutilisée");
            assert_eq!(stable.mounts[*male].sex, Sex::Male);
            assert_eq!(stable.mounts[*female].sex, Sex::Female);
        }
    }

    #[test]
    fn une_partie_complete_ne_produit_aucun_plan_refuse() {
        // Le compteur `infeasible_batches` est la garde : une politique qui
        // propose des plans que le moteur refuse serait mesurée sur des
        // fournées perdues plutôt que sur ses choix.
        let catalog = muldo();
        let economy = Economy::default();
        for seed in [1, 2, 3, 17, 99] {
            let outcome = play(
                &catalog,
                &economy,
                &mut Greedy::new(Objective::Gen10Balanced),
                seed,
            );
            assert_eq!(
                outcome.infeasible_batches, 0,
                "graine {seed} : {} fournées refusées",
                outcome.infeasible_batches
            );
            assert!(outcome.score > 0);
        }
    }

    #[test]
    fn le_glouton_est_reproductible() {
        let catalog = muldo();
        let economy = Economy::default();
        let a = play(
            &catalog,
            &economy,
            &mut Greedy::new(Objective::Gen10Balanced),
            42,
        );
        let b = play(
            &catalog,
            &economy,
            &mut Greedy::new(Objective::Gen10Balanced),
            42,
        );
        assert_eq!(a, b);
    }
}
