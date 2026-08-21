# The neutral authorization carrier is never installed, so stale reads as unavailable

**Status:** Open
**Filed:** 2026-08-21
**Test:** `server::tests::authorization_neutral_stage_mispreview_still_fails_closed`
**Governing:** LLP 0290 (Accepted 2026-08-20), LLP 0059, LLP 0285

## Finding

LLP 0290's mandatory verification matrix requires that a neutral preflight
presented with an actual authorization event fails with
`SNAPBACK_AUTH_RESERVATION_STALE`. The kernel already implements that
distinction: preparing `NoAuthorizationEvent` creates a neutral reservation with
no ticket, and binding that neutral carrier to an authorization-changing
transaction returns stale.

**The server never requests or installs that neutral carrier.** It sets
`authorization_event = false` for `NoAuthorizationEvent`, which makes
`reservation_required = false`, and runs the work in the current Local turn with
no carrier at all (`crates/snapback-server/src/server/writer_gate.rs:193,197,199`).
The kernel's stale path is therefore never reached, and the condition surfaces
as `SNAPBACK_AUTH_PROJECTION_UNAVAILABLE` instead.

## NOT a security defect

The write is still refused; this is not an authorization bypass and not
fail-open. It is a diagnostic and retry-semantics defect.

It is product-visible: stale maps to HTTP **409 (retryable)** and
projection-unavailable maps to HTTP **503 (backend unavailable)**. LLP 0059:824
requires this pre-commit stale condition to be reported as retryable 409. A
client currently sees "the backend is down" for a condition it should simply
retry.

## Open question about the current fix on `lane/roompanic`

`44d7028d1` makes this test PASS (server suite 474/1). But it changed only
`crates/snapback-kernel/src/storage/room_authority.rs` (+86/−2) and did NOT
touch `writer_gate.rs`, so the missing carrier installation described above is
unaddressed.

Its commit message argues it implements the correct distinction —
`RESERVATION_STALE` where the projection exists but the preflight reservation no
longer covers the write, `PROJECTION_UNAVAILABLE` where projection is genuinely
missing or suspended. That may well be right.

But this analysis independently warns against exactly the wrong version of that
change: **do not globally remap carrier-missing errors to stale**, because a
genuinely missing authorization carrier remains a systemic projection failure
(`crates/snapback-kernel/src/storage.rs:727`).

**Confirm which one `44d7028d1` did before treating this ticket as resolved by
it.** A green test is not sufficient evidence here — the test asserts the
diagnostic code, which is precisely what a remap would also satisfy.

## Correct repair, if the carrier is still missing

Restore an opaque, kernel-minted, database-bound neutral carrier on the neutral
same-turn path, so the kernel can distinguish "neutral preview became
authorization-changing" from "an authorization transaction arrived without its
required carrier." Existing neutral-reservation semantics — no ticket, no
selector, no rollback ownership — are the right model.

Must NOT: relax the pre-commit fail-closed check; change the test to expect
`PROJECTION_UNAVAILABLE`; globally remap carrier-missing to stale; reintroduce
the public or generic carrier factory, which LLP 0285 deletes deliberately in
favour of private non-forgeable authority; or allocate a room ticket for a
neutral preview.
