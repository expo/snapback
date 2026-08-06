# Super-refine run record — LLP 0186 + LLP 0187 (lockstep cluster)

**Invoked:** 2026-08-06 by Charlie Cheever (author; repository-disclosure
authority), via `/llp-super-refine 0186 0187 — max 2 rounds each`.
**Topology:** lockstep cluster, 0186 primary (reviewers saw both targets;
per-target + set-level verdicts; cluster reviews preserved verbatim in
0186's family artifacts, 0187's artifacts are pointers).
**Status transition applied at loop start:** both targets Draft → Review
(the one authorized transition; this loop proposes, never applies,
anything further).
**Reviser:** the orchestrating session (Claude Fable 5); the reviser
reviewed nothing.
**Families:** Claude — fresh claude-code sub-agents (claude-fable-5);
GPT — codex exec, gpt-5.6-sol, reasoning effort xhigh, read-only sandbox.
**Blindness:** round 1 structurally blind (no artifacts existed for either
stem); round 2 instruction-based exclusion of `llp/reviews/**` and the
out-of-repo run journal, self-attested. Capsule = the repository working
tree in place, read-only, no redaction.

## Rounds

| Round | Revision reviewed | Claude verdict (0186 / 0187 / set) | GPT verdict (0186 / 0187 / set) |
|---|---|---|---|
| 1 | (a) 0186 `33410b51…`, 0187 `90a9616c…` | NOT READY / NOT READY / NOT READY | NOT READY / NOT READY / NOT READY |
| 2 (delta) | (b) 0186 `73d2f0ee…`, 0187 `c5959200…` | **READY / READY / READY** | NOT READY / NOT READY / NOT READY |

Round-1 instruction sha256 `d24b139c…`; round-2 (delta enumeration +
IN-DELTA/PRE-EXISTING classification) instruction sha256 `872764797…`.
Full hashes in the family artifacts' round records.

Round 1 converged across families on the same defects: both documents
stale against the 2026-08-05 evening landing wave (`213607235` et al.),
the presence-miss count (1/3, not 3/3), a one-sided 0186↔0187 ownership
carve-out, and a wrong npm-`latest` premise. Revision (b) reconciled all
of it and filed `issues/20260806-guide-flat-projection-oversize.md`
(growth: 0186 +25% — slightly over the ~20% advisory budget, all
reconciliation annotations, disclosed; 0187 +15%).

## Outcome: terminal on budget exhaustion — escalated to the author

The author's round cap (2) is exhausted without cross-family convergence:
Claude is dual-READY at revision (b) with only DETAIL residue; GPT reports
MATERIAL concerns including in pre-existing text, so the delta-round
convergence rule does not close the loop. There is no factual
cross-family contradiction — the families disagree on altitude, not
facts; every GPT round-2 MATERIAL was verified against the repository by
the orchestrator and found accurate.

**Revision (c) — applied post-loop, UNREVIEWED.** The final verdicts above
bind to revision (b); revision (c) (0186 sha256 `f7b33477…`, 0187 sha256
`8d29d199…`) exists on disk and no review round has seen it. It applies
targeted fixes for the verified round-2 findings:

| Round-2 finding | Class | Disposition |
|---|---|---|
| GPT 0186-1: 26m03s/11m15s attributed to both diaries "with the same agent harness"; 2.3x decomposition overstated | MATERIAL, PRE-EXISTING | Fixed in (c): timing scoped to the relay-room diary; Tandem labeled qualitative replication; attribution labeled qualitative, instrument = W1 |
| GPT 0186-2: "does not depend on their acceptance" contradicts W2's 0176-G2/0179-S1 scaffold | MATERIAL, IN-DELTA | Fixed in (c): scaffold explicitly gated on G2/S1; independence clause scoped; skill/aliases/`/llms.txt` declared independent |
| GPT 0186-3: release-gating ratchet precedes its statistical contract (OQ1/OQ2 open) | MATERIAL, PRE-EXISTING | Fixed in (c): ratchet starts measurement-only; gating activates only after a calibration phase resolves OQ1/OQ2 |
| GPT 0187-1: Summary claims T4/T5 authority the body delegates to LLP 0061 | MATERIAL, PRE-EXISTING | Fixed in (c): Summary now distinguishes diagnosis/requirements (here) from conventions/contracts/carriers (0061) |
| GPT set-1: no dependency graph separating independent W2 artifacts from golden-path-gated ones | MATERIAL, IN-DELTA | Fixed in (c) via the W2 split (same edit as 0186-2); external qualification was already delegated to LLP 0184 P5 / 0176 G4 in 0187 T4 |
| GPT 0187-2 + Claude 0187-1: T1 "all landed" over-broad (live-queries page, react/headless console pointers, alias-row literal) | DETAIL, IN-DELTA | Fixed in (c): claim narrowed to swept pages; residuals enumerated as the conventions amendment's first catches |
| Claude 0186-1: W0 exit vs Sequencing disagree on whether item 5 gates | DETAIL, IN-DELTA | Fixed in (c): exit = items 2 and 5 plus the cold run |
| Claude 0186-2 / 0187-3: bare diary numbers ambiguous (two files numbered 0058); "benchmarked against Convex" approximate | DETAIL, IN-DELTA | Fixed in (c) for 0186 (filenames pinned). 0187's Summary phrasing accepted as-is: quantified claims are Convex-only, which the text states |
| Claude 0187-2: T3 drift figures stale as present-state | DETAIL, PRE-EXISTING | Fixed in (c): past-tensed |
| Claude 0186-3: `benchmarks/` does not exist yet; gate integration unspecified | DETAIL, PRE-EXISTING | Altitude: implementation-phase material inside the wave the Plan owns; not fixed |
| Claude set-2: T1/W2 alias boundary blurs on workload vocabulary | DETAIL, IN-DELTA | Not fixed; noted for the next revision — T7 standing rule + W2 landing covers any register, one sentence would pin it |
| Claude set-3: 0187's leverage ranking depends on W1's instrument (OQ1 risk) | DETAIL, PRE-EXISTING | Not fixed; the falsification-checkpoint sentence in 0186 Sequencing is the hook if the author wants it named |

## Proposed next step (author decides; this loop applies nothing)

Recommend **stay `Review`** for both documents: every MATERIAL finding
from both families is either fixed in revision (c) or was round-1
material fixed in (b); the residue is DETAIL-grade. The honest caveat is
that revision (c) is unreviewed — options are (1) accept the documents at
(c) on the author's own reading, (2) authorize one further delta round to
review (c), or (3) leave both in `Review` until the first W0/W1 execution
results test the Plan's claims in practice. Revert-to-Draft is not
proposed: no reviewer identified a defective program-level decision;
round-2 Claude explicitly found the program design sound and the evidence
base verified.
