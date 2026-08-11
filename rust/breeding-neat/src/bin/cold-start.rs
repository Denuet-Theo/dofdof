//! Le champion sait-il **démarrer** ? Trente cycles depuis une écurie de débutant.
//!
//! ```sh
//! cargo build --release -p breeding-neat --bin cold-start
//! ./target/release/cold-start champion.json
//! ```
//!
//! ## La question
//!
//! Le tapis tire son écurie de départ avec un poids **nul sur la génération 1** :
//! `weights = [0, 0, 9, 8, 7, 6, 5, 4, 3, 2, 1]`. Le champion n'a donc jamais vu
//! de séquence partant de ce que tout le monde a au début — du vrac de gen 1 et
//! deux ou trois lignées entamées.
//!
//! Sur **une** fournée depuis une telle écurie, il place 15 recopies sur 18
//! accouplements et récolte quatre fois moins de génétons immédiats que la valeur
//! myope. Mais ce chiffre-là ne conclut rien : le myope le bat aussi sur une
//! fournée de la distribution d'entraînement (160 685 contre 87 436), alors qu'il
//! s'y fait battre de +1034 % sur trente cycles. Une valeur d'état sacrifie du
//! gain immédiat pour laisser une meilleure écurie derrière elle — c'est sa raison
//! d'être, et un décompte sur une fournée est précisément le barème myope que ce
//! chantier existe pour récuser.
//!
//! Seule une **séquence** tranche. C'est ce binaire.
//!
//! ## Ce qu'on compare
//!
//! Deux départs, les mêmes graines, les mêmes politiques :
//!
//! - `entraînement` — le tirage habituel, comme référence de calibrage ;
//! - `débutant` — l'essentiel en gen 1, quelques gen 2 et 3.
//!
//! Si l'écart champion/myope tient sur les deux, le champion sait démarrer et il
//! n'y a rien à faire. S'il s'effondre sur le départ débutant, la distribution
//! d'entraînement est en cause et il faut l'élargir — pas corriger la recherche.
//!
//! La trajectoire est imprimée parce qu'elle dit *quand* ça se joue : un tapis qui
//! s'éteint et un tapis qui met dix cycles à démarrer rendent le même total.

use breeding_neat::champion;
use breeding_neat::neat::Network;
use breeding_sim::config::Prices;
use breeding_sim::economy::{Economy, Policy};
use breeding_sim::encode::Census;
use breeding_sim::search::{Myopic, Searching, ValueFn};
use breeding_sim::treadmill::{TreadmillConfig, play_treadmill};
use breeding_sim::trees::{Catalog, muldo};
use rayon::prelude::*;

/// Les graines de départage. Le jeu scellé reste fermé : ceci est une mesure de
/// diagnostic, pas un chiffre publié.
const SEEDS: std::ops::Range<u32> = 800_000..800_100;

/// Le budget de recherche de l'entraînement. En donner davantage mesurerait une
/// autre politique que celle qui a été sélectionnée.
const ITERATIONS: usize = 600;

struct NetValue<'a>(&'a Network);

impl ValueFn for NetValue<'_> {
    fn value(&self, census: &Census, catalog: &Catalog, economy: &Economy) -> f64 {
        self.0.value(&census.features(catalog, economy))
    }
}

struct Row {
    kamas: f64,
    genetons: f64,
    crossings: f64,
    clonings: f64,
    gen10: f64,
    /// Le rang le plus haut que l'écurie porte à la fin. C'est **la** réponse à
    /// « jusqu'où monte-t-on », qu'un compte de gen 10 à zéro laissait entière :
    /// zéro récolte peut vouloir dire « bloqué en gen 2 » comme « arrivé en gen 9 ».
    top: f64,
    mounts_end: f64,
    trajectory: Vec<f64>,
}

fn measure(
    catalog: &Catalog,
    economy: &Economy,
    config: &TreadmillConfig,
    make: &(dyn Fn() -> Box<dyn Policy> + Sync),
) -> Row {
    let runs: Vec<_> = SEEDS
        .into_iter()
        .collect::<Vec<_>>()
        .par_iter()
        .map(|&seed| {
            let mut policy = make();
            play_treadmill(catalog, economy, policy.as_mut(), seed, config)
        })
        .collect();

    let n = runs.len() as f64;
    let mean = |f: &dyn Fn(&breeding_sim::treadmill::TreadmillOutcome) -> f64| {
        runs.iter().map(f).sum::<f64>() / n
    };
    let steps = runs.first().map(|r| r.per_cycle.len()).unwrap_or(0);
    Row {
        kamas: mean(&|r| r.kamas),
        genetons: mean(&|r| r.genetons as f64),
        crossings: mean(&|r| r.crossings as f64),
        clonings: mean(&|r| r.clonings as f64),
        gen10: mean(&|r| r.gen10_harvested as f64),
        top: mean(&|r| r.top_generation as f64),
        mounts_end: mean(&|r| r.mounts_end as f64),
        trajectory: (0..steps)
            .map(|step| runs.iter().map(|r| r.per_cycle[step] as f64).sum::<f64>() / n)
            .collect(),
    }
}

fn main() {
    let path = std::env::args().nth(1).unwrap_or_else(|| "champion.json".into());
    // Le champion est **facultatif** : quand l'encodage vient de changer, aucun
    // artefact n'est chargeable, et la question « jusqu'où monte-t-on depuis un
    // départ frais » se pose quand même — la valeur myope y répond seule.
    let genome = match champion::load(&path, 0) {
        Ok(genome) => Some(genome),
        Err(error) => {
            eprintln!("{error}\n→ on ne mesure que la valeur myope.\n");
            None
        }
    };
    // Fuite assumée : le réseau vit aussi longtemps que le programme, et
    // `Box<dyn Policy>` réclame `'static`. Un `Arc` ferait le même effet en plus
    // long, pour un binaire de mesure qui se termine juste après.
    let network: Option<&'static Network> = genome
        .as_ref()
        .map(|genome| &*Box::leak(Box::new(Network::compile(genome))));

    let catalog = muldo();
    // Jamais `Economy::default()` : les leviers y sont inertes et le niveau achète
    // la réussite gratuitement. Une manche a déjà été annulée pour ça.
    let economy = Prices::load_default()
        .map(|prices| prices.economy)
        .unwrap_or_else(|error| {
            eprintln!("{error}");
            std::process::exit(1);
        });

    // L'horizon est le second argument : trente cycles suffisent à départager deux
    // politiques sur une écurie déjà montée, mais peut-être pas à **monter** depuis
    // la gen 1. Sans ce réglage on ne saurait pas distinguer « le champion
    // n'arrive à rien » de « personne n'y arriverait en trente cycles ».
    let cycles: usize = std::env::args()
        .nth(2)
        .and_then(|arg| arg.parse().ok())
        .unwrap_or(TreadmillConfig::default().cycles);
    let base = TreadmillConfig { cycles, ..TreadmillConfig::default() };
    // Un **départ frais**, tel qu'il se présente en jeu : vingt gen 1 anonymes,
    // achetées donc fertiles, et rien d'autre. Ni gen 2 entamée, ni stérile, ni
    // féconde — c'est le premier jour.
    //
    // La première version de cette mesure en tirait 250 dont un tiers de stériles,
    // à hauteur exacte du plafond d'écurie : le débordement se payait dès la
    // première naissance et la question posée n'était pas la bonne.
    let fresh = TreadmillConfig {
        mounts: 20,
        weights: [0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        state: breeding_sim::treadmill::StartState::Fresh,
        ..base
    };

    println!(
        "champion {path} · {} graines de départage · {} cycles · {} mutations",
        SEEDS.len(),
        base.cycles,
        ITERATIONS
    );
    println!(
        "\n{:<12} {:<10} {:>11} {:>10} {:>8} {:>8} {:>7} {:>9} {:>9}",
        "départ", "politique", "kamas", "génétons", "crois.", "clones", "gen10", "rang max",
        "montures"
    );
    println!("{}", "-".repeat(72));

    let mut summary: Vec<(String, f64, f64)> = Vec::new();
    for (label, config) in [("entraînement", &base), ("départ frais", &fresh)] {
        let mut scores = Vec::new();
        for (name, learned) in [("NEAT", true), ("myope", false)] {
            if learned && network.is_none() {
                continue;
            }
            let row = measure(&catalog, &economy, config, &|| {
                if learned {
                    Box::new(
                        Searching::with_iterations(
                            NetValue(network.expect("réseau présent")),
                            ITERATIONS,
                        )
                        .without_sacrifices()
                        .with_strategies(genome.as_ref().expect("génome présent").strategies),
                    )
                } else {
                    Box::new(Searching::with_iterations(Myopic, ITERATIONS).without_sacrifices())
                }
            });
            println!(
                "{:<12} {:<10} {:>9.2} M {:>10.0} {:>8.0} {:>8.0} {:>7.1} {:>9.1} {:>9.0}",
                if scores.is_empty() { label } else { "" },
                name,
                row.kamas / 1e6,
                row.genetons,
                row.crossings,
                row.clonings,
                row.gen10,
                row.top,
                row.mounts_end
            );
            let step = (row.trajectory.len() / 12).max(1);
            let sampled: Vec<String> = row
                .trajectory
                .iter()
                .step_by(step)
                .map(|value| format!("{value:.0}"))
                .collect();
            println!("{:>24}trajectoire [{}]", "", sampled.join(", "));
            scores.push(row.kamas);
        }
        summary.push((label.to_string(), scores[0], scores[1]));
    }

    println!("\n--- ce que le champion apporte, par départ ---");
    for (label, learned, myopic) in &summary {
        let ratio = if *myopic > 0.0 {
            format!("{:+.0} %", (learned / myopic - 1.0) * 100.0)
        } else {
            "—".into()
        };
        println!(
            "  {label:<14} {:>8.2} M contre {:>8.2} M   {ratio}",
            learned / 1e6,
            myopic / 1e6
        );
    }
}
