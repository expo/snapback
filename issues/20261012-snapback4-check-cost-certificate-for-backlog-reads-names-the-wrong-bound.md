# Snapback 4 `check --cost` names the wrong bound for backlog reads

**Status:** Open
**Impact:** 1
**Urgency:** 1
**Ease:** 3
**Confidence:** 4
**Systems:** Snapback 4, `check --cost`, expiry, meter
**Class:** documentation/analysis drift after the 2026-10-12 expiry ruling
**Date:** 2026-10-12
**Related:** LLP 3000.007 §20.24.6; `snapback4/crates/snapback4/src/scale.rs` (lane EX, `f9a3b5f0cd`)

Since the expiry ruling, an expired, unswept row is never charged to the
public meter; stepping over it is internal work bounded by a 256 MiB guard
(`EXPIRED_STEP_GUARD`, `E_STORE_MEMORY`). The `check --cost` certificate for
`backlog`-class reads still says "until then at most N rows examined". That
remains true of the meter, but the store's actual work over an unswept backlog
is now bounded by the guard, not by N. Lane EX changed the wording only.

**Fix:** have the certificate state both bounds for backlog reads (the
metered N, and the internal guard over expired rows until the sweep), and
cover the text in the `scale_windows_expiry` test.
