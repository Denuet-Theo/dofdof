'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import { Mail, Lock, Sparkles, UserPlus, LogIn } from 'lucide-react';

const LoginPage = () => {
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSuccess('');

    const supabase = createClient();

    try {
      if (isSignUp) {
        const { error } = await supabase.auth.signUp({
          email,
          password,
        });
        if (error) throw error;
        setSuccess('Compte créé ! Vérifie ton email pour confirmer.');
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
        router.push('/');
        router.refresh();
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Une erreur est survenue'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden">
      {/* Background effects */}
      <div className="absolute inset-0 bg-gradient-to-br from-dark-950 via-dark-900 to-dark-950" />
      <div className="absolute top-1/4 -left-32 w-96 h-96 bg-kamas/5 rounded-full blur-[128px]" />
      <div className="absolute bottom-1/4 -right-32 w-96 h-96 bg-kamas/3 rounded-full blur-[128px]" />

      {/* Floating particles */}
      <div className="absolute top-20 left-1/4 w-2 h-2 bg-kamas/30 rounded-full animate-float" />
      <div className="absolute top-40 right-1/3 w-1.5 h-1.5 bg-kamas/20 rounded-full animate-float" style={{ animationDelay: '1s' }} />
      <div className="absolute bottom-32 left-1/3 w-1 h-1 bg-kamas/25 rounded-full animate-float" style={{ animationDelay: '2s' }} />

      {/* Login card */}
      <div className="relative w-full max-w-md animate-slide-up">
        <div className="glass-strong rounded-3xl p-8 shadow-2xl shadow-dark-950/80">
          {/* Logo */}
          <div className="flex flex-col items-center mb-8">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-kamas-dark to-kamas-light flex items-center justify-center shadow-xl shadow-kamas/30 mb-4">
              <Sparkles size={32} className="text-dark-950" />
            </div>
            <h1 className="text-3xl font-black text-gradient-gold">Dofdof</h1>
            <p className="text-dark-500 text-sm mt-1">
              Calculateur de Rentabilité Dofus
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              type="email"
              label="Email"
              placeholder="ton@email.fr"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              icon={<Mail size={16} />}
              required
            />
            <Input
              type="password"
              label="Mot de passe"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              icon={<Lock size={16} />}
              required
              minLength={6}
            />

            {error && (
              <div className="p-3 rounded-xl bg-loss/10 border border-loss/20 text-loss text-sm animate-fade-in">
                {error}
              </div>
            )}

            {success && (
              <div className="p-3 rounded-xl bg-gain/10 border border-gain/20 text-gain text-sm animate-fade-in">
                {success}
              </div>
            )}

            <Button
              type="submit"
              loading={loading}
              className="w-full"
              size="lg"
            >
              {isSignUp ? (
                <>
                  <UserPlus size={18} />
                  Créer un compte
                </>
              ) : (
                <>
                  <LogIn size={18} />
                  Se connecter
                </>
              )}
            </Button>
          </form>

          {/* Toggle */}
          <div className="mt-6 text-center">
            <button
              type="button"
              onClick={() => {
                setIsSignUp(!isSignUp);
                setError('');
                setSuccess('');
              }}
              className="text-sm text-dark-500 hover:text-kamas transition-colors cursor-pointer"
            >
              {isSignUp
                ? 'Déjà un compte ? Se connecter'
                : "Pas de compte ? S'inscrire"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
