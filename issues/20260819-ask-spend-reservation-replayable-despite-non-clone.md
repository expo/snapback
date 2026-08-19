# `AskSpendReservation` is replayable despite losing `Clone`

**Status:** Open
**Filed:** 2026-08-19
**Severity:** Medium
**Systems:** Security/authorization, Storage, Billing/quota
**Related:** LLP 0283 F-1, `c963a5bcb`

## Finding

`AskSpendReservation` is non-`Clone` (`crates/snapback-kernel/src/storage/ask_spend.rs:46`),
which was intended to make each reservation single-use. It does not, because settlement
**borrows** the reservation rather than consuming it
(`crates/snapback-kernel/src/storage/ask_spend.rs:332`), and the ledger tracks aggregate
reserved amounts rather than reservation identity.

## Failure scenario

Make two equal reservations A and B for the same subject and day. Settle A twice with zero
actual spend. Both settlements succeed while the aggregate reserved amount still covers
them, and the second settlement consumes B's reservation. Work performed under B can then
incur real provider spend, but its final settlement fails
(`crates/snapback-server/src/server.rs:25013`), leaving that spend unrecorded and reopening
quota earlier than it should.

## Provenance

Independent codex `gpt-5.6-sol` review of `c963a5bcb`. Pre-existing; the `Clone` removal in
that commit is correct but ineffective on its own. Recorded so the removal is not mistaken
for closure.

## Acceptance

- Settlement consumes the reservation by value, or the ledger tracks reservation identity
  so a given reservation can settle at most once.
- A regression settles the same reservation twice and proves the second attempt fails.
