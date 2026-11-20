import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

const MAX_RECENT = 8;
const MAX_LENGTH = 60;
/** Per account, so a shared device never shows one shopper's searches to another. */
const storageKey = (uid: string) => `instasupply.recent-searches.v1:${uid}`;

const normalize = (term: string) => term.trim().replace(/\s+/g, ' ').slice(0, MAX_LENGTH);
const sameTerm = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Newest first, case-insensitively unique, capped at MAX_RECENT. */
function merge(first: readonly string[], second: readonly string[]): string[] {
  const merged: string[] = [];
  for (const term of [...first, ...second]) {
    if (term && !merged.some((existing) => sameTerm(existing, term))) merged.push(term);
  }
  return merged.slice(0, MAX_RECENT);
}

function parse(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return merge(value.filter((item): item is string => typeof item === 'string').map(normalize), []);
  } catch {
    return [];
  }
}

/** Search history kept on the device (AsyncStorage; localStorage on the web). */
export function useRecentSearches(uid: string) {
  const key = storageKey(uid);
  const [items, setItems] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(key)
      // Keep anything added while storage was still loading.
      .then((raw) => {
        if (active) setItems((current) => merge(current, parse(raw)));
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, [key]);

  useEffect(() => {
    if (loaded) void AsyncStorage.setItem(key, JSON.stringify(items)).catch(() => undefined);
  }, [items, key, loaded]);

  const add = useCallback((term: string) => {
    const clean = normalize(term);
    if (clean.length < 2) return;
    // Unchanged when it is already the newest entry (called on every touch of the results).
    setItems((current) => (current[0] && sameTerm(current[0], clean) ? current : merge([clean], current)));
  }, []);

  const remove = useCallback(
    (term: string) => setItems((current) => current.filter((item) => !sameTerm(item, term))),
    [],
  );

  const clear = useCallback(() => setItems([]), []);

  return { items, loaded, add, remove, clear };
}
