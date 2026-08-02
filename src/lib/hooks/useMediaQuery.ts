'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * Reads a CSS media query from JS, for the cases where the two layouts are different
 * component trees rather than the same markup restyled — rendering both and hiding one
 * with `md:hidden` would duplicate their state.
 *
 * Reports `false` while rendering on the server, since there is no viewport to measure.
 */
export const useMediaQuery = (query: string) => {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    [query]
  );

  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false
  );
};
