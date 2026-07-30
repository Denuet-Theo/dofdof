import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { getSupabaseEnv, isSupabaseConfigured } from './env';
import type { Database } from './types';

export const createClient = async () => {
  const cookieStore = await cookies();
  const { url, anonKey } = getSupabaseEnv();

  const auth = isSupabaseConfigured()
    ? undefined
    : { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false };

  return createServerClient<Database>(
    url,
    anonKey,
    {
      auth,
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // The `setAll` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing sessions.
          }
        },
      },
    }
  );
};
