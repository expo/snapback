# 0093 P-3: add the auth-profile fixture classes to the LLP 0095 conformance corpus

**Status:** Resolved (2026-07-30)
**Impact:** 4
**Urgency:** 3
**Ease:** 3
**Confidence:** 5
**Score reviewed:** 2026-07-26
**Score rationale:** The ticket evidence for “0093 P-3: add the auth-profile fixture classes to the LLP 0095 conformance corpus” shows the issue materially affects a supported product or engineering path; it belongs in the current program but is not an immediate blocker, while the fix requires a few coordinated implementation and test surfaces, with a direct reproduction or current implementation proof.

**Opened:** 2026-07-25
**Source:** LLP 0096 §2 / §8.4 (P-3 fixture obligations)
**Systems:** Wire Protocol, Auth, Tests, Native Clients
**Coordinates with:** `issues/20260725-0093-p1-fixture-corpus-coverage.md`
(LLP 0095 §2.4's "malformed capability offers" deferred row was the
placeholder for this cluster; the multi-step `steps` fixture-format need
is shared with the cancelled-drain fixtures there).

LLP 0096 enumerates the fixture classes each auth profile adds to
`schemas/live.wire-fixtures.v1.json` (generator
`src/wire_fixtures.rs::wire_fixture_corpus()`). None are seeded yet:

- **`auth/rr`** — `auth.rr.offer_refusal_surfaced`: per-request
  `SNAPBACK_AUTH_POLICY_UNAVAILABLE` refusal → structured capability
  diagnostic, no blind retry. Plus the malformed-offer negatives
  (client→server direction; the corpus does not carry that direction
  yet — same format gap as P-0's offer-matrix fixtures).
- **`auth/live`** — `auth.live.invalidation_snapshot_apply_then_ack`
  (acknowledge-after-apply; a sent-but-unapplied snapshot never
  discharges), `auth.live.ack_requires_negotiated_connection`
  (open-time `authInvalidationProtocol` absent → ack refusal),
  `auth.live.quarantine_blocks_reads_until_superseding_snapshot`,
  `auth.live.terminal_auth_disposition` (extends seeded T-AUTH-TERM
  with `authorityDisposition` distinctions).
- **`auth/replay`** — `auth.replay.descriptor_offer_required`,
  `auth.replay.duplicate_settlement_idempotent`,
  `auth.replay.predecessor_queue_suspends`.
- **`auth/lease`** — `auth.lease.offer_pair_required` (lease and
  invalidation offers together, `src/server.rs:16197-16215`),
  `auth.lease.expiry_fences_retained_rows`.
- **`auth/sender`** — deferred entirely until the off-browser custody
  story exists (LLP 0096 §5): the corpus must not encode browser-custody
  obligations as if they bound native clients.

Notes for the implementer:

- Several classes need request/response sequences, not single frames —
  the same `steps` format extension the P-1 ticket needs.
- Fixtures are judged against LLP 0095 §1's model; the invalidation
  transition semantics stay owned by LLP 0053 (cite, don't restate).
- Tuple routing: all profile fixtures are local-arm tuples today
  (LLP 0096 §2.6 — no hosted sessions surface); do not mint
  `*/hosted` profile tuples.

## Resolution (2026-07-30)

All profile classes landed in the format-v3 corpus (12 fixtures; the
`client_to_server` request/refusal direction was built once, shared with
the P-1 ticket as planned). Per cluster:

- **`auth/rr`** — `auth.rr.offer_refusal_surfaced` (three request steps:
  503 readiness surfaced, missing-offer 400, unknown-integer 400; the
  malformed-offer negatives fold into the same fixture).
- **`auth/live`** —
  `auth.live.subscribe_missing_invalidation_offer_refused`,
  `auth.live.ack_requires_negotiated_connection` (open-time half; the
  per-request header present so the fixture isolates it),
  `auth.live.ack_needs_no_descriptor_offer`,
  `auth.live.terminal_auth_carrier_disposition` and
  `auth.live.terminal_auth_durable_delete_disposition` (the ticket's
  `terminal_auth_disposition` class, split per disposition because a
  terminal step admits no successor step), and
  `poll.wrapped_authorization_invalidation.apply_then_ack`.
  `invalidation_snapshot_apply_then_ack` (the ticket's
  acknowledge-after-apply row) and
  `quarantine_blocks_reads_until_superseding_snapshot` (as
  `invalidation_without_snapshot_quarantines` plus the adversarial
  fixtures) were already seeded pre-ticket-execution.
- **`auth/replay`** — the triple, reflecting the post-defect-fix
  InvocationSource split
  (issues/closed/20260725-0093-p3-invalidation-ack-descriptor-coupling.md,
  decided option 2): `descriptor_offer_required` fences the
  replay-requesting mutation AND `/client-mutations/acknowledge`
  (`MutationSettlementAcknowledgement`, the deliberate coupling) while
  `auth.live.ack_needs_no_descriptor_offer` proves the invalidation acks
  stand outside the fence; `duplicate_settlement_idempotent`
  (exact-request redelivery, gate-enforced identical);
  `predecessor_queue_suspends` (a `client_lifecycle`
  `authority_instance_changed` event fixture).
- **`auth/lease`** — `offer_pair_required` and
  `expiry_fences_retained_rows` (virtual-time). The ticket's
  `src/server.rs:16197-16215` citations were verified STALE: the pair
  enforcement now lives in `invoke_authorized_lease_query`
  (`src/server.rs:17482-17511` at this landing), on
  `from_http_headers` since the §8.2 parser fix of 2026-07-27; the
  fixtures pin the current behavior.
- **`auth/sender`** — deliberately not seeded (LLP 0096 §5), as the
  ticket requires.

All profile fixtures are local-arm tuples, now gate-enforced
(`tests/wire_fixtures_v1.rs` — profile fixtures may claim only
`poll/local`/`live/local`). LLP 0096 §2/§8.4 and LLP 0095 §1.5 record the
landing. The format bump to v3 means the Swift FixtureHarness (v2-only)
must adopt v3: `issues/20260730-swift-fixture-harness-format-v3.md`.

Verification: `cargo test --test wire_fixtures_v1` (7/7),
`cargo test --test artifact_schemas_v0` (dk7 corpus gates pass; 3
pre-existing fresh-worktree failures unchanged from HEAD),
`./ref-check --verbose`.
