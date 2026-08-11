//! Fige l'effet attendu d'un croisement, pour verrouiller le portage de
//! `PairDelta`.
//!
//! ```sh
//! cargo run --release -p breeding-neat --bin dump-delta -- \
//!   ../scripts/fixtures/delta-parity.json
//! ```
//!
//! C'est la pièce où les subtilités vivent. La masse de génétons ne tombe qu'à la
//! réussite **et** seulement si une couleur nomme la cible — donc zéro sur une
//! recopie. La génération que porte un bébé est le maximum de sa couleur et de
//! celles de ses **deux parents**, pas la sienne. L'espérance de valeur somme les
//! issues au prorata, couleur par couleur, donc elle dépend des cinquante prix de
//! gen 10 et pas d'un barème par rang.
//!
//! Aucune de ces trois-là ne se voit à l'écran si elle est fausse : le plan sort
//! plausible et vise à côté.
//!
//! Les couples viennent de `sample.rs`, pour couvrir les cas qui font travailler
//! le calcul — porteuses de raccourci, recopies, cibles multiples — et le niveau
//! comme le seuil d'Optimakina varient d'un cas à l'autre, puisque tous deux
//! entrent dans le taux.

use breeding_sim::config::Prices;
use breeding_sim::economy::{Draws, Rng};
use breeding_sim::encode::PairDelta;
use breeding_sim::sample::{SampleConfig, sample_stable};
use breeding_sim::stable::Sex;
use breeding_sim::trees::muldo;

const CASES: usize = 400;

fn main() {
    let target = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "../scripts/fixtures/delta-parity.json".into());

    let catalog = muldo();
    let base = Prices::load_default()
        .map(|prices| prices.economy)
        .unwrap_or_else(|error| {
            eprintln!("{error}");
            std::process::exit(1);
        });

    let mut rng = Rng::new(20_260_818);
    let config = SampleConfig::default();
    let mut cases = Vec::with_capacity(CASES);
    let mut drawn = 0u32;

    while cases.len() < CASES {
        drawn += 1;
        let economy = base.for_run(&catalog, &Draws::new(drawn.wrapping_mul(2_246_822_519)));
        let stable = sample_stable(&catalog, &mut Rng::new(drawn.wrapping_mul(2_654_435_761)), &config);
        let males: Vec<usize> = (0..stable.len())
            .filter(|&i| stable.mounts[i].sex == Sex::Male)
            .collect();
        let females: Vec<usize> = (0..stable.len())
            .filter(|&i| stable.mounts[i].sex == Sex::Female)
            .collect();
        if males.is_empty() || females.is_empty() {
            continue;
        }

        let pick = |rng: &mut Rng, pool: &[usize]| {
            pool[((rng.next_f64() * pool.len() as f64) as usize).min(pool.len() - 1)]
        };
        let male = stable.mounts[pick(&mut rng, &males)];
        let female = stable.mounts[pick(&mut rng, &females)];
        let level = 1 + (rng.next_f64() * 200.0) as u16;
        // 11 = jamais, donc le tirage couvre aussi le cas « pas d'Optimakina ».
        let optimakina_from = (rng.next_f64() * 12.0) as u8;

        let Some(delta) = PairDelta::of(
            &catalog,
            &economy,
            &male.mate(),
            &female.mate(),
            level,
            optimakina_from,
        ) else {
            // Cible au-dessus du plafond : le jeu ne propose pas l'accouplement.
            // Le portage doit rendre `null` pareil, mais ça se vérifie ailleurs —
            // ici on fige ce qui existe.
            continue;
        };

        let mate = |mount: &breeding_sim::stable::Mount| {
            serde_json::json!({
                "colorId": catalog.slug(mount.color),
                "sex": if mount.sex == Sex::Male { "M" } else { "F" },
                "level": mount.level,
                "parents": mount.parents.map(|[a, b]| [catalog.slug(a), catalog.slug(b)]),
            })
        };

        cases.push(serde_json::json!({
            "male": mate(&male),
            "female": mate(&female),
            "level": level,
            "optimakinaFrom": optimakina_from,
            "economy": {
                "genetonValue": economy.geneton_value,
                "optimakinaBonus": economy.optimakina_bonus,
                "optimakina": economy.optimakina.to_vec(),
                "values": (0..catalog.len())
                    .map(|color| serde_json::json!([
                        catalog.slug(color as u16),
                        economy.value_of(&catalog, color as u16)
                    ]))
                    .collect::<Vec<_>>(),
            },
            "delta": {
                "maleGeneration": delta.male_generation,
                "femaleGeneration": delta.female_generation,
                "maleCarried": delta.male_carried,
                "femaleCarried": delta.female_carried,
                "targetGeneration": delta.target_generation,
                "namesTarget": delta.names_target,
                "optimakinaCost": delta.optimakina_cost,
                "genetonKamas": delta.geneton_kamas,
                "expectedValue": delta.expected_value,
                "births": delta.births.iter()
                    .map(|&(color, probability, carried)| serde_json::json!([
                        catalog.slug(color), probability, carried
                    ]))
                    .collect::<Vec<_>>(),
            },
        }));
    }

    let document = serde_json::json!({ "cases": cases });
    match std::fs::write(&target, serde_json::to_string(&document).unwrap_or_default()) {
        Ok(()) => println!("{CASES} croisements écrits dans {target}"),
        Err(error) => {
            eprintln!("{target} : {error}");
            std::process::exit(1);
        }
    }
}
