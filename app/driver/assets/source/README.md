# Icon sources

The PNG app icons in `assets/` are exported from these SVGs (1024 × 1024 artboards):

| Export | Source | Size |
| --- | --- | --- |
| `icon.png` | `icon.svg` | 1024, opaque |
| `android-icon-background.png` | `android-icon-background.svg` | 512, opaque |
| `android-icon-foreground.png` | `android-icon-foreground.svg` | 512, transparent |
| `android-icon-monochrome.png` | `monochrome.svg` | 432, transparent |
| `splash-icon.png` | `glyph-white.svg` | 1024, transparent |
| `notification-icon.png` | `glyph-white.svg` | 96, transparent, white only |
| `favicon.png` | `icon.svg` with rounded corners | 48 |

Re-export with any SVG rasteriser (Figma, Inkscape, `rsvg-convert`, resvg) at the sizes above.
