# Snapback brand assets

The Snapback logo is a wordmark over a toggle-switch mark: a two-eyed track that
has just *snapped back* to its knob. It is monochrome by design — it reads as
solid ink on light surfaces and as a clean photo-negative on dark ones.

All artwork here is derived from the original source in
[`source/`](./source/snapback-logo-original.png). The vector mark
([`snapback-mark.svg`](./snapback-mark.svg)) is the canonical master; regenerate
the rasters from it (or from the source) rather than editing PNGs by hand.

## Files

| File | Use |
| --- | --- |
| `snapback-mark.svg` | Canonical vector mark. Pills use `currentColor`; eyes and knob are knockouts, so it works on any background. |
| `favicon.svg` | Square, theme-adaptive favicon (`prefers-color-scheme` switches ink/white). Preferred favicon for modern browsers. |
| `favicon.ico` | 16/32/48/64 multi-resolution fallback (mark on a white tile, visible on light and dark browser chrome). |
| `favicon-16.png`, `favicon-32.png` | Explicit small PNG favicons. |
| `apple-touch-icon.png` | 180×180 iOS home-screen icon (opaque white field; iOS applies its own corner mask). |
| `icon-192.png`, `icon-512.png` | PWA / Android icons with a generous safe zone. |
| `icon-512-dark.png` | App-icon tile: white mark on near-black, for places that want a dark badge. |
| `snapback-logo.png` | Full lockup (wordmark + mark), ink on transparent. For light backgrounds. |
| `snapback-logo-dark.png` | Full lockup, white on transparent. For dark backgrounds. |
| `snapback-mark.png` / `snapback-mark-dark.png` | Square mark only, 512px, transparent. |

## Usage

- **Light vs dark.** Use the `-dark` variants (white artwork) on dark surfaces.
  In HTML, prefer `<picture>` with a `prefers-color-scheme: dark` source; the
  README does this.
- **Color.** Ink is `#111111`; the negative is `#ffffff`. Keep the mark
  monochrome — don't recolor the pills.
- **Clear space.** Keep padding around the lockup at least the height of the
  knob. The exported assets already include sensible margins.
- **Favicons in HTML.** A minimal, robust set:

  ```html
  <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
  <link rel="icon" href="/favicon.ico" sizes="any" />
  <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
  ```

## Regenerating

The rasters are produced from the source artwork / vector master with Pillow and
headless Chrome (for SVG rasterization). The mark geometry — pill radii, the
concave gap that hugs the left track, the ring eyes, and the knob — was traced
from the source and lives in `snapback-mark.svg`. When the mark changes, update
the SVG first and re-export the PNG/ICO set from it.
