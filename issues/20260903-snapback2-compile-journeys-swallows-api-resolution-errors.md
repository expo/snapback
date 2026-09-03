# snapback2: `compileJourneys` compiles journeys against `any` when `snapback2` types cannot resolve

**Opened:** 2026-09-03 (api-shapes lane, blind review finding MEDIUM-1)
**Area:** `snapback2/packages/compiler/src/project.ts` (`compileJourneys`)

`compileJourneys` maps only `snapback2/client` and `snapback2/test` through
`paths` and filters diagnostics to the journey files, so when the staged
`api.d.ts`'s `import type { Page, Money, Principal } from "snapback2"` cannot
resolve (no `node_modules/snapback2` in the scratch project), every such type
becomes `any` silently and a journey that is wrong against the real types
passes. Observed: the chat template's `after.data.some(...)` typechecks in
the compiler's own harness but is refused (`'after.data' is possibly
'undefined'`) the moment the real declarations resolve. This is the
silent-degradation class: a check that degrades to a weaker check and still
reports green.

Fix: make an unresolved `snapback2` import in a staged `api.d.ts` a hard
refusal in `compileJourneys` (report the resolution diagnostic instead of
filtering it out), and give the compiler's own test harnesses the
`node_modules/snapback2` stub so they exercise the real types. Pin with a
journey that only fails when `Page`/brands resolve.
