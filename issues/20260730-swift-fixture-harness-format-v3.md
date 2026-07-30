# Swift FixtureHarness: adopt wire-fixture corpus format v3

**Status:** Open
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
