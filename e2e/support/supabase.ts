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
 * Les identifiants visés par un filtre PostgREST — `?id=eq.x` ou `?id=in.(a,b)`.
 *
 * Les appliquer pour de vrai n'est pas un luxe : sans ça, une monture
 * stérilisée resterait fertile côté serveur, la relecture la reproposerait, et
 * le test verrait une fournée qui ne se vide jamais.
 */
const targetedIds = (query: URLSearchParams): string[] => {
  const filter = query.get('id');
  if (!filter) return [];
  if (filter.startsWith('in.')) {
    return filter
      .slice(3)
      .replace(/^\(|\)$/g, '')
      .split(',')
      .map((value) => value.replace(/"/g, ''))
      .filter(Boolean);
  }
  return [filter.replace(/^eq\./, '')];
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

    if (method === 'GET') {
      const rows = tables[table] ?? [];
      // La pagination de `fetchAllRows` se lit dans la query. Rendre une page
      // pleine à chaque appel la ferait tourner sans fin.
      const offset = Number(url.searchParams.get('offset') ?? 0);
      const paged = offset > 0 ? [] : rows;
      // `.single()` attend un objet, pas un tableau : ces trois tables-là sont
      // lues ainsi, et rendre `[]` ferait échouer la lecture au lieu de dire
      // « aucune ligne ».
      const single = ['user_breeding_settings', 'breeding_projects', 'breeding_timeline',
        'user_breeding_availability'];
      if (single.includes(table)) return json(rows[0] ?? null);
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
      const inserted = (Array.isArray(sent) ? sent : [sent]).map((row: Row) => ({
        level: 1,
        fertile: true,
        cycled: false,
        ...row,
        id: (row.id as string | undefined) ?? newId(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }));
      // Upsert : une ligne qui existe déjà est remplacée, sinon elle s'ajoute.
      for (const row of inserted) {
        const at = rows.findIndex((existing) => existing.id === row.id);
        if (at >= 0) rows[at] = row;
        else rows.push(row);
      }
      return json(inserted, 201);
    }

    if (method === 'PATCH') {
      const patch = route.request().postDataJSON() as Row;
      const ids = targetedIds(url.searchParams);
      for (const row of rows) if (ids.includes(row.id as string)) Object.assign(row, patch);
      return json([]);
    }

    if (method === 'DELETE') {
      const ids = targetedIds(url.searchParams);
      tables[table] = rows.filter((row) => !ids.includes(row.id as string));
      return json([]);
    }

    return json([]);
  });

  return mock;
};
