// Résolution partagée de SUPABASE_DB_URL, utilisée par run-migrations.mjs et
// sync-dofusdb.mjs pour qu'ils échouent de la même façon et logguent la même chose.
//
// SUPABASE_DB_URL est une chaîne de connexion Postgres *directe* avec les droits
// DDL. Les variables NEXT_PUBLIC_SUPABASE_* que l'app utilise sont une clé anon
// et ne peuvent rien écrire ici : elles ne jouent délibérément aucun rôle.

// Render positionne RENDER=true sur tous ses services. En local, une chaîne de
// connexion absente est un état normal et ne doit pas bloquer ; sur un service
// déployé c'est une erreur de configuration, et l'ignorer silencieusement
// laisserait l'app tourner sur un schéma périmé avec un déploiement au vert.
// Ce succès silencieux est le pire résultat, donc sur Render c'est fatal.
export const isRender = () => process.env.RENDER === 'true';

// La chaîne de connexion contient le mot de passe : ne jamais la re-logger.
export function describeTarget(url) {
  try {
    const { host, pathname } = new URL(url);
    return `${host}${pathname}`;
  } catch {
    return 'the configured database';
  }
}

/**
 * Renvoie SUPABASE_DB_URL, ou termine le process.
 *
 * @param {string} tag         préfixe de log, ex. 'migrate' ou 'sync'
 * @param {string} onRenderMsg ce qui est cassé si la variable manque sur Render
 * @returns {string}
 */
export function requireDbUrl(tag, onRenderMsg) {
  const dbUrl = process.env.SUPABASE_DB_URL;
  if (dbUrl) return dbUrl;

  if (isRender()) {
    console.error(
      `[${tag}] SUPABASE_DB_URL is not set, but this is a Render deploy. ${onRenderMsg} ` +
        'Set it in the Render dashboard (Environment), using the direct connection ' +
        'string, not the pooler.'
    );
    process.exit(1);
  }

  console.warn(`[${tag}] SUPABASE_DB_URL is not set — skipping.`);
  process.exit(0);
}
