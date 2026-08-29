# Deterministic re-query refusal is classified by its public code string, not by host provenance

**Status:** Open
**Opened:** 2026-08-29
**Owner:** unassigned (live-query / handler runtime)
**Systems:** Live queries, Authorization invalidation, Handler runtime
**Related:** LLP 0053 (2026-08-28 amendment: deterministic live re-query
refusal), LLP 0053 §Dispositions (`SNAPBACK_AUTH_PERMISSION_DENIED` is trusted
only through a host-set brand), `issues/20260828-live-query-implicit-limit-refusal-blanks-subscription.md`,
`crates/snapback-engine/src/local/engine.rs` (`is_deterministic_query_contract_refusal`),
`packages/snapback-harness/ctx-bootstrap.js` (`__snapbackCode` propagation),
`crates/snapback-engine/src/runtime/host_glue.rs` (typed-code allowlist)

## What the L19 landing does

`is_deterministic_query_contract_refusal` admits one code,
`SNAPBACK_QUERY_IMPLICIT_LIMIT_REACHED`, by matching the diagnostic's public
`code` string. The genuine producer is the host-owned query builder in the
handler runtime bootstrap. But the same runtime also copies a handler-controlled
`error.__snapbackCode` into the returned diagnostic, and that code is on the
allowlist of codes preserved from JavaScript errors. A handler that throws an
error carrying that code string is therefore classified as a deterministic
refusal: its subscription gets the typed `refusal` on the wire and no bounded
retry episode is spent.

## Why it was not treated as a landing blocker

- The blast radius is the throwing application's own subscription. The
  disposition stays `quarantine` (auth-scoped) or `resync_required` (plain);
  no rows are exposed, no other principal's subscription is affected.
- The retry that is skipped would re-run the same handler and, for any
  handler that throws the code unconditionally, fail the same way.
- LLP 0053's stricter precedent — `SNAPBACK_AUTH_PERMISSION_DENIED` is honoured
  only when the host set an unforgeable brand — exists because that code
  drives a `delete` disposition and would let an application destroy data.
  The refusal drives no disposition change.

## What it would take

Brand the host-produced refusal the way the permission denial is branded:
the runtime bootstrap holds a per-VM secret it never exposes to handler code,
attaches it when *it* raises the implicit-limit refusal, and the host glue
verifies the mark before `SnapbackError` carries a trusted flag that the
classifier requires. A handler-thrown code without the mark stays an untyped
re-query error (ordinary bounded retries, no typed refusal on the wire).

## Acceptance

- An engine test in which a handler throws
  `SNAPBACK_QUERY_IMPLICIT_LIMIT_REACHED` conditionally (e.g. on a counter)
  shows the ordinary three-attempt episode and no `refusal` field; the genuine
  ceiling case still classifies.
- LLP 0053's 2026-08-28 amendment updated to say the classification is
  provenance-backed.
