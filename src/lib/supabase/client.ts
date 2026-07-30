import { createBrowserClient } from '@supabase/ssr';
import { getSupabaseEnv, isSupabaseConfigured } from './env';
import type { Database } from './types';

export const createClient = () => {
  const { url, anonKey } = getSupabaseEnv();

  // Without real credentials, every request is doomed anyway — skip GoTrueClient's
  // background session refresh/persistence so it doesn't keep retrying against the
  // placeholder host in the background.
  const auth = isSupabaseConfigured()
    ? undefined
    : { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false };

  return createBrowserClient<Database>(url, anonKey, { auth });
};
