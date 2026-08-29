# LLP 0297 super-refine run journal

Orchestrator: Claude Fable 5 (xhigh), this run's reviser — never a reviewer.
Review families per the current LLP 0010 §2 instantiation (2026-08-20):
codex `gpt-5.6-sol` @ ultra (read-only sandbox) and `grok-4.6` @ xhigh
(headless, full terminal ban in the prompt). Round budget: 3 (default).
Growth budget: ~20% net over the entering revision (479 lines).

Authorization: Charlie Cheever (document author; human with
repository-disclosure authority) invoked `/llp-super-refine` on LLP 0297 in a
live session on 2026-08-24 and separately confirmed the stress-test framing
below. That is document authority (review + revision) and external-send
authority both. Status transition applied at loop start: Draft → Review (the
one authorized transition). Convergence produces a recommendation only;
acceptance is the author's.

Author framing for this run (recorded verbatim in intent): the author is
explicitly unsure that the preliminary recommendation (Option C: split
canonicalization budgets by semantic class) is the right direction. Reviewers
must genuinely stress-test Option C against Options A, B, D, and unconsidered
alternatives; the Confidence section's "High" ratings are themselves under
review, not given; reviewers must flag if Findings 1–5 underdetermine the
recommendation. Rubber-stamping the existing conclusion is a review failure.

Scope-freeze note: the target is `Type: Research`. The LLP 0010 §2 scope-freeze
default applies automatically to `Type: Spec` only; no freeze is applied here
without author authorization. If freezing would plausibly help convergence,
that judgment is surfaced to the author, not decided by the orchestrator.

Blindness: structural — reviewers run with cwd set to a capsule directory
containing only the target and context documents; no `llp/reviews/0297*`
material, run journal, or orchestrator notes are present in the capsule.
Reviews are sealed from each other until both land.

## Round 1 — 2026-08-24

- Target: `llp/0297-client-canonicalization-budgets.research.md` (479 lines)
- Revision hash (r1, sha256):
  `1071a9e61b92eeab6bba045c38f9cd7a3122ee0445cc2a2c3f68fd7a272fc131`
- Topology: single target, two families, one fresh blind full review each.
- Capsule: `scratchpad/0297-loop/capsule-r1/` = target + context (`AGENTS.md`,
  LLP 0114, LLP 0179, `packages/snapback-client/canonical-client-value.mjs`,
  `issues/20260822-guide-gap-generated-app-canonical-node-ceiling.md`,
  `benchmarks/runs/2026-08-22-clique-local-main-grok/record.md`,
  `diaries/0106-grok-clique-explicit-local-main.diary.md`) + `CAPSULE.md`
  (instructions, carrying the author's stress-test framing: argue A/B/C/D on
  the merits; confidence labels under review; note that Finding 3's evidence
  is out-of-repo; one-line factual summaries of excluded LLP 0155/0200).
  Capsule hash (sorted file-hash digest):
  `d40352a7ca34ffdfb31992ab710e3b3552ec38bd0ab07570b983d8008076c4a1`
- Instruction hash (`CAPSULE.md` sha256):
  `265c97d0cf15307b845577dd9179c3c0363329b4e069a7f59a3470118f34ba31`
- Outbound inventory (disclosed before launch): the nine capsule files named
  above — all tracked repository content plus the instruction file; no
  secrets, no `.agent-local-secrets.md`, no review artifacts, no run journal.
- Runners: codex `codex exec --skip-git-repo-check -m gpt-5.6-sol
  -c model_reasoning_effort=ultra -s read-only` (cwd = capsule); grok
  `grok -p … -m grok-4.6 --reasoning-effort xhigh --output-format plain
  --disable-web-search --permission-mode auto --max-turns 200` (cwd =
  capsule; prompt carries a full terminal ban per the 2026-08-20 defaults).
- Launch/receipt status: recorded below on receipt.
- Orchestrator spot-verification during the round (target untouched — a
  mid-round target change voids the round; all items queued for the
  post-round revision regardless of reviewer findings):
  1. Finding 2 evidence confirmed in every particular by the ticket, run
     record, and diary, with one precision caveat: the incident blanked the
     Expo app's **web** boot; and the cited run record labels itself
     "CALIBRATION — not claim-eligible", a label 0297 does not carry.
  2. Finding 2 mechanism correction (verified in source): the boot catalog
     digest goes through `sha256Canonical` — default 4,096-node profile —
     at `packages/snapback-client/react-binding.mjs:1453`
     (`functionCatalogDigest` over `Object.values(references)`) and `:1169`
     (`routeManifestHash`); `sha256GeneratedManifest` (artifact profile) is
     only the offline receipt digest. The 2026-08-01 semantic split exists
     but is incompletely applied; the artifact profile is duplicated
     (`react-binding.mjs:104`, `rqs-preload.mjs:100`) and unexported.
  3. Finding 3 mechanism located (verified in source), answering the
     document's Open Question 1: `consumerVisibleSnapshotKey`
     (`packages/snapback-react/implementation.mjs:980`) canonicalizes the
     complete snapshot including `data` under the default profile purely to
     derive consumer-visible snapshot identity; the refusal is verbatim
     `SNAPBACK_REACT_ARGS_INVALID: React query arguments are not a
     CanonicalClientValueV1: value exceeds the node limit`
     (`canonical-client-value.mjs:34-40`). Some delivery routes swallow the
     throw as a silently dropped frame (`index.mjs` `deliverIsolated`),
     others propagate it; the store-creation path canonicalizes
     synchronously (`implementation.mjs:1863`).
  4. New fact the document lacks: a result admission budget already exists —
     `RESULT_CONTRACT_LIMITS_V1` (`packages/snapback-contract/
     result-contract-validator.mjs:9-18`, `maxResultNodes` 65,536,
     `maxResultBytes` 4 MiB) runs on every delivered React result, so a
     result can be admitted at 65,536 nodes then identity-refused at 4,096.
     Other client result paths already re-label the refusal
     (`SNAPBACK_LIVE_REGISTRATION_ANSWER_INVALID`,
     `SNAPBACK_COMPLETENESS_RESULT_INVALID`, per-row transform codes); the
     React snapshot path is the outlier. This bears directly on the
     C-versus-D balance for the result class.
  5. Corpus sweep: no in-repo derivation of 4,096 exists (Finding 1 holds);
     `llp/0200`'s "max frames 4096" is an unrelated coalescer cap; the
     closed 2026-08-01 ticket's own "revisit the limit deliberately" was
     never done. Limits naming: `maxStringUtf8Bytes`/`maxKeyUtf8Bytes`, and
     per-call overrides are unclamped.

### Round 1 receipts and adjudication

Both reviews received 2026-08-24, persisted verbatim on receipt
(`…codex.md`, `…grok.md`), sealed from each other until both landed.
**codex: NOT READY (M1–M4, m1–m3). grok: NOT READY (M1–M3, m1–m5).**
No cross-family contradiction; deep convergence, and both option rankings
independently demote full Option C below a narrowed hybrid:

- codex M1 ≈ grok M1 (+ grok M2 in part): the result half of Option C is
  underdetermined — Finding 3 is out-of-repo, hypothesis-grade, N=1, and
  Open Question 1 (which call site, protecting which invariant) is a blocker
  for result-profile design, not an RFC-phase detail. **Accepted** → r2
  reframes Finding 3 as hypothesis-grade, adds the orchestrator's verified
  in-repo mechanism (a new Finding 6: `consumerVisibleSnapshotKey`,
  `packages/snapback-react/implementation.mjs:980`, default profile, snapshot
  identity; silent frame drop via `deliverIsolated`'s empty catch,
  `packages/snapback-client/index.mjs:18533`; `RESULT_CONTRACT_LIMITS_V1`
  already admitting results at 65,536 nodes / 4 MiB), and narrows the
  preliminary recommendation: no result profile is named now; the result
  direction becomes an inventory-gated comparison in which D is the default
  prior.
- codex M2 ≈ grok's Option F/G: reusing the 65,536-node receipt profile for
  every complete AppDescriptor/API catalog extrapolates the 2026-08-01
  amendment beyond its accepted scope; the alternative — 0179
  descriptor-digest / prepared opaque binding identity so the hydrated tree
  is not re-walked at boot — must be compared, not assumed away.
  **Accepted** → r2's Finding 2 records the verified mechanism (boot catalog
  through `sha256Canonical`, default profile, `react-binding.mjs:1453`/
  `:1169`; artifact profile only on the receipt digest, duplicated at
  `react-binding.mjs:107`/`rqs-preload.mjs:102`) and the artifact half of the
  recommendation becomes "finish the split, choosing between artifact-profile
  routing and digest/prepared-binding identity, with generate-time counting
  either way" (the open ticket's acceptance bar).
- codex M3 (new, orchestrator-verified in source): the canonicalizer's
  limits are grammar/admission ceilings enforced after container enumeration,
  string encoding, and full output construction — not strict pre-work
  CPU/memory budgets — and a stable transparent proxy is not detectably
  refused (0114's wording is stronger than the shipped behavior).
  **Accepted** → Finding 1 recharacterized; added to the evidence program;
  new open question on the 0114 proxy/resource wording for the future RFC.
- codex M4 ≈ grok's program additions: the evidence program cannot
  adjudicate C vs D. **Accepted** → program gains a purpose/phase map
  (validation, transport admission, retention, equality, cloning, digest
  identity), a D prototype over LLP 0200 version stamps, a descriptor-
  identity prototype, and explicit pass/fail thresholds; "result snapshot"
  is split into transport/structural/retention/equality invariants.
- grok M2: §Confidence "High" ratings not earned. **Accepted** → Confidence
  rewritten: the class-conjunction High split (in-repo catalog facts stay
  High; the 0.1.25 conjunction downgraded); competitor High → Medium;
  affordability Medium → Low; D-feasibility re-based on the now-verified
  call-site evidence rather than the unverified incident.
- grok M3: 0155/0200 unreconciled. **Accepted** → r2 adds the reconciliation
  (0155 fragments are args-keyed with no result node budget; 0200 frames are
  version-stamped; the two unrelated 4,096s named) and the hand-off owner
  map names both documents.
- Minors: all folded — grok m1 (closed 2026-08-01 fixture ticket added to
  Related and cited), m2 (full diagnostic string quoted), m3 (calibration /
  not-claim-eligible label carried), m4 (per-call `options.limits` routing
  made explicit), m5 (kept); codex m1 (unsupported quantitative claims in
  A/B removed), m2 (inheriting-callers phrasing; per-component node counts;
  benchmark-allocation wording), m3 (N=1 calibration, not independent
  corroboration, stated).
- Orchestrator spot-verification items 1–5 (recorded above pre-receipt)
  folded into the same revision.

The revised preliminary recommendation stays inside the document's own
A/B/C/D frame (both families' first choice is C's first two bullets plus
B's diagnostic repair plus a D-leaning result investigation — the document
already called C and D compatible), so this is a revision, not a
fundamental redesign; no author stop is triggered. Revision r2 follows;
round 2 will run as a **delta round** with the delta enumerated and
IN-DELTA vs PRE-EXISTING classification required.

**Growth disclosure:** r2 (sha256
`5678bb4488a7a2b71f0b8bd410d3233ff61cbcb7b30a0882c15e0f0be5f7659c`) is 745
lines vs r1's 479 — **+55.5% net, far past the ~20% guideline**. The growth
is reviewer-demanded resolution content: the call-site inventory both
families demanded (new Finding 6), the purpose/phase evidence-program
expansion (codex M4), the Option E synthesis both rankings converged on, the
0155/0200 reconciliation (grok M3), and the expanded open-question set.
Disclosed here and to the author at close-out; any further net growth in
later revisions with open MATERIAL concerns triggers the growth-budget
escalation rather than silent continuation.

## Round 2 — 2026-08-24 (delta round)

- Target revision (r2, sha256):
  `5678bb4488a7a2b71f0b8bd410d3233ff61cbcb7b30a0882c15e0f0be5f7659c`
- Topology: single target, two families, one fresh blind **delta** review
  each; delta r1→r2 enumerated in the instructions (9 items); every concern
  must be classified IN-DELTA vs PRE-EXISTING. Convergence per the LLP 0010
  §2 addendum: no family reporting a MATERIAL concern in pre-existing text
  converges the loop; in-delta MATERIALs get one more delta round or the
  final revision is labeled unreviewed.
- Capsule: `scratchpad/0297-loop/capsule-r2/` = round-1 context cloned
  (blindness preserved: no review artifacts, journal, or notes) + r2 target
  + three new context files reviewers need to check Finding 6:
  `packages/snapback-contract/result-contract-validator.mjs` (complete),
  `issues/closed/20260801-react-package-fixture-node-limit.md`, and
  `CODE-EXCERPTS.md` (verbatim sed-extracted regions of `react-binding.mjs`,
  `rqs-preload.mjs`, `implementation.mjs`, `index.mjs` with real line
  numbers; excerpt boundaries orchestrator-chosen and disclosed as
  self-attested) + new `CAPSULE.md`. Capsule hash:
  `d68d5b9c09cda1d0ba7dd4005d7ec622aa053742965428d5b345e4994ce3da06`
- Instruction hash (`CAPSULE.md` sha256):
  `c8e7b2737cb54af3da81c586aef4a475c5dee48fb0f095248ee96717867ae522`
- Outbound inventory (disclosed before launch): the twelve capsule files —
  all tracked repository content, mechanical excerpts of tracked content,
  plus the instruction file; no secrets, no review artifacts, no journal.
- Runners: identical to round 1 (codex gpt-5.6-sol @ ultra read-only; grok
  grok-4.6 @ xhigh with full terminal ban). Launch/receipt status recorded
  on receipt.

### Receipt state

- Grok round-2 review received and persisted verbatim: **READY**, with no
  MATERIAL concern in pre-existing text and nine non-material concerns.
- No Codex round-2 artifact was recovered from this interrupted run.
- The two-family delta round is therefore incomplete. It establishes no
  convergence verdict and does not authorize an acceptance transition.
