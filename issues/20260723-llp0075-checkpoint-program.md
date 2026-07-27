# LLP 0075 Convex checkpoint protocol — pre-rerun program (index)

**Status:** Open
**Impact:** 4
**Urgency:** 4
**Ease:** 1
**Confidence:** 4
**Score reviewed:** 2026-07-26
**Score rationale:** The ticket evidence for “LLP 0075 Convex checkpoint protocol — pre-rerun program (index)” shows the issue materially affects a supported product or engineering path; delay compounds an active rollout, reliability, or verification risk, while delivery is a dependency-heavy, multi-stage program, with specific cited code, progress, or acceptance criteria.
**Severity:** P2
**Systems:** Competitive evaluation, Developer experience, Deployment, Actions, Testing
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-23
**Related:** LLP 0075 (authority), demos/competitive-checkpoint/acceptance/{protocol.v0.json, implementation-status.v0.json}, LLP 0063 (program sequencing/change control), LLP 0074, llp/reviews/0075-convex-checkpoint-protocol.{fable,codex}.md
**Marker:** program-index, llp-0075, competitive-checkpoint, super-refine-residue

Umbrella index for the work surfaced by the 4-round /llp-super-refine on LLP
0075 (Fable READY from round 2; Accepted by direct author decision). Unlike
0076/0077 this program is mostly **author decisions and pre-timed-run pinning
amendments**, not a code-defect ledger — no timed comparison sample has run,
and every unpinned input is deliberately marked `unpinned-blocks-timed-runs` in
`protocol.v0.json`. The machine-readable protocol and its amendment log are the
single source of truth; any protocol change is a dated amendment there plus a
refreshed digest pin in the Spec.

**Progress (2026-07-24):** the Accepted-vs-Review decision is closed: the
author ratified v0.1–v0.3 and retained Accepted status without authorizing
timed runs. Candidate statistics, metric, gate-matrix, run-capsule-verifier,
and mechanical-scoring instruments pass their untimed tests but remain
unratified. The concrete adapter/provider choices and remaining pre-run pins
below still block every timed sample.

Instrument corrections (code + prospective rerun; the only "do" work today):

- `20260723-llp0075-instrument-corrections.md` — the retained local-streaming
  receipt's hardcoded target alias and the missing cross-user delete witness
  (from `implementation-status.v0.json` `knownInstrumentDefects`)

Blocking before any timed run (a single versioned amendment, but each is an
author decision):

- `20260723-llp0075-pre-timed-run-pins.md` — assistance policy, statistics
  implementation, rubric per-arm anchors + non-author scorer, frontend hosting
  boundary, and the content-addressed run capsule

Standalone author decisions:

- `20260723-llp0075-status-disposition.md` — **closed:** Accepted stands on
  named-author authority over the recorded dissent
- `20260723-llp0075-program-ownership.md` — the long-lived program owner, and
  the provider/region/object-store/credential backend for the first
  `single-instance-container-vm.v1` remote drill
- `20260723-llp0075-comparison-fairness.md` — the Convex local-leg topology,
  margin rationales + minimum-detectable-effect, and the post-v0 generalization
  / holdout policy

Sequencing: the instrument corrections and the pre-timed-run pins both gate the
first timed two-arm sample; the fairness and ownership decisions feed the pins;
the status disposition is independent and owned solely by the author.
