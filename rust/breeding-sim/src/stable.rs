//! L'écurie : ce que l'éleveur a en main, et ce qu'on peut en faire.
//!
//! ## Les trois états, et le mot qui prêtait à confusion
//!
//! ```text
//! fertile --(cycle de jauges, en enclos)--> féconde --(accouplement)--> stérile
//! ```
//!
//! Les deux premiers sont **disponibles** : les deux finiront par s'accoupler. Ce
//! qui les sépare est le cycle de fécondité — sérénité alignée, stats montées à
//! l'extrême — qu'une féconde a déjà payé et qu'une fertile devra payer avant de
//! servir. Une féconde qui n'est pas accouplée le reste : **la fécondité ne se
//! perd qu'à la naissance**, ni par le temps ni par une montée de niveau.
//!
//! Ce fichier écrivait « fécond » pour ce que `stable.ts` appelle *fertile*, et
//! réservait donc le mot du jeu à autre chose que ce que le jeu désigne. Comme les
//! deux implémentations doivent porter les mêmes règles, elles doivent d'abord
//! porter les mêmes mots : `fertile` dit « lui reste sa reproduction », `cycled`
//! dit « son cycle est payé ».
//!
//! ## La fécondité est le vrai capital
//!
//! Une monture qui sert de parent devient **stérile définitivement**. Le jeu
//! n'offre qu'un recyclage, le clonage, et il consomme deux stériles pour en
//! rendre une fertile. Donc chaque monture porte exactement **une** reproduction,
//! et laisser une monture de côté n'est pas une place gaspillée : c'est une
//! reproduction mise en réserve.
//!
//! C'est ce qui justifie de sous-remplir une fournée. Vingt-trois croisements
//! maintenant peuvent valoir mieux que vingt-cinq si les deux places gardées
//! trouvent un meilleur partenaire au tour suivant — et c'est exactement le
//! raisonnement que la politique actuelle ne sait pas tenir, puisqu'elle prend
//! les meilleurs coups jusqu'à saturation.
//!
//! ## Le vrac du TypeScript n'est pas porté
//!
//! `stable.ts` sépare le *vrac* (des comptes par couleur, pour les gen 1 achetées)
//! des *individus*. C'est une commodité d'interface : le joueur ne veut pas saisir
//! cinquante gen 1 une par une. Le simulateur n'a pas ce problème et gagne à tout
//! traiter pareil ; le repli par signature de `groups()` rend de toute façon
//! l'efficacité que le vrac cherchait.

use std::collections::HashMap;

use crate::pairing::{Mate, MateSignature, mate_signature};
use crate::trees::{Catalog, ColorId};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Sex {
    Male,
    Female,
}

impl Sex {
    #[inline]
    pub fn other(self) -> Self {
        match self {
            Sex::Male => Sex::Female,
            Sex::Female => Sex::Male,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Mount {
    pub color: ColorId,
    pub sex: Sex,
    pub level: u16,
    /// Faux dès qu'elle a servi de parent. Ne redevient jamais vrai autrement
    /// que par clonage.
    pub fertile: bool,
    /// Le cycle de fécondité est payé : la monture est **féconde** au sens du jeu,
    /// donc accouplable sans repasser par les jauges.
    ///
    /// Ne se perd qu'à la naissance. Une féconde qu'on laisse de côté le reste, et
    /// la remonter en niveau ne l'annule pas — c'est ce qui permet de féconder au
    /// niveau 1 maintenant et de monter plus tard, ou l'inverse.
    pub cycled: bool,
    /// Couleurs des deux ascendants, `None` pour une monture achetée.
    pub parents: Option<[ColorId; 2]>,
}

impl Mount {
    #[inline]
    pub fn mate(&self) -> Mate {
        Mate {
            color: self.color,
            level: self.level,
            parents: self.parents,
        }
    }

    #[inline]
    pub fn signature(&self) -> MateSignature {
        mate_signature(&self.mate())
    }

    /// La génération que la monture **porte**, ascendance comprise.
    ///
    /// Ce n'est pas sa couleur : une gen 1 dont un parent est gen 9 porte un 9,
    /// et c'est elle qui ouvre la gen 10. Confondre les deux fait jeter les
    /// montures les plus précieuses de l'écurie — c'est tout l'objet de #59.
    #[inline]
    pub fn carried_generation(&self, catalog: &Catalog) -> u8 {
        let own = catalog.generation(self.color);
        match self.parents {
            None => own,
            Some([a, b]) => own.max(catalog.generation(a)).max(catalog.generation(b)),
        }
    }
}

#[derive(Clone, Debug, Default)]
pub struct Stable {
    pub mounts: Vec<Mount>,
}

/// Des montures interchangeables du point de vue de l'appariement, et leurs
/// indices dans l'écurie.
///
/// Le repli n'est pas une optimisation mais la bonne unité de raisonnement :
/// deux montures de même couleur, même ascendance et même sexe visent
/// exactement la même chose. Les déplier ferait des milliers de paires
/// identiques à évaluer, et c'est le coût dominant de toute la simulation.
#[derive(Clone, Debug)]
pub struct MateGroup {
    pub signature: MateSignature,
    pub sex: Sex,
    /// Une représentante, la mieux montée du groupe.
    pub sample: Mate,
    /// Les indices, pour que l'allocation sache quoi consommer.
    pub members: Vec<usize>,
}

impl Stable {
    pub fn new() -> Self {
        Self::default()
    }

    #[inline]
    pub fn len(&self) -> usize {
        self.mounts.len()
    }

    #[inline]
    pub fn is_empty(&self) -> bool {
        self.mounts.is_empty()
    }

    #[inline]
    pub fn push(&mut self, mount: Mount) -> usize {
        self.mounts.push(mount);
        self.mounts.len() - 1
    }

    /// La plus haute génération **portée** par une monture qui lui reste sa
    /// reproduction.
    ///
    /// Restreint aux fertiles exprès : une stérile ne peut plus rien produire,
    /// donc la frontière qu'elle porterait est une frontière morte. On l'avait
    /// oublié une fois, et la politique croyait pouvoir composer un étage dont
    /// tous les ingrédients étaient épuisés.
    ///
    /// En revanche on **ne** demande pas qu'elle soit féconde : un cycle non payé
    /// est une dépense à venir, pas une impossibilité. Exiger `cycled` ici ferait
    /// disparaître la frontière à chaque fois que l'écurie vient de se renouveler,
    /// et la politique croirait avoir régressé.
    pub fn frontier(&self, catalog: &Catalog) -> u8 {
        self.mounts
            .iter()
            .filter(|m| m.fertile)
            .map(|m| m.carried_generation(catalog))
            .max()
            .unwrap_or(0)
    }

    /// La plus haute génération réellement possédée, fécondité mise à part.
    /// C'est celle qui compte à la liquidation.
    pub fn top_generation(&self, catalog: &Catalog) -> u8 {
        self.mounts
            .iter()
            .map(|m| catalog.generation(m.color))
            .max()
            .unwrap_or(0)
    }

    /// Toutes celles qui gardent leur reproduction, fécondes ou non.
    ///
    /// C'est la base de l'énumération des paires, et ça reste juste après le
    /// découplage : **un croisement peut employer n'importe quelle fertile**. Ce
    /// que l'état change n'est pas l'éligibilité mais le **prix** — une fertile
    /// non cyclée coûte une place d'enclos, une féconde n'en coûte aucune. Voir
    /// `Action::Cross` dans `search.rs`.
    pub fn fertile_groups(&self) -> Vec<MateGroup> {
        self.groups_where(|mount| mount.fertile)
    }

    /// Celles qu'un passage en enclos peut rendre fécondes : fertiles non cyclées.
    ///
    /// C'est ce qu'`Action::Cycle` consomme. Une monture déjà féconde n'a rien à y
    /// gagner — la remettre en enclos serait payer deux fois — et une stérile n'a
    /// plus de reproduction à armer.
    pub fn cyclable_groups(&self) -> Vec<MateGroup> {
        self.groups_where(|mount| mount.fertile && !mount.cycled)
    }

    /// Le repli par signature et sexe, sur le sous-ensemble qu'on lui donne.
    fn groups_where(&self, keep: impl Fn(&Mount) -> bool) -> Vec<MateGroup> {
        let mut index: HashMap<(MateSignature, Sex), usize> = HashMap::new();
        let mut groups: Vec<MateGroup> = Vec::new();

        for (position, mount) in self.mounts.iter().enumerate() {
            if !keep(mount) {
                continue;
            }
            let key = (mount.signature(), mount.sex);
            match index.get(&key) {
                Some(&at) => {
                    let group: &mut MateGroup = &mut groups[at];
                    group.members.push(position);
                    // La mieux montée représente le groupe : le taux croît avec
                    // le niveau, donc c'est elle qui répond à « est-ce que ça
                    // vaut le coup ».
                    if mount.level > group.sample.level {
                        group.sample = mount.mate();
                    }
                }
                None => {
                    index.insert(key, groups.len());
                    groups.push(MateGroup {
                        signature: key.0,
                        sex: mount.sex,
                        sample: mount.mate(),
                        members: vec![position],
                    });
                }
            }
        }

        groups
    }

    /// Les indices des montures stériles, par génération affichée.
    ///
    /// Le clonage n'apparie que des stériles de **même génération affichée** —
    /// pas de même couleur. C'est ce qui le rend praticable : sinon on
    /// n'aurait presque jamais deux stériles compatibles.
    pub fn steriles_by_generation(&self, catalog: &Catalog) -> HashMap<u8, Vec<usize>> {
        let mut by_generation: HashMap<u8, Vec<usize>> = HashMap::new();
        for (position, mount) in self.mounts.iter().enumerate() {
            if mount.fertile {
                continue;
            }
            by_generation
                .entry(catalog.generation(mount.color))
                .or_default()
                .push(position);
        }
        by_generation
    }

    /// Retire les montures désignées, en une passe.
    ///
    /// Les indices sont invalidés par toute suppression, d'où le marquage
    /// plutôt qu'un `remove` en boucle — qui a l'air correct et décale
    /// silencieusement tout ce qui suit.
    pub fn remove_all(&mut self, positions: &[usize]) {
        if positions.is_empty() {
            return;
        }
        let mut doomed = vec![false; self.mounts.len()];
        for &position in positions {
            doomed[position] = true;
        }
        let mut index = 0;
        self.mounts.retain(|_| {
            let keep = !doomed[index];
            index += 1;
            keep
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::trees::muldo;

    fn mount(catalog: &Catalog, slug: &str, sex: Sex, parents: Option<[&str; 2]>) -> Mount {
        Mount {
            color: catalog.id_of(slug).unwrap_or_else(|| panic!("{slug}")),
            sex,
            level: 67,
            fertile: true,
            // Fécondes par défaut dans les tests : ce qui s'y vérifie porte sur
            // l'appariement, pas sur le financement du cycle.
            cycled: true,
            parents: parents.map(|[a, b]| {
                [catalog.id_of(a).unwrap(), catalog.id_of(b).unwrap()]
            }),
        }
    }

    #[test]
    fn la_generation_portee_n_est_pas_la_couleur() {
        let catalog = muldo();
        // Une gen 1 née d'un croisement gen 9 manqué : sa couleur dit 1, son
        // ascendance dit 9, et c'est elle qui ouvre la gen 10.
        let porteuse = mount(&catalog, "dore", Sex::Male, Some(["ambre", "dore"]));
        assert_eq!(catalog.generation(porteuse.color), 1);
        assert_eq!(porteuse.carried_generation(&catalog), 9);

        let anonyme = mount(&catalog, "dore", Sex::Male, None);
        assert_eq!(anonyme.carried_generation(&catalog), 1);
    }

    #[test]
    fn la_frontiere_ignore_les_steriles() {
        let catalog = muldo();
        let mut stable = Stable::new();
        stable.push(mount(&catalog, "dore", Sex::Male, None));
        let mut haute = mount(&catalog, "dore", Sex::Female, Some(["ambre", "dore"]));
        haute.fertile = false;
        stable.push(haute);

        // La gen 9 est là, mais elle est stérile : la frontière reste à 1.
        assert_eq!(stable.frontier(&catalog), 1);
        // Elle compte quand même à la liquidation.
        assert_eq!(stable.top_generation(&catalog), 1);
    }

    #[test]
    fn le_repli_regroupe_ce_qui_vise_pareil() {
        let catalog = muldo();
        let mut stable = Stable::new();
        for _ in 0..3 {
            stable.push(mount(&catalog, "dore", Sex::Male, None));
        }
        stable.push(mount(&catalog, "dore", Sex::Female, None));
        // Même couleur, ascendance différente : un autre groupe.
        stable.push(mount(&catalog, "dore", Sex::Male, Some(["dore", "amande"])));

        let groups = stable.fertile_groups();
        assert_eq!(groups.len(), 3);
        let biggest = groups.iter().map(|g| g.members.len()).max().unwrap();
        assert_eq!(biggest, 3, "les trois gen 1 mâles identiques ne font qu'un groupe");
    }

    #[test]
    fn retirer_plusieurs_montures_ne_decale_rien() {
        let catalog = muldo();
        let mut stable = Stable::new();
        for slug in ["dore", "amande", "indigo", "ambre", "ebene"] {
            stable.push(mount(&catalog, slug, Sex::Male, None));
        }
        stable.remove_all(&[0, 2, 4]);
        let restants: Vec<&str> = stable
            .mounts
            .iter()
            .map(|m| catalog.slug(m.color))
            .collect();
        assert_eq!(restants, vec!["amande", "ambre"]);
    }
}
