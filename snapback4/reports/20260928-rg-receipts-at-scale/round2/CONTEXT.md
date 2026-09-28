# RG round 2 context pack

Scope: `local.ts`/`local-receipts.ts` FIFO settlement, small-range count tests,
the generated Chromium witness and the evidence report. Used `llp-orient`
from `lane-i/vendor/llp/skills/llp-orient/SKILL.md` read-only; this worktree's
vendor skill link is uninitialized. No tool installed.

Governing LLPs:

1. LLP 3000#1 and #7: Snapback 4 fence and execution decisions (root).
2. LLP 3000.015#3: authorized live row-keyed counts and internal work ledger
   (`llp/current/`).
3. LLP 3000.019#3.3: FIFO outcomes and shared settlement sync (`llp/current/`).
4. LLP 3000.022#2, #3 and #4: SDK delivery coverage/reporting (`llp/current/`).

Active constraints and rationale:

- LLP 3000.015#3: the necessary index range is a candidate superset; expiry
  and the full predicate still decide the count. The 65-probe cutoff, charged
  fallback allowance and public reservation remain as qualified in round 1.
- LLP 3000.019#3.3: later admitted writes retain FIFO without intermediate
  sync; a terminal or retired tail must not strand an earlier unobserved success.
- LLP 3000.022#2.2: success is coverage. Receipt telemetry adds scalar unread
  reads; it never turns a count or unreceived position into delivery evidence.
- Current authoring facts checked against receipts, maintains and sequences
  cards: keyed unread reads return a scalar; the SDK owns delivery collection.

Risks: round 1 already fixed the ordinary refused-tail path and cost text;
round 2 must verify those rather than silently claiming them as new. The
witness needs its own count oracle because receipt text alone cannot validate
unread. Report the pre-migration timeout only, without an E_BOUND attribution.

Likely doc updates: LLP 3000.019#3.3 exit checks, both reports' evidence
attribution, and an append-only journal correction. No new design document,
capability, ceiling, publication or external messaging is authorized.
Hand-off: none.
