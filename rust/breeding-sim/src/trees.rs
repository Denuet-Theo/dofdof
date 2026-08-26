//! Le catalogue de couleurs, lu depuis `src/lib/dofus/breeding/trees.json`.
//!
//! Le JSON n'est **jamais dupliqué** : c'est la sortie de
//! `scripts/extract-breeding-trees.mjs`, il est versionné, et deux copies
//! divergeraient à la première mise à jour des arbres.
//!
//! ## Les couleurs deviennent des entiers
//!
//! Le TS travaille sur des identifiants texte, ce qui est juste et lisible. Ici
//! on interne chaque couleur en `u16` dès le chargement : le simulateur compare
//! des couleurs des dizaines de millions de fois, et une comparaison de chaînes
//! y coûte plus cher que tout le reste du calcul réuni. Les slugs restent
//! disponibles pour les messages et pour la parité.
//!
//! ## Les index de composition
//!
//! Les recettes servent de **table de composition** et non de chemin de
//! production : « Doré et Amande » se fabrique canoniquement par Doré × Amande,
//! donc ce couple-là *nomme* la couleur — que le croisement réel passe par deux
//! Ébène-Orchidée n'y change rien. On en garde deux lectures, exactement comme
//! le TS :
//!
//! - **par génération**, pour lire la cible d'un croisement ;
//! - **toutes générations**, parce que l'échec produit des recombinaisons à tous
//!   les rangs en dessous de la cible (voir `mating_outcomes`).
//!
//! Les deux sont construits une fois au chargement. Le TS les mémoïse
//! paresseusement dans des `WeakMap` ; ici le catalogue est immuable et
//! construit une fois par processus, donc la paresse n'achèterait rien.

use std::collections::HashMap;
use std::path::Path;

use serde_json::Value;

/// Une couleur, internée. `u16` suffit très largement : 306 couleurs sur les
/// trois familles.
pub type ColorId = u16;

/// Une couleur composée voit son poids de lignée divisé par 4,5, et c'est la
/// **génération** qui le dit.
///
/// On l'a lue successivement sur le souligné de l'identifiant, puis sur la
/// parité du nom affiché. Les deux se trompent au même endroit : la gen 9. Le
/// relevé du 14/08 (issue #185) donne Azur (gen 9) à 3,28 % contre Pourpre
/// (gen 1) à 14,75 % — deux grands-parents de même position, et pourtant
/// exactement le facteur 4,5 entre eux. Les gen 9 *sont* des compositions de
/// deux gen 8 ; elles reçoivent seulement un nom d'un seul mot.
///
/// `aigue_marine` cesse du même coup d'être une exception à nommer : elle est
/// gen 9, donc composée.
///
/// Le `|| 9` reste un **ajustement et non une loi** — les gen 5 et 7 n'ont
/// jamais été relevées, et « impaire ⇒ simple » comme « ≥ 2 ⇒ composée » sont
/// réfutées. Voir `lineage.ts`, qui porte le tableau complet de ce qui est su.
pub const fn is_composite(generation: u8) -> bool {
    generation % 2 == 0 || generation == 9
}

#[derive(Debug, Clone)]
pub struct Color {
    pub slug: String,
    pub name: String,
    pub generation: u8,
    /// Recettes internées. Une recette dont un composant est inconnu du
    /// catalogue est écartée au chargement — voir `Catalog::dropped_recipes`.
    pub recipes: Vec<[ColorId; 2]>,
    /// « Composée » au sens de `lineage.ts` : poids de lignée divisé par 4,5.
    /// Lu sur la génération — voir `is_composite` — et calculé une fois ici
    /// plutôt qu'à chaque lecture de lignée.
    pub composite: bool,
}

pub struct Catalog {
    colors: Vec<Color>,
    by_slug: HashMap<String, ColorId>,
    top_generation: u8,
    /// `(a, b)` trié → la couleur que ces deux teintes nomment, toutes
    /// générations confondues.
    anywhere: HashMap<[ColorId; 2], ColorId>,
    /// Le même index, restreint à une génération. Indexé par la génération
    /// elle-même, d'où l'entrée 0 inutilisée.
    at_generation: Vec<HashMap<[ColorId; 2], ColorId>>,
    /// Recettes écartées faute d'un composant connu. Doit valoir 0 sur les
    /// arbres livrés ; non nul signalerait un `trees.json` tronqué.
    pub dropped_recipes: usize,
}

/// Une couleur telle que le JSON la porte, avant internement.
struct RawColor<'a> {
    slug: &'a str,
    name: &'a str,
    generation: u8,
    recipes: Vec<[&'a str; 2]>,
}

/// Lit les couleurs d'une famille sans dérive serde.
///
/// Le format vient de `scripts/extract-breeding-trees.mjs` et il est stable.
/// On échoue bruyamment sur tout ce qui manque plutôt que de combler par un
/// défaut : une génération lue à zéro rabaisserait silencieusement toutes les
/// cibles, ce qui est exactement le genre de bug que la porte de parité met des
/// heures à circonscrire.
fn read_family<'a>(root: &'a Value, family_id: &str) -> Result<Vec<RawColor<'a>>, String> {
    let families = root
        .get("families")
        .and_then(Value::as_array)
        .ok_or("trees.json: `families` absent ou n'est pas un tableau")?;

    let family = families
        .iter()
        .find(|f| f.get("id").and_then(Value::as_str) == Some(family_id))
        .ok_or_else(|| format!("famille inconnue: {family_id}"))?;

    let raw_colors = family
        .get("colors")
        .and_then(Value::as_array)
        .ok_or_else(|| format!("{family_id}: `colors` absent ou n'est pas un tableau"))?;

    let mut colors = Vec::with_capacity(raw_colors.len());
    for color in raw_colors {
        let slug = color
            .get("id")
            .and_then(Value::as_str)
            .ok_or_else(|| format!("{family_id}: une couleur sans `id`"))?;
        // `itemName` porte le nom de l'objet tel qu'il s'écrit en jeu — « Muldo
        // Doré » — là où `name` est une forme dépouillée de ses accents
        // (« Dore »). C'est `itemName` qu'on tape dans la recherche de l'HDV,
        // donc c'est lui qu'une liste de courses doit dire. Il manque sur les
        // couleurs sans objet correspondant, d'où le repli.
        let name = color
            .get("itemName")
            .and_then(Value::as_str)
            .or_else(|| color.get("name").and_then(Value::as_str))
            .unwrap_or(slug);
        let generation = color
            .get("generation")
            .and_then(Value::as_u64)
            .ok_or_else(|| format!("{family_id}/{slug}: `generation` absente"))?
            as u8;

        // `recipes` manque sur les couleurs sauvages de génération 1, qui se
        // capturent au lieu de s'élever. C'est le seul champ dont l'absence est
        // légitime.
        let mut recipes = Vec::new();
        for recipe in color
            .get("recipes")
            .and_then(Value::as_array)
            .map(Vec::as_slice)
            .unwrap_or(&[])
        {
            let pair = recipe
                .as_array()
                .filter(|p| p.len() == 2)
                .ok_or_else(|| format!("{family_id}/{slug}: recette qui n'est pas une paire"))?;
            let a = pair[0]
                .as_str()
                .ok_or_else(|| format!("{family_id}/{slug}: composant non textuel"))?;
            let b = pair[1]
                .as_str()
                .ok_or_else(|| format!("{family_id}/{slug}: composant non textuel"))?;
            recipes.push([a, b]);
        }

        colors.push(RawColor {
            slug,
            name,
            generation,
            recipes,
        });
    }
    Ok(colors)
}

impl Catalog {
    /// Charge une famille (`"muldo"`, `"dragodinde"`, `"volkorne"`).
    pub fn from_json(json: &str, family_id: &str) -> Result<Self, String> {
        let root: Value = serde_json::from_str(json).map_err(|e| format!("trees.json: {e}"))?;
        let raw = read_family(&root, family_id)?;

        // Passe 1 : interner les slugs. L'ordre du JSON est conservé, et il
        // compte — l'index de composition garde le « premier arrivé », comme le
        // TS.
        let mut by_slug = HashMap::with_capacity(raw.len());
        for (index, color) in raw.iter().enumerate() {
            if by_slug
                .insert(color.slug.to_owned(), index as ColorId)
                .is_some()
            {
                return Err(format!("couleur en double dans {family_id}: {}", color.slug));
            }
        }

        // Passe 2 : les recettes, une fois tous les slugs connus.
        let mut dropped_recipes = 0;
        let mut colors = Vec::with_capacity(raw.len());
        for color in &raw {
            let mut recipes = Vec::with_capacity(color.recipes.len());
            for [a, b] in &color.recipes {
                match (by_slug.get(*a), by_slug.get(*b)) {
                    (Some(&a), Some(&b)) => recipes.push([a, b]),
                    _ => dropped_recipes += 1,
                }
            }
            colors.push(Color {
                slug: color.slug.to_owned(),
                name: color.name.to_owned(),
                generation: color.generation,
                recipes,
                composite: is_composite(color.generation),
            });
        }

        let top_generation = colors.iter().map(|c| c.generation).max().unwrap_or(0);

        // Les index. `or_insert` reproduit le « premier arrivé » du TS : une
        // composition ne nomme qu'une couleur, et les trois familles n'ont
        // aucune collision — 162 clés pour le muldo, zéro conflit.
        let mut anywhere = HashMap::new();
        let mut at_generation = vec![HashMap::new(); top_generation as usize + 1];
        for (index, color) in colors.iter().enumerate() {
            let id = index as ColorId;
            for recipe in &color.recipes {
                let key = sorted(*recipe);
                anywhere.entry(key).or_insert(id);
                at_generation[color.generation as usize]
                    .entry(key)
                    .or_insert(id);
            }
        }

        Ok(Self {
            colors,
            by_slug,
            top_generation,
            anywhere,
            at_generation,
            dropped_recipes,
        })
    }

    pub fn load(path: impl AsRef<Path>, family_id: &str) -> Result<Self, String> {
        let path = path.as_ref();
        let json = std::fs::read_to_string(path)
            .map_err(|e| format!("lecture de {}: {e}", path.display()))?;
        Self::from_json(&json, family_id)
    }

    #[inline]
    pub fn len(&self) -> usize {
        self.colors.len()
    }

    #[inline]
    pub fn is_empty(&self) -> bool {
        self.colors.is_empty()
    }

    #[inline]
    pub fn color(&self, id: ColorId) -> &Color {
        &self.colors[id as usize]
    }

    #[inline]
    pub fn colors(&self) -> &[Color] {
        &self.colors
    }

    #[inline]
    pub fn generation(&self, id: ColorId) -> u8 {
        self.colors[id as usize].generation
    }

    #[inline]
    pub fn is_composite(&self, id: ColorId) -> bool {
        self.colors[id as usize].composite
    }

    #[inline]
    pub fn slug(&self, id: ColorId) -> &str {
        &self.colors[id as usize].slug
    }

    /// Le nom affiché, celui qu'on lit dans le jeu et à l'HDV.
    ///
    /// Le slug suffit partout où le code se parle à lui-même ; devant une liste
    /// de courses, `aigue_marine_dore` n'est pas ce qu'on tape dans la barre de
    /// recherche.
    #[inline]
    pub fn name(&self, id: ColorId) -> &str {
        &self.colors[id as usize].name
    }

    #[inline]
    pub fn top_generation(&self) -> u8 {
        self.top_generation
    }

    pub fn id_of(&self, slug: &str) -> Option<ColorId> {
        self.by_slug.get(slug).copied()
    }

    /// Quelle couleur ces deux teintes nomment **à cette génération**, s'il en
    /// est une.
    #[inline]
    pub fn names_at(&self, generation: u8, a: ColorId, b: ColorId) -> Option<ColorId> {
        self.at_generation
            .get(generation as usize)?
            .get(&sorted([a, b]))
            .copied()
    }

    /// Quelle couleur ces deux teintes nomment, **quelle que soit** la
    /// génération.
    #[inline]
    pub fn names_anywhere(&self, a: ColorId, b: ColorId) -> Option<ColorId> {
        self.anywhere.get(&sorted([a, b])).copied()
    }

    /// Y a-t-il seulement une composition à ce rang ? Le TS court-circuite
    /// `pairTargetColors` quand l'index est vide.
    ///
    /// Ce n'est vrai **que de la génération 1**, et il vaut la peine de le dire
    /// parce que l'inverse se déduit trop bien : « les générations impaires sont
    /// des couleurs simples, donc elles ne se composent pas ». Faux. *Roux*,
    /// gen 3, est bien une couleur simple — mais elle se fabrique en croisant
    /// deux gen 2 composées, et elle a six recettes. « Simple » qualifie le
    /// **nom** de la couleur, pas la façon dont on l'obtient. Seules les gen 1
    /// ne s'élèvent pas : elles se capturent.
    #[inline]
    pub fn has_compositions_at(&self, generation: u8) -> bool {
        self.at_generation
            .get(generation as usize)
            .is_some_and(|index| !index.is_empty())
    }

    pub fn ids_at_generation(&self, generation: u8) -> impl Iterator<Item = ColorId> + '_ {
        self.colors
            .iter()
            .enumerate()
            .filter(move |(_, c)| c.generation == generation)
            .map(|(i, _)| i as ColorId)
    }
}

/// La clé canonique d'une paire non ordonnée.
///
/// Le TS trie les **slugs** et les concatène ; on trie les identifiants
/// internés. Les deux canonisations diffèrent dans l'ordre qu'elles produisent
/// mais pas dans les paires qu'elles confondent, et c'est tout ce qu'un index
/// demande — la lecture et l'écriture passent par la même fonction.
#[inline]
fn sorted([a, b]: [ColorId; 2]) -> [ColorId; 2] {
    if a <= b { [a, b] } else { [b, a] }
}

/// Le chemin par défaut du catalogue, relatif à la racine du dépôt.
pub const TREES_PATH: &str = "../../src/lib/dofus/breeding/trees.json";

/// Charge le muldo depuis l'emplacement par défaut. Utilisé par les tests et
/// les binaires de mesure, qui tournent tous depuis `rust/breeding-sim`.
pub fn muldo() -> Catalog {
    family("muldo")
}

/// Charge **n'importe quelle** famille depuis l'emplacement par défaut.
///
/// `muldo()` reste la commodité des tests et des mesures publiées ; celle-ci existe
/// pour comparer les familles sans coder un second helper par arbre, ce que la
/// compétence `neat-training` demande explicitement.
///
/// ## Ce qu'elle ne rend pas comparable pour autant
///
/// Le catalogue ne porte pas les prix, et charger un arbre ne re-tarife rien : c'est
/// `Prices::for_family` qui pose le prix de la ressource d'extraction de la famille
/// (relevés du 25/08, `[valeurs.ressource_par_famille]`). Ce qui reste muldo dans un
/// score mesuré ailleurs : la bande de prix gen 10, et la largeur de la bande de
/// ressource, déduite du prix ponctuel faute d'un relevé sur trente jours.
///
/// Ce qui n'est **pas** un écart entre familles, contrairement à ce que cette doc a
/// affirmé un temps : les paliers de `GENETONS_BY_GENERATION`. Les rendements en
/// génétons sont les mêmes pour toutes les montures — confirmé par l'éleveur le
/// 25/08.
pub fn family(id: &str) -> Catalog {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"));
    Catalog::load(root.join("../../src/lib/dofus/breeding/trees.json"), id)
        .unwrap_or_else(|error| panic!("le catalogue {id} doit se charger : {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn charge_le_muldo_en_entier() {
        let catalog = muldo();
        assert_eq!(catalog.len(), 120);
        assert_eq!(catalog.top_generation(), 10);
        assert_eq!(
            catalog.dropped_recipes, 0,
            "toute recette doit nommer des couleurs du catalogue"
        );
    }

    /// La gen 9 est composée, et son souligné n'y est pour rien.
    ///
    /// Ce test a dit successivement les deux choses. `aigue_marine` a d'abord été
    /// classée composée par son souligné, puis simple par son nom d'un seul mot —
    /// et c'est le relevé du 14/08 qui tranche : les gen 9 sont composées, quelle
    /// que soit la forme de leur nom. Les deux couleurs ci-dessous en attestent
    /// depuis les deux bords.
    #[test]
    fn la_generation_9_est_composee_quelle_que_soit_la_forme_du_nom() {
        let catalog = muldo();

        // Un souligné, mais c'est un nom d'un seul mot en deux morceaux.
        let aigue = catalog.id_of("aigue_marine").expect("aigue_marine existe");
        assert_eq!(catalog.generation(aigue), 9);
        assert!(catalog.is_composite(aigue));

        // Aucun souligné, et pourtant pénalisée : c'est Azur qui l'a montré.
        let azur = catalog.id_of("azur").expect("azur existe");
        assert_eq!(catalog.generation(azur), 9);
        assert!(catalog.is_composite(azur));

        // Et sa composée l'est aussi, sans traitement particulier.
        let compose = catalog.id_of("aigue_marine_dore").expect("existe");
        assert!(catalog.is_composite(compose));
    }

    /// La composition suit la parité — **plus la gen 9**, qui est l'écart connu.
    ///
    /// Ce test disait la parité pure, et le relevé du 14/08 l'a démentie sur une
    /// génération. Il l'épingle donc telle qu'elle est mesurée, exception
    /// comprise : le jour où une gen 5 ou une gen 7 sera relevée, c'est ici que
    /// la règle définitive s'écrira, et ce test-là dira laquelle était fausse.
    #[test]
    fn la_composition_suit_la_parite_sauf_a_la_generation_9() {
        let catalog = muldo();
        for (index, color) in catalog.colors().iter().enumerate() {
            let expected = color.generation % 2 == 0 || color.generation == 9;
            assert_eq!(
                color.composite,
                expected,
                "{} (gen {}) devrait être composée={expected}",
                catalog.slug(index as ColorId),
                color.generation
            );
        }
    }

    #[test]
    fn les_deux_teintes_de_la_gen_10_nomment_leur_composee() {
        let catalog = muldo();
        let ambre = catalog.id_of("ambre").expect("ambre existe");
        let dore = catalog.id_of("dore").expect("dore existe");
        let attendu = catalog.id_of("ambre_dore").expect("ambre_dore existe");

        assert_eq!(catalog.names_at(10, ambre, dore), Some(attendu));
        // L'index est insensible à l'ordre.
        assert_eq!(catalog.names_at(10, dore, ambre), Some(attendu));
        // Et il ne répond pas au mauvais rang.
        assert_eq!(catalog.names_at(9, ambre, dore), None);
    }

    /// Seule la génération 1 ne se compose pas — elle se capture.
    ///
    /// Ce test existe parce que l'inférence inverse est séduisante et fausse :
    /// on avait écrit ici que les générations **impaires** ne se composaient
    /// pas, au motif que leurs couleurs sont simples. *Roux* (gen 3) est simple
    /// et porte six recettes ; *Ambre* (gen 9) en porte cinq. Se composer et
    /// être composée sont deux choses : *Ambre* est produite par croisement et
    /// pèse comme une composée, *Roux* est produite par croisement et pèse
    /// plein.
    #[test]
    fn seule_la_generation_1_ne_se_compose_pas() {
        let catalog = muldo();
        assert!(!catalog.has_compositions_at(1));
        for generation in 2..=catalog.top_generation() {
            assert!(
                catalog.has_compositions_at(generation),
                "la génération {generation} devrait nommer des compositions"
            );
        }

        // Et la garde tient sur les rangs qui n'existent pas.
        assert!(!catalog.has_compositions_at(0));
        assert!(!catalog.has_compositions_at(11));
    }

    /// Une couleur simple peut avoir des recettes — c'est le cœur du
    /// malentendu ci-dessus, donc on le fige sur un cas nommé.
    #[test]
    fn roux_est_simple_et_pourtant_se_fabrique() {
        let catalog = muldo();
        let roux = catalog.id_of("roux").expect("roux, gen 3");
        assert!(!catalog.is_composite(roux), "le nom ne porte qu'une teinte");
        assert_eq!(catalog.generation(roux), 3);
        assert_eq!(
            catalog.color(roux).recipes.len(),
            6,
            "six façons de croiser deux gen 2 pour l'obtenir"
        );
    }

    #[test]
    fn la_gen_10_compte_cinquante_couleurs() {
        // Ce qui vaut d'être noté : la cible n'est pas une couleur mais un rang.
        // L'économie paie 500 000 pour n'importe laquelle des cinquante.
        let catalog = muldo();
        assert_eq!(catalog.ids_at_generation(10).count(), 50);
    }
}
