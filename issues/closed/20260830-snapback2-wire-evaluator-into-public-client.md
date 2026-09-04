# Snapback2: wire the evaluator into the public web client

**Status:** Closed (2026-09-04, lane O2b of LLP 1012)
**Systems:** snapback2, client, evaluator, receipts
**Severity:** P2
**Author:** Codex gpt-5.6-sol
**Date:** 2026-08-30
**Related:** LLP 1001 §10; LLP 1002 §9; LLP 0329.018 F1

## Problem

The standalone TypeScript evaluator is conformant with the Rust engine across
the 106-case frozen corpus, including the accounts/RBAC transition and
constraint cases. The published `snapback2/client` surface does not import or
execute it, and the current wire does not yet deliver the certified program
and receipt custody a local evaluation would require. LLP 1002 previously
described the target arm assignment as though this wiring already existed.

The server remains authoritative and the current client is honestly
server-backed, so this is not a server authorization bypass. It is a missing
client prediction/coverage capability and must not be represented as shipped.

## Done when

- The public web client receives a generation-bound certified program and the
  rows, ranges, absences, and verdicts required by the evaluator without
  inventing a second authority protocol.
- The web/Expo arm invokes `snapback2-evaluator`; the Contract-native arm uses
  `snapback2-core`, and no third evaluator locus is introduced.
- Successor, authentication-generation, receipt replacement, and reconnect
  fences prevent predecessor evaluation from publishing into current state.
- Public receipt/rule hashing canonicalizes object keys exactly as Rust's
  ordered-map serialization rather than trusting JavaScript insertion order.
- Package and acceptance tests demonstrate complete, partial, capped, denied,
  and corruption outcomes against the authoritative server.
- LLP 1002 §9 and the public guide describe the implemented custody path and
  measured bundle cost.

## Resolution (2026-09-04, LLP 1012 lane O2b)

Every item holds on `main`'s successor, proven in the blocking gate:

- The public web client receives the generation-bound certified program
  (`GET /api/program`: IR, certificates, schema) and the rows, ranges,
  absences, and verdicts through the frozen envelope; both are held per
  principal in the range store (`programs` beside the outbox) — no second
  authority protocol (`packages/snapback2/tests/twin.test.ts`, "program custody
  is fetched, held per generation on both carriers …").
- The web/Expo arm runs `snapback2-evaluator` itself: `packages/snapback2/src/twin.ts`
  imports the evaluator's `ClientStore`/`Runner` sources and `build.mjs` bundles them
  into `snapback2/client`; the Contract-native arm keeps `snapback2-core`; there is
  no third locus.
- Successor and auth-epoch fences: coverage delivered under another generation or
  schema is `hydrating` under the held program; a verdict minted under another epoch
  never vouches (same test, "fenced by generation and auth epoch"); receipt
  replacement and reconnect fences are the store's swap and the client's authority
  snapshot (LLP 1002 §9), unchanged.
- Canonical hashing: hydration from `coverage()` rebuilds every envelope golden's
  `ClosureReceipt` byte-identically and every corpus query's receipt round-trips the
  store byte-identically; point digests and verdict inputs digests are sorted-key
  canonical JSON, as Rust serializes them (`twin.test.ts`, `packages/evaluator/src/test.ts`).
- Outcomes against the authoritative server: complete/capped (the corpus queries and
  the chat template's never-opened thread), partial with `never-held | evicted |
  computed-key`, denied, and the corruption path (`replay-mismatch` in the evaluator
  corpus; a tagging failure leaves the read `hydrating`) — `twin.test.ts` and the
  chat template journeys under `snapback2 test`.
- The bundle cost is recorded in `snapback2/metrics/twin.jsonl`; LLP 1002 §9 and the
  offline guide page describe the custody path (orchestrator folds the LLP text).
