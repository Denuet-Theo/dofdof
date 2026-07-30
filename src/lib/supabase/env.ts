// Not a real Supabase project — just a syntactically valid, same-origin URL so the
// Supabase client constructs without throwing. Any actual request made with these
// will still fail (this host doesn't serve Supabase's REST/Auth API), which callers
// already handle via their existing try/catch + error state.
const FALLBACK_URL = 'https://dofdof.onrender.com';
const FALLBACK_ANON_KEY = 'placeholder-anon-key';

const warnedVars = new Set<string>();

// `process.env[name]` (dynamic lookup) is NOT statically analyzable by Next.js's
// build-time inliner, so NEXT_PUBLIC_ vars read that way never make it into the
// browser bundle. Each call site must pass the value via a literal
// `process.env.NEXT_PUBLIC_...` expression so it can be inlined.
function readEnv(
  name: 'NEXT_PUBLIC_SUPABASE_URL' | 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  value: string | undefined,
  fallback: string
): string {
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
  url: readEnv('NEXT_PUBLIC_SUPABASE_URL', process.env.NEXT_PUBLIC_SUPABASE_URL, FALLBACK_URL),
  anonKey: readEnv(
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    FALLBACK_ANON_KEY
  ),
});
