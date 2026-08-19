//! Compter ce qu'une politique propose de **stérile**, au sens propre.
//!
//! Un croisement dont aucune couleur ne nomme la génération visée ne rend rien :
//! le jeu l'affiche « rien à gagner », zéro géneton, et les deux parents sont
//! définitivement stériles. Relevé en jeu sur un `Doré-Amande [Amande, Amande] ×
//! Doré anonyme` proposé par le champion — la fenêtre annonce Doré 35,16 %,
//! Doré-Amande 35,16 %, Amande 29,67 %, et rien d'autre.
//!
//! Le simulateur, lui, le **récompense** : `Census::apply_crossing` crédite
//! `expected_value`, soit ici ~46 000 kamas d'espérance de liquidation, pour un
//! coût marginal nul — le chargement est forfaitaire et un stérile vaut autant
//! qu'un fécond au recensement. Une montée de colline qui n'accepte que les
//! améliorations strictes accepte donc ce croisement-là.
//!
//! Ce module ne corrige rien. Il **mesure** : quelle part de ce qu'une politique
//! propose ne pouvait rien rapporter. C'est le chiffre qui dit si l'écart entre
//! un score de simulation et l'impression en jeu est une illusion d'optique ou
//! une vraie fuite.

use crate::economy::{Policy, Rng, Strategy, UnitPlan, UnitView};
use crate::pairing::pair_outlook;

/// Ce qu'un audit a vu passer.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Tally {
    /// Croisements proposés, tous confondus.
    pub crossings: usize,
    /// Ceux dont la génération visée n'est nommée par aucune couleur : le jeu
    /// dit « rien à gagner ».
    pub barren: usize,
    /// Ceux dont la cible est **plafonnée** : elle vaut la génération que le
    /// couple porte déjà, donc le poulain ne peut pas la dépasser.
    ///
    /// Ce compteur s'appelait `impossible` et comptait tout autre chose — les
    /// couples que `pair_outlook` refusait au-dessus du plafond. Le jeu ne les
    /// refuse pas, il les plafonne (issue #185), donc ils existent et se jouent :
    /// la fenêtre est pleine, seulement elle ne monte pas.
    ///
    /// **Ce n'est du gâchis que pour qui grimpe.** Une politique qui monte y perd
    /// deux fécondités pour rester au même barreau ; la boucle du sommet, elle,
    /// ne fait que ça et c'est sa production — voir `Summit::Duplicate`. Le
    /// compteur ne tranche pas entre les deux, il compte ; `wasted_share`, lui,
    /// suppose qu'on grimpe et sur-compte donc dès que la boucle tourne.
    pub capped: usize,
    /// L'effectif de l'écurie à la **dernière** fournée vue.
    ///
    /// Un stérile ne s'accouple plus, mais le recensement le compte à plein
    /// prix — `Census::of` crédite `value_of` sans regarder `fertile`. Une
    /// politique peut donc gonfler son score en **accumulant** des montures
    /// qu'elle a rendues inutiles, et le score seul ne le montre pas.
    pub headcount: usize,
    pub steriles: usize,
    /// Ce que ces stériles pèsent à la liquidation.
    pub sterile_value: i64,
}

impl Tally {
    /// Part des croisements qui ne pouvaient rien rapporter, **pour qui grimpe**.
    ///
    /// Compte `capped` comme perdu, ce qui est faux dès que la boucle du sommet
    /// tourne : là, les croisements plafonnés sont la production. Lire ce chiffre
    /// sur une politique qui duplique, c'est lire son rendement comme un déchet.
    pub fn wasted_share(&self) -> f64 {
        if self.crossings == 0 {
            return 0.0;
        }
        (self.barren + self.capped) as f64 / self.crossings as f64
    }
}

/// Enveloppe une politique et compte ce qu'elle propose sans rien changer.
pub struct Audit<P: Policy> {
    inner: P,
    pub tally: Tally,
}

impl<P: Policy> Audit<P> {
    pub fn new(inner: P) -> Self {
        Self {
            inner,
            tally: Tally::default(),
        }
    }
}

impl<P: Policy> Policy for Audit<P> {
    fn name(&self) -> &str {
        self.inner.name()
    }

    fn strategy(&self, unit: usize) -> Strategy {
        self.inner.strategy(unit)
    }

    fn plan(&mut self, view: &UnitView<'_>, rng: &mut Rng) -> UnitPlan {
        let plan = self.inner.plan(view, rng);

        // La dernière vue gagne : c'est celle qui approche le plus l'écurie
        // liquidée en fin de partie.
        self.tally.headcount = view.stable.len();
        self.tally.steriles = view.stable.mounts.iter().filter(|m| !m.fertile).count();
        self.tally.sterile_value = view
            .stable
            .mounts
            .iter()
            .filter(|m| !m.fertile)
            .map(|m| view.economy.value_of(view.catalog, m.color))
            .sum();

        for &[male, female] in &plan.crossings {
            // Les achats sont indexés au-delà de l'écurie : ils n'existent pas
            // encore, et ce sont des gen 1 anonymes. On les reconstruit plutôt
            // que de les ignorer, sans quoi l'audit raterait exactement les
            // croisements que la politique compose avec ce qu'elle achète.
            let mate = |index: usize| -> Option<crate::pairing::Mate> {
                if let Some(mount) = view.stable.mounts.get(index) {
                    return Some(mount.mate());
                }
                let bought = index - view.stable.len();
                plan.purchases
                    .get(bought)
                    .map(|&(color, _)| crate::pairing::Mate {
                        color,
                        level: view.economy.mount_level,
                        parents: None,
                    })
            };

            let (Some(male), Some(female)) = (mate(male), mate(female)) else {
                continue;
            };
            self.tally.crossings += 1;
            let outlook = pair_outlook(view.catalog, &male, &female);
            if outlook.target_colors.is_empty() {
                self.tally.barren += 1;
            } else if !outlook.climbs() {
                self.tally.capped += 1;
            }
        }

        plan
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::Prices;
    use crate::economy::{genetons_for_crossing, play};
    use crate::ladder::{LadderPolicy, Route, Summit};
    use crate::trees::muldo;

    /// L'échelle ne propose **jamais** un croisement sans cible : c'est
    /// exactement ce que sa règle d'admissibilité écarte.
    ///
    /// Les deux compteurs ne disent plus la même chose depuis que la boucle du
    /// sommet existe, et c'est tout l'objet de les avoir séparés :
    ///
    /// - `barren` — une cible que personne ne nomme — reste **zéro dans les deux
    ///   régimes**. Rien ne justifie jamais de brûler deux fécondités pour une
    ///   recopie ;
    /// - `capped` — une cible plafonnée — vaut zéro quand la boucle dort, et
    ///   compte les croisements du sommet quand elle tourne. Ce n'est plus du
    ///   gâchis mais la production, donc `wasted_share` sur-compte dès que
    ///   `Summit::Duplicate` est en jeu.
    #[test]
    fn l_echelle_ne_propose_aucun_croisement_sterile() {
        let catalog = muldo();
        let economy = Prices::load_default().expect("economy.toml").economy;
        let mut capped_when_duplicating = 0;
        let mut capped_when_targeting = 0;
        for seed in 0..25 {
            for summit in [Summit::Hold, Summit::Target, Summit::Duplicate] {
                let mut audit = Audit::new(
                    LadderPolicy::new(&catalog, Route::default()).with_summit(summit),
                );
                play(&catalog, &economy, &mut audit, seed);
                assert!(
                    audit.tally.crossings > 0,
                    "graine {seed} / {summit:?} : rien n'a été tenté"
                );
                assert_eq!(
                    audit.tally.barren, 0,
                    "graine {seed} / {summit:?} : {:?}",
                    audit.tally
                );
                match summit {
                    Summit::Hold => assert_eq!(
                        audit.tally.capped, 0,
                        "graine {seed} : le sommet dort, rien ne doit être plafonné — {:?}",
                        audit.tally
                    ),
                    Summit::Target => capped_when_targeting += audit.tally.capped,
                    Summit::Duplicate => capped_when_duplicating += audit.tally.capped,
                }
            }
        }
        assert!(
            capped_when_duplicating > 0,
            "la boucle du sommet n'a proposé aucun croisement plafonné : elle ne tourne pas"
        );
        // `Target` est un **sous-ensemble strict** de `Duplicate` : elle ne retient
        // que les croisements nommant une couleur de `ladder.summit`, là où la
        // boucle du forum prend n'importe quelle gen 10. L'inégalité est ce qui
        // distingue les deux réglages ; à égalité, `Target` n'aurait rien filtré et
        // ouvrirait la boucle que #225 dit laisser éteinte.
        assert!(
            capped_when_targeting <= capped_when_duplicating,
            "le sommet ciblé ({capped_when_targeting}) doit rester sous la boucle \
             entière ({capped_when_duplicating})"
        );
    }

    /// L'arithmétique sur laquelle repose la règle de moisson de `ladder.rs`.
    ///
    /// « Les plus gros couples possible » maximise le rendement par croisement
    /// et le gaspille par monture rare. Ce test épingle les deux faits qui le
    /// montrent, pour qu'un changement de barème ou de prix casse la règle
    /// bruyamment au lieu de la laisser devenir fausse en silence.
    #[test]
    fn le_bareme_est_domine_par_le_plus_haut_parent() {
        let economy = Prices::load_default().expect("economy.toml").economy;
        assert!(
            economy.geneton_value > 0.0,
            "génétons non monnayés : la moisson n'a plus d'objet"
        );

        // 1. Le partenaire ne pèse presque rien : une gen 1 à 1 000 kamas rend
        //    déjà 94 % de ce qu'apporte une gen 5 en face d'une gen 9.
        let with_cheap = genetons_for_crossing(9, 1, true) as f64;
        let with_rich = genetons_for_crossing(9, 5, true) as f64;
        assert!(
            with_cheap / with_rich > 0.94,
            "gen 9 x gen 1 rend {with_cheap}, gen 9 x gen 5 rend {with_rich}"
        );

        // 2. Donc, par gen 9 dépensée — chacune n'a qu'une fécondité — étaler
        //    sur des gen 1 bat de loin l'appariement de deux gen 9.
        let rate = economy.success_rate(economy.mount_level, false);
        let per_rare = |partner: u8, rares: f64| {
            let genetons = genetons_for_crossing(9, partner, true) as f64;
            rate * (economy.top_value as f64 + genetons * economy.geneton_value) / rares
        };
        assert!(
            per_rare(1, 1.0) > 1.5 * per_rare(9, 2.0),
            "gen 9 x gen 1 rend {:.0} par gen 9, gen 9 x gen 9 rend {:.0}",
            per_rare(1, 1.0),
            per_rare(9, 2.0)
        );
    }
}
