# Live query silently blanks past the 1,024-row implicit ceiling: bound refusal during reevaluation is delivered as an anonymous quarantine (LLP 0317 O14 shape d / O35 live-query half)

**Status:** Resolved pending landing
**Opened:** 2026-08-28
**Owner:** LLP 0317.000 lane L19 (live-query invalidation fix); this ticket is its charter
**Systems:** Live queries, Authorization invalidation, Client SDK, React bindings, Wire v1, Guide
**Source:** LLP 0317.000 Wave 1 lane L1 verdict, r2.4 (`f3c09fcb0`); Clique 0.1.29 matrix
`grok-snapback-explicit` M3 ("an unscoped `allMessages` live query went silent on a
179-row thread") and `sol-snapback-explicit` M5 ("nested or custom live-query
dependencies remained stale while direct row queries converged")
**Related:** LLP 0317 O14 / O35 / O10-ceiling, LLP 0317.000 L1 → L19, LLP 0053
(dispositions — the `quarantine` producer row "every untyped re-query error"),
LLP 0200 §2.4, LLP 0093 D1 (optional envelope fields are wire-v1 compatible),
`guide/backend/queries.md` "Bound every collection intentionally",
`guide/realtime/live-queries.md` "What arrives",
`demos/_kit/tests/live-query-invalidation-e2e.mjs` shape (d),
`issues/20260809-sustained-reprojection-hints-still-quarantine.md` (adjacent:
delivery-independent quarantines under load)

## Confirmed mechanism (10/10, macOS arm64 headless, clean `4d4ce40bd` runtime)

1. A live subscription on a query with no explicit `.take(n)` is established at
   1,023 rows and holds them.
2. A commit takes the table to 1,025 rows. Reevaluating the subscription reruns
   the unbounded `collect()`, which hits the implicit ceiling and returns the
   **typed, deterministic** refusal `SNAPBACK_QUERY_IMPLICIT_LIMIT_REACHED`
   (documented contract: the runtime cannot prove whether 1,024 rows are complete
   or a truncated prefix).
3. `fail_subscription_fanout_with_retry`
   (`crates/snapback-engine/src/local/engine.rs`) treats every non-permission
   error identically. For an auth-scoped subscription it raises a `Quarantine`
   obligation (`reason: "error:{cause}"`) and enqueues
   `LiveEnvelope::AuthorizationInvalidation { snapshot: None, .. }`; for a plain
   subscription it enqueues `ResyncRequired { reason, clear_retained: true }`.
   The diagnostic itself is only recorded in server-attached diagnostics.
4. The client applies the obligation through `commitAuthorizationBoundary`
   (`packages/snapback-client/index.mjs`) as `authorization_quarantine`: rows are
   replaced with a blank carrier and the application is told nothing about why.
   No successor snapshot can ever arrive — the same query fails the same way on
   every retry — so the subscription stays blank until the process dies.

The harness records this as `O14_D_IMPLICIT_LIMIT_SILENCE_CONFIRMED`: original
subscription id/version/socket unchanged, no `resubscribed` event, no successor
snapshot, `handle.rows.length === 0`, while a bounded `latestMessage` query saw
row 1,025 and a fresh unbounded query returned the implicit-limit diagnostic.

## Why this is a defect and not the documented boundary

The ceiling itself is by design (`guide/backend/queries.md`). What is wrong is
the delivery: a typed refusal with a known repair (`declare .take(n)` or narrow
the predicate) reaches the subscriber as an anonymous authorization quarantine.
That is the silent-degradation class LLP 0317.000 P5 names — nothing is
emitted, so nothing can be looked up — and it is exactly the shape the matrix
lanes reported as "the live query went silent" and then spent hours attributing
to fanout. LLP 0053 requires the fail-closed disposition; it does not require
the client to be kept ignorant of a deterministic cause, and it never intended
bounded retries to be spent on an error that cannot change.

This is **not** the shared-`storagePartition` harness artifact (that explanation
was withdrawn in LLP 0317 r2) and it is not a matcher miss.

## Required fix shape

Stay inside LLP 0053's closed disposition enumeration; change what the frame
carries and what the client surfaces, not whether it blanks.

1. **Server.** Classify deterministic query-contract refusals raised during
   reevaluation — `SNAPBACK_QUERY_IMPLICIT_LIMIT_REACHED` first; the other
   `SNAPBACK_QUERY_*_EXCEEDED` bound refusals only if they can actually arise on
   the reevaluation path and are provably deterministic for the same
   `(function, args, data)`. For that class: keep the fail-closed disposition
   (`Quarantine` for auth-scoped, `resync_required` for plain), **do not open or
   consume a bounded retry episode**, and carry the typed refusal on the wire as
   an **additive optional field on the `LiveEnvelope` variant** (compatible
   within wire v1 per LLP 0093 D1). Never add a field to a
   `deny_unknown_fields` struct (`ResyncObligation`, `ResolutionTicket`): that
   breaks every deployed decoder. The refusal names the code, the subscription
   and function, the bound that was hit, and the repair.
2. **Client.** Rows still blank (unchanged LLP 0053 semantics). The
   `authorization_quarantine` update's `meta` carries the refusal; the handle
   exposes it (frozen `snapback.client-diagnostic.v1` shape, cleared by the next
   authoritative snapshot); a refusal-tagged `resync_required` must not start a
   futile re-snapshot loop and surfaces the same way; one qualified
   `console.warn` per subscription names the code and the repair.
3. **React.** `useSnapbackQuery` exposes the refusal so a component cannot
   render an empty list without being able to say why.
4. **Harness.** `demos/_kit/tests/live-query-invalidation-e2e.mjs` shape (d)
   past-ceiling arm passes only when the still-attached original subscription
   receives the typed refusal inside the delivery deadline; the current
   "silence confirmed" outcome remains its failure diagnostic. It must fail on a
   pre-fix binary and pass 10/10 on a post-fix binary.
5. **Docs.** Guide route from the words the lanes typed ("live query went
   silent", "blank", "large thread") to `.take(n)`; LLP 0053 dated amendment;
   LLP 0317 O14/O35 rows updated with the closure evidence.

## Acceptance

- Engine test: reevaluation past the ceiling yields the invalidation frame with
  the typed refusal, `Quarantine` disposition, and no retry-episode reservation;
  plain-subscription arm yields `resync_required` with the same refusal.
- Client test: applying that frame blanks rows, delivers the refusal on the
  update detail and the handle, warns once, and does not re-snapshot.
- Harness shape (d): 10/10 on the fixed binary on the platform the fix is
  claimed for; the record names platform and client arm (LLP 0317.000 P6).
- `./scripts/check-generated-artifacts` (wire schema + fixtures),
  `node scripts/check-inventories.mjs` (registry + manifest chain), and
  `node scripts/check-guide.mjs` pass on the integrated tree.

## Out of scope

- Surfacing the ceiling at generate time or in generated types (LLP 0317 O10
  ceiling half / O15 / O23 → lane L15).
- The causal subscription receipt (O15 → commission C1).
- The reported shapes (a)–(c), which remain `inconclusive` pending the Linux
  rerun; this ticket owns only the confirmed past-ceiling arm.

## Resolution

Resolved on 2026-08-28 by classifying only
`SNAPBACK_QUERY_IMPLICIT_LIMIT_REACHED` as a deterministic re-query contract
refusal. Auth-scoped subscriptions still emit the LLP 0053 `Quarantine`
obligation and plain subscriptions still emit `resync_required`, but both wire
envelopes now carry an optional typed `refusal`; the deterministic path neither
reserves nor consumes a retry episode. The client blanks retained rows, exposes
the frozen diagnostic on `handle.refusal` and update metadata, warns once, and
does not start a futile plain-subscription re-snapshot. The React registry maps
the existing subscription error surface to `status: 'error'` with that
diagnostic. The guide, retrieval route, wire fixtures/schema, and shape (d)
acceptance harness were updated with the same contract.

Development-smoke evidence in the dirty implementation tree: the preserved
pre-fix binary failed shape (d) 3/3 with
`O14_D_IMPLICIT_LIMIT_SILENCE_CONFIRMED`; the rebuilt binary passed 3/3 while
keeping the original subscription id/version/socket attached and its rows
blank. Focused engine coverage passed 2/2 deterministic auth/plain cases and
1/1 non-member retry control; `snapback-types` passed 246 tests (one ignored),
the client passed 9/9, the React package test passed, and JS wire conformance
replayed 52 fixtures / 82 judgments. `check-inventories`, retrieval evaluation,
and `ref-check` pass. The complete engine suite remains at the identical
base-tree red set (597 passed / 17 failed), and `check-guide` retains the
base-tree generated API cold-signature mismatch; neither failure is in this
ticket's touched behavior. The orchestrator must rerun the checkout-bound gates
after committing the regenerated artifacts.
