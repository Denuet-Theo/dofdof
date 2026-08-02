'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard,
  Search,
  ChefHat,
  Package,
  Gauge,
  Swords,
  LogOut,
  Sparkles,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

const navItems = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/items', label: 'Items & Prix', icon: Search },
  { href: '/recipes', label: 'Recettes', icon: ChefHat },
  { href: '/gauges', label: 'Jauges', icon: Gauge },
  { href: '/farm', label: 'Farm', icon: Swords },
  { href: '/inventory', label: 'Inventaire', icon: Package },
];

const Sidebar = () => {
  const pathname = usePathname();
  const router = useRouter();

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
  };

  return (
    <aside className="fixed left-0 top-0 bottom-0 w-64 glass-strong flex flex-col z-40">
      {/* Logo */}
      <div className="px-6 py-6 border-b border-dark-700/50">
        <Link href="/" className="flex items-center gap-3 group">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-kamas-dark to-kamas-light flex items-center justify-center shadow-lg shadow-kamas/20 group-hover:shadow-kamas/40 transition-shadow">
            <Sparkles size={20} className="text-dark-950" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-gradient-gold">Dofdof</h1>
            <p className="text-[10px] text-dark-500 -mt-0.5">Calculateur HDV</p>
          </div>
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {navItems.map((item) => {
          const isActive =
            item.href === '/'
              ? pathname === '/'
              : pathname.startsWith(item.href);
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`
                flex items-center gap-3 px-4 py-3 rounded-xl
                text-sm font-medium transition-all duration-200
                ${
                  isActive
                    ? 'bg-kamas/10 text-kamas border border-kamas/20 shadow-sm shadow-kamas/5'
                    : 'text-dark-400 hover:text-dark-200 hover:bg-dark-800/50'
                }
              `}
            >
              <Icon size={18} className={isActive ? 'text-kamas' : ''} />
              {item.label}
              {isActive && (
                <div className="ml-auto w-1.5 h-1.5 rounded-full bg-kamas animate-pulse" />
              )}
            </Link>
          );
        })}
      </nav>

      {/* Logout */}
      <div className="px-3 py-4 border-t border-dark-700/50">
        <button
          onClick={handleLogout}
          className="flex items-center gap-3 px-4 py-3 rounded-xl w-full
            text-sm font-medium text-dark-500 hover:text-loss hover:bg-loss/5
            transition-all duration-200 cursor-pointer"
        >
          <LogOut size={18} />
          Déconnexion
        </button>
        <p className="px-4 pt-2 text-[10px] text-dark-600">
          {process.env.NEXT_PUBLIC_APP_COMMIT || 'dev'}
          {process.env.NEXT_PUBLIC_APP_BUILD_DATE &&
            ` · ${new Date(process.env.NEXT_PUBLIC_APP_BUILD_DATE).toLocaleString('fr-FR', {
              day: '2-digit',
              month: '2-digit',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}`}
        </p>
      </div>
    </aside>
  );
};

export default Sidebar;
