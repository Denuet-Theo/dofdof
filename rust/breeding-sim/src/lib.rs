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
//! - **Tout `costs.ts`** — mangeoire, optimakina, carburant, taxe HDV. Remplacé
//!   intégralement par `economy.rs`.
//! - **Le niveau *par monture*.** Le TypeScript en porte un par ligne d'écurie ;
//!   ici il est celui de la **fournée**, un seul pour le lot, parce que la
//!   Mangeoire monte les dix places d'un bloc. C'est `Strategy::level`, et non une
//!   constante : `--niveau`, `AtLevel` et `tuned_for` le balayent, et le prix du
//!   chargement en dépend par `schedule` et `mount_xp_for_level`.
//!
//! Deux entrées ont quitté cette liste parce qu'elles avaient cessé d'être vraies,
//! et une liste de « pas porté » qui se périme envoie reporter ce qui existe :
//!
//! - **Les génétons** y étaient, au motif que « l'économie visée ne les monnaie
//!   pas » et qu'« ici la valeur serait morte ». Elle ne l'est plus :
//!   `economy.rs` crédite `génétons × geneton_value` à chaque fournée, et le prix
//!   est tiré par partie.
//! - **Le niveau** y était comme « pas une variable, 67 partout, le rendre
//!   fonction du prix ne demandera qu'une ligne ». Les 67 sont le **défaut**
//!   d'`economy.toml`, la ligne est écrite, et les mesures de niveau balayent de 1
//!   à 120.

pub mod audit;
pub mod baseline;
pub mod config;
pub mod economy;
pub mod import;
pub mod encode;
pub mod ladder;
pub mod lineage;
pub mod loading;
pub mod pairing;
pub mod sample;
pub mod schedule;
pub mod search;
pub mod stable;
pub mod treadmill;
pub mod trees;

pub use trees::{Catalog, ColorId};
