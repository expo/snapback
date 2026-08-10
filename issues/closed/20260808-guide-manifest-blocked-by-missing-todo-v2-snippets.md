# Guide manifest cannot regenerate: two snippets point at deleted sources

**Status:** Resolved 2026-08-10
**Impact:** 3
**Urgency:** 3
**Ease:** 4
**Confidence:** 5
**Systems:** Guide, Testing
**Date:** 2026-08-08
**Related:** LLP 0061 (guide governance), LLP 0189 (cadence and claim gating),
`issues/20260803-wave3-program.md` (named as a non-blocking red gate in the
wave 3 closing record)

## Summary

`node scripts/check-guide.mjs` fails on `main`
(`guide/guide-manifest.generated.json: stale or missing`), and the sanctioned
regeneration refuses to repair it:

```
[guide-manifest] error: guide/clients/contract-adapter.md:46: snippet source does not exist:
  demos/todo-v2/snapback/generated/contract/setCompleted.mjs
[guide-manifest] error: guide/clients/contract-adapter.md:55: snippet source does not exist:
  demos/todo-v2/snapback/generated/contract/runtime-links.ts
[guide-manifest] refusing to write a manifest over a failing corpus
```

`guide/clients/contract-adapter.md` cites two generated contract files under
`demos/todo-v2` that no longer exist. The refusal is correct — the generator
will not write a manifest over a corpus whose snippets do not resolve — but it
means the guide gate cannot be cleared mechanically.

## Fix

Repoint both snippets at the current generated-contract location (or the demo
that now carries that surface), then regenerate. This is a guide edit, not a
record refresh, which is why it is filed rather than fixed inline.

Note the ordering trap: the manifest generator refuses while any snippet
drifts, so the drifted excerpt must be fixed in the same change that
regenerates the manifest.

## Status against the wave 3 close

Named as a non-blocking red gate in the wave 3 closing record under LLP 0189
D-6: it is not claim-relevant to any wave 3 claim, and it is ticketed rather
than blocking the close.

## Resolution — 2026-08-10

Overtaken and now verified clear. The line-46 `setCompleted.mjs` citation
was already repointed by an earlier landing (the page now cites
`setCompleted.mutation.ts`), and `runtime-links.ts` is not a deleted source
— it is Exact/Contract-generated output that a fresh checkout must
materialize via the documented exact-todo-v2 install/contract jobs (the
generator's refusal message now says exactly this). After materialization,
`generate-guide-manifest.mjs` regenerates cleanly and `check-guide.mjs` is
green (115 pages / 1198 snippets). Manifest reconciled in this landing.
