/**
 * L'ordonnanceur porté rend-il les mêmes fournées que le Rust ?
 *
 * ```sh
 * node scripts/check-schedule.mjs
 * ```
 *
 * Cinquième garde-fou du portage, et le plus exhaustif : il ne compare pas un
 * échantillon mais **tout le domaine** — les 4 096 répartitions de bandes à cinq
 * niveaux de Mangeoire, soit 20 480 ordonnancements, plus les créneaux eux-mêmes à
 * deux de ces niveaux.
 *
 * C'est possible parce que cette pièce-là ne dépend d'aucun champion : c'est de
 * l'arithmétique d'ordonnancement, donc son domaine est fini et petit.
 *
 * ## Ce qu'il attrape
 *
 * Trois heuristiques cohabitent — placement bloquant, préemptif, partage de
 * capacité — et `makespan` garde la plus courte. Une seule d'entre elles portée de
 * travers, et le minimum bascule sur une autre pour une partie du domaine
 * seulement : la durée reste plausible partout, et fausse quelque part. Aucun
 * échantillon ne le verrait ; le domaine entier, si.
 *
 * Les créneaux sont comparés en plus des durées, parce qu'une même durée peut
 * sortir de deux découpages différents — et c'est le découpage que l'écran affiche.
 *
 * ## Régénérer la référence
 *
 * ```sh
 * cd rust
 * cargo run --release -p breeding-neat --bin dump-schedule -- \
 *   ../scripts/fixtures/schedule-parity.json
 * ```
 */

import { readFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
/** Une seconde sur des fournées de plusieurs heures : c'est du bruit de flottant. */
const TOLERANCE_SECONDS = 1e-3;

const out = mkdtempSync(join(tmpdir(), 'dofdof-schedule-'));
execFileSync(
  'npx',
  [
    'tsc',
    join(ROOT, 'src/lib/dofus/breeding/schedule.ts'),
    '--outDir', out,
    '--module', 'commonjs',
    '--target', 'es2020',
    '--moduleResolution', 'node',
    '--esModuleInterop',
    '--skipLibCheck',
    '--noCheck',
  ],
  { stdio: 'inherit' }
);

const { schedule, slots, mountXpForLevel } = await import(join(out, 'schedule.js'));
const fixture = JSON.parse(
  readFileSync(join(ROOT, 'scripts/fixtures/schedule-parity.json'), 'utf8')
);

const economy = {
  bandRate: (band) => fixture.bandRates[Math.min(band, 3)],
  gaugePrice: (gauge, band) => fixture.gaugePrices[Math.min(gauge, 5)][Math.min(band, 3)],
};

let worstHours = 0;
let worstCost = 0;
let worstSlot = 0;
let compared = 0;
let slotsCompared = 0;
const fail = (message) => {
  console.error(message);
  process.exit(1);
};

for (const testCase of fixture.cases) {
  const xp = mountXpForLevel(testCase.level);
  const mine = schedule(economy, testCase.bands, xp);
  compared += 1;

  worstHours = Math.max(worstHours, Math.abs(mine.hours - testCase.hours) * 3600);
  worstCost = Math.max(worstCost, Math.abs(mine.costPerEnclos - testCase.costPerEnclos));
  if (mine.climber !== testCase.climber) {
    fail(
      `bandes ${testCase.bands.join('')} niveau ${testCase.level} : ` +
        `la montée est portée par ${mine.climber}, le Rust dit ${testCase.climber}`
    );
  }

  if (testCase.slots.length === 0) continue;
  const theirs = testCase.slots;
  const ours = slots(economy, testCase.bands, xp);
  if (ours.length !== theirs.length) {
    fail(
      `bandes ${testCase.bands.join('')} niveau ${testCase.level} : ` +
        `${ours.length} créneaux contre ${theirs.length}`
    );
  }
  for (const [at, [gauge, points, start, end]] of theirs.entries()) {
    if (ours[at].gauge !== gauge) {
      fail(
        `bandes ${testCase.bands.join('')} niveau ${testCase.level}, créneau ${at} : ` +
          `jauge ${ours[at].gauge} contre ${gauge}`
      );
    }
    worstSlot = Math.max(
      worstSlot,
      Math.abs(ours[at].start - start),
      Math.abs(ours[at].end - end),
      // Les points d'une tranche se comparent en secondes de travail, sinon
      // l'écart se lit sur une échelle de dizaines de milliers et ne dit rien.
      Math.abs(ours[at].points - points) / Math.max(economy.bandRate(testCase.bands[gauge]), 1e-9)
    );
    slotsCompared += 1;
  }
}

console.log(
  `${compared} ordonnancements · ${slotsCompared} créneaux · ` +
    `écart maximal ${worstHours.toExponential(3)} s sur la durée, ` +
    `${worstSlot.toExponential(3)} s sur les créneaux, ` +
    `${worstCost.toExponential(3)} kamas sur le coût`
);
if (worstHours >= TOLERANCE_SECONDS || worstSlot >= TOLERANCE_SECONDS) {
  console.error(`DIVERGENCE — tolérance ${TOLERANCE_SECONDS} s`);
  process.exit(1);
}
console.log("l'ordonnanceur porté rejoue le Rust");
