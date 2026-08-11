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
    /// Ceux dont la cible est hors du catalogue — au-dessus du plafond de la
    /// famille. `pair_outlook` refuse alors de répondre.
    pub impossible: usize,
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
    /// Part des croisements qui ne pouvaient rien rapporter.
    pub fn wasted_share(&self) -> f64 {
        if self.crossings == 0 {
            return 0.0;
        }
        (self.barren + self.impossible) as f64 / self.crossings as f64
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
            match pair_outlook(view.catalog, &male, &female) {
                None => self.tally.impossible += 1,
                Some(outlook) if outlook.target_colors.is_empty() => self.tally.barren += 1,
                Some(_) => {}
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
    use crate::ladder::{LadderPolicy, Route};
    use crate::trees::muldo;

    /// L'échelle ne propose **jamais** un croisement sans cible : c'est
    /// exactement ce que sa règle d'admissibilité écarte.
    #[test]
    fn l_echelle_ne_propose_aucun_croisement_sterile() {
        let catalog = muldo();
        let economy = Prices::load_default().expect("economy.toml").economy;
        for seed in 0..25 {
            let mut audit = Audit::new(LadderPolicy::new(&catalog, Route::Shared));
            play(&catalog, &economy, &mut audit, seed);
            assert!(
                audit.tally.crossings > 0,
                "graine {seed} : rien n'a été tenté"
            );
            assert_eq!(
                audit.tally.barren + audit.tally.impossible,
                0,
                "graine {seed} : {:?}",
                audit.tally
            );
        }
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
