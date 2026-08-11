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
//! Les **kamas**. Les génétons se vendent, donc les compter bruts reviendrait à
//! noter une politique dans une monnaie qu'elle ne dépense pas — et le
//! débordement de l'écurie, lui, se paie bien en kamas. Une seule unité des deux
//! côtés, aucun taux de change à inventer.
//!
//! Ce sont les génétons qui portent le gain. Trois raisons, et la troisième
//! décide :
//!
//! - ils ne tombent qu'à la **naissance réussie**, donc ils ne comptent que les
//!   reproductions — une monture gardée n'en rend aucun, et thésauriser ne paie
//!   pas ;
//! - ils suivent les **parents** et non la cible, avec un rapport de 250 entre
//!   deux gen 9 et deux gen 1, donc croiser haut domine largement ;
//! - ils sont **relevés en jeu** et déjà calculés par `apply`. C'est une mesure,
//!   pas une pondération inventée pour l'occasion.
//!
//! ## Le marché est tiré par partie
//!
//! Comme dans `economy::run` : `for_run` pioche l'ambre, le géneton et la gen 10
//! dans leurs fourchettes, et le marché du jour **fait partie du monde**.
//!
//! Ce n'est pas un raffinement. Le vecteur d'entrée porte `PRICE_AMBER`,
//! `PRICE_GENETON` et `PRICE_TOP` précisément pour qu'une politique distingue une
//! semaine où l'ambre est à 11 000 d'une où il est à 30 000. Sur un marché figé
//! ces entrées ne bougent jamais, le réseau n'apprend rien d'elles — et le jour où
//! l'écran lui passe les prix réels de l'éleveur, qui changent d'un jour à
//! l'autre, il reçoit des valeurs qu'il n'a jamais vues. Il rendrait un nombre,
//! simplement pas le bon.
//!
//! Deux angles morts connus, à garder en tête en lisant un résultat. La
//! purification rend **zéro** — mesuré, voir #68 : deux Indigo capturés donnent
//! « Indigo 100 %, zéro géneton ». Et les ratés rendent zéro aussi, or ce sont eux
//! qui produisent les porteuses de raccourci. Dans les deux cas le gain existe
//! mais il est **différé** : il n'apparaît que dans les génétons des croisements
//! suivants, donc seulement si l'épisode est assez long. C'est la raison pour
//! laquelle la longueur est un paramètre et non une constante.

use crate::economy::{Draws, Economy, MAX_UNITS, Policy, Rng, Strategy, UnitView, apply_plan};
use crate::loading::{Loader, RandomLoader};
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
    /// Places d'enclos d'**une seule fournée**, toutes disponibles au même moment.
    ///
    /// Le parc ne se pilote plus en deux unités désynchronisées : deux vagues à
    /// suivre, c'est déjà trop pour qui joue en guilde. Un chargement par cycle,
    /// sur `enclos × 10` places — et remplir est dominant, puisque le transfert se
    /// paie à l'enclos et que les dix places en profitent également.
    pub places: usize,
    /// Fertiles à maintenir pour chaque couleur de génération 1.
    pub gen1_target: usize,
    /// Bornes du niveau **affiché** d'une monture promue.
    ///
    /// Décoratif pour l'appariement, et il faut le savoir : le taux de réussite
    /// suit `strategy.level` — la Mangeoire monte la fournée entière — et le champ
    /// `level` d'une monture n'entre ni dans `PairDelta::of` ni dans `apply`. Il ne
    /// sert qu'à départager deux montures autrement identiques, chez le chargeur
    /// comme dans `MateGroup::sample`.
    pub promotion_levels: (u16, u16),
    /// Le niveau auquel la Mangeoire monte la fournée, donc **le** levier du taux.
    ///
    /// `0` laisse l'économie décider (`mount_level`). C'est la variable de
    /// `bin/batch` : les bandes ne changent que la durée et le prix d'une fournée,
    /// le niveau seul change ce qu'elle produit.
    pub level: u16,
    /// Montures détenues sans frais. Au-delà, l'écurie déborde sur l'inventaire.
    ///
    /// Le plafond du jeu n'est pas un mur : on gère des centaines de montures en
    /// passant par l'inventaire, c'est seulement moins commode — et ça se paie.
    pub stable_cap: usize,
    /// Kamas dus **par tour et par monture** au-delà du plafond.
    pub overflow_kamas: i64,
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
    /// Les montures tirées arrivent **fertiles et non fécondes**.
    ///
    /// Le tirage ordinaire rend un tiers de fertiles, un tiers de fécondes et un
    /// tiers de stériles, ce qui décrit une écurie déjà en marche. Ce n'est pas ce
    /// qu'on achète : une gen 1 prise à l'hôtel de vente arrive entière, et un
    /// **départ frais** est vingt de celles-là. Un tiers de stériles d'entrée de jeu
    /// changerait la question posée.
    pub state: StartState,
    /// Ce que l'écurie **qui reste** compte dans la fitness, en part de sa valeur
    /// de recyclage. `0.0` l'ignore, comme avant.
    ///
    /// Sans ce terme, la fitness ne compte que les génétons vendus et la récolte de
    /// gen 10. Sur un départ chargé c'est suffisant — l'écurie porte déjà des gen 8
    /// à 10, donc tout paie dès le premier cycle. Sur un départ frais, personne
    /// n'atteint la gen 10 en trente cycles, donc **le score est plat quoi qu'on
    /// fasse** et l'évolution n'a aucun gradient : elle ne peut pas apprendre à
    /// monter si monter ne rapporte rien avant le sommet.
    ///
    /// Mesuré avant de le corriger : dix-sept relevés sur trois heures, dix à douze
    /// espèces chacun, et **aucune n'a jamais dépassé un million** sur un départ
    /// frais. Ce n'était pas faute d'avoir cherché.
    ///
    /// Le barème est celui de l'ambre — `génération × prix`, déjà porté par
    /// `value_at_generation` et déjà lu par le recensement. On ne l'invente pas, on
    /// arrête de le jeter.
    pub residual_value: f64,
    /// Ce que coûte un chargement d'enclos, dès qu'une place est occupée.
    ///
    /// Le tapis ne facturait rien : une fécondation prenait une place et ne coûtait
    /// pas un kama, donc banquer était gratuit et rien n'obligeait à arbitrer. Or
    /// charger l'enclos consomme du carburant, que la fournée serve à croiser ou à
    /// féconder.
    ///
    /// Facturé au **chargement** et non à la place, parce que c'est ainsi que le
    /// jeu le prend : les jauges tournent pour l'enclos entier, et dix montures s'y
    /// partagent la même dépense.
    pub cycle_kamas: i64,
    /// Ce qu'une place **vide** coûte, en génétons, sur une fournée chargée.
    ///
    /// C'est le levier qui manquait. Une fournée coûtait le même prix qu'elle soit
    /// pleine ou vide, donc rien ne poussait à la remplir : sur un départ frais, la
    /// politique occupait **une place et demie sur cinquante** et le tapis tournait
    /// à vide trente fois de suite sans que le score s'en ressente.
    ///
    /// Compté en génétons et non en kamas parce que c'est l'unité de ce qu'une
    /// place produit : une place vide, c'est un croisement qu'on n'a pas fait, donc
    /// des génétons qu'on n'a pas eus. Le prix du jour fait le reste de la
    /// conversion, et la politique le lit déjà par `PRICE_GENETON`.
    ///
    /// Facturé **seulement si la fournée est chargée** : ne rien mettre en enclos
    /// est une décision légitime — il n'y a pas toujours de bon coup à jouer — et
    /// la taxer forcerait à charger pour ne rien faire.
    pub empty_place_genetons: f64,
    /// Les départs à tirer, un par partie. Vide = celui que ce `config` décrit.
    ///
    /// Une politique qui ne voit qu'un seul départ ne sait jouer que celui-là, et
    /// c'est mesuré : le champion entraîné sur des écuries déjà montées fait
    /// quarante-sept croisements en trente cycles quand on le pose sur vingt gen 1.
    /// Observer sa généralisation ne suffisait pas — il faut la lui demander.
    ///
    /// Trois profils à parts égales plutôt qu'un mélange pondéré : le départ frais
    /// est le plus dur, donc le sous-représenter reviendrait à ne pas l'enseigner.
    /// La graine du tirage est celle de la partie, donc deux politiques comparées
    /// sur la même graine voient le **même** départ.
    /// Une tranche statique et non un `Vec` : `TreadmillConfig` est `Copy`, et le
    /// rendre allouant pour trois constantes ferait payer une copie à chaque
    /// partie.
    pub starts: &'static [StartProfile],
}

impl Default for TreadmillConfig {
    fn default() -> Self {
        Self {
            // Deux cent cinquante et non mille. Le tapis coûte trente appels de
            // l'optimiseur par épisode, et le coût d'un appel suit la **diversité
            // des signatures** de l'écurie : à mille montures un épisode approche
            // la seconde, et une génération d'entraînement passe à plus d'une
            // minute. La nature du problème ne change pas avec l'échelle — la
            // trajectoire décroissait pareil à 1000, 400 et 200 — donc autant
            // payer le prix qui laisse tourner assez de générations pour
            // apprendre quelque chose.
            mounts: 250,
            cycles: 30,
            places: 50,
            gen1_target: 20,
            promotion_levels: (1, 200),
            level: 0,
            stable_cap: 250,
            overflow_kamas: 100,
            // 11 − génération, et zéro pour la gen 1.
            weights: [0, 0, 9, 8, 7, 6, 5, 4, 3, 2, 1],
            state: StartState::Drawn,
            residual_value: 1.0,
            cycle_kamas: 0,
            empty_place_genetons: 1.0,
            starts: &[],
        }
    }
}

/// Un départ possible : de quoi l'écurie est faite au premier cycle.
#[derive(Clone, Copy, Debug)]
pub struct StartProfile {
    pub mounts: usize,
    pub weights: [usize; 11],
    pub state: StartState,
}

/// Dans quel état l'écurie de départ se présente.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StartState {
    /// Un tiers de fertiles, un tiers de fécondes, un tiers de stériles : une
    /// écurie déjà en marche, prise à un moment quelconque.
    Drawn,
    /// Tout fertile et rien de fécond — ce qu'on achète à l'hôtel de vente.
    Fresh,
    /// Tout **fécond** : l'écurie au sortir de l'enclos, quand la fournée vient
    /// d'être récupérée et qu'aucune monture n'a encore été accouplée.
    ///
    /// C'est l'état d'un éleveur qui ouvre l'app après avoir vidé son parc, et le
    /// tapis ne le produisait jamais — `Drawn` en tire un tiers. Mesuré sur une
    /// écurie réelle à 87 % de fécondes : le champion y prenait **zéro**
    /// accouplement gratuit là où la valeur myope en trouvait quarante-neuf.
    OutOfEnclosure,
}

/// Les trois départs de l'entraînement : déjà monté, mélangé, et le premier jour.
///
/// Le troisième est celui de tout le monde au début — vingt gen 1 anonymes — et
/// c'est celui que le champion précédent ne savait pas jouer : quarante-sept
/// croisements en trente cycles, trois pour cent des places offertes.
pub const MIXED_STARTS: [StartProfile; 4] = [
    StartProfile {
        mounts: 250,
        weights: [0, 0, 9, 8, 7, 6, 5, 4, 3, 2, 1],
        state: StartState::Drawn,
    },
    StartProfile {
        mounts: 250,
        weights: [0, 9, 9, 8, 7, 6, 5, 4, 3, 2, 1],
        state: StartState::Drawn,
    },
    StartProfile {
        mounts: 20,
        weights: [0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        state: StartState::Fresh,
    },
    StartProfile {
        mounts: 250,
        weights: [0, 9, 9, 8, 7, 6, 5, 4, 3, 2, 1],
        state: StartState::OutOfEnclosure,
    },
];

/// Ce qu'un épisode a produit. `genetons` est la fitness ; le reste sert à lire
/// **pourquoi**, ce qu'un score seul ne dit jamais.
#[derive(Clone, Debug, Default)]
pub struct TreadmillOutcome {
    /// La fitness, en kamas : les génétons vendus au prix du jour, **plus la
    /// récolte à son prix par couleur**, moins le débordement.
    ///
    /// Portée par le résultat et non recalculée par l'appelant, parce que le prix
    /// du jour est **tiré dans l'appel** : le lui faire reconvertir avec l'économie
    /// du fichier donnerait un chiffre converti à 538 pendant que le réseau, lui,
    /// aurait lu 892. L'incohérence ne se voit sur aucun test de compilation.
    pub kamas: f64,
    pub genetons: i64,
    pub crossings: usize,
    pub clonings: usize,
    pub births: usize,
    /// Gen 10 retirées et comptées, tous cycles confondus.
    pub gen10_harvested: usize,
    /// Ce que la récolte a rapporté, **couleur par couleur**.
    ///
    /// Une gen 10 vaut entre 300 000 et 1 000 000 selon la couleur, et
    /// `economy.top_values` tire ce prix pour chacune — « c'est ce qui rend le
    /// choix de la couleur stratégique et pas seulement celui du rang ».
    ///
    /// Sans ce terme dans la fitness, les gen 10 étaient comptées puis jetées :
    /// rien ne poussait à viser la chère plutôt que n'importe laquelle, alors même
    /// que le recensement porte la différence — `Census::liquidation` est suivie
    /// en incrémental et exacte, précisément pour ne pas écraser les cinquante
    /// prix de gen 10 en un seul.
    pub harvest_value: i64,
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
    /// Kamas payés pour le débordement, tous cycles confondus.
    ///
    /// Ils ne sont pas dans `genetons` : ce sont deux unités. `net_genetons` fait
    /// la conversion, au prix du géneton de l'économie du jour.
    pub overflow_paid: i64,
    /// Ce que l'écurie restante vaut à la casse, avant pondération. Porté à part
    /// pour qu'on puisse lire d'où vient un score.
    pub residual: i64,
    /// Ce que les chargements d'enclos ont coûté, tous cycles confondus —
    /// forfait et places vides.
    pub loads_paid: i64,
    /// Places payées et laissées vides, tous cycles confondus. Portée à part parce
    /// que c'est le chiffre qu'on vient lire : une fournée à moitié pleine ne se
    /// voit pas dans un total.
    pub empty_places: usize,
    /// Génétons cycle par cycle.
    ///
    /// C'est ce qui dit si l'épisode mesure un **régime établi** ou la liquidation
    /// de la dotation initiale. Une trajectoire qui s'aplatit autorise une période
    /// de chauffe ; une trajectoire qui décroît sans fin veut dire que le tapis
    /// n'est pas alimenté assez pour tourner, et aucune chauffe n'y changera rien.
    pub per_cycle: Vec<i64>,
}

/// Ce qu'une monture coûte à détenir : rien si c'est une gen 1 sans ascendance.
///
/// Ces gen 1-là sont le robinet de l'environnement — complétées à vingt par
/// couleur à chaque tour — et les facturer reviendrait à taxer ce qu'on injecte
/// soi-même. Elles sont aussi ce qu'on remplace le plus facilement en jeu : sans
/// généalogie, elles sont interchangeables.
/// L'ascendance est lue **canoniquement** : un Ébène né de deux Ébène ne porte
/// aucune généalogie utile, et le jeu ne le distingue pas d'un Ébène acheté. Le
/// tester littéralement faisait payer le plafond pour une monture qu'on remplace
/// d'un clic à l'hôtel de vente — et la recopie est justement ce que la politique
/// produit en masse, si bien que la taxe portait surtout sur elle.
fn chargeable(catalog: &Catalog, mount: &Mount) -> bool {
    let anonymous = crate::pairing::canonical_parents(mount.color, mount.parents).is_none();
    !(anonymous && catalog.generation(mount.color) == 1)
}

/// Fait tourner un épisode et rend ce qu'il a produit.
pub fn play_treadmill(
    catalog: &Catalog,
    economy: &Economy,
    policy: &mut dyn Policy,
    seed: u32,
    config: &TreadmillConfig,
) -> TreadmillOutcome {
    play_treadmill_with(catalog, economy, policy, &mut RandomLoader, seed, config)
}

/// Le même tapis, avec un chargeur au choix.
///
/// C'est le point d'entrée de l'étape 2 : ce qui décidait au hasard devient une
/// décision, et `loading.rs` en propose plusieurs pour qu'on puisse les comparer
/// avant d'en apprendre une.
pub fn play_treadmill_with(
    catalog: &Catalog,
    economy: &Economy,
    policy: &mut dyn Policy,
    loader: &mut dyn Loader,
    seed: u32,
    config: &TreadmillConfig,
) -> TreadmillOutcome {
    let mut rng = Rng::new(seed);
    // Décalée comme dans `economy::run` : la politique ne doit pas pouvoir
    // rejouer le flux des naissances en devinant sa propre graine.
    let draws = Draws::new(seed ^ 0x5bf0_3635);
    // Le marché du jour, tiré comme le reste du monde. Voir l'en-tête.
    let drawn = economy.for_run(catalog, &draws);
    let economy = &drawn;
    let mut stable = random_stable(catalog, &mut rng, config);
    let mut outcome = TreadmillOutcome::default();

    let strategy = Strategy {
        level: config.level,
        ..Strategy::default()
    };
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
                strategy,
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
            strategy,
            &draws,
            cycle as u32,
        ) {
            Ok(applied) => {
                // Le chargement se paie dès qu'une place est occupée, que la
                // fournée serve à croiser ou seulement à féconder. C'est ce qui
                // rend le banquage arbitrable : il prenait une place et ne coûtait
                // pas un kama, donc rien n'obligeait à choisir.
                if applied.places > 0 {
                    outcome.loads_paid += config.cycle_kamas;
                    // Les places qu'on a payées sans les employer.
                    let empty = config.places.saturating_sub(applied.places);
                    outcome.empty_places += empty;
                    outcome.loads_paid += (empty as f64
                        * config.empty_place_genetons
                        * economy.geneton_value) as i64;
                }
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

        // --- 3. le chargement -------------------------------------------------
        //
        // Une fournée, toutes les places. Le chargeur choisit **lesquelles**, pas
        // combien : remplir est dominant.
        let chosen = loader.choose(catalog, economy, &stable, config.places, &mut rng);
        for index in chosen {
            let mount = &mut stable.mounts[index];
            debug_assert!(mount.fertile && !mount.cycled, "le chargeur a désigné une monture inéligible");
            mount.cycled = true;
            // Le niveau est **retiré** au passage : le cycle passe par la
            // Mangeoire, et c'est là qu'une monture monte. Garder l'ancien
            // reviendrait à supposer la montée gratuite.
            mount.level = draw_level(&mut rng, config.promotion_levels);
        }

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
        outcome.harvest_value += harvested
            .iter()
            .map(|&index| economy.value_of(catalog, stable.mounts[index].color))
            .sum::<i64>();
        stable.remove_all(&harvested);

        // --- 6. le débordement ------------------------------------------------
        //
        // Compté sur l'écurie telle qu'on la garde entre deux tours, donc après la
        // récolte et le complément.
        let held = stable
            .mounts
            .iter()
            .filter(|mount| chargeable(catalog, mount))
            .count();
        outcome.overflow_paid +=
            held.saturating_sub(config.stable_cap) as i64 * config.overflow_kamas;
    }

    // Au prix du jour, celui qui a été tiré pour cette partie. Les deux termes
    // sont en kamas et aucun taux n'est inventé — c'est ce qui rend
    // `PRICE_GENETON` utile au réseau : un géneton vaut plus certains jours, donc
    // croiser vaut plus certains jours.
    // Ce que l'écurie vaut encore, à son prix de recyclage. Voir
    // `TreadmillConfig::residual_value` : c'est ce terme qui donne une pente à
    // celui qui part de vingt gen 1 et n'atteindra jamais la gen 10 à temps.
    outcome.residual = stable
        .mounts
        .iter()
        .map(|mount| economy.value_of(catalog, mount.color))
        .sum();

    outcome.kamas = outcome.genetons as f64 * economy.geneton_value
        + outcome.harvest_value as f64
        + outcome.residual as f64 * config.residual_value
        - outcome.overflow_paid as f64
        - outcome.loads_paid as f64;
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
    // Le départ, tiré avant tout le reste pour que la graine le décide : deux
    // politiques comparées sur la même graine doivent partir de la même écurie,
    // sans quoi l'écart mesuré serait autant celui des départs que celui des
    // politiques.
    let profile = if config.starts.is_empty() {
        StartProfile {
            mounts: config.mounts,
            weights: config.weights,
            state: config.state,
        }
    } else {
        config.starts[index_in(rng, config.starts.len())]
    };

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
                profile.weights.get(generation).copied().unwrap_or(0)
            }
        })
        .collect();
    let total: usize = weights.iter().sum();
    if total == 0 {
        return stable;
    }

    for _ in 0..profile.mounts {
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
        let (fertile, cycled) = match profile.state {
            StartState::Fresh => (true, false),
            StartState::OutOfEnclosure => (true, true),
            StartState::Drawn => draw_state(rng),
        };
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

    /// Le marché doit **bouger d'une partie à l'autre**, sinon les trois entrées
    /// de prix du vecteur restent constantes, le réseau n'apprend rien d'elles, et
    /// l'écran lui passera un jour des prix qu'il n'a jamais vus.
    #[test]
    fn le_marche_du_jour_est_tire_par_partie() {
        let catalog = muldo();
        let economy = economy();
        let config = TreadmillConfig { cycles: 2, mounts: 120, ..Default::default() };
        // Le rapport kamas/géneton **est** le prix du géneton de la partie : si le
        // marché était figé, les deux graines rendraient exactement le même.
        let rate = |seed| {
            let mut policy = Searching::with_iterations(Myopic, 100);
            let outcome = play_treadmill(&catalog, &economy, &mut policy, seed, &config);
            assert!(outcome.genetons > 0, "graine {seed} : rien produit, le test ne dit rien");
            outcome.kamas / outcome.genetons as f64
        };
        let (a, b) = (rate(1), rate(2));
        assert!(
            (a - b).abs() > 1e-6,
            "le marché ne bouge pas : {a} contre {b}"
        );
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

