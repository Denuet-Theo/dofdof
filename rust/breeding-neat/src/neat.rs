//! NEAT : des réseaux qui font pousser leur propre topologie.
//!
//! ## Pourquoi écrit à la main plutôt que pris sur étagère
//!
//! Le crate `neat` (1.0.2) et `radiate` (1.3.0) existent et sont corrects.
//! Mais l'algorithme NEAT tient en quatre cents lignes, alors que la partie
//! coûteuse et spécifique est **l'évaluation** : graines communes, rotation,
//! parallélisme sur douze cœurs, et une fitness qui coûte une seconde. Aucune
//! bibliothèque ne fournit ça, et toutes imposent leur boucle. On garde donc la
//! boucle et on écrit l'algorithme.
//!
//! ## Ce qui évolue
//!
//! Un réseau `V` qui note une écurie. Il ne choisit pas la fournée — c'est la
//! recherche de `search.rs` qui explore les compositions — il dit seulement
//! laquelle il préfère. C'est ce qui le sort de la myopie : il ne juge pas ce
//! qu'un croisement rapporte, mais ce que l'écurie **devient**.
//!
//! ## Ce qu'on ne lui donne pas
//!
//! Aucune sortie de `scoreOf`, aucune valeur de liquidation, aucun terme
//! d'amorçage. On aurait converger plus vite en apprenant le résidu au-dessus de
//! la valeur myope, et on aurait réinjecté l'heuristique qu'on prétend chercher.
//! Le réseau part de rien et doit retrouver seul que l'ambre vaut le rang.
//!
//! ## Sans récurrence
//!
//! Une écurie est un état complet : il n'y a rien à mémoriser d'un tour sur
//! l'autre, et la politique n'a de toute façon pas le droit de connaître le
//! numéro de la fournée. On refuse donc les cycles, ce qui rend l'évaluation
//! d'un réseau linéaire en son nombre de liens.

use std::collections::HashMap;

use breeding_sim::encode::FEATURES;

/// Entrées, plus un biais constant.
pub const INPUTS: usize = FEATURES;
pub const BIAS: usize = INPUTS;
pub const OUTPUT: usize = INPUTS + 1;
pub const FIRST_HIDDEN: usize = INPUTS + 2;

/// Un générateur déterministe, pour que deux entraînements de même graine
/// donnent la même population.
#[derive(Clone, Debug)]
pub struct Rng(u64);

impl Rng {
    pub fn new(seed: u64) -> Self {
        Self(seed.wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1)
    }

    #[inline]
    pub fn next_u64(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        self.0 = x;
        x
    }

    #[inline]
    pub fn f64(&mut self) -> f64 {
        (self.next_u64() >> 11) as f64 / (1u64 << 53) as f64
    }

    #[inline]
    pub fn range(&mut self, count: usize) -> usize {
        if count == 0 {
            return 0;
        }
        (self.next_u64() % count as u64) as usize
    }

    /// Une normale approchée, somme de douze uniformes. Largement suffisante
    /// pour perturber un poids, et sans dépendance.
    pub fn normal(&mut self) -> f64 {
        (0..12).map(|_| self.f64()).sum::<f64>() - 6.0
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Connection {
    pub from: usize,
    pub to: usize,
    pub weight: f64,
    pub enabled: bool,
    /// Le marqueur historique : deux liens de même innovation sont « le même »
    /// lien, quelle que soit la lignée. C'est ce qui rend le croisement de deux
    /// topologies différentes possible sans alignement coûteux.
    pub innovation: u64,
}

#[derive(Clone, Debug)]
pub struct Genome {
    /// Identifiants des nœuds cachés. Entrées, biais et sortie sont implicites.
    pub hidden: Vec<usize>,
    pub connections: Vec<Connection>,

    // --- les réglages stratégiques -----------------------------------------
    //
    // Ils sont **dans le génome et non dans la recherche**, et c'est le seul
    // moyen de les décider sans montrer le temps écoulé à la politique.
    //
    // Une bande rapide ne se justifie que par les fournées supplémentaires
    // qu'elle laisse jouer — un bénéfice qui n'apparaît nulle part dans
    // l'écurie que la fournée laisse derrière elle. Une recherche guidée par la
    // valeur d'état prendrait donc toujours la bande la moins chère. Il
    // faudrait lui montrer le temps restant, ce qui revient à lui donner le
    // numéro de tour — précisément ce qui est interdit.
    //
    // L'évolution, elle, note sur le **score final**, qui compte les heures.
    // Elle peut donc arbitrer sans que la politique ait rien vu.
    /// La bande de chacune des six jauges — Baffeur, Caresseur, Foudroyeur,
    /// Dragofesse, Abreuvoir, Mangeoire — de 0 (lente, bon marché) à 3.
    ///
    /// Six réglages et non un : la bande se choisit jauge par jauge, donc on
    /// peut payer cher ce qui est sur le chemin critique et laisser le reste au
    /// tarif du bas. C'est le gain qu'une bande unique pour tout l'enclos ne
    /// pouvait pas voir — l'Abreuvoir, par exemple, est moins cher en bande 1
    /// qu'en bande 0 tout en allant deux fois plus vite.
    pub bands: [usize; 6],
    /// Niveau auquel nourrir les montures. Décide du taux de réussite.
    pub level: u16,
    /// Acheter une Optimakina à partir de cette génération visée. 11 = jamais.
    pub optimakina_from: u8,
}

/// Le registre des innovations, partagé par toute la population.
///
/// Sans lui, deux mutations identiques survenues dans deux lignées porteraient
/// des numéros différents et le croisement les compterait comme deux liens
/// distincts — la topologie enflerait sans rien apprendre.
#[derive(Default)]
pub struct Innovations {
    next_innovation: u64,
    next_node: usize,
    links: HashMap<(usize, usize), u64>,
    splits: HashMap<u64, usize>,
}

impl Innovations {
    pub fn new() -> Self {
        Self {
            next_innovation: 0,
            next_node: FIRST_HIDDEN,
            links: HashMap::new(),
            splits: HashMap::new(),
        }
    }

    fn link(&mut self, from: usize, to: usize) -> u64 {
        if let Some(&known) = self.links.get(&(from, to)) {
            return known;
        }
        let innovation = self.next_innovation;
        self.next_innovation += 1;
        self.links.insert((from, to), innovation);
        innovation
    }

    /// Couper un lien donne toujours le **même** nœud, pour la même raison.
    fn split(&mut self, innovation: u64) -> usize {
        if let Some(&known) = self.splits.get(&innovation) {
            return known;
        }
        let node = self.next_node;
        self.next_node += 1;
        self.splits.insert(innovation, node);
        node
    }
}

/// Le niveau maximal d'une monture.
pub const MAX_LEVEL: u16 = 200;

/// Déplace `value` d'au plus `step`, dans un sens ou dans l'autre, borné.
///
/// Le pas est tiré dans `[1, step]` plutôt que fixé : un pas constant sur le
/// niveau ne visiterait qu'un réseau de valeurs espacées de dix, et l'optimum
/// tomberait entre deux.
fn nudge(value: i64, step: i64, low: i64, high: i64, rng: &mut Rng) -> i64 {
    let magnitude = 1 + rng.range(step.max(1) as usize) as i64;
    let delta = if rng.f64() < 0.5 { -magnitude } else { magnitude };
    (value + delta).clamp(low, high)
}

pub struct Config {
    /// Probabilité de toucher à la bande, au niveau ou au seuil d'Optimakina.
    pub strategy_mutation: f64,
    pub weight_mutation: f64,
    pub weight_perturbation: f64,
    pub perturbation_power: f64,
    pub add_connection: f64,
    pub add_node: f64,
    pub toggle: f64,
    pub crossover_rate: f64,
    /// Distance de compatibilité : `c1·excès + c2·disjoints + c3·écart de poids`.
    pub c1: f64,
    pub c2: f64,
    pub c3: f64,
    pub compatibility_threshold: f64,
    pub survival_threshold: f64,
    pub population: usize,
    /// Générations sans progrès avant qu'une espèce cesse d'être protégée.
    pub stagnation: usize,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            strategy_mutation: 0.35,
            weight_mutation: 0.8,
            weight_perturbation: 0.9,
            perturbation_power: 0.5,
            add_connection: 0.08,
            add_node: 0.04,
            toggle: 0.01,
            crossover_rate: 0.75,
            c1: 1.0,
            c2: 1.0,
            c3: 0.4,
            compatibility_threshold: 3.0,
            survival_threshold: 0.2,
            population: 128,
            stagnation: 20,
        }
    }
}

impl Genome {
    /// Le génome de départ : chaque entrée reliée à la sortie, rien de plus.
    ///
    /// NEAT part **minimal** et complexifie seulement quand la sélection le
    /// récompense. Démarrer avec une couche cachée reviendrait à choisir la
    /// forme de la fonction, ce qu'on refuse précisément de faire.
    pub fn minimal(innovations: &mut Innovations, rng: &mut Rng) -> Self {
        let connections = (0..=INPUTS)
            .map(|from| Connection {
                from,
                to: OUTPUT,
                weight: rng.normal(),
                enabled: true,
                innovation: innovations.link(from, OUTPUT),
            })
            .collect();
        Self {
            hidden: Vec::new(),
            connections,
            // On part au milieu plutôt qu'à un extrême : l'évolution doit
            // pouvoir descendre comme monter dès la première génération.
            bands: std::array::from_fn(|_| rng.range(4)),
            level: 1 + rng.range(MAX_LEVEL as usize) as u16,
            optimakina_from: 2 + rng.range(10) as u8,
        }
    }

    pub fn mutate(&mut self, config: &Config, innovations: &mut Innovations, rng: &mut Rng) {
        // Les réglages stratégiques bougent par petits pas la plupart du temps,
        // et par saut de temps en temps : un optimum local sur la bande coûte
        // très cher, et un pas de un ne le franchit jamais.
        if rng.f64() < config.strategy_mutation {
            match rng.range(3) {
                0 => {
                    // Une jauge à la fois : muter les six d'un coup ferait
                    // perdre en bloc une combinaison qui ne vaut que prise
                    // ensemble. Saut franc de temps en temps, parce que les
                    // bandes sont séparées par des facteurs de prix énormes et
                    // qu'un optimum local ne se franchit pas d'un cran.
                    let gauge = rng.range(6);
                    self.bands[gauge] = if rng.f64() < 0.7 {
                        nudge(self.bands[gauge] as i64, 1, 0, 3, rng) as usize
                    } else {
                        rng.range(4)
                    }
                }
                1 => {
                    let step = if rng.f64() < 0.7 { 10 } else { 60 };
                    self.level =
                        nudge(i64::from(self.level), step, 1, i64::from(MAX_LEVEL), rng) as u16
                }
                _ => {
                    self.optimakina_from =
                        nudge(i64::from(self.optimakina_from), 1, 2, 11, rng) as u8
                }
            }
        }
        if rng.f64() < config.weight_mutation {
            for connection in &mut self.connections {
                if rng.f64() < config.weight_perturbation {
                    connection.weight += rng.normal() * config.perturbation_power;
                } else {
                    connection.weight = rng.normal();
                }
            }
        }
        if rng.f64() < config.toggle && !self.connections.is_empty() {
            let at = rng.range(self.connections.len());
            self.connections[at].enabled = !self.connections[at].enabled;
        }
        if rng.f64() < config.add_connection {
            self.add_connection(innovations, rng);
        }
        if rng.f64() < config.add_node {
            self.add_node(innovations, rng);
        }
    }

    fn nodes(&self) -> Vec<usize> {
        let mut all: Vec<usize> = (0..=OUTPUT).collect();
        all.extend_from_slice(&self.hidden);
        all
    }

    /// Ajoute un lien, à condition qu'il ne referme pas de cycle.
    fn add_connection(&mut self, innovations: &mut Innovations, rng: &mut Rng) {
        let nodes = self.nodes();
        for _ in 0..20 {
            let from = nodes[rng.range(nodes.len())];
            let to = nodes[rng.range(nodes.len())];
            // Rien n'entre dans une entrée ni dans le biais, rien ne sort de la
            // sortie, et pas de boucle sur soi.
            if to <= BIAS || from == OUTPUT || from == to {
                continue;
            }
            if self.connections.iter().any(|c| c.from == from && c.to == to) {
                continue;
            }
            if self.reaches(to, from) {
                continue;
            }
            self.connections.push(Connection {
                from,
                to,
                weight: rng.normal(),
                enabled: true,
                innovation: innovations.link(from, to),
            });
            return;
        }
    }

    /// Y a-t-il un chemin de `start` à `goal` ? Sert à refuser les cycles.
    fn reaches(&self, start: usize, goal: usize) -> bool {
        let mut stack = vec![start];
        let mut seen = vec![start];
        while let Some(node) = stack.pop() {
            if node == goal {
                return true;
            }
            for connection in &self.connections {
                if connection.from == node && !seen.contains(&connection.to) {
                    seen.push(connection.to);
                    stack.push(connection.to);
                }
            }
        }
        false
    }

    /// Coupe un lien en deux et met un nœud au milieu.
    ///
    /// L'ancien lien est désactivé mais **conservé** : il porte son innovation,
    /// donc un croisement ultérieur saura que les deux lignées parlent du même.
    /// Le premier segment prend le poids 1 et le second l'ancien poids, ce qui
    /// laisse la fonction quasi inchangée juste après la mutation — une
    /// complexification qui casserait tout serait éliminée avant d'avoir servi.
    fn add_node(&mut self, innovations: &mut Innovations, rng: &mut Rng) {
        let enabled: Vec<usize> = (0..self.connections.len())
            .filter(|&i| self.connections[i].enabled)
            .collect();
        if enabled.is_empty() {
            return;
        }
        let at = enabled[rng.range(enabled.len())];
        let old = self.connections[at];
        self.connections[at].enabled = false;

        let node = innovations.split(old.innovation);
        if self.hidden.contains(&node) {
            // Le même lien a déjà été coupé dans ce génome : on ne recrée pas le
            // nœud, sinon deux arêtes porteraient la même innovation.
            self.connections[at].enabled = true;
            return;
        }
        self.hidden.push(node);
        self.connections.push(Connection {
            from: old.from,
            to: node,
            weight: 1.0,
            enabled: true,
            innovation: innovations.link(old.from, node),
        });
        self.connections.push(Connection {
            from: node,
            to: old.to,
            weight: old.weight,
            enabled: true,
            innovation: innovations.link(node, old.to),
        });
    }

    /// À quel point deux génomes sont différents.
    ///
    /// C'est ce qui fonde la **spéciation** : une topologie nouvelle est
    /// presque toujours mauvaise au moment où elle apparaît, et sans protection
    /// elle disparaît avant d'avoir été affinée. On regroupe donc les génomes
    /// proches et on les fait concourir entre eux.
    pub fn distance(&self, other: &Genome, config: &Config) -> f64 {
        let mine: HashMap<u64, f64> = self
            .connections
            .iter()
            .map(|c| (c.innovation, c.weight))
            .collect();
        let theirs: HashMap<u64, f64> = other
            .connections
            .iter()
            .map(|c| (c.innovation, c.weight))
            .collect();

        let mut matching = 0.0;
        let mut weight_gap = 0.0;
        for (innovation, weight) in &mine {
            if let Some(other_weight) = theirs.get(innovation) {
                matching += 1.0;
                weight_gap += (weight - other_weight).abs();
            }
        }
        let disjoint = (mine.len() + theirs.len()) as f64 - 2.0 * matching;
        let size = mine.len().max(theirs.len()).max(1) as f64;

        // `c1` et `c2` ne sont pas distingués ici : séparer excès et disjoints
        // demande un ordre global sur les innovations que rien n'exploite dans
        // la suite, et les deux coefficients valent la même chose par défaut.
        (config.c1.max(config.c2)) * disjoint / size
            + config.c3 * if matching > 0.0 { weight_gap / matching } else { 0.0 }
    }

    /// Le croisement de deux génomes, le meilleur en premier.
    ///
    /// Les liens communs sont tirés au hasard entre les deux parents ; ceux qui
    /// n'existent que chez le meilleur sont hérités. Un lien désactivé chez l'un
    /// des deux a des chances de le rester : c'est ce qui permet à une
    /// topologie de garder une arête en réserve.
    pub fn crossover(better: &Genome, worse: &Genome, rng: &mut Rng) -> Genome {
        let theirs: HashMap<u64, Connection> = worse
            .connections
            .iter()
            .map(|c| (c.innovation, *c))
            .collect();

        let mut connections = Vec::with_capacity(better.connections.len());
        for connection in &better.connections {
            let mut child = *connection;
            if let Some(other) = theirs.get(&connection.innovation) {
                if rng.f64() < 0.5 {
                    child.weight = other.weight;
                }
                if (!connection.enabled || !other.enabled) && rng.f64() < 0.75 {
                    child.enabled = false;
                }
            }
            connections.push(child);
        }

        let mut hidden = Vec::new();
        for connection in &connections {
            for node in [connection.from, connection.to] {
                if node >= FIRST_HIDDEN && !hidden.contains(&node) {
                    hidden.push(node);
                }
            }
        }

        // Les réglages stratégiques suivent le meilleur parent, sauf tirage :
        // ce sont trois nombres, pas une topologie, et les mélanger au hasard
        // détruirait des combinaisons qui ne valent que prises ensemble — une
        // bande rapide sans le niveau qui va avec ne vaut rien.
        fn pick<T>(better: T, worse: T, rng: &mut Rng) -> T {
            if rng.f64() < 0.75 { better } else { worse }
        }
        Genome {
            hidden,
            connections,
            // Chaque jauge se tire indépendamment : deux parents peuvent avoir
            // trouvé chacun un bon réglage sur des jauges différentes.
            bands: std::array::from_fn(|g| pick(better.bands[g], worse.bands[g], rng)),
            level: pick(better.level, worse.level, rng),
            optimakina_from: pick(better.optimakina_from, worse.optimakina_from, rng),
        }
    }

    pub fn size(&self) -> (usize, usize) {
        (
            self.hidden.len(),
            self.connections.iter().filter(|c| c.enabled).count(),
        )
    }
}

/// Un génome compilé, prêt à être évalué des millions de fois.
///
/// L'ordre topologique est calculé une fois ; l'évaluation n'est plus qu'un
/// parcours linéaire des liens.
pub struct Network {
    order: Vec<usize>,
    /// Pour chaque nœud dans l'ordre, ses entrées `(indice de valeur, poids)`.
    incoming: Vec<Vec<(usize, f64)>>,
    /// Gardé pour la vérification d'acyclicité : un nœud absent de l'ordre
    /// topologique est un nœud pris dans un cycle, et c'est ce que le test
    /// `aucune_mutation_ne_cree_de_cycle` compte. Inutile à l'évaluation, d'où
    /// l'avertissement qu'on tait plutôt que de perdre la garde.
    #[allow(dead_code)]
    slot_of: HashMap<usize, usize>,
    output_slot: usize,
}

impl Network {
    pub fn compile(genome: &Genome) -> Self {
        let mut nodes: Vec<usize> = (0..=OUTPUT).collect();
        nodes.extend_from_slice(&genome.hidden);

        let live: Vec<&Connection> = genome.connections.iter().filter(|c| c.enabled).collect();

        // Tri topologique de Kahn. Le génome garantit l'absence de cycle, mais
        // on se garde d'en dépendre : un nœud non ordonné est simplement ignoré.
        let mut remaining: HashMap<usize, usize> = nodes.iter().map(|&n| (n, 0)).collect();
        for connection in &live {
            *remaining.entry(connection.to).or_insert(0) += 1;
        }
        let mut ready: Vec<usize> = nodes
            .iter()
            .copied()
            .filter(|n| remaining.get(n).copied().unwrap_or(0) == 0)
            .collect();
        ready.sort_unstable();

        let mut order = Vec::with_capacity(nodes.len());
        while let Some(node) = ready.pop() {
            order.push(node);
            for connection in live.iter().filter(|c| c.from == node) {
                let count = remaining.entry(connection.to).or_insert(0);
                *count -= 1;
                if *count == 0 {
                    ready.push(connection.to);
                }
            }
        }

        let slot_of: HashMap<usize, usize> =
            order.iter().enumerate().map(|(slot, &n)| (n, slot)).collect();
        let mut incoming = vec![Vec::new(); order.len()];
        for connection in &live {
            let (Some(&from), Some(&to)) = (slot_of.get(&connection.from), slot_of.get(&connection.to))
            else {
                continue;
            };
            incoming[to].push((from, connection.weight));
        }

        let output_slot = slot_of.get(&OUTPUT).copied().unwrap_or(0);
        Self {
            order,
            incoming,
            slot_of,
            output_slot,
        }
    }

    /// La valeur que le réseau donne à un vecteur d'entrée.
    ///
    /// Sortie **linéaire**, pas de `tanh` : la recherche compare des valeurs
    /// entre elles, et une sortie saturée rendrait des milliers de compositions
    /// exactement égales — la montée de colline n'aurait plus de pente à
    /// suivre.
    pub fn value(&self, inputs: &[f64; FEATURES]) -> f64 {
        let mut values = vec![0.0; self.order.len()];
        for (slot, &node) in self.order.iter().enumerate() {
            if node < INPUTS {
                values[slot] = inputs[node];
                continue;
            }
            if node == BIAS {
                values[slot] = 1.0;
                continue;
            }
            let sum: f64 = self.incoming[slot]
                .iter()
                .map(|&(from, weight)| values[from] * weight)
                .sum();
            values[slot] = if node == OUTPUT { sum } else { sum.tanh() };
        }
        values[self.output_slot]
    }

    pub fn is_connected(&self) -> bool {
        !self.incoming[self.output_slot].is_empty()
    }

    /// Combien de nœuds l'ordre topologique a retenus. Voir `slot_of`.
    #[allow(dead_code)]
    pub fn slots(&self) -> usize {
        self.slot_of.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn le_genome_minimal_relie_toutes_les_entrees_a_la_sortie() {
        let mut innovations = Innovations::new();
        let mut rng = Rng::new(1);
        let genome = Genome::minimal(&mut innovations, &mut rng);
        assert_eq!(genome.connections.len(), INPUTS + 1, "les entrées plus le biais");
        assert!(genome.hidden.is_empty());

        let network = Network::compile(&genome);
        assert!(network.is_connected());
        let value = network.value(&[0.5; FEATURES]);
        assert!(value.is_finite());
    }

    #[test]
    fn couper_un_lien_ne_change_presque_pas_la_fonction() {
        // C'est la propriété qui rend la complexification survivable : une
        // mutation structurelle doit pouvoir être jugée sur ce qu'elle permet,
        // pas sur le choc qu'elle inflige.
        let mut innovations = Innovations::new();
        let mut rng = Rng::new(7);
        let mut genome = Genome::minimal(&mut innovations, &mut rng);

        let inputs = [0.3; FEATURES];
        let before = Network::compile(&genome).value(&inputs);
        genome.add_node(&mut innovations, &mut rng);
        let after = Network::compile(&genome).value(&inputs);

        assert_eq!(genome.hidden.len(), 1);
        // Le nouveau nœud passe par un `tanh`, donc l'écart n'est pas nul —
        // mais il reste borné par ce que ce seul lien portait.
        assert!(
            (before - after).abs() < 3.0,
            "avant {before}, après {after}"
        );
    }

    #[test]
    fn aucune_mutation_ne_cree_de_cycle() {
        let mut innovations = Innovations::new();
        let mut rng = Rng::new(11);
        let config = Config::default();
        let mut genome = Genome::minimal(&mut innovations, &mut rng);

        for _ in 0..500 {
            genome.mutate(&config, &mut innovations, &mut rng);
        }
        assert!(genome.hidden.len() > 1, "la topologie doit avoir grossi");

        // Un cycle laisserait des nœuds hors de l'ordre topologique.
        let network = Network::compile(&genome);
        let expected = 1 + OUTPUT + genome.hidden.len();
        assert_eq!(network.slots(), expected, "des nœuds manquent à l'ordre");
        assert!(network.value(&[0.1; FEATURES]).is_finite());
    }

    #[test]
    fn le_croisement_garde_la_topologie_du_meilleur() {
        let mut innovations = Innovations::new();
        let mut rng = Rng::new(3);
        let config = Config::default();

        let mut better = Genome::minimal(&mut innovations, &mut rng);
        for _ in 0..50 {
            better.mutate(&config, &mut innovations, &mut rng);
        }
        let mut worse = Genome::minimal(&mut innovations, &mut rng);
        for _ in 0..10 {
            worse.mutate(&config, &mut innovations, &mut rng);
        }

        let child = Genome::crossover(&better, &worse, &mut rng);
        assert_eq!(child.connections.len(), better.connections.len());
        assert!(Network::compile(&child).value(&[0.2; FEATURES]).is_finite());
    }

    #[test]
    fn la_distance_separe_ce_qui_a_diverge() {
        let mut innovations = Innovations::new();
        let mut rng = Rng::new(5);
        let config = Config::default();

        let base = Genome::minimal(&mut innovations, &mut rng);
        assert_eq!(base.distance(&base, &config), 0.0);

        let mut far = base.clone();
        for _ in 0..200 {
            far.mutate(&config, &mut innovations, &mut rng);
        }
        assert!(
            base.distance(&far, &config) > 0.5,
            "deux cents mutations doivent éloigner"
        );
    }
}
