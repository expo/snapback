# `check-package-export-types` rejects the sanctioned type-only `./ctx` subpath

**Status:** Open
**Impact:** 3
**Urgency:** 3
**Ease:** 4
**Confidence:** 5
**Systems:** Packaging, Tooling, CI
**Date:** 2026-08-09
**Found by:** the 0.1.16 release lane (`release/fastpath-0.1.16`) while
qualifying the publication
**Related:** LLP 0194 (generated API reference — the governing acceptance),
LLP 0041 (packaging),
[`20260806-export-types-nodejs-namespace-expo-dev-dmts.md`](./20260806-export-types-nodejs-namespace-expo-dev-dmts.md)
(the *other*, older cause of the same gate being red)

## Symptom

```
$ node scripts/check-package-export-types.mjs
[check-package-export-types] FAILED (1):
  - @expo/snapback-codegen ./ctx: no runtime condition (import/default/require)
```

`packages/snapback-codegen/package.json` declares

```json
"./ctx": { "types": "./ctx.d.mts" }
```

and `packages/snapback-codegen/ctx.d.mts` is deliberately a type-only
declaration module — its own header says so:

> `@ref LLP 0194#design` — this published type-only module is the single
> declaration owner for the handler context surface; generated app APIs only
> instantiate and re-export it.

It contains only `type` and `interface` declarations. There is no runtime value
to export, so there is nothing a runtime condition could point at.

## Why the gate is wrong here, not the package

LLP 0194 Acceptance item 1 sanctions exactly this shape:

> Registry/runtime export parity: value-space declared symbols must exist at
> runtime under their applicable export conditions, and every public runtime
> export must have a registry entry; **type-space-only symbols (hook fact
> types, contract interfaces) appear in the registry with an explicit
> non-runtime kind and are exempt from the runtime check.**

`scripts/check-package-export-types.mjs` has no notion of a type-only subpath:
its phase-1 static audit unconditionally requires a runtime condition
(`import`/`default`/`require`) for every subpath that declares `types`.

The published artifact itself is fine. `ctx.d.mts` is in the package `files`
allowlist, so `import type { ... } from '@expo/snapback-codegen/ctx'` resolves
for installed consumers; only a runtime `import` would fail, and there is no
runtime symbol to import. **This is a checker gap, not a published-bytes
defect** — which is why the 0.1.16 publication proceeded over it rather than
blocking on it.

## Lineage

Introduced 2026-08-08 by `dd4126140` ("feat(codegen): LLP 0194 OQ2 —
`@expo/snapback-codegen/ctx` published declaration source"), i.e. after the
0.1.15 cut. The gate has been red on every complete battery since, but note it
was **already** red before that for an unrelated reason — see the 2026-08-06
`NodeJS`-namespace ticket linked above. Fixing this one alone will not turn the
gate green; it will advance the failure into phase 2 (the consumer-fixture
compile / runtime-parity sweep), where `@expo/snapback-cli ./expo-dev` is
missing declarations for `admittedBrowserExchangeOrigin` and
`startBootstrapExchange`. Both causes must be closed for `package-export-types`
to go green.

## Proposed repair

Teach the phase-1 static audit to admit a declared type-only subpath, deriving
the admission from the declaration file rather than from an allowlist:

1. A subpath declaring `types` and no runtime condition is admitted **only if**
   the declaration file exists, is covered by the publish `files` allowlist,
   and exposes no value-space exports. Determine "no value-space exports" with
   the TypeScript checker (`getExportsOfModule`, resolving aliases, treating
   `SymbolFlags.Value` minus `ConstEnum` as value-space) plus an explicit
   rejection of `export default <value>` and `export =`. Do not pattern-match
   the source text, and do not special-case the package or subpath name.
2. A `types`-only subpath whose declaration *does* carry value-space exports
   must still fail, with a message naming the offending symbols.
3. Admitted type-only subpaths must be excluded from the phase-2 sweep, which
   assumes every entry has a `runtimeFile`.
4. Log each admission so it is visible rather than silent.
5. Every existing failure mode must keep failing: missing `types`, `types` not
   first, a non-declaration `types` target, a missing types or runtime file, and
   `files`-allowlist gaps for either target.

A working implementation of exactly this was produced and hand-verified during
the 0.1.16 release lane (it correctly admits `./ctx` and then surfaces the
pre-existing `./expo-dev` phase-2 failure). It was deliberately **not** landed
with the release: it changes a gate's semantics, it does not change the release
outcome, and a checker relaxation deserves its own review rather than riding a
publication. Re-deriving it from the five points above is a short job.

## Done when

- `node scripts/check-package-export-types.mjs` admits `@expo/snapback-codegen
  ./ctx` as type-only and reports the admission.
- A regression case covers both directions: a type-only declaration is admitted,
  and a `types`-only subpath whose declaration exports a runtime value is
  rejected.
- The remaining `package-export-types` failure is only the one tracked by
  `20260806-export-types-nodejs-namespace-expo-dev-dmts.md`.
