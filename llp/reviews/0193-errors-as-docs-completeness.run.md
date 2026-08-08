# Super-refine run journal — cluster 0193-0197 (primary: 0193)

Author authorization: Charlie Cheever, in-session, 2026-08-08 ("do a
couple of rounds of /llp-super-refine on 0193-0197"). Round budget: 2.
Reviser: orchestrating session (Claude Fable 5). Topology: one lockstep
cluster (tight Related-coupling through LLP 0186 and each other);
cluster reviews preserved verbatim in the primary target's artifacts.
Families: claude (fresh cold-context subagent, Fable 5), gpt-5
(codex exec gpt-5.6-sol, xhigh). External-send disclosure: capsule =
the five targets + neutral CONTEXT.md, nothing else; authorized by the
author's skill invocation per standing repository practice.

## Round 1 — launched 2026-08-08

Capsule sha256 (see also /tmp/sr-r1-hashes.txt at run time):
68ef07ba3bba3361fa82cf37615445b49c1105d15a7ea9915fcb56c31dd2f616  /private/tmp/claude-501/-Users-ccheever-projects-snapback/86767887-c355-4855-a690-050c07c87ff1/scratchpad/sr-capsule-r1/0193-errors-as-docs-completeness.plan.md
930ce2f3f30f5ee3746e366331bb92e493969019d88601ebb2765a52e0cc2465  /private/tmp/claude-501/-Users-ccheever-projects-snapback/86767887-c355-4855-a690-050c07c87ff1/scratchpad/sr-capsule-r1/0194-generated-api-reference.rfc.md
0a0d80d2e09068e1b61382bd1647cce9bc63d37f6e74d26c22e77ff1f851b6b4  /private/tmp/claude-501/-Users-ccheever-projects-snapback/86767887-c355-4855-a690-050c07c87ff1/scratchpad/sr-capsule-r1/0195-public-documentation-and-training-surface.rfc.md
400f6dc7fbf99656c62ef96b9ff3c9817614569b13b5863695e7176d11a27b51  /private/tmp/claude-501/-Users-ccheever-projects-snapback/86767887-c355-4855-a690-050c07c87ff1/scratchpad/sr-capsule-r1/0196-template-and-recipe-portfolio.plan.md
739cd7b7243ca86b435123f33243c127fc4b7e98b110ccbc00dc3b818c9e5382  /private/tmp/claude-501/-Users-ccheever-projects-snapback/86767887-c355-4855-a690-050c07c87ff1/scratchpad/sr-capsule-r1/0197-benchmark-publication-standard.rfc.md
d42ee554e3eb9c599f9c1c6ee7c9b08d75c5d4a69e841cd420abf4866a23fc75  /private/tmp/claude-501/-Users-ccheever-projects-snapback/86767887-c355-4855-a690-050c07c87ff1/scratchpad/sr-capsule-r1/CONTEXT.md
Blindness: structural for repo review artifacts (none exist for these
stems at launch; capsule directory contains only the six files above).
Reviewer instructions hash:
4aa10eb48d797301f8102a287c602350b839ce1c6cc1a70d6d1addcbb5c24452  /tmp/sr-review-instructions.txt

## Round 2 (delta round) — launched 2026-08-08, targets at revision 601f867da

Capsule sha256:
035c9368be5c2baf592bab574472bf8260559b3ca1927e8c9f1388ac0e910c93  /private/tmp/claude-501/-Users-ccheever-projects-snapback/86767887-c355-4855-a690-050c07c87ff1/scratchpad/sr-capsule-r2/0193-errors-as-docs-completeness.plan.md
652c11d5e00f78f663130f3de7a7e3d890d3c37513e91a542ca86427a0735199  /private/tmp/claude-501/-Users-ccheever-projects-snapback/86767887-c355-4855-a690-050c07c87ff1/scratchpad/sr-capsule-r2/0194-generated-api-reference.rfc.md
e7c611e3a5cb1e8f25ebbc5b134b5e9a56dcb7d7aa357b79df96fabe41c3e5dd  /private/tmp/claude-501/-Users-ccheever-projects-snapback/86767887-c355-4855-a690-050c07c87ff1/scratchpad/sr-capsule-r2/0195-public-documentation-and-training-surface.rfc.md
9702b4da011b802190c327b518c54ca7a53c8c050b61ab89af0645326e6eff95  /private/tmp/claude-501/-Users-ccheever-projects-snapback/86767887-c355-4855-a690-050c07c87ff1/scratchpad/sr-capsule-r2/0196-template-and-recipe-portfolio.plan.md
3f58aa2abc896a81944010b692bd413707604b462696b0b9ba523ab9a96b4a71  /private/tmp/claude-501/-Users-ccheever-projects-snapback/86767887-c355-4855-a690-050c07c87ff1/scratchpad/sr-capsule-r2/0197-benchmark-publication-standard.rfc.md
d42ee554e3eb9c599f9c1c6ee7c9b08d75c5d4a69e841cd420abf4866a23fc75  /private/tmp/claude-501/-Users-ccheever-projects-snapback/86767887-c355-4855-a690-050c07c87ff1/scratchpad/sr-capsule-r2/CONTEXT.md
Topology unchanged; fresh reviewers both families; delta enumerated in
instructions; concerns must classify IN-DELTA vs PRE-EXISTING.

## Round 2 results and close-out — 2026-08-08

Verdicts at capsule revision 601f867da:
- claude: 0193 READY, 0194 READY, 0195 READY, 0196 NOT READY (1,2,3),
  0197 NOT READY (4,5,6); SET NOT READY.
- gpt-5: 0193 READY, 0194 NOT READY (1), 0195 READY, 0196 NOT READY
  (3,4), 0197 NOT READY (5-12); SET NOT READY.

Incident (recorded per honesty rules): the r1 revision script failed
mid-run at a pattern assertion; the 0196/0197 body edits after the
failure point never executed, while the header-stamping step ran for all
five — r1 headers on 0196/0197 claimed corrections their bodies did not
contain. Both round-2 reviewers caught it independently (claude 1/4,
gpt-5's 0196/0197 blocks). Reviser error, orchestrating session.

r2 revision (applied after round 2; UNREVIEWED by any family):
- 0194: OQ2 hand-written-interim contradiction resolved (named
  exclusion until a declaration file lands) — gpt-5 r2 #1.
- 0196: the full intended r1 set (capability-surface wording ×3, T5
  two-gate split with blocking/canary/ownership, template-assisted
  labeling + held-out-brief rule) — claude r2 1-3, gpt-5 r2 3-4.
- 0197: the full intended r1 set plus round-2 finds: summary restated
  (2.91x→2.24x, directional caveat, not-itself-publishable), rule 1
  preregistration (gpt-5 r2 #12, PRE-EXISTING), rules 4a/4b (starter
  symmetry incl. no-equivalent-starter split reporting; failure
  protocol with budgets/stopping/retention), rule 6 publication-safe
  schema (redaction reason codes, retained hashes, human
  disclosure-authority review), reproducibility manifest + reserved
  "reproduced", series chart exempted from rule 1 as dated narrative,
  26m03s-vs-11m15s cited to diary 0058 (disposing gpt-5 r2 #11
  PRE-EXISTING: the figure is retained; the capsule context lacked
  diary 0058's numbers).
- Pre-existing minors NOT applied this round (dispositioned to the
  next touch): claude r2 #8 (host-ops quote/era precision; enumerate
  0065/0066/0068/0069 instead of the 0065-0069 range), #9 (hashed
  field path pointer — retained in issues/closed/
  20260805-result-contract-violation-hashes-field-path.md; add the
  pointer), gpt-5 r2 #2 [minor list not blocking], claude r2 #7 (mark
  OQ2-contingent entries in 0194's kills list).

Convergence status at loop end (budget 2 rounds, author-set):
- 0193: dual-READY at 601f867da. CONVERGED.
- 0195: dual-READY at 601f867da. CONVERGED.
- 0194: claude READY / gpt-5 NOT READY at 601f867da; the single
  blocking concern is resolved in the r2 revision, which is UNREVIEWED.
- 0196, 0197: both families NOT READY at 601f867da (dominated by the
  unapplied-revision incident); the r2 revision applies the full
  intended set plus round-2 finds and is UNREVIEWED.
Final verdicts bind to 601f867da; the r2 revision (this commit) is
unreviewed by any family. Proposed next step: all five stay Review; an
optional third delta round on 0194/0196/0197 would close the unreviewed
gap; acceptance is the author's.

## Round 3 (delta round) — launched 2026-08-08, targets at revision c4c4bb6a5

Capsule sha256:
94cd9b805719448a8c4a1856e0b0c8dc44c5502333b7042767f556ef4ff017a7  /private/tmp/claude-501/-Users-ccheever-projects-snapback/86767887-c355-4855-a690-050c07c87ff1/scratchpad/sr-capsule-r3/0193-errors-as-docs-completeness.plan.md
c9b1b689285b3c3fd60d4bcccc17ec459a5a31af415e977ba2bb0d8aeebfd80c  /private/tmp/claude-501/-Users-ccheever-projects-snapback/86767887-c355-4855-a690-050c07c87ff1/scratchpad/sr-capsule-r3/0194-generated-api-reference.rfc.md
b9482d5d84e45d0c35e71d96b82442415b22eab36481577106642b70fde309af  /private/tmp/claude-501/-Users-ccheever-projects-snapback/86767887-c355-4855-a690-050c07c87ff1/scratchpad/sr-capsule-r3/0195-public-documentation-and-training-surface.rfc.md
5376a287af06c5d9ad7e9c6fa6ccbee612282a1e6c4e2fa3a77c0d16dc42b601  /private/tmp/claude-501/-Users-ccheever-projects-snapback/86767887-c355-4855-a690-050c07c87ff1/scratchpad/sr-capsule-r3/0196-template-and-recipe-portfolio.plan.md
5b7110b9e17ed6afbc6ccb3acbd03084ef0f0490735bc7ad57effb089bb339ce  /private/tmp/claude-501/-Users-ccheever-projects-snapback/86767887-c355-4855-a690-050c07c87ff1/scratchpad/sr-capsule-r3/0197-benchmark-publication-standard.rfc.md
fe51c2836a0297c78322937c89f02348a56d0a72628723ef2defe4064f7a64d1  /private/tmp/claude-501/-Users-ccheever-projects-snapback/86767887-c355-4855-a690-050c07c87ff1/scratchpad/sr-capsule-r3/CONTEXT.md
CONTEXT.md gains diary 0058's retained wall numbers (round-2 gpt-5 #11
arose from their absence). Fresh reviewers both families.

## Round 4 (delta round) — launched 2026-08-08, targets at revision 68da5ad37

Capsule sha256:
4a4dac1a7f78d7f0049106b9f629309b24a4f60d3ff3334540dd329dc6458cd0  /private/tmp/claude-501/-Users-ccheever-projects-snapback/86767887-c355-4855-a690-050c07c87ff1/scratchpad/sr-capsule-r4/0193-errors-as-docs-completeness.plan.md
1847412ebe8831f4f52e7645743029b32c415e3121d6ed744b2bc75a1a954980  /private/tmp/claude-501/-Users-ccheever-projects-snapback/86767887-c355-4855-a690-050c07c87ff1/scratchpad/sr-capsule-r4/0194-generated-api-reference.rfc.md
2f8b0df063e863773048bb33bd55c0ca8a9db729345f203cd60fe70e2cd66ce7  /private/tmp/claude-501/-Users-ccheever-projects-snapback/86767887-c355-4855-a690-050c07c87ff1/scratchpad/sr-capsule-r4/0195-public-documentation-and-training-surface.rfc.md
ef7727c9d84e9b68c2cbc6aa644827aa4721d31b466bec94bd5ab3fd5c7c204a  /private/tmp/claude-501/-Users-ccheever-projects-snapback/86767887-c355-4855-a690-050c07c87ff1/scratchpad/sr-capsule-r4/0196-template-and-recipe-portfolio.plan.md
c243bac401e91c9716e24d9f19bccfe963c7913849de9070f3c3269a77ba76d5  /private/tmp/claude-501/-Users-ccheever-projects-snapback/86767887-c355-4855-a690-050c07c87ff1/scratchpad/sr-capsule-r4/0197-benchmark-publication-standard.rfc.md
fe51c2836a0297c78322937c89f02348a56d0a72628723ef2defe4064f7a64d1  /private/tmp/claude-501/-Users-ccheever-projects-snapback/86767887-c355-4855-a690-050c07c87ff1/scratchpad/sr-capsule-r4/CONTEXT.md
Round-3 artifacts appended below round-2 sections; round-3 verdicts:
claude ALL READY / SET READY (5 minors); gpt-5 0193/0195/0196 READY,
0194 (1), 0197 (2,3) — all IN-DELTA, zero PRE-EXISTING MATERIAL.
r4 applies gpt-5's three finds + claude minors 1,2,3,5.

## Round 5 (final delta round) — 2026-08-08, targets at 567fab93b

Capsule sha256:
31fb3b3a792a983fb9399efc895c4ae26729a40d67dac0d62b158f4477fde2f4  /private/tmp/claude-501/-Users-ccheever-projects-snapback/86767887-c355-4855-a690-050c07c87ff1/scratchpad/sr-capsule-r5/0193-errors-as-docs-completeness.plan.md
922b04ddf9e41851aa774009377914b4f5563fcef0e34c3a9483ba40df1d556d  /private/tmp/claude-501/-Users-ccheever-projects-snapback/86767887-c355-4855-a690-050c07c87ff1/scratchpad/sr-capsule-r5/0194-generated-api-reference.rfc.md
dd48624740f9b3c8fc93d6e152c43a39a0e6414d773a6d52fdd0e2c5a6dae137  /private/tmp/claude-501/-Users-ccheever-projects-snapback/86767887-c355-4855-a690-050c07c87ff1/scratchpad/sr-capsule-r5/0195-public-documentation-and-training-surface.rfc.md
fc3d76dc2b02156cb00c10b7d3b145b761d8e4a4f23103b7ac0f117ab3ef93cd  /private/tmp/claude-501/-Users-ccheever-projects-snapback/86767887-c355-4855-a690-050c07c87ff1/scratchpad/sr-capsule-r5/0196-template-and-recipe-portfolio.plan.md
10c60bf7e3179a63fcb852b3537826ec726c66a82f6b83c206587ebb02c607d4  /private/tmp/claude-501/-Users-ccheever-projects-snapback/86767887-c355-4855-a690-050c07c87ff1/scratchpad/sr-capsule-r5/0197-benchmark-publication-standard.rfc.md
edaadaecd4152575d9e7231b8bf5084c1b5e3119ed6b7d80c3a594c6d6a808fe  /private/tmp/claude-501/-Users-ccheever-projects-snapback/86767887-c355-4855-a690-050c07c87ff1/scratchpad/sr-capsule-r5/CONTEXT.md
Delta: 0194 verify-config into initial scope (round-4 claude find:
verify.d.mts already exists/published), OQ2 narrowed to ctx; 0197
rule-4b ratio floor; 0193 retrofit-exemplar relabel + reclassification
gating + 0065 slug; 0195 slug only; 0196 unchanged; per-document r5
headers. Round-4 claude body appended below.

## Round 5 results and FINAL close-out — 2026-08-08

Verdicts at capsule revision 567fab93b:
- claude: 0194/0195/0196/0197 READY; 0193 NOT READY (1 — sibling-ticket
  provenance inside the r5 relabel); SET NOT READY on that alone.
- gpt-5: 0193 NOT READY (1 — retrofit still in the observed Evidence
  list), 0194/0195/0196 READY, 0197 NOT READY (2 — 4b not
  denominator-aware); SET NOT READY.

CONVERGENCE at loop end (5 rounds run; author authorized 2 + up to 3
more; budget exhausted):
- 0194, 0195, 0196: DUAL-READY at 567fab93b. CONVERGED.
- 0193, 0197: no family reports any PRE-EXISTING MATERIAL concern in
  either round-4 or round-5; every open item is IN-DELTA, one-sentence
  scale, and resolved by the r6 revision — which is UNREVIEWED.
  Final verdicts bind to 567fab93b; r6 exists and is unreviewed.

Disposition ledger, round 5 (complete):
- claude #1 (0193 provenance) FIXED in r6 (sibling ticket pair cited
  correctly). claude #2 (mechanical reclassification gate) FIXED in r6
  incl. exit-criterion negative test. claude #3 (4b wording/threshold
  preregistration) FIXED in r6. claude #4 (post-run grading) FIXED in
  r6. claude #5 (published-vs-repo .d.mts fencing) implementation-
  phase, dispositioned to build time.
- gpt-5 #1 (retrofit in observed list) FIXED in r6. gpt-5 #2 (4b
  denominator awareness) FIXED in r6. gpt-5 minors: dispositioned in
  the artifact (altitude rule).

Proposed next step: all five remain Review. 0194/0195/0196 are
candidates for author acceptance as-is; 0193/0197 carry a one-round
unreviewed r6 tail an optional future delta round can clear.
Acceptance is the author's; this loop applies no further transitions.

## Round 6 (author-update round) — 2026-08-08

Author (Charlie) edited all five targets in the primary checkout
against the r0 base (54fa456cf) while the loop ran; diff preserved
verbatim at llp/reviews/0193-0197-author-input-20260808.diff
(sha256 0e3b674e0c05b0fe797133452d802b78161d845deb653a355cda958cbcf170d1).
Reviser merges author content onto r6 as r7; author design decisions
override loop decisions; review-verified FACTS override r0-based
phrasing, each such override enumerated in the round-6 delta.

Round 6 capsule (r7 targets at 10cf97887) sha256:
21dcf7bc9b649fe0640c34dbafe2e8975656c4c3e86d6dcbdc7caef56750860d  /private/tmp/claude-501/-Users-ccheever-projects-snapback/86767887-c355-4855-a690-050c07c87ff1/scratchpad/sr-capsule-r6/0193-errors-as-docs-completeness.plan.md
055c16cb0497d711f0a407b894024359465720fefe0123925c64a88f371a23f7  /private/tmp/claude-501/-Users-ccheever-projects-snapback/86767887-c355-4855-a690-050c07c87ff1/scratchpad/sr-capsule-r6/0194-generated-api-reference.rfc.md
37cedaaff2aec52469b6c0bc98e15b9a00e7cfb02fbb2bcd653a73955da73d1b  /private/tmp/claude-501/-Users-ccheever-projects-snapback/86767887-c355-4855-a690-050c07c87ff1/scratchpad/sr-capsule-r6/0195-public-documentation-and-training-surface.rfc.md
86a2be37ea11ed62c006d1b2687d16bbdc446be9773f37074584676383e2edfa  /private/tmp/claude-501/-Users-ccheever-projects-snapback/86767887-c355-4855-a690-050c07c87ff1/scratchpad/sr-capsule-r6/0196-template-and-recipe-portfolio.plan.md
aa9c776f2200a9ebc7800ac6252ee0a4084769810501c9c91844dcb3592ff33b  /private/tmp/claude-501/-Users-ccheever-projects-snapback/86767887-c355-4855-a690-050c07c87ff1/scratchpad/sr-capsule-r6/0197-benchmark-publication-standard.rfc.md
edaadaecd4152575d9e7231b8bf5084c1b5e3119ed6b7d80c3a594c6d6a808fe  /private/tmp/claude-501/-Users-ccheever-projects-snapback/86767887-c355-4855-a690-050c07c87ff1/scratchpad/sr-capsule-r6/CONTEXT.md

Round 6 verdicts (both bind to capsule sr-capsule-r6, targets at
10cf97887 / r7):
- claude: 0193 READY, 0194 READY, 0195 READY, 0196 NOT READY (solely
  the stale "rules 4a/4b" pointer into the renumbered 0197 — must read
  "rule 10"), 0197 READY. SET NOT READY on that one in-delta MATERIAL;
  seven minors (three-of-six enumeration, carrier-ships trigger,
  bootstrap retirement, D3/D4 dependency notes, odd-N balance,
  exit-criterion-5 bounding).
- gpt-5: all five REVISE. Eight in-delta MATERIALs: 0193 carrier/target
  conflation, candidate-closure anchor validation, ineffective-A-grade
  exit loophole; 0194 type-only export parity, bootstrap retirement
  enforcement; 0195 OQ4 causal overclaim; 0196 holdout scope narrower
  than rule 10 (+ the same stale pointer); 0197 rule-5 public/private
  boundary undefined (low-entropy-hash confirmation attacks). One
  minor: exact balance impossible at odd N.
Neither family reported a MATERIAL concern in pre-existing text
(claude minors 5 and 6 are PRE-EXISTING but minor; everything MATERIAL
in both reviews is IN-DELTA author-merge material). No cross-family
contradiction — claude's MATERIAL is gpt-5's #7, claude minor 4 ≈
gpt-5 #5, claude minor 7 ≈ gpt-5 #9, claude minor 8 overlaps gpt-5 #3;
the families otherwise found disjoint concerns.

## Revision r8 — 2026-08-08 (round-6 fix set, reviser: orchestrator)

Union of both families' round-6 concerns applied:
- 0193: ledger remediation fields made orthogonal — emitted
  representation (structured|message-text), remediation target kind
  (inline-fix|guide-anchor|reference-symbol), OQ6-selected mechanism
  (gpt-5 #1); unreleased diagnostics validate against the exact
  candidate/build closure digest with release-time revalidation, and
  remediation+anchor must name the same closure (gpt-5 #2); exit
  criterion 5 requires downgrade+refix+successful retest for an
  ineffective A-grade, bounded to the first post-ratchet run with the
  standing rule in Phase 4 (gpt-5 #3, claude minor 8); carrier trigger
  is OQ6 carrier SHIPPING, not the ruling (claude minor 3); the
  three-of-six refusal-reachable residues enumerated as diary-0069
  residues 1/4/6 vs 2/3/5 (claude minor 2).
- 0194: acceptance 1 split into value-space runtime parity +
  type-space non-runtime registry kinds (gpt-5 #4); acceptance 2 now
  requires bootstrap removal or conversion to a generated projection,
  CI duplicate-ownership rejection, check-guide coverage while it
  lives, and names its retirement trigger (gpt-5 #5, claude minor 4).
- 0195: OQ4 recast as familiarity surveillance only — epochs
  separately reported, corpus evidence or controlled ablation required
  for training attribution (gpt-5 #6); per-release snapshots marked
  proposed-D3-default (claude minor 5).
- 0196: "rules 4a/4b" → "rule 10" (claude MATERIAL, gpt-5 #7); holdout
  adopts rule 10's full aid scope and "substantially implemented" test,
  including OQ3, with D4 owning publication timing (gpt-5 #7).
- 0197: rule 5 gains the explicit public/private boundary — public
  normalized invocation metadata + opaque evidence IDs,
  access-controlled private store, keyed integrity commitments (not
  plain hashes of low-entropy values), fail-closed publisher (gpt-5
  #8); rule 2 defines near-balance at odd N and exact-balance
  divisibility (gpt-5 #9, claude minor 7); rule 3 conditioned on 0195
  D4 with a named alternate public home (claude minor 6).
Dispositioned without body change: claude minor on D3/D4 wording
overlap (altitude — implementation-phase phrasing); gpt-5's REVISE
framing of 0193/0194/0195 as set-wide (their per-document concerns are
the ones enumerated above; no additional unlisted concern exists in
either body).
ref-check clean. r8 is the round-7 target.
