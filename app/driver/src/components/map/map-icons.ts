/** HTML for the marker kinds (Leaflet `divIcon`), drawn with the palette; no image files (§7.3). */
import type { MapMarker, MapTone } from './map-types';

export type MapPalette = Record<MapTone, string> & { surface: string; text: string };

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const STORE_GLYPH =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M4 4h16l1 5a3 3 0 0 1-5 2.2A3 3 0 0 1 12 12a3 3 0 0 1-4-.8A3 3 0 0 1 3 9l1-5zm1 9.5V20h5v-4h4v4h5v-6.5a4.9 4.9 0 0 1-3-.4 4.9 4.9 0 0 1-4 .9 4.9 4.9 0 0 1-4-.9 4.9 4.9 0 0 1-3 .4z"/></svg>';
const SITE_GLYPH =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 3 2 11h3v9h5v-6h4v6h5v-9h3z"/></svg>';
const ARROW_GLYPH =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 2 4.5 20.3l.7.7L12 18l6.8 3 .7-.7z"/></svg>';

export interface MarkerIcon {
  html: string;
  size: [number, number];
  anchor: [number, number];
}

/** The icon of one marker. `label` and `title` are escaped here. */
export function markerIcon(marker: MapMarker, palette: MapPalette): MarkerIcon {
  const tone = palette[marker.tone ?? (marker.kind === 'driver' ? 'brand' : 'neutral')];
  const ring = marker.highlighted ? `box-shadow:0 0 0 4px ${tone}55;` : '';
  const title = marker.title ? ` title="${escapeHtml(marker.title)}"` : '';
  const label = escapeHtml((marker.label ?? '').slice(0, 3));
  const disc = (size: number, inner: string) =>
    `<div${title} style="width:${size}px;height:${size}px;border-radius:50%;background:${tone};color:${palette.surface};` +
    `border:2px solid ${palette.surface};display:flex;align-items:center;justify-content:center;` +
    `font:700 12px/1 system-ui,sans-serif;${ring}box-sizing:border-box;">${inner}</div>`;
  switch (marker.kind) {
    case 'store':
      return { html: disc(32, STORE_GLYPH), size: [32, 32], anchor: [16, 16] };
    case 'site':
      return { html: disc(32, SITE_GLYPH), size: [32, 32], anchor: [16, 16] };
    case 'stop':
      return { html: disc(marker.highlighted ? 32 : 28, label), size: [32, 32], anchor: [16, 16] };
    case 'driver': {
      const heading = marker.heading == null ? null : Math.round(marker.heading / 5) * 5;
      const arrow =
        heading === null
          ? `<div style="width:12px;height:12px;border-radius:50%;background:${palette.surface};"></div>`
          : `<div style="transform:rotate(${heading}deg);display:flex;">${ARROW_GLYPH}</div>`;
      const html =
        `<div${title} class="is-driver" style="position:relative;width:36px;height:36px;">` +
        `<div class="is-pulse" style="position:absolute;inset:0;border-radius:50%;background:${tone}33;"></div>` +
        `<div style="position:absolute;inset:6px;border-radius:50%;background:${tone};color:${palette.surface};` +
        `border:2px solid ${palette.surface};display:flex;align-items:center;justify-content:center;box-sizing:border-box;">${arrow}</div></div>`;
      return { html, size: [36, 36], anchor: [18, 18] };
    }
    case 'pin':
    default: {
      const html =
        `<div${title} style="width:28px;height:28px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);` +
        `background:${tone};border:2px solid ${palette.surface};box-sizing:border-box;"></div>`;
      return { html, size: [28, 36], anchor: [14, 34] };
    }
  }
}

/** CSS for the pulsing driver marker, added once to the page. */
export const MAP_CSS =
  '@keyframes is-pulse{0%{transform:scale(.6);opacity:.9}100%{transform:scale(1.5);opacity:0}}' +
  '.is-pulse{animation:is-pulse 1.8s ease-out infinite}' +
  '.leaflet-div-icon.is-marker{background:transparent;border:0}' +
  '.leaflet-container{background:#d9dde6;font-family:system-ui,sans-serif}';
