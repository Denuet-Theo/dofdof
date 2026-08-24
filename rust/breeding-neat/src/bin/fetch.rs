//! Ce que coûte de retrouver une monture quand l'écurie déborde.
//!
//! ```sh
//! cargo run --release -p breeding-neat --bin fetch
//! ```
//!
//! ## La question
//!
//! L'écurie tient 250 places ; au-delà, le reste vit en inventaire, havresac et
//! coffre. Ranger ne coûte **rien** à la monture — relevé auprès du mainteneur le
//! 24/08 : les jauges ne montent qu'en enclos, et l'on achète à l'HDV des montures
//! déjà montées. Ce qui coûte, c'est de la **retrouver** : l'écurie filtre,
//! l'inventaire ne se fouille que par couleur.
//!
//! Une politique qui tient 566 montures est donc jouable et pénible, là où le
//! score seul la dit simplement bonne. On mesure les deux choses que le score ne
//! sépare pas : **combien de retraits** chaque politique impose, et ce que le
//! classement devient quand on les facture.
//!
//! ## Pourquoi une seule passe suffit
//!
//! `retrieval_price` est un terme de **score**, pas une dépense : il ne touche ni
//! la solvabilité ni les décisions, donc la partie jouée est la même quel que soit
//! son prix. Le score à un prix quelconque se recalcule depuis `score` et
//! `retrievals` d'une unique partie, et le balayage est gratuit — c'est aussi la
//! garantie qu'on lit un re-classement et non un jeu différent. Même argument que
//! `bin/barren`.
//!
//! La médiane est reprise **par prix** sur les scores ajustés graine à graine : la
//! politique la plus dépensière en retraits n'est pas forcément celle de la partie
//! médiane.

use breeding_neat::champion;
use breeding_neat::neat::Network;
use breeding_sim::baseline::{Greedy, Objective};
use breeding_sim::config::Prices;
use breeding_sim::economy::{Economy, MAX_UNITS, Policy, RunOutcome, Strategy, play};
use breeding_sim::encode::Census;
use breeding_sim::ladder::{Ladder, LadderPolicy, Route};
use breeding_sim::search::{Myopic, Searching, ValueFn};
use breeding_sim::trees::{Catalog, muldo};
use rayon::prelude::*;

/// Les graines de départage. Jamais les scellées : on compare des politiques.
const SEEDS: std::ops::Range<u32> = 800_000..800_200;

/// Les prix balayés, en kamas par retrait. Le premier est le régime publié.
///
/// Un croisement est facturé 10 000 et c'est un geste bien plus long qu'un
/// retrait — sortir, trier, réaccoupler contre chercher une couleur au coffre.
/// La bande s'arrête donc largement en dessous.
const PRICES: [f64; 5] = [0.0, 500.0, 1_000.0, 2_000.0, 5_000.0];

struct NetValue<'a>(&'a Network);

impl ValueFn for NetValue<'_> {
    fn value(&self, census: &Census, catalog: &Catalog, economy: &Economy) -> f64 {
        self.0.value(&census.features(catalog, economy))
    }
}

fn median(values: &mut [f64]) -> f64 {
    values.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    values[(values.len() - 1) / 2]
}

fn mean(values: impl Iterator<Item = f64>) -> f64 {
    let collected: Vec<f64> = values.collect();
    collected.iter().sum::<f64>() / collected.len().max(1) as f64
}

/// Le score d'une partie une fois les retraits facturés à ce prix.
///
/// `outcome.retrievals_charged` est déjà retiré du score au prix du fichier ; on
/// le rend avant d'appliquer celui qu'on balaie, sinon le premier prix compterait
/// deux fois.
fn charged(outcome: &RunOutcome, price: f64) -> f64 {
    (outcome.score + outcome.retrievals_charged) as f64 - price * outcome.retrievals
}

fn run(
    label: &str,
    economy: &Economy,
    make: impl Fn() -> Box<dyn Policy> + Sync,
) -> (String, Vec<RunOutcome>) {
    let catalog = muldo();
    let outcomes = SEEDS
        .collect::<Vec<u32>>()
        .par_iter()
        .map(|&seed| {
            let mut policy = make();
            play(&catalog, economy, policy.as_mut(), seed)
        })
        .collect();
    (label.to_string(), outcomes)
}

fn main() {
    let economy = Prices::load_default()
        .map(|prices| prices.economy)
        .unwrap_or_else(|error| {
            eprintln!("{error}");
            std::process::exit(1);
        });

    if economy.stable_places == 0 {
        eprintln!(
            "economy.toml ne pose aucune place d'écurie ([ecurie] places), \
             donc aucun retrait n'est compté et ce binaire n'a rien à dire."
        );
        std::process::exit(1);
    }

    let mut reports = vec![
        run("glouton / gen10_balanced", &economy, || {
            Box::new(Greedy::new(Objective::Gen10Balanced))
        }),
        run("recherche / valeur myope", &economy, || {
            Box::new(Searching::new(Myopic))
        }),
        {
            let ladder = Ladder::of(&muldo(), Route::default());
            run("echelle / niveau réglé", &economy, move || {
                Box::new(
                    LadderPolicy::with_ladder(ladder.clone())
                        .with_strategies([Strategy::default(); MAX_UNITS])
                        .tuned_for(&economy),
                )
            })
        },
        {
            let ladder = Ladder::of(&muldo(), Route::default());
            run("echelle / fécondité stockée", &economy, move || {
                let mut policy = LadderPolicy::with_ladder(ladder.clone())
                    .with_strategies([Strategy::default(); MAX_UNITS])
                    .tuned_for(&economy);
                policy.harvest_stocked = true;
                Box::new(policy)
            })
        },
    ];

    // Le champion à part : le réseau ne traverse pas la frontière du
    // `Box<dyn Policy>` sans emprunt. Absent, on continue sans lui.
    match champion::load("champion.json", 1) {
        Ok(genome) => {
            let network = Network::compile(&genome);
            let catalog = muldo();
            let outcomes = SEEDS
                .collect::<Vec<u32>>()
                .par_iter()
                .map(|&seed| {
                    let mut policy =
                        Searching::new(NetValue(&network)).with_strategies(genome.strategies);
                    play(&catalog, &economy, &mut policy, seed)
                })
                .collect();
            reports.push(("recherche / NEAT".to_string(), outcomes));
        }
        Err(error) => eprintln!("champion ignoré : {error}"),
    }

    println!(
        "{} parties par politique, graines de départage {:?}.",
        SEEDS.len(),
        SEEDS
    );
    println!(
        "Écurie de {} places ; au-delà, inventaire, havresac et coffre.\n\
         Ranger est gratuit et sans perte — c'est **retrouver** qui coûte.\n",
        economy.stable_places
    );

    println!(
        "{:<28} {:>9} {:>11} {:>11} {:>9} {:>8}",
        "politique", "crois.", "écurie moy", "écurie max", "retraits", "/crois."
    );
    println!("{}", "-".repeat(80));
    for (label, outcomes) in &reports {
        let crossings = mean(outcomes.iter().map(|o| o.crossings as f64));
        let retrievals = mean(outcomes.iter().map(|o| o.retrievals));
        println!(
            "{label:<28} {crossings:>9.0} {:>11.0} {:>11} {retrievals:>9.0} {:>8.2}",
            mean(outcomes.iter().map(|o| o.peak_stable as f64)),
            outcomes.iter().map(|o| o.peak_stable).max().unwrap_or(0),
            if crossings > 0.0 {
                retrievals / crossings
            } else {
                0.0
            },
        );
    }

    println!("\nMédiane du score, par prix du retrait :");
    print!("{:<28}", "politique");
    for price in PRICES {
        print!("{:>13}", format!("{price:.0} k/retrait"));
    }
    println!();
    println!("{}", "-".repeat(28 + 13 * PRICES.len()));
    for (label, outcomes) in &reports {
        print!("{label:<28}");
        for price in PRICES {
            let mut scores: Vec<f64> = outcomes.iter().map(|o| charged(o, price)).collect();
            print!("{:>13}", format!("{:.2} M", median(&mut scores) / 1e6));
        }
        println!();
    }
}
