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
