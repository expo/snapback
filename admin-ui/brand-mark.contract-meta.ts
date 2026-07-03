// Contract import descriptor for the admin console's brand mark.
//
// The admin `.contract` `use`s `snapbackMark` from `./brand-mark.ts` inside a
// pure context (`image svgSource=snapbackMark(c.markInk)`). Declaring it `pure`
// gives the Vite plugin a clean named import instead of the opaque
// `import * as ns` + `ns.default` fallback, removing the compiler's
// opaque-import warning and esbuild's `IMPORT_IS_UNDEFINED` warning (brand-mark.ts
// has no default export). See theme.contract-meta.ts for the fuller rationale;
// `result` is omitted for the same reason (no behavior/type-coverage change).

import { defineContractModule, pure } from '@exact/contract/exports';

export default defineContractModule('./brand-mark.ts', {
  snapbackMark: pure({ params: ['ink'], depends: 'args' }),
});
