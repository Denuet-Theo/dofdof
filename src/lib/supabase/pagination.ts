/**
 * PostgREST plafonne toute réponse à `max_rows` **sans le signaler** : pas
 * d'erreur, pas de drapeau, juste une liste plus courte. Un `select('*')` nu sur
 * une table qui dépasse ce plafond rend donc un résultat silencieusement
 * tronqué, que l'appelant prend pour la table entière.
 *
 * Sur `item_prices`, ça se lit « prix manquants » : les items coupés passent
 * partout pour jamais tarifés, et les recettes qui les emploient pour
 * incalculables. Le contenu de la coupe n'est même pas stable — voir l'exigence
 * de tri sur `fetchAllRows`.
 */

/**
 * Ce qu'on **demande** par page — pas ce qu'on croit recevoir.
 *
 * `supabase/config.toml` fixe `max_rows` du Supabase **local**. Le projet
 * hébergé porte son propre réglage « Max rows », que rien dans ce dépôt ne
 * contrôle et qui peut être plus bas. D'où une page demandée large, et une
 * boucle qui n'en déduit rien.
 */
export const SUPABASE_PAGE_SIZE = 1000;

/**
 * Le garde-fou contre la boucle sans fin.
 *
 * Un serveur qui ignorerait `offset`/`limit` — un cache mal réglé, un proxy qui
 * réécrit la requête — rendrait la même page pleine indéfiniment, et l'onglet
 * partirait à marteler la base sans jamais rendre la main. Vu pour de vrai en
 * écrivant le test de cette fonction, sur un faux serveur qui n'honorait pas
 * les bornes.
 *
 * Compté en requêtes et non en lignes : c'est le martèlement qu'on borne, et le
 * nombre de lignes par réponse est précisément ce qu'on ne connaît pas.
 */
const MAX_REQUESTS = 500;

/** Ce que rend un builder PostgREST, réduit à ce dont la pagination a besoin. */
type Page<T> = { data: T[] | null; error: unknown };

/**
 * Rassemble toutes les pages d'une requête PostgREST.
 *
 * `page` reçoit les bornes et **reconstruit** la requête à chaque appel : un
 * builder supabase-js porte son propre état et se rejoue mal, il ne se réutilise
 * pas d'une page à l'autre.
 *
 * La requête doit être **triée**. L'ordre lui-même importe peu, mais il doit
 * être stable : sans `order`, PostgREST sert les lignes dans l'ordre physique de
 * la table, que la moindre réécriture déplace. Deux pages peuvent alors se
 * recouvrir ou se manquer, et — pire pour qui débogue — l'ensemble rendu change
 * d'un chargement à l'autre sans que rien n'ait été supprimé.
 *
 * L'avancement se fait sur ce que le serveur a **réellement** rendu, et l'arrêt
 * sur une page vide. S'arrêter sur une page « incomplète » économiserait la
 * dernière requête, mais supposerait de connaître le plafond du serveur : s'il
 * est plus bas que `SUPABASE_PAGE_SIZE`, la toute première page revient courte,
 * la boucle conclut « c'est tout » et tronque — très exactement le bug qu'elle
 * corrige, en plus discret puisque la pagination a l'air en place.
 */
export const fetchAllRows = async <T>(
  page: (from: number, to: number) => PromiseLike<Page<T>>
): Promise<T[]> => {
  const all: T[] = [];

  for (let requests = 0; requests < MAX_REQUESTS; requests += 1) {
    const from = all.length;
    const { data, error } = await page(from, from + SUPABASE_PAGE_SIZE - 1);
    if (error) throw error;

    const rows = data ?? [];
    if (rows.length === 0) return all;
    all.push(...rows);
  }

  throw new Error(
    `Pagination interrompue après ${MAX_REQUESTS} requêtes (${all.length} lignes) : ` +
      `le serveur ne semble pas honorer les bornes de pagination.`
  );
};
