//! Combien de temps dure une fournée, et ce qu'elle coûte en carburant.
//!
//! ## Ce n'est plus une division
//!
//! Le modèle précédent divisait 75 010 points par un débit unique. C'était faux
//! sur trois points, et chacun change le résultat :
//!
//! 1. **Deux jauges tournent en parallèle.** La durée est donc un *makespan*,
//!    pas une somme.
//! 2. **Chaque jauge a sa propre bande**, donc son propre débit et son propre
//!    prix au point. On peut payer cher ce qui est sur le chemin critique et
//!    laisser le reste au tarif le plus bas.
//! 3. **La Mangeoire occupe une des deux places.** Le niveau d'XP ne coûte donc
//!    plus seulement des kamas, il coûte des *heures* — et à niveau 67 elle dure
//!    à elle seule 9 h 24 en bande basse, soit autant que toute la fournée.
//!
//! ## L'ordonnancement, relevé en jeu
//!
//! Les jauges ne se lancent pas dans n'importe quel ordre : la sérénité, qui va
//! de −5000 à +5000, ouvre et ferme les autres.
//!
//! ```text
//!   1. amener toute la fournée à un extrême (±5000)   — 10 000 points
//!      pendant ce temps, seule la Mangeoire peut tourner
//!   2. sérénité au bout → lancer la 1re stat           — 20 000
//!   3. redescendre la sérénité vers 0                  —  5 001
//!   4. entre −2000 et +2000 → lancer l'Abreuvoir       — 20 000
//!   5. de l'autre côté de 0 → lancer la 2e stat        — 20 000
//! ```
//!
//! Total 75 001, à comparer aux 75 010 de `CYCLE_POINTS` dans `enclos.ts` : le
//! découpage est le bon.
//!
//! ## Une jauge hors de sa fenêtre s'arrête
//!
//! Elle ne ralentit pas : elle s'arrête. C'est ce qui contraint réellement
//! l'ordonnancement, et c'est ce que la première version ratait — elle traitait
//! les conditions de sérénité comme des portes d'entrée qu'on franchit une fois.
//!
//! Les fenêtres, confirmées par le mainteneur :
//!
//! | jauge | fenêtre de sérénité |
//! | --- | --- |
//! | Foudroyeur | `[-5000, -1]` |
//! | Dragofesse | `[+1, +5000]` — la miroir |
//! | Abreuvoir | `[-2000, +2000]` |
//!
//! La première stat est donc forcément celle du côté où l'on est monté. Et
//! surtout : **franchir zéro couperait cette première stat en cours de route**,
//! donc la descente doit s'arrêter à +2000 et attendre. On descend en deux temps.
//!
//! Ce qui sauve l'affaire, c'est que **−1 ouvre les deux dernières jauges à la
//! fois** : il est dans `[-2000, +2000]` pour l'Abreuvoir et dans `[-5000, -1]`
//! pour le Foudroyeur. On s'y gare et les deux tournent ensemble. Sans cette
//! coïncidence des fenêtres, la fournée serait bien plus longue.
//!
//! ## Les cinq enclos sont identiques, et c'est une contrainte d'usage
//!
//! Rien dans le jeu ne l'impose : chaque enclos a ses propres jauges, donc on
//! pourrait leur donner des bandes et des niveaux différents. Un enclos « cher
//! et précis » à haut niveau pour les paires de génération 9, quatre enclos
//! « jetables » à niveau 1 pour le reste — le calcul est même favorable, puisque
//! monter dix montures au niveau 150 coûte 250 000 contre 2 447 000 pour les
//! cinquante.
//!
//! On ne le modélise pas, et la raison n'est pas technique : **cinq enclos aux
//! rythmes différents demandent une intervention toutes les trois minutes**. Une
//! politique qu'un humain ne peut pas exécuter ne vaut rien, quel que soit son
//! score. La contrainte est donc d'usage, et elle écarte une famille entière de
//! stratégies — ce qui mérite d'être écrit, sans quoi on la rouvre.
//!
//! Conséquence directe : une fournée est un bloc de cinquante, les cinq enclos
//! démarrent et finissent ensemble, et le coût d'un réglage se paie cinq fois.
//!
//! ## Mettre une jauge en pause est gratuit
//!
//! Confirmé aussi, et tout le modèle en dépend : cesser de nourrir une jauge
//! fige sa progression sans rien perdre, et elle ne se vide pas toute seule. La
//! sérénité est donc une **position qu'on choisit**, pas une course qu'il
//! faudrait mener d'un trait — sans quoi il n'y aurait pas d'ordonnancement à
//! optimiser, juste une somme à subir.
//!
//! ## Les 10 000 points vont sur la moins chère
//!
//! Baffeur et Caresseur sont interchangeables : l'une monte, l'autre redescend.
//! On met donc la montée (10 000 points) sur celle dont le point coûte le moins
//! cher à sa bande, et la descente (5 001) sur l'autre. Ce n'est pas une
//! heuristique devinée mais une comparaison de deux nombres.
//!
//! ## L'ordonnanceur est glouton, et il le dit
//!
//! À chaque place qui se libère, on lance la tâche prête la plus longue. C'est
//! l'heuristique LPT, elle n'est pas optimale, et sur sept tâches l'écart à
//! l'optimum est petit. Ce qui compte davantage est qu'elle soit **déterministe**
//! et lisible : une durée de fournée qui dépendrait d'un ordre de parcours
//! rendrait deux mesures incomparables.

use crate::economy::Economy;

pub const GAUGES: usize = 6;
pub const BAFFEUR: usize = 0;
pub const CARESSEUR: usize = 1;
pub const FOUDROYEUR: usize = 2;
pub const DRAGOFESSE: usize = 3;
pub const ABREUVOIR: usize = 4;
pub const MANGEOIRE: usize = 5;

pub const GAUGE_NAMES: [&str; GAUGES] = [
    "Baffeur",
    "Caresseur",
    "Foudroyeur",
    "Dragofesse",
    "Abreuvoir",
    "Mangeoire",
];

/// Amener toute la fournée à un extrême. Chaque monture part d'une sérénité
/// tirée au hasard dans `[-5000, +5000]`, donc la plus éloignée demande la
/// course entière.
pub const SERENITY_CLIMB: f64 = 10_000.0;
/// Redescendre de l'extrême jusqu'à ±1.
pub const SERENITY_RETURN: f64 = 5_001.0;
pub const STAT_POINTS: f64 = 20_000.0;
/// Points de descente au bout desquels la sérénité entre dans `[-2000, +2000]`
/// et libère l'Abreuvoir.
const ABREUVOIR_GATE: f64 = 3_000.0;

/// Deux jauges à la fois, Mangeoire comprise.
pub const PARALLEL_SLOTS: usize = 2;

/// Les tâches d'un cycle. Sept et non six : la descente de sérénité est coupée
/// en deux, parce qu'une jauge hors de sa fenêtre s'arrête au lieu de ralentir.
const TASKS: usize = 7;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Schedule {
    /// Durée de la fournée, hors manipulation entre fournées.
    pub hours: f64,
    /// Carburant pour un enclos.
    pub cost_per_enclos: f64,
    /// Quelle jauge porte la montée de sérénité, l'autre portant la descente.
    pub climber: usize,
}

/// Une tâche du cycle : des points sur une jauge, et ce qui doit l'avoir
/// précédée.
#[derive(Clone, Copy)]
struct Task {
    gauge: usize,
    points: f64,
    /// Indice de la tâche dont il faut attendre une progression, et de combien.
    /// `None` pour les tâches lançables d'emblée.
    after: Option<(usize, f64)>,
}

/// La durée et le coût d'une fournée, pour un choix de bande par jauge.
pub fn schedule(economy: &Economy, bands: [usize; GAUGES], xp_points: f64) -> Schedule {
    let rate = |gauge: usize| economy.band_rate(bands[gauge]);
    let price = |gauge: usize| economy.gauge_price(gauge, bands[gauge]);

    // La montée va sur la sérénité la moins chère au point. Les deux jauges sont
    // interchangeables, donc c'est un choix gratuit — et il porte sur 10 000
    // points contre 5 001, ce qui n'est pas rien.
    let (climber, returner) = if price(BAFFEUR) <= price(CARESSEUR) {
        (BAFFEUR, CARESSEUR)
    } else {
        (CARESSEUR, BAFFEUR)
    };

    // Indices : 0 montée, 1 Mangeoire, 2 descente jusqu'à la fenêtre de
    // l'Abreuvoir, 3 première stat, 4 Abreuvoir, 5 passage de zéro,
    // 6 seconde stat.
    //
    // La descente est **coupée en deux** parce qu'une jauge hors de sa fenêtre
    // ne ralentit pas : elle s'arrête. La première stat ne tourne qu'en sérénité
    // positive, donc franchir zéro avant qu'elle ait fini la couperait net —
    // d'où l'attente. On peut en revanche descendre jusqu'à +2000 sans risque,
    // ce qui ouvre l'Abreuvoir pendant que la première stat tourne encore.
    //
    // Une fois garé à −1, tout reste ouvert : −1 est à la fois dans
    // `[-2000, +2000]` pour l'Abreuvoir et dans `[-5000, -1]` pour le
    // Foudroyeur. La sérénité ne bouge que si on la pousse, donc les deux
    // dernières stats tournent ensemble sans rien casser.
    let tasks = [
        Task {
            gauge: climber,
            points: SERENITY_CLIMB,
            after: None,
        },
        Task {
            gauge: MANGEOIRE,
            points: xp_points,
            after: None,
        },
        Task {
            gauge: returner,
            points: ABREUVOIR_GATE,
            after: Some((0, SERENITY_CLIMB)),
        },
        Task {
            gauge: DRAGOFESSE,
            points: STAT_POINTS,
            after: Some((0, SERENITY_CLIMB)),
        },
        Task {
            gauge: ABREUVOIR,
            points: STAT_POINTS,
            after: Some((2, ABREUVOIR_GATE)),
        },
        Task {
            // Franchir zéro coupe la première stat : on attend qu'elle ait fini.
            gauge: returner,
            points: SERENITY_RETURN - ABREUVOIR_GATE,
            after: Some((3, STAT_POINTS)),
        },
        Task {
            // Le Foudroyeur ne tourne qu'en sérénité négative.
            gauge: FOUDROYEUR,
            points: STAT_POINTS,
            after: Some((5, SERENITY_RETURN - ABREUVOIR_GATE)),
        },
    ];

    let cost_per_enclos: f64 = tasks
        .iter()
        .map(|task| task.points * price(task.gauge))
        .sum();

    let hours = makespan(&tasks, &rate) / 3600.0;
    Schedule {
        hours,
        cost_per_enclos,
        climber,
    }
}

/// Simule l'ordonnancement à deux places et rend la durée en secondes.
fn makespan(tasks: &[Task; TASKS], rate: &impl Fn(usize) -> f64) -> f64 {
    let duration = |task: &Task| {
        let rate = rate(task.gauge);
        if rate > 0.0 { task.points / rate } else { 0.0 }
    };

    let mut started = [f64::INFINITY; TASKS];
    let mut finished = [f64::INFINITY; TASKS];
    let mut running: Vec<(usize, f64)> = Vec::with_capacity(PARALLEL_SLOTS);
    let mut pending: Vec<usize> = (0..TASKS).filter(|&i| tasks[i].points > 0.0).collect();
    let mut now = 0.0f64;

    // Le moment où une tâche devient lançable : soit tout de suite, soit quand
    // celle qui la précède a franchi son seuil de progression.
    let ready_at = |task: &Task, started: &[f64; TASKS], rate: &dyn Fn(usize) -> f64| match task.after {
        None => Some(0.0),
        Some((predecessor, progress)) => {
            let start = started[predecessor];
            if !start.is_finite() {
                return None;
            }
            let speed = rate(tasks[predecessor].gauge);
            Some(if speed > 0.0 {
                start + progress / speed
            } else {
                f64::INFINITY
            })
        }
    };

    let mut guard = 0;
    while !pending.is_empty() || !running.is_empty() {
        guard += 1;
        assert!(guard < 64, "l'ordonnancement doit converger");

        // Ce qui est lançable maintenant, la plus longue d'abord (LPT).
        let mut launchable: Vec<usize> = pending
            .iter()
            .copied()
            .filter(|&index| {
                ready_at(&tasks[index], &started, &|gauge| rate(gauge))
                    .is_some_and(|at| at <= now + 1e-9)
            })
            .collect();
        launchable.sort_by(|&a, &b| {
            duration(&tasks[b])
                .partial_cmp(&duration(&tasks[a]))
                .unwrap_or(std::cmp::Ordering::Equal)
                .then(a.cmp(&b))
        });

        for index in launchable {
            if running.len() >= PARALLEL_SLOTS {
                break;
            }
            started[index] = now;
            let end = now + duration(&tasks[index]);
            finished[index] = end;
            running.push((index, end));
            pending.retain(|&pending_index| pending_index != index);
        }

        // Le prochain instant utile : une fin de tâche, ou l'ouverture d'une
        // porte de sérénité si aucune place ne se libère avant.
        let next_finish = running
            .iter()
            .map(|&(_, end)| end)
            .fold(f64::INFINITY, f64::min);
        let next_gate = pending
            .iter()
            .filter_map(|&index| ready_at(&tasks[index], &started, &|gauge| rate(gauge)))
            .filter(|&at| at > now + 1e-9)
            .fold(f64::INFINITY, f64::min);

        let next = if running.len() < PARALLEL_SLOTS {
            next_finish.min(next_gate)
        } else {
            next_finish
        };
        if !next.is_finite() {
            // Plus rien ne peut démarrer : une dépendance est insatisfiable.
            // Ne devrait pas arriver, mais mieux vaut une durée finie qu'une
            // boucle.
            break;
        }
        now = next;
        running.retain(|&(_, end)| end > now + 1e-9);
    }

    finished
        .iter()
        .filter(|end| end.is_finite())
        .fold(0.0, |longest, &end| longest.max(end))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::Prices;

    fn economy() -> Economy {
        Prices::load_default().expect("economy.toml").economy
    }

    #[test]
    fn le_decoupage_somme_au_cycle_connu() {
        // 75 010 dans `enclos.ts`, relevé en jeu. Si le découpage dérive, les
        // durées et les coûts dérivent avec.
        let total = SERENITY_CLIMB + SERENITY_RETURN + 3.0 * STAT_POINTS;
        assert!(
            (total - 75_010.0).abs() <= 10.0,
            "le cycle vaut {total}, attendu ~75 010"
        );
    }

    #[test]
    fn le_parallelisme_raccourcit_sans_faire_de_miracle() {
        let economy = economy();
        let bands = [1; GAUGES];
        let plan = schedule(&economy, bands, 5_628.0); // niveau 23

        // Séquentiel, 75 001 points à 2 pts/s, ce serait 10 h 25. À deux places
        // la borne basse est la moitié, mais les précédences l'empêchent :
        // l'Abreuvoir attend la descente, la seconde stat attend le passage à
        // zéro.
        assert!(
            plan.hours > 5.2 && plan.hours < 10.5,
            "durée {} h hors de l'intervalle plausible",
            plan.hours
        );
    }

    #[test]
    fn la_mangeoire_allonge_la_fournee() {
        // C'est le couplage que l'ancien modèle ratait : nourrir occupe une
        // place, donc un niveau élevé coûte des heures en plus des kamas.
        let economy = economy();
        let bands = [1; GAUGES];
        let court = schedule(&economy, bands, 5_628.0); // niveau 23
        let long = schedule(&economy, bands, 67_700.0); // niveau 67

        assert!(
            long.hours > court.hours,
            "niveau 67 ({} h) devrait durer plus que niveau 23 ({} h)",
            long.hours,
            court.hours
        );
    }

    #[test]
    fn une_bande_plus_rapide_ne_rallonge_jamais() {
        let economy = economy();
        let mut previous = f64::INFINITY;
        for band in 0..4 {
            let plan = schedule(&economy, [band; GAUGES], 5_628.0);
            assert!(
                plan.hours <= previous + 1e-9,
                "bande {band} ({} h) plus lente que la précédente ({previous} h)",
                plan.hours
            );
            previous = plan.hours;
        }
    }

    #[test]
    fn la_montee_va_sur_la_serenite_la_moins_chere() {
        let economy = economy();
        // À bande égale, le Baffeur est moins cher que le Caresseur partout.
        for band in 0..4 {
            let plan = schedule(&economy, [band; GAUGES], 5_628.0);
            assert_eq!(
                plan.climber,
                BAFFEUR,
                "bande {band} : {} devrait porter la montée",
                GAUGE_NAMES[BAFFEUR]
            );
        }
    }

    /// Le gain que la bande par jauge autorise et que la bande unique interdit.
    #[test]
    fn payer_le_chemin_critique_seul_est_moins_cher() {
        let economy = economy();
        let uniforme = schedule(&economy, [2; GAUGES], 5_628.0);

        // Les stats sont sur le chemin critique ; la sérénité et la Mangeoire
        // beaucoup moins. On accélère les premières et on laisse les autres au
        // tarif du bas.
        let mut cible = [0usize; GAUGES];
        cible[FOUDROYEUR] = 2;
        cible[DRAGOFESSE] = 2;
        cible[ABREUVOIR] = 2;
        let cible = schedule(&economy, cible, 5_628.0);

        assert!(
            cible.cost_per_enclos < uniforme.cost_per_enclos,
            "ciblé {} vs uniforme {}",
            cible.cost_per_enclos,
            uniforme.cost_per_enclos
        );
    }
}
