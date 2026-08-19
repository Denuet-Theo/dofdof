//! L'économie fermée, et la partie qui se joue dedans.
//!
//! Elle remplace intégralement `costs.ts` — mangeoire, optimakina, carburant,
//! taxe HDV, génétons. Ce n'est pas une simplification par paresse : ce qu'on
//! cherche est la **politique d'appariement**, et une économie à sept leviers
//! rend impossible d'attribuer un gain à l'un d'eux.
//!
//! ## Deux unités de production, et un temps mural
//!
//! Le parc n'avance plus « fournée par fournée » mais **d'événement en
//! événement** : la prochaine unité qui se libère rend ses bébés et se recharge.
//!
//! - **l'unité synchrone** groupe plusieurs enclos qui démarrent et finissent
//!   ensemble, avec les mêmes réglages. C'est le bloc qu'on surveille.
//! - **les unités libres** portent un enclos chacune, avec leurs propres bandes,
//!   leur propre niveau de Mangeoire et leur propre durée.
//!
//! Le découpage est une **contrainte d'usage** et non une règle du jeu : rien
//! n'empêcherait de piloter les six enclos séparément, et le calcul le
//! favoriserait même — nourrir dix montures au niveau 150 coûte 250 000 contre
//! 2 447 000 pour cinquante. Mais six rythmes différents demandent une
//! intervention toutes les trois minutes, et une politique inexécutable ne vaut
//! rien. Deux unités sont tenables et gardent l'essentiel du gain : l'unité
//! libre peut payer un niveau élevé pour quelques paires de haute génération
//! sans que tout le parc le paie.
//!
//! ## La spécification
//!
//! | Élément | Valeur |
//! | --- | --- |
//! | Capital de départ | 10 000 000, plancher à 0 |
//! | Écurie de départ | 100 muldos tirés en gen 2 à 9, généalogie comprise |
//! | Horizon | 300 heures de temps mural |
//! | Prix d'un chargement | jauges + Mangeoire, par enclos, selon les bandes |
//! | Gen 1 anonyme | 1 000, quantité libre, sans ascendance |
//! | Clonage | gratuit |
//! | Sacrifice d'une gen `g ≥ 2` | `g × 20 000` |
//! | Gen 1 | **0** — elle ne s'extrait pas |
//! | Gen 10 | 500 000 |
//!
//! ## Pourquoi la gen 1 vaut zéro
//!
//! D'abord parce que c'est la règle du jeu : on n'extrait pas d'ambre d'une
//! génération 1. Et accessoirement parce que c'est ce qui referme une boucle de
//! monnaie infinie — un gen 1 s'achète 1 000, et s'il rendait ses 20 000 les
//! 10 M de départ achèteraient 10 000 têtes qui en rendraient 200 M. Une
//! politique cherchée par évolution aurait trouvé ça en quelques générations et
//! n'aurait plus jamais élevé quoi que ce soit.
//!
//! ## Pourquoi cent montures au départ
//!
//! Une partie qui commence à zéro passe l'essentiel de son temps dans les basses
//! générations, donc c'est là que l'entraînement porterait. On amorce avec cent
//! montures tirées en génération 2 à 9, généalogie comprise et **jouable** :
//! elle est tirée dans les recettes de leur propre couleur, donc une monture de
//! génération `g` a bien deux parents dont le rang maximal vaut `g − 1`.
//!
//! Conséquence : le plancher « ne rien faire » ne vaut pas 10 M mais 10 M plus
//! la liquidation du pool.
//!
//! ## Ce que la politique voit
//!
//! L'écurie, le solde, et quelle unité se libère. **Jamais le temps écoulé**,
//! jamais l'état du générateur — c'est la contrainte posée par le mainteneur, et
//! elle est tenue par le type : `UnitView` ne porte ni l'un ni l'autre.

use crate::pairing::{
    Mate, OutcomeKind, mating_outcomes_at, pair_outlook, pair_target_generation,
};
use crate::stable::{Mount, Sex, Stable};
use crate::trees::{Catalog, ColorId};

/// Une bande de jauge : ce qu'elle coûte au point, et ce qu'elle fait gagner.
#[derive(Clone, Copy, Debug, Default)]
pub struct Band {
    pub cap: i64,
    pub hours: f64,
    pub serenity_per_point: f64,
    pub stats_per_point: f64,
}

/// Points de Mangeoire pour atteindre un niveau : `3,795 × niveau^2,329`.
///
/// Niveau 67 → 67 700 points, niveau 200 → 867 900 : treize fois plus pour faire
/// passer la réussite de 50,1 % à 90 %.
#[inline]
pub fn mount_xp_for_level(level: u16) -> f64 {
    3.795 * f64::from(level).powf(2.329)
}

pub const MAX_MOUNT_LEVEL: u16 = 200;

/// Génétons rendus par une monture de ce rang. Relevé en jeu, porté de
/// `costs.ts`. Une gen 10 n'en rend pas : elle ne peut plus s'accoupler.
const GENETONS_BY_GENERATION: [i64; 11] = [0, 1, 2, 4, 8, 15, 30, 60, 120, 250, 0];

/// Les génétons d'un croisement **réussi**.
///
/// C'est le levier le plus lourd de l'économie après la valeur des montures, et
/// il ne tombe qu'en cas de succès — un raté ne rend rien. Deux gen 9 rendent
/// 500 génétons, soit 269 000 kamas, mais à 50,1 % de réussite l'espérance vaut
/// 134 800. Le rapport entre croiser haut et croiser bas reste de 250 : deux
/// gen 1 n'en rendent que deux.
///
/// Le rendement suit les **parents directs** et non la cible : deux gen 2 visant
/// la gen 4 — parce que leur ascendance porte une gen 3 — rendent 4 génétons et
/// non 16 (relevé #59).
///
/// `climbs` est faux dans deux cas, qui n'en font qu'un : l'enfant ne **dépasse**
/// pas l'ascendance. Soit aucune couleur ne nomme la cible — purifier et recopier
/// ne rapportent rien, ce que la fenêtre affiche noir sur blanc (#68) —, soit la
/// cible est plafonnée et vaut ce que le couple porte déjà. Les trois fenêtres du
/// 14/08 montrent le second : une ligne cible pleine, et zéro géneton.
#[inline]
pub fn genetons_for_crossing(male_generation: u8, female_generation: u8, climbs: bool) -> i64 {
    if !climbs {
        return 0;
    }
    GENETONS_BY_GENERATION[usize::from(male_generation).min(10)]
        + GENETONS_BY_GENERATION[usize::from(female_generation).min(10)]
}

/// Le plafond d'unités de production. Une synchrone plus trois libres dépasse
/// déjà ce qu'un humain peut suivre.
pub const MAX_UNITS: usize = 4;

/// Les jours d'une semaine de disponibilité. Voir `Economy::availability`.
pub const DAYS_PER_WEEK: usize = 7;

/// Combien de créneaux au plus dans une journée.
///
/// Trois suffisent au relevé de l'éleveur — avant le travail, la pause de midi, la
/// soirée — et le quatrième laisse de la place sans faire grossir une structure
/// qui est `Copy` et recopiée à chaque partie.
pub const MAX_WINDOWS_PER_DAY: usize = 4;

/// Plafond de couleurs par famille. Le muldo en compte 120.
pub const MAX_COLORS: usize = 128;

/// Le réglage d'une unité : six bandes de jauge, un niveau, un seuil
/// d'Optimakina.
///
/// Il vit dans le **génome** et non dans la recherche. Une bande rapide ne se
/// justifie que par les chargements supplémentaires qu'elle laisse faire — un
/// bénéfice qui n'apparaît nulle part dans l'écurie que le chargement laisse
/// derrière lui. Une recherche guidée par la valeur d'état prendrait donc
/// toujours la bande la moins chère ; il faudrait lui montrer le temps restant,
/// ce qui revient à lui donner le numéro de tour. L'évolution, elle, note sur le
/// score final, qui compte les heures.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Strategy {
    pub bands: [usize; 6],
    pub level: u16,
    /// Acheter une Optimakina à partir de cette génération visée. 11 = jamais.
    pub optimakina_from: u8,
}

impl Default for Strategy {
    fn default() -> Self {
        Self {
            bands: [0; 6],
            level: 0,
            optimakina_from: 11,
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub struct Economy {
    pub starting_kamas: i64,
    pub starting_pool: usize,
    pub pool_generations: (u8, u8),
    /// Budget en heures. `None` = horizon en nombre de chargements.
    pub horizon_hours: Option<f64>,
    /// Quand on peut **agir**, heure par heure de la semaine.
    ///
    /// Les jauges tournent en continu — une monture monte pendant qu'on dort — mais
    /// lancer et récupérer une fournée demande d'être devant le jeu. Sans ce
    /// modèle, l'horizon est un budget d'heures qu'on dépense à volonté, ce qui
    /// suppose une disponibilité de vingt-quatre heures sur vingt-quatre.
    ///
    /// Sept jours, quatre fenêtres au plus par jour, en heures depuis minuit. Une
    /// borne haute au-delà de 24 déborde sur le lendemain : `(20.0, 26.0)` est
    /// « de 20 h à 2 h ». Une fenêtre `(0.0, 0.0)` n'existe pas.
    ///
    /// **Tout à zéro vaut disponibilité continue**, c'est-à-dire le modèle d'avant :
    /// les mesures publiées restent donc valides et le nouveau modèle est un choix
    /// explicite, pas une dérive silencieuse.
    pub availability: [[(f64, f64); MAX_WINDOWS_PER_DAY]; DAYS_PER_WEEK],
    /// Nombre de chargements, quand l'horizon n'est pas un temps.
    pub batches: u32,
    /// Ce que coûte un croisement qui n'avait **aucune chance de monter**, retiré
    /// du score final. Voir `RunOutcome::barren_crossings`.
    ///
    /// ## Pourquoi un terme de score et non une dépense
    ///
    /// Une dépense en kamas changerait la solvabilité, donc le déroulé de la
    /// partie : on ne saurait plus si un écart vient du prix posé ou du jeu
    /// différent qu'il a provoqué. Retiré du score, le malus **re-classe** les
    /// politiques sur des parties identiques — et comme la fitness de la recherche
    /// *est* le score, il devient aussi ce que la recherche évite si on réentraîne
    /// avec.
    ///
    /// **Zéro par défaut**, donc toutes les mesures publiées restent valides et
    /// facturer la stérilité est un choix explicite.
    pub barren_crossing_malus: i64,
    /// Ce qu'une fournée **réussie** rapporte quand le sommet est à un barreau.
    ///
    /// Le seul terme du réglage du rythme qui ne se déduise pas de l'économie :
    /// les fournées et le carburant se calculent, ce qu'une fournée rend dépend de
    /// la politique. Exposé plutôt que deviné, parce qu'il décide du choix de
    /// bande et qu'un chiffre caché y serait indiscutable.
    ///
    /// Calibré sur le balayage de `bin/windows` : entre la bande 0 au niveau 50 et
    /// la bande 2 au niveau 36, 59,6 fournées de plus valent 30,2 M de score plus
    /// 41,9 M de carburant, soit 1,21 M la fournée à 40,8 % de réussite — donc
    /// environ trois millions par réussite.
    ///
    /// **Ce n'est pas une constante, c'est une ancre.** Le balayage qui l'a
    /// calibrée tourne sur le pool hérité, dont la frontière est la gen 9 : le
    /// sommet y est à **un** barreau. Ce chiffre vaut donc pour cette distance-là,
    /// et `value_per_success_toward` l'amortit sur la distance réelle. Voir
    /// là-bas pour pourquoi une valeur par fournée qui ignore le chemin restant ne
    /// peut pas régler deux régimes à la fois.
    ///
    /// À rejouer quand les prix bougent : c'est un rapport entre un score et un
    /// carburant, et les deux sont dans `economy.toml`.
    pub value_per_success: i64,
    /// Prix forfaitaire d'un chargement du bloc, tant que les prix par jauge
    /// manquent.
    pub batch_cost: i64,
    pub starter_price: i64,
    pub amber_per_generation: i64,
    pub top_value: i64,
    /// Niveau par défaut, quand la stratégie n'en fixe pas.
    pub mount_level: u16,

    // --- le parc -----------------------------------------------------------
    pub slots_per_enclos: usize,
    /// Enclos groupés dans l'unité synchrone.
    pub sync_enclos: usize,
    /// Enclos pilotés séparément, un par unité libre.
    pub free_enclos: usize,

    // --- les leviers -------------------------------------------------------
    pub overhead_hours: f64,
    pub bands: [Band; 4],
    pub mangeoire_per_point: f64,
    pub mangeoire_per_mount: bool,
    /// Points d unite d Extrait de Mangeoire, 0 si le fichier ne le dit pas.
    /// Sert a la liste de courses, pas au calcul : le prix au point suffit pour
    /// arbitrer, mais on achete des Extraits, pas des points.
    pub mangeoire_points_per_unit: f64,
    pub optimakina: [i64; 11],
    pub optimakina_bonus: f64,
    /// Kamas nets qu'un géneton rapporte, taxe HDV déduite.
    pub geneton_value: f64,
    /// Bornes dans lesquelles chaque partie tire son prix du jour. Le marché
    /// bouge d'un facteur deux à trois sur un mois, et une politique réglée sur
    /// un seul point de prix serait franchement mauvaise à l'autre bout.
    pub amber_range: (i64, i64),
    pub geneton_range: (f64, f64),
    pub top_value_range: (i64, i64),
    /// Le prix de **chaque** couleur de génération 10, tiré par partie.
    ///
    /// Les cinquante ne valent pas la même chose : certaines tournent autour de
    /// 300 000, d'autres autour d'un million, sans rapport avec la génération des
    /// parents — c'est la méta et l'abondance qui décident. Quelle gen 10 on
    /// produit compte donc autant que d'en produire une, ce que le modèle
    /// ignorait complètement en les traitant comme un rang unique.
    pub top_values: [i64; MAX_COLORS],
    /// La couleur que l'éleveur **poursuit**, s'il en a une.
    ///
    /// ## Ce que ça corrige
    ///
    /// Le score est `kamas + liquidation`, donc il est **indifférent** entre
    /// cinquante-neuf gen 10 quelconques et une seule de la bonne couleur. Un
    /// éleveur, lui, poursuit une couleur précise — c'est tout l'objet de
    /// `breeding_projects` côté app, et de la couronne de l'échelle.
    ///
    /// Mesuré : sur les graines de départage, **52 % du score du glouton** est du
    /// stock de gen 10 — 58,7 montures au prix plein. Il gagne en accumulant ce
    /// que le marché n'absorbe pas et ce que personne n'a demandé.
    ///
    /// Renseignée, `play` compte ce que la partie en produit (`crown_held`), et
    /// c'est ça que la fitness note. `None` garde l'ancien barème, sans quoi
    /// toutes les mesures publiées cesseraient de se reproduire.
    pub project: Option<ColorId>,
    /// Combien l'éleveur en veut. Au-delà, une couronne de plus ne compte pas.
    ///
    /// ## Le relevé qui impose ce plafond
    ///
    /// Le mainteneur, qui joue : **300 ventes d'Azur-Doré sur le serveur en un
    /// mois**, pour des milliers de joueurs quotidiens. Soit une dizaine par jour
    /// pour tout le monde. Un éleveur qui en sort quinze dans sa partie n'en vend
    /// pas quinze : il inonde un marché qui absorbe dix par jour, prix compris.
    ///
    /// Le simulateur ne modélise pas la profondeur de marché — `value_of` paie le
    /// prix plein au centième exemplaire — donc rien d'autre ne borne la
    /// production. Ce plafond-ci est la borne du **projet** : `breeding_projects`
    /// porte un `target_count`, dix chez l'éleveur qui a fait remonter tout ça, et
    /// une couleur qu'on collectionne au-delà de ce qu'on voulait n'est plus un
    /// projet, c'est du stock.
    ///
    /// `None` ne borne rien, et c'est le défaut : sans projet, la question ne se
    /// pose pas.
    pub project_count: Option<usize>,
    /// La prime du **succès de collection**, par génération, indexée 1..=10.
    ///
    /// Le succès demande d'avoir fait naître chaque couleur de la famille **au
    /// moins une fois**. C'est donc une prime qui ne se touche qu'une fois par
    /// couleur, et pas un barème de valeur : la centième Doré ne rapporte rien de
    /// plus que la première, ce qui est exactement ce que `value_of` ne sait pas
    /// dire.
    ///
    /// ## Pourquoi la fitness et pas le plan
    ///
    /// `success.ts` mesure déjà que la collection est **hors plan** : l'échelle ne
    /// veut que 30 couleurs sur 120 en muldo, et les 90 autres ne sont sur aucune
    /// route — dont les 50 gen 10, puisqu'on n'en couronne qu'une. Le succès demande
    /// donc de produire ce que le plan ne demande pas, et le module conclut qu'aucun
    /// chemin gratuit n'y mène et que le choix de stratégie reste **bloqué** faute
    /// d'avoir chiffré ce que ça coûte.
    ///
    /// Chiffrer, c'est précisément ce qu'une prime dans la fitness fait : on ne
    /// décide pas à la main si poursuivre la collection paie, on laisse la recherche
    /// arbitrer contre le reste de l'économie.
    ///
    /// ## Un terme de score, comme le malus stérile
    ///
    /// Retiré une seule fois sur le total, jamais en cours de partie : il n'influe
    /// donc ni sur la solvabilité ni sur ce que la politique peut se permettre, et
    /// deux barèmes différents rejouent **exactement** la même partie. Ce qui change,
    /// c'est le réseau que l'évolution retient.
    ///
    /// Tout à zéro par défaut, pour que les mesures publiées ne bougent pas sous les
    /// pieds de qui n'a rien demandé.
    pub collection_bonus: [i64; 11],
    pub cycle_serenity_points: f64,
    pub cycle_stat_points: f64,
    pub band_rates: [f64; 4],
    /// Prix du point, par jauge (voir `schedule::GAUGE_NAMES`) et par bande.
    pub gauge_prices: [[f64; 4]; 6],
}

impl Default for Economy {
    fn default() -> Self {
        Self {
            starting_kamas: 10_000_000,
            starting_pool: 100,
            pool_generations: (2, 9),
            horizon_hours: None,
            availability: [[(0.0, 0.0); MAX_WINDOWS_PER_DAY]; DAYS_PER_WEEK],
            batches: 100,
            barren_crossing_malus: 0,
            value_per_success: 3_000_000,
            batch_cost: 150_000,
            starter_price: 1_000,
            amber_per_generation: 20_000,
            top_value: 600_000,
            mount_level: 67,
            slots_per_enclos: 10,
            sync_enclos: 5,
            free_enclos: 0,
            overhead_hours: 0.0,
            bands: [Band::default(); 4],
            mangeoire_per_point: 0.0,
            mangeoire_per_mount: false,
            mangeoire_points_per_unit: 0.0,
            optimakina: [0; 11],
            optimakina_bonus: 0.1,
            geneton_value: 0.0,
            amber_range: (20_000, 20_000),
            geneton_range: (0.0, 0.0),
            top_value_range: (600_000, 600_000),
            top_values: [0; MAX_COLORS],
            // Aucun projet par défaut : le barème historique, celui de toutes les
            // mesures publiées.
            project: None,
            project_count: None,
            collection_bonus: [0; 11],
            cycle_serenity_points: 15_010.0,
            cycle_stat_points: 60_000.0,
            band_rates: [1.0, 2.0, 3.0, 4.0],
            gauge_prices: [[0.0; 4]; 6],
        }
    }
}

impl Economy {
    /// Le milieu de chaque plage, qui sert de référence pour normaliser les
    /// entrées du réseau : un prix au milieu de sa fourchette vaut 1.
    #[inline]
    pub fn price_references(&self) -> (f64, f64, f64) {
        let mid = |low: f64, high: f64, fallback: f64| {
            if high > low { (low + high) / 2.0 } else { fallback.max(1.0) }
        };
        (
            mid(
                self.amber_range.0 as f64,
                self.amber_range.1 as f64,
                self.amber_per_generation as f64,
            ),
            mid(self.geneton_range.0, self.geneton_range.1, self.geneton_value),
            mid(
                self.top_value_range.0 as f64,
                self.top_value_range.1 as f64,
                self.top_value as f64,
            ),
        )
    }

    /// Des fenêtres de disponibilité ont-elles été posées ?
    ///
    /// Tout à zéro veut dire « toujours disponible », et c'est le défaut : sans ça,
    /// une économie qui oublierait de renseigner ses fenêtres deviendrait une
    /// économie où l'on ne peut jamais rien faire.
    pub fn has_windows(&self) -> bool {
        self.availability
            .iter()
            .flatten()
            .any(|&(from, to)| to > from)
    }

    /// Le premier instant à partir de `hours` où l'on peut agir.
    ///
    /// Rend `hours` tel quel quand aucune fenêtre n'est posée. Sinon avance jusqu'à
    /// l'ouverture suivante — ce qui est exactement l'attente qu'une fournée finie à
    /// quatre heures du matin impose : l'enclos est libre, mais personne n'est là
    /// pour le vider.
    ///
    /// ## Pourquoi regarder la veille
    ///
    /// Une fenêtre peut déborder — `(20.0, 26.0)` couvre jusqu'à deux heures du
    /// matin le lendemain. Un instant à minuit trente appartient donc à une fenêtre
    /// **de la veille**, et ne regarder que le jour courant le manquerait.
    ///
    /// Rend `None` au-delà de `limit`, pour qu'un appelant n'ait pas à se protéger
    /// d'une boucle sans fin quand la semaine ne contient aucune fenêtre atteignable.
    pub fn actionable(&self, hours: f64, limit: f64) -> Option<f64> {
        if !self.has_windows() {
            return Some(hours);
        }
        let day = (hours / 24.0).floor() as i64;

        // La veille d'abord, pour ses débordements, puis les jours suivants.
        let mut probe = day - 1;
        while (probe as f64) * 24.0 <= limit + 24.0 {
            let index = probe.rem_euclid(DAYS_PER_WEEK as i64) as usize;
            let base = (probe as f64) * 24.0;

            // Les fenêtres du jour, triées : l'ordre du tableau n'est pas garanti.
            let mut slots: Vec<(f64, f64)> = self.availability[index]
                .iter()
                .filter(|&&(from, to)| to > from)
                .map(|&(from, to)| (base + from, base + to))
                .collect();
            slots.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));

            for (from, to) in slots {
                if to <= hours {
                    continue;
                }
                let at = from.max(hours);
                return if at > limit { None } else { Some(at) };
            }
            probe += 1;
        }
        None
    }

    /// Combien de fournées de `hours` tiennent dans `horizon`.
    ///
    /// Sans fenêtre, c'est la division. Avec, il faut dérouler le temps : une
    /// fournée qui finit hors créneau attend, et cette attente décale toutes les
    /// suivantes. C'est ce qui fait qu'une durée un peu plus longue peut coûter
    /// bien plus qu'un peu — trente minutes de dépassement valent cinq heures.
    ///
    /// Le déroulé est le même que celui de `play`, en plus court : on ne suit qu'un
    /// enclos, ce qui suffit à comparer deux rythmes.
    pub fn loads_within(&self, horizon: f64, hours: f64) -> i64 {
        if hours <= 0.0 {
            return 0;
        }
        if !self.has_windows() {
            return (horizon / hours).floor() as i64;
        }
        let mut at = 0.0f64;
        let mut count = 0i64;
        // Borne dure : une fournée par heure au plus, donc l'horizon borne la
        // boucle même si `actionable` renvoyait toujours le même instant.
        let ceiling = horizon.ceil() as i64 + 1;
        while count < ceiling {
            let Some(start) = self.actionable(at, horizon) else {
                break;
            };
            let end = start + hours;
            if end > horizon {
                break;
            }
            count += 1;
            at = end;
        }
        count
    }

    /// Les heures où l'on peut agir sur une semaine, pour la lecture et les tests.
    pub fn weekly_hours(&self) -> f64 {
        self.availability
            .iter()
            .flatten()
            .filter(|&&(from, to)| to > from)
            .map(|&(from, to)| to - from)
            .sum()
    }

    /// L'économie d'une partie, prix du jour tirés.
    ///
    /// Les prix font partie du **monde** et non de la politique : deux
    /// politiques comparées sur la même graine affrontent le même marché.
    pub fn for_run(&self, catalog: &Catalog, draws: &Draws) -> Self {
        let mut economy = *self;
        let pick = |purpose: u32, low: f64, high: f64| -> f64 {
            if high <= low {
                return low;
            }
            low + draws.at(POOL_COORD, 0, purpose) * (high - low)
        };
        let (low, high) = self.amber_range;
        economy.amber_per_generation =
            pick(purpose::PRICE_AMBER, low as f64, high as f64).round() as i64;
        let (low, high) = self.geneton_range;
        if high > 0.0 {
            economy.geneton_value = pick(purpose::PRICE_GENETON, low, high);
        }
        let (low, high) = self.top_value_range;
        economy.top_value = pick(purpose::PRICE_TOP, low as f64, high as f64).round() as i64;

        // Un prix par couleur de gen 10, tiré indépendamment : c'est ce qui rend
        // le **choix de la couleur** stratégique et pas seulement celui du rang.
        //
        // En **cloche** et non uniformément — relevé de l'éleveur, août 2026. Voir
        // `bell_price` : un uniforme rendait une couleur à 320 000 aussi probable
        // qu'une à 600 000, ce qui n'est pas le marché et gonflait tout ce qui vit
        // des tirages extrêmes.
        let center = self.top_value;
        for color in 0..catalog.len().min(MAX_COLORS) {
            economy.top_values[color] = if catalog.generation(color as ColorId)
                >= catalog.top_generation()
            {
                bell_price(draws, color as u32, center, low, high)
            } else {
                0
            };
        }
        economy
    }

    // --- le parc -----------------------------------------------------------

    /// Unité 0 = le bloc synchrone, puis une unité par enclos libre.
    #[inline]
    pub fn unit_count(&self) -> usize {
        (1 + self.free_enclos).min(MAX_UNITS)
    }

    /// Combien d'enclos une unité porte.
    #[inline]
    pub fn unit_enclos(&self, unit: usize) -> usize {
        if unit == 0 { self.sync_enclos } else { 1 }
    }

    /// Combien de croisements une unité peut porter **si aucun parent n'est
    /// fécond**. Deux places par croisement.
    ///
    /// Reste le majorant utile — c'est le pire cas, celui d'une écurie qui doit
    /// tous ses cycles — mais ce n'est plus la contrainte : voir `unit_places`.
    #[inline]
    pub fn unit_crossings(&self, unit: usize) -> usize {
        self.unit_enclos(unit) * self.slots_per_enclos / 2
    }

    /// Les places d'enclos d'une unité, dix par enclos.
    ///
    /// C'est la vraie ressource rare. Le transfert de points se paie **à
    /// l'enclos** et les dix places en profitent également, donc une place vide
    /// est une fécondité perdue gratuitement — et c'est pour ça qu'on compte des
    /// places et non des croisements.
    #[inline]
    pub fn unit_places(&self, unit: usize) -> usize {
        self.unit_enclos(unit) * self.slots_per_enclos
    }

    /// Le parc entier, en croisements.
    #[inline]
    pub fn total_crossings(&self) -> usize {
        (0..self.unit_count()).map(|u| self.unit_crossings(u)).sum()
    }

    // --- les prix ----------------------------------------------------------

    #[inline]
    pub fn band_rate(&self, band: usize) -> f64 {
        self.band_rates[band.min(3)]
    }

    #[inline]
    pub fn gauge_price(&self, gauge: usize, band: usize) -> f64 {
        self.gauge_prices[gauge.min(5)][band.min(3)]
    }

    /// Les prix par jauge sont-ils renseignés ? Sans eux, pas d'ordonnancement.
    #[inline]
    pub fn per_gauge_prices(&self) -> bool {
        self.gauge_prices
            .iter()
            .all(|row| row.iter().any(|price| *price > 0.0))
    }

    /// Ce qu'une monture rend à la conversion.
    #[inline]
    pub fn value_of(&self, catalog: &Catalog, color: ColorId) -> i64 {
        let generation = catalog.generation(color);
        if generation >= catalog.top_generation() {
            // Le prix de la couleur si on l'a tiré, sinon le prix de référence.
            let priced = self.top_values[usize::from(color).min(MAX_COLORS - 1)];
            return if priced > 0 { priced } else { self.top_value };
        }
        self.value_at_generation(generation, catalog.top_generation())
    }

    /// Le même barème, lu sur le rang seul — le recensement de `encode.rs` n'a
    /// plus de couleur sous la main.
    #[inline]
    pub fn value_at_generation(&self, generation: u8, top_generation: u8) -> i64 {
        if generation >= top_generation {
            self.top_value
        } else if generation <= 1 {
            0
        } else {
            i64::from(generation) * self.amber_per_generation
        }
    }

    /// La **frontière** de l'écurie de départ : la plus haute génération qu'elle
    /// tient. Zéro quand il n'y a pas d'écurie du tout.
    #[inline]
    pub fn starting_frontier(&self) -> u8 {
        if self.starting_pool == 0 {
            0
        } else {
            self.pool_generations.1
        }
    }

    /// Ce qu'une fournée réussie vaut, **vu depuis l'écurie de départ**.
    ///
    /// ## Pourquoi une constante ne pouvait pas marcher
    ///
    /// Le critère de `tuned_for` est `fournées × (valeur − carburant)`, et la
    /// valeur y était `value_per_success`, un nombre fixe. Il est calibré sur le
    /// pool hérité, où cent muldos de la gen 2 à la gen 9 mettent la gen 10 à un
    /// barreau. En partant de cent gen 1, le sommet est à neuf générations : rien
    /// ne l'atteint dans l'horizon — un dixième de gen 10 sur toute la partie —
    /// donc une fournée n'y vaut presque rien, et payer 520 000 de carburant
    /// ruine la partie. Mesuré : le levier portait le pool hérité de 63,84 à
    /// 98,34 M et **effondrait** le départ de zéro de 13,80 à 5,49 M.
    ///
    /// Le même nombre ne peut pas décrire les deux. Ce qui les sépare n'est ni le
    /// prix ni l'horizon : c'est la **distance au sommet**.
    ///
    /// ## Le modèle
    ///
    /// Une fournée avance d'un cran sur un chemin qui en compte
    /// `sommet − frontière`. Ce qu'elle rapporte est donc l'ancre amortie sur ce
    /// chemin : à un barreau du sommet elle vaut l'ancre entière — c'est le régime
    /// où l'ancre a été mesurée, et la valeur y est inchangée par construction —
    /// et à neuf générations elle en vaut le neuvième.
    ///
    /// Le plancher à 1 n'est pas une garde : une écurie qui tient déjà le sommet
    /// n'a plus de chemin, et sa prochaine fournée vaut bien une fournée entière.
    #[inline]
    pub fn value_per_success_toward(&self, summit_generation: u8) -> f64 {
        let frontier = self.starting_frontier().min(summit_generation);
        let climb = f64::from(u32::from(summit_generation.saturating_sub(frontier)).max(1));
        self.value_per_success as f64 / climb
    }

    /// Le taux de réussite d'un croisement à ce niveau, Optimakina comprise.
    ///
    /// Les deux parents portent le même niveau : c'est l'enclos qu'on nourrit,
    /// pas la monture.
    #[inline]
    pub fn success_rate(&self, level: u16, optimakina: bool) -> f64 {
        let base = 0.3 + 0.0015 * (2.0 * f64::from(level));
        (base + if optimakina { self.optimakina_bonus } else { 0.0 }).min(1.0)
    }

    /// Le niveau effectif d'une stratégie : zéro veut dire « celui par défaut ».
    #[inline]
    pub fn level_of(&self, strategy: Strategy) -> u16 {
        if strategy.level == 0 {
            self.mount_level
        } else {
            strategy.level.min(MAX_MOUNT_LEVEL)
        }
    }

    /// Ce que coûte et ce que dure un chargement d'unité.
    ///
    /// Le coût est celui d'un enclos multiplié par ceux de l'unité ; la durée est
    /// celle d'un enclos, puisqu'ils tournent ensemble.
    pub fn unit_load(&self, unit: usize, strategy: Strategy) -> (i64, f64) {
        let enclos = self.unit_enclos(unit) as f64;
        if !self.per_gauge_prices() {
            // Prix par jauge manquants : forfait à plat au prorata des enclos, et
            // durée de la bande la plus lente.
            let per_enclos = self.batch_cost as f64 / self.sync_enclos.max(1) as f64;
            return (
                (per_enclos * enclos) as i64,
                self.bands[0].hours + self.overhead_hours,
            );
        }
        let plan = crate::schedule::schedule(
            self,
            strategy.bands,
            mount_xp_for_level(self.level_of(strategy)),
        );
        (
            (plan.cost_per_enclos * enclos) as i64,
            plan.hours + self.overhead_hours,
        )
    }
}

// ---------------------------------------------------------------------------
// Les tirages
// ---------------------------------------------------------------------------

/// Le tirage de l'environnement, **indexé** plutôt que séquentiel.
///
/// Un générateur qu'on consomme au fil de l'eau lie le résultat à l'ordre des
/// appels. Deux politiques comparées sur la même graine ne verraient alors pas
/// les mêmes naissances dès que l'une tire un nombre de plus — et le décalage
/// est invisible. Chaque tirage est donc une **fonction** de la graine, de
/// l'unité, du numéro de chargement, de l'emplacement et de l'usage. Le
/// troisième croisement du quatrième chargement de l'unité libre tire toujours
/// la même valeur, quoi que les autres unités aient fait.
#[derive(Clone, Copy, Debug)]
pub struct Draws {
    seed: u64,
}

mod purpose {
    pub const OUTCOME: u32 = 0;
    pub const SEX: u32 = 1;
    pub const CLONE: u32 = 2;
    pub const POOL_GENERATION: u32 = 3;
    pub const POOL_COLOR: u32 = 4;
    pub const POOL_RECIPE: u32 = 5;
    pub const POOL_SEX: u32 = 6;
    pub const PRICE_AMBER: u32 = 7;
    pub const PRICE_GENETON: u32 = 8;
    pub const PRICE_TOP: u32 = 9;
    pub const PRICE_COLOR: u32 = 10;
    // Deux tirages de plus par couleur : trois uniformes additionnés font une
    // cloche, et c'est tout ce qu'il faut. Voir `bell_price`.
    pub const PRICE_COLOR_2: u32 = 11;
    pub const PRICE_COLOR_3: u32 = 12;
}

/// La coordonnée réservée à l'amorçage, hors des chargements.
const POOL_COORD: u32 = u32::MAX;

/// Le prix d'une couleur de gen 10 : une **cloche** centrée sur la norme.
///
/// ## Pourquoi pas un uniforme
///
/// C'était un uniforme sur `[gen10_min, gen10_max]`, soit `[300 000, 1 000 000]`.
/// Deux défauts, et le second est celui qui fausse les mesures.
///
/// Sa moyenne valait 650 000 quand `economy.toml` annonce 600 000 comme prix
/// habituel : le simulateur jouait un marché plus généreux que sa propre norme, et
/// les trois clés se contredisaient.
///
/// Surtout, un uniforme rend une couleur à 320 000 **aussi probable** qu'une à
/// 600 000. Relevé auprès de l'éleveur : les prix se groupent autour de 600 000, et
/// les bornes sont des excursions rares — une pointe à 2 M se saisit à 1,3 M, un
/// creux à 200 000 se saisit à 300 000, parce que ce qu'on note est l'espérance de
/// vente et non le cours du jour. Tout ce qui vit des tirages extrêmes s'en
/// trouvait gonflé, au premier rang le choix de la couronne : un oracle qui prend
/// le meilleur de vingt couleurs profitait d'une queue que le marché n'a pas.
///
/// ## La forme retenue
///
/// Trois uniformes additionnés — Irwin–Hall — donnent une cloche sans dépendance,
/// sans fonction spéciale, et déterministe par graine comme le reste.
///
/// Le recentrage est **asymétrique à dessein** : la norme, 600 000, n'est pas au
/// milieu de `[300 000, 1 000 000]`. Chaque moitié de la cloche est donc étirée
/// vers sa propre borne, ce qui fait tomber la **médiane exactement sur la norme**
/// et le support exactement sur les bornes, sans écrasement de masse aux
/// extrémités — ce qu'un simple écrêtage aurait produit.
///
/// La moyenne, elle, reste un peu au-dessus de la médiane, la moitié haute étant
/// plus large. C'est le comportement voulu : un marché où les bonnes surprises
/// portent plus loin que les mauvaises.
fn bell_price(draws: &Draws, color: u32, center: i64, low: i64, high: i64) -> i64 {
    if high <= low {
        return low;
    }
    let center = center.clamp(low, high) as f64;
    let (low, high) = (low as f64, high as f64);

    let bell = (draws.at(POOL_COORD, color, purpose::PRICE_COLOR)
        + draws.at(POOL_COORD, color, purpose::PRICE_COLOR_2)
        + draws.at(POOL_COORD, color, purpose::PRICE_COLOR_3))
        / 3.0;

    let price = if bell < 0.5 {
        center - (0.5 - bell) * 2.0 * (center - low)
    } else {
        center + (bell - 0.5) * 2.0 * (high - center)
    };
    price.round() as i64
}

#[inline]
fn splitmix64(z: u64) -> u64 {
    let z = z.wrapping_add(0x9E37_79B9_7F4A_7C15);
    let mut x = z;
    x = (x ^ (x >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    x = (x ^ (x >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    x ^ (x >> 31)
}

impl Draws {
    pub fn new(seed: u32) -> Self {
        Self {
            seed: splitmix64(u64::from(seed)),
        }
    }

    /// Un uniforme sur `[0, 1)`, fonction pure de ses coordonnées.
    #[inline]
    pub fn at(&self, coord: u32, slot: u32, purpose: u32) -> f64 {
        let mixed = splitmix64(
            self.seed
                ^ splitmix64(u64::from(coord))
                ^ splitmix64((u64::from(slot) << 32) | u64::from(purpose)),
        );
        (mixed >> 11) as f64 / (1u64 << 53) as f64
    }

    #[inline]
    fn coin(&self, coord: u32, slot: u32, purpose: u32) -> bool {
        self.at(coord, slot, purpose) < 0.5
    }
}

/// La coordonnée d'un chargement : l'unité et son rang.
///
/// Séparer les unités est ce qui garde les graines communes utiles — sans quoi
/// deux politiques qui ne rechargent pas dans le même ordre verraient des
/// naissances différentes.
#[inline]
fn load_coord(unit: usize, load: u32) -> u32 {
    (unit as u32).wrapping_mul(1_000_003).wrapping_add(load)
}

/// Le générateur **de la politique**, séparé de celui de l'environnement.
#[derive(Clone, Debug)]
pub struct Rng {
    state: u32,
}

impl Rng {
    pub fn new(seed: u32) -> Self {
        Self { state: seed }
    }

    #[inline]
    pub fn next_f64(&mut self) -> f64 {
        self.state = self.state.wrapping_add(0x6d2b_79f5);
        let mut t = self.state;
        t = (t ^ (t >> 15)).wrapping_mul(t | 1);
        t ^= t.wrapping_add((t ^ (t >> 7)).wrapping_mul(t | 61));
        f64::from(t ^ (t >> 14)) / 4_294_967_296.0
    }
}

// ---------------------------------------------------------------------------
// L'écurie de départ
// ---------------------------------------------------------------------------

/// Les cent montures d'amorçage, généalogie jouable comprise.
pub fn starting_stable(catalog: &Catalog, economy: &Economy, draws: &Draws) -> Stable {
    let mut stable = Stable::new();
    let (low, high) = economy.pool_generations;
    if economy.starting_pool == 0 || low > high {
        return stable;
    }
    let span = u32::from(high - low + 1);

    for index in 0..economy.starting_pool as u32 {
        let pick = |purpose: u32, count: usize| -> usize {
            debug_assert!(count > 0);
            let value = draws.at(POOL_COORD, index, purpose);
            ((value * count as f64) as usize).min(count - 1)
        };

        let generation = low + pick(purpose::POOL_GENERATION, span as usize) as u8;
        let colors: Vec<ColorId> = catalog.ids_at_generation(generation).collect();
        if colors.is_empty() {
            continue;
        }
        let color = colors[pick(purpose::POOL_COLOR, colors.len())];

        let recipes = &catalog.color(color).recipes;
        let parents = if recipes.is_empty() {
            None
        } else {
            Some(recipes[pick(purpose::POOL_RECIPE, recipes.len())])
        };

        stable.push(Mount {
            color,
            sex: if draws.coin(POOL_COORD, index, purpose::POOL_SEX) {
                Sex::Male
            } else {
                Sex::Female
            },
            level: economy.mount_level,
            fertile: true,
            // Le pool s'achète : personne n'a payé son cycle. C'est ce qui garde
            // l'économie de départ identique à celle d'avant le découplage, où
            // deux places d'enclos étaient dues par croisement.
            cycled: false,
            parents,
        });
    }

    stable
}

// ---------------------------------------------------------------------------
// Le chargement d'une unité
// ---------------------------------------------------------------------------

/// Ce qu'on met dans une unité qui se libère.
///
/// Les indices sont **virtuels** : les achats sont ajoutés d'abord, si bien
/// qu'une monture achetée porte l'indice `stable.len() + j` et peut servir de
/// parent dans le même chargement.
#[derive(Clone, Debug, Default)]
pub struct UnitPlan {
    pub purchases: Vec<(ColorId, Sex)>,
    pub clonings: Vec<[usize; 2]>,
    pub crossings: Vec<[usize; 2]>,
    /// Une Optimakina par croisement, en regard de `crossings`.
    pub optimakina: Vec<bool>,
    /// Créditées **avant** les dépenses, pour qu'un chargement se finance.
    pub sacrifices: Vec<usize>,
    /// Montures mises en enclos **sans être croisées** : elles en sortent fécondes
    /// et restent en écurie.
    ///
    /// C'est la fécondité mise en banque, et elle ne se périme pas. Une monture
    /// citée ici occupe une place mais ne consomme pas sa reproduction — d'où un
    /// champ à part plutôt qu'un croisement dégénéré.
    pub cycles: Vec<usize>,
}

/// Ce que la politique voit quand une unité se libère.
pub struct UnitView<'a> {
    pub catalog: &'a Catalog,
    pub economy: &'a Economy,
    pub stable: &'a Stable,
    pub kamas: i64,
    /// L'unité qui se libère, et ce que le génome lui a assigné.
    pub unit: usize,
    pub strategy: Strategy,
    /// **Places d'enclos** que cette unité peut porter, dix par enclos.
    ///
    /// Des places et non des croisements, depuis que le cycle s'est détaché de
    /// l'accouplement : un croisement en coûte deux, une, ou zéro selon ce que ses
    /// parents doivent encore. Compter des croisements ici bridait la recherche à
    /// la moitié de l'enclos — elle voyait vingt-cinq places là où il y en a
    /// cinquante — sans que rien ne proteste, puisque `apply` acceptait ce qu'elle
    /// produisait.
    pub capacity: usize,
}

pub trait Policy {
    fn name(&self) -> &str;
    /// Les réglages de chaque unité, fixés hors de la recherche.
    fn strategy(&self, unit: usize) -> Strategy;
    /// `rng` est celui de la politique, pas celui des naissances.
    fn plan(&mut self, view: &UnitView<'_>, rng: &mut Rng) -> UnitPlan;
}

#[derive(Clone, Debug, PartialEq)]
pub struct RunOutcome {
    /// Le score : solde à la fin, tout le reste liquidé.
    pub score: i64,
    pub balance_before_liquidation: i64,
    pub liquidation: i64,
    pub crossings: usize,
    /// Croisements qui n'avaient **aucune chance de monter**.
    ///
    /// Un couple dont la cible n'est nommée par personne est en régime
    /// « recopie » : toute la masse de réussite retombe sur l'ascendance, donc le
    /// poulain naît au mieux à la génération que les parents portaient déjà.
    /// L'occupation de l'enclos, le carburant et la fécondité sont payés pour un
    /// tirage qui ne peut pas faire avancer l'écurie.
    ///
    /// Compté toujours, facturé seulement si `Economy::barren_crossing_malus`
    /// n'est pas nul : le compte est une observation, le prix est un choix.
    pub barren_crossings: usize,
    pub purchases: usize,
    pub clonings: usize,
    pub sacrifices: usize,
    /// Fécondations posées **sans croisement** sur toute la partie.
    ///
    /// C'est la mesure qui dit si la politique banque sa fécondité ou si elle
    /// continue de tout croiser sur place. À zéro, le découplage n'a rien changé au
    /// comportement — et un écart de score serait alors à chercher ailleurs.
    pub cycles: usize,
    /// Les mêmes, **par unité**.
    ///
    /// Le total seul ne peut pas trancher la question qui compte : banquer sert-il
    /// partout, ou surtout sur l'unité **libre** ? Le bloc a cinquante places et
    /// compose une paire complète sans peine ; l'unité libre en a dix, et sa vraie
    /// contrainte est qu'un croisement demande **les deux** parents au même
    /// instant. Y féconder la moitié disponible coûte une place et rend le
    /// croisement gratuit dès que l'autre naît — sans attendre que l'unité se
    /// libère, puisque deux fécondes s'accouplent d'un clic.
    ///
    /// Si le banking se concentre là, c'est une fluidification et non du bruit.
    /// Réparti uniformément, c'est du bruit. Le total ne distingue pas les deux.
    pub cycles_by_unit: [usize; MAX_UNITS],
    /// Génétons produits sur toute la partie, tous croisements confondus.
    pub genetons: i64,
    /// Chargements ayant réellement porté un croisement, donc payés.
    pub loads_paid: u32,
    /// Chargements par unité, pour voir les timelines diverger.
    pub loads_by_unit: [u32; MAX_UNITS],
    pub best_generation: u8,
    pub gen10_held: usize,
    /// Combien la partie finit avec de la couleur du projet. Voir `Economy::project`.
    pub crown_held: usize,
    /// Chargements refusés. Doit rester à zéro.
    pub rejected_loads: u32,
    /// **Pourquoi** ils l'ont été, indexé par `Rejected::reason`.
    ///
    /// Le compte seul ne suffisait pas : la branche d'erreur jetait la raison
    /// (`Err(_)`), donc « 191 fournées refusées » ne disait pas si le moteur
    /// manquait de kamas, de places, ou refusait un croisement mal formé. On a
    /// attribué ces refus au budget sans l'avoir vérifié — c'est le genre de
    /// chiffre qu'on finit par croire.
    pub rejected_by_reason: [u32; Rejected::REASONS],
    /// Couleurs **distinctes** nées au moins une fois sur la partie.
    ///
    /// L'avancement du succès de collection, et le seul chiffre qui dise si une
    /// politique élargit sa palette ou repasse sur la même.
    pub collection_done: usize,
    /// Ce que cet avancement vaut, au barème de `Economy::collection_bonus`.
    ///
    /// Compté toujours, facturé seulement si le barème n'est pas nul — même règle
    /// que `barren_crossings` : le compte est une observation, le prix est un choix.
    pub collection_bonus: i64,
    pub hours_used: f64,
    /// Heures passées à attendre une fenêtre, enclos libre et personne devant le
    /// jeu. Nulles sans fenêtre posée. C'est la mesure de ce que la disponibilité
    /// coûte, et elle n'existait pas.
    pub hours_waiting: f64,
}

#[derive(Debug, PartialEq, Eq)]
pub enum Rejected {
    TooManyCrossings { asked: usize, allowed: usize },
    UnknownIndex(usize),
    MountUsedTwice(usize),
    NotFertile(usize),
    SameSex(usize, usize),
    // `NoOutlook` a été retirée. Elle disait « le jeu ne propose pas cet
    // accouplement », ce que le jeu ne dit jamais : au sommet il plafonne la
    // cible (issue #185). Une politique qui apparie deux gen 10 ne commet plus
    // une faute de règle mais un mauvais choix, et c'est `barren` qui le compte.
    CloneNotSterile(usize),
    CloneGenerationMismatch(usize, usize),
    Unaffordable { needed: i64, available: i64 },
}

impl Rejected {
    /// Le nombre de raisons, pour dimensionner le compteur.
    pub const REASONS: usize = 8;

    /// L'indice de cette raison dans `RunOutcome::rejected_by_reason`.
    pub fn reason(&self) -> usize {
        match self {
            Self::TooManyCrossings { .. } => 0,
            Self::UnknownIndex(_) => 1,
            Self::MountUsedTwice(_) => 2,
            Self::NotFertile(_) => 3,
            Self::SameSex(..) => 4,
            Self::CloneNotSterile(_) => 5,
            Self::CloneGenerationMismatch(..) => 6,
            Self::Unaffordable { .. } => 7,
        }
    }

    /// Le nom de chaque raison, dans l'ordre de `reason`.
    pub const LABELS: [&'static str; Self::REASONS] = [
        "trop de places demandées",
        "indice inconnu",
        "monture employée deux fois",
        "monture non fertile",
        "même sexe",
        "clone non stérile",
        "clone de génération différente",
        "kamas insuffisants",
    ];
}

struct Applied {
    genetons: i64,
    crossings: usize,
    /// Croisements qui **ne pouvaient pas** monter, ceux dont `pair_outlook`
    /// rend une cible que personne ne nomme. Voir `RunOutcome::barren_crossings`.
    barren: usize,
    purchases: usize,
    clonings: usize,
    sacrifices: usize,
    /// Montures fécondées sans être croisées.
    cycles: usize,
    /// Places d'enclos réellement occupées. C'est elle qui dit si l'unité a
    /// travaillé, et donc si elle doit un cycle de manipulation.
    places: usize,
    best_generation: u8,
    /// Les bébés, qui naîtront à la **fin** du cycle et pas maintenant.
    births: Vec<Mount>,
}

/// Ce qu'un chargement a produit, pour qui l'applique hors d'une partie.
///
/// `Applied` reste privé — il porte les bébés en attente, qui n'ont de sens que
/// dans la boucle de `run` où ils naissent à la fin du cycle. Le tapis roulant,
/// lui, n'a pas de temps : ses naissances arrivent tout de suite, et il n'a besoin
/// que des comptes.
#[derive(Clone, Copy, Debug, Default)]
pub struct AppliedSummary {
    pub genetons: i64,
    /// Places d'enclos réellement occupées. Une par parent qui doit son cycle,
    /// une par fécondation, zéro pour un couple de fécondes.
    pub places: usize,
    pub crossings: usize,
    pub clonings: usize,
    pub sacrifices: usize,
    pub cycles: usize,
    pub births: usize,
}

/// Applique un plan **hors de toute économie**, naissances posées immédiatement.
///
/// Sert au tapis roulant de `treadmill.rs`, qui apprend l'appariement seul. Le
/// solde est un jeton : il n'est ni lu ni rendu, et le plancher de solvabilité ne
/// peut donc pas mordre. Ce qui reste actif est ce qui décrit le jeu — la loi
/// d'appariement, les places, la stérilité, le clonage.
///
/// Passe par le **même** `apply` que la partie complète, exprès. Une seconde
/// implémentation des naissances divergerait en silence, et c'est précisément ce
/// que le test de parité existe pour empêcher entre le Rust et le TypeScript.
pub fn apply_plan(
    catalog: &Catalog,
    economy: &Economy,
    stable: &mut Stable,
    plan: &UnitPlan,
    strategy: Strategy,
    draws: &Draws,
    coord: u32,
) -> Result<AppliedSummary, Rejected> {
    let mut kamas = i64::MAX / 4;
    let applied = apply(
        catalog, economy, stable, &mut kamas, plan, strategy, 0, draws, coord,
    )?;
    let births = applied.births.len();
    for baby in applied.births {
        stable.push(baby);
    }
    Ok(AppliedSummary {
        genetons: applied.genetons,
        places: applied.places,
        crossings: applied.crossings,
        clonings: applied.clonings,
        sacrifices: applied.sacrifices,
        cycles: applied.cycles,
        births,
    })
}

/// Descend la stratégie d'un cran de bande, ou dit qu'il n'y en a plus.
///
/// Un cran plus bas, c'est moins cher au point et plus lent : c'est exactement
/// l'arbitrage que `tuned_for` tranche une fois pour toutes, et qu'un tour sans
/// argent doit pouvoir retrancher pour lui seul.
fn lower_band(strategy: &mut Strategy) -> bool {
    if strategy.bands.iter().all(|&band| band == 0) {
        return false;
    }
    for band in strategy.bands.iter_mut() {
        *band = band.saturating_sub(1);
    }
    true
}

/// Applique un chargement, ou dit pourquoi il est refusé.
///
/// L'ordre est celui qui rend un chargement auto-finançable : on **crédite les
/// sacrifices d'abord**, puis on débite les achats et le chargement, et le solde
/// doit rester positif.
#[allow(clippy::too_many_arguments)]
fn apply(
    catalog: &Catalog,
    economy: &Economy,
    stable: &mut Stable,
    kamas: &mut i64,
    plan: &UnitPlan,
    strategy: Strategy,
    unit: usize,
    draws: &Draws,
    coord: u32,
) -> Result<Applied, Rejected> {
    let level = economy.level_of(strategy);
    let base = stable.len();

    // --- les places, qui ont remplacé le compte de croisements --------------
    //
    // Un croisement paie une place par parent qui doit encore son cycle ; une
    // fécondation en paie une. Deux fécondes croisées n'en paient aucune, donc le
    // nombre de croisements d'un chargement n'est plus borné — c'est le sens du
    // découplage, et c'est conforme au jeu où l'accouplement est un clic.
    let cycled_at = |index: usize| index < base && stable.mounts[index].cycled;
    let places: usize = plan
        .crossings
        .iter()
        .flatten()
        .chain(plan.cycles.iter())
        .filter(|&&index| !cycled_at(index))
        .count();
    let capacity = economy.unit_places(unit);
    if places > capacity {
        return Err(Rejected::TooManyCrossings {
            asked: places,
            allowed: capacity,
        });
    }

    let total = base + plan.purchases.len();
    let check = |index: usize| {
        if index < total {
            Ok(())
        } else {
            Err(Rejected::UnknownIndex(index))
        }
    };

    // --- l'argent, avant toute mutation -----------------------------------
    let mut credit = 0;
    for &index in &plan.sacrifices {
        check(index)?;
        let color = if index < base {
            stable.mounts[index].color
        } else {
            plan.purchases[index - base].0
        };
        credit += economy.value_of(catalog, color);
    }

    let mut debit = plan.purchases.len() as i64 * economy.starter_price;
    // Le chargement se paie dès qu'une place est occupée. Le tester sur les
    // croisements laissait une fournée de pure fécondation passer gratuitement,
    // c'est-à-dire exactement l'action que le découplage introduit.
    if places > 0 {
        debit += economy.unit_load(unit, strategy).0;

        // Les indices sont encore virtuels ici — les achats ne sont pas posés —
        // d'où la résolution explicite.
        let resolve = |index: usize| -> Mate {
            if index < base {
                stable.mounts[index].mate()
            } else {
                Mate {
                    color: plan.purchases[index - base].0,
                    level,
                    parents: None,
                }
            }
        };
        for (slot, &[male, female]) in plan.crossings.iter().enumerate() {
            if !plan.optimakina.get(slot).copied().unwrap_or(false) {
                continue;
            }
            check(male)?;
            check(female)?;
            // Sans cible nommée, l'Optimakina n'achète rien : elle relève le taux
            // d'une génération que le couple ne sait pas atteindre. On ne facture
            // donc rien, plutôt que le prix d'un rang inventé.
            let target = pair_target_generation(catalog, &resolve(male), &resolve(female));
            debit += target.map_or(0, |generation| {
                economy.optimakina[usize::from(generation).min(10)]
            });
        }
    }
    if *kamas + credit < debit {
        return Err(Rejected::Unaffordable {
            needed: debit,
            available: *kamas + credit,
        });
    }

    // --- les achats, pour que les indices virtuels deviennent réels --------
    for &(color, sex) in &plan.purchases {
        stable.push(Mount {
            color,
            sex,
            level,
            fertile: true,
            // Une monture achetée arrive fertile, jamais féconde : son cycle
            // reste à payer, et c'est une place d'enclos.
            cycled: false,
            parents: None,
        });
    }

    // Chaque monture ne sert qu'une fois par chargement, tous usages confondus.
    let mut used = vec![false; stable.len()];
    let claim = |index: usize, used: &mut Vec<bool>| {
        if used[index] {
            return Err(Rejected::MountUsedTwice(index));
        }
        used[index] = true;
        Ok(())
    };

    let mut doomed: Vec<usize> = Vec::new();

    // --- clonage : deux stériles de même génération, une féconde en sort ---
    for (slot, &[a, b]) in plan.clonings.iter().enumerate() {
        check(a)?;
        check(b)?;
        claim(a, &mut used)?;
        claim(b, &mut used)?;
        if stable.mounts[a].fertile {
            return Err(Rejected::CloneNotSterile(a));
        }
        if stable.mounts[b].fertile {
            return Err(Rejected::CloneNotSterile(b));
        }
        if catalog.generation(stable.mounts[a].color) != catalog.generation(stable.mounts[b].color) {
            return Err(Rejected::CloneGenerationMismatch(a, b));
        }

        // Laquelle survit : la certitude est gratuite quand les deux portent la
        // même signature, sinon le jeu tranche à pile ou face.
        let survivor = if stable.mounts[a].signature() == stable.mounts[b].signature()
            || draws.coin(coord, slot as u32, purpose::CLONE)
        {
            a
        } else {
            b
        };
        stable.mounts[survivor].fertile = true;
        doomed.push(if survivor == a { b } else { a });
    }

    // --- fécondations sans croisement ---------------------------------------
    //
    // Posées avant les croisements pour que `claim` arbitre : une monture ne sert
    // qu'une fois par chargement, donc désigner la même à la fois ici et dans un
    // croisement est refusé plutôt que facturé deux fois.
    for &index in &plan.cycles {
        check(index)?;
        claim(index, &mut used)?;
        if !stable.mounts[index].fertile {
            return Err(Rejected::NotFertile(index));
        }
        // Déjà féconde : la remettre en enclos ne fait rien et occupe une place.
        // On refuse au lieu de l'absorber — une politique qui le demande a un
        // défaut, et l'absorber le cacherait.
        if stable.mounts[index].cycled {
            return Err(Rejected::NotFertile(index));
        }
        stable.mounts[index].cycled = true;
    }

    // --- croisements -------------------------------------------------------
    let mut best_generation = 0;
    let mut genetons: i64 = 0;
    let mut barren = 0usize;
    let mut births: Vec<Mount> = Vec::with_capacity(plan.crossings.len());
    for (slot, &[male, female]) in plan.crossings.iter().enumerate() {
        check(male)?;
        check(female)?;
        claim(male, &mut used)?;
        claim(female, &mut used)?;
        if !stable.mounts[male].fertile {
            return Err(Rejected::NotFertile(male));
        }
        if !stable.mounts[female].fertile {
            return Err(Rejected::NotFertile(female));
        }
        if stable.mounts[male].sex != Sex::Male || stable.mounts[female].sex != Sex::Female {
            return Err(Rejected::SameSex(male, female));
        }

        // Le jeu ne refuse jamais un accouplement : il plafonne la cible quand
        // l'ascendance est déjà au sommet. Il n'y a donc plus rien à rejeter ici
        // — voir `pair_outlook`, qui répond toujours.
        let (m, f) = (stable.mounts[male].mate(), stable.mounts[female].mate());
        let outlook = pair_outlook(catalog, &m, &f);

        // Le poulain **ne peut pas** dépasser la génération que le couple portait
        // déjà, de deux façons : personne ne nomme la cible, ou la cible est
        // plafonnée. Le croisement est stérile au sens qui compte — pas qu'il ne
        // donne rien, mais qu'il ne peut rien donner de nouveau.
        let climbs = outlook.climbs();
        if !climbs {
            barren += 1;
        }

        // La fécondité se consomme, et définitivement.
        stable.mounts[male].fertile = false;
        stable.mounts[female].fertile = false;

        let optimakina = plan.optimakina.get(slot).copied().unwrap_or(false);
        let rate = economy.success_rate(level, optimakina);
        let outcomes = mating_outcomes_at(catalog, &m, &f, Some(rate));

        let slot = slot as u32;
        let mut roll = draws.at(coord, slot, purpose::OUTCOME);
        let last = outcomes[outcomes.len() - 1];
        let mut color = last.color;
        let mut reached = last.kind == OutcomeKind::Target;
        for outcome in &outcomes {
            if roll < outcome.probability {
                color = outcome.color;
                reached = outcome.kind == OutcomeKind::Target;
                break;
            }
            roll -= outcome.probability;
        }

        // Les génétons ne tombent qu'en cas de **succès** : un croisement qui
        // manque sa génération ne rend rien. C'est ce qui les rend moins lourds
        // qu'ils n'en ont l'air — et ce qui donne à l'Optimakina une valeur
        // qu'elle n'aurait pas autrement, puisque son bonus achète aussi du
        // géneton.
        if reached {
            genetons += genetons_for_crossing(
                catalog.generation(m.color),
                catalog.generation(f.color),
                climbs,
            );
        }

        best_generation = best_generation.max(catalog.generation(color));
        births.push(Mount {
            color,
            sex: if draws.coin(coord, slot, purpose::SEX) {
                Sex::Male
            } else {
                Sex::Female
            },
            level,
            fertile: true,
            // Un poulain naît fertile, pas fécond : il doit son propre cycle avant
            // de pouvoir servir. C'est ce qui donne un sens au pré-fécondage —
            // sinon toute naissance serait immédiatement croisable et il n'y aurait
            // rien à anticiper.
            cycled: false,
            parents: Some([m.color, f.color]),
        });
    }

    // --- sacrifices --------------------------------------------------------
    for &index in &plan.sacrifices {
        claim(index, &mut used)?;
        doomed.push(index);
    }

    // Les génétons s'ajoutent après coup : ils ne peuvent pas financer le
    // chargement qui les produit, puisqu'ils n'existent qu'une fois l'accouplement
    // lancé.
    *kamas = *kamas + credit - debit + (genetons as f64 * economy.geneton_value) as i64;
    debug_assert!(*kamas >= 0, "le plancher est vérifié plus haut");

    stable.remove_all(&doomed);

    Ok(Applied {
        genetons,
        crossings: plan.crossings.len(),
        barren,
        purchases: plan.purchases.len(),
        clonings: plan.clonings.len(),
        sacrifices: plan.sacrifices.len(),
        cycles: plan.cycles.len(),
        places,
        best_generation,
        births,
    })
}

/// Joue une partie complète et rend son score.
///
/// `seed` fixe l'écurie de départ et toutes les naissances : deux politiques
/// jouées sur la même graine affrontent exactement le même jeu.
/// Une fournée, telle qu'elle s'est réellement jouée.
///
/// Le score dit ce qu'une politique vaut ; il ne dit pas quoi faire mardi à
/// 14 h. Pour émettre le plan que l'écran attend, il faut le déroulé — quelle
/// unité, à quelle heure, avec combien de croisements et de clonages. C'est ce
/// que la boucle calcule déjà et agrégeait aussitôt.
#[derive(Clone, Debug)]
pub struct Batch {
    pub unit: usize,
    /// Heures depuis le début de la partie.
    pub at_hours: f64,
    /// Durée du cycle, manipulation comprise.
    pub hours: f64,
    pub crossings: usize,
    pub clonings: usize,
    /// Les montures à acheter, **nommées**. Un compte ne suffit pas pour aller
    /// à l'HDV : « acheter trois montures » n'est pas une consigne, « acheter
    /// deux Doré mâles et une Amande femelle » en est une.
    pub purchases: Vec<(ColorId, Sex)>,
    pub sacrifices: usize,
    pub births: usize,
}

pub fn play(catalog: &Catalog, economy: &Economy, policy: &mut dyn Policy, seed: u32) -> RunOutcome {
    run(catalog, economy, policy, seed, None)
}

/// La même partie, en gardant le déroulé fournée par fournée.
///
/// Séparé de `play` parce que la boucle d'entraînement en joue des centaines de
/// milliers et n'a que faire du détail : elle passe `None` et ne paie rien.
pub fn play_recorded(
    catalog: &Catalog,
    economy: &Economy,
    policy: &mut dyn Policy,
    seed: u32,
) -> (RunOutcome, Vec<Batch>) {
    let mut log = Vec::new();
    let outcome = run(catalog, economy, policy, seed, Some(&mut log));
    (outcome, log)
}

/// Une naissance entre dans l'écurie **et** dans la collection, jamais l'une sans
/// l'autre.
///
/// Les deux points d'insertion de `run` passent par ici. C'est délibéré : marquer
/// la collection à la main sur chaque `stable.push(baby)` marche jusqu'au
/// troisième point d'insertion que personne ne pense à modifier, et le succès
/// compterait alors les naissances d'une unité et pas de l'autre — un chiffre faux
/// et silencieux. Une seule porte rend ce défaut irreprésentable.
fn welcome(stable: &mut Stable, hatched: &mut [bool; MAX_COLORS], baby: Mount) {
    hatched[usize::from(baby.color).min(MAX_COLORS - 1)] = true;
    stable.push(baby);
}

fn run(
    catalog: &Catalog,
    economy: &Economy,
    policy: &mut dyn Policy,
    seed: u32,
    mut record: Option<&mut Vec<Batch>>,
) -> RunOutcome {
    let draws = Draws::new(seed);
    // Le marché du jour, tiré avec la graine : il fait partie du monde.
    let drawn = economy.for_run(catalog, &draws);
    let economy = &drawn;
    let mut stable = starting_stable(catalog, economy, &draws);
    // La collection ne compte que ce qui **naît**. L'écurie de départ est achetée,
    // pas élevée, donc elle n'y entre pas — même lecture que `success.ts`, dont
    // l'en-tête refuse de déduire la collection de ce que l'écurie porte.
    let mut hatched = [false; MAX_COLORS];
    let mut kamas = economy.starting_kamas;
    // Décalée exprès : la politique ne doit pas pouvoir rejouer le flux des
    // naissances en devinant sa propre graine.
    let mut rng = Rng::new(seed ^ 0x5bf0_3635);

    let units = economy.unit_count();
    let mut free_at = vec![0.0f64; units];
    // Les bébés d'un chargement attendent la fin de son cycle : c'est ce qui rend
    // les unités réellement indépendantes, puisque l'écurie s'enrichit au fil de
    // l'eau et que les autres peuvent utiliser ce qui vient de naître.
    let mut pending: Vec<Vec<Mount>> = vec![Vec::new(); units];
    let mut loads = [0u32; MAX_UNITS];

    let mut outcome = RunOutcome {
        score: 0,
        balance_before_liquidation: 0,
        liquidation: 0,
        collection_done: 0,
        collection_bonus: 0,
        crossings: 0,
        barren_crossings: 0,
        purchases: 0,
        clonings: 0,
        cycles: 0,
        cycles_by_unit: [0; MAX_UNITS],
        sacrifices: 0,
        genetons: 0,
        loads_paid: 0,
        loads_by_unit: [0; MAX_UNITS],
        best_generation: stable.top_generation(catalog),
        gen10_held: 0,
        crown_held: 0,
        rejected_loads: 0,
        rejected_by_reason: [0; Rejected::REASONS],
        hours_used: 0.0,
        hours_waiting: 0.0,
    };

    // Une unité qui ne fait rien plusieurs fois de suite ne fera plus rien : son
    // écurie ne change pas, donc la décision suivante sera identique. Sans cette
    // garde, une politique inerte consomme la manipulation des milliers de fois
    // pour arriver au bout des heures.
    const IDLE_LIMIT: u32 = 3;
    let mut idle = vec![0u32; units];
    let budget = economy.horizon_hours.unwrap_or(f64::INFINITY);

    loop {
        // La prochaine unité à se libérer, la plus basse d'abord pour départager.
        let next = (0..units)
            .filter(|&u| idle[u] < IDLE_LIMIT)
            .min_by(|&a, &b| {
                free_at[a]
                    .partial_cmp(&free_at[b])
                    .unwrap_or(std::cmp::Ordering::Equal)
                    .then(a.cmp(&b))
            });
        let Some(unit) = next else { break };

        // L'enclos est libre, mais il faut être là pour le vider et le relancer.
        // Les jauges, elles, ont tourné pendant l'absence : c'est pour ça que
        // l'attente se prend ici, sur la décision, et non sur la durée du cycle.
        //
        // C'est tout le modèle des fenêtres, et il tient en une ligne parce que la
        // boucle raisonnait déjà en heures murales. Sans fenêtre posée, `actionable`
        // rend l'instant tel quel et la partie est celle d'avant.
        let Some(now) = economy.actionable(free_at[unit], budget) else {
            break;
        };
        if now >= budget {
            break;
        }
        outcome.hours_waiting += now - free_at[unit];
        if economy.horizon_hours.is_none()
            && outcome.loads_by_unit.iter().sum::<u32>() >= economy.batches
        {
            break;
        }

        // 1. les naissances du chargement précédent arrivent maintenant.
        for baby in pending[unit].drain(..) {
            welcome(&mut stable, &mut hatched, baby);
        }

        // 2. la politique décide.
        let strategy = policy.strategy(unit);
        let plan = {
            let view = UnitView {
                catalog,
                economy,
                stable: &stable,
                kamas,
                unit,
                strategy,
                capacity: economy.unit_places(unit),
            };
            policy.plan(&view, &mut rng)
        };

        // 3. on applique. Les bébés attendront la fin du cycle.
        let coord = load_coord(unit, loads[unit.min(MAX_UNITS - 1)]);

        // ## Le repli sur la bande la plus chère finançable
        //
        // Un chargement refusé était un tour **entièrement** perdu : l'enclos
        // restait vide, l'horloge avançait de l'overhead, et rien n'était tenté.
        // Or le relevé dit que ces refus sont à **99,7 % du carburant** — le plan
        // lui-même tient, c'est le rythme commandé qui dépasse la bourse de ce
        // tour-là. À la médiane : 1 385 928 demandés contre 665 505 en caisse, et
        // les achats ne pèsent que 2 000.
        //
        // La bande est un choix **par chargement**, pas un réglage global. Quand
        // elle n'est pas finançable maintenant, on charge le même monde un cran
        // moins vite plutôt que pas du tout. Le cran retenu voyage ensuite dans
        // `strategy` : la durée du cycle est celle qu'on a réellement payée.
        //
        // Ne rattrape que `Unaffordable`. Un plan mal formé ne devient pas bon
        // parce qu'il coûte moins cher, et l'attraper ici masquerait un défaut de
        // politique.
        let mut strategy = strategy;
        let attempt = loop {
            let tried = apply(
                catalog, economy, &mut stable, &mut kamas, &plan, strategy, unit, &draws, coord,
            );
            match tried {
                Err(Rejected::Unaffordable { .. }) if lower_band(&mut strategy) => continue,
                settled => break settled,
            }
        };
        match attempt {
            Ok(applied) => {
                outcome.crossings += applied.crossings;
                outcome.barren_crossings += applied.barren;
                outcome.purchases += applied.purchases;
                outcome.clonings += applied.clonings;
                outcome.cycles += applied.cycles;
                outcome.cycles_by_unit[unit.min(MAX_UNITS - 1)] += applied.cycles;
                outcome.sacrifices += applied.sacrifices;
                outcome.genetons += applied.genetons;
                outcome.best_generation = outcome.best_generation.max(applied.best_generation);

                if let Some(log) = record.as_deref_mut() {
                    // Une fournée sans croisement n'occupe pas l'enclos : elle ne
                    // coûte que la manipulation, et c'est bien ce qu'on veut voir
                    // sur la piste de l'écurie.
                    let hours = if applied.crossings > 0 {
                        economy.unit_load(unit, strategy).1
                    } else {
                        economy.overhead_hours.max(1e-6)
                    };
                    log.push(Batch {
                        unit,
                        at_hours: now,
                        hours,
                        crossings: applied.crossings,
                        clonings: applied.clonings,
                        purchases: plan.purchases.clone(),
                        sacrifices: applied.sacrifices,
                        births: applied.births.len(),
                    });
                }

                // L'enclos a tourné dès qu'une **place** a servi, croisement ou
                // simple fécondation : les jauges ne savent pas faire la
                // différence, et la durée du cycle est la même.
                if applied.places > 0 {
                    outcome.loads_paid += 1;
                    idle[unit] = 0;
                    free_at[unit] = now + economy.unit_load(unit, strategy).1;
                    pending[unit] = applied.births;
                } else {
                    if applied.clonings + applied.sacrifices + applied.purchases == 0 {
                        idle[unit] += 1;
                    } else {
                        idle[unit] = 0;
                    }
                    free_at[unit] = now + economy.overhead_hours.max(1e-6);
                }
            }
            Err(reason) => {
                // Un chargement refusé est un chargement perdu : on ne devine pas
                // ce que la politique aurait voulu à la place. On note en revanche
                // **pourquoi**, ce que la branche jetait.
                outcome.rejected_loads += 1;
                outcome.rejected_by_reason[reason.reason()] += 1;
                idle[unit] += 1;
                free_at[unit] = now + economy.overhead_hours.max(1e-6);
            }
        }

        let slot = unit.min(MAX_UNITS - 1);
        loads[slot] += 1;
        outcome.loads_by_unit[slot] += 1;
        outcome.hours_used = outcome.hours_used.max(now);
    }

    // Les bébés encore en gestation naissent quand même : on les aurait
    // récupérés en attendant quelques heures, et les perdre créerait un effet de
    // bord où les derniers chargements ne valent rien — la politique apprendrait
    // à ne plus rien lancer sur la fin.
    for unit in 0..units {
        let babies: Vec<Mount> = pending[unit].drain(..).collect();
        for baby in babies {
            welcome(&mut stable, &mut hatched, baby);
        }
    }

    outcome.balance_before_liquidation = kamas;
    outcome.liquidation = stable
        .mounts
        .iter()
        .map(|m| economy.value_of(catalog, m.color))
        .sum();
    outcome.gen10_held = stable
        .mounts
        .iter()
        .filter(|m| catalog.generation(m.color) >= catalog.top_generation())
        .count();
    outcome.crown_held = match economy.project {
        Some(project) => stable.mounts.iter().filter(|m| m.color == project).count(),
        None => 0,
    };
    outcome.best_generation = outcome.best_generation.max(stable.top_generation(catalog));
    // Le malus est retiré ici, une fois, sur le total : c'est un terme de score et
    // non une dépense, donc il n'a jamais pu influer sur la solvabilité ni sur ce
    // que la politique pouvait se permettre en cours de partie. Deux malus
    // différents rejouent exactement la même partie.
    // L'avancement du succès, et ce qu'il vaut. Une couleur ne paie qu'une fois :
    // c'est ce qui distingue cette prime d'un barème de valeur, et ce qui fait
    // qu'accumuler la même gen 10 ne la déclenche pas deux fois.
    outcome.collection_done = hatched.iter().filter(|seen| **seen).count();
    outcome.collection_bonus = (0..MAX_COLORS)
        .filter(|color| hatched[*color])
        .map(|color| {
            let generation = catalog.generation(color as ColorId);
            economy.collection_bonus[usize::from(generation).min(10)]
        })
        .sum();
    outcome.score = kamas + outcome.liquidation
        - economy.barren_crossing_malus * outcome.barren_crossings as i64
        + outcome.collection_bonus;
    outcome
}

/// Le plancher : ne rien faire, garder le capital et liquider le pool.
///
/// Toute politique qui ne le bat pas détruit de la valeur.
pub struct NeverBreeds;

impl Policy for NeverBreeds {
    fn name(&self) -> &str {
        "ne-rien-faire"
    }
    fn strategy(&self, _unit: usize) -> Strategy {
        Strategy::default()
    }
    fn plan(&mut self, _view: &UnitView<'_>, _rng: &mut Rng) -> UnitPlan {
        UnitPlan::default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::Prices;
    use crate::trees::muldo;

    fn economy() -> Economy {
        Prices::load_default().expect("economy.toml").economy
    }

    #[test]
    fn le_parc_se_lit_en_unites() {
        let economy = economy();
        assert_eq!(economy.unit_count(), 2, "le bloc synchrone plus un libre");
        assert_eq!(economy.unit_crossings(0), 25, "cinq enclos de dix places");
        assert_eq!(economy.unit_crossings(1), 5, "un enclos");
        assert_eq!(economy.total_crossings(), 30);
        assert_eq!(economy.unit_places(0), 50, "deux places par croisement");
        assert_eq!(economy.unit_places(1), 10);
    }

    /// Une monture, avec l'état de cycle qu'on veut lui donner.
    fn mount(catalog: &Catalog, slug: &str, sex: Sex, cycled: bool) -> Mount {
        Mount {
            color: catalog.id_of(slug).expect(slug),
            sex,
            level: 67,
            fertile: true,
            cycled,
            parents: None,
        }
    }

    /// L'affirmation qui porte tout le découplage : deux fécondes s'accouplent
    /// d'un clic, donc sans place d'enclos, donc sans plafond.
    ///
    /// Vingt-six croisements sur une unité qui n'en portait que vingt-cinq : le
    /// vingt-sixième était refusé avant, et il doit passer maintenant.
    #[test]
    fn deux_fecondes_se_croisent_sans_occuper_l_enclos() {
        let catalog = muldo();
        let economy = economy();
        let mut stable = Stable::new();
        for _ in 0..26 {
            stable.push(mount(&catalog, "dore", Sex::Male, true));
            stable.push(mount(&catalog, "ebene", Sex::Female, true));
        }

        let crossings: Vec<[usize; 2]> = (0..26).map(|i| [i * 2, i * 2 + 1]).collect();
        assert!(crossings.len() > economy.unit_crossings(0));

        let mut kamas = 10_000_000;
        let plan = UnitPlan {
            crossings,
            ..Default::default()
        };
        let applied = apply(
            &catalog, &economy, &mut stable, &mut kamas, &plan,
            Strategy::default(), 0, &Draws::new(1), 0,
        )
        .expect("vingt-six croisements de fécondes tiennent dans zéro place");

        assert_eq!(applied.crossings, 26);
        assert_eq!(applied.places, 0, "aucune place : les cycles étaient payés");
        // Le solde **monte** : aucun chargement n'est dû, et les naissances
        // rapportent leurs génétons. C'est bien le signe qu'on n'a rien payé — un
        // chargement du bloc coûte six chiffres.
        assert!(
            kamas >= 10_000_000,
            "aucune place occupée, donc aucun chargement à payer ; solde {kamas}"
        );
    }

    /// Une fournée qui ne fait que féconder occupe l'enclos, donc le paie.
    ///
    /// Sans ça, banquer de la fécondité serait gratuit et la mesure flatterait
    /// l'hypothèse qu'elle est censée éprouver.
    #[test]
    fn feconder_sans_croiser_paie_le_chargement() {
        let catalog = muldo();
        let economy = economy();
        let mut stable = Stable::new();
        for _ in 0..4 {
            stable.push(mount(&catalog, "dore", Sex::Male, false));
        }

        let mut kamas = 10_000_000;
        let plan = UnitPlan {
            cycles: vec![0, 1, 2, 3],
            ..Default::default()
        };
        let applied = apply(
            &catalog, &economy, &mut stable, &mut kamas, &plan,
            Strategy::default(), 0, &Draws::new(1), 0,
        )
        .expect("quatre places sur cinquante");

        assert_eq!(applied.cycles, 4);
        assert_eq!(applied.crossings, 0);
        assert_eq!(applied.places, 4);
        assert!(
            kamas < 10_000_000,
            "l'enclos a tourné : le chargement est dû même sans croisement"
        );
        assert!(
            stable.mounts.iter().all(|m| m.cycled && m.fertile),
            "les quatre sont fécondes et gardent leur reproduction"
        );
    }

    /// Refécondier une féconde est un défaut, pas une opération neutre : ça
    /// occuperait une place pour rien.
    #[test]
    fn refeconder_une_feconde_est_refuse() {
        let catalog = muldo();
        let economy = economy();
        let mut stable = Stable::new();
        stable.push(mount(&catalog, "dore", Sex::Male, true));

        let mut kamas = 10_000_000;
        let plan = UnitPlan {
            cycles: vec![0],
            ..Default::default()
        };
        assert!(
            apply(
                &catalog, &economy, &mut stable, &mut kamas, &plan,
                Strategy::default(), 0, &Draws::new(1), 0,
            )
            .is_err()
        );
    }

    #[test]
    fn le_plancher_garde_le_capital_et_liquide_le_pool() {
        let catalog = muldo();
        let economy = economy();
        let outcome = play(&catalog, &economy, &mut NeverBreeds, 1);

        assert_eq!(outcome.balance_before_liquidation, 10_000_000);
        assert_eq!(outcome.crossings, 0);
        assert_eq!(outcome.loads_paid, 0);
        assert_eq!(outcome.rejected_loads, 0);
        assert!(outcome.liquidation > 0);
        assert_eq!(outcome.score, 10_000_000 + outcome.liquidation);
    }

    #[test]
    fn un_gen_1_achete_ne_rend_rien_a_l_ambre() {
        let catalog = muldo();
        let economy = economy();
        for id in catalog.ids_at_generation(1) {
            assert_eq!(economy.value_of(&catalog, id), 0, "{}", catalog.slug(id));
        }
    }

    /// Les prix de gen 10 forment une **cloche** centrée sur la norme.
    ///
    /// Verrouillé parce que rien d'autre ne l'empêche : revenir à un uniforme ne
    /// casserait aucun test, ne changerait aucune signature, et ne se verrait
    /// qu'en constatant des mois plus tard que les mesures qui vivent des queues
    /// de distribution ont dérivé.
    ///
    /// Trois propriétés, et la troisième est celle qui distingue vraiment une
    /// cloche d'un uniforme : la moitié centrale doit contenir bien **plus** que
    /// la moitié du tirage. Un uniforme en mettrait exactement 50 %.
    #[test]
    fn les_prix_de_gen_10_font_une_cloche_autour_de_la_norme() {
        let catalog = muldo();
        let base = crate::config::Prices::load_default().expect("economy.toml").economy;
        let (low, high) = base.top_value_range;
        let center = base.top_value;

        let tops: Vec<ColorId> = catalog.ids_at_generation(catalog.top_generation()).collect();
        assert!(tops.len() >= 10, "il faut des couleurs pour parler de forme");

        let mut prices: Vec<i64> = Vec::new();
        for seed in 0..400u32 {
            let drawn = base.for_run(&catalog, &Draws::new(seed));
            for &color in &tops {
                prices.push(drawn.value_of(&catalog, color));
            }
        }

        // 1. Le support tient dans les bornes annoncées.
        assert!(
            prices.iter().all(|&p| p >= low && p <= high),
            "un prix est sorti de [{low}, {high}]"
        );

        // 2. La médiane tombe sur la norme, à 2 % près. C'est ce que le
        //    recentrage asymétrique de `bell_price` garantit — et ce qu'un
        //    uniforme sur ces bornes manquerait de 50 000.
        prices.sort_unstable();
        let median = prices[prices.len() / 2];
        let drift = (median - center).abs() as f64 / center as f64;
        assert!(
            drift < 0.02,
            "médiane {median} loin de la norme {center} ({:.1} %)",
            drift * 100.0
        );

        // 3. La forme. Sur la moitié centrale du support, un uniforme mettrait
        //    50 % de sa masse ; une cloche nettement plus.
        let quarter = low + (high - low) / 4;
        let three_quarters = low + 3 * (high - low) / 4;
        let middle = prices
            .iter()
            .filter(|&&p| p >= quarter && p <= three_quarters)
            .count() as f64
            / prices.len() as f64;
        assert!(
            middle > 0.62,
            "seulement {:.0} % de la masse au centre : c'est un uniforme, pas une cloche",
            middle * 100.0
        );
    }

    #[test]
    fn la_valeur_suit_le_rang_et_la_gen_10_est_a_part() {
        let catalog = muldo();
        let economy = economy();
        let value = |slug: &str| economy.value_of(&catalog, catalog.id_of(slug).expect(slug));
        assert_eq!(value("dore"), 0, "gen 1 : ne s'extrait pas");
        assert_eq!(value("dore_amande"), 80_000, "gen 4 → 4 × 20 000");
        assert_eq!(value("ambre"), 180_000, "gen 9 → 9 × 20 000");
        assert_eq!(value("ambre_dore"), 600_000, "gen 10, prix fixe");
    }

    /// L'unité libre coûte le cinquième du bloc à réglages égaux, et dure autant.
    /// C'est tout son intérêt : on peut y payer un niveau élevé pour dix montures
    /// sans que les cinquante autres le paient.
    #[test]
    fn l_unite_libre_coute_le_cinquieme_du_bloc() {
        let economy = economy();
        let strategy = Strategy {
            bands: [1; 6],
            level: 60,
            optimakina_from: 11,
        };
        let (bloc, heures_bloc) = economy.unit_load(0, strategy);
        let (libre, heures_libre) = economy.unit_load(1, strategy);

        assert!((heures_bloc - heures_libre).abs() < 1e-9, "même cycle");
        assert!(
            (bloc as f64 / libre as f64 - 5.0).abs() < 0.01,
            "bloc {bloc} contre libre {libre}"
        );
    }

    /// Deux unités aux réglages différents divergent d'elles-mêmes : c'est le
    /// sens de « chacune sa timeline ».
    #[test]
    fn des_reglages_differents_donnent_des_rythmes_differents() {
        let economy = economy();
        let lente = Strategy {
            bands: [0; 6],
            level: 24,
            optimakina_from: 11,
        };
        let rapide = Strategy {
            bands: [2; 6],
            level: 24,
            optimakina_from: 11,
        };
        let (_, heures_lente) = economy.unit_load(1, lente);
        let (_, heures_rapide) = economy.unit_load(1, rapide);
        assert!(
            heures_lente > heures_rapide * 1.5,
            "{heures_lente} h contre {heures_rapide} h"
        );
    }

    #[test]
    fn un_tirage_ne_depend_que_de_ses_coordonnees() {
        let draws = Draws::new(5);
        assert_eq!(draws.at(3, 7, 0), draws.at(3, 7, 0));
        assert_ne!(draws.at(3, 7, 0), draws.at(3, 7, 1));
        assert_ne!(
            load_coord(0, 4),
            load_coord(1, 4),
            "deux unités ne partagent pas leurs tirages"
        );
        for coord in 0..50 {
            for slot in 0..25 {
                let value = draws.at(coord, slot, 0);
                assert!((0.0..1.0).contains(&value), "{value}");
            }
        }
    }

    #[test]
    fn le_pool_de_depart_est_jouable() {
        let catalog = muldo();
        let economy = economy();
        let stable = starting_stable(&catalog, &economy, &Draws::new(12345));

        assert_eq!(stable.len(), 100);
        for mount in &stable.mounts {
            let generation = catalog.generation(mount.color);
            assert!((2..=9).contains(&generation));
            let parents = mount.parents.expect("une gen ≥ 2 a des parents");
            assert_eq!(
                catalog.names_at(generation, parents[0], parents[1]),
                Some(mount.color)
            );
        }
    }

    #[test]
    fn le_tirage_est_reproductible() {
        let catalog = muldo();
        let economy = economy();
        assert_eq!(
            play(&catalog, &economy, &mut NeverBreeds, 42),
            play(&catalog, &economy, &mut NeverBreeds, 42)
        );
    }
}
