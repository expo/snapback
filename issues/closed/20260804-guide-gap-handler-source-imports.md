# Guide gap: the `{ source, exportName }` lane is documented as supporting imported helpers; it does not

**Status:** Resolved
**Impact:** 3
**Urgency:** 3
**Ease:** 5
**Confidence:** 5
**Systems:** Guide, Codegen, Authoring, Handlers
**Date:** 2026-08-04
**Governing:** LLP 0009, LLP 0061, LLP 0108, LLP 0118, LLP 0171, LLP 0174

## Problem

The guide describes the legacy `{ source, exportName }` handler lane as

> useful ... for logic that genuinely needs imported or sibling helpers

It is not. `loadHandlerSource()` reads **exactly one file**, and any
`ImportDeclaration` in it is `BUNDLE_UNSUPPORTED_IMPORT`. What the lane
actually buys is sibling *top-level functions in the same file*.

An agent that trusted the sentence would write `import { Chess } from
'chess.js'` into a handler and hit a codegen refusal with no indication that
the lane the guide recommended for this exact situation cannot help.

## What it cost

The chess build needed a third-party rules library. Establishing that the
documented lane could not deliver it required reading
`node_modules/@expo/snapback-codegen/index.mjs` — the **first place the arm
left the documentation to make progress** — at a cost of about 3 minutes. The
resolution was to esbuild-bundle `chess.js` into the handler as an IIFE and
then re-check the output against the banned forms by hand so failure would
occur at build time rather than at codegen. LLP 0174 later established that
this incident workaround is not a sanctioned authoring technique.

## Note on scope

The **constraint is defensible and is not what this issue disputes.** A handler
source being a closed single script is what makes its bytes hashable and
replayable, which is what makes determinism enforcement work at all. This issue
is that the guide describes the constraint backwards and therefore sends
authors toward a lane that cannot admit the imports it claims to support.

The larger third-party package-admission question remains open under LLP
0009/0108/0118/0174. It includes resolver, lockfile, dependency identity,
toolchain, bounds, and reproducibility decisions; this documentation fix does
not choose or recommend a bundling mechanism.

## Proposed fix

Correct the lane introduction to document only the shipped contract: a handler
source is one closed script, imports are refused with
`BUNDLE_UNSUPPORTED_IMPORT`, and same-file top-level functions are the supported
helper-sharing boundary. Do not prescribe pre-bundling as an escape hatch;
third-party package admission remains an open executable-supply-chain decision.

## Evidence

- `diaries/0057-chess-backend-bakeoff.diary.md` — "What felt bad or surprising",
  and item 3 of "Where I lost the most time"
- `packages/snapback-codegen/index.mjs` — `loadHandlerSource()` and the
  `BUNDLE_UNSUPPORTED_IMPORT` path
- `~/projects/chess-bakeoff/implementations/snapback/app/` — the bundled handler

## Resolution

Resolved 2026-08-05. The getting-started page now states that the legacy
`{ source, exportName }` form reads one closed script, supports same-file helper
functions, and refuses imports with `BUNDLE_UNSUPPORTED_IMPORT`; it explicitly
does not present pre-bundling or package admission as supported. The directly
adjacent queries and mutations pages were audited and corrected where they
implied the legacy form admitted imported helpers or multi-file graphs.
