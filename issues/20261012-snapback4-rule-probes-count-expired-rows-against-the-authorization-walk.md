# Snapback 4 rule probes count expired rows against the authorization walk

**Status:** Open
**Impact:** 2
**Urgency:** 2
**Ease:** 3
**Confidence:** 4
**Systems:** Snapback 4, expiry, rules, authorization walk
**Class:** follow-up to the 2026-10-12 expiry ruling; not security-relevant
**Date:** 2026-10-12
**Related:** LLP 3000.007 §20.24.6; issues/closed/20261008-snapback4-server-and-device-meters-diverge-on-unswept-expired-rows.md (lane EX, `f9a3b5f0cd`)

The ruling that the public meter charges only rows live at the read's clock
was implemented on every scan path: `Runner::step_expired` gives a stepped-over
expired row back to the 8,192-row authorization walk and charges only the
internal 256 MiB guard. The lookups behind rules and existence checks were
not changed: `witness.rs` `live_lookup` and `probe_witness_uncached` still
spend the walk on expired, unswept rows.

So 8,192 or more unswept expired rows in a witness table can still make the
server refuse `E_RULE` where a swept store, or a device that never received
those rows, decides the rule. The walk is internal, but the refusal is a
client-visible outcome, so the server-against-device oracle can in principle
see it. An existing sim test pins the current behaviour.

**Fix:** step over expired rows in both probes through `step_expired`, so
they refund the walk and charge the internal guard; update the pinning sim
test to the ruled contract; add a device-oracle regression with a backlog
above 8,192.
