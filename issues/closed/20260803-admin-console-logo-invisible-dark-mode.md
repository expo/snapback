# Admin console Snapback logo is nearly invisible in dark mode

**Status:** Resolved (2026-08-03)
**Opened:** 2026-08-03

## Problem

In the Snapback admin console's dark color scheme, the graphic mark to the
left of the “Snapback / Admin Console” wordmark uses a color that is too close
to the sidebar background. The mark is nearly invisible, while the adjacent
wordmark and navigation remain legible.

This weakens the console branding and makes the header look as though space was
reserved for a missing or unloaded asset.

## Reproduction

1. Open the Snapback admin console.
2. Enable or inherit dark mode.
3. Inspect the brand header at the upper left of the sidebar.

Observed: the graphic mark has insufficient contrast against the dark sidebar.

Expected: the complete Snapback logo, including the graphic mark, is clearly
visible in dark mode and visually balanced with the wordmark.

## Acceptance

- Give the graphic mark sufficient contrast against the sidebar in dark mode.
- Preserve the intended appearance and contrast in light mode.
- Verify the header in both color schemes and across the sidebar states the
  admin console supports.

## Resolution (2026-08-03)

The mark was never a wrong color — the console was serving the wrong asset. The
sidebar renders it as a themed image
(`image lightSrc=… darkSrc=…` in `admin-ui/app.contract`), and the Contract
renderer chooses between those two sources from the document root's scheme
attribute, not from `prefers-color-scheme` (`getRuntimeImageColorScheme`,
`@exact/renderer`). Nothing published that attribute: the console resolves its
own scheme in `admin-ui/theme.ts` and threads the palette through the view as
inline styles, which themes text and surfaces but says nothing to the renderer.
With no attribute the renderer falls back to `light`, so dark mode kept
`snapback-mark-light.svg` — ink `#16181d` on the `#131419` sidebar, 1.04:1. The wordmark next to it flipped correctly because it is text taking
`c.text`, which is why the header looked like a missing asset rather than a
theming bug. (The console has shipped this way since the mark moved from an
inline `svgSource` to served assets to satisfy Trusted Types.)

Fix: publish the resolved scheme where the renderer looks.

- `admin-ui/theme.ts` — new `applyDocumentColorScheme(mode)` sets
  `data-scheme` (the twin of `EXACT_SCHEME_ATTRIBUTE` in
  `@exact/facet-core/static-scheme`; the console stays facet-free) plus
  `style.colorScheme` on the document root, and converges any themed image
  already mounted from its `data-light-src`/`data-dark-src`, so the mark is
  right whether the publish lands before or after the palette re-render.
  No-ops on hosts without a document.
- `admin-ui/main.ts` — publishes the scheme at boot, before the first mount,
  and keeps it published through `watchSystemTheme`.
- `admin-ui/brand-mark.ts` — corrected the header note that still claimed the
  console inked this module's SVG with `c.markInk`.
- `admin-ui/tests/brand-mark-theme.mjs` (new, in `bun run --cwd admin-ui test`)
  — locks the whole chain: the contract declares both sources, each asset
  clears 3:1 against its own sidebar (WCAG 1.4.11), the publisher writes the
  attribute and swaps a mounted image, and the boot entry publishes before it
  mounts.

Verified against the real binary over the built dist in headless Chrome with
`prefers-color-scheme` emulated. Before: `snapback-mark-light.svg` in all four
states. After: light load → light asset, dark load → dark asset, live flips in
both directions → matching asset, and the mark holds after a tab navigation
re-render. Header screenshots in both schemes show the mark legible on dark
(`#e8eaf0` on `#131419`, 15.29:1) and unchanged on light (17.76:1). The sidebar
has one state — a fixed 248px column, no collapse — and it is the console's only
themed image. `./ref-check --verbose` clean; `bun run --cwd admin-ui test`
green.
