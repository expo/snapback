# Snapback 4: `check --store` does not preview read-through adoption validation, and has no clock contract

**Opened:** 2026-09-27, Astra's round-2 blind review of `96d67e2569` (the calibration #23 data_modeling landing)
**Severity:** Low: `check` passes an adoption that then fails cleanly; no data is lost
**Area:** the `check` verb's store preflight, `read through` adoption validation (`E_READ_THROUGH_ADOPT`), the preview clock
**Status:** Open; inherited, reproduced on the parent commit without any Following declaration

Two gaps between `check --store` and the adoption it previews, both
pre-existing:

1. **Read-through validation is not previewed.** An unrelated child table
   adopting `read through` with a missing parent passes CLI `check` and the
   preview API; the adoption then returns `E_READ_THROUGH_ADOPT`. The failed
   adoption preserves rows and generation, so this is an authoring surprise,
   not a fault. Extend store checking to run the read-through parent and
   correspondence validation read-only.
2. **No clock contract.** The preview evaluates expiry at wall time; dev
   adoption can run at an adjusted clock (`adopt_at`). With a deadline of 2,
   the wall-time preview passes while `adopt_at(.., 1)` refuses, and a later
   adoption can succeed after a preview refused. State the contract (which
   clock `check` uses, and that runtime re-checks at its own clock) in the
   feeds card and LLP 3000.016 §2.1a, or give `check` a `--now` that the
   agreement tests exercise.

Reproductions: `~/sb5/reviews/dm2-astra-probes/{inherited-parity.log,review-probes.log}`
on EPYC.
