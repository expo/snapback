# D-02: Operation-class registry, OQ1 ratification vs LLP 0104, boundary-protocol fixture corpus (LLP 0154 checklist 2)

**Status:** Open — unblocked 2026-08-02 (identity representation ruled;
depends on obs-01 closing on the amended schema)
**Program:** 20260802-obs-00-program.md
**Depends on:** 20260802-obs-01
**Systems:** Observability, Testing

Implement LLP 0154 §Deliverables checklist item 2 exactly. The versioned
operation-class registry; the OQ1 projection-matrix ratification against
LLP 0104 checked by shared fixtures that both the telemetry and metering
projections deserialize. The fixture list in the checklist is long and
normative — read it in the LLP and implement it verbatim (derived
multi-metric event ids, no double counts, per-class timing/timestamp
semantics, retry/dedup, registry-version behavior, reset/in-flight
generation races, raw-tail stats across restart, late-completion bucketing,
cap exhaustion, snapshot-bounded export; boundary-protocol: 7→1→7 and
N→0→N `max_days` transitions, clock rollback vs the floor and across an
hour-finalization boundary, hatch/server parity, mid-hour maintenance
exactly-once).

**Exit:** every named fixture exists and passes; the OQ1 ratification is a
dated note in LLP 0154 cross-checked against LLP 0104 — if the matrices
disagree, that's a decision-packet append, not a silent fix.

## Running log

- **2026-08-02 — acceptance gate open, dependency still blocked.** LLP 0154
  is Accepted and obs-01's single generation-bound substrate landed at
  `bf73583dfb748872045a0d98e61b4632d4207076`. Read-only reconciliation
  found the operation-class work otherwise buildable, but checklist 2's
  shared telemetry/metering projection fixtures cannot be ratified while D2
  requires app/environment/release identity and the fixed event schema does
  not choose its durable representation. That author question is already in
  `issues/20260802-author-decision-packet.md`; this ticket will neither omit
  the fields nor invent columns/details/meta semantics. Work resumes when the
  packet supplies the representation and obs-01 can close on it.
- **2026-08-02 — unblocked.** The admission-identity question is RESOLVED in
  the decision packet via a dated LLP 0154 amendment (worked through with
  Charlie in the 0156-promotion session): `release` is a fixed nullable
  column on `telemetry_events` (out of the `details` allowlist);
  app/environment identity is meta-pinned (`telemetry_meta.app_id`/
  `environment`, stamped into exports at egress). For this ticket's shared
  fixtures: projection equality is checked on the composed record (row +
  meta) against the C7 envelope's identity fields. obs-01 should close on
  the amended schema (one added column + two meta fields against the landed
  substrate at bf73583d) before this ticket starts.
