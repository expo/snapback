# LLP 0218 P6 — deprecation closure of the queued:true alias and SnapbackQueuedMutationError export

**Status:** Open (window-gated)
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
