// Not a real Supabase project — just a syntactically valid, same-origin URL so the
// Supabase client constructs without throwing. Any actual request made with these
// will still fail (this host doesn't serve Supabase's REST/Auth API), which callers
// already handle via their existing try/catch + error state.
const FALLBACK_URL = 'https://dofdof.onrender.com';
const FALLBACK_ANON_KEY = 'placeholder-anon-key';

const warnedVars = new Set<string>();

function readEnv(
  name: 'NEXT_PUBLIC_SUPABASE_URL' | 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  fallback: string
): string {
  const value = process.env[name];
  if (!value) {
    if (!warnedVars.has(name)) {
      warnedVars.add(name);
      console.error(
        `Missing environment variable: ${name}. Supabase requests will fail until it's set in your deployment's environment variables.`
      );
    }
    return fallback;
  }
  return value;
}

export const isSupabaseConfigured = () =>
  Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL) &&
  Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

export const getSupabaseEnv = () => ({
  url: readEnv('NEXT_PUBLIC_SUPABASE_URL', FALLBACK_URL),
  anonKey: readEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', FALLBACK_ANON_KEY),
});
