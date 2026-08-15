import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { getSupabaseEnv, isSupabaseConfigured } from './env';

/**
 * Le garde d'authentification est-il levé pour un test de bout en bout ?
 *
 * Les tests e2e pilotent un vrai navigateur sur un vrai serveur Next, avec un
 * Supabase simulé au niveau du réseau. Il n'y a donc **aucune session** à
 * présenter au garde, et sans porte de sortie tout `/breeding` finirait sur
 * `/login` — c'est-à-dire aucun test possible sur les écrans qui comptent.
 *
 * Deux verrous, et le second est celui qui compte :
 *
 * 1. `DOFDOF_TEST_BYPASS_AUTH=1`, que seul `playwright.config.ts` pose ;
 * 2. `NODE_ENV !== 'production'`, que Next fige à la compilation.
 *
 * Le premier seul serait une variable d'environnement de trop dans un tableau
 * de bord de déploiement, un jour de fatigue. Le second rend la fuite sans
 * effet : un build de production ne contient pas le chemin, quoi qu'on pose
 * dans l'environnement. C'est aussi pour ça que la condition teste
 * `NODE_ENV` **en premier** — le remplacement statique de Next élimine alors
 * la branche entière du bundle.
 */
const authBypassedForTests = () =>
  process.env.NODE_ENV !== 'production' && process.env.DOFDOF_TEST_BYPASS_AUTH === '1';

export const updateSession = async (request: NextRequest) => {
  if (authBypassedForTests()) return NextResponse.next({ request });

  let supabaseResponse = NextResponse.next({
    request,
  });

  // Without real credentials every request would fail anyway — skip the network
  // call entirely instead of hitting the placeholder host on every navigation.
  let user = null;

  if (isSupabaseConfigured()) {
    const { url, anonKey } = getSupabaseEnv();

    const supabase = createServerClient(
      url,
      anonKey,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value }) =>
              request.cookies.set(name, value)
            );
            supabaseResponse = NextResponse.next({
              request,
            });
            cookiesToSet.forEach(({ name, value, options }) =>
              supabaseResponse.cookies.set(name, value, options)
            );
          },
        },
      }
    );

    const {
      data: { user: fetchedUser },
    } = await supabase.auth.getUser();
    user = fetchedUser;
  } else {
    getSupabaseEnv(); // still logs the missing-var warning once
  }

  // Reject unauthenticated API requests instead of letting them through
  if (!user && request.nextUrl.pathname.startsWith('/api')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Redirect unauthenticated users to login (except for login page and API routes)
  if (
    !user &&
    !request.nextUrl.pathname.startsWith('/login') &&
    !request.nextUrl.pathname.startsWith('/api')
  ) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  // Redirect authenticated users away from login page
  if (user && request.nextUrl.pathname.startsWith('/login')) {
    const url = request.nextUrl.clone();
    url.pathname = '/';
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
};
