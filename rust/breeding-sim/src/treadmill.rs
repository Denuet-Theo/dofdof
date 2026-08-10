//! Le tapis roulant : apprendre **qui apparier avec qui**, et rien d'autre.
//!
//! ## Ce qu'il retire, et pourquoi
//!
//! `economy.rs` fait jouer une partie entière : des kamas, des heures d'enclos,
//! un horizon, des bandes de jauge, un niveau de Mangeoire. Sept leviers, et le
//! module le dit lui-même — avec autant de leviers, on ne peut plus attribuer un
//! gain à l'un d'eux.
//!
//! Or la question posée ici est **une seule** : deux montures fécondes étant
//! données, laquelle avec laquelle, et quelles stériles cloner. Tout le reste est
//! du bruit qui rend la réponse plus difficile à lire.
//!
//! Le tapis retire donc l'économie entière. Pas de kamas, pas d'heures, pas
//! d'enclos. Ce qui reste est ce qui est rare **pour de vrai** dans cette
//! question-là : **chaque monture ne porte qu'une reproduction**. Choisir un
//! couple, c'est en dépenser deux.
//!
//! ## Comment l'enclos disparaît sans être supprimé
//!
//! Par la capacité, mise à **zéro**. Depuis que le cycle de fécondité s'est
//! détaché de l'accouplement, un croisement paie une place par parent qui doit
//! encore son cycle — donc zéro quand les deux sont fécondes. À capacité nulle,
//! la recherche ne peut plus proposer que ce qui ne coûte aucune place :
//! **croiser deux fécondes, cloner, sacrifier**. Exactement l'étape 1.
//!
//! Rien n'a été ajouté pour ça, et c'est la bonne nouvelle : le mécanisme des
//! places décrit le jeu, et l'étape 1 en est un cas particulier plutôt qu'un
//! environnement à part.
//!
//! ## Le cycle
//!
//! 1. l'optimiseur rend des couples de fécondes et des paires de stériles ;
//! 2. on applique — clonages, puis naissances ;
//! 3. on promeut **au hasard** 20, 80 ou 100 fertiles en fécondes, niveau tiré ;
//! 4. on **complète à 20 fertiles** chaque couleur de génération 1 ;
//! 5. on retire les gen 10, en les comptant ;
//! 6. on recommence.
//!
//! La promotion aléatoire tient lieu d'enclos : elle dit « voilà ce que tu peux
//! croiser ce tour-ci » sans que la politique ait son mot à dire. C'est
//! précisément la décision que l'étape 2 reprendra à son compte. Les trois
//! niveaux — 20, 80, 100 — forcent la politique à tenir dans un débit variable au
//! lieu d'apprendre un rythme.
//!
//! ## Compléter, et non ajouter
//!
//! Le vivier de gen 1 est **borné**, pas alimenté. Un robinet qui ajoute cent
//! têtes par cycle finirait par noyer l'écurie, et la promotion — tirée
//! uniformément parmi les fertiles — tomberait alors presque toujours sur des
//! gen 1. Le haut de l'arbre ne serait plus jamais fécondé, et le tapis
//! cesserait d'enseigner la montée pour une raison qui n'a rien à voir avec la
//! politique.
//!
//! ## La fitness
//!
//! Les **génétons**, cumulés. Trois raisons, et la troisième décide :
//!
//! - ils ne tombent qu'à la **naissance réussie**, donc ils ne comptent que les
//!   reproductions — une monture gardée n'en rend aucun, et thésauriser ne paie
//!   pas ;
//! - ils suivent les **parents** et non la cible, avec un rapport de 250 entre
//!   deux gen 9 et deux gen 1, donc croiser haut domine largement ;
//! - ils sont **relevés en jeu** et déjà calculés par `apply`. C'est une mesure,
//!   pas une pondération inventée pour l'occasion.
//!
//! Deux angles morts connus, à garder en tête en lisant un résultat. La
//! purification rend **zéro** — mesuré, voir #68 : deux Indigo capturés donnent
//! « Indigo 100 %, zéro géneton ». Et les ratés rendent zéro aussi, or ce sont eux
//! qui produisent les porteuses de raccourci. Dans les deux cas le gain existe
//! mais il est **différé** : il n'apparaît que dans les génétons des croisements
//! suivants, donc seulement si l'épisode est assez long. C'est la raison pour
//! laquelle la longueur est un paramètre et non une constante.

use crate::economy::{Draws, Economy, MAX_UNITS, Policy, Rng, Strategy, UnitView, apply_plan};
use crate::stable::{Mount, Sex, Stable};
use crate::trees::{Catalog, ColorId};

/// Les réglages du tapis. Aucun n'est une mesure ; tous se discutent.
#[derive(Clone, Copy, Debug)]
pub struct TreadmillConfig {
    /// Montures tirées au départ, états et ascendances compris.
    pub mounts: usize,
    /// Cycles avant de couper.
    ///
    /// C'est **le** paramètre qui choisit la politique, et pas seulement le coût.
    /// Sur un épisode court, l'optimum est de brûler le haut du stock : deux gen 9
    /// rendent 500 génétons tout de suite. Sur un épisode long, il faut les avoir
    /// produites, donc la montée redevient instrumentale. On mesure les deux au
    /// lieu de décréter.
    pub cycles: usize,
    /// Les débits possibles de la promotion, tirés à chaque cycle.
    pub promotions: [usize; 3],
    /// Fertiles à maintenir pour chaque couleur de génération 1.
    pub gen1_target: usize,
    /// Bornes du niveau tiré à la promotion.
    pub promotion_levels: (u16, u16),
    /// Poids du tirage initial, indexés par génération.
    ///
    /// Une **pyramide**, parce que c'est la forme d'une écurie réelle : beaucoup
    /// de bas, peu de haut. Un tirage uniforme sur les rangs donnerait autant de
    /// gen 9 que de gen 2, ce que personne ne possède, et la politique
    /// apprendrait à compter sur une abondance qui n'arrive jamais.
    ///
    /// La gen 1 pèse **zéro** : elle n'entre que par le complément, donc son
    /// vivier vaut vingt par couleur dès le premier cycle comme à tous les
    /// autres. La tirer en plus donnerait au départ une manne qui n'existe nulle
    /// part ailleurs dans l'épisode.
    pub weights: [usize; 11],
}

impl Default for TreadmillConfig {
    fn default() -> Self {
        Self {
            mounts: 1000,
            cycles: 30,
            promotions: [20, 80, 100],
            gen1_target: 20,
            promotion_levels: (1, 200),
            // 11 − génération, et zéro pour la gen 1.
            weights: [0, 0, 9, 8, 7, 6, 5, 4, 3, 2, 1],
        }
    }
}

/// Ce qu'un épisode a produit. `genetons` est la fitness ; le reste sert à lire
/// **pourquoi**, ce qu'un score seul ne dit jamais.
#[derive(Clone, Debug, Default)]
pub struct TreadmillOutcome {
    /// La fitness.
    pub genetons: i64,
    pub crossings: usize,
    pub clonings: usize,
    pub births: usize,
    /// Gen 10 retirées et comptées, tous cycles confondus.
    pub gen10_harvested: usize,
    /// Croisements dont les deux parents étaient de génération 1.
    ///
    /// Le symptôme à surveiller : deux gen 1 rendent 2 génétons, sans risque et
    /// sans rien apprendre. Si cette part domine, le tapis récompense le remplissage
    /// plutôt que la montée, et c'est le rapport entre le vivier de gen 1 et le
    /// débit de promotion qu'il faut revoir.
    pub gen1_crossings: usize,
    /// Montures sacrifiées — extraites en ambre.
    ///
    /// **Doit rester à zéro.** L'ambre convertit du stock en kamas, donc c'est un
    /// arbitrage économique et il relève de l'étape 2 ; l'action est fermée ici
    /// via `Searching::without_sacrifices`. Le compteur reste pour que sa
    /// réouverture accidentelle se voie tout de suite au lieu de se deviner.
    pub sacrifices: usize,
    /// La plus haute génération portée à la fin, fécondité mise à part.
    pub top_generation: u8,
    pub mounts_end: usize,
    /// Fournées refusées par `apply`. Doit rester à zéro.
    pub rejected: usize,
    /// Génétons cycle par cycle.
    ///
    /// C'est ce qui dit si l'épisode mesure un **régime établi** ou la liquidation
    /// de la dotation initiale. Une trajectoire qui s'aplatit autorise une période
    /// de chauffe ; une trajectoire qui décroît sans fin veut dire que le tapis
    /// n'est pas alimenté assez pour tourner, et aucune chauffe n'y changera rien.
    pub per_cycle: Vec<i64>,
}

/// Fait tourner un épisode et rend ce qu'il a produit.
pub fn play_treadmill(
    catalog: &Catalog,
    economy: &Economy,
    policy: &mut dyn Policy,
    seed: u32,
    config: &TreadmillConfig,
) -> TreadmillOutcome {
    let mut rng = Rng::new(seed);
    // Décalée comme dans `economy::run` : la politique ne doit pas pouvoir
    // rejouer le flux des naissances en devinant sa propre graine.
    let draws = Draws::new(seed ^ 0x5bf0_3635);
    let mut stable = random_stable(catalog, &mut rng, config);
    let mut outcome = TreadmillOutcome::default();

    let gen1: Vec<ColorId> = catalog.ids_at_generation(1).collect();
    // Avant le premier appel : sans ça le cycle 1 se jouerait sans aucune gen 1
    // alors que tous les suivants en portent vingt par couleur.
    top_up_gen1(&mut stable, catalog, &mut rng, &gen1, config.gen1_target);

    for cycle in 0..config.cycles {
        // --- 1. l'optimiseur --------------------------------------------------
        //
        // Capacité **zéro** : seul ce qui ne coûte aucune place est proposable,
        // c'est-à-dire croiser deux fécondes, cloner, sacrifier. L'enclos est hors
        // sujet ici, et c'est le mécanisme des places qui le dit, pas un drapeau.
        let plan = {
            let view = UnitView {
                catalog,
                economy,
                stable: &stable,
                // Assez pour que le plancher de solvabilité ne morde jamais :
                // il n'y a pas d'économie dans cette étape, et un refus pour
                // cause de kamas serait un artefact.
                kamas: i64::MAX / 4,
                unit: 0,
                strategy: Strategy::default(),
                capacity: 0,
            };
            policy.plan(&view, &mut rng)
        };

        // --- 2. on applique ---------------------------------------------------
        //
        // Les croisements gen 1 × gen 1 se comptent **avant** d'appliquer : après,
        // les parents sont stériles et leurs indices ont bougé.
        let gen1_crossings = plan
            .crossings
            .iter()
            .filter(|[male, female]| {
                [*male, *female].iter().all(|&index| {
                    stable
                        .mounts
                        .get(index)
                        .is_some_and(|mount| catalog.generation(mount.color) == 1)
                })
            })
            .count();

        match apply_plan(
            catalog,
            economy,
            &mut stable,
            &plan,
            Strategy::default(),
            &draws,
            cycle as u32,
        ) {
            Ok(applied) => {
                outcome.per_cycle.push(applied.genetons);
                outcome.genetons += applied.genetons;
                outcome.crossings += applied.crossings;
                outcome.clonings += applied.clonings;
                outcome.births += applied.births;
                outcome.gen1_crossings += gen1_crossings;
                outcome.sacrifices += applied.sacrifices;
            }
            Err(_) => {
                outcome.per_cycle.push(0);
                outcome.rejected += 1;
            }
        }

        // --- 3. la promotion, qui tient lieu d'enclos -------------------------
        let quota = config.promotions[index_in(&mut rng, config.promotions.len())];
        promote(&mut stable, &mut rng, quota, config.promotion_levels);

        // --- 4. compléter le vivier de gen 1 ----------------------------------
        top_up_gen1(&mut stable, catalog, &mut rng, &gen1, config.gen1_target);

        // --- 5. la récolte ----------------------------------------------------
        let top = catalog.top_generation();
        let harvested: Vec<usize> = stable
            .mounts
            .iter()
            .enumerate()
            .filter(|(_, mount)| catalog.generation(mount.color) >= top)
            .map(|(index, _)| index)
            .collect();
        outcome.gen10_harvested += harvested.len();
        stable.remove_all(&harvested);
    }

    outcome.top_generation = stable.top_generation(catalog);
    outcome.mounts_end = stable.len();
    outcome
}

/// Mille montures sans structure : sexe, niveau, état et ascendance tirés
/// indépendamment.
///
/// Volontairement plus divers qu'une vraie écurie. `sample.rs` sait en produire
/// de plausibles, avec goulots et porteuses ; ici on veut au contraire couvrir
/// large, parce que la politique doit savoir répondre à ce qu'on lui présente et
/// non à ce qu'elle a l'habitude de voir.
///
/// ## La génération se tire avant la couleur, et c'est indispensable
///
/// Uniformément sur les couleurs, le muldo en met **42 % en génération 10** — il
/// en compte cinquante sur cent vingt. Or une gen 10 ne s'accouple pas, ne rend
/// aucun géneton, et se fait récolter au premier cycle : quatre cents montures
/// tirées pour rien, et une écurie de départ qui ne ressemble à aucune vraie.
///
/// C'est le même piège que `dump-parity-fixtures.ts` a documenté avant nous —
/// « uniformément sur les 120 couleurs, la moitié des cases tomberait en
/// génération 10 […] On ne mesurerait plus rien » — et le même remède : tirer un
/// **rang** uniformément, puis une couleur dedans. Chaque génération pèse alors
/// autant, quelle que soit la largeur de son étage.
fn random_stable(catalog: &Catalog, rng: &mut Rng, config: &TreadmillConfig) -> Stable {
    let mut stable = Stable::new();
    let top = catalog.top_generation() as usize;
    let by_generation: Vec<Vec<ColorId>> = (0..=top)
        .map(|generation| catalog.ids_at_generation(generation as u8).collect())
        .collect();
    // Poids annulés pour les rangs que le catalogue ne porte pas.
    let weights: Vec<usize> = (0..=top)
        .map(|generation| {
            if by_generation[generation].is_empty() {
                0
            } else {
                config.weights.get(generation).copied().unwrap_or(0)
            }
        })
        .collect();
    let total: usize = weights.iter().sum();
    if total == 0 {
        return stable;
    }

    for _ in 0..config.mounts {
        // Le rang d'abord, pondéré ; la couleur ensuite, uniformément dedans.
        // Le poids porte donc sur la **génération** et non sur la couleur : les
        // cinquante gen 10 du muldo se partagent une part de 1, chacune est donc
        // rare individuellement, ce qui est bien ce qu'on observe en jeu.
        let mut ticket = index_in(rng, total);
        let generation = weights
            .iter()
            .position(|&weight| {
                if ticket < weight {
                    true
                } else {
                    ticket -= weight;
                    false
                }
            })
            .unwrap_or(1);
        let choices = &by_generation[generation];
        let color = choices[index_in(rng, choices.len())];
        let recipes = &catalog.color(color).recipes;
        let parents = if recipes.is_empty() {
            None
        } else {
            Some(recipes[index_in(rng, recipes.len())])
        };
        let (fertile, cycled) = draw_state(rng);
        stable.push(Mount {
            color,
            sex: draw_sex(rng),
            level: draw_level(rng, config.promotion_levels),
            fertile,
            cycled,
            parents,
        });
    }
    stable
}

/// Passe `quota` fertiles en fécondes, tirées uniformément, niveau retiré au
/// passage.
///
/// Le niveau est **retiré** et non conservé : le cycle passe par la Mangeoire, et
/// c'est là qu'une monture monte. Garder l'ancien reviendrait à supposer que la
/// montée est gratuite.
fn promote(stable: &mut Stable, rng: &mut Rng, quota: usize, levels: (u16, u16)) {
    let mut candidates: Vec<usize> = stable
        .mounts
        .iter()
        .enumerate()
        .filter(|(_, mount)| mount.fertile && !mount.cycled)
        .map(|(index, _)| index)
        .collect();

    for _ in 0..quota.min(candidates.len()) {
        // Tirage sans remise : `swap_remove` suffit, l'ordre du vivier n'a aucun
        // sens à préserver.
        let at = index_in(rng, candidates.len());
        let chosen = candidates.swap_remove(at);
        stable.mounts[chosen].cycled = true;
        stable.mounts[chosen].level = draw_level(rng, levels);
    }
}

/// Ramène chaque couleur de génération 1 à son effectif de fertiles.
fn top_up_gen1(
    stable: &mut Stable,
    catalog: &Catalog,
    rng: &mut Rng,
    gen1: &[ColorId],
    target: usize,
) {
    let _ = catalog;
    for &color in gen1 {
        let held = stable
            .mounts
            .iter()
            .filter(|mount| mount.color == color && mount.fertile)
            .count();
        for _ in held..target {
            stable.push(Mount {
                color,
                sex: draw_sex(rng),
                // Achetée ou capturée : sans ascendance, sans cycle payé, et au
                // niveau plancher. Elle ne devient utile qu'une fois promue.
                level: 1,
                fertile: true,
                cycled: false,
                parents: None,
            });
        }
    }
}

fn draw_state(rng: &mut Rng) -> (bool, bool) {
    let roll = rng.next_f64();
    if roll < 1.0 / 3.0 {
        (true, false)
    } else if roll < 2.0 / 3.0 {
        (true, true)
    } else {
        (false, false)
    }
}

fn draw_sex(rng: &mut Rng) -> Sex {
    if rng.next_f64() < 0.5 {
        Sex::Male
    } else {
        Sex::Female
    }
}

fn draw_level(rng: &mut Rng, (low, high): (u16, u16)) -> u16 {
    let span = f64::from(high.saturating_sub(low) + 1);
    (low + (rng.next_f64() * span) as u16).min(high)
}

fn index_in(rng: &mut Rng, count: usize) -> usize {
    ((rng.next_f64() * count as f64) as usize).min(count.saturating_sub(1))
}

/// Les stratégies n'ont aucun sens ici — pas de jauges, pas de niveau à payer.
pub const NEUTRAL: [Strategy; MAX_UNITS] = [Strategy {
    bands: [0; 6],
    level: 0,
    optimakina_from: 11,
}; MAX_UNITS];

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::Prices;
    use crate::search::{Myopic, Searching};
    use crate::trees::muldo;

    fn economy() -> Economy {
        Prices::load_default().expect("economy.toml").economy
    }

    #[test]
    fn le_tapis_tourne_et_ne_refuse_rien() {
        let catalog = muldo();
        let economy = economy();
        let config = TreadmillConfig { cycles: 5, ..Default::default() };
        let mut policy = Searching::with_iterations(Myopic, 200);
        let outcome = play_treadmill(&catalog, &economy, &mut policy, 1, &config);

        assert_eq!(outcome.rejected, 0, "aucune fournée ne doit être refusée");
        assert!(outcome.crossings > 0, "la politique doit croiser quelque chose");
    }

    /// L'enclos est hors sujet : à capacité nulle, aucun croisement ne peut
    /// engager une monture qui doit encore son cycle.
    #[test]
    fn seules_les_fecondes_s_accouplent() {
        let catalog = muldo();
        let economy = economy();
        let config = TreadmillConfig { cycles: 3, mounts: 300, ..Default::default() };
        let mut policy = Searching::with_iterations(Myopic, 200);
        // Un refus signalerait qu'un plan a demandé des places là où il n'y en a
        // aucune — donc qu'une fertile non cyclée s'est glissée dans un couple.
        let outcome = play_treadmill(&catalog, &economy, &mut policy, 7, &config);
        assert_eq!(outcome.rejected, 0);
    }

    #[test]
    fn un_episode_se_rejoue_a_l_identique() {
        let catalog = muldo();
        let economy = economy();
        let config = TreadmillConfig { cycles: 4, ..Default::default() };
        let run = |seed| {
            let mut policy = Searching::with_iterations(Myopic, 200);
            play_treadmill(&catalog, &economy, &mut policy, seed, &config)
        };
        assert_eq!(run(3).genetons, run(3).genetons);
    }

    /// La trajectoire des génétons, et pourquoi elle ne se lit pas avec `Myopic`.
    ///
    /// Le tapis est **exactement stationnaire** dès qu'on clone : deux fertiles
    /// donnent au croisement deux stériles et un poulain, et les deux stériles
    /// rendent un fertile au clonage — donc deux fertiles pour deux fertiles, et
    /// le seul apport net est le complément en gen 1.
    ///
    /// `Myopic` ne clone jamais, et ce n'est pas de l'indifférence : il note la
    /// liquidation, or cloner consomme deux montures pour en rendre une. Il
    /// **pénalise** donc le seul mécanisme qui alimente le tapis, et sa
    /// trajectoire s'effondre quel que soit le départ. Ce relevé mesure la sonde
    /// autant que l'environnement — à relire avec une politique entraînée.
    /// `cargo test -p breeding-sim -- --nocapture la_trajectoire`
    #[test]
    fn la_trajectoire_des_genetons() {
        let catalog = muldo();
        let economy = economy();
        println!(
            "{:>8} {:>10}   génétons par cycle, par tranche de 5",
            "départ", "total"
        );
        for mounts in [1000usize, 400, 200] {
            let config = TreadmillConfig { cycles: 30, mounts, ..Default::default() };
            let mut bands = [0i64; 6];
            let mut total = 0i64;
            let (mut clonings, mut crossings, mut steriles) = (0usize, 0usize, 0usize);
            const SEEDS: u32 = 8;
            for seed in 0..SEEDS {
                let mut policy =
                    Searching::with_iterations(Myopic, 800).without_sacrifices();
                let o = play_treadmill(&catalog, &economy, &mut policy, seed, &config);
                total += o.genetons;
                for (cycle, &g) in o.per_cycle.iter().enumerate() {
                    bands[(cycle / 5).min(5)] += g;
                }
                clonings += o.clonings;
                crossings += o.crossings;
                steriles += o.crossings * 2;
            }
            let per = |b: i64| b / (5 * SEEDS as i64);
            println!(
                "{mounts:>8} {:>10}   {:>6} {:>6} {:>6} {:>6} {:>6} {:>6}                    {:>5} croisements · {:>5} clonages pour {:>5} stériles produites",
                total / SEEDS as i64,
                per(bands[0]), per(bands[1]), per(bands[2]),
                per(bands[3]), per(bands[4]), per(bands[5]),
                crossings / SEEDS as usize,
                clonings / SEEDS as usize,
                steriles / SEEDS as usize
            );
        }
    }

    /// Le relevé de comportement, imprimé pour être lu.
    /// `cargo test -p breeding-sim -- --nocapture le_relevé`
    #[test]
    fn le_releve_du_tapis() {
        let catalog = muldo();
        let economy = economy();
        for cycles in [5usize, 30] {
            let config = TreadmillConfig { cycles, ..Default::default() };
            let mut genetons = 0i64;
            let mut crossings = 0usize;
            let mut gen1 = 0usize;
            let mut harvested = 0usize;
            let mut sacrificed = 0usize;
            let mut top = 0u8;
            let mut ends = 0usize;
            let started = std::time::Instant::now();
            for seed in 0..8u32 {
                let mut policy = Searching::with_iterations(Myopic, 800).without_sacrifices();
                let o = play_treadmill(&catalog, &economy, &mut policy, seed, &config);
                genetons += o.genetons;
                crossings += o.crossings;
                gen1 += o.gen1_crossings;
                harvested += o.gen10_harvested;
                sacrificed += o.sacrifices;
                top = top.max(o.top_generation);
                ends += o.mounts_end;
            }
            println!(
                "{cycles:>3} cycles · {:>9} génétons · {:>6} croisements dont {:>5.1} % gen1×gen1 \
                 · {:>3} gen 10 · {:>5} sacrifices · top {top} · {:>5} montures · {:>5.1} s/épisode",
                genetons / 8,
                crossings / 8,
                100.0 * gen1 as f64 / crossings.max(1) as f64,
                harvested / 8,
                sacrificed / 8,
                ends / 8,
                started.elapsed().as_secs_f64() / 8.0
            );
        }
    }
}
