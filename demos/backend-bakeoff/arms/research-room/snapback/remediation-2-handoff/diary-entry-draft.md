# Research Room / Snapback remediation-2 diary-entry draft

**Date:** 2026-07-29

**Source commit:** `894ddaf99d4b7681499eec12ecbb3fc7a1a492e5`

**Outcome:** 13 PASS, 2 explicit GAP, 0 FAIL, no Stop-class defect

**Target cleanup:** complete

The imported exact-instance capability-composition repair changed the
experience decisively. The same Research Room application that previously
failed before bind now admitted a fresh SQLite + Ibex sessions target, minted
Alice, Bob, and Mallory, and completed every runnable frozen scenario. The
strongest result was the combined path: Alice started a bounded streamed
action, Bob saw durable progress and the answer over native push, cancellation
prevented a deliberately injected late patch, retries preserved stable
question/answer identity, and all five settlement outcomes remained
inspectable. This is the kind of coherent end result Snapback should preserve.

What felt good:

- The repaired server rejected no valid sessions/stream composition at
  startup; exact-instance capability facts and runtime admission finally
  agreed.
- Session-backed authority worked consistently across queries, mutations,
  streamed actions, and subscriptions. Mallory's refusals were broad and
  explicit.
- Durable mutation receipts, effect certainty, replay identity, and native
  push made the hard action semantics unusually observable.
- Cancellation plus an injected late mutation gave credible proof of the
  terminal-state guard rather than relying on timing.
- Cron could be advanced deterministically, its effect observed at the local
  receiver, its durable slot replayed, and runtime cron state inspected.
- Config diagnostics proved a required server-side value was set while
  redacting it from status, bundles, diagnostics, and retained receiver
  evidence.
- One local process still provided a compact application target with exact
  identity and cleanup.

What was frustrating or surprising:

- The sealed setup mutation attempted four generated membership writes: two
  owner bootstraps and two Bob inserts. Only after the repaired target admitted
  did it produce `SNAPBACK_MEMBERSHIP_BATCH_UNSUPPORTED`, revealing that v1
  permits one generated membership write per mutation. The copied runner and
  handlers therefore decomposed the same seed into four idempotent mutations.
  The rule is precise but easy to discover late, and a codegen or guide
  diagnostic should make the authoring constraint obvious before runtime.
- `SnapbackClient.inspect()` did not automatically offer the session auth
  client protocol, even though `/inspect` requires it once sessions mode is
  active. The copied harness had to issue the public request with
  `x-snapback-auth-client-protocol: 1` itself. A probe of the sensitive
  `/_snapback/api/inspect` operator route correctly returned 401 because the
  copied harness had not minted the separate secret-read lease; that route is
  not the public alternative. This is an SDK ergonomics defect:
  the client knows how to negotiate ordinary session requests and should make
  its own diagnostic method valid in the same profile.
- Cron testing crossed both an admin capability and an Alice session. A
  first-class, typed session-aware operator client would make that composition
  easier to understand and harder to misconfigure.
- The deterministic scheduled receiver URL was authored as a literal port, so
  isolated parallel execution required changing copied application source.
  Effect endpoints should be configurable through an arm-scoped runtime value.
- Files and native semantic retrieval remain honest GAPs. Research Room is an
  especially useful forcing function because metadata-only sources and
  application-side vector scans are tempting but invalid substitutes.

Snapback lessons:

1. Keep the exact-instance startup repair: it turns a product-wide dead end
   into a coherent working composition.
2. Validate membership-write cardinality at generation time and show the
   one-write rule beside membership mutation authoring examples.
3. Make all official client methods, including `inspect()`, automatically
   negotiate the active sessions protocol or expose a clear typed alternative.
4. Provide an explicit test/operator surface that combines deterministic cron
   advancement, session authority where needed, and redacted inspection.
5. Make outbound effect destinations configurable without source edits so
   parallel isolated targets remain straightforward.
6. Prioritize a real asset lifecycle and provider-native semantic retrieval;
   they are the two remaining capability holes in this arm.
