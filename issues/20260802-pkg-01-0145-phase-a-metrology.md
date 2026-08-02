# PKG-01: LLP 0145 Phase A/B — closure metrology ratchet + low-risk packaging savings

**Status:** Open
**Systems:** Packaging, Client SDK, Testing
**Related:** LLP 0145 (Research — its §Status authorizes exactly this),
LLP 0063 WS8 (vite-cost-attribution machinery to extend), LLP 0147
(Accepted — consumes these numbers)

The work LLP 0145 itself authorizes, independent of everything else:

- **Phase A — size ratchet:** attribute the shipped client closure
  (bundle bytes by package/module, per profile), freeze the absolute
  baselines at first run (D-B ruling), and install the gate-13 relative
  threshold so regressions fail visibly.
- **Phase B — low-risk savings:** the packaging hygiene items 0145
  identifies that change no semantics (dead exports, duplicate deps,
  boundary cleanups). Land only what needs no wire/API decision.

Explicitly NOT here (0145's own nonclaims): no wire-protocol change, no
default-profile migration, no LLP 0114 seam amendment, no browser-default
change. The thin-profile spike itself is PKG-02's (0147's Phases A–B).

**Exit:** the attribution report is reproducible (script + committed
baseline), the ratchet gate runs in the proof lane, and the savings are
each individually measured in the report.
