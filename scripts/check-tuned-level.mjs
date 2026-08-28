/**
 * Le niveau conseillé se lit-il en kamas gagnés, et non en kamas perdus ?
 *
 * ```sh
 * node scripts/check-tuned-level.mjs
 * ```
 *
 * ## La panne que cette garde attrape
 *
 * `tunedLevel` soustrayait `fuelPerLoad` — le carburant d'un **enclos plein**,
 * `fuelCostPerCycle × 10` — d'une recette qui vaut **un croisement**, et d'un coût
 * de Mangeoire qui monte **deux** parents. Une dépense pour dix montures retirée
 * d'une recette pour deux : cinq fois trop, dans la seule soustraction du calcul.
 *
 * Le reste du dépôt ne s'y trompe pas — `costs.ts` écrit
 * `const fuelCost = fuelCostPerCycle * 2` — et le champ lui-même l'annonce : « un
 * croisement en consomme deux, un par parent ».
 *
 * Ce que ça coûtait, sur les entrées relevées de l'export du 27/08 : le net était
 * **négatif à tous les niveaux**. Le conseil ne choisissait donc pas le niveau qui
 * rapporte le plus, mais celui qui **perd le moins** — ce n'est pas la même
 * courbe, et rien à l'écran ne pouvait le dire, puisque le nombre affiché est un
 * niveau et pas un montant.
 *
 * ## Pourquoi une garde plutôt qu'une spec e2e
 *
 * Le conseil n'apparaît à l'écran que si la couleur visée a un prix saisi, et la
 * fixture du dépôt n'en a pas — l'onglet y affiche « il manque le prix de
 * Azur-Doré ». Reproduire le jeu de prix complet pour vérifier une fonction pure
 * coûterait plus cher que ce que ça garde, et le testerait à travers cinq couches
 * qui ne sont pas en cause.
 *
 * Les entrées ci-dessous sont donc celles **relevées dans le navigateur** sur son
 * écurie réelle, figées ici. Elles ne sont pas inventées : elles ont été lues sur
 * `supplies` et `valuePerSuccessToward` au moment où l'écran affichait son
 * conseil.
 */

import { compile, load } from './lib/tsc.mjs';

const out = compile('tuned-level', ['src/lib/dofus/breeding/tuned-level.ts'], { json: true });
const { tunedLevel } = await load(out, 'tuned-level.js');

let failed = 0;
const fail = (message) => {
  console.error(`  ✘ ${message}`);
  failed += 1;
};

/**
 * Les entrées relevées sur l'écurie de l'éleveur, export du 27/08.
 *
 * `mangeoireCostPerMountPoint` est **le sien** — 0,1266 le point — et non les
 * 0,5640 d'`economy.toml` : c'est ce que ses prix saisis donnent, et c'est ce qui
 * a longtemps fait croire que le désaccord avec le banc venait des prix.
 */
const RELEVE = {
  cycleHours: 7.6403,
  fuelPerCrossing: 7253.0024 * 2,
  mangeoireCostPerMountPoint: 0.12658227848101264,
  levelUpHours: 120.49752972749626,
  valuePerSuccess: 162_500,
  hoursBetweenLoads: 24,
  pointsCap: 70_000,
};

/* --------------------------------------------------- le net est un gain -- */

const conseil = tunedLevel(RELEVE);
if (conseil === null) {
  fail('aucun conseil sur des entrées complètes');
} else {
  // La panne d'origine : tous les nets négatifs, donc un argmax qui classe des
  // pertes. Un conseil dont la valeur par heure est négative dit « ne fais rien »
  // en affichant un niveau, ce que personne ne peut lire.
  if (!(conseil.perHour > 0)) {
    fail(
      `le niveau ${conseil.level} rend ${conseil.perHour.toFixed(0)} par heure : ` +
        `le calcul classe des pertes, pas des gains. C'est la marque du carburant ` +
        `compté à l'enclos au lieu du croisement.`
    );
  }
  // Le banc tranche 67 sur cette écurie, à son prix de Mangeoire : 200 graines
  // appariées, −0,83 M pour le niveau 50 (t = −4,09).
  if (conseil.level !== 67) {
    fail(`conseil ${conseil.level}, attendu 67 — voir le tableau du banc dans l'en-tête`);
  }
}

/* ------------------------------------- le carburant est bien par croisement */

// Cinq fois le carburant, c'est le défaut d'origine. On ne vérifie pas qu'il rend
// 50 — ce serait figer l'ancien bug — mais qu'il rend un **net négatif**, ce qui
// est la seule chose qui compte : un calcul qui ne peut pas être positif ne
// choisit rien.
const dixFois = tunedLevel({ ...RELEVE, fuelPerCrossing: RELEVE.fuelPerCrossing * 5 });
if (dixFois !== null && dixFois.perHour >= 0) {
  fail(
    `à cinq fois le carburant le net reste positif (${dixFois.perHour.toFixed(0)}) : ` +
      `la garde ne mesure plus ce qu'elle croit`
  );
}

/* ------------------------------------------------ le plafond tient toujours */

/**
 * `pointsCap` exclut ce qui demande deux remplissages de Mangeoire.
 *
 * Sur ses chiffres à lui, il ne borne **rien** : le niveau 85 rend déjà 8 % de
 * moins que le 67 — 45 738 contre 49 706 — donc l'économie l'écarte avant le
 * plafond. Une première version de cette garde affirmait le contraire et a rougi
 * au premier essai ; c'est écrit ici plutôt que corrigé en silence, parce que
 * « le plafond nous protège » est exactement le genre de croyance qu'on garde
 * après qu'elle a cessé d'être vraie.
 *
 * Pour vérifier qu'il borne quand même, il faut une Mangeoire assez bon marché
 * pour que monter reste payant au-delà : à un dixième de son prix, la grille part
 * plus haut, et le plafond doit la retenir.
 */
const presqueGratuit = { ...RELEVE, mangeoireCostPerMountPoint: RELEVE.mangeoireCostPerMountPoint / 10 };
const sansPlafond = tunedLevel({ ...presqueGratuit, pointsCap: undefined });
const avecPlafond = tunedLevel({ ...presqueGratuit, pointsCap: 70_000 });
if (sansPlafond === null || avecPlafond === null) {
  fail('pas de conseil sur la Mangeoire bon marché');
} else {
  if (sansPlafond.level <= 67) {
    fail(
      `Mangeoire au dixième et sans plafond, le conseil est ${sansPlafond.level} : ` +
        `rien ne monte, donc le plafond n'a rien à retenir et ce contrôle ne prouve rien`
    );
  }
  if (avecPlafond.level > 67) {
    fail(`le plafond de 70 000 laisse passer le niveau ${avecPlafond.level}, qui demande deux remplissages`);
  }
}

// Et un plafond serré rabat vraiment le conseil : 1 000 points ne portent pas
// au-delà du niveau 23.
const trop = tunedLevel({ ...RELEVE, pointsCap: 1_000 });
if (trop !== null && trop.level > 23) {
  fail(`à 1 000 points de plafond, le conseil ${trop.level} dépasse ce qu'un remplissage porte`);
}

if (failed > 0) {
  console.error(`\n${failed} contrôle(s) en échec.`);
  process.exit(1);
}

console.log(
  `niveau conseillé ${conseil.level} · ${conseil.perHour.toFixed(0)} kamas par heure, ` +
    `et le compte est un gain`
);
