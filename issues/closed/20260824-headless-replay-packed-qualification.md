# Qualify the packed headless replay surface at 200k actions

**Status:** Open
**Opened:** 2026-08-24
**Owner:** LLP 0307 delegated author
**Review:** 2026-08-26
**Systems:** Headless replay, packed publication closure, acceptance evidence
**Governing:** LLP 0307.000 Acceptance 1; LLP 0189

## Scope

Run `scripts/prove-packed-headless-replay-100k.mjs` from a bare packed consumer
against a real sessions-mode server for at least 100,000 actions under each of
the `minted` and `none` custody policies. Retain the proof document with the
package archives, action-log identity, receipt digests, peak RSS, persona count,
and runtime-registration observations required by LLP 0307.000.

The packaging and session-mint defects found by the 2026-08-24 pilot are fixed,
but the full 200,000-action run has not yet supplied qualification evidence.
Until it does, `testing.headless-replay` remains experimental and this ticket is
the capability-index GAP owner.

## Exit

The packed proof passes both custody lanes, its retained artifact satisfies LLP
0307.000 Acceptance 1, and the capability row is reconciled to the evidence.

## Resolution (2026-08-25)

PASS both custody modes at 100,000 actions × 8 personas each (200,000
protocol-v1 mutations, settle-before-next, packed consumer through
`snapback replay` against a receipt-bound rebuilt binary at `b57a7ca47`):
minted 100k/100k settled with exactly 100,000 acked transport ids across
6,256 flushes; none 100k/100k with zero acks; zero refusals, zero
live-query registrations, duplicatePossible 0, peak RSS 288.5 MiB of the
512 MiB budget, receipt digest `bed288a1…`. Record:
`benchmarks/runs/2026-08-24-packed-replay-200k/record.md`. Capability row
GAP lifted; LLP 0307.000 r6 records the qualification. Environmental
papercut spun off as
`issues/20260824-stale-reservation-lock-bare-refusal.md`.
