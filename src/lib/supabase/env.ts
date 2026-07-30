function requireEnv(name: 'NEXT_PUBLIC_SUPABASE_URL' | 'NEXT_PUBLIC_SUPABASE_ANON_KEY'): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. Set it in your .env.local file.`
    );
  }
  return value;
}

export const getSupabaseEnv = () => ({
  url: requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
  anonKey: requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
});
