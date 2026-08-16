# LLP 0218 P6 — deprecation closure of the queued:true alias and SnapbackQueuedMutationError export

**Status:** Closed (2026-08-15)
**Date:** 2026-08-10
**Systems:** Client integration, React arm
**Governing doc:** llp/0218-outbox-settlement-contract.rfc.md (Phases, P6; §4.5)

P1–P5 of LLP 0218 are implemented and landed (dispatch union, drain
controller, React contract, propagation + diagnostic, docs). P6 is the
only remaining phase and is deliberately window-gated: it runs **after
the deprecation window of the first release that carries the union**
(default: one release; the P6 closure audit may extend it — LLP 0218
open question 1).

When the window has elapsed, do exactly:

1. **Closure audit (the P6 proof):** post-release audit of caller
   absorption — confirm in-repo callers and any known external consumers
   narrow on `status` and no longer read the `queued: true` alias or
   import `SnapbackQueuedMutationError`. This is closure evidence; the
   §4.5 primary-vs-fallback trigger was P1's pre-publication audit
   (recorded in the LLP's Implementation notes) and is already settled
   (primary path).
2. Remove the `queued: true` alias from both headless queued return
   sites in `packages/snapback-client/index.mjs` (grep `queued: true`)
   and from `MutationDispatchOutcome` in `index.d.mts`, plus the React
   queued-branch stamp in `packages/snapback-react/implementation.mjs`
   (`queuedMutationOutcome`).
3. Delete the throw-site-free `SnapbackQueuedMutationError` export
   (class in `packages/snapback-react/implementation.mjs`, re-exports in
   `index.mjs`/`core.mjs`/`full-capabilities.mjs` and the `.d.mts`
   twins; Expo re-exports follow automatically).
4. Update the React arm's `output?.queued === true` compatibility check
   in `runMutation` (it exists only for skew tolerance during the
   window).
5. Sweep guide pages/capability rows for the alias mentions and land the
   LLP 0218 dated P6 note; run the full react/client suites,
   check-guide, check-inventories, ref-check, and a metrology check.

Blocked on: the first published release carrying the union (0.1.x
successor to the 2026-08-10 landings) plus its deprecation window.

## Resolution (2026-08-15)

The window elapsed: the union first shipped in **0.1.19** (2026-08-11;
verified against the published `@expo/snapback-client` tarballs — 0.1.17 and
0.1.18 predate it), the default one-release window closed at 0.1.20, and
0.1.22 was current at closure. All five runbook steps executed:

1. **Closure audit** — no live in-repo caller reads the `queued: true` alias
   or imports `SnapbackQueuedMutationError`; every remaining textual mention
   is frozen historical evidence (`demos/improvement-sweep` arms pinned to
   pre-union published versions, client-bundle-metrology rollover records) or
   an unrelated identifier (Contract's own durable-queue result,
   `queuedOnly`, `queuedMutationWedgeWarningMs`, scheduler flags), each
   individually justified during the audit. No known external consumers
   (LLP 0041 posture).
2. Alias removed from both headless queued return sites and
   `MutationDispatchOutcome`; the React `queuedMutationOutcome` stamp no
   longer emits it; the stale `offlineQueue` doc comment now shows the union.
3. `SnapbackQueuedMutationError` class and its `index`/`core` re-exports and
   `.d.mts` twins deleted (no `full-capabilities.mjs` site remained; Expo
   re-exports follow automatically). 27 authored `removedIn: 0.1.23`
   symbol-lifecycle facts added to `guide/reference/lifecycle.json`.
4. The three React skew-compat `output?.queued === true` disjuncts narrowed
   to `status === 'queued'`, plus Contract's `mutation-output.mjs` twin.
   Tests updated to the union shape; one regression assertion pins that a
   queued outcome has no `queued` own-property; no test deleted.
5. Guide sweep (headless + offline pages) landed with the regenerated
   manifest/reference/flat projections and the LLP 0218 dated P6 note
   (Status → Implemented). Proof: client suite 482 pass / 5 fail (the 5
   reproduced byte-identically at the base SHA — inherited, unrelated),
   react 40/0, contract 58/0, check-guide 18/18, check-inventories PASS,
   ref-check 0 errors. `client-bundle-metrology --check` is red at base too
   (inherited; the open subpath-publication pickup), verified under the
   pinned node 24.18.0 toolchain.
