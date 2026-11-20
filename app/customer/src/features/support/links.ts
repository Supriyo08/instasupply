import type { SupportContext } from '@instasupply/shared';
import type { Href } from 'expo-router';

const KINDS: readonly SupportContext['kind'][] = ['order', 'store_order', 'quote', 'issue'];

/** The support chat, with a context chip ("About IS-10042") when opened from an order, quote or case. */
export function supportHref(context?: SupportContext | null): Href {
  if (!context) return '/support';
  return { pathname: '/support', params: { kind: context.kind, id: context.id, label: context.label } };
}

/** The context a support link carries, read back from the route params. */
export function contextFromParams(params: {
  kind?: string | string[];
  id?: string | string[];
  label?: string | string[];
}): SupportContext | null {
  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  const kind = first(params.kind);
  const id = first(params.id);
  const label = first(params.label);
  if (!kind || !id || !label || !KINDS.includes(kind as SupportContext['kind'])) return null;
  return { kind: kind as SupportContext['kind'], id, label };
}
