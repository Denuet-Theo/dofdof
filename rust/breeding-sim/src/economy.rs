//! L'économie fermée, et la partie de cent fournées qui se joue dedans.
//!
//! Elle remplace intégralement `costs.ts` — mangeoire, optimakina, carburant,
//! taxe HDV, génétons. Ce n'est pas une simplification par paresse : ce qu'on
//! cherche est la **politique d'appariement**, et une économie à sept leviers
//! rend impossible d'attribuer un gain à l'un d'eux. Ici il n'y a qu'un prix
//! par action, et le score est un nombre de kamas.
//!
//! ## La spécification
//!
//! | Élément | Valeur |
//! | --- | --- |
//! | Capital de départ | 10 000 000, plancher à 0 |
//! | Écurie de départ | 100 muldos tirés en gen 2 à 9, généalogie comprise |
//! | Horizon | 100 fournées |
//! | Prix d'une fournée | 150 000 à plat, dès qu'elle porte un croisement |
//! | Capacité | 25 croisements (50 places, deux par croisement) |
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
//! 10 M de départ achèteraient 10 000 têtes qui en rendraient 200 M, qui en
//! achèteraient 200 000. Une politique cherchée par évolution aurait trouvé ça
//! en quelques générations et n'aurait plus jamais élevé quoi que ce soit : on
//! aurait mesuré la découverte d'un exploit, pas une heuristique.
//!
//! ## Ce qui reste ouvert, et qui est un vrai choix de stratégie
//!
//! Élever des gen 2 rapporte : deux gen 1 à 1 000 pièce plus la part de fournée
//! (6 000) pour 40 000 à 50,1 %, soit ~20 000 attendus contre 8 000 dépensés.
//! Plafonné à 25 croisements, ça vaut de l'ordre de 300 000 par fournée.
//!
//! Ce n'est **pas** un exploit à refermer : c'est borné par la capacité, et ça
//! entre en concurrence directe avec la montée, puisque les deux se disputent
//! les mêmes vingt-cinq places. Savoir si la politique optimale imprime des
//! gen 2 ou grimpe vers la gen 10 est précisément la question qu'on pose — et
//! la trancher d'avance en interdisant l'une des deux reviendrait à écrire
//! l'heuristique qu'on prétend chercher.
//!
//! ## Pourquoi cent montures au départ, et pas une écurie vide
//!
//! Une partie qui commence à zéro passe l'essentiel de ses fournées dans les
//! basses générations : c'est là que tombent la plupart des décisions, donc
//! c'est là que l'entraînement porterait. La politique apprendrait très bien à
//! fabriquer des gen 2 et n'aurait presque jamais vu une gen 8.
//!
//! On amorce donc avec cent montures tirées **uniformément en génération 2 à
//! 9**, généalogie comprise. Leur ascendance n'est pas arbitraire : elle est
//! tirée dans les **recettes** de leur propre couleur, donc elle est jouable —
//! une monture de génération `g` a bien deux parents dont le rang maximal vaut
//! `g − 1`, ce que le jeu exige.
//!
//! Conséquence à ne pas perdre de vue : le plancher « ne rien faire » ne vaut
//! plus 10 M mais 10 M **plus la liquidation du pool**. C'est lui le vrai point
//! de comparaison.
//!
//! ## Le capital ne suffit pas, et c'est le sujet
//!
//! 10 M à 150 000 la fournée paient 66 tours sur 100. La montée doit donc
//! **s'autofinancer** par les sacrifices en cours de route, ce qui met la
//! politique devant un arbitrage que la politique actuelle ne modélise pas du
//! tout : encaisser une monture ou la garder pour ce qu'elle ouvre.
//!
//! ## Ce que la politique voit
//!
//! L'écurie et le solde. **Jamais le numéro de la fournée**, jamais l'état du
//! générateur — c'est la contrainte posée par le mainteneur, et elle est tenue
//! par le type : `BatchView` ne porte ni l'un ni l'autre.

use crate::pairing::{Mate, mating_outcomes_at, pair_outlook, pair_target_generation};
use crate::stable::{Mount, Sex, Stable};
use crate::trees::{Catalog, ColorId};

/// Une bande de jauge : ce qu'elle coûte au point, et ce qu'elle fait gagner.
///
/// Le débit dépend de la bande où on tient la jauge, et chaque bande exige un
/// carburant dont le plafond l'atteint. Aller vite coûte cher **et** non
/// linéairement : les dix premières heures gagnées valent 5 400 kamas l'heure,
/// la dernière heure et demie en vaut 512 000.
#[derive(Clone, Copy, Debug, Default)]
pub struct Band {
    pub cap: i64,
    /// Heures de remplissage, hors manipulation entre fournées.
    pub hours: f64,
    pub serenity_per_point: f64,
    pub stats_per_point: f64,
}

/// Points de Mangeoire pour atteindre un niveau : `3,795 × niveau^2,329`.
///
/// Porté de `mountXpForLevel`. Niveau 67 → 67 700 points, niveau 200 → 867 900 :
/// treize fois plus pour faire passer la réussite de 50,1 % à 90 %.
#[inline]
pub fn mount_xp_for_level(level: u16) -> f64 {
    3.795 * f64::from(level).powf(2.329)
}

pub const MAX_MOUNT_LEVEL: u16 = 200;

#[derive(Clone, Copy, Debug)]
pub struct Economy {
    pub starting_kamas: i64,
    /// Montures offertes au départ, tirées entre `pool_generations`.
    pub starting_pool: usize,
    pub pool_generations: (u8, u8),
    pub batches: u32,
    /// Prix d'une fournée, à plat, dès qu'elle porte au moins un croisement.
    /// Sous-remplir est permis et coûte le même prix : une place vide est une
    /// perte sèche, sauf si la fécondité gardée vaut mieux.
    pub batch_cost: i64,
    pub crossings_per_batch: usize,
    pub starter_price: i64,
    pub amber_per_generation: i64,
    /// Ce que vaut une gen 10, n'importe laquelle des cinquante.
    pub top_value: i64,
    /// Niveau par défaut, quand la politique n'en choisit pas.
    pub mount_level: u16,

    // --- les quatre leviers ------------------------------------------------
    /// Budget en heures. `None` = horizon en nombre de fournées.
    pub horizon_hours: Option<f64>,
    /// Manipulation incompressible entre deux fournées. Plancher dur sur la
    /// cadence : le carburant ne l'achète jamais.
    pub overhead_hours: f64,
    pub bands: [Band; 4],
    /// Kamas par point de Mangeoire.
    pub mangeoire_per_point: f64,
    /// La Mangeoire se remplit-elle par monture ou par enclos ? Facteur dix sur
    /// le levier le plus lourd des quatre — voir `economy.toml`.
    pub mangeoire_per_mount: bool,
    /// Prix d'une Optimakina par génération visée. Indice 0 et 1 inutilisés.
    pub optimakina: [i64; 11],
    /// Ce qu'elle ajoute au taux de réussite.
    pub optimakina_bonus: f64,
    /// Points de jauge d'un cycle de fécondité, par enclos.
    pub cycle_serenity_points: f64,
    pub cycle_stat_points: f64,
    pub enclos_per_batch: usize,
}

impl Default for Economy {
    fn default() -> Self {
        Self {
            starting_kamas: 10_000_000,
            starting_pool: 100,
            pool_generations: (2, 9),
            batches: 100,
            batch_cost: 150_000,
            crossings_per_batch: 25,
            starter_price: 1_000,
            amber_per_generation: 20_000,
            top_value: 500_000,
            mount_level: 67,
            // Par défaut, l'économie simplifiée : forfait à plat, aucun levier.
            // `Prices::load` remplit tout ça depuis `economy.toml`.
            horizon_hours: None,
            overhead_hours: 0.0,
            bands: [Band::default(); 4],
            mangeoire_per_point: 0.0,
            mangeoire_per_mount: false,
            optimakina: [0; 11],
            optimakina_bonus: 0.1,
            cycle_serenity_points: 15_010.0,
            cycle_stat_points: 60_000.0,
            enclos_per_batch: 5,
        }
    }
}

impl Economy {
    /// Ce qu'une monture rend si on la convertit.
    ///
    /// La gen 10 se vend à prix fixe, la gen 1 ne s'extrait pas, et tout ce qui
    /// est entre les deux rend son rang en ambre.
    #[inline]
    pub fn value_of(&self, catalog: &Catalog, color: ColorId) -> i64 {
        self.value_at_generation(catalog.generation(color), catalog.top_generation())
    }

    /// Les quatre leviers sont-ils chiffrés ?
    ///
    /// Faux tant que `economy.toml` n'a pas donné les prix : on retombe alors
    /// sur le forfait à plat et le niveau fixe, et les mesures publiées avant
    /// restent comparables.
    #[inline]
    pub fn levers_active(&self) -> bool {
        self.bands[0].hours > 0.0 && self.mangeoire_per_point > 0.0
    }

    /// Ce que coûtent les jauges de fécondité d'une fournée, à cette bande.
    #[inline]
    pub fn gauge_cost(&self, band: usize) -> i64 {
        let band = self.bands[band.min(3)];
        ((self.cycle_serenity_points * band.serenity_per_point
            + self.cycle_stat_points * band.stats_per_point)
            * self.enclos_per_batch as f64) as i64
    }

    /// Ce que coûte de porter les montures de la fournée à ce niveau.
    ///
    /// La Mangeoire se facture par enclos comme les autres jauges, sauf si
    /// `mangeoire_per_mount` — auquel cas c'est dix fois plus cher, et le levier
    /// « niveau » devient probablement décoratif.
    #[inline]
    pub fn feed_cost(&self, level: u16) -> i64 {
        let units = if self.mangeoire_per_mount {
            (self.crossings_per_batch * 2) as f64
        } else {
            self.enclos_per_batch as f64
        };
        (mount_xp_for_level(level) * self.mangeoire_per_point * units) as i64
    }

    /// Le prix d'une fournée, tout compris hors achats et Optimakina.
    #[inline]
    pub fn batch_cost_for(&self, band: usize, level: u16) -> i64 {
        if self.levers_active() {
            self.gauge_cost(band) + self.feed_cost(level)
        } else {
            self.batch_cost
        }
    }

    /// La durée d'une fournée à cette bande, manipulation comprise.
    #[inline]
    pub fn batch_hours(&self, band: usize) -> f64 {
        if self.levers_active() {
            self.bands[band.min(3)].hours + self.overhead_hours
        } else {
            self.bands[0].hours + self.overhead_hours
        }
    }

    /// Le taux de réussite d'un croisement à ce niveau, Optimakina comprise.
    ///
    /// Les deux parents portent le même niveau : c'est l'enclos qu'on nourrit,
    /// pas la monture. Le bonus s'ajoute avant le plafond à 1.
    #[inline]
    pub fn success_rate(&self, level: u16, optimakina: bool) -> f64 {
        let base = 0.3 + 0.0015 * (2.0 * f64::from(level));
        let boosted = base + if optimakina { self.optimakina_bonus } else { 0.0 };
        boosted.min(1.0)
    }

    /// Le même barème, lu sur le rang seul.
    ///
    /// Le recensement de `encode.rs` ne garde que des comptes par génération :
    /// il n'a plus de couleur sous la main pour repasser par `value_of`.
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
}

// ---------------------------------------------------------------------------
// Les tirages
// ---------------------------------------------------------------------------

/// Le tirage de l'environnement, **indexé** plutôt que séquentiel.
///
/// ## Pourquoi pas un flux
///
/// Un générateur qu'on consomme au fil de l'eau lie le résultat à l'**ordre**
/// des appels. Deux politiques comparées sur la même graine ne verraient alors
/// pas les mêmes naissances dès que l'une tire un nombre de plus que l'autre —
/// et on mesurerait autant la chance que la stratégie. C'est d'autant plus
/// vicieux que le décalage est invisible : les deux parties ont l'air de tourner
/// sur « la graine 42 ».
///
/// Chaque tirage est donc une **fonction** de la graine, du numéro de fournée,
/// de l'emplacement dans la fournée et de l'usage. Le croisement n°3 de la
/// fournée n°7 tire toujours la même valeur, que la politique en ait fait vingt-
/// cinq ou deux avant lui. C'est ce que la littérature appelle des *common
/// random numbers*, et c'est ce qui rend une différence de score imputable à la
/// politique.
///
/// La politique n'y a pas accès : sans quoi elle prédirait ses naissances.
#[derive(Clone, Copy, Debug)]
pub struct Draws {
    seed: u64,
}

/// Les usages, pour que deux tirages du même croisement soient indépendants.
mod purpose {
    pub const OUTCOME: u32 = 0;
    pub const SEX: u32 = 1;
    pub const CLONE: u32 = 2;
    pub const POOL_GENERATION: u32 = 3;
    pub const POOL_COLOR: u32 = 4;
    pub const POOL_RECIPE: u32 = 5;
    pub const POOL_SEX: u32 = 6;
}

/// La « fournée » réservée à l'amorçage, hors des cent vraies.
const POOL_BATCH: u32 = u32::MAX;

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
    pub fn at(&self, batch: u32, slot: u32, purpose: u32) -> f64 {
        let mixed = splitmix64(
            self.seed
                ^ splitmix64(u64::from(batch))
                ^ splitmix64((u64::from(slot) << 32) | u64::from(purpose)),
        );
        // 53 bits de mantisse : la conversion est exacte et couvre [0, 1).
        (mixed >> 11) as f64 / (1u64 << 53) as f64
    }

    #[inline]
    fn coin(&self, batch: u32, slot: u32, purpose: u32) -> bool {
        self.at(batch, slot, purpose) < 0.5
    }
}

/// Le générateur **de la politique**, séparé de celui de l'environnement.
///
/// Mulberry32, le même que `seededRandom` dans `simulate.ts`. Une politique qui
/// départage au hasard reste ainsi reproductible sans décaler les naissances.
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
///
/// L'ascendance est tirée dans les **recettes de la couleur elle-même**, ce qui
/// garantit qu'elle est atteignable en jeu : une recette de la couleur `c` de
/// génération `g` nomme deux couleurs dont le rang maximal vaut `g − 1`, donc
/// la monture vise bien `g`. Une ascendance tirée au hasard donnerait des
/// montures que le jeu ne peut pas produire, et la politique apprendrait à
/// exploiter des situations qui n'arrivent jamais.
///
/// Ne dépend que de la graine : deux politiques comparées reçoivent exactement
/// la même écurie.
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
            let value = draws.at(POOL_BATCH, index, purpose);
            ((value * count as f64) as usize).min(count - 1)
        };

        let generation = low + pick(purpose::POOL_GENERATION, span as usize) as u8;
        let colors: Vec<ColorId> = catalog.ids_at_generation(generation).collect();
        if colors.is_empty() {
            continue;
        }
        let color = colors[pick(purpose::POOL_COLOR, colors.len())];

        // Toute couleur de génération ≥ 2 porte au moins une recette ; le
        // `filter` n'est là que pour ne pas indexer un tableau vide si les
        // arbres changeaient.
        let recipes = &catalog.color(color).recipes;
        let parents = if recipes.is_empty() {
            None
        } else {
            Some(recipes[pick(purpose::POOL_RECIPE, recipes.len())])
        };

        stable.push(Mount {
            color,
            sex: if draws.coin(POOL_BATCH, index, purpose::POOL_SEX) {
                Sex::Male
            } else {
                Sex::Female
            },
            level: economy.mount_level,
            fertile: true,
            parents,
        });
    }

    stable
}

// ---------------------------------------------------------------------------
// La fournée
// ---------------------------------------------------------------------------

/// Ce qu'une fournée fait, décidé d'un coup.
///
/// ## Les indices sont virtuels
///
/// Les achats sont **ajoutés d'abord**, si bien qu'une monture achetée porte
/// l'indice `stable.len() + j` et peut servir de parent dans la même fournée.
/// Sans ça, acheter et croiser demanderait deux tours, et la politique paierait
/// deux fournées pour ce que le jeu fait en une.
#[derive(Clone, Debug, Default)]
pub struct BatchPlan {
    /// Des gen 1 anonymes : couleur et sexe au choix, sans ascendance.
    pub purchases: Vec<(ColorId, Sex)>,
    /// Paires de stériles de même génération. Gratuit, et l'une des deux
    /// ressort féconde.
    pub clonings: Vec<[usize; 2]>,
    /// `[mâle, femelle]`. Au plus `crossings_per_batch`.
    pub crossings: Vec<[usize; 2]>,
    /// Converties en kamas. Créditées **avant** les dépenses, pour qu'une
    /// fournée puisse se financer elle-même.
    pub sacrifices: Vec<usize>,

    // --- les leviers, uniformes sur toute la fournée -----------------------
    /// La bande de jauge, de 0 (lente et bon marché) à 3 (rapide et chère).
    /// Uniforme sur les cinq enclos pour l'instant ; le réglage par enclos
    /// viendra ensuite.
    pub band: usize,
    /// Le niveau auquel on nourrit les montures de la fournée.
    pub level: u16,
    /// Une Optimakina par croisement, en regard de `crossings`. Vide = aucune.
    pub optimakina: Vec<bool>,
}

/// Ce que la politique voit pour décider. Volontairement pauvre.
pub struct BatchView<'a> {
    pub catalog: &'a Catalog,
    pub economy: &'a Economy,
    pub stable: &'a Stable,
    pub kamas: i64,
}

pub trait Policy {
    fn name(&self) -> &str;
    /// `rng` est celui de la politique, pas celui des naissances.
    fn plan(&mut self, view: &BatchView<'_>, rng: &mut Rng) -> BatchPlan;
}

#[derive(Clone, Debug, PartialEq)]
pub struct RunOutcome {
    /// Le score : solde après la centième fournée, tout le reste liquidé.
    pub score: i64,
    pub balance_before_liquidation: i64,
    pub liquidation: i64,
    pub crossings: usize,
    pub purchases: usize,
    pub clonings: usize,
    pub sacrifices: usize,
    /// Fournées ayant réellement porté un croisement, donc payées.
    pub batches_paid: u32,
    /// La plus haute génération jamais obtenue.
    pub best_generation: u8,
    pub gen10_held: usize,
    /// Heures consommées, quand l'horizon est un temps mural.
    pub hours_used: f64,
    /// Fournées réellement jouées, vides comprises.
    pub batches_played: u32,
    /// Fournées où le plan a été refusé. Doit rester à zéro : une politique qui
    /// produit des plans infaisables est une politique qu'on mesure mal.
    pub infeasible_batches: u32,
}

/// Pourquoi un plan a été refusé. Ce sont des bugs de politique, pas des
/// situations de jeu — d'où le détail.
#[derive(Debug, PartialEq, Eq)]
pub enum Rejected {
    TooManyCrossings { asked: usize, allowed: usize },
    UnknownIndex(usize),
    MountUsedTwice(usize),
    NotFertile(usize),
    SameSex(usize, usize),
    NoOutlook(usize, usize),
    CloneNotSterile(usize),
    CloneGenerationMismatch(usize, usize),
    Unaffordable { needed: i64, available: i64 },
}

#[derive(Debug, PartialEq, Eq)]
struct Batch {
    crossings: usize,
    purchases: usize,
    clonings: usize,
    sacrifices: usize,
    best_generation: u8,
}

/// Applique un plan, ou dit pourquoi il est refusé.
///
/// L'ordre est celui qui rend une fournée auto-finançable : on **crédite les
/// sacrifices d'abord**, puis on débite les achats et la fournée, et le solde
/// doit rester positif. L'inverse obligerait à garder un tour d'avance de
/// trésorerie, ce qui est une règle de jeu qu'on n'a pas.
fn apply(
    catalog: &Catalog,
    economy: &Economy,
    stable: &mut Stable,
    kamas: &mut i64,
    plan: &BatchPlan,
    draws: &Draws,
    batch_index: u32,
) -> Result<Batch, Rejected> {
    if plan.crossings.len() > economy.crossings_per_batch {
        return Err(Rejected::TooManyCrossings {
            asked: plan.crossings.len(),
            allowed: economy.crossings_per_batch,
        });
    }

    let base = stable.len();
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

    let level = if plan.level == 0 {
        economy.mount_level
    } else {
        plan.level.min(MAX_MOUNT_LEVEL)
    };

    let mut debit = plan.purchases.len() as i64 * economy.starter_price;
    if !plan.crossings.is_empty() {
        debit += economy.batch_cost_for(plan.band, level);
        // Une Optimakina se paie au croisement, au prix de la génération visée.
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
            let target = pair_target_generation(catalog, &resolve(male), &resolve(female));
            debit += economy.optimakina[usize::from(target).min(10)];
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
            level: economy.mount_level,
            fertile: true,
            parents: None,
        });
    }

    // Chaque monture ne sert qu'une fois par fournée, tous usages confondus.
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
            || draws.coin(batch_index, slot as u32, purpose::CLONE)
        {
            a
        } else {
            b
        };
        stable.mounts[survivor].fertile = true;
        doomed.push(if survivor == a { b } else { a });
    }

    // --- croisements -------------------------------------------------------
    let mut best_generation = 0;
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

        let (m, f) = (stable.mounts[male].mate(), stable.mounts[female].mate());
        if pair_outlook(catalog, &m, &f).is_none() {
            // Cible au-dessus du plafond de la famille : le jeu ne propose pas
            // l'accouplement, donc la politique ne doit pas le demander.
            return Err(Rejected::NoOutlook(male, female));
        }

        // La fécondité se consomme, et définitivement.
        stable.mounts[male].fertile = false;
        stable.mounts[female].fertile = false;

        let rate = economy.success_rate(level, plan.optimakina.get(slot).copied().unwrap_or(false));
        let outcomes = mating_outcomes_at(catalog, &m, &f, Some(rate));
        let slot_index = slot as u32;
        let mut roll = draws.at(batch_index, slot_index, purpose::OUTCOME);
        let mut color = outcomes[outcomes.len() - 1].color;
        for outcome in &outcomes {
            if roll < outcome.probability {
                color = outcome.color;
                break;
            }
            roll -= outcome.probability;
        }

        best_generation = best_generation.max(catalog.generation(color));
        births.push(Mount {
            color,
            sex: if draws.coin(batch_index, slot_index, purpose::SEX) {
                Sex::Male
            } else {
                Sex::Female
            },
            level,
            fertile: true,
            parents: Some([m.color, f.color]),
        });
    }

    // --- sacrifices --------------------------------------------------------
    for &index in &plan.sacrifices {
        claim(index, &mut used)?;
        doomed.push(index);
    }

    *kamas = *kamas + credit - debit;
    debug_assert!(*kamas >= 0, "le plancher est vérifié plus haut");

    stable.remove_all(&doomed);
    for birth in births {
        stable.push(birth);
    }

    Ok(Batch {
        crossings: plan.crossings.len(),
        purchases: plan.purchases.len(),
        clonings: plan.clonings.len(),
        sacrifices: plan.sacrifices.len(),
        best_generation,
    })
}

/// Joue une partie complète et rend son score.
///
/// `seed` fixe **l'écurie de départ et toutes les naissances**. Deux politiques
/// jouées sur la même graine affrontent donc exactement le même jeu, et l'écart
/// de score leur est imputable.
pub fn play(catalog: &Catalog, economy: &Economy, policy: &mut dyn Policy, seed: u32) -> RunOutcome {
    let draws = Draws::new(seed);
    let mut stable = starting_stable(catalog, economy, &draws);
    let mut kamas = economy.starting_kamas;
    // Décalée exprès : la politique ne doit pas pouvoir rejouer le flux des
    // naissances en devinant sa propre graine.
    let mut rng = Rng::new(seed ^ 0x5bf0_3635);

    let mut outcome = RunOutcome {
        score: 0,
        balance_before_liquidation: 0,
        liquidation: 0,
        crossings: 0,
        purchases: 0,
        clonings: 0,
        sacrifices: 0,
        batches_paid: 0,
        best_generation: stable.top_generation(catalog),
        gen10_held: 0,
        infeasible_batches: 0,
        hours_used: 0.0,
        batches_played: 0,
    };

    // L'horizon est soit un nombre de tours, soit un temps mural. Dans le second
    // cas c'est la **politique** qui décide combien de fournées elle joue, en
    // choisissant leur vitesse : quatre fois plus de tours pour onze fois le
    // prix du tour. Le garde-fou à 5 000 existe pour qu'une politique qui ne
    // fait rien ne tourne pas indéfiniment.
    let mut elapsed = 0.0f64;
    let mut batch_index = 0u32;
    // Une fournée entièrement vide ne change rien à l'écurie ni au solde, donc
    // la suivante sera identique : la partie est finie, elle ne le sait pas.
    //
    // Sans cette garde, une politique inerte consomme les cinq minutes de
    // manipulation et rejoue la recherche complète trois mille six cents fois
    // pour arriver au bout des 300 heures. Mesuré : la première génération d'un
    // entraînement, peuplée de réseaux aléatoires qui ne proposent rien,
    // prenait 247 secondes au lieu de deux.
    const IDLE_LIMIT: u32 = 3;
    let mut idle = 0u32;
    while match economy.horizon_hours {
        Some(budget) => elapsed < budget && idle < IDLE_LIMIT,
        None => batch_index < economy.batches,
    } {
        let plan = {
            let view = BatchView {
                catalog,
                economy,
                stable: &stable,
                kamas,
            };
            policy.plan(&view, &mut rng)
        };

        match apply(
            catalog,
            economy,
            &mut stable,
            &mut kamas,
            &plan,
            &draws,
            batch_index,
        ) {
            Ok(batch) => {
                outcome.crossings += batch.crossings;
                outcome.purchases += batch.purchases;
                outcome.clonings += batch.clonings;
                outcome.sacrifices += batch.sacrifices;
                outcome.best_generation = outcome.best_generation.max(batch.best_generation);
                if batch.crossings > 0 {
                    outcome.batches_paid += 1;
                    // Une fournée qui tourne prend le temps de son remplissage
                    // de jauge ; une fournée vide ne coûte que la manipulation.
                    elapsed += economy.batch_hours(plan.band);
                    idle = 0;
                } else {
                    elapsed += economy.overhead_hours;
                    // Clonages et sacrifices changent l'écurie : la fournée
                    // n'est inerte que si elle ne fait vraiment rien.
                    if batch.clonings + batch.sacrifices + batch.purchases == 0 {
                        idle += 1;
                    } else {
                        idle = 0;
                    }
                }
            }
            Err(_) => {
                // Une fournée refusée est une fournée perdue : on ne devine pas
                // ce que la politique aurait voulu à la place. Le compteur est
                // remonté pour qu'une politique bancale se voie au lieu de
                // passer pour prudente.
                outcome.infeasible_batches += 1;
                elapsed += economy.overhead_hours;
                idle += 1;
            }
        }
        batch_index += 1;
    }
    outcome.hours_used = elapsed;
    outcome.batches_played = batch_index;

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
    outcome.best_generation = outcome.best_generation.max(stable.top_generation(catalog));
    outcome.score = kamas + outcome.liquidation;
    outcome
}

/// Le plancher : ne rien faire, garder le capital et liquider le pool.
///
/// Toute politique qui ne le bat pas détruit de la valeur. Il vaut mieux le
/// savoir tout de suite que le découvrir après une heure d'entraînement.
pub struct NeverBreeds;

impl Policy for NeverBreeds {
    fn name(&self) -> &str {
        "ne-rien-faire"
    }
    fn plan(&mut self, _view: &BatchView<'_>, _rng: &mut Rng) -> BatchPlan {
        BatchPlan::default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::trees::muldo;

    #[test]
    fn le_plancher_garde_le_capital_et_liquide_le_pool() {
        let catalog = muldo();
        let economy = Economy::default();
        let outcome = play(&catalog, &economy, &mut NeverBreeds, 1);

        assert_eq!(outcome.balance_before_liquidation, 10_000_000);
        assert_eq!(outcome.crossings, 0);
        assert_eq!(outcome.batches_paid, 0, "une fournée vide est gratuite");
        assert_eq!(outcome.infeasible_batches, 0);
        assert!(
            outcome.liquidation > 0,
            "les cent montures du pool valent quelque chose"
        );
        assert_eq!(outcome.score, 10_000_000 + outcome.liquidation);
    }

    #[test]
    fn le_pool_de_depart_est_jouable() {
        let catalog = muldo();
        let economy = Economy::default();
        let draws = Draws::new(12345);
        let stable = starting_stable(&catalog, &economy, &draws);

        assert_eq!(stable.len(), 100);
        for mount in &stable.mounts {
            let generation = catalog.generation(mount.color);
            assert!(
                (2..=9).contains(&generation),
                "{} est en gen {generation}",
                catalog.slug(mount.color)
            );
            assert!(mount.fertile);

            // La généalogie doit être **atteignable** : les deux parents
            // nomment bien la couleur, et leur rang maximal vaut `g - 1`, donc
            // la monture vise bien sa propre génération.
            let parents = mount.parents.expect("une gen ≥ 2 a des parents");
            assert_eq!(
                catalog.names_at(generation, parents[0], parents[1]),
                Some(mount.color),
                "{} ne se compose pas de {} et {}",
                catalog.slug(mount.color),
                catalog.slug(parents[0]),
                catalog.slug(parents[1])
            );
            assert_eq!(
                catalog
                    .generation(parents[0])
                    .max(catalog.generation(parents[1])),
                generation - 1
            );
        }
    }

    #[test]
    fn le_pool_couvre_toute_la_plage_de_generations() {
        // Sans ça, l'amorçage ne corrigerait pas le déséquilibre qu'il vise.
        let catalog = muldo();
        let economy = Economy::default();
        let stable = starting_stable(&catalog, &economy, &Draws::new(7));
        let mut seen = [false; 11];
        for mount in &stable.mounts {
            seen[catalog.generation(mount.color) as usize] = true;
        }
        for generation in 2..=9 {
            assert!(seen[generation], "aucune monture en gen {generation}");
        }
    }

    /// Le point de la remarque sur les *common random numbers* : deux
    /// politiques qui consomment des quantités différentes de hasard doivent
    /// quand même recevoir la même écurie et les mêmes naissances.
    #[test]
    fn deux_politiques_voient_le_meme_jeu() {
        struct Gourmande;
        impl Policy for Gourmande {
            fn name(&self) -> &str {
                "gourmande"
            }
            fn plan(&mut self, _view: &BatchView<'_>, rng: &mut Rng) -> BatchPlan {
                // Consomme du hasard sans rien faire : si les flux étaient
                // partagés, ça décalerait toutes les naissances.
                for _ in 0..17 {
                    rng.next_f64();
                }
                BatchPlan::default()
            }
        }

        let catalog = muldo();
        let economy = Economy::default();
        let sobre = play(&catalog, &economy, &mut NeverBreeds, 99);
        let gourmande = play(&catalog, &economy, &mut Gourmande, 99);

        assert_eq!(
            sobre.score, gourmande.score,
            "le hasard consommé par la politique ne doit pas déplacer le jeu"
        );
        assert_eq!(sobre.liquidation, gourmande.liquidation);
    }

    #[test]
    fn un_tirage_ne_depend_que_de_ses_coordonnees() {
        let draws = Draws::new(5);
        assert_eq!(draws.at(3, 7, 0), draws.at(3, 7, 0));
        assert_ne!(draws.at(3, 7, 0), draws.at(3, 7, 1));
        assert_ne!(draws.at(3, 7, 0), draws.at(4, 7, 0));
        assert_ne!(draws.at(3, 7, 0), draws.at(3, 8, 0));
        for batch in 0..50 {
            for slot in 0..25 {
                let value = draws.at(batch, slot, 0);
                assert!((0.0..1.0).contains(&value), "{value}");
            }
        }
    }

    #[test]
    fn un_gen_1_achete_ne_rend_rien_a_l_ambre() {
        // La boucle de monnaie infinie, refermée. Si ce test tombe, une
        // politique évoluée trouvera l'exploit avant nous.
        let catalog = muldo();
        let economy = Economy::default();
        for id in catalog.ids_at_generation(1) {
            assert_eq!(economy.value_of(&catalog, id), 0, "{}", catalog.slug(id));
        }
    }

    #[test]
    fn la_valeur_suit_le_rang_et_la_gen_10_est_a_part() {
        let catalog = muldo();
        let economy = Economy::default();
        let value = |slug: &str| economy.value_of(&catalog, catalog.id_of(slug).expect(slug));
        assert_eq!(value("dore"), 0, "gen 1 : ne s'extrait pas");
        assert_eq!(value("dore_amande"), 80_000, "gen 4 → 4 × 20 000");
        assert_eq!(value("ambre"), 180_000, "gen 9 → 9 × 20 000");
        assert_eq!(value("ambre_dore"), 500_000, "gen 10, prix fixe");
    }

    #[test]
    fn la_fecondite_se_consomme_et_ne_revient_pas() {
        let catalog = muldo();
        let economy = Economy::default();
        let dore = catalog.id_of("dore").expect("dore");

        let mut stable = Stable::new();
        for sex in [Sex::Male, Sex::Female] {
            stable.push(Mount {
                color: dore,
                sex,
                level: 67,
                fertile: true,
                parents: None,
            });
        }
        let mut kamas = 10_000_000;
        let plan = BatchPlan {
            crossings: vec![[0, 1]],
            ..Default::default()
        };

        apply(
            &catalog,
            &economy,
            &mut stable,
            &mut kamas,
            &plan,
            &Draws::new(3),
            0,
        )
        .expect("plan valide");

        assert_eq!(stable.len(), 3);
        assert_eq!(stable.mounts.iter().filter(|m| m.fertile).count(), 1);
        assert_eq!(kamas, 10_000_000 - 150_000);
    }

    #[test]
    fn un_plan_infaisable_est_refuse_et_pas_applique() {
        let catalog = muldo();
        let economy = Economy::default();
        let dore = catalog.id_of("dore").expect("dore");

        let mut stable = Stable::new();
        for sex in [Sex::Male, Sex::Female] {
            stable.push(Mount {
                color: dore,
                sex,
                level: 67,
                fertile: true,
                parents: None,
            });
        }
        let mut kamas = 1_000;
        let plan = BatchPlan {
            crossings: vec![[0, 1]],
            ..Default::default()
        };

        assert_eq!(
            apply(
                &catalog,
                &economy,
                &mut stable,
                &mut kamas,
                &plan,
                &Draws::new(3),
                0
            ),
            Err(Rejected::Unaffordable {
                needed: 150_000,
                available: 1_000
            })
        );
        assert_eq!(kamas, 1_000, "le solde n'a pas bougé");
        assert!(
            stable.mounts.iter().all(|m| m.fertile),
            "aucune fécondité consommée"
        );
    }

    #[test]
    fn une_monture_ne_sert_qu_une_fois_par_fournee() {
        let catalog = muldo();
        let economy = Economy::default();
        let dore = catalog.id_of("dore").expect("dore");

        let mut stable = Stable::new();
        stable.push(Mount {
            color: dore,
            sex: Sex::Male,
            level: 67,
            fertile: true,
            parents: None,
        });
        for _ in 0..2 {
            stable.push(Mount {
                color: dore,
                sex: Sex::Female,
                level: 67,
                fertile: true,
                parents: None,
            });
        }

        let mut kamas = 10_000_000;
        let plan = BatchPlan {
            crossings: vec![[0, 1], [0, 2]],
            ..Default::default()
        };
        assert_eq!(
            apply(
                &catalog,
                &economy,
                &mut stable,
                &mut kamas,
                &plan,
                &Draws::new(3),
                0
            ),
            Err(Rejected::MountUsedTwice(0))
        );
    }

    #[test]
    fn le_tirage_est_reproductible() {
        let catalog = muldo();
        let economy = Economy::default();
        assert_eq!(
            play(&catalog, &economy, &mut NeverBreeds, 42),
            play(&catalog, &economy, &mut NeverBreeds, 42)
        );
    }
}
