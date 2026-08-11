//! L'échelle : la politique d'élevage écrite à la main, barreau par barreau.
//!
//! ## Pourquoi une politique écrite plutôt que cherchée
//!
//! `search.rs` compose ses fournées par montée de colline sur une fonction de
//! valeur. Le défaut n'est pas la recherche mais ce qu'elle optimise : un
//! croisement **augmente toujours** la valeur myope, puisqu'il transforme deux
//! montures en trois — deux stériles qui gardent leur prix de liquidation, plus
//! un bébé — pour un coût marginal nul, le chargement étant forfaitaire. Tout
//! croisement est donc accepté, et ce qui entre dans la fournée est décidé par
//! le tirage de `random_action`, pas par sa qualité.
//!
//! Ce module ne cherche rien. Il applique un plan déduit de l'arbre, et il sert
//! d'**adversaire à battre**.
//!
//! ## La forme de l'arbre
//!
//! Les générations impaires portent les couleurs **simples**, et elles sont
//! rares — cinq en gen 1, deux en gen 3, deux en gen 5, deux en gen 7, quatre en
//! gen 9. Les paires portent les **composées** : `A-B` se fabrique par `A × B`,
//! à la génération `max(gen A, gen B) + 1`. Toute la montée alterne donc :
//! composer deux simples pour monter d'un cran, croiser deux composées pour
//! atteindre le simple du cran suivant.
//!
//! ## Le plan : un jeu de couleurs autorisées, et rien d'autre
//!
//! Tout le raisonnement tient dans une seule règle, et c'est elle qui remplace
//! toute comptabilité de blocs, de rôles ou d'étages :
//!
//! > **Un croisement est admissible si et seulement si ses couleurs cibles sont
//! > non vides et toutes dans le plan.**
//!
//! Elle suffit parce que la cible se lit sur les six cases d'ascendance et sur
//! rien d'autre. Elle rejette d'elle-même tout ce qu'on avait dû écarter à la
//! main :
//!
//! - deux gen 1 de blocs différents, qui nommeraient une gen 2 hors plan ;
//! - une rescapée mariée à une gen 1 ordinaire, qui ne nomme **rien** — sa cible
//!   est forcée un cran trop haut, recopie intégrale, zéro géneton, deux
//!   fécondités brûlées ;
//! - deux rescapées de barreaux différents, qui ne nomment rien non plus ;
//! - deux `Doré-*` identiques, la recette du Roux exigeant deux teintes
//!   distinctes.
//!
//! ## Ce que le choix des couleurs doit respecter
//!
//! ### En gen 2 : une union disjointe de cliques
//!
//! La gen 3 n'a que deux couleurs, et quatre gen 2 sur dix suffisent à les
//! faire. Le choix n'est pas libre : en lisant chaque gen 2 comme une **arête**
//! entre ses deux gen 1, le jeu retenu doit être une union disjointe de cliques.
//!
//! La raison est l'ascendance. Un raté de `A × B` rend une gen 1 de couleur A ou
//! B portant `[A, B]` ; la réemployer face à un C fait rencontrer B et C, qui
//! nomment `B-C`. Dans une clique `B-C` est voulue et rien n'est perdu ; sinon
//! la cible se dédouble et on perd 27 % de la masse utile. Sur les 18 jeux
//! possibles, **6 sont fermés**, tous de la forme *triangle + arête isolée*.
//!
//! ### En gen 5 : partager ou non le gen 4 pivot
//!
//! Deux routes, et `Route` les nomme. Elles atteignent Ivoire et Turquoise au
//! même taux ; ce qui les sépare est la **dispersion des ratés** (voir
//! `Route`).
//!
//! ## Le raccourci, qui rend les ratés précieux
//!
//! Une tentative rate une fois sur deux et rend alors une monture de génération
//! basse **dont les parents sont les deux montures croisées**. Sa couleur dit 1,
//! son ascendance dit 4 : appariée à une autre rescapée de la même tentative,
//! elle revise la même cible et l'atteint au **même taux plein**. Deux montures
//! qu'on jetait valent une composée. La règle d'admissibilité ci-dessus les
//! accepte sans qu'on ait à les reconnaître.
//!
//! ## Le dernier barreau ne suit pas la règle des autres
//!
//! Jusqu'à la gen 7 on produit **les deux** couleurs de chaque étage impair,
//! parce que l'étage suivant a besoin des deux. La gen 9 en compte quatre et on
//! n'en veut qu'**une** : celle dont la gen 10 se vend le mieux. Le jeu tire un
//! prix par couleur de gen 10 (`Economy::for_run`), donc ce choix appartient à
//! la partie et pas au catalogue — d'où `crown`, appelée à la première fournée.
//!
//! La couronne taille ensuite le plan : Corail ne se fabrique que par des gen 8
//! dérivées de Prune, donc Émeraude et ses gen 6 sortent du plan. Ce qui n'est
//! réclamé par rien ne doit pas rester admissible.
//!
//! ## Ce qu'il vaut
//!
//! Deux cents graines, médiane du score, contre les politiques du dépôt :
//!
//! | politique | sans cible | gen 10 | pool hérité | départ de zéro |
//! | --- | --- | --- | --- | --- |
//! | glouton | 1,9 % | 68,3 | 64,89 M | 11,80 M |
//! | recherche / myope | 50,5 % | 9,8 | 37,12 M | 10,77 M |
//! | échelle | **0 %** | 34,5 | 60,12 M | 11,09 M |
//! | échelle + niveau réglé | **0 %** | 39,4 | **67,51 M** | **13,29 M** |
//!
//! La colonne « sans cible » est celle qui compte autant que le score : ce sont
//! les accouplements que le jeu annonce « rien à gagner ». L'échelle n'en
//! propose **aucun**, et c'est verrouillé par un test.
//!
//! ## Ce qu'il fait encore mal
//!
//! Il **sous-emploie le pool de départ**. La partie donne cent muldos répartis
//! de la gen 2 à la gen 9 ; l'échelle en sort 39,4 gen 10 quand le glouton en
//! sort 68,3, parce qu'elle fabrique depuis la gen 1 ce qu'elle a déjà en main.
//! La moisson rattrape une part de l'écart (+14 M mesurés) mais ne le comble
//! pas : elle monnaie les hors-plan, elle ne les fait pas monter.
//!
//! Il **ne se réoriente pas** non plus. Le plan est arrêté à la première fournée
//! et ne bouge plus, alors que la production est un tirage : si Prune sort bien
//! et Émeraude mal, rien ne bascule la route vers Corail — ni, par ricochet, les
//! gen 1 qu'on achète.
//!
//! Il **ne met rien en banque**. `UnitPlan::cycles` permet de faire cycler une
//! monture sans la croiser, donc de garder sa reproduction pour plus tard ;
//! l'échelle ne s'en sert pas. C'est le pendant de sa règle d'admissibilité —
//! elle sait refuser un croisement qui ne rend rien, il lui reste à savoir que
//! ne rien faire d'une monture est parfois le bon coup.

use std::collections::{HashMap, HashSet};

use crate::economy::{MAX_UNITS, Policy, Rng, Strategy, UnitPlan, UnitView};
use crate::pairing::{MateSignature, pair_outlook};
use crate::stable::{Sex, Stable};
use crate::trees::{Catalog, ColorId};

/// Comment on passe de la gen 3 à la gen 5.
///
/// Ivoire et Turquoise se composent toutes deux d'une gen 4 « côté Roux » et
/// d'une gen 4 « côté Amande ». On peut choisir des recettes qui **partagent**
/// une gen 4 ou qui n'en partagent aucune, et les deux atteignent la cible à
/// 50,10 %. Ce qui les sépare est ce que rendent les ratés.
///
/// ## Ce que la mesure en dit
///
/// Sur 200 graines appariées, **rien** : `+0,65 M ± 0,55`, t = 1,19, le cas 2
/// l'emporte 108 fois sur 200. Le choix est indifférent.
///
/// Il ne l'était pas quand l'échelle s'arrêtait à la gen 5 — le cas 2 gagnait
/// alors `+0,45 M ± 0,035`, t = 12,87, 166 fois sur 200. C'est un avertissement
/// à garder : **un barreau se juge sur l'échelle entière**, pas sur le sommet
/// provisoire. Une différence de dispersion des ratés qui compte quand elle est
/// le dernier mot se dilue dès qu'il reste trois étages à monter.
///
/// À la gen 7 la question ne se pose même pas : Prune et Émeraude ne partagent
/// **aucune** gen 6, donc `Shared` n'y a aucun candidat et se rabat sur
/// `Disjoint`. Les deux routes ne diffèrent que par leur gen 4.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Route {
    /// **Cas 1** — une gen 4 pivot sert aux deux gen 5, donc on en fabrique
    /// deux fois plus. Trois couleurs de gen 4 au lieu de quatre, et surtout des
    /// ascendances qui se recoupent : la masse d'échec se concentre sur les
    /// couleurs communes et **une seule** recombinaison sort du plan (3,50 %).
    Shared,
    /// **Cas 2** — quatre gen 4 disjointes, une par côté et par cible. Les
    /// ascendances ne se recoupent pas, donc la masse d'échec s'éparpille sur
    /// quatre couleurs et **quatre** recombinaisons apparaissent, dont trois
    /// hors plan (9,81 %). En contrepartie deux d'entre elles retombent sur une
    /// gen 4 voulue, ce que le cas 1 ne fait pas.
    Disjoint,
}

/// Le plan déduit de l'arbre : les couleurs qu'on s'autorise, comment les faire,
/// et en quelle proportion.
#[derive(Clone, Debug, Default)]
pub struct Ladder {
    /// Toute couleur qu'on accepte de produire. Ce qui naît en dehors part à
    /// l'ambre.
    pub wanted: HashSet<ColorId>,
    /// La recette retenue pour chaque couleur voulue.
    pub recipe_of: HashMap<ColorId, [ColorId; 2]>,
    /// Combien d'unités il en faut pour une unité de chaque cible finale.
    /// Propagé depuis le sommet : c'est lui qui donne le « deux fois plus de
    /// Roux-Amande » sans qu'on ait à l'écrire.
    pub demand: HashMap<ColorId, f64>,
    /// Les blocs fermés de gen 1, qui disent quoi acheter.
    pub blocks: Vec<Vec<ColorId>>,
    /// Les couleurs les plus hautes du plan : ce qu'on cherche à produire.
    pub summit: Vec<ColorId>,
}

/// La composition d'une couleur : ses deux teintes, telles que l'arbre les
/// nomme. Une composée n'a qu'une composition, c'est ce qui la définit.
fn constituents(catalog: &Catalog, color: ColorId) -> Option<[ColorId; 2]> {
    catalog.color(color).recipes.first().copied()
}

/// Un jeu de gen 2 candidat : les couleurs retenues, la recette de chaque gen 3
/// qu'elles servent, et les blocs fermés qui en découlent.
type SecondTier = (
    Vec<ColorId>,
    HashMap<ColorId, [ColorId; 2]>,
    Vec<Vec<ColorId>>,
);

/// Un jeu de gen 4 candidat : son coût en gen 1 déjà sollicitées, son nombre de
/// couleurs, ces couleurs, et la recette de chaque gen 5.
type FourthTier = (usize, usize, Vec<ColorId>, Vec<[ColorId; 2]>);

impl Ladder {
    /// Le plus haut barreau que l'échelle sait poser aujourd'hui.
    pub const TOP_RUNG: u8 = 7;

    pub fn of(catalog: &Catalog, route: Route) -> Self {
        let mut ladder = Self::default();
        if !ladder.lay_third(catalog) {
            return Self::default();
        }
        // On monte de deux en deux : les couleurs simples sont aux générations
        // impaires, et c'est elles qui font les barreaux.
        let mut rung = 5;
        while rung <= Self::TOP_RUNG {
            // La route demandée peut n'avoir aucun candidat — chez le muldo,
            // Prune et Émeraude ne partagent **aucune** gen 6, donc le cas 1
            // n'existe pas à cet étage. On se rabat plutôt que de s'arrêter :
            // interrompre la montée fausserait la comparaison entre les routes.
            if !ladder.lay_rung(catalog, rung, route) {
                let fallback = match route {
                    Route::Shared => Route::Disjoint,
                    Route::Disjoint => Route::Shared,
                };
                if !ladder.lay_rung(catalog, rung, fallback) {
                    break;
                }
            }
            rung += 2;
        }
        ladder.spread_demand(catalog);
        ladder
    }

    /// La gen 3 : un jeu de gen 2 minimal **et fermé** couvrant toutes les gen 3.
    ///
    /// Énumère un choix de recette par gen 3 — 18 combinaisons chez le muldo —
    /// et ne garde que celles dont le graphe des arêtes est une union disjointe
    /// de cliques. À égalité on préfère le jeu le plus petit, puis l'ordre des
    /// identifiants, pour que deux exécutions rendent le même plan.
    fn lay_third(&mut self, catalog: &Catalog) -> bool {
        let third: Vec<ColorId> = catalog.ids_at_generation(3).collect();
        if third.is_empty() {
            return false;
        }

        let choices: Vec<Vec<[ColorId; 2]>> = third
            .iter()
            .map(|&color| {
                let mut recipes = catalog.color(color).recipes.clone();
                recipes.sort_unstable();
                recipes
            })
            .collect();
        if choices.iter().any(|recipes| recipes.is_empty()) {
            return false;
        }

        let mut best: Option<SecondTier> = None;
        let total: usize = choices.iter().map(|r| r.len()).product();
        for index in 0..total {
            let mut rest = index;
            let mut recipes: HashMap<ColorId, [ColorId; 2]> = HashMap::new();
            let mut seconds: HashSet<ColorId> = HashSet::new();
            for (position, options) in choices.iter().enumerate() {
                let recipe = options[rest % options.len()];
                rest /= options.len();
                seconds.insert(recipe[0]);
                seconds.insert(recipe[1]);
                recipes.insert(third[position], recipe);
            }

            // Chaque gen 2 voulue est une arête entre ses deux gen 1.
            let mut edges: HashSet<(ColorId, ColorId)> = HashSet::new();
            let mut vertices: HashSet<ColorId> = HashSet::new();
            let mut sound = true;
            for &color in &seconds {
                match constituents(catalog, color) {
                    Some([a, b]) if a != b => {
                        edges.insert((a.min(b), a.max(b)));
                        vertices.insert(a);
                        vertices.insert(b);
                    }
                    _ => sound = false,
                }
            }
            if !sound {
                continue;
            }

            let neighbours = |v: ColorId| -> Vec<ColorId> {
                edges
                    .iter()
                    .filter_map(|&(a, b)| match (a == v, b == v) {
                        (true, _) => Some(b),
                        (_, true) => Some(a),
                        _ => None,
                    })
                    .collect()
            };
            // Fermeture : deux arêtes partageant un sommet exigent la troisième.
            let closed = vertices.iter().all(|&v| {
                let near = neighbours(v);
                near.iter().all(|&x| {
                    near.iter()
                        .all(|&y| x == y || edges.contains(&(x.min(y), x.max(y))))
                })
            });
            if !closed {
                continue;
            }

            // Les blocs sont les composantes connexes, qui sont les cliques.
            let mut blocks: Vec<Vec<ColorId>> = Vec::new();
            let mut seen: HashSet<ColorId> = HashSet::new();
            let mut sorted: Vec<ColorId> = vertices.iter().copied().collect();
            sorted.sort_unstable();
            for &start in &sorted {
                if !seen.insert(start) {
                    continue;
                }
                let mut block = vec![start];
                let mut queue = vec![start];
                while let Some(v) = queue.pop() {
                    for next in neighbours(v) {
                        if seen.insert(next) {
                            block.push(next);
                            queue.push(next);
                        }
                    }
                }
                block.sort_unstable();
                blocks.push(block);
            }
            blocks.sort();

            let mut order: Vec<ColorId> = seconds.iter().copied().collect();
            order.sort_unstable();
            let better = match &best {
                None => true,
                Some((current, _, _)) => (order.len(), &order) < (current.len(), current),
            };
            if better {
                best = Some((order, recipes, blocks));
            }
        }

        let Some((seconds, recipes, blocks)) = best else {
            return false;
        };

        for color in seconds {
            if let Some(recipe) = constituents(catalog, color) {
                self.wanted.insert(color);
                self.recipe_of.insert(color, recipe);
            }
        }
        for (color, recipe) in recipes {
            self.wanted.insert(color);
            self.recipe_of.insert(color, recipe);
            self.summit.push(color);
        }
        self.blocks = blocks;
        self.summit.sort_unstable();
        true
    }

    /// Un barreau impair : choisir une recette par cible, selon la route.
    ///
    /// Le même code sert aux gens 5, 7 et suivantes — l'arbre répète le motif,
    /// donc le poseur aussi. Deux critères, dans cet ordre :
    ///
    /// 1. **Le travail accumulé**, mesuré par la somme des générations des
    ///    ingrédients de chaque composée retenue. Une gen 6 faite d'une gen 5 et
    ///    d'une gen 1 coûte 6 ; la même faite de deux gen 5 coûte 10, et ces
    ///    deux gen 5 sont exactement ce que la montée a de plus rare.
    /// 2. **Les gen 1 les moins sollicitées** par les barreaux du dessous, à
    ///    coût égal. C'est le critère qui a mené aux deux cas de la gen 5.
    ///
    /// Rend `false` quand la route demandée n'a aucun candidat — voir l'appelant,
    /// qui se rabat alors sur l'autre.
    fn lay_rung(&mut self, catalog: &Catalog, generation: u8, route: Route) -> bool {
        let targets: Vec<ColorId> = catalog.ids_at_generation(generation).collect();
        if targets.len() < 2 {
            return false;
        }

        // Ce que chaque gen 1 sert déjà, pour départager à coût égal.
        let mut usage: HashMap<ColorId, usize> = HashMap::new();
        for &color in &self.wanted {
            if let Some([a, b]) = constituents(catalog, color) {
                for ingredient in [a, b] {
                    if catalog.generation(ingredient) == 1 {
                        *usage.entry(ingredient).or_default() += 1;
                    }
                }
            }
        }
        // Ce qu'une composée coûte : le travail que ses deux ingrédients ont
        // demandé, puis la charge qu'elle ajoute aux gen 1 déjà prises.
        let toll = |color: ColorId| -> (usize, usize) {
            match constituents(catalog, color) {
                Some([a, b]) => (
                    usize::from(catalog.generation(a)) + usize::from(catalog.generation(b)),
                    [a, b]
                        .iter()
                        .map(|c| usage.get(c).copied().unwrap_or(0))
                        .sum(),
                ),
                None => (usize::MAX, usize::MAX),
            }
        };

        let options: Vec<Vec<[ColorId; 2]>> = targets
            .iter()
            .map(|&color| {
                let mut recipes = catalog.color(color).recipes.clone();
                recipes.sort_unstable();
                recipes
            })
            .collect();
        if options.iter().any(|r| r.is_empty()) {
            return false;
        }

        let mut best: Option<FourthTier> = None;
        let total: usize = options.iter().map(|r| r.len()).product();
        for index in 0..total {
            let mut rest = index;
            let mut picked: Vec<[ColorId; 2]> = Vec::with_capacity(targets.len());
            for recipes in &options {
                picked.push(recipes[rest % recipes.len()]);
                rest /= recipes.len();
            }

            let mut ingredients: Vec<ColorId> = picked.iter().flatten().copied().collect();
            ingredients.sort_unstable();
            let distinct = {
                let mut unique = ingredients.clone();
                unique.dedup();
                unique
            };
            let shared = ingredients.len() - distinct.len();

            // Cas 1 : au moins un pivot partagé. Cas 2 : aucun.
            let fits = match route {
                Route::Shared => shared >= 1,
                Route::Disjoint => shared == 0,
            };
            if !fits {
                continue;
            }

            let work: usize = distinct.iter().map(|&c| toll(c).0).sum();
            let strain: usize = distinct.iter().map(|&c| toll(c).1).sum();
            let better = match &best {
                None => true,
                Some((w, s, current, _)) => (work, strain, &distinct) < (*w, *s, current),
            };
            if better {
                best = Some((work, strain, distinct, picked));
            }
        }

        let Some((_, _, ingredients, picked)) = best else {
            return false;
        };

        for color in ingredients {
            if let Some(recipe) = constituents(catalog, color) {
                self.wanted.insert(color);
                self.recipe_of.insert(color, recipe);
            }
        }
        self.summit.clear();
        for (position, recipe) in picked.into_iter().enumerate() {
            let color = targets[position];
            self.wanted.insert(color);
            self.recipe_of.insert(color, recipe);
            self.summit.push(color);
        }
        self.summit.sort_unstable();
        true
    }

    /// La couronne : choisir **une** gen 9 et la gen 10 qu'elle ouvre.
    ///
    /// Les barreaux du dessous produisent toutes les couleurs de leur étage,
    /// parce que la montée en a besoin des deux. Le dernier ne suit pas cette
    /// règle : les quatre gen 9 ouvrent chacune des gen 10, on n'en a besoin
    /// que d'**une**, et le jeu a prévu que le choix compte — chaque couleur de
    /// gen 10 porte son propre prix, tiré par partie (`Economy::for_run`).
    ///
    /// On prend donc la gen 10 la mieux payée **parmi celles qui se font avec
    /// une gen 1**, puisqu'une gen 1 s'achète à 1 000 kamas là où le second
    /// ingrédient pourrait être une autre gen 9. La gen 9 qu'elle nomme devient
    /// la cible du barreau, et elle seule.
    ///
    /// Dépend de l'économie, donc ne peut pas se décider au chargement de
    /// l'arbre : `LadderPolicy` l'appelle à sa première fournée.
    pub fn crown(&mut self, catalog: &Catalog, economy: &crate::economy::Economy) {
        let top = catalog.top_generation();
        let ninth = top - 1;

        // Les gen 10 accessibles d'une gen 9 et d'une gen 1, la mieux payée
        // devant. Départage par identifiant pour rester déterministe.
        let mut candidates: Vec<(i64, ColorId, ColorId, ColorId)> = Vec::new();
        for color in catalog.ids_at_generation(top) {
            let Some([a, b]) = constituents(catalog, color) else {
                continue;
            };
            let (high, low) = if catalog.generation(a) > catalog.generation(b) {
                (a, b)
            } else {
                (b, a)
            };
            if catalog.generation(high) != ninth || catalog.generation(low) != 1 {
                continue;
            }
            candidates.push((economy.value_of(catalog, color), color, high, low));
        }
        candidates.sort_by(|x, y| y.0.cmp(&x.0).then_with(|| x.1.cmp(&y.1)));

        let Some(&(_, crown, target, partner)) = candidates.first() else {
            return;
        };
        // La gen 1 partenaire doit être achetable, donc rattachée à un bloc.
        if !self.blocks.iter().any(|block| block.contains(&partner)) {
            return;
        }

        // Le barreau gen 9, sur cette cible seule.
        if !self.lay_single(catalog, target) {
            return;
        }

        self.wanted.insert(crown);
        self.recipe_of.insert(crown, [target, partner]);
        self.summit = vec![crown];
        self.spread_demand(catalog);

        // ## Tailler ce que la couronne ne réclame pas
        //
        // Les barreaux du dessous produisent **les deux** couleurs de leur
        // étage, parce qu'on ne savait pas encore laquelle servirait. La
        // couronne tranche : Corail ne se fait que par des gen 8 dérivées de
        // Prune, donc Émeraude et ses gen 6 tombent à une demande de zéro.
        //
        // Les laisser dans le plan ne serait pas neutre : elles resteraient
        // **admissibles**, donc un croisement pourrait les viser au lieu de
        // servir la route. Un plan doit être exactement ce dont on a besoin.
        let dead: Vec<ColorId> = self
            .wanted
            .iter()
            .copied()
            .filter(|color| self.demand.get(color).copied().unwrap_or(0.0) <= 0.0)
            .collect();
        for color in dead {
            self.wanted.remove(&color);
            self.recipe_of.remove(&color);
            self.demand.remove(&color);
        }
    }

    /// Pose une cible unique : sa recette la moins coûteuse, et les composées
    /// qu'elle réclame. Même critère de travail accumulé que `lay_rung`.
    fn lay_single(&mut self, catalog: &Catalog, target: ColorId) -> bool {
        let work = |color: ColorId| -> usize {
            match constituents(catalog, color) {
                Some([a, b]) => {
                    usize::from(catalog.generation(a)) + usize::from(catalog.generation(b))
                }
                None => usize::MAX,
            }
        };

        let mut recipes = catalog.color(target).recipes.clone();
        recipes.sort_unstable();
        let Some(&recipe) = recipes.iter().min_by_key(|&&[a, b]| {
            let mut pair = [a, b];
            pair.sort_unstable();
            (work(a).saturating_add(work(b)), pair)
        }) else {
            return false;
        };

        for ingredient in recipe {
            let Some(inner) = constituents(catalog, ingredient) else {
                return false;
            };
            self.wanted.insert(ingredient);
            self.recipe_of.insert(ingredient, inner);
        }
        self.wanted.insert(target);
        self.recipe_of.insert(target, recipe);
        true
    }

    /// Combien il faut de chaque couleur, propagé depuis le sommet.
    ///
    /// C'est ce qui produit le « deux fois plus de Roux-Amande » du cas 1 : la
    /// couleur pivot reçoit la demande de ses **deux** consommatrices, les
    /// autres celle d'une seule. Rien n'est écrit à la main.
    fn spread_demand(&mut self, catalog: &Catalog) {
        // Recalculée de zéro : `crown` déplace le sommet, donc les demandes
        // d'avant sont périmées et les cumuler les doublerait.
        self.demand.clear();
        for &color in &self.summit {
            self.demand.insert(color, 1.0);
        }
        let mut order: Vec<ColorId> = self.wanted.iter().copied().collect();
        order.sort_by_key(|&c| std::cmp::Reverse((catalog.generation(c), c)));

        for color in order {
            let share = self.demand.get(&color).copied().unwrap_or(0.0);
            if share <= 0.0 {
                continue;
            }
            if let Some(recipe) = self.recipe_of.get(&color).copied() {
                for ingredient in recipe {
                    if self.wanted.contains(&ingredient) {
                        *self.demand.entry(ingredient).or_default() += share;
                    }
                }
            }
        }
    }

    #[inline]
    pub fn is_empty(&self) -> bool {
        self.wanted.is_empty()
    }
}

/// Combien de tentatives d'une couleur **simple** il faut pouvoir former avant
/// de la lancer.
///
/// En deçà, les ingrédients restent en réserve : ils ne perdent rien à
/// attendre, et une fournée qui ne lance que deux croisements paie le même
/// forfait qu'une qui en lance dix. Le chiffre vient du dicté, pas d'une
/// mesure — c'est le premier réglage à faire varier.
pub const RUNG_THRESHOLD: usize = 10;

/// Ce qu'une fournée accumule pendant qu'on la compose.
///
/// Regroupé plutôt que passé en quatre paramètres : les places, le budget et ce
/// qu'on a déjà engagé ne se lisent que **ensemble** — une phase qui en
/// modifierait une sans les autres produirait un plan que le moteur refuse.
struct Building {
    crossings: Vec<[usize; 2]>,
    purchases: Vec<(ColorId, Sex)>,
    budget: i64,
    places: usize,
}

pub struct LadderPolicy {
    ladder: Ladder,
    pub threshold: usize,
    /// Apparier les stériles sans regarder leur sexe.
    ///
    /// **Mesuré indifférent** : `-0,27 M ± 0,57` sur 200 graines appariées,
    /// t = -0,46, 100 parties gagnées sur 200. Les deux effets s'annulent — à
    /// sexe égal le clone est certain, mais trier laisse des montures de même
    /// lignée dépareillées, et en espérance `M` mâles et `F` femelles rendent
    /// `M/2` et `F/2` clones dans les deux appariements.
    ///
    /// Le tri reste le défaut, faute d'une raison de changer. Gardé comme levier
    /// parce que les deux raisonnements sont tentants et que seul le chiffre
    /// tranche — il a d'ailleurs tranché **autrement** avant que le cycle de
    /// fécondité se détache de l'accouplement, ce qui dit assez qu'il faut le
    /// remesurer après tout changement du modèle de places.
    pub sex_blind_cloning: bool,
    /// Monnayer les montures hors plan. Exposé pour pouvoir isoler son effet.
    pub harvesting: bool,
    /// Cloner entre lignées différentes, à la seule condition que le jeu pose —
    /// la même génération affichée. Sinon on n'apparie qu'à signature égale, ce
    /// qui rend le tirage sans enjeu mais ne se déclenche presque jamais.
    ///
    /// ## Le relâchement n'est pas bon partout
    ///
    /// Un clonage échange **une monture contre une fécondité** : deux stériles
    /// entrent, une féconde sort. Ce que la fécondité vaut dépend donc de ce
    /// qu'on peut encore en faire, et la mesure sépare nettement les deux
    /// régimes — 200 graines appariées, écart au clonage par signature :
    ///
    /// | | avec moisson | sans moisson |
    /// | --- | --- | --- |
    /// | pool hérité | **+14,06 M** (t = 22,6) | +6,86 M (t = 13,8) |
    /// | départ de zéro | **−1,62 M** (t = −26,6) | −1,63 M (t = −26,8) |
    ///
    /// Avec un parc hérité, la fécondité alimente la production de gen 10 à
    /// 500 000 pièce et vaut bien plus que la liquidation sacrifiée. En partant
    /// de cent gen 1, rien n'atteint la gen 10 dans l'horizon : la fécondité ne
    /// mène nulle part et on a détruit une monture pour rien.
    ///
    /// L'écart entre les deux colonnes est l'autre enseignement : la moisson
    /// **double** ce que le relâchement rapporte. Elle brûle la fécondité des
    /// montures hors plan, donc elle fabrique les stériles que le clonage
    /// recycle. Les deux règles se nourrissent, ce qui ne se voyait pas en les
    /// jugeant séparément.
    ///
    /// Le défaut reste `true` : c'est le régime réaliste, et c'est là que les
    /// montants sont grands. Rendre le choix automatique demanderait de chiffrer
    /// une fécondité contre une liquidation — exactement ce qu'une fonction de
    /// valeur apprise sait faire et qu'un seuil deviné referait mal.
    pub clone_across_lineages: bool,
    next_starter: usize,
    /// La couronne est posée une fois, à la première fournée : elle dépend des
    /// prix tirés par la partie.
    crowned: bool,
    /// Les réglages d'unité, quand on en impose. Voir `with_strategies`.
    strategies: Option<[Strategy; MAX_UNITS]>,
    /// `pair_outlook` mémoïsé sur les deux signatures : les mêmes ascendances
    /// reviennent sans cesse d'une fournée à l'autre.
    admissible: HashMap<(MateSignature, MateSignature), Option<ColorId>>,
}

impl LadderPolicy {
    pub fn new(catalog: &Catalog, route: Route) -> Self {
        Self::with_ladder(Ladder::of(catalog, route))
    }

    /// Le plan ne dépend pas de la partie : le calculer une fois et le cloner
    /// évite de relire l'arbre à chaque graine.
    pub fn with_ladder(ladder: Ladder) -> Self {
        Self {
            ladder,
            threshold: RUNG_THRESHOLD,
            sex_blind_cloning: false,
            clone_across_lineages: true,
            harvesting: true,
            next_starter: 0,
            crowned: false,
            strategies: None,
            admissible: HashMap::new(),
        }
    }

    pub fn ladder(&self) -> &Ladder {
        &self.ladder
    }

    /// Les réglages d'unité — bandes de jauge, niveau, seuil d'Optimakina.
    ///
    /// Par défaut l'échelle prend `Strategy::default()`, comme le glouton : la
    /// bande la moins chère, donc la fournée la plus lente. C'était un choix
    /// méthodologique — comparer les appariements sans laisser les leviers
    /// brouiller la mesure — et il s'est révélé coûteux : le champion tire
    /// **61 chargements** de l'horizon là où le glouton et l'échelle n'en
    /// tirent que 30, parce qu'il raccourcit ses fournées.
    ///
    /// On expose donc le levier pour pouvoir comparer à chargements égaux. Ce
    /// n'est pas une politique d'appariement, c'est l'agenda.
    pub fn with_strategies(mut self, strategies: [Strategy; MAX_UNITS]) -> Self {
        self.strategies = Some(strategies);
        self
    }

    /// Remonter le niveau de chaque unité **jusqu'à la dernière marche
    /// gratuite**.
    ///
    /// Le niveau ne s'achète pas en kamas mais en points de jauge, donc en
    /// heures : `mount_xp_for_level` monte en `level^2,329`, et l'horizon paie
    /// la différence en fournées perdues. Balayé sur l'échelle, l'effet est
    /// brutal — niveau 200 rend 90 % de réussite et **5** fournées là où le
    /// niveau 36 rend 40,8 % et **65**. Le volume écrase le taux d'un facteur
    /// sept sur les réussites seules.
    ///
    /// Mais la durée est un **escalier**, pas une pente : entre deux marches,
    /// monter le niveau ne coûte rien et améliore le taux. L'optimum est donc
    /// toujours le dernier niveau avant la marche, et il se trouve exactement,
    /// sans jouer une partie — `unit_load` est déterministe. Chercher le sommet
    /// du score à la place reviendrait à fouiller le bruit : la médiane sur
    /// 200 graines bouge de plusieurs centaines de milliers.
    ///
    /// Mesuré sur 200 graines appariées, contre le réglage neutre :
    ///
    /// | | écart | t | gagne |
    /// | --- | --- | --- | --- |
    /// | pool hérité | **+7,07 M ± 0,67** | 10,6 | 153/200 |
    /// | départ de zéro | **+2,17 M ± 0,07** | 29,7 | 198/200 |
    pub fn tuned_for(mut self, economy: &crate::economy::Economy) -> Self {
        let Some(strategies) = self.strategies.as_mut() else {
            return self;
        };
        let horizon = economy.horizon_hours.unwrap_or(300.0);

        let units = economy.unit_count().min(MAX_UNITS);
        for (unit, strategy) in strategies.iter_mut().enumerate().take(units) {
            let bands = *strategy;
            let loads = |level: u16| {
                let mut probe = bands;
                probe.level = level;
                (horizon / economy.unit_load(unit, probe).1).floor() as i64
            };

            // Invariant : `low` garde le compte plancher, `high` l'a perdu.
            let ceiling = loads(1);
            let (mut low, mut high) = (1u16, crate::economy::MAX_MOUNT_LEVEL + 1);
            while high - low > 1 {
                let middle = low + (high - low) / 2;
                if loads(middle) >= ceiling {
                    low = middle;
                } else {
                    high = middle;
                }
            }
            strategy.level = low;
        }
        self
    }

    /// Monnayer les montures que le plan ne sait pas employer.
    ///
    /// Le pool de départ donne cent muldos de la gen 2 à la gen 9, et le plan
    /// n'en nomme qu'une fraction. Les autres ne servent à rien **pour la
    /// route** — mais un croisement réussi paie des génétons, et le barème est
    /// quasi exponentiel : `[0, 1, 2, 4, 8, 15, 30, 60, 120, 250, 0]` par
    /// génération, à 538 kamas pièce. Une gen 9 réussie rapporte donc à elle
    /// seule 250 génétons, soit 134 500 kamas — presque le prix d'un chargement.
    ///
    /// ## Une haute génération par couple, pas deux
    ///
    /// C'est le point contre-intuitif. « Les plus gros couples possible »
    /// maximise le rendement **par croisement** et le gaspille **par monture
    /// rare**, parce que le barème est dominé par le plus haut des deux
    /// parents : `9 × 9` rend 500 génétons, `9 × 1` en rend 251. Le partenaire
    /// ne pèse presque rien.
    ///
    /// Or une monture n'a qu'**une** fécondité, et les gen 9 sont ce qu'on a de
    /// plus rare. Par gen 9 dépensée, en comptant la gen 10 obtenue à 50,1 % :
    ///
    /// | | consomme | espérance | par gen 9 |
    /// | --- | --- | --- | --- |
    /// | `9 × 1` | 1 gen 9 + 1 000 k | 318 156 | **318 156** |
    /// | `9 × 9` | 2 gen 9 | 385 274 | 192 637 |
    ///
    /// On étale donc les hautes générations sur le partenaire le moins cher,
    /// quitte à l'acheter neuf à 1 000 kamas.
    ///
    /// ## Ce que la moisson ne touche pas
    ///
    /// Rien de ce que le plan réclame : ni comme sujet, ni comme partenaire.
    /// Une monture dont la couleur est au plan garde sa fécondité pour la route.
    /// Et l'admissibilité reste la même qu'ailleurs — **une cible non vide** —
    /// sauf qu'ici elle n'a pas à être dans le plan. C'est tout l'objet.
    fn harvest(
        &mut self,
        view: &UnitView<'_>,
        groups: &[crate::stable::MateGroup],
        free: &mut [Vec<usize>],
        batch: &mut Building,
    ) {
        let Building {
            crossings,
            purchases,
            budget,
            places,
        } = batch;
        let catalog = view.catalog;
        let starter = view.economy.starter_price;
        let weight = |color: ColorId| geneton_weight(catalog.generation(color));

        // Ce que le plan ne réclame pas : c'est le seul gisement qu'on touche.
        //
        // `wanted` ne suffit pas à le dire. Les gen 1 des blocs n'y figurent
        // pas — on les **achète** au lieu de les produire — mais elles sont la
        // matière première de l'étage 1. Les moissonner reviendrait à brûler la
        // base de l'échelle pour un géneton, et c'est mesuré : sans cette
        // exclusion, le départ de zéro perdait 1,5 M.
        let plan_material = |color: ColorId| {
            self.ladder.wanted.contains(&color)
                || self
                    .ladder
                    .blocks
                    .iter()
                    .any(|block| block.contains(&color))
        };
        let spare: Vec<usize> = (0..groups.len())
            .filter(|&at| !plan_material(groups[at].sample.color))
            .collect();
        if spare.is_empty() {
            return;
        }

        // Les plus hautes d'abord : à places comptées, ce sont elles qui paient.
        let mut order = spare.clone();
        order.sort_by_key(|&at| {
            std::cmp::Reverse((weight(groups[at].sample.color), groups[at].sample.color))
        });

        for subject in order {
            while *places < view.capacity && !free[subject].is_empty() {
                let sex = groups[subject].sex;

                // Le partenaire le moins cher de l'écurie : celui qui pèse le
                // moins de génétons, donc celui dont on se prive le moins.
                let mut best: Option<(i64, usize)> = None;
                for &other in &spare {
                    if other == subject || groups[other].sex == sex || free[other].is_empty() {
                        continue;
                    }
                    let (male, female) = if sex == Sex::Male {
                        (&groups[subject].sample, &groups[other].sample)
                    } else {
                        (&groups[other].sample, &groups[subject].sample)
                    };
                    if !pair_outlook(catalog, male, female)
                        .is_some_and(|outlook| !outlook.target_colors.is_empty())
                    {
                        continue;
                    }
                    let cost = weight(groups[other].sample.color);
                    if best.is_none_or(|(current, _)| cost < current) {
                        best = Some((cost, other));
                    }
                }

                // Une gen 1 neuve pèse 1 géneton et coûte 1 000 kamas. On la
                // prend dès qu'elle est moins chère que ce qu'on a sous la main,
                // et on choisit sa teinte pour tomber sur la gen 10 la mieux
                // payée du jour — le jeu en tire un prix par couleur.
                //
                // Encore faut-il qu'elle se rembourse. Les génétons ne tombent
                // qu'en cas de succès, donc l'achat vaut le coup quand
                // `taux × (G(sujet) + G(1)) × prix ≥ prix de la gen 1`. Sur un
                // sujet de gen 2 ça donne 809 kamas espérés pour 1 000
                // dépensés : on y perd, et sans ce garde-fou la moisson
                // asséchait le budget que l'étage 1 attendait pour acheter.
                let expected = view.economy.success_rate(view.economy.mount_level, false)
                    * (weight(groups[subject].sample.color) + geneton_weight(1)) as f64
                    * view.economy.geneton_value;
                let bought = if *budget >= starter && expected >= starter as f64 {
                    self.best_starter(view, &groups[subject].sample, sex)
                } else {
                    None
                };

                let take_bought = match (&best, &bought) {
                    (None, Some(_)) => true,
                    (Some((cost, _)), Some(_)) => *cost > geneton_weight(1),
                    _ => false,
                };

                if take_bought {
                    let (color, _) = bought.expect("testé juste au-dessus");
                    let index = view.stable.len() + purchases.len();
                    let subject_index = *free[subject].last().expect("non vide");
                    let pair = if sex == Sex::Male {
                        [subject_index, index]
                    } else {
                        [index, subject_index]
                    };
                    // L'achetée doit son cycle par construction ; le sujet, pas
                    // forcément. On mesure avant d'engager quoi que ce soit.
                    let cost = places_for(view.stable, pair);
                    if *places + cost > view.capacity {
                        break;
                    }
                    free[subject].pop();
                    purchases.push((color, sex.other()));
                    crossings.push(pair);
                    *places += cost;
                    *budget -= starter;
                    continue;
                }

                let Some((_, other)) = best else { break };
                let (Some(&subject_index), Some(&other_index)) =
                    (free[subject].last(), free[other].last())
                else {
                    break;
                };
                let pair = if sex == Sex::Male {
                    [subject_index, other_index]
                } else {
                    [other_index, subject_index]
                };
                let cost = places_for(view.stable, pair);
                if *places + cost > view.capacity {
                    break;
                }
                free[subject].pop();
                free[other].pop();
                crossings.push(pair);
                *places += cost;
            }
        }
    }

    /// La gen 1 à acheter pour accompagner une monture : celle qui rend la
    /// cible la mieux payée. `None` si aucune ne nomme quoi que ce soit.
    fn best_starter(
        &self,
        view: &UnitView<'_>,
        subject: &crate::pairing::Mate,
        subject_sex: Sex,
    ) -> Option<(ColorId, i64)> {
        let catalog = view.catalog;
        let mut best: Option<(ColorId, i64)> = None;
        for color in catalog.ids_at_generation(1) {
            let partner = crate::pairing::Mate {
                color,
                level: view.economy.mount_level,
                parents: None,
            };
            let (male, female) = if subject_sex == Sex::Male {
                (subject, &partner)
            } else {
                (&partner, subject)
            };
            let Some(outlook) = pair_outlook(catalog, male, female) else {
                continue;
            };
            let Some(target) = outlook.target_colors.first() else {
                continue;
            };
            let value = view.economy.value_of(catalog, target.color);
            if best
                .is_none_or(|(current, worth)| value > worth || (value == worth && color < current))
            {
                best = Some((color, value));
            }
        }
        best
    }

    /// La couleur qu'un couple vise, s'il est admissible.
    ///
    /// `None` dès qu'il ne nomme rien — recopie, deux fécondités pour rien — ou
    /// qu'une de ses cibles sort du plan. Quand plusieurs couleurs voulues sont
    /// atteignables, on retient **la plus probable** : `target_colors` est
    /// triée par poids décroissant.
    fn aims_at(
        &mut self,
        catalog: &Catalog,
        male: &crate::pairing::Mate,
        female: &crate::pairing::Mate,
    ) -> Option<ColorId> {
        let key = (
            crate::pairing::mate_signature(male),
            crate::pairing::mate_signature(female),
        );
        if let Some(hit) = self.admissible.get(&key) {
            return *hit;
        }
        let answer = pair_outlook(catalog, male, female).and_then(|outlook| {
            let targets = &outlook.target_colors;
            if targets.is_empty()
                || !targets
                    .iter()
                    .all(|t| self.ladder.wanted.contains(&t.color))
            {
                None
            } else {
                Some(targets[0].color)
            }
        });
        self.admissible.insert(key, answer);
        answer
    }
}

impl Policy for LadderPolicy {
    fn name(&self) -> &str {
        "echelle"
    }

    /// Ceux qu'on lui a donnés, sinon ceux du glouton — bande la moins chère,
    /// niveau par défaut, aucune Optimakina. Voir `with_strategies`.
    fn strategy(&self, unit: usize) -> Strategy {
        match self.strategies {
            Some(strategies) => strategies[unit.min(MAX_UNITS - 1)],
            None => Strategy::default(),
        }
    }

    fn plan(&mut self, view: &UnitView<'_>, _rng: &mut Rng) -> UnitPlan {
        if self.ladder.is_empty() {
            return UnitPlan::default();
        }
        let catalog = view.catalog;

        // La couronne dépend des prix du jour, que seule la partie connaît : on
        // la pose à la première fournée, une fois pour toutes.
        if !self.crowned {
            self.ladder.crown(catalog, view.economy);
            self.admissible.clear();
            self.crowned = true;
        }

        // Ce que l'écurie tient déjà de chaque couleur voulue : c'est le
        // dénominateur du ratio, donc ce qui décide quoi fabriquer ensuite.
        let mut held: HashMap<ColorId, f64> = HashMap::new();
        for mount in &view.stable.mounts {
            if self.ladder.wanted.contains(&mount.color) {
                *held.entry(mount.color).or_default() += 1.0;
            }
        }

        let groups = view.stable.fertile_groups();
        let mut free: Vec<Vec<usize>> = groups.iter().map(|g| g.members.clone()).collect();

        // Les couples admissibles, tagués par la couleur qu'ils visent.
        let mut by_target: HashMap<ColorId, Vec<(usize, usize)>> = HashMap::new();
        for (male, group) in groups.iter().enumerate() {
            if group.sex != Sex::Male {
                continue;
            }
            for (female, other) in groups.iter().enumerate() {
                if other.sex != Sex::Female {
                    continue;
                }
                if let Some(color) = self.aims_at(catalog, &group.sample, &other.sample) {
                    by_target.entry(color).or_default().push((male, female));
                }
            }
        }

        // Les couleurs voulues, la plus haute d'abord : une étape haute dont les
        // ingrédients sont en main se fait maintenant, ce qui reste de places
        // prépare l'étage du dessous. L'inverse asphyxie la montée.
        let mut ranks: Vec<u8> = self
            .ladder
            .wanted
            .iter()
            .map(|&c| catalog.generation(c))
            .collect();
        ranks.sort_unstable_by(|a, b| b.cmp(a));
        ranks.dedup();

        let mut crossings: Vec<[usize; 2]> = Vec::new();
        // Places d'enclos consommées. Ce n'est plus le nombre de croisements :
        // un couple dont les deux parents ont déjà cyclé ne coûte rien.
        let mut places = 0usize;
        let mut made: HashMap<ColorId, f64> = HashMap::new();

        for rank in ranks {
            let mut here: Vec<ColorId> = self
                .ladder
                .wanted
                .iter()
                .copied()
                .filter(|&c| catalog.generation(c) == rank)
                .collect();
            here.sort_unstable();

            // Une couleur simple attend d'être lançable en nombre ; une composée
            // se fait au fil de l'eau. C'est la règle du seuil, généralisée.
            let gated = rank % 2 == 1;
            if gated {
                let formable: usize = here
                    .iter()
                    .map(|c| by_target.get(c).map_or(0, |pairs| pairs.len()))
                    .sum();
                if formable < self.threshold {
                    continue;
                }
            }

            // On fabrique en priorité ce dont on est le plus en retard, au
            // regard de la demande propagée : c'est ce qui tient le ratio.
            while places < view.capacity {
                let mut choice: Option<(f64, ColorId, usize)> = None;
                for &color in &here {
                    let want = self.ladder.demand.get(&color).copied().unwrap_or(0.0);
                    if want <= 0.0 {
                        continue;
                    }
                    let Some(pairs) = by_target.get(&color) else {
                        continue;
                    };
                    let position = pairs.iter().position(|&(male, female)| {
                        male != female && !free[male].is_empty() && !free[female].is_empty()
                    });
                    let Some(position) = position else { continue };

                    let stock = held.get(&color).copied().unwrap_or(0.0)
                        + made.get(&color).copied().unwrap_or(0.0);
                    let lag = stock / want;
                    if choice.is_none_or(|(best, _, _)| lag < best) {
                        choice = Some((lag, color, position));
                    }
                }

                let Some((_, color, position)) = choice else {
                    break;
                };
                let (male, female) = by_target[&color][position];
                let Some(male_index) = free[male].pop() else {
                    continue;
                };
                let Some(female_index) = free[female].pop() else {
                    free[male].push(male_index);
                    continue;
                };

                // Les places se comptent après le tirage du couple : leur coût
                // dépend de ce que **ces deux montures-là** doivent encore.
                let cost = places_for(view.stable, [male_index, female_index]);
                if places + cost > view.capacity {
                    free[male].push(male_index);
                    free[female].push(female_index);
                    break;
                }
                places += cost;
                crossings.push([male_index, female_index]);
                *made.entry(color).or_default() += 1.0;
            }
        }

        let mut purchases: Vec<(ColorId, Sex)> = Vec::new();
        let starter = view.economy.starter_price;
        let mut budget = view.kamas - view.economy.batch_cost;

        // La moisson : monnayer ce que le plan ne sait pas employer.
        if self.harvesting {
            let mut batch = Building {
                crossings,
                purchases,
                budget,
                places,
            };
            self.harvest(view, &groups, &mut free, &mut batch);
            crossings = batch.crossings;
            purchases = batch.purchases;
            budget = batch.budget;
            places = batch.places;
        }

        // Les achats : remplir ce qui reste avec des gen 1 anonymes.
        //
        // À 1 000 kamas contre 150 000 le chargement, une place vide coûte plus
        // cher qu'une paire achetée — à condition qu'elle produise une couleur
        // voulue, ce que garantit le choix de deux teintes d'un même bloc.
        // Deux montures neuves : elles doivent toutes deux leur cycle, donc
        // une paire achetée coûte toujours deux places pleines.
        while places + 2 <= view.capacity
            && budget >= 2 * starter
            && !self.ladder.blocks.is_empty()
        {
            let block = &self.ladder.blocks[self.next_starter % self.ladder.blocks.len()];
            self.next_starter += 1;
            if block.len() < 2 {
                continue;
            }
            let male = block[self.next_starter % block.len()];
            let female = block[(self.next_starter + 1) % block.len()];
            if male == female {
                continue;
            }
            let base = view.stable.len() + purchases.len();
            purchases.push((male, Sex::Male));
            purchases.push((female, Sex::Female));
            crossings.push([base, base + 1]);
            places += 2;
            budget -= 2 * starter;
        }

        // Le clonage : uniquement entre montures de même ascendance.
        //
        // Deux stériles entrent, une **au hasard** ressort avec sa couleur, son
        // sexe et sa généalogie. À signature égale le tirage ne décide de rien ;
        // sinon on perd la bonne une fois sur deux. On préfère en plus le même
        // sexe, qui rend celui du clone certain et ne coûte rien.
        let clonings = if self.clone_across_lineages {
            clone_by_generation(view.stable, catalog, self.sex_blind_cloning)
        } else {
            clone_same_lineage(view.stable, catalog, self.sex_blind_cloning)
        };

        // L'ambre : ce qui est né hors plan, et rien d'autre. Une gen 1 ne
        // s'extrait pas et ne rend rien, donc les orphelines se laissent.
        let claimed: HashSet<usize> = crossings
            .iter()
            .flatten()
            .copied()
            .chain(clonings.iter().flatten().copied())
            .collect();
        let sacrifices: Vec<usize> = view
            .stable
            .mounts
            .iter()
            .enumerate()
            .filter(|(index, mount)| {
                !claimed.contains(index)
                    && !self.ladder.wanted.contains(&mount.color)
                    && view.economy.value_of(catalog, mount.color) > 0
                    && catalog.generation(mount.color) <= 2
            })
            .map(|(index, _)| index)
            .collect();

        let needed = if crossings.is_empty() {
            0
        } else {
            view.economy.batch_cost
        } + purchases.len() as i64 * starter;
        let raised: i64 = sacrifices
            .iter()
            .map(|&index| {
                view.economy
                    .value_of(catalog, view.stable.mounts[index].color)
            })
            .sum();
        if view.kamas + raised < needed {
            return UnitPlan {
                clonings,
                sacrifices,
                ..Default::default()
            };
        }

        UnitPlan {
            purchases,
            clonings,
            crossings,
            sacrifices,
            optimakina: Vec::new(),
            // La fécondité mise en banque n'est pas encore exploitée : l'échelle
            // ne sait pas décider qu'une monture vaut mieux gardée qu'employée.
            // C'est le pendant naturel de sa règle d'admissibilité — elle refuse
            // déjà les croisements qui ne rendent rien, il lui reste à savoir
            // que ne rien faire d'une monture est parfois le bon coup.
            cycles: Vec::new(),
        }
    }
}

/// Les clonages à faire : mêmes parents obligatoirement, même sexe de
/// préférence. Ce qui reste dépareillé attend plutôt que de partir à pile ou
/// face.
/// ## Le sexe ne sert pas de critère
///
/// Le clone garde le sexe de la survivante, donc apparier deux stériles de même
/// sexe le rend certain. C'est une garantie tentante, et elle ne vaut rien : en
/// espérance le compte est le même dans les deux cas — `M` mâles et `F` femelles
/// rendent `M/2` et `F/2` clones qu'on les mélange ou non. La certitude ne fait
/// que **reconduire** le déséquilibre au lieu de laisser une chance au sexe rare.
///
/// Trier sur le sexe coûtait en revanche des appariements : deux stériles de
/// même lignée restaient dépareillés parce qu'ils n'étaient pas du même genre.
/// On apparie donc sur la seule chose qui compte, l'ascendance.
/// Les places d'enclos qu'un croisement coûte.
///
/// Depuis que le cycle de fécondité s'est détaché de l'accouplement, ce n'est
/// plus « deux par croisement » : chaque parent paie **une place s'il doit
/// encore son cycle**, et zéro s'il l'a déjà passé. Deux montures déjà cyclées
/// se croisent donc gratuitement, et le nombre de croisements d'un chargement
/// n'est plus borné — seules les places le sont.
///
/// Une monture achetée n'existe pas encore en écurie : elle doit son cycle.
fn places_for(stable: &Stable, pair: [usize; 2]) -> usize {
    pair.iter()
        .filter(|&&index| stable.mounts.get(index).is_none_or(|mount| !mount.cycled))
        .count()
}

/// Le barème des génétons, par génération de la **couleur** du parent.
///
/// Il suit la couleur et non l'ascendance — relevé #59, deux parents gen 2
/// visant la gen 4 rendent 2 + 2 = 4. Une gen 1 qui porte une gen 9 vise donc
/// bien la gen 10, mais elle ne rapporte qu'un géneton : pour la cible on lit
/// l'ascendance, pour la paie on lit la couleur, et ce ne sont pas les mêmes
/// montures.
///
/// La gen 10 rapporte **zéro** : elle est terminale, jamais parent.
#[inline]
fn geneton_weight(generation: u8) -> i64 {
    const BY_GENERATION: [i64; 11] = [0, 1, 2, 4, 8, 15, 30, 60, 120, 250, 0];
    BY_GENERATION[usize::from(generation).min(10)]
}

/// Le clonage, par génération affichée et non par signature.
///
/// C'est ce que le jeu autorise : deux stériles de **même génération affichée**
/// entrent, les deux sont détruites, l'une des deux **au hasard** ressort avec
/// sa couleur, son sexe, son nom et sa généalogie. Exiger la même signature —
/// ce qu'on faisait — rend le tirage sans enjeu mais ne se déclenche presque
/// jamais : c'est pourquoi l'échelle clonait une poignée de fois là où le
/// glouton le fait deux cents.
///
/// ## Ce qui décide la valeur : la génération portée
///
/// Une monture vaut ce qu'il faudrait payer pour la remplacer **dans son
/// rôle**, donc le prix de la génération que son ascendance porte — pas celui
/// de sa couleur. Une gen 1 née d'un croisement gen 9 manqué vaut une gen 9.
///
/// ## Ce qui compte n'est pas qui va avec qui, mais qui reste dépareillée
///
/// Une paire rend la moitié de la somme des deux valeurs, donc le total sur un
/// parc entièrement apparié vaut la moitié de la somme — **quel que soit
/// l'appariement**. Ce qui change le total, c'est qui ne trouve pas de
/// partenaire : une stérile dépareillée ne vaut plus que son extraction. D'où
/// l'ordre retenu, celui de `cloning.ts` : écarter la moins précieuse quand
/// l'effectif est impair, puis apparier la plus haute avec la plus basse.
///
/// Marier une porteuse à une banale ne change pas le total mais **décorrèle
/// les tirages** : deux porteuses appariées ensemble ne peuvent jamais survivre
/// toutes les deux, appariées séparément elles ont une chance sur quatre.
/// L'ancienne règle : n'apparier que des stériles de **même signature**.
///
/// À couleur et ascendance égales, le tirage de la survivante ne décide de
/// rien : on sait ce qui sort. C'est la garantie maximale, et c'est aussi ce
/// qui la rend inopérante — deux stériles de même signature au même moment,
/// c'est rare, et l'échelle ne clonait qu'une poignée de fois par partie là où
/// le glouton le fait deux cents.
///
/// Gardée pour la mesure : c'est le seul moyen de dire ce que le relâchement
/// vers `clone_by_generation` rapporte, et dans quel régime.
fn clone_same_lineage(stable: &Stable, catalog: &Catalog, sex_blind: bool) -> Vec<[usize; 2]> {
    let mut by_lineage: HashMap<(u8, MateSignature), (Vec<usize>, Vec<usize>)> = HashMap::new();
    for (index, mount) in stable.mounts.iter().enumerate() {
        if mount.fertile {
            continue;
        }
        let slot = by_lineage
            .entry((catalog.generation(mount.color), mount.signature()))
            .or_default();
        match mount.sex {
            Sex::Male => slot.0.push(index),
            Sex::Female => slot.1.push(index),
        }
    }

    let mut keys: Vec<_> = by_lineage.keys().copied().collect();
    keys.sort_by_key(|(generation, (color, parents))| (*generation, *color, *parents));

    let mut pairs = Vec::new();
    for key in keys {
        let (mut males, mut females) = by_lineage.remove(&key).expect("clé listée");

        if sex_blind {
            males.append(&mut females);
            males.sort_unstable();
            for pair in males.chunks_exact(2) {
                pairs.push([pair[0], pair[1]]);
            }
            continue;
        }

        // D'abord à sexe égal — le clone garde celui de la survivante, donc il
        // devient certain — puis les deux restes ensemble.
        males.sort_unstable();
        females.sort_unstable();
        let mut orphans = Vec::new();
        for group in [&males, &females] {
            let mut chunks = group.chunks_exact(2);
            for pair in chunks.by_ref() {
                pairs.push([pair[0], pair[1]]);
            }
            orphans.extend_from_slice(chunks.remainder());
        }
        orphans.sort_unstable();
        for pair in orphans.chunks_exact(2) {
            pairs.push([pair[0], pair[1]]);
        }
    }

    pairs
}

fn clone_by_generation(stable: &Stable, catalog: &Catalog, sex_blind: bool) -> Vec<[usize; 2]> {
    let mut by_generation: HashMap<u8, Vec<usize>> = HashMap::new();
    for (index, mount) in stable.mounts.iter().enumerate() {
        if mount.fertile {
            continue;
        }
        by_generation
            .entry(catalog.generation(mount.color))
            .or_default()
            .push(index);
    }

    let mut generations: Vec<u8> = by_generation.keys().copied().collect();
    generations.sort_unstable();

    let mut pairs = Vec::new();
    for generation in generations {
        let mut pool = by_generation.remove(&generation).expect("clé listée");
        // La plus précieuse devant. Départage par indice : deux exécutions
        // doivent rendre la même fournée.
        pool.sort_by_key(|&index| {
            std::cmp::Reverse((stable.mounts[index].carried_generation(catalog), index))
        });

        // Effectif impair : c'est la moins précieuse qui reste sur le carreau.
        // Laisser une porteuse dépareillée la réduirait à son extraction.
        if pool.len() % 2 == 1 {
            pool.pop();
        }

        while pool.len() >= 2 {
            let keep = pool.remove(0);
            // La plus basse restante, et à valeur égale celle du même sexe : le
            // sexe certain ne coûte rien et débloque les fournées. Mesuré à
            // 1,65 M sur 200 graines — voir `sex_blind_cloning`.
            let mut at = pool.len() - 1;
            if !sex_blind {
                let floor = stable.mounts[pool[at]].carried_generation(catalog);
                for candidate in (0..pool.len()).rev() {
                    if stable.mounts[pool[candidate]].carried_generation(catalog) > floor {
                        break;
                    }
                    if stable.mounts[pool[candidate]].sex == stable.mounts[keep].sex {
                        at = candidate;
                        break;
                    }
                }
            }
            let partner = pool.remove(at);
            pairs.push([keep, partner]);
        }
    }

    pairs
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::trees::muldo;

    #[test]
    fn la_gen2_se_choisit_en_deux_blocs_fermes() {
        let catalog = muldo();
        let ladder = Ladder::of(&catalog, Route::Shared);

        let seconds: Vec<ColorId> = ladder
            .wanted
            .iter()
            .copied()
            .filter(|&c| catalog.generation(c) == 2)
            .collect();
        assert_eq!(seconds.len(), 4, "quatre gen 2 suffisent aux deux gen 3");

        let mut sizes: Vec<usize> = ladder.blocks.iter().map(|b| b.len()).collect();
        sizes.sort_unstable();
        assert_eq!(sizes, vec![2, 3], "un triangle et une arête isolée");

        // Fermeture : toute paire interne à un bloc nomme une gen 2 voulue.
        for block in &ladder.blocks {
            for &a in block {
                for &b in block {
                    if a == b {
                        continue;
                    }
                    let named = catalog
                        .names_anywhere(a, b)
                        .expect("deux gen 1 se composent");
                    assert!(
                        ladder.wanted.contains(&named),
                        "{} × {} sort du plan",
                        catalog.name(a),
                        catalog.name(b)
                    );
                }
            }
        }
    }

    #[test]
    fn le_cas_1_partage_un_pivot_et_en_demande_deux_fois_plus() {
        let catalog = muldo();
        let ladder = Ladder::of(&catalog, Route::Shared);

        let fourths: Vec<ColorId> = ladder
            .wanted
            .iter()
            .copied()
            .filter(|&c| catalog.generation(c) == 4)
            .collect();
        assert_eq!(fourths.len(), 3, "trois gen 4, dont une partagée");

        // Le pivot est celle que les deux gen 5 réclament : demande double.
        // On lit le **rapport** et non les valeurs, qui montent d'un facteur
        // deux à chaque barreau ajouté au-dessus.
        let mut demands: Vec<f64> = fourths.iter().map(|&c| ladder.demand[&c]).collect();
        demands.sort_by(|a, b| b.partial_cmp(a).unwrap());
        assert_eq!(demands[0], 2.0 * demands[1], "le pivot vaut le double");
        assert_eq!(demands[1], demands[2], "les deux autres sont à égalité");
    }

    #[test]
    fn le_cas_2_prend_quatre_gen4_disjointes() {
        let catalog = muldo();
        let ladder = Ladder::of(&catalog, Route::Disjoint);

        let fourths: Vec<ColorId> = ladder
            .wanted
            .iter()
            .copied()
            .filter(|&c| catalog.generation(c) == 4)
            .collect();
        assert_eq!(fourths.len(), 4, "quatre gen 4, aucune partagée");
        let first = ladder.demand[&fourths[0]];
        for &color in &fourths {
            assert_eq!(
                ladder.demand[&color],
                first,
                "{} devrait être à égalité : aucune n'est réclamée deux fois",
                catalog.slug(color)
            );
        }
    }

    #[test]
    fn les_deux_routes_visent_les_memes_sommets() {
        let catalog = muldo();
        let shared = Ladder::of(&catalog, Route::Shared);
        let disjoint = Ladder::of(&catalog, Route::Disjoint);
        assert_eq!(shared.summit, disjoint.summit, "Ivoire et Turquoise");
        assert_eq!(shared.summit.len(), 2);
    }

    #[test]
    fn un_couple_qui_ne_nomme_rien_est_refuse() {
        use crate::pairing::Mate;
        let catalog = muldo();
        let mut policy = LadderPolicy::new(&catalog, Route::Shared);
        let id = |slug: &str| catalog.id_of(slug).unwrap_or_else(|| panic!("{slug}"));

        // Une rescapée d'Amande mariée à une gen 1 ordinaire : la cible est
        // forcée en gen 3, aucune couleur ne la nomme, tout retombe en recopie.
        let rescue = Mate {
            color: id("indigo"),
            level: 67,
            parents: Some([id("indigo_pourpre"), id("ebene_orchidee")]),
        };
        let plain = Mate {
            color: id("pourpre"),
            level: 67,
            parents: None,
        };
        assert_eq!(policy.aims_at(&catalog, &rescue, &plain), None);

        // Deux rescapées de la même tentative, en revanche, revisent l'Amande.
        let other = Mate {
            color: id("pourpre"),
            level: 67,
            parents: Some([id("indigo_pourpre"), id("ebene_orchidee")]),
        };
        assert_eq!(
            policy.aims_at(&catalog, &rescue, &other),
            Some(id("amande")),
            "deux rescapées valent une gen 2"
        );

        // Deux Doré-* identiques ne font pas de Roux : la recette exige deux
        // teintes distinctes.
        let twin = Mate {
            color: id("dore_ebene"),
            level: 67,
            parents: Some([id("dore"), id("ebene")]),
        };
        assert_eq!(policy.aims_at(&catalog, &twin, &twin), None);
    }
}

#[cfg(test)]
mod coherence {
    use super::*;
    use crate::trees::muldo;

    /// Le plan doit se tenir tout seul : rien de ce qu'il réclame ne doit être
    /// introuvable.
    ///
    /// Chaque couleur voulue a une recette, et chaque ingrédient de cette
    /// recette est soit voulu lui aussi — donc fabricable — soit une gen 1, qui
    /// s'achète. Un plan qui viole ça demande une couleur que rien ne produit,
    /// et la politique tourne alors à vide sans le dire.
    #[test]
    fn tout_ingredient_est_fabricable_ou_achetable() {
        let catalog = muldo();
        for route in [Route::Shared, Route::Disjoint] {
            let ladder = Ladder::of(&catalog, route);
            assert!(!ladder.is_empty(), "{route:?} n'a rien produit");

            for &color in &ladder.wanted {
                let recipe = ladder
                    .recipe_of
                    .get(&color)
                    .unwrap_or_else(|| panic!("{route:?} : {} sans recette", catalog.slug(color)));
                for ingredient in recipe {
                    let known =
                        ladder.wanted.contains(ingredient) || catalog.generation(*ingredient) == 1;
                    assert!(
                        known,
                        "{route:?} : {} réclame {}, que rien ne produit",
                        catalog.slug(color),
                        catalog.slug(*ingredient)
                    );
                }
                assert!(
                    ladder.demand.get(&color).copied().unwrap_or(0.0) > 0.0,
                    "{route:?} : {} n'est réclamée par personne",
                    catalog.slug(color)
                );
            }
        }
    }

    /// Les gen 1 que le plan achète doivent toutes appartenir à un bloc : c'est
    /// ce qui garantit qu'une paire achetée nomme bien une couleur voulue.
    #[test]
    fn les_gen1_du_plan_sont_toutes_dans_un_bloc() {
        let catalog = muldo();
        for route in [Route::Shared, Route::Disjoint] {
            let ladder = Ladder::of(&catalog, route);
            let in_block: HashSet<ColorId> = ladder.blocks.iter().flatten().copied().collect();
            for &color in &ladder.wanted {
                for ingredient in ladder.recipe_of[&color] {
                    if catalog.generation(ingredient) == 1 {
                        assert!(
                            in_block.contains(&ingredient),
                            "{route:?} : {} est réclamée hors de tout bloc",
                            catalog.slug(ingredient)
                        );
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod duel {
    use super::*;
    use crate::config::Prices;
    use crate::economy::play;
    use crate::trees::muldo;

    /// Cas 1 contre cas 2, **graine par graine**.
    ///
    /// Comparer deux médianes sur un étalement de 15 M ne dit rien : les deux
    /// routes jouent les mêmes tirages, donc la différence appariée a bien
    /// moins de variance que les scores eux-mêmes. C'est elle qu'il faut lire.
    #[test]
    fn cas1_contre_cas2_apparie() {
        let catalog = muldo();
        let economy = Prices::load_default().expect("economy.toml").economy;
        let shared = Ladder::of(&catalog, Route::Shared);
        let disjoint = Ladder::of(&catalog, Route::Disjoint);

        let mut deltas = Vec::new();
        let mut wins = 0;
        for seed in 0..200 {
            let a = play(
                &catalog,
                &economy,
                &mut LadderPolicy::with_ladder(shared.clone()),
                seed,
            );
            let b = play(
                &catalog,
                &economy,
                &mut LadderPolicy::with_ladder(disjoint.clone()),
                seed,
            );
            let delta = (b.score - a.score) as f64;
            if delta > 0.0 {
                wins += 1;
            }
            deltas.push(delta);
        }

        let n = deltas.len() as f64;
        let mean = deltas.iter().sum::<f64>() / n;
        let variance = deltas.iter().map(|d| (d - mean).powi(2)).sum::<f64>() / (n - 1.0);
        let stderr = (variance / n).sqrt();
        println!(
            "cas 2 − cas 1 : {:+.3} M en moyenne, erreur type {:.3} M, t = {:.2}, \
             cas 2 gagne {wins}/200",
            mean / 1e6,
            stderr / 1e6,
            mean / stderr
        );
    }
}

#[cfg(test)]
mod couronne {
    use super::*;
    use crate::config::Prices;
    use crate::economy::{Draws, starting_stable};
    use crate::trees::muldo;

    fn economy(seed: u32) -> crate::economy::Economy {
        let catalog = muldo();
        Prices::load_default()
            .expect("economy.toml")
            .economy
            .for_run(&catalog, &Draws::new(seed))
    }

    /// La couronne vise une gen 10 qui se fait d'une gen 9 et d'une gen 1, et
    /// elle prend la mieux payée du jour.
    #[test]
    fn la_couronne_prend_la_gen10_la_mieux_payee() {
        let catalog = muldo();
        for seed in 0..12 {
            let economy = economy(seed);
            let mut ladder = Ladder::of(&catalog, Route::Shared);
            ladder.crown(&catalog, &economy);

            assert_eq!(ladder.summit.len(), 1, "une seule cible au sommet");
            let crown = ladder.summit[0];
            assert_eq!(catalog.generation(crown), catalog.top_generation());

            let [a, b] = ladder.recipe_of[&crown];
            let mut ranks = [catalog.generation(a), catalog.generation(b)];
            ranks.sort_unstable();
            assert_eq!(
                ranks,
                [1, catalog.top_generation() - 1],
                "une gen 9 et une gen 1"
            );

            // Aucune gen 10 faisable de la même façon ne doit valoir plus.
            let best = catalog
                .ids_at_generation(catalog.top_generation())
                .filter(|&color| {
                    constituents(&catalog, color).is_some_and(|[x, y]| {
                        let mut r = [catalog.generation(x), catalog.generation(y)];
                        r.sort_unstable();
                        r == [1, catalog.top_generation() - 1]
                    })
                })
                .map(|color| economy.value_of(&catalog, color))
                .max()
                .expect("des gen 10 accessibles");
            assert_eq!(economy.value_of(&catalog, crown), best);
        }
    }

    /// Une fois la couronne posée, le plan ne garde que ce qu'elle réclame.
    #[test]
    fn le_plan_couronne_n_a_plus_de_poids_mort() {
        let catalog = muldo();
        let mut ladder = Ladder::of(&catalog, Route::Shared);
        let before = ladder.wanted.len();
        ladder.crown(&catalog, &economy(1));

        for &color in &ladder.wanted {
            assert!(
                ladder.demand.get(&color).copied().unwrap_or(0.0) > 0.0,
                "{} reste au plan sans être réclamée",
                catalog.slug(color)
            );
        }
        assert!(
            ladder.wanted.len() < before + 5,
            "la couronne devrait tailler autant qu'elle ajoute"
        );
    }

    /// Quelle part du pool de départ le plan **nomme**.
    ///
    /// La partie ne commence pas d'une écurie vide : elle donne cent muldos
    /// répartis de la gen 2 à la gen 9. Tant que l'échelle s'arrêtait à la gen 3
    /// elle n'en nommait que 9 % ; la montée jusqu'à la couronne a porté ce
    /// chiffre à 46 %, et c'est l'essentiel du gain mesuré au banc.
    ///
    /// **Nommer n'est pas employer.** Une monture dont la couleur est au plan ne
    /// sert que si son ascendance et son sexe trouvent une partenaire — le banc
    /// dit encore 6,5 gen 10 produites contre 62 pour le glouton, donc le pool
    /// reste très largement sous-exploité. Ce test ne mesure que le plancher :
    /// il tombe si un changement de plan **réduit** la prise sur le pool.
    #[test]
    fn le_plan_nomme_une_bonne_part_du_pool_de_depart() {
        let catalog = muldo();
        let base = Prices::load_default().expect("economy.toml").economy;
        let mut ladder = Ladder::of(&catalog, Route::Shared);
        ladder.crown(&catalog, &economy(0));

        let (mut named, mut total) = (0, 0);
        for seed in 0..20 {
            let stable = starting_stable(&catalog, &base, &Draws::new(seed));
            for mount in &stable.mounts {
                total += 1;
                if ladder.wanted.contains(&mount.color) {
                    named += 1;
                }
            }
        }

        let share = f64::from(named) / f64::from(total);
        assert!(
            share > 0.40,
            "le plan ne nomme plus que {:.0} % du pool — la prise a reculé",
            share * 100.0
        );
    }
}

#[cfg(test)]
mod clonage {
    use super::*;
    use crate::config::Prices;
    use crate::economy::play;
    use crate::trees::muldo;

    /// Regarder le sexe, ou pas — graine par graine.
    ///
    /// Le clone garde le sexe de la survivante. Apparier deux stériles de même
    /// sexe le rend donc certain, au prix de laisser dépareillées les montures
    /// de même lignée mais de genre différent. Les deux effets tirent en sens
    /// contraire et l'arithmétique ne tranche pas : en espérance `M` mâles et
    /// `F` femelles rendent `M/2` et `F/2` clones dans les deux cas.
    #[test]
    fn regarder_le_sexe_ou_pas() {
        let catalog = muldo();
        let economy = Prices::load_default().expect("economy.toml").economy;

        let mut deltas = Vec::new();
        let mut wins = 0;
        for seed in 0..200 {
            let run = |blind: bool| {
                let mut policy = LadderPolicy::new(&catalog, Route::Shared);
                policy.sex_blind_cloning = blind;
                play(&catalog, &economy, &mut policy, seed).score as f64
            };
            let delta = run(true) - run(false);
            if delta > 0.0 {
                wins += 1;
            }
            deltas.push(delta);
        }

        let n = deltas.len() as f64;
        let mean = deltas.iter().sum::<f64>() / n;
        let variance = deltas.iter().map(|d| (d - mean).powi(2)).sum::<f64>() / (n - 1.0);
        let stderr = (variance / n).sqrt();
        println!(
            "aveugle au sexe − trie par sexe : {:+.3} M, erreur type {:.3} M, t = {:.2}, \
             gagne {wins}/200",
            mean / 1e6,
            stderr / 1e6,
            mean / stderr
        );
    }
}

#[cfg(test)]
mod moisson {
    use super::*;
    use crate::config::Prices;
    use crate::economy::play;
    use crate::trees::muldo;

    fn duel(label: &str, economy: &crate::economy::Economy) {
        let catalog = muldo();
        let mut deltas = Vec::new();
        let mut wins = 0;
        for seed in 0..200 {
            let run = |on: bool| {
                let mut policy = LadderPolicy::new(&catalog, Route::Shared);
                policy.harvesting = on;
                play(&catalog, economy, &mut policy, seed).score as f64
            };
            let delta = run(true) - run(false);
            if delta > 0.0 {
                wins += 1;
            }
            deltas.push(delta);
        }
        let n = deltas.len() as f64;
        let mean = deltas.iter().sum::<f64>() / n;
        let variance = deltas.iter().map(|d| (d - mean).powi(2)).sum::<f64>() / (n - 1.0);
        let stderr = (variance / n).sqrt();
        println!(
            "{label:<22} moisson − sans : {:+.3} M ± {:.3}, t = {:>6.2}, gagne {wins}/200",
            mean / 1e6,
            stderr / 1e6,
            mean / stderr
        );
    }

    /// Ce que la moisson apporte, selon qu'on hérite d'un parc ou pas.
    ///
    /// Elle n'a de gisement que si le pool contient des couleurs hors plan :
    /// en partant de cent gen 1, tout est matière de l'étage 1 et il ne reste
    /// rien à moissonner. Le test mesure les deux régimes.
    #[test]
    fn ce_que_la_moisson_rapporte() {
        let base = Prices::load_default().expect("economy.toml").economy;
        duel("pool hérité", &base);
        let mut scratch = base;
        scratch.pool_generations = (1, 1);
        duel("départ de zéro", &scratch);
    }
}

#[cfg(test)]
mod relachement {
    use super::*;
    use crate::config::Prices;
    use crate::economy::play;
    use crate::trees::muldo;

    fn duel(label: &str, economy: &crate::economy::Economy, harvesting: bool) {
        let catalog = muldo();
        let mut deltas = Vec::new();
        let mut wins = 0;
        for seed in 0..200 {
            let run = |across: bool| {
                let mut policy = LadderPolicy::new(&catalog, Route::Shared);
                policy.clone_across_lineages = across;
                policy.harvesting = harvesting;
                play(&catalog, economy, &mut policy, seed).score as f64
            };
            let delta = run(true) - run(false);
            if delta > 0.0 {
                wins += 1;
            }
            deltas.push(delta);
        }
        let n = deltas.len() as f64;
        let mean = deltas.iter().sum::<f64>() / n;
        let variance = deltas.iter().map(|d| (d - mean).powi(2)).sum::<f64>() / (n - 1.0);
        let stderr = (variance / n).sqrt();
        println!(
            "{label:<34} {:+.3} M ± {:.3}, t = {:>6.2}, gagne {wins}/200",
            mean / 1e6,
            stderr / 1e6,
            mean / stderr
        );
    }

    /// Ce que rapporte de cloner entre lignées différentes plutôt qu'à
    /// signature égale — dans les deux régimes, et moisson allumée ou non.
    ///
    /// L'hypothèse à trancher : un clonage détruit une monture (deux stériles
    /// entrent, une féconde sort) pour rendre une fécondité. Avec le pool cette
    /// fécondité alimente la gen 10 et vaut cher ; en partant de zéro rien
    /// n'atteint la gen 10, donc elle pourrait valoir moins que la liquidation
    /// sacrifiée.
    #[test]
    fn cloner_entre_lignees_ou_pas() {
        let base = Prices::load_default().expect("economy.toml").economy;
        let mut scratch = base;
        scratch.pool_generations = (1, 1);

        println!("\nrelâchement du clonage (par génération − par signature) :");
        duel("pool hérité, avec moisson", &base, true);
        duel("pool hérité, sans moisson", &base, false);
        duel("départ de zéro, avec moisson", &scratch, true);
        duel("départ de zéro, sans moisson", &scratch, false);
    }
}

#[cfg(test)]
mod niveaux {
    use super::*;
    use crate::config::Prices;

    /// Le niveau réglé doit être **le dernier gratuit** : une de plus coûte une
    /// fournée, et lui-même n'en coûte aucune.
    #[test]
    fn le_reglage_s_arrete_juste_avant_la_marche() {
        let catalog = muldo_for_test();
        let economy = Prices::load_default().expect("economy.toml").economy;
        let base = [Strategy::default(); MAX_UNITS];
        let policy = LadderPolicy::new(&catalog, Route::Shared)
            .with_strategies(base)
            .tuned_for(&economy);

        let horizon = economy.horizon_hours.unwrap_or(300.0);
        for unit in 0..economy.unit_count().min(MAX_UNITS) {
            let level = policy.strategy(unit).level;
            let loads = |at: u16| {
                let mut probe = policy.strategy(unit);
                probe.level = at;
                (horizon / economy.unit_load(unit, probe).1).floor() as i64
            };
            assert_eq!(
                loads(level),
                loads(1),
                "unité {unit} : le niveau {level} coûte déjà une fournée"
            );
            assert!(
                level >= crate::economy::MAX_MOUNT_LEVEL || loads(level + 1) < loads(1),
                "unité {unit} : le niveau {} serait encore gratuit",
                level + 1
            );
        }
    }

    /// Et il doit dépasser le défaut prêté aux montures : sinon le réglage ne
    /// sert à rien, autant garder `Strategy::default()`.
    #[test]
    fn le_reglage_ne_regresse_pas_sous_le_defaut_du_champion() {
        let catalog = muldo_for_test();
        let economy = Prices::load_default().expect("economy.toml").economy;
        let policy = LadderPolicy::new(&catalog, Route::Shared)
            .with_strategies([Strategy::default(); MAX_UNITS])
            .tuned_for(&economy);
        for unit in 0..economy.unit_count().min(MAX_UNITS) {
            assert!(policy.strategy(unit).level > 1, "unité {unit} non réglée");
        }
    }

    fn muldo_for_test() -> Catalog {
        crate::trees::muldo()
    }
}

#[cfg(test)]
mod diagnostic {
    use super::*;
    use crate::config::Prices;
    use crate::economy::play;
    use crate::trees::muldo;

    #[test]
    fn pourquoi_rien_ne_sort() {
        let catalog = muldo();
        let economy = Prices::load_default().expect("economy.toml").economy;
        let mut policy = LadderPolicy::new(&catalog, Route::Shared);
        let outcome = play(&catalog, &economy, &mut policy, 1);
        println!(
            "croisements {} | refusés {} | chargements {} | score {}",
            outcome.crossings, outcome.rejected_loads, outcome.loads_paid, outcome.score
        );
        println!("plan vide ? {}", policy.ladder().is_empty());
        println!("capacité unité 0 = {}", economy.unit_crossings(0));
    }
}

#[cfg(test)]
mod reglage {
    use super::*;
    use crate::config::Prices;
    use crate::economy::play;
    use crate::trees::muldo;

    /// Ce que le réglage du niveau rapporte, sans rien emprunter au champion.
    #[test]
    fn ce_que_le_reglage_rapporte() {
        let catalog = muldo();
        let base = Prices::load_default().expect("economy.toml").economy;
        let mut scratch = base;
        scratch.pool_generations = (1, 1);

        for (label, economy) in [("pool hérité", &base), ("départ de zéro", &scratch)] {
            let mut deltas = Vec::new();
            let mut wins = 0;
            for seed in 0..200 {
                let run = |tuned: bool| {
                    let mut policy = LadderPolicy::new(&catalog, Route::Shared)
                        .with_strategies([Strategy::default(); MAX_UNITS]);
                    if tuned {
                        policy = policy.tuned_for(economy);
                    }
                    play(&catalog, economy, &mut policy, seed).score as f64
                };
                let delta = run(true) - run(false);
                if delta > 0.0 {
                    wins += 1;
                }
                deltas.push(delta);
            }
            let n = deltas.len() as f64;
            let mean = deltas.iter().sum::<f64>() / n;
            let variance = deltas.iter().map(|d| (d - mean).powi(2)).sum::<f64>() / (n - 1.0);
            let stderr = (variance / n).sqrt();
            println!(
                "réglage du niveau, {label:<16} : {:+.3} M ± {:.3}, t = {:>6.2}, gagne {wins}/200",
                mean / 1e6,
                stderr / 1e6,
                mean / stderr
            );
        }
    }
}
