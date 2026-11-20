import type { MapMarker, MapPalette } from './map-types';
import { roundedHeading } from './map-types';

/** Leaflet `divIcon` options for one marker kind. Used only by `LeafletCanvas`. */
export interface IconSpec {
  html: string;
  size: [number, number];
  anchor: [number, number];
}

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

// Feather glyphs (MIT), inlined so no image file is needed.
const HOME =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>';
const STORE =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l1.5-5h15L21 9"/><path d="M3 9h18v2a3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-6 0z"/><path d="M5 13v8h14v-8"/></svg>';
const ARROW =
  '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><polygon points="12 2 19 21 12 17 5 21 12 2"/></svg>';
const TRUCK =
  '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>';

const SHADOW = '0 2px 8px rgba(0,0,0,0.25)';

function badge(color: string, inner: string, palette: MapPalette, size: number, ring: boolean): string {
  const outer = size + 10;
  return (
    `<div style="width:${outer}px;height:${outer}px;border-radius:${outer / 2}px;background:${palette.surface};` +
    `box-shadow:${SHADOW};display:flex;align-items:center;justify-content:center;` +
    `${ring ? `outline:3px solid ${color};` : ''}">` +
    `<div style="width:${size}px;height:${size}px;border-radius:${size / 2}px;background:${color};color:${palette.surface};` +
    `display:flex;align-items:center;justify-content:center;font:600 12px/1 Poppins,system-ui,sans-serif">${inner}</div></div>`
  );
}

/** The HTML of one marker, drawn with the palette. `label` and `title` are escaped. */
export function iconFor(marker: MapMarker, palette: MapPalette): IconSpec {
  const color = palette[marker.tone ?? (marker.kind === 'store' ? 'warning' : 'brand')];
  const label = marker.label ? escapeHtml(marker.label.slice(0, 3)) : '';
  const ring = marker.highlighted === true;
  switch (marker.kind) {
    case 'site':
      return { html: badge(color, label || HOME, palette, 28, ring), size: [38, 38], anchor: [19, 19] };
    case 'store':
      return { html: badge(color, label || STORE, palette, 28, ring), size: [38, 38], anchor: [19, 19] };
    case 'stop':
      return { html: badge(color, label, palette, 24, ring), size: [34, 34], anchor: [17, 17] };
    case 'driver': {
      const heading = roundedHeading(marker.heading);
      const glyph =
        heading == null ? TRUCK : `<div style="display:flex;transform:rotate(${heading}deg)">${ARROW}</div>`;
      return {
        html:
          `<div style="position:relative;width:56px;height:56px;display:flex;align-items:center;justify-content:center">` +
          `<span class="is-map-pulse" style="position:absolute;inset:0;border-radius:28px;background:${color}"></span>` +
          `<span style="position:relative;box-sizing:border-box;width:36px;height:36px;border-radius:18px;background:${color};` +
          `border:3px solid ${palette.surface};box-shadow:${SHADOW};color:${palette.surface};display:flex;align-items:center;justify-content:center">${glyph}</span></div>`,
        size: [56, 56],
        anchor: [28, 28],
      };
    }
    case 'pin':
      return {
        html:
          `<svg width="34" height="46" viewBox="0 0 34 46" style="filter:drop-shadow(${SHADOW})">` +
          `<path d="M17 1C8.2 1 1 8.1 1 16.9 1 29 17 45 17 45s16-16 16-28.1C33 8.1 25.8 1 17 1z" fill="${color}" stroke="${palette.surface}" stroke-width="2"/>` +
          `<circle cx="17" cy="17" r="6" fill="${palette.surface}"/></svg>`,
        size: [34, 46],
        anchor: [17, 45],
      };
  }
}

/** The pulse animation of the driver marker; off when the device asks for reduced motion. */
export const MAP_CSS =
  '@keyframes isMapPulse{0%{transform:scale(.55);opacity:.5}100%{transform:scale(1.35);opacity:0}}' +
  '.is-map-pulse{animation:isMapPulse 1.8s ease-out infinite}' +
  '@media (prefers-reduced-motion: reduce){.is-map-pulse{animation:none;opacity:0}}' +
  '.leaflet-container{font-family:Poppins,system-ui,sans-serif}';

/** Only inside the native WebView, where the map is the whole page (never on Expo web). */
export const WEBVIEW_CSS = 'html,body,#root{margin:0;padding:0;height:100%;width:100%;overflow:hidden}';
