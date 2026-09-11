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

## 2026-09-11 triage

**Priority:** P2. **Disposition:** Open and reproduced; this remains a silent
green path.

`project.ts::compileJourneys` still maps only `snapback2/client`,
`snapback2/test`, and `snapback2/internal`, while generated
`quarry/bound-api.ts` declarations import `Page`, `Money`, `Principal`, and
other roots from `snapback2`. It still filters `ts.getPreEmitDiagnostics` to
the authored journey `sourceSet`, discarding diagnostics from the staged
`.api-*.d.ts`.

A temporary 2026-09-11 Bun probe created no `node_modules/snapback2`, staged an
API containing `Op<{}, Page<{ id: string }>>`, and compiled a journey using
`!("data" in after) || !after.data.some(...)`. The exact command
`bun test src/triage-compiler-probe.test.ts` passed with
`compileJourneys(...).ok === true`; the probe also pinned the independent seed
and text-`+` results and was removed after the run. By contrast, the maintained
`api-shape-checks.ts::template journeys resolve real API types and expose
optional partial data` installs the real root declarations and expects the
unprotected `.some` spelling to fail because `after.data` can be undefined.

Repeat from `snapback2/packages/compiler` at baseline `15c134d056` with Bun
1.3.14 on macOS: create a temporary test beside `project.ts`, import
`compileJourneys`, make a fresh temp root with only this journey (no
`node_modules`), and run `bun test src/triage-compiler-probe.test.ts`:

```ts
await writeFile(join(root, "snapback/tests/probe.test.ts"), `
  import { api } from "snapback2/client";
  import { journey } from "snapback2/test";
  journey("probe", async ({ as }) => {
    const after = await as("alice").query(api.probe.list, {});
    if (!("data" in after) || !after.data.some((row: { id?: string }) => row.id)) throw Error();
  });`);
const apiDts = `import type { Page } from "snapback2";
  import type { Op } from "snapback2/client";
  declare module "snapback2/client" { interface Api {
    readonly probe: { readonly list: Op<{}, Page<{ id: string }>> };
  } } export {};`;
expect((await compileJourneys(root, apiDts)).ok).toBe(true);
```

**Remaining acceptance:** make unresolved imports used by the staged API a
hard `E_OP_INVALID` (or map the package root to the complete maintained
declarations), keep real package types in every harness, and add a regression
that would pass only if a generated root type degraded to `any`.

## Resolution — 2026-09-11

**Status:** Closed. `compileJourneys` now maps the `snapback2` package root to
the SDK's complete maintained `dist/index.d.ts`, alongside its existing client,
test, and internal declaration mappings. Generated `Page`, `Money`,
`Principal`, and other public root imports therefore resolve even when a
scratch project has no `node_modules/snapback2` install.

`journey checking binds generated root types without a consumer install`
creates exactly that scratch-project condition and leaves a `Page` result's
partial `data` unguarded. It is accepted only if `Page` degrades to `any`; the
permanent check now requires the meaningful `E_OP_INVALID` optional-data
refusal. The existing installed-declaration template checks remain the
consumer-side proof.
