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
pub const ABREUVOIR_GATE: f64 = 3_000.0;

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

/// Une tâche **placée dans le temps**, ce que `schedule` calcule sans le dire.
///
/// La durée totale suffit pour choisir des bandes ; elle ne suffit pas pour
/// afficher un plan. L'écran (`src/lib/dofus/breeding/timeline.ts`) demande
/// quand chaque jauge démarre et combien de temps elle tourne — c'est-à-dire
/// exactement le `started`/`finished` que l'ordonnancement produit déjà et
/// jetait.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Slot {
    pub gauge: usize,
    pub points: f64,
    /// Secondes depuis le début de la fournée.
    pub start: f64,
    pub end: f64,
}

/// La durée et le coût d'une fournée, pour un choix de bande par jauge.
pub fn schedule(economy: &Economy, bands: [usize; GAUGES], xp_points: f64) -> Schedule {
    let price = |gauge: usize| economy.gauge_price(gauge, bands[gauge]);
    let (climber, _) = climb_and_return(economy, bands);
    let tasks = task_list(climber, other_serenity(climber), xp_points);

    let cost_per_enclos: f64 = tasks
        .iter()
        .map(|task| task.points * price(task.gauge))
        .sum();

    let rate = |gauge: usize| economy.band_rate(bands[gauge]);
    let seconds = makespan(&tasks, &rate).total;
    Schedule {
        hours: seconds / 3600.0,
        cost_per_enclos,
        climber,
    }
}

/// Le même ordonnancement, mais rendu tâche par tâche.
///
/// Les tâches de points nuls sont écartées : une Mangeoire à zéro point n'est
/// pas un événement de durée nulle, c'est un événement qui n'existe pas.
pub fn slots(economy: &Economy, bands: [usize; GAUGES], xp_points: f64) -> Vec<Slot> {
    let (climber, _) = climb_and_return(economy, bands);
    let tasks = task_list(climber, other_serenity(climber), xp_points);
    let rate = |gauge: usize| economy.band_rate(bands[gauge]);
    // Une entrée par **tranche continue** et non par tâche : une jauge qui
    // s'interrompt puis reprend produit deux créneaux, ce qui est la vérité de
    // l'enclos. L'écran comme la frise en dépendent — un créneau unique étalé sur
    // les trous annoncerait une jauge qui tourne alors qu'elle est à l'arrêt.
    let mut placed: Vec<Slot> = makespan(&tasks, &rate)
        .segments
        .into_iter()
        .filter(|&(index, start, end, _)| tasks[index].points > 0.0 && end > start)
        .map(|(index, start, end, points)| Slot {
            gauge: tasks[index].gauge,
            points,
            start,
            end,
        })
        .collect();
    placed.sort_by(|a, b| {
        a.start
            .partial_cmp(&b.start)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    placed
}

/// L'autre jauge de sérénité : elles sont interchangeables, donc l'une désigne
/// l'autre.
fn other_serenity(climber: usize) -> usize {
    if climber == BAFFEUR { CARESSEUR } else { BAFFEUR }
}

/// La montée va sur la sérénité la moins chère au point. Les deux jauges sont
/// interchangeables, donc c'est un choix gratuit — et il porte sur 10 000
/// points contre 5 001, ce qui n'est pas rien.
fn climb_and_return(economy: &Economy, bands: [usize; GAUGES]) -> (usize, usize) {
    let price = |gauge: usize| economy.gauge_price(gauge, bands[gauge]);
    if price(BAFFEUR) <= price(CARESSEUR) {
        (BAFFEUR, CARESSEUR)
    } else {
        (CARESSEUR, BAFFEUR)
    }
}

fn task_list(climber: usize, returner: usize, xp_points: f64) -> [Task; TASKS] {
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
    [
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
    ]
}

/// Simule l'ordonnancement à deux places.
///
/// Rend la durée totale en secondes, puis le départ et la fin de chaque tâche —
/// une tâche jamais lancée gardant `INFINITY`, ce qui la distingue d'une tâche
/// instantanée.
/// La durée d'un cycle : la meilleure des deux heuristiques.
///
/// Aucune ne domine l'autre, et c'est mesuré plutôt que supposé. Sur les 4 096
/// répartitions de bandes et quatre niveaux — 16 384 comparaisons — la préemptive
/// raccourcit **2 193** fournées, jusqu'à un quart, et en allonge **512**, jusqu'à
/// un cinquième.
///
/// Une régression sur cinq cents cas n'est pas acceptable pour un gain sur deux
/// mille : on calcule donc les deux et on garde la plus courte. Deux
/// ordonnancements de sept tâches coûtent quelques microsecondes, contre des
/// heures de fournée en jeu.
///
/// Ce n'est pas une élégance, c'est un aveu utile : le problème est
/// l'ordonnancement préemptif à contraintes de précédence sur deux machines, dont
/// l'optimum se calcule (Muntz–Coffman) mais demande du partage de capacité, pas
/// un placement discret. Les deux heuristiques encadrent cet optimum sans
/// l'atteindre — mesuré, il reste de l'ordre de dix pour cent sur les cas où la
/// Mangeoire est longue.
fn makespan(tasks: &[Task; TASKS], rate: &impl Fn(usize) -> f64) -> Placement {
    let mut best = makespan_blocking(tasks, rate);
    for other in [makespan_preemptive(tasks, rate), makespan_shared(tasks, rate)] {
        if other.total < best.total - 1e-9 {
            best = other;
        }
    }
    best
}

/// Un ordonnancement rendu : sa durée, et **les segments réellement joués**.
///
/// Les segments et non le seul couple début/fin, parce qu'une tâche préemptée
/// s'étale sur plus longtemps qu'elle ne travaille. La frise de `bin/bands` en
/// tirait un bloc plein qui mentait sur ses trous ; l'écran, lui, veut savoir
/// quand une jauge tourne pour de bon.
pub struct Placement {
    pub total: f64,
    /// `(tâche, début, fin, points servis)` pour chaque tranche continue.
    ///
    /// Les points sont **portés** et non déduits de la durée : une tâche qui
    /// partage une place avance à vitesse réduite, donc `durée × cadence` la
    /// surcompterait — mesuré, l'Abreuvoir s'affichait à 31 272 points au lieu de
    /// 20 000.
    pub segments: Vec<(usize, f64, f64, f64)>,
}

impl Placement {
    fn of(segments: Vec<(usize, f64, f64, f64)>) -> Self {
        let total = segments
            .iter()
            .fold(0.0f64, |longest, &(_, _, end, _)| longest.max(end));
        Self { total, segments }
    }
}

/// L'ordonnancement d'un cycle avec **partage de capacité** : Muntz–Coffman.
///
/// Les deux autres heuristiques placent des tâches ; celle-ci répartit du débit.
/// Quand deux tâches prêtes se disputent une seule place, les servir l'une après
/// l'autre laisse la seconde place chômer à la fin — alors que les faire avancer
/// **ensemble à mi-vitesse** les amène à égalité, si bien qu'elles finissent de
/// front dès qu'une place se libère.
///
/// C'est le mainteneur qui l'a vu, et sur un cas où ça se chiffre : « si je coupe
/// l'Abreuvoir à son milieu et lance le Foudroyeur, quand le Foudroyeur arrive à
/// son milieu je peux relancer l'Abreuvoir ». Une place libre pendant 2,43 h puis
/// deux places, pour 5,56 h de travail restant, donne `(5,56 − 2,43) / 2 = 1,57 h`
/// après la Mangeoire — 8,87 h au lieu de 10,08.
///
/// Une part fractionnaire n'est pas une fiction physique : c'est l'alternance que
/// le jeu autorise, une jauge se mettant en pause et reprenant où elle en était.
/// À la limite continue, alterner et partager donnent la même date de fin.
///
/// Muntz–Coffman est **optimal** pour deux machines préemptives à contraintes de
/// précédence. Il reste ici une approximation, parce qu'une jauge ne peut pas
/// porter deux tâches à la fois — une contrainte de ressource que l'algorithme
/// d'origine ne connaît pas. D'où le garde-fou de `makespan` : on garde la plus
/// courte des trois, jamais celle-ci par principe.
fn makespan_shared(tasks: &[Task; TASKS], rate: &impl Fn(usize) -> f64) -> Placement {
    let mut segments: Vec<(usize, f64, f64, f64)> = Vec::new();
    // Deux tranches consécutives d'une même tâche n'en font qu'une : c'est le
    // découpage de la boucle d'événements, pas une interruption réelle.
    let record =
        |index: usize, from: f64, to: f64, points: f64, segments: &mut Vec<(usize, f64, f64, f64)>| {
            if to <= from + 1e-9 {
                return;
            }
            if let Some(last) = segments
                .iter_mut()
                .rev()
                .find(|(task, _, _, _)| *task == index)
            {
                if (last.2 - from).abs() < 1e-9 {
                    last.2 = to;
                    last.3 += points;
                    return;
                }
            }
            segments.push((index, from, to, points));
        };
    let speed = |index: usize| rate(tasks[index].gauge);
    let length = |index: usize| {
        let rate = speed(index);
        if rate > 0.0 { tasks[index].points / rate } else { 0.0 }
    };

    let mut height = [0.0f64; TASKS];
    for index in (0..TASKS).rev() {
        let mut below = 0.0f64;
        for successor in 0..TASKS {
            if let Some((predecessor, _)) = tasks[successor].after {
                if predecessor == index {
                    below = below.max(height[successor]);
                }
            }
        }
        height[index] = length(index) + below;
    }

    let mut remaining = [0.0f64; TASKS];
    let mut done = [0.0f64; TASKS];
    let mut started = [f64::INFINITY; TASKS];
    let mut finished = [f64::INFINITY; TASKS];
    for index in 0..TASKS {
        remaining[index] = if speed(index) > 0.0 { tasks[index].points } else { 0.0 };
    }

    let mut now = 0.0f64;
    let mut guard = 0;
    loop {
        guard += 1;
        assert!(guard < 512, "l'ordonnancement partagé doit converger");

        let mut ready: Vec<usize> = (0..TASKS)
            .filter(|&index| remaining[index] > 1e-9)
            .filter(|&index| match tasks[index].after {
                None => true,
                Some((predecessor, progress)) => done[predecessor] >= progress - 1e-9,
            })
            .collect();
        if ready.is_empty() {
            break;
        }
        ready.sort_by(|&a, &b| {
            height[b]
                .partial_cmp(&height[a])
                .unwrap_or(std::cmp::Ordering::Equal)
                .then(a.cmp(&b))
        });

        // Une jauge ne porte qu'une tâche : on écarte les doublons avant de
        // répartir, sans quoi on lui donnerait deux parts qu'elle ne peut pas
        // servir.
        let mut eligible: Vec<usize> = Vec::new();
        for &index in &ready {
            if !eligible
                .iter()
                .any(|&other| tasks[other].gauge == tasks[index].gauge)
            {
                eligible.push(index);
            }
        }

        // La part de chacun : les plus hautes d'abord, et le palier qui déborde se
        // partage également ce qui reste.
        let mut share = [0.0f64; TASKS];
        let mut free = PARALLEL_SLOTS as f64;
        let mut at = 0usize;
        while at < eligible.len() && free > 1e-9 {
            let mut tier = vec![eligible[at]];
            while at + tier.len() < eligible.len()
                && (height[eligible[at + tier.len()]] - height[eligible[at]]).abs() < 1e-9
            {
                tier.push(eligible[at + tier.len()]);
            }
            let each = (free / tier.len() as f64).min(1.0);
            for &index in &tier {
                share[index] = each;
            }
            free -= each * tier.len() as f64;
            at += tier.len();
        }

        // Le prochain instant utile : une tâche qui finit, ou un seuil franchi.
        let mut step = f64::INFINITY;
        for index in 0..TASKS {
            if share[index] > 1e-9 {
                step = step.min(remaining[index] / (speed(index) * share[index]));
            }
        }
        for index in 0..TASKS {
            if remaining[index] <= 1e-9 {
                continue;
            }
            if let Some((predecessor, progress)) = tasks[index].after {
                if done[predecessor] < progress && share[predecessor] > 1e-9 {
                    let missing = progress - done[predecessor];
                    step = step.min(missing / (speed(predecessor) * share[predecessor]));
                }
            }
        }
        if !step.is_finite() || step <= 0.0 {
            break;
        }

        // Les parts deviennent des créneaux : règle de McNaughton. On remplit la
        // première place de bout en bout, puis la seconde, et une tâche qui
        // déborde se coupe au passage.
        //
        // C'est la seconde moitié de Muntz–Coffman, et sans elle l'algorithme ne
        // rend qu'un débit — « chacune à mi-vitesse » — dont on ne peut rien faire
        // devant l'enclos. Ici on rend un emploi du temps : l'Abreuvoir jusque-là,
        // puis le Foudroyeur, puis les deux.
        //
        // Une tâche ne se retrouve jamais sur deux places au même instant, et ce
        // n'est pas un hasard : sa charge vaut au plus `step`, donc le morceau
        // laissé sur la place suivante finit avant que le premier ne commence.
        let mut cursor = 0.0f64;
        for &index in &eligible {
            if share[index] <= 1e-9 {
                continue;
            }
            if !started[index].is_finite() {
                started[index] = now;
            }
            let mut left = share[index] * step;
            while left > 1e-12 {
                let machine = (cursor / step).floor();
                let within = cursor - machine * step;
                let take = left.min(step - within);
                if take <= 1e-12 {
                    break;
                }
                record(
                    index,
                    now + within,
                    now + within + take,
                    take * speed(index),
                    &mut segments,
                );
                cursor += take;
                left -= take;
            }

            let served = (step * speed(index) * share[index]).min(remaining[index]);
            done[index] += served;
            remaining[index] -= served;
            if remaining[index] <= 1e-9 {
                remaining[index] = 0.0;
                finished[index] = now + step;
            }
        }
        now += step;
    }

    let _ = (&started, &finished);
    Placement::of(segments)
}

/// L'ordonnancement d'un cycle, **préemptif**.
///
/// Une jauge se met en pause et reprend où elle en était : c'est une règle du jeu,
/// et le modèle faisait l'hypothèse inverse. Il plaçait chaque tâche d'un bloc, si
/// bien qu'une place libérée à mi-parcours ne servait à rien tant que la tâche en
/// cours n'avait pas fini — l'Abreuvoir monopolisait la seule place libre pendant
/// que le Foudroyeur attendait la Mangeoire, alors que les deux pouvaient se
/// partager le temps disponible et finir ensemble.
///
/// Mesuré sur `221111` au niveau 60 : 10,35 h non préemptif contre 8,87 h ici, soit
/// **quatorze pour cent** de chaque fournée. Ce n'est pas un raffinement : c'est
/// une durée fausse dans tout ce qui la lit — le prix d'un chargement, le choix des
/// bandes, l'horizon d'une partie.
///
/// ## Ce que la préemption change au calcul des dépendances
///
/// `after` porte un **seuil de points** sur la tâche qui précède, pas un délai.
/// Sans préemption on pouvait le convertir en date une fois pour toutes —
/// `début + seuil / vitesse`. Une tâche qui s'interrompt casse cette formule : le
/// seuil se franchit quand le **cumul** l'atteint, ce qui dépend des segments
/// réellement joués. On suit donc l'avancement, et on recalcule.
///
/// ## La priorité est le chemin restant, pas le travail restant
///
/// Servir la tâche la plus longue d'abord (LRPT) est optimal sans contrainte de
/// précédence, et franchement mauvais avec : la Mangeoire est de loin la plus
/// longue, donc elle monopolise une place et affame la chaîne
/// Baffeur → Dragofesse → sérénité → Foudroyeur qui décide de la fin. Essayé :
/// le niveau que la Mangeoire livre gratuitement tombait de 43 à 26.
///
/// On classe donc par **hauteur** — la durée d'une tâche plus le plus long chemin
/// qui en dépend — ce qui est la priorité de Hu, et l'ordonnancement optimal pour
/// deux places quand le graphe est une forêt. Le nôtre n'en est pas tout à fait
/// une, mais la hauteur reste la bonne lecture : ce qui commande, c'est ce qui
/// reste **après**.
fn makespan_preemptive(tasks: &[Task; TASKS], rate: &impl Fn(usize) -> f64) -> Placement {
    let mut segments: Vec<(usize, f64, f64, f64)> = Vec::new();
    // Deux tranches consécutives d'une même tâche n'en font qu'une : c'est le
    // découpage de la boucle d'événements, pas une interruption réelle.
    let record =
        |index: usize, from: f64, to: f64, points: f64, segments: &mut Vec<(usize, f64, f64, f64)>| {
            if to <= from + 1e-9 {
                return;
            }
            if let Some(last) = segments
                .iter_mut()
                .rev()
                .find(|(task, _, _, _)| *task == index)
            {
                if (last.2 - from).abs() < 1e-9 {
                    last.2 = to;
                    last.3 += points;
                    return;
                }
            }
            segments.push((index, from, to, points));
        };
    let speed = |index: usize| rate(tasks[index].gauge);
    let length = |index: usize| {
        let rate = speed(index);
        if rate > 0.0 { tasks[index].points / rate } else { 0.0 }
    };

    // La hauteur de chaque tâche : sa durée plus le plus long chemin qui en
    // dépend. Calculée à rebours — les tâches sont déjà rangées par dépendance,
    // donc un simple parcours arrière suffit et l'assertion le vérifie.
    let mut height = [0.0f64; TASKS];
    for index in (0..TASKS).rev() {
        let mut below = 0.0f64;
        for successor in 0..TASKS {
            if let Some((predecessor, _)) = tasks[successor].after {
                if predecessor == index {
                    debug_assert!(successor > index, "les tâches doivent être rangées par dépendance");
                    below = below.max(height[successor]);
                }
            }
        }
        height[index] = length(index) + below;
    }

    let mut remaining = [0.0f64; TASKS];
    let mut done = [0.0f64; TASKS];
    let mut started = [f64::INFINITY; TASKS];
    let mut finished = [f64::INFINITY; TASKS];
    for index in 0..TASKS {
        remaining[index] = if speed(index) > 0.0 { tasks[index].points } else { 0.0 };
    }

    let mut now = 0.0f64;
    let mut guard = 0;
    loop {
        guard += 1;
        assert!(guard < 256, "l'ordonnancement doit converger");

        // Ce qui peut tourner : du travail restant, et le seuil de la tâche qui
        // précède déjà franchi.
        let mut ready: Vec<usize> = (0..TASKS)
            .filter(|&index| remaining[index] > 1e-9)
            .filter(|&index| match tasks[index].after {
                None => true,
                Some((predecessor, progress)) => done[predecessor] >= progress - 1e-9,
            })
            .collect();
        if ready.is_empty() {
            break;
        }

        // Le plus de travail restant d'abord, et jamais deux tâches sur la même
        // jauge : les deux segments de descente sont sur la sérénité, et rien
        // d'autre ne l'interdisait — l'ordonnancement les lançait ensemble et
        // rendait une fournée plus courte que le parc ne peut la faire.
        ready.sort_by(|&a, &b| {
            height[b]
                .partial_cmp(&height[a])
                .unwrap_or(std::cmp::Ordering::Equal)
                // À hauteur égale, le plus de travail restant : c'est LRPT, qui
                // départage bien ce que la précédence ne départage plus.
                .then_with(|| {
                    let left = remaining[b] / speed(b).max(1e-9);
                    let right = remaining[a] / speed(a).max(1e-9);
                    left.partial_cmp(&right).unwrap_or(std::cmp::Ordering::Equal)
                })
                .then(a.cmp(&b))
        });
        let mut running: Vec<usize> = Vec::with_capacity(PARALLEL_SLOTS);
        for index in ready {
            if running.len() >= PARALLEL_SLOTS {
                break;
            }
            if running.iter().any(|&other| tasks[other].gauge == tasks[index].gauge) {
                continue;
            }
            running.push(index);
        }
        if running.is_empty() {
            break;
        }

        // Le prochain instant utile : une tâche qui finit, ou un seuil qu'une
        // tâche en cours fait franchir — ce dernier peut libérer une dépendance
        // et rendre le placement courant obsolète avant la fin de quoi que ce soit.
        let mut step = f64::INFINITY;
        for &index in &running {
            step = step.min(remaining[index] / speed(index));
        }
        for index in 0..TASKS {
            if remaining[index] <= 1e-9 {
                continue;
            }
            if let Some((predecessor, progress)) = tasks[index].after {
                if done[predecessor] < progress && running.contains(&predecessor) {
                    let missing = progress - done[predecessor];
                    step = step.min(missing / speed(predecessor));
                }
            }
        }
        if !step.is_finite() || step <= 0.0 {
            break;
        }

        for &index in &running {
            if !started[index].is_finite() {
                started[index] = now;
            }
            let served = (step * speed(index)).min(remaining[index]);
            record(index, now, now + step, served, &mut segments);
            done[index] += served;
            remaining[index] -= served;
            if remaining[index] <= 1e-9 {
                remaining[index] = 0.0;
                finished[index] = now + step;
            }
        }
        now += step;
    }

    let _ = (&started, &finished);
    Placement::of(segments)
}

fn makespan_blocking(tasks: &[Task; TASKS], rate: &impl Fn(usize) -> f64) -> Placement {
    let mut segments: Vec<(usize, f64, f64, f64)> = Vec::new();
    // Deux tranches consécutives d'une même tâche n'en font qu'une : c'est le
    // découpage de la boucle d'événements, pas une interruption réelle.
    let record =
        |index: usize, from: f64, to: f64, points: f64, segments: &mut Vec<(usize, f64, f64, f64)>| {
            if to <= from + 1e-9 {
                return;
            }
            if let Some(last) = segments
                .iter_mut()
                .rev()
                .find(|(task, _, _, _)| *task == index)
            {
                if (last.2 - from).abs() < 1e-9 {
                    last.2 = to;
                    last.3 += points;
                    return;
                }
            }
            segments.push((index, from, to, points));
        };
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
            // Une jauge déjà en train de tourner ne peut pas porter une seconde
            // tâche. Les deux segments de descente sont sur la **même** jauge de
            // sérénité — descendre jusqu'à +2000, puis franchir zéro — et rien
            // d'autre ici ne l'interdisait : l'ordonnancement les lançait
            // ensemble et rendait une fournée plus courte que le parc ne peut la
            // faire.
            if running
                .iter()
                .any(|&(other, _)| tasks[other].gauge == tasks[index].gauge)
            {
                continue;
            }
            started[index] = now;
            let end = now + duration(&tasks[index]);
            finished[index] = end;
            record(index, now, end, tasks[index].points, &mut segments);
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

    let _ = (&started, &finished);
    Placement::of(segments)
}

#[cfg(test)]
mod tests {
    /// Un ordonnancement doit être **jouable** : jamais plus de créneaux
    /// simultanés que l'enclos n'a de places, et jamais une jauge à deux endroits
    /// à la fois.
    ///
    /// C'est l'invariant que la règle de McNaughton garantit, et qui n'a rien
    /// d'évident quand on convertit des parts fractionnaires en créneaux réels :
    /// une tâche servie à mi-vitesse sur deux places consécutives se retrouverait
    /// à cheval sur elle-même si le découpage était naïf. Vérifié sur toutes les
    /// répartitions de bandes plutôt que sur un cas.
    #[test]
    fn un_ordonnancement_tient_dans_les_places_de_lenclos() {
        let economy = Economy::default();
        for code in 0..4096u32 {
            let mut bands = [0usize; GAUGES];
            let mut rest = code;
            for slot in bands.iter_mut() {
                *slot = (rest % 4) as usize;
                rest /= 4;
            }
            for level in [0u16, 42, 60, 120] {
                let placed = slots(&economy, bands, crate::economy::mount_xp_for_level(level));

                // Les bornes suffisent : le nombre de créneaux actifs ne change
                // qu'à un début ou à une fin.
                let mut instants: Vec<f64> = placed.iter().map(|slot| slot.start).collect();
                instants.extend(placed.iter().map(|slot| slot.end));
                for &at in &instants {
                    let inside = |slot: &Slot| slot.start <= at + 1e-6 && slot.end > at + 1e-6;
                    let busy = placed.iter().filter(|slot| inside(slot)).count();
                    assert!(
                        busy <= PARALLEL_SLOTS,
                        "bandes {bands:?}, niveau {level} : {busy} créneaux à {at:.1} s"
                    );
                    for gauge in 0..GAUGES {
                        let same = placed
                            .iter()
                            .filter(|slot| slot.gauge == gauge && inside(slot))
                            .count();
                        assert!(
                            same <= 1,
                            "bandes {bands:?}, niveau {level} : la jauge {gauge} tourne \
                             {same} fois à {at:.1} s"
                        );
                    }
                }
            }
        }
    }

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

    /// Le plan affiché doit finir quand la fournée finit.
    ///
    /// `schedule` et `slots` rejouent le même ordonnancement ; s'ils divergent,
    /// l'écran montre une fournée qui ne dure pas ce que le modèle a payé — et
    /// c'est le genre d'écart qu'on ne verrait qu'en comptant les heures à la
    /// main devant le jeu.
    #[test]
    fn le_plan_detaille_dure_ce_que_la_fournee_dure() {
        let economy = economy();
        for bands in [[0; GAUGES], [1; GAUGES], [3, 1, 1, 1, 0, 2], [0, 0, 1, 1, 1, 0]] {
            for xp in [0.0, 5_628.0, 40_000.0] {
                let plan = schedule(&economy, bands, xp);
                let placed = slots(&economy, bands, xp);
                let last = placed
                    .iter()
                    .fold(0.0f64, |longest, slot| longest.max(slot.end));
                assert!(
                    (last / 3600.0 - plan.hours).abs() < 1e-6,
                    "bandes {bands:?}, xp {xp} : plan détaillé {:.4} h, fournée {:.4} h",
                    last / 3600.0,
                    plan.hours
                );
            }
        }
    }

    /// Une jauge ne porte qu'une tâche à la fois.
    ///
    /// La descente de sérénité est coupée en deux et les deux moitiés sont sur
    /// la **même** jauge : rien dans les précédences ne l'empêchait de les
    /// lancer ensemble, ce qui rendait une fournée plus courte que le parc ne
    /// peut la faire. Le défaut était invisible tant qu'on ne consommait que la
    /// durée totale ; il est apparu au premier plan affiché.
    #[test]
    fn deux_taches_ne_partagent_jamais_une_jauge() {
        let economy = economy();
        for bands in [
            [0; GAUGES],
            [1; GAUGES],
            [3; GAUGES],
            [0, 0, 1, 1, 1, 0], // le champion : 001110
            [3, 1, 1, 1, 0, 2],
        ] {
            for xp in [0.0, 5_628.0, 20_460.0, 40_000.0] {
                let placed = slots(&economy, bands, xp);
                for (index, a) in placed.iter().enumerate() {
                    for b in placed.iter().skip(index + 1) {
                        if a.gauge != b.gauge {
                            continue;
                        }
                        assert!(
                            b.start >= a.end - 1e-6 || a.start >= b.end - 1e-6,
                            "bandes {bands:?}, xp {xp} : {} tourne deux fois à la fois \
                             ({:.0}–{:.0} s et {:.0}–{:.0} s)",
                            GAUGE_NAMES[a.gauge],
                            a.start,
                            a.end,
                            b.start,
                            b.end
                        );
                    }
                }
            }
        }
    }

    /// Une Mangeoire à zéro point ne doit pas produire d'événement.
    #[test]
    fn une_jauge_sans_points_ne_fait_pas_evenement() {
        let economy = economy();
        let placed = slots(&economy, [1; GAUGES], 0.0);
        assert!(
            placed.iter().all(|slot| slot.gauge != MANGEOIRE),
            "la Mangeoire à 0 point ne devrait rien émettre : {placed:?}"
        );
        assert_eq!(placed.len(), TASKS - 1, "les six autres tâches restent");
    }
}
