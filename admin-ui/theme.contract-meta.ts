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
// reads stay exactly as unchecked as they were under the opaque import. This is
// a warning-only cleanup, not a behavior or type-coverage change.

import { defineContractModule, pure } from '@exact/contract/exports';

export default defineContractModule('./theme.ts', {
  colors: pure({ params: ['mode'], depends: 'args' }),
  fonts: pure({ params: [], depends: 'args' }),
  navSections: pure({ params: [], depends: 'args' }),
  initialTab: pure({ params: [], depends: 'args' }),
  initialTheme: pure({ params: [], depends: 'args' }),
});
