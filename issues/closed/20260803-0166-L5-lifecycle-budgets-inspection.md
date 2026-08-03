# 0166 L5 — lifecycle, budgets, and policy inspection

**Status:** Open (program: `20260803-0166-impl-program.md`; requires
L2; coordinate with L3/L4 on writer-side files)
**Spec:** LLP 0166 §D3 (Custody budgets), §D5 (the whole section,
including `StorePolicyInspectionV1`)

Scope:

- The demand axis derived from live registrations; owner-state-wins
  precedence (demand never resurrects/delays/downgrades an LLP 0053
  transition).
- Release grace: release-anchored (suppression-end anchored during
  handoff), 14-day default, pinned-pair policy from the last-snapshot
  merge; grace GC as a writer maintenance pass; clock-rollback
  delays-never-accelerates; durable grace clocks.
- Payload-compaction pressure order (undemanded non-pinned → idle
  none/default → pinned → refuse; never `demanded-active`), the
  address-byte tie-break, compaction blockers, blocker-held custody
  with next-pass reclamation.
- Partitioned budgets: the legacy envelope byte-exact and untouched
  (shipped constants/comparator/formula, no cross-section competition);
  the materialization envelope (32 MiB / 256 records / 1,024 fragments)
  with the canonical payload-only byte projection (proofs counted once,
  at the storing fragment record); exclusions bounded per §D3.
- `StorePolicyInspectionV1`: the full closed record — budgets per
  section, registrations (+ `perRecordByteCeiling`), broker
  counts/ceilings, the `constants` object, addresses with `addressKey`,
  demand state, `effectiveRetentionRequest`, the `retainingReason`
  union with fixed precedence, `compacted` — partition-bound, redacted
  per §D5.

Done means: S3 passes in full (order, tie-break carrier-parity,
blockers, grace-pin cases, blocker-held trace, stub reasons) and S8's
policy-record legs pass (ceilings match enforced constants, exactly one
reason per address, no args/labels/foreign-partition leakage); S4 stays
green.

---

**Progress (2026-08-03):** implemented (Codex, session-supervised) and
landed: two-axis precedence, durable release grace (both axes pinned
last-snapshot, suppression-end anchoring, rollback-safe GC), exact
pressure order + tie-break with carrier parity, all blocker classes with
next-pass reclamation, canonical payload projection with legacy-envelope
isolation, partition-bound StorePolicyInspectionV1 with fixed reason
precedence and redactions. 9/9 policy + 14/14 materialization tests.
Open until the umbrella closes.
