/**
 * Leaflet divIcon factories. Icons are cached by their visual parameters so React re-renders
 * don't recreate DOM for every marker.
 */
import { initials } from '@instasupply/shared';
import L from 'leaflet';

const cache = new Map<string, L.DivIcon>();

function cached(key: string, create: () => L.DivIcon): L.DivIcon {
  let icon = cache.get(key);
  if (!icon) {
    icon = create();
    cache.set(key, icon);
  }
  return icon;
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

export function driverIcon(options: {
  name: string;
  color?: string;
  heading?: number | null;
  stale?: boolean;
  selected?: boolean;
  live?: boolean;
}): L.DivIcon {
  const color = options.color ?? '#4338ca';
  const heading = options.heading == null ? null : Math.round(options.heading / 10) * 10;
  const key = `driver|${options.name}|${color}|${heading}|${options.stale}|${options.selected}|${options.live}`;
  return cached(key, () =>
    L.divIcon({
      className: 'is-marker',
      iconSize: [36, 36],
      iconAnchor: [18, 18],
      popupAnchor: [0, -18],
      tooltipAnchor: [16, 0],
      html: `<div class="is-driver${options.stale ? ' is-driver--stale' : ''}${options.selected ? ' is-driver--selected' : ''}" style="--marker-color:${color}">
        ${options.live && !options.stale ? '<span class="is-driver__pulse"></span>' : ''}
        ${heading == null ? '' : `<span class="is-driver__heading" style="transform:rotate(${heading}deg)"></span>`}
        <span class="is-driver__body">${escapeHtml(initials(options.name))}</span>
      </div>`,
    }),
  );
}

export function stopIcon(options: { label: string; color: string; active?: boolean }): L.DivIcon {
  const key = `stop|${options.label}|${options.color}|${options.active}`;
  return cached(key, () =>
    L.divIcon({
      className: 'is-marker',
      iconSize: [30, 38],
      iconAnchor: [15, 38],
      popupAnchor: [0, -34],
      tooltipAnchor: [14, -22],
      html: `<div class="is-pin${options.active ? ' is-pin--active' : ''}" style="--marker-color:${options.color}">
        <div class="is-pin__head"><span class="is-pin__label">${escapeHtml(options.label)}</span></div>
      </div>`,
    }),
  );
}

export function destinationIcon(): L.DivIcon {
  return cached('destination', () =>
    L.divIcon({
      className: 'is-marker',
      iconSize: [34, 34],
      iconAnchor: [17, 17],
      html: `<div class="is-home"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20h14V9.5"/></svg></div>`,
    }),
  );
}

/** A store (supplier yard): storefront glyph on the tone colour. */
export function storeIcon(options: { color?: string; active?: boolean } = {}): L.DivIcon {
  const color = options.color ?? '#b45309';
  return cached(`store|${color}|${options.active}`, () =>
    L.divIcon({
      className: 'is-marker',
      iconSize: [34, 34],
      iconAnchor: [17, 17],
      tooltipAnchor: [16, 0],
      html: `<div class="is-home${options.active ? ' is-home--active' : ''}" style="background:${color}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9h18l-1.5-5h-15z"/><path d="M5 9v11h14V9"/><path d="M10 20v-6h4v6"/></svg></div>`,
    }),
  );
}
