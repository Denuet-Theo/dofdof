//! Ce qu'un couple vise, et ce que l'accouplement peut rendre.
//!
//! Port de `src/lib/dofus/breeding/pairing.ts`. Les deux règles qui portent tout
//! le reste, et qui ne se devinent pas :
//!
//! 1. **La cible est le maximum de toute la généalogie, plus un** — pas les
//!    parents plus un — **plafonné à la famille**. Une gen 1 dont un parent est
//!    gen 9 vise la gen 10, huit générations d'un coup, sans que le taux s'en
//!    émeuve (relevé #59). C'est ce qui rend une « couleur basse à ascendance
//!    haute » plus précieuse que sa couleur ne le laisse croire.
//! 2. **La couleur cible naît d'une recombinaison croisée** : une teinte prise
//!    dans la lignée de gauche, l'autre dans celle de droite, et on retient les
//!    paires qui **nomment** une couleur du rang visé. Une cible que personne ne
//!    nomme n'est pas une cible — le croisement bascule alors en « recopie », et
//!    toute la masse retourne à l'ascendance.
//!
//! ## Le sommet, et pourquoi il n'y a plus de refus
//!
//! On refusait le couple dès que son ascendance atteignait le plafond : la cible
//! aurait valu 11, la gen 11 n'existe pas. C'était faux — le jeu **plafonne**,
//! il ne refuse pas, et un accouplement produit toujours un bébé. Relevé du
//! 14/08 (issue #185) sur une mère Azur-Turquoise gen 10 : la ligne « Génération
//! cible » existe, porte des couleurs gen 10, et somme exactement au taux que
//! `target_generation_rate` prédit.
//!
//! Deux conséquences, et ce ne sont pas des clauses spéciales : les couleurs de
//! lignée qui sont **à** la génération visée rejoignent le bloc cible, et l'échec
//! se normalise sur ce qui reste. Voir `crossing_shares`, qui pose les deux tas
//! en une passe. Sous le plafond rien ne change, au bit près.
//!
//! ## Ce qui n'est pas porté
//!
//! Les génétons. `pairShape` les calcule côté TS ; l'économie visée ne les
//! monnaie pas, et une valeur qu'on transporte sans l'utiliser finit par être
//! crue. La porte de parité les exclut donc explicitement de la comparaison.

use crate::lineage::lineage_distribution;
use crate::trees::{Catalog, ColorId};

/// Une monture réduite à ce qu'un appariement a besoin d'en savoir.
///
/// `parents` porte les **couleurs** des deux ascendants, pas leurs identités —
/// c'est ce que le jeu expose et ce que la base enregistre
/// (`parent_a_color`, `parent_b_color`). La profondeur est donc de deux niveaux,
/// soit les six cases de la fenêtre d'accouplement, et c'est suffisant : le jeu
/// n'en montre pas davantage.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct Mate {
    pub color: ColorId,
    /// Niveau courant : c'est lui qui décide du taux de réussite.
    pub level: u16,
    /// `None` pour une monture achetée ou capturée.
    pub parents: Option<[ColorId; 2]>,
}

/// Le niveau prêté à une monture du vrac, qui n'en a pas d'enregistré.
pub const BULK_MATE_LEVEL: u16 = 1;

const TARGET_GENERATION_BASE_RATE: f64 = 0.3;
const RATE_PER_PARENT_LEVEL: f64 = 0.0015;

/// La probabilité d'atteindre la génération visée.
///
/// Deux parents niveau 200 plafonnent à 90 % : la certitude n'est pas
/// atteignable par le niveau seul. Le saut de générations ne coûte rien ici —
/// deux gen 2 niveau 61 visant la gen 4 affichent 48,3 %, soit exactement
/// `0,3 + 0,0015 × (61 + 61)`.
#[inline]
pub fn target_generation_rate(level_a: u16, level_b: u16) -> f64 {
    (TARGET_GENERATION_BASE_RATE + RATE_PER_PARENT_LEVEL * (f64::from(level_a) + f64::from(level_b)))
        .min(1.0)
}

/// Ce qui distingue une monture d'une autre du point de vue de l'appariement :
/// sa couleur et son ascendance. À signature égale, deux montures visent
/// exactement la même chose — c'est la clé de mémoïsation.
///
/// ## Une ascendance qui ne dit rien est une absence d'ascendance
///
/// Un Ébène né de deux Ébène porte `Some([ebene, ebene])` ; un Ébène acheté porte
/// `None`. En jeu ce sont **la même monture** : même couleur, même ascendance
/// utile, mêmes cibles. Et le modèle le savait déjà partout où ça compte —
/// vérifié sur les 14 400 couples du catalogue, la loi d'appariement ne les
/// distingue en rien, et les 74 entrées du recensement leur sont identiques au bit.
///
/// Seule cette clé les séparait, et elle décide du **regroupement** : deux montures
/// interchangeables tombaient dans deux groupes, donc en deux candidats portant le
/// même delta, et le stock se fragmentait à mesure que les recopies s'accumulaient.
/// Le tirage de la recherche est uniforme sur les candidats : les doublons le
/// diluent, et un candidat tiré sur un groupe épuisé gaspille un des huit essais.
///
/// La réduction est exacte et ne s'applique qu'à ce cas : `[a, a]` avec la couleur
/// `a`. Une ascendance mixte, elle, ouvre des cibles et doit être gardée — un Ébène
/// né d'Ébène × Doré porte du Doré, et c'est ce qui lui permet de viser plus haut.
pub type MateSignature = (ColorId, Option<[ColorId; 2]>);

#[inline]
pub fn mate_signature(mate: &Mate) -> MateSignature {
    (mate.color, canonical_parents(mate.color, mate.parents))
}

/// `None` quand les deux parents sont de la couleur de la monture. Voir
/// `MateSignature`.
#[inline]
pub fn canonical_parents(
    color: ColorId,
    parents: Option<[ColorId; 2]>,
) -> Option<[ColorId; 2]> {
    match parents {
        Some([a, b]) if a == color && b == color => None,
        other => other,
    }
}

/// Une couleur que la recombinaison peut donner, et à quel point elle est
/// probable. Le poids sert à ordonner et à partager la masse cible.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TargetColor {
    pub color: ColorId,
    pub weight: f64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OutcomeKind {
    /// La génération visée. Seule elle rend des génétons, côté jeu.
    Target,
    /// Ce que rend une tentative qui la manque.
    Other,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct MatingOutcome {
    pub color: ColorId,
    pub probability: f64,
    pub kind: OutcomeKind,
}

/// Ce qu'un couple promet, une fois son ascendance lue.
#[derive(Clone, Debug, PartialEq)]
pub struct PairOutlook {
    pub target_generation: u8,
    /// La génération la plus haute des six cases : ce que le couple porte déjà.
    ///
    /// Elle valait toujours `target_generation - 1` et n'avait donc rien à dire.
    /// Le plafond les décolle, et c'est elle qui répond à la seule question qui
    /// compte en haut de l'échelle — voir `climbs`.
    pub ancestry_generation: u8,
    /// Générations gagnées sur ce que la recette annoncerait. `0` hors
    /// raccourci.
    pub leap: i16,
    pub success_rate: f64,
    /// Les couleurs possibles à la génération visée, la plus probable devant.
    /// **Vide** est un cas normal et fréquent : c'est la recopie.
    pub target_colors: Vec<TargetColor>,
}

impl PairOutlook {
    /// Ce croisement peut-il rendre une monture plus haute que ce que le couple
    /// porte ?
    ///
    /// Deux façons de répondre non, et c'est la même — l'enfant ne dépasse pas
    /// l'ascendance :
    ///
    /// 1. **personne ne nomme la cible**, donc toute la masse retombe sur la
    ///    généalogie. C'est la recopie, celle des deux Indigo de #68 ;
    /// 2. **la cible est plafonnée**, donc elle vaut la génération qu'on porte
    ///    déjà. La fenêtre est pleine, les couleurs changent, la génération non.
    ///
    /// La seconde n'existait pas tant que le couple était refusé, et c'est elle
    /// qui demande que la question soit posée à part : « a une cible » et
    /// « monte » se confondaient. Tout ce qui décide d'un accouplement veut la
    /// seconde.
    #[inline]
    pub fn climbs(&self) -> bool {
        !self.target_colors.is_empty() && self.target_generation > self.ancestry_generation
    }
}

/// Les cases d'ascendance qu'une monture apporte : elle-même, puis ses parents.
#[inline]
pub fn mate_ancestry(mate: &Mate) -> impl Iterator<Item = ColorId> + '_ {
    std::iter::once(mate.color).chain(mate.parents.into_iter().flatten())
}

/// La génération la plus haute des six cases : ce que le couple porte déjà.
#[inline]
pub fn pair_ancestry_generation(catalog: &Catalog, male: &Mate, female: &Mate) -> u8 {
    let mut top = 0;
    for color in mate_ancestry(male).chain(mate_ancestry(female)) {
        top = top.max(catalog.generation(color));
    }
    top
}

/// La génération que vise un couple : **la plus haute qu'une de ses
/// recombinaisons sache nommer**.
///
/// `None` quand aucune n'en nomme aucune — le régime de recopie, celui des deux
/// Indigo de #68, où le poulain reprend forcément une couleur de la généalogie.
///
/// Ce n'est pas le maximum de l'ascendance plus un, et c'était l'erreur : voir
/// l'en-tête du module pour les deux relevés du 17/08 qui la corrigent, et pour
/// pourquoi le plafond de la famille disparaît avec elle.
#[inline]
pub fn pair_target_generation(catalog: &Catalog, male: &Mate, female: &Mate) -> Option<u8> {
    crossing_shares(catalog, male, female).2
}

/// La génération qu'un couple viserait si seuls comptaient ses deux parents —
/// c'est-à-dire ce que le graphe de recettes sait voir. Plafonnée de même : une
/// recette ne peut pas non plus annoncer une génération qui n'existe pas.
#[inline]
pub fn recipe_target_generation(catalog: &Catalog, male: &Mate, female: &Mate) -> u8 {
    (catalog
        .generation(male.color)
        .max(catalog.generation(female.color))
        + 1)
    .min(catalog.top_generation())
}

/// Les deux moitiés d'un croisement, et la génération qu'il vise.
///
/// Port de `crossingShares`. Quatre gestes, et l'ordre des **additions** compte :
/// la porte de parité compare au milliardième, et les sommes flottantes ne
/// commutent pas. Le geste 3 n'additionne rien, il lit.
///
/// 1. Les **couleurs de lignée** des deux montures, chacune avec sa part — donc
///    une masse de 1 par lignée, 2 en tout.
/// 2. Les **recombinaisons croisées**, une teinte de chaque côté, chacune du
///    produit des deux parts.
/// 3. La **cible** : la génération la plus haute que ces recombinaisons savent
///    nommer. `None` quand aucune ne nomme rien.
/// 4. On **sépare par génération** : à la cible d'un côté, le reste de l'autre.
///
/// Les deux tas sortent en poids bruts. C'est l'appelant qui les remet à
/// l'échelle, la cible sur le taux et l'échec sur son complément.
///
/// Le geste 1 est celui que la cible plafonnée a rendu nécessaire : quand le
/// croisement monte pour de bon, aucune couleur de lignée ne peut être à la
/// génération visée. Quand il ne monte pas, la couleur propre d'une monture y
/// est — la mère gen 10 des trois fenêtres du 14/08, le père Doré-Indigo gen 2 de
/// celle du 17/08.
fn crossing_shares(
    catalog: &Catalog,
    male: &Mate,
    female: &Mate,
) -> (Vec<(ColorId, f64)>, Vec<(ColorId, f64)>, Option<u8>) {
    let mut target: Vec<(ColorId, f64)> = Vec::new();
    let mut failure: Vec<(ColorId, f64)> = Vec::new();

    fn add(heap: &mut Vec<(ColorId, f64)>, color: ColorId, weight: f64) {
        for entry in heap.iter_mut() {
            if entry.0 == color {
                entry.1 += weight;
                return;
            }
        }
        heap.push((color, weight));
    }

    let lineages = [
        lineage_distribution(catalog, male.color, male.parents),
        lineage_distribution(catalog, female.color, female.parents),
    ];

    // Geste 3, en premier parce que les deux tas en dépendent. Aucune addition
    // ici : la parité au milliardième tient à l'ordre des sommes, pas à celui
    // des comparaisons.
    let mut target_generation: Option<u8> = None;
    for &(color_a, _) in &lineages[0] {
        for &(color_b, _) in &lineages[1] {
            let Some(color) = catalog.names_anywhere(color_a, color_b) else {
                continue;
            };
            let generation = catalog.generation(color);
            if target_generation.is_none_or(|top| generation > top) {
                target_generation = Some(generation);
            }
        }
    }

    // Sans cible, la comparaison est fausse pour tout le monde et tout part dans
    // `failure`. C'est la recopie, et elle tombe d'elle-même.
    let at_target = |color: ColorId| Some(catalog.generation(color)) == target_generation;

    for distribution in &lineages {
        for &(color, share) in distribution {
            add(
                if at_target(color) {
                    &mut target
                } else {
                    &mut failure
                },
                color,
                share,
            );
        }
    }

    for &(color_a, share_a) in &lineages[0] {
        for &(color_b, share_b) in &lineages[1] {
            let Some(color) = catalog.names_anywhere(color_a, color_b) else {
                continue;
            };
            add(
                if at_target(color) {
                    &mut target
                } else {
                    &mut failure
                },
                color,
                share_a * share_b,
            );
        }
    }

    (target, failure, target_generation)
}

/// Les couleurs que le croisement peut rendre à la génération visée.
///
/// Le mécanisme principal est la recombinaison croisée. Sur le relevé #59, les
/// deux lignées valent `{Amande 42,19 %, Doré 42,19 %, Ébène-Orchidée 15,63 %}`,
/// et la seule paire qui nomme une gen 4 est `{Doré, Amande}` — soit exactement
/// ce qu'affichait la fenêtre.
///
/// S'y ajoutent, **au plafond seulement**, les couleurs de lignée déjà à la
/// génération visée : voir `crossing_shares`.
pub fn pair_target_colors(catalog: &Catalog, male: &Mate, female: &Mate) -> Vec<TargetColor> {
    let (target, _, _) = crossing_shares(catalog, male, female);
    let mut weights: Vec<TargetColor> = target
        .into_iter()
        .map(|(color, weight)| TargetColor { color, weight })
        .collect();

    weights.sort_by(|a, b| {
        b.weight
            .partial_cmp(&a.weight)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| catalog.slug(a.color).cmp(catalog.slug(b.color)))
    });
    weights
}

/// Ce que vise un couple, tout compris. **Toujours une réponse.**
///
/// On rendait `None` quand la cible dépassait la génération la plus haute de la
/// famille : deux montures dont l'ascendance porte déjà une gen 10 ne visent pas
/// une gen 11, elle n'existe pas. C'est vrai de la gen 11 et faux du couple — le
/// jeu plafonne la cible et propose l'accouplement. Voir l'en-tête du module.
///
/// Le régime de recopie, lui, reste et n'a jamais eu de rapport avec le plafond :
/// une cible parfaitement licite que personne ne nomme. Deux Indigo visent la
/// gen 2, mais « Indigo et Indigo » n'est pas une couleur. On répond normalement,
/// avec `target_colors` vide — c'est le croisement d'une purification.
pub fn pair_outlook(catalog: &Catalog, male: &Mate, female: &Mate) -> PairOutlook {
    let (target, _, named) = crossing_shares(catalog, male, female);
    let by_recipe = recipe_target_generation(catalog, male, female);
    let ancestry_generation = pair_ancestry_generation(catalog, male, female);

    // Sans recombinaison qui nomme quoi que ce soit, la cible **est** ce que le
    // couple porte : le poulain ne peut pas dépasser sa généalogie, il en reprend
    // une couleur. On y posait `ascendance + 1`, une génération que personne ne
    // nomme — de quoi faire croire à une montée là où il n'y en a aucune.
    let target_generation = named.unwrap_or(ancestry_generation);

    let mut target_colors: Vec<TargetColor> = target
        .into_iter()
        .map(|(color, weight)| TargetColor { color, weight })
        .collect();
    target_colors.sort_by(|a, b| {
        b.weight
            .partial_cmp(&a.weight)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| catalog.slug(a.color).cmp(catalog.slug(b.color)))
    });

    PairOutlook {
        target_generation,
        ancestry_generation,
        leap: i16::from(target_generation) - i16::from(by_recipe),
        success_rate: target_generation_rate(male.level, female.level),
        target_colors,
    }
}

/// Ce que l'accouplement peut donner, dans la forme où le jeu l'affiche.
///
/// Reconstitué **au centième sur les huit fenêtres relevées** par l'issue #68.
/// La masse se partage en trois :
///
/// - la **cible** prend `success_rate`, répartie entre ses couleurs au prorata
///   des poids de recombinaison (vérifié : 33,06 / 12,40 / 4,65 pour des poids
///   64 / 24 / 9) ;
/// - l'**échec** prend le reste, et ce n'est pas moitié-moitié : chaque lignée
///   pèse 1, chaque recombinaison croisée qui nomme une couleur **ailleurs**
///   qu'au rang visé pèse le produit des deux parts, et le tout se normalise sur
///   ce qui reste — soit exactement `2 + w` partout sous le plafond ;
/// - **sans couleur cible**, la masse de réussite n'a nulle part où aller et
///   retombe entièrement sur l'ascendance — le régime « recopie ». On annulait
///   autrefois cette masse sans la rendre, et la liste ne sommait plus à 1.
pub fn mating_outcomes(catalog: &Catalog, male: &Mate, female: &Mate) -> Vec<MatingOutcome> {
    mating_outcomes_at(catalog, male, female, None)
}

/// Le même calcul, avec un **taux imposé**.
///
/// Le taux ne dépend plus seulement des niveaux dès qu'on modélise la Mangeoire
/// et l'Optimakina : c'est l'enclos qu'on nourrit, pas la monture, et le bonus
/// s'achète au croisement. La forme de la distribution, elle, ne change pas —
/// seule la masse qui revient à la cible bouge.
///
/// `None` retombe sur le taux lu sur les niveaux, ce qui garde `mating_outcomes`
/// et la porte de parité inchangés.
pub fn mating_outcomes_at(
    catalog: &Catalog,
    male: &Mate,
    female: &Mate,
    rate: Option<f64>,
) -> Vec<MatingOutcome> {
    let mut outlook = pair_outlook(catalog, male, female);
    if let Some(rate) = rate {
        outlook.success_rate = rate.clamp(0.0, 1.0);
    }
    let outlook = outlook;

    let mut outcomes: Vec<MatingOutcome> = Vec::new();
    // Le `kind` n'est posé qu'à la première insertion : une couleur vue en cible
    // puis en échec reste une cible, comme côté TS.
    fn add(outcomes: &mut Vec<MatingOutcome>, color: ColorId, probability: f64, kind: OutcomeKind) {
        match outcomes.iter_mut().find(|o| o.color == color) {
            Some(entry) => entry.probability += probability,
            None => outcomes.push(MatingOutcome {
                color,
                probability,
                kind,
            }),
        }
    }

    // L'échec, posé par la même passe que la cible. Son diviseur est « ce qui
    // reste » et non `2 + w` : au plafond, une couleur de lignée part vers la
    // cible et sa lignée ne pèse plus 1. Sous le plafond les deux coïncident.
    let (_, failure, _) = crossing_shares(catalog, male, female);
    let total: f64 = failure.iter().map(|(_, weight)| weight).sum();

    // Les deux régimes dégénérés, et ce sont les deux bords du même partage :
    //
    // - **rien à viser** : la masse de réussite n'a nulle part où aller et
    //   retombe entièrement sur l'ascendance. C'est la recopie, deux Indigo ;
    // - **rien à rater** : toute l'ascendance est déjà à la génération visée,
    //   donc aucune issue ne la manque. Le cas ne s'atteint qu'au plafond, avec
    //   six cases gen 10, et il n'a pas de relevé — mais lui donner la masse
    //   d'échec ferait sommer la fenêtre à moins de 1.
    let target_mass = if outlook.target_colors.is_empty() {
        0.0
    } else if total <= 0.0 {
        1.0
    } else {
        outlook.success_rate
    };
    let total_weight: f64 = outlook.target_colors.iter().map(|t| t.weight).sum();
    for target in &outlook.target_colors {
        let share = if total_weight > 0.0 {
            target.weight / total_weight
        } else {
            1.0 / outlook.target_colors.len() as f64
        };
        add(
            &mut outcomes,
            target.color,
            target_mass * share,
            OutcomeKind::Target,
        );
    }

    let failure_mass = 1.0 - target_mass;
    if total > 0.0 {
        for &(color, weight) in &failure {
            add(
                &mut outcomes,
                color,
                (weight / total) * failure_mass,
                OutcomeKind::Other,
            );
        }
    }

    // La cible d'abord, quoi qu'elle pèse : c'est elle qu'on vient chercher, et
    // c'est le classement du jeu.
    outcomes.sort_by(|a, b| {
        let target = |o: &MatingOutcome| u8::from(o.kind == OutcomeKind::Target);
        target(b)
            .cmp(&target(a))
            .then_with(|| {
                b.probability
                    .partial_cmp(&a.probability)
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
            .then_with(|| catalog.slug(a.color).cmp(catalog.slug(b.color)))
    });
    outcomes
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::trees::muldo;

    fn mate(catalog: &Catalog, slug: &str, level: u16, parents: Option<[&str; 2]>) -> Mate {
        Mate {
            color: catalog.id_of(slug).unwrap_or_else(|| panic!("{slug}")),
            level,
            parents: parents.map(|[a, b]| {
                [
                    catalog.id_of(a).unwrap_or_else(|| panic!("{a}")),
                    catalog.id_of(b).unwrap_or_else(|| panic!("{b}")),
                ]
            }),
        }
    }

    /// Le relevé #59, celui qui a fait découvrir la règle : deux Ébène-Orchidée
    /// gen 2, niveau 61, ascendance Amande gen 3 + Doré gen 1, visent la gen 4 à
    /// 48,3 % et sortent Doré-Amande.
    #[test]
    fn le_releve_59_le_raccourci_de_generation() {
        let catalog = muldo();
        let parents = Some(["amande", "dore"]);
        let male = mate(&catalog, "ebene_orchidee", 61, parents);
        let female = mate(&catalog, "ebene_orchidee", 61, parents);

        let outlook = pair_outlook(&catalog, &male, &female);
        assert_eq!(outlook.target_generation, 4, "le max de l'ascendance + 1");
        assert_eq!(outlook.ancestry_generation, 3, "l'Amande de la généalogie");
        assert!(outlook.climbs());
        assert_eq!(outlook.leap, 1, "la recette n'aurait annoncé que la gen 3");
        assert!((outlook.success_rate - 0.483).abs() < 1e-9);
        assert_eq!(outlook.target_colors.len(), 1);
        assert_eq!(
            catalog.slug(outlook.target_colors[0].color),
            "dore_amande",
            "la seule paire qui nomme une gen 4"
        );
    }

    /// Le second cas de #59 : une gen 1 dont un parent est gen 9, appariée à une
    /// gen 1 anonyme, vise la **gen 10**. Huit générations d'un coup, et le taux
    /// ne s'en émeut pas.
    #[test]
    fn le_raccourci_n_est_pas_plafonne() {
        let catalog = muldo();
        let porteuse = mate(&catalog, "dore", 67, Some(["ambre", "dore"]));
        let anonyme = mate(&catalog, "dore", 67, None);

        let outlook = pair_outlook(&catalog, &porteuse, &anonyme);
        assert_eq!(outlook.target_generation, 10);
        assert_eq!(outlook.ancestry_generation, 9, "l'Ambre de la généalogie");
        assert!(outlook.climbs(), "la gen 10 dépasse bien la gen 9 portée");
        assert_eq!(outlook.leap, 8);
        assert!((outlook.success_rate - 0.501).abs() < 1e-9, "niveau 67 des deux côtés");
        assert!(
            outlook
                .target_colors
                .iter()
                .any(|t| catalog.slug(t.color) == "ambre_dore"),
            "Ambre × Doré nomme bien une gen 10"
        );
    }

    /// Le régime « recopie » de #68 : « Indigo et Indigo » n'est pas une couleur,
    /// donc rien à viser. La fenêtre affiche Indigo 100 %, et **aucune ligne
    /// « Génération cible »** — c'est le relevé, et il ne dit donc rien d'une
    /// génération visée.
    ///
    /// On affirmait ici `target_generation == 2`, la gen 2 que la formule
    /// annonçait. Rien ne l'observait : la cible est ce qu'une recombinaison sait
    /// nommer, et ici aucune ne nomme rien. Elle vaut donc ce que le couple porte
    /// — la gen 1 — soit exactement « le poulain ne dépassera pas sa généalogie ».
    #[test]
    fn deux_indigo_captures_se_recopient_a_cent_pour_cent() {
        let catalog = muldo();
        let indigo = mate(&catalog, "indigo", 67, None);

        let outlook = pair_outlook(&catalog, &indigo, &indigo);
        assert_eq!(
            pair_target_generation(&catalog, &indigo, &indigo),
            None,
            "aucune recombinaison ne nomme quoi que ce soit"
        );
        assert_eq!(
            outlook.target_generation, outlook.ancestry_generation,
            "faute de cible nommée, le couple ne dépasse pas ce qu'il porte"
        );
        assert!(
            outlook.target_colors.is_empty(),
            "aucune gen 2 ne se compose d'Indigo et d'Indigo"
        );
        assert!(!outlook.climbs(), "rien à nommer, donc rien à gagner");

        let outcomes = mating_outcomes(&catalog, &indigo, &indigo);
        assert_eq!(outcomes.len(), 1);
        assert_eq!(catalog.slug(outcomes[0].color), "indigo");
        assert!(
            (outcomes[0].probability - 1.0).abs() < 1e-12,
            "la masse de réussite est rendue, pas perdue: {:?}",
            outcomes[0]
        );
    }

    /// La propriété qui a manqué le plus longtemps : quoi qu'il arrive, la
    /// fenêtre somme à 1. C'est elle qui a rattrapé le bug où 30 % de la masse
    /// se déversait sur la dernière ligne.
    #[test]
    fn toute_fenetre_somme_a_un() {
        let catalog = muldo();
        let slugs = [
            "dore", "amande", "indigo", "ambre", "aigue_marine", "dore_amande", "ebene_orchidee",
            "ambre_dore",
        ];
        let ancestries: [Option<[&str; 2]>; 4] = [
            None,
            Some(["dore", "amande"]),
            Some(["ambre", "ambre"]),
            Some(["dore_amande", "ebene_orchidee"]),
        ];

        let mut checked = 0;
        for a in slugs {
            for b in slugs {
                for pa in ancestries {
                    for pb in ancestries {
                        let male = mate(&catalog, a, 67, pa);
                        let female = mate(&catalog, b, 67, pb);
                        let outcomes = mating_outcomes(&catalog, &male, &female);
                        assert!(
                            !outcomes.is_empty(),
                            "{a}{pa:?} × {b}{pb:?} : un accouplement rend toujours un bébé"
                        );
                        let sum: f64 = outcomes.iter().map(|o| o.probability).sum();
                        assert!(
                            (sum - 1.0).abs() < 1e-12,
                            "{a}{pa:?} × {b}{pb:?} somme à {sum}"
                        );
                        checked += 1;
                    }
                }
            }
        }
        assert!(checked > 500, "seulement {checked} fenêtres vérifiées");
    }

    /// Le relevé du 14/08, fenêtre 1 : au plafond, le jeu **plafonne** la cible.
    ///
    /// Une mère Azur-Turquoise gen 10 niveau 46, généalogie Azur (gen 9) +
    /// Pourpre (gen 1), face à un Ébène gen 1 capturé niveau 44. La fenêtre
    /// annonce une ligne « Génération cible » à 43,50 % — Azur-Turquoise 27,19 %
    /// et Azur-Ébène 16,31 % — et zéro géneton. C'est la mesure qui a retiré le
    /// refus ; si elle tombe, le refus est revenu par une autre porte.
    #[test]
    fn au_plafond_le_jeu_plafonne_au_lieu_de_refuser() {
        let catalog = muldo();
        let mere = mate(&catalog, "azur_turquoise", 46, Some(["azur", "pourpre"]));
        let pere = mate(&catalog, "ebene", 44, None);

        let outlook = pair_outlook(&catalog, &pere, &mere);
        assert_eq!(outlook.target_generation, 10, "plafonnée, pas refusée");
        assert_eq!(outlook.ancestry_generation, 10, "la mère elle-même");
        assert!(
            !outlook.climbs(),
            "une cible pleine, mais rien de plus haut que ce que le couple porte"
        );
        assert!((outlook.success_rate - 0.435).abs() < 1e-9, "46 + 44");

        let attendu = [
            ("azur_turquoise", 0.2719, OutcomeKind::Target),
            ("azur_ebene", 0.1631, OutcomeKind::Target),
            ("ebene", 0.2359, OutcomeKind::Other),
            ("ebene_pourpre", 0.1481, OutcomeKind::Other),
            ("pourpre", 0.1481, OutcomeKind::Other),
            ("azur", 0.0329, OutcomeKind::Other),
        ];
        let outcomes = mating_outcomes(&catalog, &pere, &mere);
        assert_eq!(outcomes.len(), attendu.len(), "{outcomes:?}");
        for (slug, probability, kind) in attendu {
            let color = catalog.id_of(slug).unwrap_or_else(|| panic!("{slug}"));
            let seen = outcomes
                .iter()
                .find(|o| o.color == color)
                .unwrap_or_else(|| panic!("{slug} absent de {outcomes:?}"));
            assert_eq!(seen.kind, kind, "{slug}");
            assert!(
                (seen.probability - probability).abs() < 5e-5,
                "{slug} : {:.4} contre {probability:.4} relevé",
                seen.probability
            );
        }
    }
}
