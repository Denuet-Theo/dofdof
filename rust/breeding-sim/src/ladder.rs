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
//! Avec les fenêtres de disponibilité, il rend 63,60 M contre 64,60 M au meilleur
//! objectif du glouton — et sans proposer un seul croisement sans cible là où le
//! glouton en propose 1,9 %. Il le dépassait (69,20 contre 66,33) tant qu'on le
//! mesurait sur une disponibilité continue ; les fenêtres reprennent l'avance,
//! parce qu'il fait des fournées plus longues et perd donc plus à chaque
//! dépassement de créneau. C'est exactement ce que le réglage de bande doit
//! corriger — voir `bin/windows`.
//!
//! Deux cents graines, médiane du score, contre les politiques du dépôt :
//!
//! | politique | sans cible | gen 10 | pool hérité | départ de zéro |
//! | --- | --- | --- | --- | --- |
//! | glouton | 1,9 % | 64,6 | 60,16 M | 11,80 M |
//! | recherche / myope | 50,3 % | 9,9 | 36,70 M | 10,77 M |
//! | échelle | **0 %** | 40,4 | 59,46 M | 11,15 M |
//! | échelle + niveau réglé | **0 %** | 44,3 | **63,53 M** | **13,19 M** |
//!
//! La colonne « sans cible » est celle qui compte autant que le score : ce sont
//! les accouplements que le jeu annonce « rien à gagner ». L'échelle n'en
//! propose **aucun**, et c'est verrouillé par un test.
//!
//! Ces chiffres portent désormais les **fenêtres de disponibilité** : on n'agit
//! que devant le jeu, 72 h par semaine sur 168. Elles coûtent 6 M à l'échelle
//! réglée. Voir `Economy::availability`, et `bin/windows` pour le balayage — qui
//! au passage montre que le réglage de bande, jamais mesuré au score, vaut
//! bien plus que ça.
//!
//! ## Un avertissement sur les tables de ce fichier
//!
//! Les prix de gen 10 se tirent désormais **en cloche** autour de 600 000 et non
//! uniformément sur `[300 000, 1 000 000]` — voir `Economy::bell_price`. La
//! correction coûte 6 M à l'échelle réglée, et pas seulement parce que la moyenne
//! baisse : `crown` prend le **max de vingt tirages**, et un uniforme le lui
//! offrait bien plus haut qu'un marché réel. Tout ce qui vit des queues de
//! distribution était gonflé, l'échelle au premier rang.
//!
//! Les tables de `Ordering`, `Gating` et `RUNG_THRESHOLD` datent du modèle
//! uniforme : leurs **écarts** restent instructifs, leurs **niveaux** ne sont plus
//! comparables aux chiffres publiés ici.
//!
//! Ces chiffres sont ceux de l'échelle **sans son seuil**. Elle en portait un —
//! dix couples formables avant de lancer un étage impair — et il lui coûtait
//! 3,3 M sur le pool hérité, 1,5 M en partant de zéro. Voir `RUNG_THRESHOLD`
//! pour le balayage qui l'a condamné, et `Ordering` pour les cinq ordres de
//! composition mesurés à cette occasion.
//!
//! Ils sont aussi ceux d'une phase d'achat **informée** : les gen 1 qu'on achète
//! pour remplir le parc se choisissent au même retard relatif que les
//! croisements, et non plus par tourniquet sur les blocs. Voir `Purchasing` — et
//! la prédiction que cette mesure a démentie.
//!
//! ## Ce qu'il fait encore mal
//!
//! Il **sous-emploie le pool de départ**. La partie donne cent muldos répartis
//! de la gen 2 à la gen 9 ; l'échelle en sort 48,8 gen 10 quand le glouton en
//! sort 64,6, parce qu'elle fabrique depuis la gen 1 ce qu'elle a déjà en main.
//! La moisson rattrape une part de l'écart (+18,9 M mesurés) mais ne le comble
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
/// ## Ce que la mesure en dit — et elle a changé de camp deux fois
///
/// Le relevé est **daté par la hauteur de l'échelle**, et c'est l'enseignement à
/// garder : *un barreau se juge sur l'échelle entière*, jamais sur le sommet
/// provisoire.
///
/// | l'échelle monte jusqu'à | ce que 200 graines appariées disaient |
/// | --- | --- |
/// | gen 5 | `Disjoint` gagne `+0,45 M ± 0,035`, t = 12,87, 166 fois sur 200 |
/// | gen 7 (`TOP_RUNG`) | **rien** : `+0,65 M ± 0,55`, t = 1,19, 108 fois sur 200 |
/// | gen 9 (aujourd'hui) | `Disjoint` gagne **+7,15 M** de médiane |
///
/// La dernière ligne est `cargo run --release -p breeding-sim --bin bench`,
/// 200 graines identiques pour toutes les politiques, pool hérité :
///
/// | échelle | p10 | médiane | p90 | gen 10 tenues |
/// | --- | --- | --- | --- | --- |
/// | cas 1 (`Shared`) | 43,44 M | 52,72 M | 63,66 M | 32,3 |
/// | cas 2 (`Disjoint`) | **48,97 M** | **59,87 M** | **71,33 M** | **40,4** |
///
/// Le plafond retiré (#157), l'échelle monte deux étages de plus et la différence
/// entre les routes cesse de se diluer : elle se **cumule**. Le portage
/// TypeScript le dit par un autre chemin — la demande propagée pour une unité de
/// sommet passe de 204 à 252 croisements chez le muldo (+24 %), et
/// `simulatePolicy` sur le Corail-Pourpre paie 1 369 croisements en `Disjoint`
/// contre 2 794 en `Shared`, dix graines sans recouvrement.
///
/// Le mécanisme est lisible : le pivot du cas 1 est `roux_amande`, une gen 4 faite
/// de **deux gen 3**, quand le cas 2 prend des gen 4 faites d'une gen 3 et d'une
/// gen 1 — qui s'achète à mille kamas. Le critère de `lay_rung` compte le travail
/// *local* d'un jeu de gen 4 et donne raison au cas 1 (14 contre 16) ; la demande
/// propagée compte le travail *réel* et le condamne, la gen 4 pivot étant
/// réclamée seize fois.
///
/// À la gen 7 la question ne se pose même pas : Prune et Émeraude ne partagent
/// **aucune** gen 6, donc `Shared` n'y a aucun candidat et se rabat sur
/// `Disjoint`. Les deux routes ne diffèrent que par leur gen 4.
///
/// ## Pourquoi un `Default`, alors que les appels nommaient la route
///
/// Ils la nommaient tous `Shared` ici, et le portage
/// (`src/lib/dofus/breeding/ladder.ts`) prenait `disjoint` faute d'avoir écrit le
/// sien : les deux échelles posaient un plan différent pour le même arbre, sans
/// qu'une ligne ne dise laquelle avait raison. Le défaut est maintenant écrit
/// **une fois, des deux côtés**, et les sites d'appel le lisent au lieu de le
/// redire — sauf `bin/bench` et `bin/barren`, qui comparent les deux et doivent
/// donc les nommer.
///
/// ## Ce que ce changement périme
///
/// Les tables de `Ordering`, `Gating`, `Purchasing`, `Crowning` et
/// `RUNG_THRESHOLD` ont toutes été relevées sous `Shared`. Elles n'ont **pas** été
/// rejouées sous `Disjoint` : leurs écarts restent instructifs, leurs niveaux ne
/// sont plus ceux du défaut.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Route {
    /// **Cas 1** — une gen 4 pivot sert aux deux gen 5, donc on en fabrique
    /// deux fois plus. Trois couleurs de gen 4 au lieu de quatre, et surtout des
    /// ascendances qui se recoupent : la masse d'échec se concentre sur les
    /// couleurs communes et **une seule** recombinaison sort du plan (3,50 %).
    ///
    /// Gardé pour la mesure : c'est le témoin de `bin/bench`, et le plan qu'il
    /// pose est plus **petit** que celui du cas 2 — 25 couleurs contre 30 chez le
    /// muldo. Compter les couleurs est le raisonnement qui trompe ici.
    Shared,
    /// **Cas 2** — quatre gen 4 disjointes, une par côté et par cible. Les
    /// ascendances ne se recoupent pas, donc la masse d'échec s'éparpille sur
    /// quatre couleurs et **quatre** recombinaisons apparaissent, dont trois
    /// hors plan (9,81 %). En contrepartie deux d'entre elles retombent sur une
    /// gen 4 voulue, ce que le cas 1 ne fait pas.
    ///
    /// **Le défaut**, des deux côtés du portage, et c'est la mesure qui l'impose
    /// depuis que l'échelle monte jusqu'à la gen 9.
    #[default]
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
    /// La génération de ce sommet — le rang où l'échelle s'arrête.
    ///
    /// Retenu ici plutôt que relu au besoin, parce que le seul endroit qui en a
    /// besoin, `tuned_for`, n'a pas le catalogue sous la main : il ne voit que la
    /// politique et l'économie. Et c'est bien une propriété de l'échelle — le rang
    /// jusqu'où elle monte — pas une donnée de l'appelant.
    ///
    /// Zéro pour une échelle vide, ce que `Default` donne déjà.
    pub summit_generation: u8,
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
    /// Relève le rang du sommet depuis les couleurs qui le composent.
    ///
    /// Appelé partout où `summit` est arrêté — la fin de la montée et la
    /// couronne — parce qu'un sommet et son rang qui se contrediraient feraient
    /// mal régler le rythme sans rien casser de visible.
    fn note_summit_generation(&mut self, catalog: &Catalog) {
        self.summit_generation = self
            .summit
            .iter()
            .map(|&color| catalog.generation(color))
            .max()
            .unwrap_or(0);
    }

    pub fn of(catalog: &Catalog, route: Route) -> Self {
        let mut ladder = Self::default();
        if !ladder.lay_third(catalog) {
            return Self::default();
        }
        // On monte de deux en deux : les couleurs simples sont aux générations
        // impaires, et c'est elles qui font les barreaux. On part de 5 parce que
        // `lay_third` vient de poser le 3 — et avec lui les gen 2 qui le
        // composent. Les générations paires ne sont jamais des barreaux : elles
        // entrent comme ingrédients de celui du dessus.
        //
        // Le plafond `TOP_RUNG = 7` a été retiré, ici comme dans le portage
        // (`src/lib/dofus/breeding/ladder.ts`). Sa seule justification était
        // « le plus haut barreau que l'échelle sait poser aujourd'hui » — un
        // état des lieux, pas une démonstration. Relevé avant de l'ôter : à 9
        // les invariants tiennent sur les trois familles, et le plan passe de 18
        // à 30 couleurs chez le muldo, de 13 à 18 chez la dragodinde.
        //
        // La montée s'arrête maintenant sur `lay_rung`, qui rend `false` quand un
        // rang n'a **aucune** cible ou aucun jeu candidat. Le corps de ce
        // commit-là disait qu'elle s'arrêtait « là où l'arbre s'arrête » et que le
        // volkorne restait en gen 5 faute de jeu candidat au rang 9 : c'était
        // inexact. Il butait sur un **second** seuil écrit à la main dans
        // `lay_rung` et n'atteignait jamais le rang 9. Voir là-bas.
        let highest = catalog
            .colors()
            .iter()
            .map(|color| color.generation)
            .max()
            .unwrap_or(0);
        let mut rung = 5;
        while rung <= highest {
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
        ladder.note_summit_generation(catalog);
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
    ///
    /// ## Le seuil « au moins deux cibles » a été retiré
    ///
    /// Il n'avait aucun commentaire, et il était incompatible avec `lay_third`,
    /// qui se contente d'une seule cible. Ce qu'il croyait dire est vrai mais se
    /// dit déjà ailleurs : à une seule cible, un seul couple d'ingrédients est
    /// retenu, donc `Shared` — qui réclame un pivot partagé — n'a aucun candidat
    /// et `Disjoint` est trivialement satisfait. Cette moitié-là est portée par la
    /// contrainte de route et par le repli de l'appelant sur l'autre route.
    ///
    /// Ce que le seuil ajoutait, en revanche, était faux : il **arrêtait la
    /// montée** là où la route était seulement indéterminée. Le volkorne n'a
    /// qu'une gen 7, Doré, dont les huit recettes emploient toutes deux gen 6
    /// distinctes ; le seuil refusait son rang 7, et le rang 9 n'était donc jamais
    /// tenté — ce qu'on a écrit à tort comme une propriété de l'arbre. Mesuré en
    /// le retirant, sur le portage qui sert de banc aux trois familles : le plan
    /// du volkorne passe de 16 à 28 couleurs, sommet gen 5 → gen 9, travail par
    /// sommet 24 → 228, et son plan **couronné** se referme, ce qu'il ne faisait
    /// pas. La dragodinde et le muldo ne bougent pas : leurs rangs impairs ont
    /// tous deux cibles.
    fn lay_rung(&mut self, catalog: &Catalog, generation: u8, route: Route) -> bool {
        let targets: Vec<ColorId> = catalog.ids_at_generation(generation).collect();
        // Aucune cible : le rang n'existe pas, la montée s'arrête. Une seule
        // suffit — voir ci-dessus pour ce que le seuil précédent coûtait.
        if targets.is_empty() {
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
        self.crown_at(catalog, economy, None);
    }

    /// Les gen 10 que la couronne peut viser : une gen 9 et une gen 1 achetable.
    ///
    /// Publiée pour que la mesure puisse les énumérer — c'est le jeu de choix
    /// dont `crown` ne retient que le mieux payé, et savoir ce que les autres
    /// auraient valu est la seule façon de dire si ce choix a de la marge.
    pub fn crown_candidates(
        catalog: &Catalog,
        blocks: &[Vec<ColorId>],
    ) -> Vec<ColorId> {
        let top = catalog.top_generation();
        let ninth = top - 1;
        let mut found: Vec<ColorId> = Vec::new();
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
            if !blocks.iter().any(|block| block.contains(&low)) {
                continue;
            }
            found.push(color);
        }
        found.sort_unstable();
        found
    }

    /// La gen 10 à viser quand on choisit le **partenaire** avant le prix.
    ///
    /// Le partenaire retenu est la gen 1 que le plan emploie le plus, mesuré sur le
    /// plan **avant** couronnement — c'est le seul état disponible au moment du
    /// choix, et il est le même pour toutes les candidates, donc il ne favorise
    /// aucune. Parmi les candidates qui le portent, on prend la mieux payée.
    ///
    /// Voir `Crowning` pour ce que ça vaut et pour ce qui reste inexpliqué.
    pub fn best_partner_crown(
        &self,
        catalog: &Catalog,
        economy: &crate::economy::Economy,
    ) -> Option<ColorId> {
        let candidates = Self::crown_candidates(catalog, &self.blocks);
        if candidates.is_empty() {
            return None;
        }

        // La gen 1 partenaire de chaque candidate.
        let partner_of = |color: ColorId| -> Option<ColorId> {
            let [a, b] = constituents(catalog, color)?;
            Some(if catalog.generation(a) > catalog.generation(b) { b } else { a })
        };

        // Combien de recettes du plan emploient chaque gen 1. Le maximum décide, et
        // l'identifiant tranche les égalités pour rester déterministe.
        let uses = |partner: ColorId| -> usize {
            self.recipe_of
                .values()
                .filter(|recipe| recipe.contains(&partner))
                .count()
        };

        let best_partner = candidates
            .iter()
            .filter_map(|&color| partner_of(color))
            .max_by_key(|&partner| (uses(partner), std::cmp::Reverse(partner)))?;

        // Parmi celles qui portent ce partenaire, la mieux payée du jour.
        candidates
            .iter()
            .copied()
            .filter(|&color| partner_of(color) == Some(best_partner))
            .max_by_key(|&color| (economy.value_of(catalog, color), std::cmp::Reverse(color)))
    }

    /// La couronne, avec la possibilité de l'**imposer**.
    ///
    /// `choice` sert la mesure : forcer chaque gen 10 candidate à tour de rôle et
    /// garder la meilleure après coup donne le **plafond** de ce qu'une
    /// réorientation pourrait rapporter. Inutile de construire le mécanisme si ce
    /// plafond est nul.
    pub fn crown_at(
        &mut self,
        catalog: &Catalog,
        economy: &crate::economy::Economy,
        choice: Option<ColorId>,
    ) {
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

        // Imposée si on le demande, sinon la mieux payée. Une couronne imposée
        // introuvable est une erreur d'appelant, pas un cas à rattraper en
        // silence : on ne pose rien plutôt que de retomber sur un autre choix.
        let picked = match choice {
            Some(wanted) => candidates.iter().find(|c| c.1 == wanted).copied(),
            None => candidates.first().copied(),
        };
        let Some((_, crown, target, partner)) = picked else {
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
        self.note_summit_generation(catalog);

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

    /// Le travail que le plan réclame pour **une** unité de son sommet.
    ///
    /// Somme des demandes propagées : chaque unité d'une couleur voulue se produit
    /// par un croisement, donc `demand` compte déjà les croisements, multiplicités
    /// comprises. Le taux de réussite n'y figure pas — il est le même partout, donc
    /// il multiplie tout par la même constante et ne change aucun classement. Les
    /// gen 1 non plus : elles s'achètent.
    ///
    /// ## Ce qu'il n'explique pas
    ///
    /// Il ne prend que **trois valeurs**, une par gen 9, alors que les scores des
    /// vingt couronnes s'étalent sur quinze millions. Le doré (67) et l'ébène (67)
    /// demandent le même travail et sont aux deux bouts du classement. Gardé parce
    /// que c'est la mesure qui a permis de l'écarter, et qu'un lecteur tenté par la
    /// même idée doit trouver la réfutation avant de la refaire. Voir `Crowning`.
    pub fn work_per_summit(&self) -> f64 {
        self.demand.values().sum()
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
/// forfait qu'une qui en lance dix.
///
/// ## Le raisonnement est faux, et il coûte cher
///
/// Le chiffre venait du dicté. Balayé — `cargo run -p breeding-sim --bin
/// orders` — il est monotone décroissant, sur 200 graines appariées contre
/// « aucun seuil », pool hérité et niveau réglé :
///
/// | seuil | médiane | écart | t |
/// | --- | --- | --- | --- |
/// | **0** | **70,80 M** | témoin | |
/// | 2 | 69,51 M | −0,25 M | −0,43 |
/// | 6 | 68,76 M | −0,71 M | −0,98 |
/// | 10 | 67,51 M | −2,74 M | −3,82 |
/// | 20 | 58,71 M | −10,92 M | −13,22 |
/// | 30 | 53,24 M | −16,49 M | −21,47 |
///
/// Aucun cran ne bat zéro, et à partir de 8 l'écart sort du bruit. La prémisse
/// omettait le coût de l'attente : le forfait est bien le même, mais **l'horizon
/// est en heures**, donc une fournée ajournée n'est pas reportée, elle est
/// perdue. Ce qu'un seuil économise en frais fixes, il le paie en tours.
///
/// C'est pourquoi `Gating::Off` est désormais le défaut. La constante reste —
/// elle est ce qui rend la table ci-dessus rejouable, et elle n'a d'effet que si
/// on redemande explicitement `OddOnly` ou `Everywhere`.
pub const RUNG_THRESHOLD: usize = 10;

/// Dans quel ordre les croisements entrent dans la fournée.
///
/// C'est la dernière inconnue de l'échelle, et elle n'est pas cosmétique : les
/// places d'enclos sont le facteur rare, donc **le premier servi mange le
/// budget du dernier**. Cinq ordres se défendent, et rien dans l'arbre ne dit
/// lequel gagne — d'où le levier, et la mesure.
///
/// Ce que l'ordre ne touche pas : la règle d'admissibilité, le choix du retard
/// relatif à l'intérieur d'un étage, la moisson, les achats, le clonage. Un
/// seul bouton, sinon la comparaison ne dit rien.
///
/// ## Ce que la mesure en dit
///
/// `cargo run --release -p breeding-sim --bin orders`, 200 graines appariées,
/// écart à l'ancien défaut (`TopDown` + `Gating::OddOnly`), niveau réglé :
///
/// | ordre | pool hérité | départ de zéro |
/// | --- | --- | --- |
/// | `TopDown` + `Off` — **le défaut** | **+2,74 M** (t = 3,8) | **+1,30 M** (t = 11,9) |
/// | `RoundRobin` + `Off` | −2,69 M (t = −3,9) | +0,79 M (t = 7,7) |
/// | `BigToSmall` + `Off` | −4,22 M (t = −5,5) | −1,04 M (t = −16,6) |
/// | `BigToSmallByRank` + `Off` | −6,90 M (t = −8,4) | −0,64 M (t = −9,6) |
/// | `BottomUp` + `Everywhere` | −23,08 M (t = −31,0) | −1,96 M (t = −29,3) |
///
/// Seul `TopDown` + `Off` gagne dans les deux régimes — d'où le défaut. Deux
/// enseignements, et le second n'était pas attendu.
///
/// **La direction pèse dix fois le seuil.** Monter du bas perd 23 M, et ce n'est
/// pas son seuil qui le condamne : `BottomUp` + `Off` rend encore 47,03 M contre
/// 70,80 M à `TopDown` + `Off`. La raison est le pool — cent muldos de la gen 2 à
/// la gen 9 fournissent déjà les basses générations, donc les places dépensées à
/// les refabriquer sont des places volées à la seule chose qui manque.
///
/// **Servir d'abord ce qui est abondant est un piège.** `BigToSmall` semble
/// appliquer la logique du seuil sans l'attendre ; en pratique l'abondance est
/// une propriété des étages *bas* — ils ont plus de sujets — donc classer par
/// nombre de couples est une façon détournée de monter du bas.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Ordering {
    /// La plus haute génération d'abord, **vidée** jusqu'à la dernière place,
    /// puis celle du dessous.
    ///
    /// L'argument : une étape haute dont les ingrédients sont en main se fait
    /// maintenant, parce que ces ingrédients-là ont coûté dix fournées à
    /// produire et qu'une place dépensée en gen 2 est remplaçable. Ce qui reste
    /// prépare l'étage du dessous.
    #[default]
    TopDown,
    /// La plus basse d'abord, vidée, puis celle du dessus.
    ///
    /// L'argument inverse : l'échelle **sous-emploie sa base**, et un étage haut
    /// servi en premier consomme les places qui auraient fabriqué ses propres
    /// ingrédients pour la fournée suivante. Nourrir le bas, c'est nourrir le
    /// haut avec un tour de retard.
    BottomUp,
    /// Descendante, mais **un seul croisement par étage et par tour**, et on
    /// recommence tant qu'il reste des places.
    ///
    /// Ce n'est pas un autre ordre, c'est un autre **partage** : le haut ne peut
    /// plus rafler toutes les places avant que le bas soit servi une fois.
    RoundRobin,
    /// Par nombre de couples formables décroissant, **couleur par couleur**.
    ///
    /// L'argument : le seuil dit qu'une fournée qui ne lance que deux
    /// croisements paie le même forfait qu'une qui en lance dix. Servir d'abord
    /// ce qui est abondant, c'est appliquer cette logique sans attendre un
    /// seuil — et laisser les couleurs rares à la fournée où elles seront
    /// nombreuses.
    BigToSmall,
    /// Idem, mais l'unité classée est la **génération** et non la couleur : on
    /// somme les couples de l'étage avant de trancher.
    ///
    /// La distinction compte parce qu'un étage à deux couleurs moyennement
    /// fournies passe devant une couleur seule très fournie, ce que
    /// `BigToSmall` fait l'inverse.
    BigToSmallByRank,
}

/// Comment les gen 1 achetées se choisissent.
///
/// Ce n'est pas un détail d'appoint : à 1 000 kamas la monture contre 150 000 le
/// chargement, une place vide coûte plus cher qu'une paire achetée, donc
/// l'échelle **remplit systématiquement** le parc avec des achats. C'est ce
/// levier qui décide de ce que l'étage 1 fournira deux fournées plus tard.
///
/// Et jusqu'ici les deux moitiés d'une même fournée ne raisonnaient pas pareil :
/// `compose` choisissait au retard relatif, l'achat tournait en rond.
/// Comment le rythme se règle : le niveau seul, ou la bande avec.
///
/// ## Ce que la bande vaut, et ce qu'elle coûte
///
/// `tuned_for` ne réglait que le **niveau**, laissant la bande la moins chère.
/// C'était un gel méthodologique jamais levé, et `bin/windows` le chiffre : sur
/// le pool hérité, chercher la bande **et** le niveau porte la médiane de
/// 63,60 M à **92,32 M**, avec 89,1 gen 10 tenues contre 43,1.
///
/// Le départ de zéro **s'effondrait**, et c'est ce qui a tenu ce gain derrière un
/// levier. Duel sur 200 graines appariées, avec `value_per_success` en constante :
///
/// | régime | avant | après | gen 10 | refusées |
/// | --- | --- | --- | --- | --- |
/// | pool hérité | 63,84 M | **98,34 M** | 44,1 → **95,2** | 191 |
/// | départ de zéro | 13,80 M | **5,49 M** | 0,2 → 0,2 | **551** |
///
/// Les **fournées refusées** sont la vérification qui a tranché : ce sont des
/// plans que le moteur écarte faute de kamas, donc des tours perdus.
///
/// ## Ce qui a levé l'obstacle
///
/// Le critère est `fournées × (valeur − carburant)`, et la valeur y était une
/// constante calibrée sur le régime **avec pool**, où cent muldos de la gen 2 à
/// la gen 9 mettent le sommet à un barreau. En partant de cent gen 1, le sommet
/// est à neuf générations : rien ne l'atteint dans l'horizon, donc une fournée n'y
/// vaut presque rien, et payer 520 000 de carburant ruine la partie.
///
/// Une valeur par fournée qui ignore la **distance au sommet** ne peut pas régler
/// les deux régimes. `Economy::value_per_success_toward` la dérive : l'ancre
/// mesurée reste l'ancre à un barreau du sommet, et s'amortit sur le chemin qui
/// reste. Le même duel devient alors :
///
/// | régime | avant | après | gen 10 | refusées |
/// | --- | --- | --- | --- | --- |
/// | pool hérité | 63,84 M | **98,34 M** | 44,1 → **95,2** | 191 |
/// | départ de zéro | 13,80 M | **15,05 M** | 0,2 → **0,6** | **0** |
///
/// Le pool hérité est **inchangé au chiffre près**, par construction : sa
/// frontière est la gen 9, donc son chemin vaut un et la valeur reste l'ancre. Et
/// le départ de zéro ne s'effondre plus, il **gagne** — et ses 551 fournées
/// refusées tombent à zéro, ce qui dit que le refus venait bien de la
/// mésestimation et non d'une limite du moteur.
///
/// ## Les refus, expliqués puis résorbés
///
/// Restaient **191 fournées refusées** sur le pool hérité, que la dérivation ne
/// pouvait pas déplacer — la valeur y est inchangée. Elles ne s'expliquaient donc
/// pas par la distance au sommet, et un chiffre obtenu *malgré* un gaspillage
/// inexpliqué ne vaut pas qu'on bascule un défaut dessus.
///
/// La raison, une fois comptée plutôt que supposée : **191 sur 191 par manque de
/// kamas**, dont 99,7 % de carburant. Le plan tenait ; c'est le rythme commandé
/// qui dépassait la bourse de ce tour-là. Charger un cran moins vite au lieu de
/// ne pas charger les ramène à **27**, et ces 27 ne peuvent payer même la
/// bande 0 — voir `lower_band`.
///
/// ## Pourquoi le défaut bascule
///
/// | régime | `LastFreeStep` | `BandAndLevel` | gen 10 | refusées |
/// | --- | --- | --- | --- | --- |
/// | pool hérité | 63,84 M | **99,30 M** | 44,1 → **95,9** | 27 |
/// | départ de zéro | 13,80 M | **15,05 M** | 0,2 → **0,6** | 0 |
///
/// Les deux régimes gagnent, il n'y en a plus un à sacrifier, et les refus qui
/// restent sont de vrais « pas les moyens ».
///
/// Une réserve, consignée parce qu'elle est réelle et qu'elle ne mord pas : le
/// moteur prend le débit d'une bande pour une constante, ce qui n'est exact que
/// jusqu'à la **bande 2**. Au-delà, le carburant plafonne à 100 000 quand le
/// palier de 4 pt/s tombe à 90 000, donc dix mille points de marge pour une stat
/// qui en consomme vingt mille — la bande 3 décroche en cours de tâche et
/// demanderait un réappro manuel. Or le réglage choisit **la bande 2 sur les deux
/// unités**, et la bande 3 plafonne à 35,69 M contre 98,40 M. La modéliser
/// fidèlement la rendrait plus lente, donc l'éloignerait encore.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Tuning {
    /// Le niveau seul, bande laissée telle quelle : le dernier cran gratuit.
    ///
    /// Ce fut le défaut, et c'est maintenant l'échappatoire — pour retrouver une
    /// mesure d'avant la bascule, ou pour isoler ce que la bande apporte.
    LastFreeStep,
    /// La bande **et** le niveau, au meilleur `fournées × (valeur − carburant)`.
    #[default]
    BandAndLevel,
}

/// Comment la couronne se choisit parmi les vingt gen 10 candidates.
///
/// Les candidates sont 4 gen 9 × 5 gen 1 partenaires. `crown` ne regardait que le
/// **prix**, et le relevé de `bin/crown` dit que c'est le partenaire qui décide :
/// à prix aplatis, le doré gagne dans les **quatre** groupes de gen 9, de dix
/// millions.
///
/// | partenaire | ambre | corail | azur | aigue-marine |
/// | --- | --- | --- | --- | --- |
/// | **doré** | **68,9** | **65,7** | **66,1** | **66,4** |
/// | indigo | 58,8 | 54,7 | 57,1 | 57,0 |
/// | pourpre | 54,9 | 51,8 | 53,8 | 53,9 |
/// | orchidée | 54,2 | 51,7 | 53,2 | 53,3 |
/// | ébène | 53,9 | 52,6 | 53,1 | 53,6 |
///
/// ## Un fait sans mécanisme
///
/// Deux explications ont été essayées et **réfutées**, ce qui vaut d'être écrit
/// pour ne pas les réessayer :
///
/// - le **travail de l'arbre** (`Ladder::work_per_summit`) ne prend que trois
///   valeurs, une par gen 9. Doré et ébène en demandent autant — 67 — et sont à
///   quinze millions d'écart ;
/// - l'**emploi du partenaire** dans les recettes du plan classe doré 4, ébène 3,
///   pourpre 3, indigo 2, orchidée 1. Ça explique la victoire du doré et rate le
///   reste : l'ébène est deuxième en emploi et dernier en score.
///
/// Le critère est donc **ajusté sur une observation** et non dérivé d'un mécanisme.
/// C'est la mesure qui le justifie, rien d'autre. L'explication est probablement
/// dans ce que deviennent les **ratés** du dernier croisement — une gen 9 × gen 1
/// échoue une fois sur deux et rend une monture basse portant l'ascendance gen 9 —
/// mais elle reste à établir.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Crowning {
    /// La gen 10 la mieux payée du jour, sans regarder son partenaire. Gardé pour
    /// la mesure.
    PriceOnly,
    /// D'abord le partenaire le plus employé par le plan, puis le mieux payé parmi
    /// les candidates qui le portent. **Le défaut.**
    ///
    /// 1 000 graines appariées, écart au prix seul :
    ///
    /// | régime | écart | t | décidées | gen 10 |
    /// | --- | --- | --- | --- | --- |
    /// | pool hérité, niveau réglé | **+3,12 M ± 0,31** | 10,05 | 505/776 | 42,4 → **48,9** |
    /// | pool hérité, niveau défaut | **+2,98 M ± 0,28** | 10,67 | 507/776 | 38,2 → 43,9 |
    /// | départ de zéro, niveau réglé | +0,02 M ± 0,04 | 0,37 | 346/671 | 0,6 → 0,7 |
    ///
    /// Les **nulles** comptent : 224 graines sur mille voient le prix tomber déjà
    /// sur le bon partenaire, et les deux critères y jouent la même partie. Les
    /// confondre avec des défaites ferait lire « gagne la moitié du temps » là où le
    /// critère gagne 65 % des parties où il change quelque chose.
    ///
    /// Le gain porte surtout sur les **gen 10 tenues** : +6,5 en moyenne. C'est ce
    /// qu'on attend d'un choix de route plus facile à monter, et c'est ce qui
    /// distingue ce levier des précédents — il ne grappille pas des kamas, il fait
    /// arriver plus de montures au sommet.
    ///
    /// Neutre en partant de zéro, où rien n'atteint la gen 10 dans l'horizon : le
    /// choix du sommet n'y décide de rien.
    #[default]
    PartnerThenPrice,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Purchasing {
    /// Un bloc après l'autre, indéfiniment. Ne regarde ni la demande, ni ce que
    /// l'écurie tient, ni ce que la fournée vient de lancer. Gardé pour la mesure.
    RoundRobin,
    /// La paire qui produit la gen 2 dont on est le plus en retard — le même
    /// critère que `most_behind`, appliqué à ce qu'on achète. **Le défaut.**
    ///
    /// ## Ce que ça vaut, et la prédiction que ça démentit
    ///
    /// 1 000 graines appariées, écart au tourniquet :
    ///
    /// | régime | écart | t | gagne |
    /// | --- | --- | --- | --- |
    /// | pool hérité, niveau réglé | **+1,13 M ± 0,28** | 4,07 | 540/1000 |
    /// | départ de zéro, niveau réglé | −0,09 M ± 0,04 | −2,01 | 450/1000 |
    /// | départ de zéro, niveau défaut | −0,05 M ± 0,02 | −2,66 | 448/1000 |
    ///
    /// La prédiction écrite avant la mesure était l'**inverse** : un gain en
    /// partant de zéro, où tout vient des achats, et rien avec le pool hérité, où
    /// les basses générations sont déjà fournies. C'est faux, et l'erreur est
    /// instructive — en partant de zéro, *tous* les blocs sont également en retard
    /// à la première fournée, donc le tourniquet tombe juste par accident et il
    /// n'y a rien à gagner. Avec un pool, l'héritage est **déséquilibré** : c'est
    /// là que choisir ce qui manque a un sens, et c'est là que le tourniquet se
    /// trompe.
    ///
    /// Le levier reste donc **dépendant du régime**, et il perd 0,05 M sur le
    /// départ de zéro à niveau non réglé — 0,4 % d'un score de 13 M, contre
    /// 1,6 % gagnés dans le régime réaliste. C'est ce rapport de vingt contre un
    /// qui décide, pas l'absence de contre-partie.
    ///
    /// ## Ce que la mesure a coûté à établir
    ///
    /// À 200 graines, une seule des quatre configurations passait t = 2,26 — soit
    /// exactement ce que le hasard produit à quatre comparaisons. Il a fallu
    /// cinq fois plus de graines pour voir t monter à 3,80 plutôt que dériver vers
    /// zéro. Un `t` juste au-dessus de deux, sur plusieurs configurations
    /// essayées, ne conclut rien.
    #[default]
    MostBehind,
}

/// Quels étages attendent d'être lançables en nombre avant de partir.
///
/// Le seuil et l'ordre se confondent facilement — les deux décident qui passe
/// en premier — mais ils ne font pas la même chose : l'ordre **classe**, le
/// seuil **ajourne**. Séparés pour qu'on puisse dire lequel des deux porte
/// l'écart, et la réponse est nette : `Off` gagne pour **les cinq** ordres.
/// Médianes, pool hérité, niveau réglé :
///
/// | ordre | `OddOnly` | `Everywhere` | `Off` |
/// | --- | --- | --- | --- |
/// | `TopDown` | 67,51 M | 60,91 M | **70,80 M** |
/// | `RoundRobin` | 61,74 M | 53,49 M | **63,73 M** |
/// | `BigToSmall` | 56,01 M | 46,69 M | **64,22 M** |
/// | `BigToSmallByRank` | 54,24 M | 49,49 M | **60,35 M** |
/// | `BottomUp` | 45,24 M | 43,28 M | **47,03 M** |
///
/// Voir `RUNG_THRESHOLD` pour le balayage cran par cran et pourquoi la prémisse
/// du seuil était fausse.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Gating {
    /// Les générations impaires seulement — les couleurs **simples**, celles qui
    /// font les barreaux. C'était la règle, jusqu'à ce qu'on la mesure.
    OddOnly,
    /// Tous les étages, composées comprises.
    Everywhere,
    /// Aucune retenue : ce qui est formable part. **Le défaut**, parce qu'il
    /// gagne partout.
    #[default]
    Off,
}

/// Ce qu'un couple engagé a donné. `Retry` ne devrait pas se produire — la
/// position est choisie sur des groupes non vides — mais le garder évite de
/// faire dépendre la correction d'un raisonnement.
enum Launched {
    Yes,
    Retry,
    Full,
}

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

/// Ce qu'on fait d'une gen 10 une fois qu'on l'a.
///
/// La question ne se posait pas : tant que la cible dépassait le plafond, le
/// couple était refusé et une gen 10 n'avait plus qu'à attendre la liquidation.
/// Le plafond (issue #185) la rouvre, et l'arithmétique dit qu'elle vaut plus
/// que ce qu'on croyait — c'est le seul endroit de l'arbre où une **réussite
/// rend la génération qu'on vient de dépenser** au lieu de la suivante.
/// ## Elle ne vaut rien sans le cloneur retenu, et réciproquement
///
/// C'est la mesure qui l'a dit, pas le raisonnement. 200 graines appariées,
/// contre l'échelle d'aujourd'hui :
///
/// | variante | score | gen 10 tenues |
/// | --- | --- | --- |
/// | dupliquer seul | **−8,38 M** (22/200) | −4,38 |
/// | ne plus refondre le sommet, seul | 0,00 M | 0,00 |
/// | **les deux** | **+43,18 M** (200/200) | **+63,43** |
///
/// Dupliquer seul **perd**, parce que la boucle fabrique des stériles gen 10 et
/// que le cloneur les refond aussitôt deux en une — il mange sa production. Ne
/// plus refondre, seul, ne vaut exactement rien : sans la boucle une gen 10 ne
/// s'accouple jamais, donc elle ne devient jamais stérile et le cloneur ne la
/// voit pas. Voir `clonable`.
/// ## Pourquoi le défaut reste `Hold`
///
/// Ce n'est pas la simulation qui l'a décidé — elle dit l'inverse, et fort. C'est
/// le **marché**, que la simulation ne modélise pas : elle valorise une gen 10
/// stérile à son prix d'HDV plein, quel que soit le nombre qu'on en tienne. La
/// boucle finit la partie avec **162 gen 10**, et le mainteneur, qui joue le jeu,
/// dit que l'HDV n'en absorbe pas autant.
///
/// Le score de `Duplicate` est donc juste **selon le modèle** et faux dans le
/// jeu, à hauteur de ce que 162 gen 10 ne valent pas. On garde la boucle
/// mesurée, écrite et prête ; on ne l'allume pas. Elle le redeviendra le jour où
/// l'économie saura dire à quel prix le centième exemplaire se vend.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Summit {
    /// Rien. La fécondité d'une gen 10 se garde, faute de savoir quoi en faire.
    #[default]
    Hold,
    /// La boucle décrite par Olxinos-etenn#1917 sur le forum officiel, et
    /// vérifiée ici sur `mating_outcomes`.
    ///
    /// Accoupler une gen 10 avec une gen 1, réaccoupler le raté — il porte la
    /// gen 10 dans son ascendance, donc il revise la gen 10 — et cloner les
    /// stériles deux par deux. Par gen 10 féconde consommée, à niveau 67 :
    ///
    /// | terme | valeur |
    /// | --- | --- |
    /// | réussite directe | 0,501 |
    /// | la chaîne des ratés, `Σ (1−t)ⁿ t` | +0,499 |
    /// | clonage de la stérile | +0,5 |
    ///
    /// La chaîne seule somme à `t / (1 − (1 − t)) = 1` : les accouplements
    /// rendent exactement ce qu'ils consomment, et c'est le clonage qui fait
    /// basculer au-dessus de 1. L'issue annonce 1,16 à niveau 39 ; le simulateur
    /// joue au niveau 67, où le même calcul donne 1,5.
    ///
    /// ## Le partenaire décide de **quelle** gen 10 sort
    ///
    /// Ça, l'issue ne le dit pas, et c'est ce que le plafond rend visible. La
    /// masse cible vaut le taux quel que soit le partenaire — mais son
    /// **partage** dépend de lui. Sur une Ambre-Doré [Ambre, Doré] :
    ///
    /// | partenaire | part qui reproduit la mère |
    /// | --- | --- |
    /// | Doré — sa propre gen 1 | **100 %** |
    /// | Ébène | 62,5 % |
    ///
    /// Avec Ébène, `Ambre × Ébène` nomme Ambre-Ébène et se partage la cible.
    /// Avec Doré, aucune recombinaison ne concurrence la mère. Dupliquer une
    /// gen 10 précise se joue donc entièrement sur le choix de la gen 1, à
    /// mille kamas pièce.
    Duplicate,
}

pub struct LadderPolicy {
    ladder: Ladder,
    pub threshold: usize,
    /// L'ordre dans lequel les croisements entrent dans la fournée. Voir
    /// `Ordering` pour les cinq candidats et ce qui les sépare.
    pub ordering: Ordering,
    /// Quels étages ajournent en dessous du seuil. Voir `Gating`.
    pub gating: Gating,
    /// Comment les gen 1 achetées se choisissent. Voir `Purchasing`.
    pub purchasing: Purchasing,
    /// Comment la couronne se choisit. Voir `Crowning`.
    pub crowning: Crowning,
    /// Comment le rythme se règle. Voir `Tuning`.
    pub tuning: Tuning,
    /// Apparier les stériles sans regarder leur sexe.
    ///
    /// **Ce n'est plus indifférent, et le tri gagne** : `−2,12 M ± 0,49` sur
    /// 200 graines appariées, t = −4,31, 75 parties gagnées sur 200. Regarder le
    /// sexe vaut donc 2,12 M.
    ///
    /// C'est la troisième fois que ce levier tranche autrement, et l'avertissement
    /// ci-dessous l'avait annoncé : il bouge à chaque changement du modèle de
    /// places ou du marché. Il a été indifférent (−0,32 M, t = −0,64) sous les prix
    /// uniformes et le tourniquet d'achat ; la cloche et la phase d'achat informée
    /// le font ressortir. Le défaut ne change pas — c'était déjà le tri — mais la
    /// raison de le garder n'est plus « faute de mieux ».
    ///
    /// L'arithmétique qui suit explique pourquoi l'effet est fragile plutôt que
    /// pourquoi il est nul : les deux effets s'annulent **en espérance** — à
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
    /// Ce qu'on fait d'une gen 10 une fois qu'on l'a. Voir `Summit`.
    pub summit: Summit,
    /// Laisser le cloneur refondre les montures du **plafond**.
    ///
    /// `true` par défaut, comme avant : le levier ne sert qu'avec
    /// `Summit::Duplicate`, et il est mesuré **exactement nul** sans elle — sans
    /// la boucle une gen 10 ne s'accouple jamais, donc ne devient jamais stérile,
    /// donc le cloneur ne la voit pas. Les deux s'allument ensemble ou pas du
    /// tout. Voir `clonable` et `Summit`.
    pub clone_top: bool,
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
    /// | pool hérité | **+14,73 M** (t = 25,7) | +6,87 M (t = 15,1) |
    /// | départ de zéro | **−1,18 M** (t = −17,2) | −1,18 M (t = −17,6) |
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
    /// La couronne imposée, pour la mesure. `None` = la mieux payée du jour.
    ///
    /// Sert à chiffrer le **plafond** d'une réorientation : forcer chaque gen 10
    /// candidate et garder la meilleure après coup donne ce qu'un oracle
    /// gagnerait, donc ce qu'aucune règle ne peut dépasser.
    forced_crown: Option<ColorId>,
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
            ordering: Ordering::default(),
            gating: Gating::default(),
            purchasing: Purchasing::default(),
            crowning: Crowning::default(),
            tuning: Tuning::default(),
            sex_blind_cloning: false,
            clone_across_lineages: true,
            harvesting: true,
            summit: Summit::default(),
            clone_top: true,
            next_starter: 0,
            crowned: false,
            forced_crown: None,
            strategies: None,
            admissible: HashMap::new(),
        }
    }

    pub fn ladder(&self) -> &Ladder {
        &self.ladder
    }

    /// Imposer la gen 10 visée, au lieu de prendre la mieux payée. Voir
    /// `forced_crown` — c'est un instrument de mesure, pas un réglage de jeu.
    pub fn with_forced_crown(mut self, crown: ColorId) -> Self {
        self.forced_crown = Some(crown);
        self
    }

    /// Ce qu'on fait du sommet. Voir `Summit`.
    pub fn with_summit(mut self, summit: Summit) -> Self {
        self.summit = summit;
        self
    }

    /// L'ordre de composition, et le seuil qui l'accompagne.
    ///
    /// Les deux ensemble parce qu'ils ne se lisent qu'ensemble : « bas vers le
    /// haut » sans dire où le seuil s'applique ne décrit pas une politique. Les
    /// cinq candidats du relevé se nomment ainsi :
    ///
    /// | | ordre | seuil |
    /// | --- | --- | --- |
    /// | dépôt | `TopDown` | `OddOnly` |
    /// | bas vers le haut | `BottomUp` | `Everywhere` |
    /// | haut vers le bas | `TopDown` | `Off` |
    /// | haut vers le bas, un par un | `RoundRobin` | `Off` |
    /// | du plus fourni au moins fourni | `BigToSmall` | `Off` |
    pub fn with_ordering(mut self, ordering: Ordering, gating: Gating) -> Self {
        self.ordering = ordering;
        self.gating = gating;
        self
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
    /// | pool hérité | **+5,12 M ± 0,58** | 8,87 | 149/200 |
    /// | départ de zéro | **+2,72 M ± 0,12** | 22,81 | 195/200 |
    ///
    /// Rejoué depuis `Gating::Off` — voir `reglage::ce_que_le_reglage_rapporte`.
    /// Le gain rétrécit d'un point et demi sur le pool hérité : les deux leviers
    /// achètent en partie la même chose, des tours de jeu, donc le second à
    /// mesurer trouve moins à prendre. Ils ne s'annulent pas pour autant.
    pub fn tuned_for(mut self, economy: &crate::economy::Economy) -> Self {
        // Lu avant d'emprunter les stratégies : le rang du sommet dit ce qu'une
        // fournée rapporte, et il vit sur l'échelle. Voir
        // `Economy::value_per_success_toward`.
        let summit = self.ladder.summit_generation;
        let Some(strategies) = self.strategies.as_mut() else {
            return self;
        };
        let horizon = economy.horizon_hours.unwrap_or(300.0);

        let units = economy.unit_count().min(MAX_UNITS);
        for (unit, strategy) in strategies.iter_mut().enumerate().take(units) {
            let base = *strategy;

            // Ce qu'une configuration rend, hors simulation.
            //
            // Trois termes, et les deux premiers se lisent sur l'économie :
            //
            //   les **fournées** — combien de cycles tiennent dans l'horizon, en
            //     comptant l'attente d'une fenêtre quand il y en a ;
            //   le **carburant** — ce qu'une fournée coûte à la bande choisie ;
            //   la **valeur** d'une fournée, proportionnelle au taux de réussite,
            //     donc au niveau. C'est le seul terme qui ne se déduit pas, d'où
            //     `value_per_success` dans l'économie.
            let worth = |bands: [usize; crate::schedule::GAUGES], level: u16| -> f64 {
                let mut probe = base;
                probe.bands = bands;
                probe.level = level;
                let (fuel, hours) = economy.unit_load(unit, probe);
                if hours <= 0.0 {
                    return f64::NEG_INFINITY;
                }
                let count = economy.loads_within(horizon, hours) as f64;
                let value = economy.value_per_success_toward(summit)
                    * economy.success_rate(economy.level_of(probe), false);
                count * (value - fuel as f64)
            };

            // Toutes les bandes uniformes, tous les niveaux du balayage. Quatre
            // bandes et une poignée de niveaux : assez petit pour chercher
            // exhaustivement, et déterministe.
            //
            // La bande **doit** être cherchée. `tuned_for` ne réglait que le
            // niveau et laissait la bande la moins chère, ce qui était un gel
            // méthodologique jamais levé — et `bin/windows` le chiffre à une
            // trentaine de millions.
            let mut best: Option<(f64, [usize; crate::schedule::GAUGES], u16)> = None;
            // La bande n'est cherchée que si on le demande : voir `Tuning` pour ce
            // que ça gagne avec un pool et ce que ça détruit sans.
            let bands_to_try: &[usize] = match self.tuning {
                Tuning::BandAndLevel => &[0, 1, 2, 3],
                Tuning::LastFreeStep => &[],
            };
            for &band in bands_to_try {
                let bands = [band; crate::schedule::GAUGES];
                for level in [1u16, 12, 23, 36, 50, 67, 85, 100, 120] {
                    let score = worth(bands, level);
                    // À égalité, la bande la moins chère et le niveau le plus bas :
                    // ce qui ne rapporte pas plus ne doit pas coûter plus.
                    if best.is_none_or(|(top, _, _)| score > top) {
                        best = Some((score, bands, level));
                    }
                }
            }

            if let Some((score, bands, level)) = best
                && score > 0.0
            {
                strategy.bands = bands;
                strategy.level = level;
                continue;
            }

            // Aucune configuration ne se rembourse : on garde la moins chère et on
            // remonte le niveau jusqu'au dernier cran gratuit, l'ancien réglage.
            // C'est le cas d'une économie où le carburant dépasse ce qu'une
            // fournée rapporte, et il ne doit pas rendre la politique inerte.
            let loads = |level: u16| {
                let mut probe = base;
                probe.level = level;
                economy.loads_within(horizon, economy.unit_load(unit, probe).1)
            };
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
                    // `climbs` et non « a une cible » : la moisson vit des
                    // génétons, et ils ne tombent que si l'enfant dépasse
                    // l'ascendance. Un couple plafonné en affiche une, pleine, et
                    // n'en paie aucun.
                    if !pair_outlook(catalog, male, female).climbs() {
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

    /// La boucle du sommet : dupliquer ce qui porte déjà une gen 10.
    ///
    /// Voir `Summit::Duplicate` pour l'arithmétique et pour ce que le partenaire
    /// décide. Ici on n'a plus qu'à l'appliquer.
    ///
    /// ## Qui est sujet
    ///
    /// Tout ce qui **porte** le plafond dans ses six cases, pas seulement les
    /// gen 10 elles-mêmes. C'est le point qui rend la boucle rentable : le raté
    /// d'un croisement au sommet est une monture de basse génération dont la
    /// généalogie contient la gen 10, donc elle revise la gen 10 — c'est le
    /// raccourci d'ascendance de #59, et il ne coûte rien de plus.
    ///
    /// ## Pourquoi on achète le partenaire au lieu de le prendre en écurie
    ///
    /// Une gen 1 neuve coûte mille kamas et n'appartient à aucun bloc tant qu'on
    /// ne la range pas. Puiser dans les gen 1 de l'écurie brûlerait la matière
    /// première de l'étage 1 — c'est exactement l'exclusion que la moisson a dû
    /// apprendre à ses dépens, 1,5 M sur le départ de zéro. Et le partenaire ne
    /// se choisit pas au hasard : c'est lui qui décide de quelle gen 10 sort.
    ///
    /// ## Après la composition, jamais avant
    ///
    /// La montée passe d'abord. Le sommet ne prend que les places qui restent,
    /// sans quoi il financerait la duplication en cessant de grimper — et la
    /// première gen 10 est ce qu'il faut avoir pour que la boucle existe.
    fn summit(&mut self, view: &UnitView<'_>, groups: &[crate::stable::MateGroup], free: &mut [Vec<usize>], batch: &mut Building) {
        if self.summit != Summit::Duplicate {
            return;
        }
        let Building {
            crossings,
            purchases,
            budget,
            places,
        } = batch;
        let catalog = view.catalog;
        let top = catalog.top_generation();
        let starter = view.economy.starter_price;

        /// Ce que la monture porte : sa couleur et celles de ses deux parents.
        fn carried(catalog: &Catalog, mate: &crate::pairing::Mate) -> u8 {
            let mut highest = catalog.generation(mate.color);
            for parent in mate.parents.into_iter().flatten() {
                highest = highest.max(catalog.generation(parent));
            }
            highest
        }

        // Les porteuses, les vraies gen 10 d'abord : ce sont elles dont la
        // réussite est une duplication, et elles ne se remplacent pas.
        let mut subjects: Vec<usize> = (0..groups.len())
            .filter(|&at| carried(catalog, &groups[at].sample) >= top)
            .collect();
        if subjects.is_empty() {
            return;
        }
        subjects.sort_by_key(|&at| {
            std::cmp::Reverse((
                catalog.generation(groups[at].sample.color),
                view.economy
                    .value_of(catalog, groups[at].sample.color),
            ))
        });

        for subject in subjects {
            while *places < view.capacity && *budget >= starter && !free[subject].is_empty() {
                let sex = groups[subject].sex;
                let Some((color, _)) = self.summit_partner(view, &groups[subject].sample, sex)
                else {
                    break;
                };

                let index = view.stable.len() + purchases.len();
                let subject_index = *free[subject].last().expect("non vide");
                let pair = if sex == Sex::Male {
                    [subject_index, index]
                } else {
                    [index, subject_index]
                };
                let cost = places_for(view.stable, pair);
                if *places + cost > view.capacity {
                    break;
                }

                free[subject].pop();
                purchases.push((color, sex.other()));
                crossings.push(pair);
                *places += cost;
                *budget -= starter;
            }
        }
    }

    /// La gen 1 à acheter pour dupliquer une porteuse de gen 10.
    ///
    /// On note chaque teinte par l'**espérance de valeur du bloc cible** : la
    /// masse cible vaut le taux quel que soit le partenaire, mais son partage
    /// dépend de lui, et les gen 10 ne se valent pas au marché. Maximiser
    /// l'espérance revient donc à concentrer la cible sur la mieux payée — ce qui
    /// choisit tout seul la propre gen 1 de la mère quand c'est elle la plus
    /// chère, sans qu'on ait à écrire la règle.
    ///
    /// `None` quand aucune teinte ne nomme quoi que ce soit au rang visé : la
    /// monture retombe alors dans le régime de recopie, et deux fécondités
    /// brûlées pour une recopie ne valent pas mille kamas.
    fn summit_partner(
        &self,
        view: &UnitView<'_>,
        subject: &crate::pairing::Mate,
        subject_sex: Sex,
    ) -> Option<(ColorId, f64)> {
        let catalog = view.catalog;
        let mut best: Option<(ColorId, f64)> = None;
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
            let outlook = pair_outlook(catalog, male, female);
            if outlook.target_colors.is_empty() {
                continue;
            }
            let total: f64 = outlook.target_colors.iter().map(|t| t.weight).sum();
            if total <= 0.0 {
                continue;
            }
            let worth: f64 = outlook
                .target_colors
                .iter()
                .map(|t| {
                    (t.weight / total) * view.economy.value_of(catalog, t.color) as f64
                })
                .sum::<f64>()
                * outlook.success_rate;
            if best.is_none_or(|(current, seen)| worth > seen || (worth == seen && color < current))
            {
                best = Some((color, worth));
            }
        }
        best
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
            let outlook = pair_outlook(catalog, male, female);
            if !outlook.climbs() {
                continue;
            }
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

    /// Cet étage attend-il d'être lançable en nombre ?
    fn gated(&self, rank: u8) -> bool {
        match self.gating {
            Gating::OddOnly => rank % 2 == 1,
            Gating::Everywhere => true,
            Gating::Off => false,
        }
    }

    /// Combien de couples l'étage propose, tous candidats confondus.
    ///
    /// Le compte porte sur les couples **énumérés**, pas sur ceux encore
    /// lançables : une monture apparaît dans plusieurs couples et n'en honorera
    /// qu'un. C'est ce que le seuil du dépôt mesure, et le resserrer changerait
    /// le seuil sans le dire — donc une autre expérience que celle-ci.
    fn formable(by_target: &HashMap<ColorId, Vec<(usize, usize)>>, here: &[ColorId]) -> usize {
        here.iter()
            .map(|c| by_target.get(c).map_or(0, |pairs| pairs.len()))
            .sum()
    }

    /// La couleur de l'étage dont on est le plus en retard, et le premier couple
    /// qu'elle a encore sous la main.
    ///
    /// Le retard est **relatif** à la demande propagée : `stock / demande`. C'est
    /// lui qui donne le « deux fois plus de Roux-Amande » sans qu'on l'écrive, et
    /// il est le même pour les cinq ordres — seul l'ordre dans lequel on
    /// l'interroge change.
    fn most_behind(
        &self,
        here: &[ColorId],
        by_target: &HashMap<ColorId, Vec<(usize, usize)>>,
        free: &[Vec<usize>],
        held: &HashMap<ColorId, f64>,
        made: &HashMap<ColorId, f64>,
    ) -> Option<(ColorId, usize)> {
        let mut choice: Option<(f64, ColorId, usize)> = None;
        for &color in here {
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

            let stock =
                held.get(&color).copied().unwrap_or(0.0) + made.get(&color).copied().unwrap_or(0.0);
            let lag = stock / want;
            if choice.is_none_or(|(best, _, _)| lag < best) {
                choice = Some((lag, color, position));
            }
        }
        choice.map(|(_, color, position)| (color, position))
    }

    /// Engager un couple, si la place le permet.
    ///
    /// Les places se comptent **après** le tirage : leur coût dépend de ce que
    /// ces deux montures-là doivent encore de cycle, pas du nombre de
    /// croisements.
    fn launch(
        &self,
        view: &UnitView<'_>,
        pair: (usize, usize),
        free: &mut [Vec<usize>],
        crossings: &mut Vec<[usize; 2]>,
        places: &mut usize,
    ) -> Launched {
        let (male, female) = pair;
        let Some(male_index) = free[male].pop() else {
            return Launched::Retry;
        };
        let Some(female_index) = free[female].pop() else {
            free[male].push(male_index);
            return Launched::Retry;
        };
        let cost = places_for(view.stable, [male_index, female_index]);
        if *places + cost > view.capacity {
            free[male].push(male_index);
            free[female].push(female_index);
            return Launched::Full;
        }
        *places += cost;
        crossings.push([male_index, female_index]);
        Launched::Yes
    }

    /// Composer la fournée : quels croisements, et dans quel ordre.
    ///
    /// Les cinq ordres partagent tout le reste — l'admissibilité a déjà filtré
    /// `by_target`, le retard relatif choisit à l'intérieur d'un étage, et le
    /// seuil est un levier séparé. Ce qui suit ne fait donc que **classer les
    /// étages** et décider si on les vide ou si on les sert à tour de rôle.
    ///
    /// Rend ce qu'elle a engagé, par couleur cible : la phase d'achat en a besoin
    /// pour ne pas racheter ce que la fournée vient déjà de lancer.
    fn compose(
        &self,
        view: &UnitView<'_>,
        by_target: &HashMap<ColorId, Vec<(usize, usize)>>,
        free: &mut [Vec<usize>],
        held: &HashMap<ColorId, f64>,
        crossings: &mut Vec<[usize; 2]>,
        places: &mut usize,
    ) -> HashMap<ColorId, f64> {
        let catalog = view.catalog;
        let mut made: HashMap<ColorId, f64> = HashMap::new();

        // Les étages : une génération, et les couleurs voulues qu'elle porte.
        // `BigToSmall` est le seul à ne pas grouper — son unité est la couleur —
        // et il se coule dans la même boucle en rendant des étages singletons.
        let mut tiers: Vec<(u8, Vec<ColorId>)> = if self.ordering == Ordering::BigToSmall {
            let mut colors: Vec<ColorId> = self.ladder.wanted.iter().copied().collect();
            // Le plus fourni d'abord. L'identifiant tranche les égalités, sinon
            // l'ordre dépendrait du parcours du `HashSet` et la mesure ne serait
            // pas reproductible.
            colors.sort_unstable_by_key(|&color| {
                std::cmp::Reverse((by_target.get(&color).map_or(0, |p| p.len()), color))
            });
            colors
                .into_iter()
                .map(|color| (catalog.generation(color), vec![color]))
                .collect()
        } else {
            let mut grouped: HashMap<u8, Vec<ColorId>> = HashMap::new();
            for &color in &self.ladder.wanted {
                grouped.entry(catalog.generation(color)).or_default().push(color);
            }
            let mut tiers: Vec<(u8, Vec<ColorId>)> = grouped.into_iter().collect();
            for (_, here) in &mut tiers {
                here.sort_unstable();
            }
            match self.ordering {
                // La plus haute d'abord.
                Ordering::TopDown | Ordering::RoundRobin => {
                    tiers.sort_unstable_by_key(|(rank, _)| std::cmp::Reverse(*rank));
                }
                Ordering::BottomUp => tiers.sort_unstable_by_key(|(rank, _)| *rank),
                // À nombre de couples égal, la plus haute génération.
                Ordering::BigToSmallByRank => tiers.sort_by_key(|(rank, here)| {
                    std::cmp::Reverse((Self::formable(by_target, here), *rank))
                }),
                Ordering::BigToSmall => unreachable!("traité au-dessus"),
            }
            tiers
        };
        // Les étages ajournés sortent une fois pour toutes : `by_target` ne
        // bouge pas pendant la fournée, donc le verdict du seuil non plus.
        tiers.retain(|(rank, here)| {
            !(self.gated(*rank) && Self::formable(by_target, here) < self.threshold)
        });

        if self.ordering == Ordering::RoundRobin {
            // Un croisement par étage et par tour, tant qu'un tour complet en
            // place au moins un. Sans le drapeau, un étage dont les couples sont
            // épuisés ferait tourner la boucle indéfiniment.
            loop {
                let mut launched = false;
                for (_, here) in &tiers {
                    if *places >= view.capacity {
                        return made;
                    }
                    let Some((color, position)) =
                        self.most_behind(here, by_target, free, held, &made)
                    else {
                        continue;
                    };
                    match self.launch(view, by_target[&color][position], free, crossings, places) {
                        Launched::Yes => {
                            *made.entry(color).or_default() += 1.0;
                            launched = true;
                        }
                        Launched::Retry => {}
                        Launched::Full => return made,
                    }
                }
                if !launched {
                    return made;
                }
            }
        }

        for (_, here) in &tiers {
            while *places < view.capacity {
                let Some((color, position)) = self.most_behind(here, by_target, free, held, &made)
                else {
                    break;
                };
                match self.launch(view, by_target[&color][position], free, crossings, places) {
                    Launched::Yes => *made.entry(color).or_default() += 1.0,
                    Launched::Retry => continue,
                    Launched::Full => break,
                }
            }
        }

        made
    }

    /// La paire de gen 1 à acheter : celle qui produit la gen 2 la plus en retard.
    ///
    /// Le même critère que `most_behind`, appliqué à ce qu'on achète plutôt qu'à
    /// ce qu'on possède. La recette d'une gen 2 voulue **est** la paire de teintes
    /// à acheter : `recipe_of` la donne, et les deux teintes appartiennent par
    /// construction à un même bloc fermé — c'est ce que `lay_third` garantit.
    ///
    /// `bought` compte ce que la phase d'achat a déjà engagé cette fournée. Sans
    /// lui, la boucle rachèterait indéfiniment la même paire : le retard ne
    /// bougerait pas d'une itération à l'autre.
    fn most_needed_purchase(
        &self,
        catalog: &Catalog,
        held: &HashMap<ColorId, f64>,
        made: &HashMap<ColorId, f64>,
        bought: &HashMap<ColorId, f64>,
    ) -> Option<[ColorId; 2]> {
        let mut choice: Option<(f64, ColorId, [ColorId; 2])> = None;

        for &color in &self.ladder.wanted {
            // L'étage 1 seul : c'est tout ce qu'une paire de gen 1 peut viser.
            if catalog.generation(color) != 2 {
                continue;
            }
            let want = self.ladder.demand.get(&color).copied().unwrap_or(0.0);
            if want <= 0.0 {
                continue;
            }
            let Some(&recipe) = self.ladder.recipe_of.get(&color) else {
                continue;
            };
            // Deux teintes distinctes : une recette qui se recopie ne nomme rien.
            if recipe[0] == recipe[1] {
                continue;
            }

            let stock = held.get(&color).copied().unwrap_or(0.0)
                + made.get(&color).copied().unwrap_or(0.0)
                + bought.get(&color).copied().unwrap_or(0.0);
            let lag = stock / want;
            // La couleur tranche les égalités, sinon l'ordre dépendrait du
            // parcours du `HashSet` et deux exécutions différeraient.
            if choice.is_none_or(|(best, at, _)| lag < best || (lag == best && color < at)) {
                choice = Some((lag, color, recipe));
            }
        }

        choice.map(|(_, _, recipe)| recipe)
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
        let outlook = pair_outlook(catalog, male, female);
        let targets = &outlook.target_colors;
        // `climbs` remplace « la cible n'est pas vide ». Les deux disaient la
        // même chose tant qu'un couple au plafond était refusé ; ils divergent
        // depuis. Un couple plafonné nomme des couleurs et n'en gagne aucune
        // génération : deux fécondités consommées pour rester au même barreau,
        // ce que l'échelle ne propose pas. Ce que la boucle du sommet en ferait
        // est un autre plan, et il se mesurera à part.
        let answer = if !outlook.climbs()
            || !targets
                .iter()
                .all(|t| self.ladder.wanted.contains(&t.color))
        {
            None
        } else {
            Some(targets[0].color)
        };
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
            let choice = self.forced_crown.or_else(|| match self.crowning {
                Crowning::PriceOnly => None,
                // Le partenaire d'abord : voir `Crowning` pour le relevé, et pour
                // les deux explications que la mesure a écartées.
                Crowning::PartnerThenPrice => {
                    self.ladder.best_partner_crown(catalog, view.economy)
                }
            });
            self.ladder.crown_at(catalog, view.economy, choice);
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

        let mut crossings: Vec<[usize; 2]> = Vec::new();
        // Places d'enclos consommées. Ce n'est plus le nombre de croisements :
        // un couple dont les deux parents ont déjà cyclé ne coûte rien.
        let mut places = 0usize;

        // L'ordre de composition — la dernière inconnue de l'échelle. Voir
        // `Ordering` pour les cinq candidats, et `compose` pour ce qu'ils
        // partagent.
        let made = self.compose(
            view,
            &by_target,
            &mut free,
            &held,
            &mut crossings,
            &mut places,
        );

        let mut purchases: Vec<(ColorId, Sex)> = Vec::new();
        let starter = view.economy.starter_price;
        let mut budget = view.kamas - view.economy.batch_cost;

        // Le sommet, puis la moisson. Dans cet ordre parce qu'ils se disputent
        // les mêmes places et que la gen 10 vaut cinq cents fois le géneton
        // qu'une moisson en tirerait — voir `Summit`.
        if self.summit == Summit::Duplicate || self.harvesting {
            let mut batch = Building {
                crossings,
                purchases,
                budget,
                places,
            };
            self.summit(view, &groups, &mut free, &mut batch);
            if self.harvesting {
                self.harvest(view, &groups, &mut free, &mut batch);
            }
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
        // Ce que l'achat a déjà engagé cette fournée, par gen 2 visée. Sert au
        // seul mode `MostBehind`, qui sans ça rachèterait la même paire en boucle.
        let mut bought: HashMap<ColorId, f64> = HashMap::new();

        while places + 2 <= view.capacity
            && budget >= 2 * starter
            && !self.ladder.blocks.is_empty()
        {
            let pair = match self.purchasing {
                Purchasing::MostBehind => {
                    let Some(recipe) =
                        self.most_needed_purchase(catalog, &held, &made, &bought)
                    else {
                        // Aucune gen 2 ne réclame quoi que ce soit : il n'y a rien
                        // d'utile à acheter, et le tourniquet en achèterait quand
                        // même. On s'arrête, les places restantes valent mieux
                        // vides qu'employées à produire du hors-plan.
                        break;
                    };
                    // La cible, pour tenir le compte du retard.
                    if let Some(target) = self
                        .ladder
                        .recipe_of
                        .iter()
                        .find(|(_, r)| **r == recipe)
                        .map(|(color, _)| *color)
                    {
                        *bought.entry(target).or_default() += 1.0;
                    }
                    recipe
                }
                Purchasing::RoundRobin => {
                    let block =
                        &self.ladder.blocks[self.next_starter % self.ladder.blocks.len()];
                    self.next_starter += 1;
                    if block.len() < 2 {
                        continue;
                    }
                    let male = block[self.next_starter % block.len()];
                    let female = block[(self.next_starter + 1) % block.len()];
                    if male == female {
                        continue;
                    }
                    [male, female]
                }
            };

            let base = view.stable.len() + purchases.len();
            purchases.push((pair[0], Sex::Male));
            purchases.push((pair[1], Sex::Female));
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
            clone_by_generation(view.stable, catalog, self.sex_blind_cloning, self.clone_top)
        } else {
            clone_same_lineage(view.stable, catalog, self.sex_blind_cloning, self.clone_top)
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
/// Une stérile se laisse-t-elle refondre ?
///
/// Un clonage échange **une monture contre une fécondité** : deux stériles
/// entrent, une féconde sort. Le marché est bon tant que la monture détruite ne
/// vaut presque rien et que la fécondité rendue ouvre la montée — c'est le cas
/// partout sous le sommet.
///
/// Au sommet il s'inverse, et il s'inverse **doublement**. La monture détruite
/// est ce qu'on possède de plus cher, et la fécondité rendue n'achète qu'une
/// chance de plus sur deux d'en refaire une. Tant que `Summit::Hold` régnait,
/// elle n'achetait même rien du tout : aucun croisement au plafond n'était
/// admissible, donc refondre deux gen 10 en une était une perte sèche que rien
/// ne compensait.
///
/// Mesuré : voir `mod sommet`.
fn clonable(catalog: &Catalog, mount: &crate::stable::Mount, clone_top: bool) -> bool {
    clone_top || catalog.generation(mount.color) < catalog.top_generation()
}

fn clone_same_lineage(
    stable: &Stable,
    catalog: &Catalog,
    sex_blind: bool,
    clone_top: bool,
) -> Vec<[usize; 2]> {
    let mut by_lineage: HashMap<(u8, MateSignature), (Vec<usize>, Vec<usize>)> = HashMap::new();
    for (index, mount) in stable.mounts.iter().enumerate() {
        if mount.fertile || !clonable(catalog, mount, clone_top) {
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

fn clone_by_generation(
    stable: &Stable,
    catalog: &Catalog,
    sex_blind: bool,
    clone_top: bool,
) -> Vec<[usize; 2]> {
    let mut by_generation: HashMap<u8, Vec<usize>> = HashMap::new();
    for (index, mount) in stable.mounts.iter().enumerate() {
        if mount.fertile || !clonable(catalog, mount, clone_top) {
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

    /// Les deux routes visent le même sommet, quel que soit le sommet.
    ///
    /// Le test attendait deux couleurs — « Ivoire et Turquoise », le sommet du
    /// temps où `TOP_RUNG` arrêtait la montée à la gen 5. Le plafond retiré, le
    /// muldo monte jusqu'à la gen 9, qui en compte **quatre** : l'assertion est
    /// rouge sur `main` depuis, sans que personne ne l'ait vu.
    ///
    /// On la réécrit sur le rang plutôt que sur un nombre, pour qu'elle survive
    /// au prochain déplacement du sommet : ce qui compte est que les deux routes
    /// s'arrêtent au **même** rang, pas qu'elles s'arrêtent à la gen 5.
    #[test]
    fn les_deux_routes_visent_les_memes_sommets() {
        let catalog = muldo();
        let shared = Ladder::of(&catalog, Route::Shared);
        let disjoint = Ladder::of(&catalog, Route::Disjoint);
        assert_eq!(shared.summit, disjoint.summit, "le même sommet");
        assert!(!shared.summit.is_empty(), "un sommet, au moins");
        let rung = catalog.generation(shared.summit[0]);
        assert!(rung % 2 == 1, "le sommet est un rang impair, pas une composée");
        for &color in &shared.summit {
            assert_eq!(catalog.generation(color), rung, "un seul rang au sommet");
        }
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
mod sommet {
    use super::*;
    use crate::config::Prices;
    use crate::economy::play;
    use crate::trees::muldo;

    /// La boucle du sommet contre l'attente. Score **et** gen 10 tenues : la
    /// boucle produit des gen 10, donc c'est elle qu'il faut regarder d'abord,
    /// et le score dit ensuite ce que les places dépensées ont coûté ailleurs.
    /// Un bras : la boucle allumée ou non, le cloneur autorisé au sommet ou non.
    fn arm(
        catalog: &Catalog,
        economy: &crate::economy::Economy,
        seed: u32,
        summit: Summit,
        clone_top: bool,
    ) -> (f64, f64) {
        let mut policy = LadderPolicy::new(catalog, Route::Shared).with_summit(summit);
        policy.clone_top = clone_top;
        let outcome = play(catalog, economy, &mut policy, seed);
        (outcome.score as f64, outcome.gen10_held as f64)
    }

    fn duel(
        label: &str,
        economy: &crate::economy::Economy,
        after: (Summit, bool),
        before: (Summit, bool),
    ) {
        let catalog = muldo();
        let mut deltas = Vec::new();
        let mut tops = Vec::new();
        let mut wins = 0;
        for seed in 0..200 {
            let (on, on_top) = arm(&catalog, economy, seed, after.0, after.1);
            let (off, off_top) = arm(&catalog, economy, seed, before.0, before.1);
            if on - off > 0.0 {
                wins += 1;
            }
            deltas.push(on - off);
            tops.push(on_top - off_top);
        }
        let stats = |values: &[f64]| {
            let n = values.len() as f64;
            let mean = values.iter().sum::<f64>() / n;
            let variance = values.iter().map(|d| (d - mean).powi(2)).sum::<f64>() / (n - 1.0);
            (mean, (variance / n).sqrt())
        };
        let (mean, stderr) = stats(&deltas);
        let (top_mean, top_stderr) = stats(&tops);
        println!(
            "{label:<22} score {:+.3} M ± {:.3} (t = {:>6.2}, gagne {wins}/200) · \
             gen 10 {:+.2} ± {:.2} (t = {:>6.2})",
            mean / 1e6,
            stderr / 1e6,
            mean / stderr,
            top_mean,
            top_stderr,
            top_mean / top_stderr
        );
    }

    /// Ce que la boucle du sommet rapporte, dans les deux régimes.
    ///
    /// Elle n'a de gisement que si une gen 10 existe : en partant de cent gen 1,
    /// rien n'atteint le sommet dans l'horizon et la boucle n'a rien à mordre.
    /// C'est la mesure qui décide du défaut de `Summit`, pas l'arithmétique — la
    /// boucle rend plus de 1 par gen 10 consommée, mais elle dépense des places
    /// que la montée réclame, et ce sont deux comptes différents.
    #[test]
    fn ce_que_la_boucle_du_sommet_rapporte() {
        let base = Prices::load_default().expect("economy.toml").economy;
        const HOLD: (Summit, bool) = (Summit::Hold, true);

        println!("\nboucle du sommet, contre l'échelle d'aujourd'hui :");
        // La boucle seule, cloneur inchangé : elle perd, et c'est le résultat
        // qui a fait chercher pourquoi.
        duel("dupliquer seul", &base, (Summit::Duplicate, true), HOLD);
        // Ne plus refondre les gen 10, boucle éteinte : le levier vaut-il quelque
        // chose à lui seul, sans rien pour employer la fécondité rendue ?
        duel("ne pas refondre seul", &base, (Summit::Hold, false), HOLD);
        // Les deux : c'est la proposition.
        duel("les deux", &base, (Summit::Duplicate, false), HOLD);

        println!("\nce que la boucle ajoute une fois le cloneur retenu :");
        duel(
            "dupliquer | sans refonte",
            &base,
            (Summit::Duplicate, false),
            (Summit::Hold, false),
        );

        println!("\ndépart de zéro — rien n'atteint le sommet, donc rien à mordre :");
        let mut scratch = base;
        scratch.pool_generations = (1, 1);
        duel("les deux", &scratch, (Summit::Duplicate, false), HOLD);
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

    /// Le réglage doit battre celui qu'il remplace, **sur son propre critère**.
    ///
    /// L'ancien verrou exigeait « le dernier cran gratuit », c'est-à-dire le plus
    /// haut niveau qui ne coûte pas une fournée. Ce n'est plus la règle : le
    /// réglage cherche maintenant la bande **et** le niveau qui maximisent
    /// `fournées × (valeur − carburant)`, et ce compromis accepte volontiers de
    /// perdre une fournée pour un taux de réussite qui la rembourse.
    ///
    /// Ce qui reste vérifiable, et qui casse si la recherche de bande disparaît :
    /// la configuration retenue doit valoir **au moins autant** que l'ancienne
    /// règle sur ce critère. C'est un verrou faible en apparence et suffisant en
    /// pratique — supprimer le balayage des bandes le fait échouer, parce que la
    /// bande la moins chère n'est pas celle qui gagne sur cette économie.
    #[test]
    fn le_reglage_bat_la_regle_qu_il_remplace() {
        let catalog = muldo_for_test();
        let economy = Prices::load_default().expect("economy.toml").economy;
        let policy = LadderPolicy::new(&catalog, Route::Shared)
            .with_strategies([Strategy::default(); MAX_UNITS])
            .tuned_for(&economy);

        // Le même critère que `tuned_for`, valeur par fournée comprise : la juger
        // sur une autre échelle que celle qu'elle a employée ne verrouillerait
        // rien. Voir `Economy::value_per_success_toward`.
        let summit = policy.ladder().summit_generation;
        let horizon = economy.horizon_hours.unwrap_or(300.0);
        let worth = |unit: usize, probe: Strategy| -> f64 {
            let (fuel, hours) = economy.unit_load(unit, probe);
            if hours <= 0.0 {
                return f64::NEG_INFINITY;
            }
            let count = economy.loads_within(horizon, hours) as f64;
            let value = economy.value_per_success_toward(summit)
                * economy.success_rate(economy.level_of(probe), false);
            count * (value - fuel as f64)
        };

        for unit in 0..economy.unit_count().min(MAX_UNITS) {
            // L'ancienne règle : bande par défaut, dernier cran gratuit.
            let loads = |at: u16| {
                let mut probe = Strategy::default();
                probe.level = at;
                economy.loads_within(horizon, economy.unit_load(unit, probe).1)
            };
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
            let mut former = Strategy::default();
            former.level = low;

            let chosen = worth(unit, policy.strategy(unit));
            let before = worth(unit, former);
            assert!(
                chosen >= before,
                "unité {unit} : le réglage retenu vaut {chosen:.0} contre {before:.0} \
                 pour l'ancienne règle — la recherche a régressé"
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
