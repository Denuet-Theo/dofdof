'use client';

import { useState, useEffect, useRef } from 'react';
import { Search, Loader2 } from 'lucide-react';

interface SearchBarProps {
  onSearch: (query: string) => void;
  loading?: boolean;
  placeholder?: string;
}

const SearchBar = ({
  onSearch,
  loading = false,
  placeholder = 'Rechercher un item Dofus...',
}: SearchBarProps) => {
  const [query, setQuery] = useState('');
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    if (query.length >= 2) {
      debounceRef.current = setTimeout(() => {
        onSearch(query);
      }, 300);
    }

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [query, onSearch]);

  return (
    <div className="relative">
      <div className="absolute left-4 top-1/2 -translate-y-1/2 text-dark-500">
        {loading ? (
          <Loader2 size={20} className="animate-spin text-kamas" />
        ) : (
          <Search size={20} />
        )}
      </div>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={placeholder}
        className="w-full pl-12 pr-4 py-4 rounded-2xl
          bg-dark-800/80 border border-dark-600/50
          text-dark-100 placeholder:text-dark-500
          text-lg transition-all duration-200
          hover:border-dark-500
          focus:border-kamas/50 focus:bg-dark-800 focus:shadow-lg focus:shadow-kamas/5"
      />
      {query.length > 0 && query.length < 2 && (
        <p className="absolute right-4 top-1/2 -translate-y-1/2 text-xs text-dark-500">
          Min. 2 caractères
        </p>
      )}
    </div>
  );
};

export default SearchBar;
