// Not real credentials — just syntactically valid enough for the Supabase client to
// construct without throwing. Any actual request made with these will fail (network
// error), which callers already handle via their existing try/catch + error state.
const FALLBACK_URL = 'https://placeholder.supabase.co';
const FALLBACK_ANON_KEY = 'placeholder-anon-key';

function readEnv(
  name: 'NEXT_PUBLIC_SUPABASE_URL' | 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  fallback: string
): string {
  const value = process.env[name];
  if (!value) {
    console.error(
      `Missing environment variable: ${name}. Supabase requests will fail until it's set in your deployment's environment variables.`
    );
    return fallback;
  }
  return value;
}

export const getSupabaseEnv = () => ({
  url: readEnv('NEXT_PUBLIC_SUPABASE_URL', FALLBACK_URL),
  anonKey: readEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', FALLBACK_ANON_KEY),
});
