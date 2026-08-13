/**
 * PostgREST plafonne toute réponse à `max_rows` (1000, cf. supabase/config.toml)
 * **sans le signaler** : pas d'erreur, pas de drapeau, juste une liste plus
 * courte. Un `select('*')` nu sur une table qui a dépassé le millier de lignes
 * rend donc un résultat silencieusement tronqué, que l'appelant prend pour la
 * table entière.
 *
 * Sur `item_prices`, ça se lit « prix manquants » : les items coupés passent
 * partout pour jamais tarifés, et les recettes qui les emploient pour
 * incalculables. Le contenu de la coupe n'est même pas stable — voir `order`
 * plus bas.
 */
export const SUPABASE_PAGE_SIZE = 1000;

/** Ce que rend un builder PostgREST, réduit à ce dont la pagination a besoin. */
type Page<T> = { data: T[] | null; error: unknown };

/**
 * Rassemble toutes les pages d'une requête PostgREST.
 *
 * `page` reçoit les bornes et **reconstruit** la requête à chaque appel : un
 * builder supabase-js porte son propre état et se rejoue mal, il ne se réutilise
 * pas d'une page à l'autre.
 *
 * La requête doit être triée. L'ordre lui-même importe peu, mais il doit être
 * stable : sans `order`, PostgREST sert les lignes dans l'ordre physique de la
 * table, que la moindre réécriture déplace. Deux pages peuvent alors se
 * recouvrir ou se manquer, et — pire pour qui débogue — l'ensemble rendu change
 * d'un chargement à l'autre sans que rien n'ait été supprimé.
 */
/**
 * De quoi transformer une boucle infinie en erreur visible.
 *
 * La sortie de boucle repose sur une page incomplète. Un serveur qui ignorerait
 * `offset`/`limit` — un cache mal réglé, un proxy qui réécrit la requête —
 * rendrait toujours la même première page pleine, et l'onglet partirait à
 * marteler la base sans jamais rendre la main. Vu pour de vrai en écrivant le
 * test de cette fonction, sur un faux serveur qui n'honorait pas les bornes.
 *
 * 500 pages, soit 500 000 lignes : hors d'atteinte des tables concernées, donc
 * l'atteindre ne veut pas dire « grosse table » mais « pagination cassée ».
 */
const MAX_PAGES = 500;

export const fetchAllRows = async <T>(
  page: (from: number, to: number) => PromiseLike<Page<T>>
): Promise<T[]> => {
  const all: T[] = [];

  for (let index = 0; index < MAX_PAGES; index += 1) {
    const from = index * SUPABASE_PAGE_SIZE;
    const { data, error } = await page(from, from + SUPABASE_PAGE_SIZE - 1);
    if (error) throw error;

    const rows = data ?? [];
    all.push(...rows);
    // Une page incomplète est la dernière : c'est le seul signal de fin que
    // PostgREST donne sans demander un `count`, qui coûterait un scan par page.
    if (rows.length < SUPABASE_PAGE_SIZE) return all;
  }

  throw new Error(
    `Pagination interrompue après ${MAX_PAGES} pages : le serveur ne semble pas honorer les bornes.`
  );
};
