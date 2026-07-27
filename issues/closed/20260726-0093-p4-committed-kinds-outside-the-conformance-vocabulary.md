# 0093 P-4 spec defect: `current_as_of` and `authorization_invalidation` are committed wire kinds with no action vocabulary and no fixture

**Opened:** 2026-07-26
**Source:** LLP 0093 D4 clean-room discipline (P-4 Dart client build).
**Systems:** Wire Protocol, Client SDK, Live Queries, Auth, Tests

## The defect

`LiveEnvelope` has five kinds (`src/live_wire.rs`). The conformance
apparatus covers three of them:

| Kind | In the corpus? | Has an action in LLP 0095 §1.5? |
| --- | --- | --- |
| `live_replace` | yes | `replace_rows` |
| `live_delta` | yes | `apply_delta_by_id` / `drop_stale` |
| `resync_required` | yes (both scopes) | `resubscribe_*`, `clear_retained_overlays` |
| **`current_as_of`** | **no** | **none fits** |
| **`authorization_invalidation`** | **no** | **none fits** |

LLP 0095's tolerance floor is explicit that this gap is not benign:
"Tolerance is not a license for known kinds — T-DB is the counterexample."
Both missing kinds are known kinds, and both carry real obligations:

- **`current_as_of`** (LLP 0091 §0B.2) — "the client adopts the mandatory
  fresh token and advances its version **without touching rows**". A client
  must transition the subscription to `LIVE(version)` and *not* emit
  `replace_rows`. The §1.5 vocabulary is declared **closed** ("additions
  revise this spec"), so there is no legal action for "advanced the version,
  adopted a token, touched no rows". I emitted a transition with an empty
  action list, which is a guess.
- **`authorization_invalidation`** — LLP 0096 §2.2 requires
  apply-then-acknowledge, quarantine semantics, and bounded-retry
  escalation, and lists four fixture classes as *future* work under
  `issues/20260725-0093-p3-profile-fixture-classes.md`. So a `live/local`
  conformance claim today says nothing about a kind the server can emit to
  any auth-scoped subscription.

The net effect: a client can pass 100% of both claimable local tuples while
silently mishandling two of the five envelope kinds. That is a weaker claim
than the corpus's normative status implies, and nothing in the corpus's own
`coverage` string discloses it (it enumerates *negative*-fixture gaps, not
missing positive kinds).

## Fix wanted

1. **Disclose it now, cheaply.** Extend the corpus's `coverage` member to
   name the two uncovered `LiveEnvelope` kinds, so a consumer of the
   artifact sees this specific incompleteness the way §2.4's deferred rows
   are visible today.
2. **Seed `current_as_of`.** It needs no new fixture format — a
   `given.subscription` in `LIVE(v)` plus a `current_as_of` frame at `v+1`,
   asserting a version advance with **no** row action. It also needs one new
   entry in the §1.5 closed vocabulary (`adopt_resume_token`, or
   `advance_version`), which is a spec revision this ticket is asking for.
3. **`authorization_invalidation`** stays with the P-3 profile fixture
   ticket, but LLP 0095 should state the interim rule a non-`auth/live`
   client must follow when it receives one (surface and treat the
   subscription as untrusted? ignore, because a client that never negotiated
   the invalidation protocol should never receive it?). Today that is
   undefined, and the two answers differ observably.

## What the Dart client does meanwhile

`current_as_of`: advances the version, adopts the token, emits no row
action. `authorization_invalidation`: decoded and surfaced to the embedding
app as a `ClientEvent`, no state transition, documented as an unimplemented
obligation. Both are guesses recorded in `clients/dart/NOTES.md`.
## Resolution

Wire-fixture format v2 and LLP 0095 now cover every committed envelope kind:
replace, delta, CurrentAsOf, batch, and authorization invalidation.
