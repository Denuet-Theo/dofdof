/**
 * Valider un plan émis par le Rust avec le lecteur de l'écran lui-même.
 *
 *   node scripts/check-plan.mjs rust/plan.json
 *
 * Le plan traverse une frontière de langage : il est écrit par
 * `rust/breeding-neat/src/bin/plan.rs` et lu par
 * `src/lib/dofus/breeding/timeline.ts`. Les deux côtés évoluent séparément, et
 * un champ renommé d'un côté ne casse rien de visible de l'autre — il donne un
 * ruban vide qu'on met une heure à expliquer.
 *
 * D'où ce script : il n'a pas sa propre idée de ce qu'est un plan valide, il
 * appelle `parsePlan`. Si le contrat bouge, la vérification bouge avec lui sans
 * qu'on y pense.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const SOURCE = 'src/lib/dofus/breeding/timeline.ts';

const planPath = process.argv[2] ?? 'rust/plan.json';

/**
 * Compile `timeline.ts` seul — il n'importe rien, donc il se suffit.
 *
 * On appelle le `tsc` du dépôt par son point d'entrée Node plutôt que par
 * `npx` : sous Windows, lancer un `.cmd` sans shell échoue en `EINVAL`, et
 * l'ouvrir avec un shell rendrait le chemin dépendant de l'échappement.
 */
const compile = () => {
  const out = mkdtempSync(join(tmpdir(), 'timeline-'));
  execFileSync(
    process.execPath,
    [
      'node_modules/typescript/bin/tsc',
      SOURCE,
      '--outDir',
      out,
      '--module',
      'esnext',
      '--target',
      'es2022',
      '--moduleResolution',
      'bundler',
    ],
    { stdio: 'inherit' }
  );
  return out;
};

const plural = (count, word) => `${count} ${word}${count > 1 ? 's' : ''}`;

const out = compile();
try {
  const module = await import(pathToFileURL(join(out, 'timeline.js')).href);
  const raw = JSON.parse(readFileSync(planPath, 'utf8'));
  const result = module.parsePlan(raw);

  if (!result.ok) {
    console.error(`${planPath} refusé par parsePlan :\n  ${result.error}`);
    process.exit(1);
  }

  const { plan } = result;
  const events = plan.tracks.flatMap((track) => track.events);
  const actionable = events.filter((event) => module.isActionable(event.kind));
  const horizon = plan.horizon ?? module.planHorizon(plan);

  // Le contrat autorise un `at` au-delà de l'horizon ; ce serait un plan qui
  // parle plus loin qu'il ne prétend avoir regardé, donc une erreur du Rust.
  const beyond = events.filter((event) => event.at + event.duration > horizon + 1);

  console.log(`${planPath} : accepté.`);
  console.log(`  version ${plan.version}${plan.label ? ` — ${plan.label}` : ''}`);
  console.log(`  ${plural(plan.tracks.length, 'piste')}, ${plural(events.length, 'événement')}`);
  console.log(`  ${plural(actionable.length, 'geste')} dans l'agenda`);
  console.log(`  horizon ${(horizon / 3600).toFixed(1)} h`);

  for (const track of plan.tracks) {
    const kinds = new Map();
    for (const event of track.events) kinds.set(event.kind, (kinds.get(event.kind) ?? 0) + 1);
    const summary = [...kinds].map(([kind, count]) => `${count} ${kind}`).join(', ');
    console.log(`    ${track.id.padEnd(14)} ${summary || 'vide'}`);
  }

  if (beyond.length > 0) {
    console.error(
      `\n${plural(beyond.length, 'événement')} dépassent l'horizon annoncé — le premier : ` +
        `${beyond[0].id} finit à ${((beyond[0].at + beyond[0].duration) / 3600).toFixed(2)} h.`
    );
    process.exit(1);
  }

  const empty = plan.tracks.filter((track) => track.events.length === 0);
  if (empty.length === plan.tracks.length) {
    console.error('\nToutes les pistes sont vides : le plan est accepté mais ne dit rien.');
    process.exit(1);
  }
} finally {
  rmSync(out, { recursive: true, force: true });
}
