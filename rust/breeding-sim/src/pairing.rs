//! Ce qu'un couple vise, et ce que l'accouplement peut rendre.
//!
//! Port de `src/lib/dofus/breeding/pairing.ts`. Les deux règles qui portent tout
//! le reste, et qui ne se devinent pas :
//!
//! 1. **La cible est le maximum de toute la généalogie, plus un** — pas les
//!    parents plus un. Une gen 1 dont un parent est gen 9 vise la gen 10, huit
//!    générations d'un coup, sans que le taux s'en émeuve (relevé #59). C'est ce
//!    qui rend une « couleur basse à ascendance haute » plus précieuse que sa
//!    couleur ne le laisse croire.
//! 2. **La couleur cible naît d'une recombinaison croisée** : une teinte prise
//!    dans la lignée de gauche, l'autre dans celle de droite, et on retient les
//!    paires qui **nomment** une couleur du rang visé. Une cible que personne ne
//!    nomme n'est pas une cible — le croisement bascule alors en « recopie », et
//!    toute la masse retourne à l'ascendance.
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
    /// Générations gagnées sur ce que la recette annoncerait. `0` hors
    /// raccourci.
    pub leap: i16,
    pub success_rate: f64,
    /// Les couleurs possibles à la génération visée, la plus probable devant.
    /// **Vide** est un cas normal et fréquent : c'est la recopie.
    pub target_colors: Vec<TargetColor>,
}

/// Les cases d'ascendance qu'une monture apporte : elle-même, puis ses parents.
#[inline]
pub fn mate_ancestry(mate: &Mate) -> impl Iterator<Item = ColorId> + '_ {
    std::iter::once(mate.color).chain(mate.parents.into_iter().flatten())
}

/// La génération que vise un couple : le maximum de toute son ascendance, plus
/// un.
#[inline]
pub fn pair_target_generation(catalog: &Catalog, male: &Mate, female: &Mate) -> u8 {
    let mut top = 0;
    for color in mate_ancestry(male).chain(mate_ancestry(female)) {
        top = top.max(catalog.generation(color));
    }
    top + 1
}

/// La génération qu'un couple viserait si seuls comptaient ses deux parents —
/// c'est-à-dire ce que le graphe de recettes sait voir.
#[inline]
pub fn recipe_target_generation(catalog: &Catalog, male: &Mate, female: &Mate) -> u8 {
    catalog
        .generation(male.color)
        .max(catalog.generation(female.color))
        + 1
}

/// Les couleurs que le croisement peut rendre à la génération visée.
///
/// Chaque lignée porte une distribution de couleurs ; on croise les deux et on
/// retient les paires qui nomment une couleur du rang visé. Sur le relevé #59,
/// les deux lignées valent `{Amande 42,19 %, Doré 42,19 %, Ébène-Orchidée
/// 15,63 %}`, et la seule paire qui nomme une gen 4 est `{Doré, Amande}` — soit
/// exactement ce qu'affichait la fenêtre.
pub fn pair_target_colors(
    catalog: &Catalog,
    male: &Mate,
    female: &Mate,
    target_generation: u8,
) -> Vec<TargetColor> {
    if !catalog.has_compositions_at(target_generation) {
        return Vec::new();
    }

    let left = lineage_distribution(catalog, male.color, male.parents);
    let right = lineage_distribution(catalog, female.color, female.parents);

    let mut weights: Vec<TargetColor> = Vec::new();
    for &(color_a, share_a) in &left {
        for &(color_b, share_b) in &right {
            let Some(color) = catalog.names_at(target_generation, color_a, color_b) else {
                continue;
            };
            let weight = share_a * share_b;
            match weights.iter_mut().find(|t| t.color == color) {
                Some(entry) => entry.weight += weight,
                None => weights.push(TargetColor { color, weight }),
            }
        }
    }

    weights.sort_by(|a, b| {
        b.weight
            .partial_cmp(&a.weight)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| catalog.slug(a.color).cmp(catalog.slug(b.color)))
    });
    weights
}

/// Ce que vise un couple, tout compris.
///
/// `None` quand la cible dépasse la génération la plus haute de la famille :
/// deux montures dont l'ascendance porte déjà une gen 10 ne visent pas une
/// gen 11, elle n'existe pas.
///
/// Ce n'est **pas** la porte principale vers la recopie, et c'est même la plus
/// rare. On y tombe bien plus souvent avec une cible parfaitement licite que
/// personne ne nomme : deux Indigo visent la gen 2, mais « Indigo et Indigo »
/// n'est pas une couleur. On répond alors normalement, avec `target_colors`
/// vide — refuser de répondre serait une faute, c'est le croisement d'une
/// purification.
pub fn pair_outlook(catalog: &Catalog, male: &Mate, female: &Mate) -> Option<PairOutlook> {
    let target_generation = pair_target_generation(catalog, male, female);
    if target_generation > catalog.top_generation() {
        return None;
    }
    let by_recipe = recipe_target_generation(catalog, male, female);

    Some(PairOutlook {
        target_generation,
        leap: i16::from(target_generation) - i16::from(by_recipe),
        success_rate: target_generation_rate(male.level, female.level),
        target_colors: pair_target_colors(catalog, male, female, target_generation),
    })
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
///   `2 + w` ;
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
    let Some(mut outlook) = pair_outlook(catalog, male, female) else {
        return Vec::new();
    };
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

    // Sans couleur à la génération visée, il n'y a pas de réussite possible.
    let target_mass = if outlook.target_colors.is_empty() {
        0.0
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

    let lineages = [
        lineage_distribution(catalog, male.color, male.parents),
        lineage_distribution(catalog, female.color, female.parents),
    ];

    // Les recombinaisons qui nomment une couleur **ailleurs** qu'à la génération
    // visée. Celles qui la nomment sont la réussite, déjà comptée ; et aucune ne
    // peut la dépasser, la cible valant par construction le maximum de
    // l'ascendance plus un.
    let mut crossings: Vec<(ColorId, f64)> = Vec::new();
    let mut crossing_weight = 0.0;
    for &(color_a, share_a) in &lineages[0] {
        for &(color_b, share_b) in &lineages[1] {
            let Some(color) = catalog.names_anywhere(color_a, color_b) else {
                continue;
            };
            if catalog.generation(color) == outlook.target_generation {
                continue;
            }
            let weight = share_a * share_b;
            crossing_weight += weight;
            match crossings.iter_mut().find(|(c, _)| *c == color) {
                Some(entry) => entry.1 += weight,
                None => crossings.push((color, weight)),
            }
        }
    }

    let failure_mass = 1.0 - target_mass;
    let total = lineages.len() as f64 + crossing_weight;
    for distribution in &lineages {
        for &(color, share) in distribution {
            add(
                &mut outcomes,
                color,
                (share / total) * failure_mass,
                OutcomeKind::Other,
            );
        }
    }
    for &(color, weight) in &crossings {
        add(
            &mut outcomes,
            color,
            (weight / total) * failure_mass,
            OutcomeKind::Other,
        );
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

        let outlook = pair_outlook(&catalog, &male, &female).expect("cible licite");
        assert_eq!(outlook.target_generation, 4, "le max de l'ascendance + 1");
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

        let outlook = pair_outlook(&catalog, &porteuse, &anonyme).expect("cible licite");
        assert_eq!(outlook.target_generation, 10);
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

    /// Le régime « recopie » de #68 : deux Indigo capturés visent la gen 2, mais
    /// « Indigo et Indigo » n'est pas une couleur. La fenêtre affiche Indigo
    /// 100 %.
    #[test]
    fn deux_indigo_captures_se_recopient_a_cent_pour_cent() {
        let catalog = muldo();
        let indigo = mate(&catalog, "indigo", 67, None);

        let outlook = pair_outlook(&catalog, &indigo, &indigo).expect("gen 2 est licite");
        assert_eq!(outlook.target_generation, 2);
        assert!(
            outlook.target_colors.is_empty(),
            "aucune gen 2 ne se compose d'Indigo et d'Indigo"
        );

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
                        if outcomes.is_empty() {
                            // Cible au-dessus du plafond : le couple ne peut pas
                            // s'accoupler, il n'y a rien à sommer.
                            continue;
                        }
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

    #[test]
    fn au_dessus_du_plafond_il_n_y_a_pas_de_couple() {
        let catalog = muldo();
        // Ascendance gen 10 des deux côtés : la cible serait une gen 11.
        let porteur = mate(&catalog, "dore", 67, Some(["ambre_dore", "dore"]));
        assert!(pair_outlook(&catalog, &porteur, &porteur).is_none());
        assert!(mating_outcomes(&catalog, &porteur, &porteur).is_empty());
    }
}
