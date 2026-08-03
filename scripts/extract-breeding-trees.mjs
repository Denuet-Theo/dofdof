#!/usr/bin/env node
/**
 * Extrait les arbres de croisement d'élevage depuis dragodinde.fr vers
 * `src/lib/dofus/breeding/trees.json`.
 *
 * Pourquoi figer plutôt que requêter à l'exécution : la source est un asset de
 * build dont le nom porte un hash de contenu (`muldoTree-IycXt9uu.js`). Ce hash
 * change à chaque déploiement du site, donc aucune URL n'est stable. Le script
 * repart donc de la page de guide et y lit le nom de l'asset du jour.
 *
 * Ces arbres ne sont pas dans l'API DofusDB : `breedings`, `crossings` et
 * `mount-crossings` répondent tous 404, et `breeds` désigne les classes de
 * personnage. Il n'existe pas de source officielle interrogeable.
 *
 * Chaque recette porte une provenance :
 *   - `site` : extraite, non recoupée
 *   - `game` : confirmée en jeu par un joueur (voir GAME_VERIFIED)
 *
 * L'écart entre les deux est affiché dans l'UI : un chemin d'élevage engage
 * plusieurs millions de kamas, et « extrait d'un site tiers » ne se présente pas
 * avec la même assurance que « vérifié en jeu ».
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '../src/lib/dofus/breeding/trees.json');

const SITE = 'https://dragodinde.fr';

/** Une famille = une page de guide et l'asset qu'elle charge. */
/**
 * `sacrificeItemId` : la ressource rendue en sacrifiant une monture, à raison
 * d'une unité par génération. Elle est **propre à chaque famille** — un muldo
 * rend de l'ambre, une dragodinde des neurones, un volkorne des cornes — donc
 * elle ne peut pas être un paramètre global du calcul.
 */
const FAMILIES = [
  {
    id: 'dragodinde',
    guide: 'dragodindes',
    asset: 'dragodindeTree',
    familyId: 1,
    certificateTypeId: 97,
    sacrificeItemId: 33515, // Neurone de dragodinde
  },
  {
    id: 'muldo',
    guide: 'muldos',
    asset: 'muldoTree',
    familyId: 5,
    certificateTypeId: 332,
    sacrificeItemId: 17864, // Ambre de muldo
  },
  {
    id: 'volkorne',
    guide: 'volkornes',
    asset: 'volkorneTree',
    familyId: 6,
    certificateTypeId: 207,
    sacrificeItemId: 19975, // Corne de volkorne
  },
];

/**
 * Le généton, lui, est commun aux trois familles : c'est le co-produit de
 * l'accouplement, pas du sacrifice.
 */
const GENETON_ITEM_ID = 33512;

/**
 * Les Optimakina ajoutent 10 points de probabilité d'obtenir la génération
 * cible. Il en existe une par famille et par génération visée (2 à 10 — aucun
 * croisement ne produit du gen 1, qui ne se capture qu'à l'état sauvage).
 *
 * Le type d'item porte **les trois** makinas : Animakina donne une capacité
 * aléatoire, Kromakina la capacité Caméléone, seule Optimakina touche à la
 * probabilité. Les deux autres sont écartées sans bruit — elles ont
 * parfaitement le droit d'exister ici.
 */
/**
 * Ce qu'Eugène éton donne contre des génétons, et à quel prix.
 *
 * Les quatre paliers de parchemin de caractéristique se distinguent par la
 * valeur de caractéristique en dessous de laquelle ils restent utilisables — pas
 * par un niveau d'item, qui vaut 1 pour les vingt-quatre.
 *
 * La valeur d'un généton se lit ensuite comme le meilleur rapport prix HDV sur
 * coût en génétons parmi ces parchemins. « Parchemin accélérant » ne suit pas la
 * nomenclature et ne fait pas partie de l'échange.
 */
const PARCHMENT_TYPE_ID = 76;
const PARCHMENT_TIERS = [
  { prefix: 'Puissant', tier: 'puissant', genetons: 160, requiresBelow: null },
  { prefix: 'Grand', tier: 'grand', genetons: 100, requiresBelow: 80 },
  { prefix: 'Petit', tier: 'petit', genetons: 10, requiresBelow: 25 },
  // Sans préfixe : à tester en dernier, sinon il capterait les trois autres.
  { prefix: '', tier: 'normal', genetons: 50, requiresBelow: 50 },
];

const CHARACTERISTICS = ['Force', 'Intelligence', 'Agilité', 'Sagesse', 'Vitalité', 'Chance'];

const genetonExchange = async () => {
  const items = await itemsOfType(PARCHMENT_TYPE_ID);
  const rows = [];

  for (const item of items) {
    const name = item.name.fr;
    // Seuls les parchemins de caractéristique s'échangent : le nom doit citer
    // l'une des six, ce qui écarte « Parchemin accélérant ».
    if (!CHARACTERISTICS.some((carac) => name.includes(carac))) continue;

    const match = PARCHMENT_TIERS.find(({ prefix }) => !prefix || name.startsWith(prefix));
    if (!match) continue;

    rows.push({
      itemId: item.id,
      name,
      tier: match.tier,
      genetons: match.genetons,
      requiresBelow: match.requiresBelow,
    });
  }

  return rows.sort((a, b) => a.genetons - b.genetons || a.name.localeCompare(b.name));
};

const MAKINA_TYPE_ID = 323;
const MAKINA_RE = /^(\w+) (\w+) de g[ée]n[ée]ration (\d+)/i;

/**
 * Les filets, rangés par famille. Un filet dont le nom ne cite aucune famille
 * (le filet universel) sert les trois.
 */
const netsByFamily = async (familyIds) => {
  const items = await itemsOfType(NET_TYPE_ID);
  const byFamily = Object.fromEntries(familyIds.map((id) => [id, []]));

  for (const item of items) {
    const captures = NET_CAPTURES_BY_LEVEL[item.level];
    if (!captures) {
      console.warn(`[breeding] filet de niveau ${item.level} inconnu, ignoré : ${item.name.fr}`);
      continue;
    }

    const slug = item.name.fr.toLowerCase();
    const owners = familyIds.filter((id) => slug.includes(id));
    const net = { id: item.id, name: item.name.fr, level: item.level, captures };

    for (const owner of owners.length > 0 ? owners : familyIds) byFamily[owner].push(net);
  }

  for (const nets of Object.values(byFamily)) nets.sort((a, b) => a.captures - b.captures);
  return byFamily;
};

/** `{ dragodinde: { 2: {id,name}, ... }, muldo: {...}, volkorne: {...} }` */
const optimakinaByFamily = async () => {
  const items = await itemsOfType(MAKINA_TYPE_ID);
  const byFamily = {};

  for (const item of items) {
    const match = item.name.fr.match(MAKINA_RE);
    if (!match) {
      console.warn(`[breeding] makina au nom inattendu, ignorée : ${item.name.fr}`);
      continue;
    }

    const [, kind, family, generation] = match;
    if (kind.toLowerCase() !== 'optimakina') continue;

    (byFamily[family.toLowerCase()] ??= {})[Number(generation)] = {
      id: item.id,
      name: item.name.fr,
    };
  }

  return byFamily;
};

/**
 * Les filets de capture, seule façon d'obtenir une monture de génération 1
 * autrement qu'en l'achetant. Le nombre de captures double à chaque palier,
 * donc le coût par monture est `prix du filet / captures` — et le plus gros
 * filet n'est pas forcément le meilleur rapport.
 *
 * Le filet universel sert les trois familles ; les autres sont spécifiques.
 */
const NET_CAPTURES_BY_LEVEL = { 1: 1, 100: 2, 150: 4, 200: 8 };
const NET_TYPE_ID = 99;

const DOFUSDB = 'https://api.dofusdb.fr';

/** Résout un item par son identifiant, pour vérifier qu'il existe et récupérer son nom. */
const fetchItem = async (id) => {
  const res = await fetch(`${DOFUSDB}/items?${new URLSearchParams({ id: String(id) })}`);
  if (!res.ok) throw new Error(`item ${id} : HTTP ${res.status}`);

  const body = await res.json();
  const item = body.data?.[0];
  if (!item) throw new Error(`item ${id} introuvable dans DofusDB`);
  return { id: item.id, name: item.name.fr };
};

/**
 * Chaque famille a son propre type d'item pour les certificats de monture, et
 * c'est par là qu'il faut passer : l'endpoint `mounts` de DofusDB ignore les
 * couleurs de génération 9 et 10 des muldos, alors que leurs certificats
 * existent bien en items (`Muldo Corail`, `Muldo Aigue-marine`...). Chercher la
 * monture plutôt que son certificat laisse croire à tort que ces couleurs
 * n'existent pas.
 */
const itemsOfType = async (typeId) => {
  const items = [];
  for (let skip = 0; skip < 1000; skip += 50) {
    const query = new URLSearchParams({
      typeId: String(typeId),
      $limit: '50',
      $skip: String(skip),
      '$sort[id]': '1',
    });
    const res = await fetch(`${DOFUSDB}/items?${query}`);
    if (!res.ok) throw new Error(`items typeId ${typeId} : HTTP ${res.status}`);

    const page = await res.json();
    if (!page.data?.length) break;
    items.push(...page.data);
  }
  return items;
};

/**
 * Rapproche un nom de couleur d'un nom de certificat en ne gardant que les
 * mots signifiants, triés : « Corail-Pourpre » et « Muldo Corail et Pourpre »
 * se réduisent tous deux à `corail_pourpre`. Les accents sautent parce que
 * l'arbre les omet là où DofusDB les porte.
 */
const matchKey = (name, familyId) =>
  name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z]+/g, ' ')
    .trim()
    .split(' ')
    .filter((word) => word && word !== 'et' && word !== familyId && word !== 'sauvage')
    .sort()
    .join('_');

/**
 * Corrections issues d'observations en jeu, appliquées par-dessus l'extraction.
 *
 * Aigue-marine : le site ne liste qu'une seule recette là où ses trois sœurs de
 * génération 9 en ont cinq. Les quatre manquantes viennent du jeu.
 *
 * Corail et Azur ont été relus en jeu et correspondent exactement à l'extraction
 * — ils ne sont pas corrigés ici, seulement marqués vérifiés plus bas.
 *
 * Ces recettes réfèrent des couleurs de génération 8 qui existent déjà dans
 * l'arbre ; le contrôle d'intégrité en fin de script le vérifie.
 */
const GAME_OVERRIDES = {
  muldo: {
    aigue_marine: [
      ['prune_pourpre', 'roux_emeraude'],
      ['prune_orchidee', 'amande_emeraude'],
      ['prune_indigo', 'ivoire_emeraude'],
      ['prune_ebene', 'turquoise_emeraude'],
      ['prune_dore', 'turquoise_emeraude'],
    ],
  },
};

/**
 * Couleurs dont les recettes ont été relues en jeu et tenues pour exactes.
 *
 * Ne concerne pour l'instant que la génération 9 des muldos : c'est là que le
 * besoin de recoupement est le plus fort, puisque DofusDB ne connaît aucune
 * couleur au-delà de la génération 8 et ne peut donc rien confirmer.
 */
const GAME_VERIFIED = {
  muldo: ['corail', 'aigue_marine', 'azur', 'ambre'],
};

const log = (msg) => console.log(`[breeding] ${msg}`);

/** Retrouve l'asset du jour : son nom porte un hash qui change à chaque déploiement. */
const findAssetUrl = async (guide, asset) => {
  const res = await fetch(`${SITE}/guides/${guide}`);
  if (!res.ok) throw new Error(`page de guide ${guide} : HTTP ${res.status}`);

  const html = await res.text();
  const match = html.match(new RegExp(`assets/${asset}-[A-Za-z0-9_-]+\\.js`));
  if (!match) {
    throw new Error(
      `asset ${asset} introuvable sur /guides/${guide} — le site a probablement ` +
        `changé de structure, il faut relire son HTML.`
    );
  }
  return `${SITE}/build/${match[0]}`;
};

/**
 * Le fichier est un module ES qui exporte la table sous un nom minifié
 * (`export{d as m}`), variable d'un déploiement à l'autre. On importe donc via
 * une data: URL et on prend le premier export : il n'y en a qu'un.
 */
const loadTree = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`asset ${url} : HTTP ${res.status}`);

  const source = await res.text();
  const loaded = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

  const exported = Object.values(loaded);
  if (exported.length !== 1) {
    throw new Error(`${url} exporte ${exported.length} valeurs, une seule attendue`);
  }
  return exported[0];
};

/** Deux parents dans un ordre ou dans l'autre, c'est le même croisement. */
const recipeKey = (recipe) => [...recipe].sort().join('+');

const buildFamily = async ({
  id,
  guide,
  asset,
  familyId,
  certificateTypeId,
  sacrificeItemId,
}) => {
  const url = await findAssetUrl(guide, asset);
  const [raw, certificates, sacrificeItem] = await Promise.all([
    loadTree(url),
    itemsOfType(certificateTypeId),
    fetchItem(sacrificeItemId),
  ]);

  const overrides = GAME_OVERRIDES[id] ?? {};
  const verified = new Set(GAME_VERIFIED[id] ?? []);

  // Plusieurs certificats peuvent réduire à la même clé (« sauvage » ou non) ;
  // le premier suffit, ils désignent la même couleur.
  const byKey = new Map();
  for (const item of certificates) {
    const key = matchKey(item.name.fr, id);
    if (!byKey.has(key)) byKey.set(key, item);
  }

  const colors = Object.values(raw).map((color) => {
    const overridden = overrides[color.id];
    const recipes = overridden ?? color.recipes;
    const certificate = byKey.get(matchKey(color.name, id));

    return {
      id: color.id,
      name: color.name,
      generation: color.generation,
      // Une couleur sauvage n'a pas de recette : sa provenance ne veut rien dire.
      source: recipes.length === 0 ? null : overridden || verified.has(color.id) ? 'game' : 'site',
      // L'item du certificat : c'est lui qui porte le nom affichable, l'icône,
      // et qui se joint à `item_prices`. `null` si DofusDB ne le connaît pas.
      itemId: certificate?.id ?? null,
      itemName: certificate?.name?.fr ?? null,
      recipes,
    };
  });

  return { id, familyId, certificateTypeId, sacrificeItem, sourceUrl: url, colors };
};

/**
 * Contrôles d'intégrité. Un arbre incohérent ne doit pas atteindre le dépôt :
 * la récursion « acheter ou élever » le parcourt en supposant un DAG clos, et
 * une référence pendante y deviendrait un coût manquant silencieux plutôt
 * qu'une erreur.
 */
const check = (family) => {
  const byId = new Map(family.colors.map((color) => [color.id, color]));
  const problems = [];

  for (const color of family.colors) {
    for (const recipe of color.recipes) {
      if (recipe.length !== 2) {
        problems.push(`${color.id} : recette de ${recipe.length} parents, 2 attendus`);
        continue;
      }
      for (const parent of recipe) {
        if (!byId.has(parent)) problems.push(`${color.id} : parent inconnu « ${parent} »`);
      }
      // Un parent ne peut pas être d'une génération postérieure à son enfant,
      // sinon le graphe a un cycle et la récursion ne termine pas.
      for (const parent of recipe) {
        const ancestor = byId.get(parent);
        if (ancestor && ancestor.generation >= color.generation) {
          problems.push(
            `${color.id} (gen ${color.generation}) : parent « ${parent} » de génération ` +
              `${ancestor.generation}, ce qui crée un cycle`
          );
        }
      }
    }

    const keys = color.recipes.map(recipeKey);
    if (new Set(keys).size !== keys.length) {
      problems.push(`${color.id} : deux recettes identiques`);
    }
  }

  const roots = family.colors.filter((color) => color.recipes.length === 0);
  if (roots.length === 0) problems.push('aucune couleur sauvage : rien pour amorcer un élevage');

  return { problems, roots };
};

const main = async () => {
  const families = [];
  const familyIds = FAMILIES.map((family) => family.id);
  const [optimakina, nets] = await Promise.all([optimakinaByFamily(), netsByFamily(familyIds)]);

  for (const family of FAMILIES) {
    const built = await buildFamily(family);
    built.optimakinaByGeneration = optimakina[family.id] ?? {};
    built.nets = nets[family.id] ?? [];

    // Une génération sans Optimakina n'est pas fatale, mais c'est le signe que
    // le nom de l'item a changé et que l'expression qui le reconnaît a décroché.
    const missing = [...new Set(built.colors.map((c) => c.generation))]
      .filter((generation) => generation > 1 && !built.optimakinaByGeneration[generation])
      .sort((a, b) => a - b);
    if (missing.length > 0) {
      console.warn(
        `[breeding] ${family.id} : pas d'Optimakina pour les générations ${missing.join(', ')}`
      );
    }
    const { problems, roots } = check(built);

    if (problems.length > 0) {
      console.error(`[breeding] ${built.id} : arbre incohérent`);
      for (const problem of problems) console.error(`  - ${problem}`);
      process.exit(1);
    }

    const verified = built.colors.filter((color) => color.source === 'game').length;
    const linked = built.colors.filter((color) => color.itemId !== null).length;
    const maxGen = Math.max(...built.colors.map((color) => color.generation));
    log(
      `${built.id.padEnd(11)} ${String(built.colors.length).padStart(3)} couleurs, ` +
        `${roots.length} sauvages, gen max ${maxGen}, ${verified} vérifiées en jeu, ` +
        `${linked} liées à un certificat, sacrifice → ${built.sacrificeItem.name}, ` +
        `${built.nets.length} filets (${built.nets.map((net) => net.captures + '×').join(' ')})`
    );

    // Un certificat manquant n'est pas fatal — la couleur reste chiffrable avec
    // un prix saisi à la main — mais c'est assez inhabituel pour être signalé.
    if (linked < built.colors.length) {
      for (const color of built.colors.filter((c) => c.itemId === null)) {
        console.warn(`[breeding]   sans certificat DofusDB : ${color.name}`);
      }
    }

    families.push(built);
  }

  const [geneton, exchange] = await Promise.all([fetchItem(GENETON_ITEM_ID), genetonExchange()]);
  const tiers = [...new Set(exchange.map((row) => row.genetons))].sort((a, b) => a - b);
  log(
    `généton → item ${geneton.id} (${geneton.name}), commun aux trois familles ; ` +
      `${exchange.length} parchemins échangeables à ${tiers.join('/')} génétons`
  );

  if (exchange.length !== CHARACTERISTICS.length * PARCHMENT_TIERS.length) {
    console.warn(
      `[breeding] ${exchange.length} parchemins trouvés, ` +
        `${CHARACTERISTICS.length * PARCHMENT_TIERS.length} attendus — nomenclature changée ?`
    );
  }

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(
    OUT,
    JSON.stringify(
      { extractedAt: new Date().toISOString(), geneton, genetonExchange: exchange, families },
      null,
      2
    ) + '\n'
  );
  log(`écrit dans ${OUT}`);
};

const executedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (executedDirectly) {
  main().catch((err) => {
    console.error(`[breeding] échec : ${err.message}`);
    process.exit(1);
  });
}
