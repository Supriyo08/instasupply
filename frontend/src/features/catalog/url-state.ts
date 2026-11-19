import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';

import { parseSort, parseStatus, type SortKey, type StatusFilter } from './catalog-filters';

export type CatalogTab = 'products' | 'categories';

export interface CatalogParams {
  tab: CatalogTab;
  q: string;
  category: string;
  status: StatusFilter;
  sort: SortKey;
}

export type ProductFilters = Omit<CatalogParams, 'tab'>;

function readParams(params: URLSearchParams): CatalogParams {
  return {
    tab: params.get('tab') === 'categories' ? 'categories' : 'products',
    q: params.get('q') ?? '',
    category: params.get('category') ?? '',
    status: parseStatus(params.get('status')),
    sort: parseSort(params.get('sort')),
  };
}

/** Write the catalogue state onto `base`, omitting defaults and keeping unrelated parameters. */
function writeParams(base: URLSearchParams, state: CatalogParams): URLSearchParams {
  const next = new URLSearchParams(base);
  const entries: [string, string | null][] = [
    ['tab', state.tab === 'products' ? null : state.tab],
    ['q', state.q || null],
    ['category', state.category || null],
    ['status', state.status === 'all' ? null : state.status],
    ['sort', state.sort === 'name' ? null : state.sort],
  ];
  for (const [key, value] of entries) {
    if (value) next.set(key, value);
    else next.delete(key);
  }
  return next;
}

const keyOf = (state: CatalogParams) => writeParams(new URLSearchParams(), state).toString();

const DEFAULTS = readParams(new URLSearchParams());

/**
 * Link to a catalogue view, written exactly as this page reads it, so other screens (the dashboard)
 * can't drift from it: `catalogHref({ status: 'low', q: 'Mango' })` → "/catalog?q=Mango&status=low".
 */
export function catalogHref(view: Partial<CatalogParams> = {}): string {
  const search = keyOf({ ...DEFAULTS, ...view });
  return search ? `/catalog?${search}` : '/catalog';
}

const URL_DELAY_MS = 250;

/**
 * Catalogue tab, search and filters, mirrored to the URL (?tab, ?q, ?category, ?status, ?sort) so a
 * view can be linked (build links with `catalogHref`) and survives a reload. Controls read
 * local state, so typing never waits for a navigation; the URL follows after a short pause, written
 * in one place so quick successive changes can't overwrite each other.
 */
export function useCatalogParams() {
  const [params, setParams] = useSearchParams();
  const urlKey = keyOf(readParams(params));
  const [state, setState] = useState(() => readParams(params));
  const written = useRef(urlKey);

  // The URL changed from outside (a link, back/forward): adopt it.
  useEffect(() => {
    if (urlKey === written.current) return;
    written.current = urlKey;
    setState(readParams(new URLSearchParams(urlKey)));
  }, [urlKey]);

  // Local changes reach the URL once the user pauses.
  useEffect(() => {
    const key = keyOf(state);
    if (key === written.current) return;
    const timer = window.setTimeout(() => {
      written.current = key;
      setParams((current) => writeParams(current, state), { replace: true });
    }, URL_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [setParams, state]);

  const update = useCallback(
    (patch: Partial<CatalogParams>) => setState((current) => ({ ...current, ...patch })),
    [],
  );

  return { params: state, update };
}
