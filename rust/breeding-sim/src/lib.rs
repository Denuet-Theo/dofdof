//! Le noyau de règles de l'élevage, porté du TypeScript.
//!
//! ## Pourquoi une seconde implémentation
//!
//! Le TypeScript de `src/lib/dofus/breeding/` est la référence : c'est lui qui
//! porte les mesures en jeu, les huit fenêtres d'accouplement relevées et les
//! commentaires qui les défendent. Ce crate ne le remplace pas, il le **rejoue
//! des millions de fois** — ce que la neuroévolution exige et que la boucle TS
//! ne tient pas.
//!
//! Une seconde implémentation d'une règle mesurée est une occasion de diverger
//! en silence. D'où `tests/parity.rs`, qui rejoue 5 000 paires tirées au hasard
//! et exige l'égalité au milliardième contre les sorties du TS. Rien de ce qui
//! est bâti au-dessus ne vaut si cette porte ne passe pas : on optimiserait très
//! bien une politique pour un jeu qui n'est pas celui du mainteneur.
//!
//! ## Ce qui n'est pas porté, et pourquoi
//!
//! - **Les génétons.** L'économie visée (10 M de départ, fournée à 150 000,
//!   ambre à 20 000 par génération) ne les monnaie pas. `pairShape` les calcule
//!   côté TS ; ici la valeur serait morte, et une valeur morte finit par être
//!   crue.
//! - **Tout `costs.ts`** — mangeoire, optimakina, carburant, taxe HDV. Remplacé
//!   intégralement par `economy.rs`.
//! - **Le niveau comme variable.** Il reste porté sur la monture, mais toutes
//!   les montures sont niveau 67 dans l'économie visée, donc le taux vaut
//!   50,1 % partout. On garde le champ pour que rendre le prix fonction du
//!   niveau ne demande qu'une ligne plus tard.

pub mod lineage;
pub mod pairing;
pub mod trees;

pub use trees::{Catalog, ColorId};
