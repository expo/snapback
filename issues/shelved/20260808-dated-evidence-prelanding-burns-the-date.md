# Pre-landing dated evidence burns that UTC date for later candidates

**Status:** Open
**Systems:** Publication, Testing, Instance forks
**Date:** 2026-08-08
**Related:** LLP 0189, `issues/20260807-derived-fork-publication-wave-drift-requalification.md`

Two design frictions found while completing the derived-fork requalification:

1. Dated append-only evidence locators require the path to be absent at
   qualification C. Landing receipts on main *before* the next C (done
   2026-08-08 for durability) therefore blocks any same-UTC-day successor
   candidate: the emitter's exclusive-create refuses against the committed
   file and the exists-at-C check would refuse the path anyway. Receipts
   should ride in the publication commit P, not pre-land — or the emitter
   and locator patterns should support a same-day sequence component.
2. A checker-only C rotation (no fork-runtime byte changed) still forces
   full re-minting of platform evidence because bench artifacts bind
   `environment.commit === C` exactly. Consider binding evidence to the
   runtime-relevant scope subset digest instead of the whole C, per the
   same LLP 0189 D-5 content-not-HEAD principle, at the next contract
   rotation.

Neither is worth another checker rotation mid-ceremony; the current cycle
completes by minting 2026-08-09 (UTC) evidence at a fresh C.
