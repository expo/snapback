# `AskSpendReservation` is replayable despite losing `Clone`

**Status:** Closed
**Filed:** 2026-08-19
**Resolved:** 2026-08-25
**Severity:** Medium
**Systems:** Security/authorization, Storage, Billing/quota
**Related:** LLP 0283 F-1, LLP 0303, `c963a5bcb`, `1f096cd54`

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

## Resolution

Settlement now consumes the non-`Clone` reservation by value through kernel, engine, and
serving layers. An external dependent-crate witness that settled the same reservation twice
against the baseline now refuses at the second settlement expression with Rust E0382 (use of
moved value). The reservation also carries the exact database binding, while the engine
carrier retains the exact prepared turn used to reserve it and derives settlement's effect
guard from that retained turn.
