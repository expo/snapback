# Swift FixtureHarness: adopt wire-fixture corpus format v3

**Status:** Resolved (2026-07-30)
**Opened:** 2026-07-30
**Source:** fixture-format v3 landing
(`issues/closed/20260725-0093-p1-fixture-corpus-coverage.md`,
`issues/closed/20260725-0093-p3-profile-fixture-classes.md`; LLP 0095 §2.1)
**Systems:** Native Clients, Tests, Wire Protocol

`schemas/live.wire-fixtures.v1.json` is now `formatVersion: 3`: it adds
`direction: "client_to_server"` request/refusal fixtures,
`direction: "client_lifecycle"` fixtures, and the
advance/event step forms with the §2.1 rule-4 virtual-time judgment.

The Swift harness
(`clients/swift/SnapbackClient/Sources/SnapbackClient/FixtureHarness.swift`)
accepts `formatVersion` 1–2 only (`(1...2).contains(formatVersion)`) and
hard-requires `direction == "server_to_client"` on every fixture, so it now
refuses the committed corpus at load — by design: its v2 judgment (feed
every fixture's frame to the client) would misjudge the new classes, which
is exactly why the format version bumped instead of drifting additively.

Work:

1. Accept `formatVersion` 3 and the three-direction enum.
2. Either implement the v3 judgments (request/refusal surfacing,
   lifecycle events, virtual clock per LLP 0095 §2.1 rules 1–4) or, as an
   honest interim, evaluate the `server_to_client` frame fixtures and
   report the v3-only fixtures as `evaluated: false` skips — never as
   passes.
3. Re-run `FixtureConformanceTests` and the `snapback-prove` flow on a
   macOS host with Xcode (not attempted in the landing worktree — no
   Xcode build was run there).

Until this lands, the Swift client's corpus claims are pinned to the
format-v2 fixture set it last passed (all 21), which remains a subset of
v3's `server_to_client` fixtures with unchanged judgment.

## Resolution (2026-07-30)

Option 1 (full v3 judgment) taken — no honest-interim classes remain.

**Harness** (`FixtureHarness.swift`): accepts `formatVersion` 1–3 with the
three-direction enum gated to v3 (a v2 corpus carrying the new directions
is refused); `client_to_server` request/refusal units are played by the
harness-as-server and the client's answer processing is judged
(`ClientStateMachine.processRequestAnswer`); `client_lifecycle`
`socket_lost` / `authority_instance_changed` event steps drive the real
T-LOSS / replay-queue paths; `advanceVirtualTimeMs` steps drive the §2.1
rule-4 virtual clock (`VirtualTransportSupervisor`, `TransportTiming.swift`
— 5 s heartbeat, 15 s freshness budget, 250 ms → 10 s backoff) with the
exact-action-set interval judgment, repeatable timer actions, and
`expect.pacing` bounds over emission timestamps. New judgment surface:
`connection: "state"` / `all_subscriptions → dropped` / `replayQueue` /
`retainedRead` transitions, `supersession` plans (established → with
`supersedes`, in-flight-at-loss → without assumption), and `settlement`
idempotence.

**Client machine** (corpus-normative alignments, LLP 0093 D1 precedence):
`noteTerminalAuth` now matches the T-AUTH-TERM fixtures — the connection
enters `TERMINAL_AUTH` and is fenced whole; `carrier` retains local
durable authority state, `durableDelete` emits
`delete_local_durable_authority` and deletes it; subscription
materializations no longer transition (the in-flight-subscribe fence moved
to a connection-phase check in `SnapbackClient.subscribe`).
`noteGrantLost` now returns the §4.4 event
(`reopen_connection`/`resubscribe_all`/`clear_retained_overlays`, every
subscription → `resync_pending`). New: settlement ledger, replay-queue
suspension, retained-read lease fencing, standing recovery plan.

**Runs on this Mac (2026-07-30):**

- `swift test` (clients/swift/SnapbackClient): 49 tests, 0 failures —
  includes `FixtureConformanceTests.testCorpusPasses` (77/77 per-tuple
  evaluations across all 49 fixtures; 2 routing skips, both
  `live/hosted`-only fixtures under §2.2, asserted to be the only skips)
  and 9 new `FixtureJudgmentDiscriminationTests` proving each v3 class
  fails under non-conformant expectations (vacuous-pass guards).
- `swift run snapback-prove` against `target/debug/snapback start
  --memory --port 4499`: 13 passed, 0 failed (fixtures 77/77 + poll/local
  and live/local acceptance legs). The prove flow's pre-B1
  downgrade-diagnostic check was stale — the current server binds and
  echoes `wireVersion` at open — so the check now accepts exactly one of
  the two §0B.3/§0B.6 outcomes (`ConnectionGrant.boundWireVersion` added).

LLP 0095 §2.1/§6 updated in the same commit (rule 4 implemented; harness
deferred-work bullet closed).
