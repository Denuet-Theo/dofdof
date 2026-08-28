/**
 * Une jauge se paie-t-elle au bon régime ?
 *
 * ```sh
 * node scripts/check-gauge-cost.mjs
 * ```
 *
 * ## Les deux régimes, et pourquoi les confondre coûte
 *
 * Un carburant ne remplit que jusqu'à son plafond. Ce que ça coûte dépend donc de
 * **comment on s'en sert**, et l'éleveur ne s'en sert pas pareil selon la jauge :
 *
 * - la **Mangeoire** se remplit depuis vide, en une fois — « 40 000 points de
 *   niveau 0 et 30 000 points de niveau 1 », relevé du 28/08. Les quarante mille
 *   premiers points s'y paient au carburant bas quelle que soit la bande visée, et
 *   le coût est **convexe** ;
 * - une **jauge de cycle** se tient en haut de bande pour son débit : on rachète du
 *   carburant haut en continu, donc chaque point se paie au tarif de la bande
 *   tenue, **linéairement**.
 *
 * #305 a appliqué les tranches partout. Sur les carburants d'`economy.toml`, une
 * jauge de stat de 5 628 points passait alors de 11 057 à 3 174 kamas — **3,5 fois
 * trop bon marché**. Côté Rust le même excès a cassé
 * `payer_le_chemin_critique_seul_est_moins_cher` : tout tenant dans la bande 0,
 * choisir une bande ne coûtait plus rien et payer le chemin critique devenait
 * gratuit. Le test avait raison ; cette garde est son pendant ici.
 *
 * ## Pourquoi une garde et pas une spec e2e
 *
 * Le harnais e2e ne charge aucun item de carburant, donc `planFor` retombe sur le
 * prix relevé, qui n'a qu'une bande — les deux régimes y rendent le même nombre et
 * une spec ne verrait rien. Il faut des carburants tarifés, ce que cette garde
 * pose elle-même.
 */

import { compile, load } from './lib/tsc.mjs';

const out = compile(
  'gauge-cost',
  ['src/lib/dofus/breeding/enclos.ts', 'src/lib/dofus/breeding/supplies.ts'],
  { json: true }
);
// Chemins **imbriqués** : `supplies.ts` tire `../../supabase/types` et
// `../../utils/gauges`, donc la racine commune que `tsc` choisit remonte à
// `src/lib` et la sortie suit l'arborescence. C'est le prix à payer pour tester le
// vrai câblage plutôt qu'une fonction isolée.
const { layeredTransferCost, bandsFor } = await load(out, 'dofus/breeding/enclos.js');
const { computeSupplyCosts } = await load(out, 'dofus/breeding/supplies.js');

let failed = 0;
const fail = (message) => {
  console.error(`  ✘ ${message}`);
  failed += 1;
};

/** Les prix par point d'`economy.toml`, bandes 0 et 1. */
const PRIX = { 40_000: 0.564, 70_000: 1.9646 };
const JAUGES = ['Baffeur', 'Caresseur', 'Dragofesse', 'Foudroyeur', 'Abreuvoir', 'Mangeoire'];

/**
 * Un carburant tel que `parseGaugeInfo` le lit : tout passe par la description.
 *
 * On construit les six jauges et leurs deux bandes plutôt que d'appeler
 * `bestFuelFor` en direct, et c'est le point : une première version de cette garde
 * testait la fonction et **pas le câblage**, donc elle restait verte quand
 * `planFor` passait le mauvais régime — c'est-à-dire exactement le défaut à
 * attraper.
 */
const items = [];
const prices = new Map();
let nextId = 90_000;
for (const gauge of JAUGES) {
  for (const cap of [40_000, 70_000]) {
    const id = nextId++;
    const recharge = 1_000;
    items.push({
      id,
      name: { fr: `${gauge} ${cap}` },
      description: {
        fr: `Permet de recharger la jauge de ${gauge} d'un enclos de ${recharge} sans dépasser ${cap}.`,
      },
      effects: [],
    });
    prices.set(id, { price: String(recharge * PRIX[cap]) });
  }
}

const supplies = computeSupplyCosts(items, [], prices, {
  kamasPerHour: 0,
  minutesPerFight: 1,
  netRecoveryRate: 0.8,
  mountsInEnclos: 10,
  gaugeCap: 70_000,
  countNetCost: false,
});

/* ----------------------------------------- le câblage, jauge par jauge -- */

if (supplies.fuelCostPerCycle === null || supplies.mangeoireCostPerMountPoint === null) {
  fail('les six jauges sont tarifées, `computeSupplyCosts` devrait chiffrer');
} else {
  /*
   * Le cycle est **tenu** : son coût doit valoir exactement `points × prix de la
   * bande retenue`, jauge par jauge. `cycleGauges` rend les deux, donc l'attendu se
   * dérive des données elles-mêmes plutôt que d'un nombre figé.
   *
   * Ne pas affirmer sur `costPerPoint` : c'est le prix unitaire du carburant
   * retenu, que le découpage ne change pas. Une première version de cette garde
   * l'a fait et est restée verte en réintroduisant le défaut — elle regardait le
   * tarif au lieu de la facture.
   */
  const attenduPlat = supplies.cycleGauges.reduce(
    (total, g) => total + g.pointsPerBatch * g.costPerPoint,
    0
  );
  const facture = supplies.fuelCostPerCycle * 10;
  if (Math.abs(facture - attenduPlat) > 1) {
    fail(
      `le cycle facture ${facture.toFixed(0)} pour ${attenduPlat.toFixed(0)} attendus ` +
        `(${(facture / attenduPlat).toFixed(2)}× le tarif plat) : en dessous, les tranches ` +
        `sont appliquées à une jauge qu'on tient en haut de bande`
    );
  }

  // La Mangeoire, elle, se remplit depuis vide : son prix moyen au point doit
  // tomber **sous** le tarif de la bande haute, puisque le bas de la jauge s'y
  // paie moins cher.
  const mangeoire = supplies.mangeoireCostPerMountPoint * 10;
  if (!(mangeoire < PRIX[70_000] * 0.95)) {
    fail(
      `la Mangeoire revient à ${mangeoire.toFixed(4)} le point de jauge, soit le tarif ` +
        `de la bande haute (${PRIX[70_000]}) : elle n'est pas comptée par tranches`
    );
  }
}

/* ------------------------------------------------- le relevé, au kama -- */

// « Je la remplis en une fois : 40 000 points de niveau 0 et 30 000 de niveau 1 ».
const BANDES = bandsFor(
  [
    { itemId: 1, name: 'bande 0', cap: 40_000, rechargeAmount: 1000, price: 1000 * PRIX[40_000] },
    { itemId: 2, name: 'bande 1', cap: 70_000, rechargeAmount: 1000, price: 1000 * PRIX[70_000] },
  ],
  70_000
);
const releve = 40_000 * PRIX[40_000] + 30_000 * PRIX[70_000];
const rendu = layeredTransferCost(70_000, BANDES);
if (Math.abs(rendu - releve) > 1) {
  fail(`un remplissage de 70 000 doit coûter ${releve.toFixed(0)}, il rend ${rendu.toFixed(0)}`);
}

/* ------------------------------------- au-delà du plafond, les remplissages */

const un = layeredTransferCost(70_000, BANDES);
const trois = layeredTransferCost(210_000, BANDES);
if (Math.abs(trois - 3 * un) > 1) {
  fail(`trois remplissages doivent coûter trois fois un : ${trois.toFixed(0)} contre ${(3 * un).toFixed(0)}`);
}

if (failed > 0) {
  console.error(`\n${failed} contrôle(s) en échec.`);
  process.exit(1);
}

console.log(
  `un remplissage à ${rendu.toFixed(0)} kamas · le cycle tenu à sa bande, ` +
    `la Mangeoire par tranches`
);
