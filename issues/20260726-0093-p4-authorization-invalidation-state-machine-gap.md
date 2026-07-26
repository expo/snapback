# 0093 P-4 spec defect: LLP 0095's state machine has no transition for `authorization_invalidation`, the only envelope an auth-scoped live query delivers

**Opened:** 2026-07-26
**Source:** LLP 0093 D4 clean-room discipline (P-4 Kotlin client build, `clients/kotlin`).
**Systems:** Wire Protocol, Auth, Live Queries, Client SDK, Tests

## The gap

`LiveEnvelope::AuthorizationInvalidation` is one of the five durable-lane
envelope kinds (`src/live_wire.rs`, `live.envelope.schema.json`). LLP 0095 §1.4
is "the transition catalogue", every entry of which is normative, and §1.1
states fixtures are judged against that model and nothing else.

**There is no transition for `authorization_invalidation` in §1.4.** There is
no fixture for it in `schemas/live.wire-fixtures.v1.json`. It is not in §2.4's
negative-fixture inventory (seeded or deferred). The §1.5 action vocabulary has
no action that describes applying its snapshot or discharging its obligation.
LLP 0096 §2.2 lists client obligations for it in prose and names four fixture
classes — all ticketed as future work
(`issues/20260725-0093-p3-profile-fixture-classes.md`).

## Why that is not a small omission

Observed against a live sessions-mode server (Partitime Snapback backend), an
auth-scoped live subscription delivers **only** `authorization_invalidation`
frames. No `live_replace`. No `live_delta`. The rows arrive inside the
envelope's optional `snapshot` member, and the obligation is level-triggered:
the server **re-sends the frame continuously** until the exact
`resolution.ackToken` is returned to
`POST /live/authorization-invalidation/acknowledge`.

So a client that implements LLP 0095 §1.4 exactly and completely — every
transition in the catalogue, all ten corpus fixtures passing — receives, on
every auth-scoped subscription:

- zero row updates, and
- an unbounded frame loop.

The state machine that the corpus judges against is silent about the only
path that matters in sessions mode. This is the mirror image of the
`durable_bytes` defect class (`issues/closed/20260724-durable-bytes-silent-staleness.md`):
a known kind whose omission is silent permanent staleness.

## What the Kotlin client implements (best effort, verified)

Derived from the served frames plus LLP 0096 §2.2's prose obligations:

1. Locate the subscription via `obligation.scopeId.subscriptionId` (falling
   back to `snapshot.subscriptionId`).
2. If a `snapshot` is present with `version` greater than the held version,
   **apply it atomically** (rows + version), leaving the subscription `LIVE`.
3. If no snapshot is present, **quarantine**: the subscription goes
   `RESYNC_PENDING`, rows are untrusted and must not render.
4. **Only then** release `resolution.ackToken` and POST
   `{connectionId, ackToken}` to `/live/authorization-invalidation/acknowledge`
   with `x-snapback-auth-invalidation-protocol: 1`. Acknowledge-after-apply:
   a sent-but-unapplied snapshot never discharges.
5. Never acknowledge an obligation for a subscription the client does not hold.

With that loop the frame storm stops after one frame and live push works.

## Cost

~45 minutes: 25 to diagnose (the symptom was "no live updates", not an error),
20 to implement. Diagnosis required adding a raw-frame observability hook,
because nothing in the documents suggested this envelope would be the *only*
one on the path.

## Fix wanted

1. LLP 0095 §1.4 gains **T-AUTH-INVALIDATION** as a normative transition with
   the apply-then-acknowledge ordering, the quarantine state, the
   never-ack-a-foreign-obligation rule, and the re-delivery consequence of
   ignoring it, cross-referencing LLP 0053 for semantics.
2. §1.5 gains the actions that transition needs (e.g.
   `apply_invalidation_snapshot`, `acknowledge_obligation`, `quarantine_rows`)
   — the vocabulary is closed, so any fixture for this class needs them.
3. §2.4's inventory gains the row, coordinated with
   `issues/20260725-0093-p3-profile-fixture-classes.md`.
4. LLP 0095 §1.3's subscription-state table gains the quarantined state (or
   states explicitly that quarantine is `RESYNC_PENDING` with the rows
   retained-but-unreadable, which is a different thing from `RESYNC_PENDING`
   as currently described).

Until 1–3 land, `live/local + auth/live` is not conformance-claimable by any
client, because there is no model to judge it against.

## Related

- `issues/20260726-0093-p4-committed-kinds-outside-the-conformance-vocabulary.md`
  (Dart P-4, filed independently the same day) reaches the same structural
  conclusion from the corpus side — `current_as_of` and
  `authorization_invalidation` are committed kinds with no action vocabulary
  and no fixture. This ticket adds what only a **sessions-mode** run shows:
  the omitted kind is not a rare edge, it is the sole delivery path, and
  ignoring it produces a frame storm rather than a missed update. Two
  independent clean-room builds converging on the same omission from
  different directions is the strongest evidence available that it is real.
- `issues/20260725-0093-p3-profile-fixture-classes.md` — where the
  `auth.live.*` fixture classes are already parked.
