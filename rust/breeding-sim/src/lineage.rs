//! Ce qu'un croisement rend quand il ne rend pas la génération visée.
//!
//! Port de `src/lib/dofus/breeding/lineage.ts`. La loi y est défendue sur huit
//! relevés en jeu (issue #49) ; on ne la re-justifie pas ici, on la reproduit.
//! Le rappel utile tient en trois lignes :
//!
//! - chaque case d'ascendance pèse sa **position** (parent 5, grand-parent 3)
//!   fois la **nature de sa couleur** (composée : divisé par 4,5) ;
//! - les parts se normalisent à l'intérieur de chaque lignée ;
//! - une monture **sans ascendance** — achetée ou capturée — prend toute la part
//!   de sa lignée.
//!
//! ## Une distribution est un petit vecteur, pas une table
//!
//! Trois cases au plus, souvent deux après fusion des doublons. Un `HashMap`
//! y coûterait plus en hachage qu'en recherche, et surtout il perdrait l'**ordre
//! d'insertion** — que la `Map` du TS conserve, et dont dépend l'ordre des
//! additions flottantes. On garde donc un `Vec` balayé linéairement : plus
//! rapide, et bit à bit identique au TS.

use crate::trees::{Catalog, ColorId};

/// Poids de position : le parent pèse 5, chaque grand-parent 3.
pub const PARENT_WEIGHT: f64 = 5.0;
pub const GRANDPARENT_WEIGHT: f64 = 3.0;

/// Ce qu'une couleur composée conserve de son poids : deux neuvièmes, soit une
/// division par 4,5. Mesuré dans les deux sens sur les relevés 4 et 8.
pub const COMPOSITE_FACTOR: f64 = 2.0 / 9.0;

/// Part de la masse d'échec qui revient à chaque lignée, **hors recombinaison
/// croisée**. Voir `mating_outcomes`, qui divise par `2 + w` dès qu'il y en a.
pub const LINEAGE_SHARE: f64 = 0.5;

/// Les parts d'une lignée, cases cumulées, sommant à 1. Trois entrées au plus.
pub type Shares = Vec<(ColorId, f64)>;

/// Le poids d'une case, position et composition combinées.
#[inline]
pub fn slot_weight(position: f64, composite: bool) -> f64 {
    position * if composite { COMPOSITE_FACTOR } else { 1.0 }
}

/// Accumule dans un vecteur-association en conservant l'ordre d'insertion.
///
/// La somme est faite **après** division, comme en TS : une couleur qui occupe
/// deux cases y reçoit `w1/total + w2/total` et non `(w1+w2)/total`. Les deux
/// ne diffèrent qu'au dernier bit, mais la porte de parité compare au
/// milliardième et on ne veut pas avoir à se demander d'où vient l'écart.
#[inline]
fn accumulate(shares: &mut Shares, color: ColorId, share: f64) {
    for entry in shares.iter_mut() {
        if entry.0 == color {
            entry.1 += share;
            return;
        }
    }
    shares.push((color, share));
}

/// Les parts d'une lignée.
///
/// C'est elle qui rend la **purification** lisible : croiser une couleur avec
/// elle-même donne un bébé dont les deux grands-parents portent la même
/// couleur, si bien que leurs poids se cumulent sur une seule entrée. La lignée
/// cesse de s'éparpiller — et comme la couleur cible suit les poids de la
/// lignée d'en face, le tirage se concentre au lieu de se diluer.
pub fn lineage_distribution(
    catalog: &Catalog,
    parent: ColorId,
    grandparents: Option<[ColorId; 2]>,
) -> Shares {
    let mut shares: Shares = Vec::with_capacity(3);

    // Sans ascendance connue — monture achetée ou capturée — le parent prend
    // tout.
    let Some(grandparents) = grandparents else {
        shares.push((parent, 1.0));
        return shares;
    };

    let weights = [
        (parent, slot_weight(PARENT_WEIGHT, catalog.is_composite(parent))),
        (
            grandparents[0],
            slot_weight(GRANDPARENT_WEIGHT, catalog.is_composite(grandparents[0])),
        ),
        (
            grandparents[1],
            slot_weight(GRANDPARENT_WEIGHT, catalog.is_composite(grandparents[1])),
        ),
    ];

    let total: f64 = weights.iter().map(|(_, w)| w).sum();
    if total <= 0.0 {
        shares.push((parent, 1.0));
        return shares;
    }

    for (color, weight) in weights {
        accumulate(&mut shares, color, weight / total);
    }
    shares
}

/// À quel point une lignée est concentrée, entre 0 et 1 : la part de sa couleur
/// la mieux dotée.
///
/// Une lignée purifiée — les deux grands-parents de la couleur du parent —
/// monte à 1. Une lignée éparpillée sur une couleur simple plafonne à 15/19, et
/// une couleur composée à 10/64.
pub fn lineage_purity(shares: &Shares) -> f64 {
    shares.iter().map(|(_, s)| *s).fold(0.0, f64::max)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::trees::muldo;

    /// Les trois configurations mesurées de `lineage.ts`, reproduites au
    /// centième. Ce sont les relevés en jeu de l'issue #49 : s'ils tombent, le
    /// port a changé la loi, pas seulement le langage.
    #[test]
    fn les_trois_configurations_mesurees() {
        let catalog = muldo();
        let simple = catalog.id_of("dore").expect("dore, gen 1, simple");
        let autre_simple = catalog.id_of("amande").expect("amande, gen 3, simple");
        let compose = catalog.id_of("dore_amande").expect("gen 4, composée");
        let autre_compose = catalog.id_of("dore_ebene").expect("gen 4, composée");

        // parent simple, grands-parents composés : 78,95 % / 10,53 % / 10,53 %
        let shares = lineage_distribution(&catalog, simple, Some([compose, autre_compose]));
        assert!((shares[0].1 - 0.7895).abs() < 1e-4, "{shares:?}");
        assert!((shares[1].1 - 0.1053).abs() < 1e-4, "{shares:?}");

        // parent simple, grands-parents simples : 45,45 % / 27,27 % / 27,27 %
        let shares = lineage_distribution(&catalog, simple, Some([autre_simple, compose]));
        assert!(shares[0].1 > 0.0);
        let shares = lineage_distribution(
            &catalog,
            simple,
            Some([autre_simple, catalog.id_of("ebene").expect("gen 1")]),
        );
        assert!((shares[0].1 - 0.4545).abs() < 1e-4, "{shares:?}");
        assert!((shares[1].1 - 0.2727).abs() < 1e-4, "{shares:?}");

        // parent composé, grands-parents simples : 15,63 % / 42,19 % / 42,19 %
        let shares = lineage_distribution(&catalog, compose, Some([simple, autre_simple]));
        assert!((shares[0].1 - 0.1563).abs() < 1e-4, "{shares:?}");
        assert!((shares[1].1 - 0.4219).abs() < 1e-4, "{shares:?}");
    }

    #[test]
    fn sans_ascendance_le_parent_prend_tout() {
        let catalog = muldo();
        let dore = catalog.id_of("dore").expect("existe");
        let shares = lineage_distribution(&catalog, dore, None);
        assert_eq!(shares, vec![(dore, 1.0)]);
    }

    #[test]
    fn la_purification_concentre_la_lignee() {
        // Deux grands-parents de la couleur du parent : les poids se cumulent
        // sur une seule entrée, la lignée atteint 1.
        let catalog = muldo();
        let indigo = catalog.id_of("indigo").expect("gen 1");
        let shares = lineage_distribution(&catalog, indigo, Some([indigo, indigo]));
        assert_eq!(shares.len(), 1);
        assert!((lineage_purity(&shares) - 1.0).abs() < 1e-12);
    }

    #[test]
    fn toute_distribution_somme_a_un() {
        let catalog = muldo();
        for parent in 0..catalog.len() as ColorId {
            for gp in [None, Some([0, 1]), Some([parent, parent])] {
                let shares = lineage_distribution(&catalog, parent, gp);
                let sum: f64 = shares.iter().map(|(_, s)| s).sum();
                assert!((sum - 1.0).abs() < 1e-12, "{parent} {gp:?} → {sum}");
            }
        }
    }
}
