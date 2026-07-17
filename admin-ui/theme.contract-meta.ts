// Contract import descriptors for the admin console's design-system helpers.
//
// The admin `.contract` `use`s these from `./theme.ts` in pure contexts (state
// initializers and derives). Without declared descriptors the Contract compiler
// treats each `use` as an opaque import, which (1) emits a "pure context calls
// opaque import" warning per call site and (2) makes the Vite plugin fall back
// to a `import * as ns` + `ns.default` shape, so esbuild/rolldown warns
// `IMPORT_IS_UNDEFINED` because theme.ts has no default export. Declaring them
// `pure` gives the plugin a clean named import (no default access) and silences
// both warning classes — the same pattern the demos use in their
// `data.contract-meta.ts` sidecars.
//
// `result` is intentionally omitted: with no declared result the compiler does
// not row-shape-check member access on the returned value, so `c.<field>`
// reads stay exactly as unchecked as they were under the opaque import.
// Dependencies are nevertheless explicit: `colors` selects between the two
// module-owned palettes, while `initialTab` reads the web host's location and
// URI decoder when they exist and falls back for native-capable hosts where
// location does not.

import { capability, defineContractModule, pure } from '@exact/contract/exports';

export default defineContractModule('./theme.ts', {
  colors: pure({ params: ['mode'], depends: ['LIGHT', 'DARK'] }),
  fonts: pure({ params: [], depends: 'args' }),
  navSections: pure({ params: [], depends: 'args' }),
  initialTab: pure({ params: [], depends: ['location', 'decodeURIComponent'] }),
  systemTheme: pure({ params: [], depends: ['globalThis', 'matchMedia'] }),
  watchSystemTheme: capability({
    params: { listener: { type: 'function' } },
    effects: ['theme.scheme.read', 'theme.store.subscribe'],
  }),
});
