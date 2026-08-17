import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Page, Route } from '@playwright/test';

/**
 * Un Supabase simulé au niveau du réseau, avec de l'état.
 *
 * ## Pourquoi pas une vraie base
 *
 * Une instance Supabase locale demanderait Docker, des migrations jouées et un
 * jeu de données semé avant chaque test — pour vérifier des choses qui se
 * jouent toutes **entre le clic et la requête**. Ce qu'on veut savoir ici,
 * c'est : ce que l'app envoie, dans quel ordre, et ce qu'elle fait de ce qu'on
 * lui répond. Un faux serveur répond à ces trois questions et permet en plus
 * la seule chose qu'une vraie base ne donne pas facilement : **refuser** une
 * écriture précise, à un moment précis.
 *
 * C'est ce refus qui compte. Le 15 août 2026, une insertion de 22 naissances a
 * échoué en production, la stérilisation des parents est passée quand même, et
 * 22 montures ont disparu. Aucun test qui ne sait pas faire échouer une
 * écriture n'aurait attrapé ça.
 *
 * ## Pourquoi de l'état
 *
 * Les parcours qu'on couvre écrivent **puis relisent** : une naissance saisie
 * s'ajoute à l'écurie, ses parents passent stériles, et « annuler le dernier »
 * défait les trois. Un mock qui rejoue toujours la fixture d'origine ne verrait
 * rien de tout ça — il dirait « vert » sur une annulation qui n'annule rien.
 */

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;

const FIXTURE = path.join(process.cwd(), 'e2e', 'fixtures', 'muldo-stable.json');

/**
 * L'écurie du 15/08, anonymisée — 203 montures, 16 prix de couleurs, le projet
 * et le planning.
 *
 * Des données réelles et non une fixture inventée, pour une raison mesurée :
 * une écurie de six montures et huit couleurs tarifées ne vaut **rien** aux
 * yeux de la politique, qui ne propose alors aucune fournée. Il n'y a donc rien
 * à saisir, et le test le plus important n'a pas d'écran sur lequel s'exécuter.
 */
export const loadFixture = (): Tables =>
  JSON.parse(readFileSync(FIXTURE, 'utf8')) as Tables;

/** Ce qu'on demande au faux serveur de refuser, et sur quelle table. */
export type Refusal = {
  table: string;
  method: 'POST' | 'PATCH' | 'DELETE';
  /** Le corps d'erreur PostgREST rendu, tel quel. */
  body?: Row;
  status?: number;
};

export type SupabaseMock = {
  /** Les tables, telles que le faux serveur les tient à cet instant. */
  tables: Tables;
  /** Les requêtes d'écriture reçues, dans l'ordre. */
  writes: { table: string; method: string; query: string; body: unknown }[];
  /** Fait échouer la prochaine écriture qui correspond, une seule fois. */
  refuseOnce: (refusal: Refusal) => void;
  /** Toutes les écritures correspondantes échouent jusqu'à `allow`. */
  refuse: (refusal: Refusal) => void;
  allow: () => void;
  /** Les lignes d'une table, pour affirmer sur l'état final. */
  rows: (table: string) => Row[];
};

/** L'hôte que `src/lib/supabase/env.ts` retient faute de variables réelles. */
const HOST = 'https://dofdof.onrender.com';

const RLS_DENIED = {
  message: 'new row violates row-level security policy for table "user_breeding_individuals"',
  details: 'Failing row contains (…, muldo, ebene_orchidee, M).',
  hint: null,
  code: '42501',
};

let sequence = 0;
const newId = () => `e2e00000-0000-0000-0000-${String(++sequence).padStart(12, '0')}`;

/**
 * Les colonnes qui ne sont pas des filtres de ligne.
 *
 * PostgREST mêle dans la query les filtres (`id=eq.x`) et les options
 * (`select`, `on_conflict`, `order`, la pagination). Les traiter comme des
 * filtres ne rendrait jamais aucune ligne.
 */
const NOT_A_FILTER = new Set(['select', 'on_conflict', 'order', 'offset', 'limit', 'columns']);

/**
 * Le filtre PostgREST d'une requête, appliqué pour de vrai — `?id=eq.x`,
 * `?id=in.(a,b)`, `?family=eq.muldo`.
 *
 * Il ne portait que sur `id`, et c'était un piège en attente. Toute écriture
 * ciblée autrement — `.delete().eq('family', …)`, un `update` sur une clé
 * composite — ne filtrait alors **rien** : le `DELETE` gardait toutes les
 * lignes, le test passait au vert sur une suppression qui n'avait rien
 * supprimé. Un faux serveur qui ignore un filtre ment exactement là où on lui
 * demande de vérifier.
 *
 * Les appliquer n'est pas un luxe : sans ça, une monture stérilisée resterait
 * fertile côté serveur, la relecture la reproposerait, et le test verrait une
 * fournée qui ne se vide jamais.
 */
const matcher = (query: URLSearchParams, strict: boolean): ((row: Row) => boolean) => {
  const tests: ((row: Row) => boolean)[] = [];

  for (const [column, filter] of query.entries()) {
    if (NOT_A_FILTER.has(column)) continue;

    if (filter.startsWith('in.')) {
      const values = filter
        .slice(3)
        .replace(/^\(|\)$/g, '')
        .split(',')
        .map((value) => value.replace(/"/g, ''))
        .filter(Boolean);
      tests.push((row) => values.includes(String(row[column])));
      continue;
    }
    if (filter.startsWith('eq.')) {
      const value = filter.slice(3);
      tests.push((row) => String(row[column]) === value);
      continue;
    }
    /**
     * Un opérateur qu'on ne sait pas jouer.
     *
     * En **écriture**, c'est une erreur franche : le silence se traduirait par
     * « toutes les lignes » ou « aucune », et les deux donnent un vert qui ne
     * vaut rien sur un `PATCH` ou un `DELETE`. En lecture, on laisse passer —
     * la fixture ne porte qu'une famille, une requête trop large y rend de toute
     * façon les mêmes lignes, et c'est ce que ce faux serveur fait déjà pour les
     * listes.
     */
    if (strict) throw new Error(`Filtre PostgREST non simulé : ${column}=${filter}`);
  }

  // Aucun filtre : la requête porte sur toute la table, ce que PostgREST fait
  // aussi. Les `.delete()` sans filtre n'existent pas dans l'app.
  return (row) => tests.every((test) => test(row));
};

export const mockSupabase = async (page: Page): Promise<SupabaseMock> => {
  const tables = loadFixture();
  const writes: SupabaseMock['writes'] = [];
  let refusal: Refusal | null = null;
  let once = false;

  const mock: SupabaseMock = {
    tables,
    writes,
    refuseOnce: (next) => {
      refusal = next;
      once = true;
    },
    refuse: (next) => {
      refusal = next;
      once = false;
    },
    allow: () => {
      refusal = null;
    },
    rows: (table) => tables[table] ?? [],
  };

  // Le miroir de catalogue vit dans une base que les tests n'ont pas. Sans cette
  // interception la page part sur une 500 et chiffre les jauges au prix relevé —
  // ce qui n'est pas ce qu'on teste ici, mais brouille les captures d'échec.
  await page.route('**/api/dofusdb/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"data":[]}' })
  );

  await page.route(`${HOST}/rest/v1/**`, async (route: Route) => {
    const url = new URL(route.request().url());
    const table = url.pathname.replace('/rest/v1/', '');
    const method = route.request().method() as 'GET' | 'POST' | 'PATCH' | 'DELETE';
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    const match = matcher(url.searchParams, method !== 'GET');

    if (method === 'GET') {
      const rows = tables[table] ?? [];
      // La pagination de `fetchAllRows` se lit dans la query. Rendre une page
      // pleine à chaque appel la ferait tourner sans fin.
      const offset = Number(url.searchParams.get('offset') ?? 0);
      const paged = offset > 0 ? [] : rows;
      /**
       * `.single()` / `.maybeSingle()` attendent un objet, pas un tableau : ces
       * tables-là sont lues ainsi, et rendre `[]` ferait échouer la lecture au
       * lieu de dire « aucune ligne ».
       *
       * `breeding_projects` y était et n'y appartient pas : `useBreedingProject`
       * lit `.order(…).limit(1)` puis prend `data?.[0]`. Rendre un objet faisait
       * donc `undefined`, et le projet valait `null` dans **toute** la suite —
       * aucune couleur visée, aucun `target_count`, et tout ce qui dépend du
       * projet silencieusement hors test. La fixture porte pourtant le projet du
       * 15/08, `azur_dore`. Un faux serveur qui se trompe de forme ne casse rien :
       * il rend vert une fonctionnalité que personne n'exécute.
       */
      const single = ['user_breeding_settings', 'breeding_timeline',
        'user_breeding_availability', 'breeding_batch'];
      if (single.includes(table)) return json(rows.find(match) ?? null);
      return json(paged);
    }

    writes.push({ table, method, query: url.search, body: route.request().postDataJSON?.() });

    if (refusal && refusal.table === table && refusal.method === method) {
      if (once) refusal = null;
      return json(refusal?.body ?? RLS_DENIED, refusal?.status ?? 403);
    }

    const rows = (tables[table] ??= []);

    if (method === 'POST') {
      const sent = route.request().postDataJSON();
      // `Row` explicite, et non l'inférence : les colonnes se lisent ensuite par
      // nom calculé — `existing[column]` — ce qu'un littéral fermé refuse.
      const inserted: Row[] = (Array.isArray(sent) ? sent : [sent]).map((row: Row) => ({
        level: 1,
        fertile: true,
        cycled: false,
        ...row,
        id: (row.id as string | undefined) ?? newId(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }));

      /**
       * `insert` ou `upsert` — et c'est l'en-tête qui le dit, pas nous.
       *
       * `supabase-js` distingue les deux par `Prefer: resolution=merge-duplicates`,
       * que PostgREST lit pour choisir entre un `INSERT` sec et un
       * `ON CONFLICT DO UPDATE`. C'est donc le seul discriminant fidèle, et le
       * seul qui n'ait pas besoin de savoir quelles tables portent une ligne par
       * éleveur.
       *
       * On le déduisait de la présence d'un `id`, ce qui marchait pour les tables
       * à clé composite — la fournée, le vrac, les prix, qui annoncent leur
       * `on_conflict` — mais pas pour celles à **une ligne par éleveur** : les
       * réglages, la disponibilité, les filtres de ferme. Leur clé est le
       * `user_id` seul, posé par le défaut SQL `auth.uid()`, donc l'app n'annonce
       * rien et n'envoie pas d'`id`. L'`id` fabriqué ci-dessus ne matchait alors
       * aucune ligne existante, et chaque enregistrement en empilait une de plus.
       *
       * Le symptôme était le pire possible pour un faux serveur : la requête
       * partait avec le bon corps, un test pouvait le lire et le trouver juste, et
       * l'état final restait celui d'avant. Toute assertion sur ce que la base
       * porte **après** l'écriture passait donc au vert sur une écriture perdue.
       */
      const merging = (route.request().headers().prefer ?? '').includes('merge-duplicates');
      const announced = url.searchParams.get('on_conflict')?.split(',');
      /**
       * Les colonnes lues sur le corps **envoyé**, et non sur `inserted`.
       *
       * `inserted` porte un `id` fabriqué, donc `'id' in row` y est toujours vrai
       * et le repli sur la ligne unique ne se déclencherait jamais. C'est ce que
       * l'app envoie qui dit sur quoi PostgREST peut résoudre le conflit.
       *
       * `user_id` vient du défaut SQL `auth.uid()`, il n'est pas dans le corps :
       * les colonnes absentes des deux côtés ne départagent rien.
       */
      const sentRows = (Array.isArray(sent) ? sent : [sent]) as Row[];
      const keys = (announced ?? ['id']).filter((column) =>
        sentRows.some((row) => column in row)
      );

      for (const row of inserted) {
        const at = !merging
          ? -1
          : keys.length > 0
            ? rows.findIndex((existing) => keys.every((column) => existing[column] === row[column]))
            : // Aucune clé lisible : la table est à une ligne par éleveur, et le
              // faux serveur n'en tient qu'un. C'est celle-là qu'on écrase.
              rows.length - 1;
        if (at >= 0) rows[at] = { ...rows[at], ...row };
        else rows.push(row);
      }
      return json(inserted, 201);
    }

    if (method === 'PATCH') {
      const patch = route.request().postDataJSON() as Row;
      for (const row of rows) if (match(row)) Object.assign(row, patch);
      return json([]);
    }

    if (method === 'DELETE') {
      tables[table] = rows.filter((row) => !match(row));
      return json([]);
    }

    return json([]);
  });

  return mock;
};
