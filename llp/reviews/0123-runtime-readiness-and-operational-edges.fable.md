# LLP 0123 review — Fable family


## Round 1 — 2026-07-30

**Reviewer family:** Claude Fable
**Provider / runtime:** Anthropic Claude Code, `claude-fable-5`, fresh general-purpose subagent
**Effort:** session-inherited
**Date:** 2026-07-30
**Redacted:** no
**Method:** fresh non-author subagent context, read-only review of the
working tree at commit 40ca18b9, mutually blind (no llp/reviews/
artifacts for LLPs 0116–0125 read)
**Target SHA-256:** `b5cde08b1a1a33551c5f2d6f2bfde7624b824b88c134938cc6efa793730213e5`
**Instruction SHA-256:** `30c38e1a8f68e1684dc5373f8651842526556e278804dcffad9a78e2d216292e`
**Status:** completed

## 1. Overall assessment

This is the strongest-grounded document I have reviewed in this series'
style: I spot-checked roughly forty load-bearing claims against the
diaries, the issue file, the three runtime scripts, both build.rs files,
`src/runtime.rs`, the two runtime packages, and LLPs 0010/0030/0031/0041/
0074/0115/0122, and every one held, including exact quotes, the Diary 0033
timeline, and the subtle kept-target-vs-disposable-target distinction
between bootstrap and doctor. Provenance labeling is exemplary and the
empirical-question discipline is real (the rsync-mtime hypothesis is
carried as explicitly unconfirmed everywhere it appears).

Against the stated bar — pre-empirical analysis exhausted on this front —
it falls one option short. The document's own central finding is that
every green signal "measured something adjacent to the contract" and the
diagnostics "were pointed at the wrong boundary," yet the option space
contains no server-side readiness lane: the serving process qualifying its
own handler VM at boot and carrying that verdict on `/health`. That is a
genuinely distinct, first-resort-caliber option on the document's core
question, and its absence means the option space is not yet exhausted.
Everything else I found is detail-level.

## 2. Strengths

- **Factual accuracy under spot-check is essentially perfect.** The
  Summary's incident reconstruction matches
  `issues/20260730-bootstrap-smoke-does-not-create-armed-handler-vm.md`
  and Diaries 0032–0036/0038 (Diary 0037 has zero occurrences of the
  refusal strings, confirming six-of-seven); the Diary 0038 crux quote is
  verbatim (diary lines 153–154); the refusal string exists at
  `vendor/ibex/src/engine/hermes_runtime.cc:5913`; the Diary 0033
  timestamps (00:52:53/00:55:00/00:55:57) are exact; the LLP 0074 sentence
  is verbatim (0074 line 529).
- **§The bootstrap/doctor/harness triad is precisely right,** including
  details that would be easy to get wrong: bootstrap invokes the smoke
  with `--target-dir "$ROOT/target" --keep-target` (kept target,
  `scripts/bootstrap-ibex-runtime` line 278–279) while doctor invokes it
  bare (`--json`), getting the smoke's default disposable mkdtemp target
  (`scripts/runtime-link-smoke.mjs` lines 222–237); the harness probe
  gate `if (plan.rung !== 'cargo') return;` is at
  `demos/_kit/server-process.mjs` line 308; `verify-local-proof` defaults
  `SNAPBACK_BOOTSTRAP_CHECK` to 0 (line 114).
- **§Why the framework loads dynamically today is verified investigation,
  not received wisdom.** `HERMES_LINK_STATIC`, the `hermesvm_a`/
  `hermesvmlean_a` names, the `libjsi.a`/`libboost_context.a` bundle, the
  `macos-static` dir, and the `build-hermes.sh --release` pointer all
  match `vendor/ibex/build.rs` (lines 874–1099); the top-level build.rs
  LC_RPATH rationale and the Linux `$ORIGIN/../lib` rpath match
  `build.rs` lines 1–39. The chain "prepared artifacts → download →
  from-source" matches `download-hermes.sh`'s own contract (its header
  names the from-source fallback on any miss).
- **Provenance hygiene (§What Convex does, §Confidence).** The split
  between "Diary evidence (labeled)" and "General background (not
  diary-verified)" is exactly what the review bar asks for, and the
  Confidence section re-ranks the same material honestly. "Every final
  Convex arm started cleanly" is a literal sentence in Diary 0039 (§Fewer
  framework-specific operational edges, one of exactly four "Where Convex
  is better" headings, as claimed).
- **§How they differ contains real synthesis.** "Identity is not
  readiness" and the counterfeit-negative-check hazard (Finding 4) are
  correct readings of Diary 0032 lines 154–158, and Finding 8's
  ABI-narrow-but-checkpoint-captive conclusion matches the actual extern
  surface in `src/runtime.rs` (lines 514–551).
- **Option assessments are fairly costed and owner-routed.** Option 1
  credits CV-2/CV-3 rather than redesigning them and states their
  residual honestly; options 2/3/6 name their real costs; option 4
  declines to recommend an engine; ownership pointers (0041 packaging,
  0122 single-binary, 0010/0030/0031 for the triad) check out, and
  LLP 0122's own open question 5 reciprocally names a joint spike with
  this document.

## 3. Concerns

1. **BLOCKING-FOR-BAR — the option space omits the server-side readiness
   lane.** All six options are tool-side (bootstrap/doctor/harness
   receipts — option 1), distribution-side (2/3), engine-side (4), or
   experience-side (5/6). Missing: the serving process eagerly qualifying
   its own handler VM at startup — create and destroy the same VM
   `RuntimeGuard::create` uses at boot, surface the verdict in `/health`
   (whose build-identity block, LLP 0031/ENG-22798, is identity-only
   today), and refuse or mark degraded when it fails. This option is
   genuinely distinct from option 1: it has no receipt custody or
   invalidation problem (the running process is its own witness), it
   works identically for every distribution shape and every harness rung
   including `configured`/`prebuilt`/reused, it catches drift that occurs
   after bootstrap ran, and it would have converted the incident — whose
   defining feature the document itself states as "servers launched and
   served `/health`" while JS-dead — into a loud, self-diagnosing launch
   or health failure regardless of refresh ordering. A closely related
   unnamed sub-option: invocation-error fidelity. The document records
   that diagnosis "required inherited server output and a parallel
   lane's cross-observation," i.e., `SNAPBACK_RUNTIME_CREATE_FAILED`
   does not carry the native refusal reason; making the coded error
   self-diagnosing is an operational-edge option on this exact front and
   is never posed. Neither CV-2 nor CV-3 covers this (their consumers
   are doctor/bootstrap/harness/verify-local-proof; the issue's
   resolution criteria are bootstrap-side), so it is not
   credited-to-owner — it is absent. **Resolution:** add it as an option
   (or an explicit sub-option of option 1) with honest costs
   (boot-time VM creation cost, degraded-vs-refuse semantics interacting
   with LLP 0030 lifecycle, the readiness bit becoming a second thing to
   keep truthful — the document's own OQ4 caution applies), and its
   owner interactions (LLP 0031 for `/health`, LLP 0030 for lifecycle) —
   or state why it was deliberately excluded.

2. **DETAIL — "Hermes created VMs in microseconds when coherent" (§How
   they differ) overstates the recorded evidence.** The citation
   (`bench_runtime_create_us`, `src/runtime.rs`) establishes that a
   measurement function exists, not a magnitude. The corpus's recorded
   numbers put VM creation at ~55% of a ~3.6 ms fresh invocation, i.e.
   roughly 2,000 µs (LLP 0035 §M2 line 124; LLP 0032 M2 measurements).
   "In microseconds" is literally the unit but reads as a speed claim
   the measurements do not support at face value. The argumentative
   point (engine quality is not the differentiator) survives the
   corrected number. **Resolution:** cite LLP 0035 §M2's measured
   decomposition, or reword to "VM creation cost was never the incident's
   cause."

3. **DETAIL — CV-15 ownership conflicts with LLP 0115's status board.**
   §Relationship states "LLP 0031 owns `/health` binary identity (and
   CV-15's `unpinned` wording)," but 0115's board assigns CV-15 to
   "0010 harness" (llp/0115 line 165). LLP 0031 does define the verdict
   vocabulary including `unpinned` (0031 §Server-binary identity, ~line
   740), so the attribution is defensible on the corpus reality — but an
   implementer following this sentence and one following the plan's board
   land in different documents. **Resolution:** align the sentence with
   the board, or note the board's owner cell as the thing to correct.

4. **DETAIL — Finding 5's "detection-shaped" slogan undersells CV-2's
   prevention half.** CV-2's work text owns "a framework refresh must
   invalidate or relink the final binary before qualification runs, or
   the qualification is theater" (llp/0115 lines 267–270) — which
   removes the known refresh-ordering manufacturing mechanism, not just
   detects it. Option 1's own residual-risk paragraph is accurate
   (out-of-band refreshes still exist and only 2/3 remove the class);
   the finding's compression mildly contradicts it. **Resolution:**
   reword Finding 5 to acknowledge CV-2's ordering fix while keeping the
   correct claim that only options 2/3 remove the class including
   out-of-band refresh paths.

5. **DETAIL — decision-hygiene tilt in Option 3.** "the correct
   observation being that this property is the bug surface, not a
   feature adopters need" pre-judges the exact tradeoff Open Question 3
   routes to a ratifier. It is one clause, and the document is otherwise
   scrupulous about not deciding. **Resolution:** attribute it as this
   analysis's assessment ("this analysis found no adopter-facing need
   for swap-without-relink") rather than "the correct observation."

## 4. Suggestions

- Cite Diary 0037 as the in-corpus control case for the blast-radius
  boundary claim: the one rerun arm that avoided the incident is the one
  whose exercised lane was native search (Diary 0037 line 82 explicitly
  marks its own issue "independent of the Hermes JS-runtime incident"),
  which strengthens §Why the native runtime lane exists.
- Option 3 could state precisely what static linking converts the
  residual failure into: a defeated relink then serves an old but
  self-coherent engine — staleness, not incoherence — which is the
  document's argument in one sentence.
- Option 6 could name `.github/workflows/public-package-proof.yml`
  (LLP 0041's GitHub-hosted cold-proof matrix) as the nearest existing
  runner shape, sharpening the cost estimate beyond "macOS runners and
  wall-clock."
- OQ4 currently proposes a mechanism (a readable checkpoint-contract
  stamp) without an actor; naming who reads it and when (bootstrap?
  doctor? the server at boot?) would make the question answerable — and
  connects naturally to concern 1's missing option.

## 5. Open questions

- Should the server-side readiness lane land here as a seventh option, or
  directly in the owners (LLP 0031 `/health`, LLP 0030 lifecycle) as a
  CV-2/CV-3 amendment consumer? Either placement satisfies concern 1;
  the choice is the author's.
- Is the counterfeit-negative-check hazard (Finding 4) worth graduating
  from a finding into an explicit acceptance-harness obligation somewhere
  in the CV-2/CV-3 exits ("rejection predicates count only after armed
  readiness is proven"), or is that already implied by CV-3's exit
  language?

## 6. Verdict

**NOT READY** — solely on concern 1. The document's factual layer,
provenance hygiene, empirical honesty, and decision hygiene all clear the
bar; the option space, which is this document's core deliverable, is
missing one genuinely distinct first-resort option on its central front,
so pre-empirical analysis is not yet exhausted. The fix is small and
bounded: one added option (or an explicit exclusion rationale) plus the
four detail corrections.

## 7. Recommended next step

Author adds the server-side readiness option (boot-time VM qualification
surfaced on `/health`, plus reason-carrying invocation diagnostics) with
costs and owner interactions, applies the four detail fixes (microseconds
wording, CV-15 owner alignment, Finding 5 rewording, Option 3
attribution), and returns for a round-2 delta review. No structural
changes needed; I expect round 2 to be READY on inspection of the delta.
