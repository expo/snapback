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

## Round 2 — 2026-07-30

**Reviewer family:** Claude Fable
**Provider / runtime:** Anthropic Claude Code, `claude-fable-5`, fresh general-purpose subagent
**Effort:** session-inherited
**Date:** 2026-07-30
**Redacted:** no
**Method:** fresh non-author subagent context (round-2 delta), read-only
review of the working tree at commit 97946b33, cross-family blind
**Target SHA-256:** `5724a474fcc22586eca5d16dda3a68340394a78a4d38bcb19236725c687a7192`
**Instruction SHA-256:** `33c3fd21fcc61f4ed59da1207ef188e75a1328149be03f08f57ca9141b06f7ce`
**Status:** completed

## 1. Resolution check — round-1 Fable concerns

1. **BLOCKING-FOR-BAR (missing server-side readiness lane) — RESOLVED.**
   New Option 2 is exactly the requested option, with the requested
   invocation-error-fidelity sub-option, honest costs, and owner routing
   (0031 `/health`, 0030 lifecycle, 0010 diagnostics), plus a new
   Finding 11 and OQ9. Every factual claim in it survived spot-check:
   `HealthResponse` carries exactly `ok`/`target`/`sqlite_version`/
   `ibex_available`/`auth_provider`/`binary` and the handler creates no
   VM (`src/server.rs` lines 6245–6263, 15247–15268); `ibex_available`
   is `capabilities.ibex_cli.available || ibex_ctx_db_host_bridge ==
   Available` — CLI/bridge *presence*, as stated; the `binary` block is
   the ENG-22798 identity block (doc comment at 6255–6262).
   `SNAPBACK_RUNTIME_CREATE_FAILED` carries only the two fixed strings
   (`src/runtime.rs` 617–628), and the claim is even stronger than
   stated: `ex_hermes_create_no_eval()` returns a bare null pointer on
   refusal (line 614), so no reason *can* reach the coded error today —
   the native message ("Armed startup refused: Hermes promise rejection
   checkpoint tracking is unavailable") is verbatim what the incident
   issue records from inherited stderr (issue line 31; the underlying
   throw at `vendor/ibex/src/engine/hermes_runtime.cc:5913`). The ~2 ms
   boot cost matches LLP 0035 §M2 (~55 % of ~2 700–3 900 µs). The rung
   claim holds: `'configured' | 'prebuilt' | 'cargo' | 'reused'`
   (`demos/_kit/server-process.mjs` line 661), the link probe gated to
   `cargo` only (line 308), reuse decided on a `/health` provenance
   verdict and `prebuilt` on `requireVerified` identity — presence plus
   identity, no VM. The `runtime-qualify` subcommand is correctly
   subjunctive (proposed, not claimed to exist).
2. **DETAIL (microseconds overstatement) — RESOLVED.** Now "roughly
   2 ms … ~55 % of the ~2,700–3,900 µs fresh-invocation cost," which
   matches LLP 0035's Results table verbatim (55 % of 2.7–3.9 ms =
   1.5–2.1 ms, so "roughly 2 ms" is fair); `bench_runtime_create_us`
   exists at `src/runtime.rs:693`.
3. **DETAIL (CV-15 owner conflict) — RESOLVED.** The Relationship
   section now states both facts compatibly: 0031 defines the verdict
   vocabulary; the CV-15 wording fix sits with the 0010 harness per the
   0115 board (board row verified: "CV-15 … 0010 harness").
4. **DETAIL (Finding 5 undersold CV-2) — RESOLVED.** Finding 5 now
   credits CV-2's owned invalidate-or-relink half in words matching
   0115's work text ("a framework refresh must invalidate or relink the
   final binary before qualification runs"), while correctly keeping
   out-of-band-refresh removal with options 3–5 and qualification's
   permanent job.
5. **DETAIL (Option 3 pre-judgment) — RESOLVED.** Now attributed
   ("this analysis found no adopter-facing need for
   swap-without-relink") and explicitly routes the contributor-lane
   question to OQ3's ratifier.

All four round-1 suggestions were also absorbed (Diary 0037 as the
control case — quote verified at diary lines ~82–84;
staleness-not-incoherence sentence in Option 5;
`public-package-proof.yml` named in Option 8 and present on disk; OQ4
gains an actor and points at option 2).

Beyond my own concerns, I spot-checked the other new v0.2 material
independently and it held: the JS-live-query split is code-true
(`defineJsLiveQuery` → `jsQueryDef('LiveQuery')`,
`packages/snapback-codegen/define.mjs:1731`; `FunctionKind::LiveQuery`
takes the Query invocation mode at `src/runtime.rs:2239` and both
prepare and invoke reach `RuntimeGuard::create()` — lines 2264, 2165);
the content-addressed option's machinery is real
(`IBEX_PORTABLE_HERMES_ARTIFACT_ID`/`_ARCHIVE_DIGEST` required
selectors consumed in `vendor/ibex/build.rs` 705–828; the
`target/hermes-artifacts` store with the lexical-before-canonicalize
symlink-redirection guard at
`build_support/portable_engine_build_consumption.rs` 1980–2016; every
payload entry in the rerun watch set, 2379–2401; the
preflight-receipt/nonce/`RUSTC_WRAPPER`/target-map/promotion-admission
coupling at build.rs 705–807 — so OQ7 is well-founded); the package
claims are exact (darwin `prepare-runtime.mjs` runs `build-identity`
then copies independently; darwin `package.test.mjs` is 23 lines of
identity-only; the Linux test proves attestation digests, `--help`
launch via rpath, and identity — no VM anywhere); the workerd twin is
as described, down to the in-code comment "Actions stay on Ibex (egress
and secrets powers are not in the twin's scope…)" and the
`!matches!(invocation.mode, IbexInvocationMode::Action)` gate
(`src/runtime.rs` 2135–2143, `src/workerd_exec.rs`, LLP 0048); the
Option 6 host-surface list maps one-to-one onto build.rs's compiled
sources (fs, timers, dns, crypto, process, tls/http/fetch/websocket/
net, sqlite, debugger, console, ipc, worklet, runtime extensions,
per-platform files); Option 7's three classes cite correctly (Diary
0029:33 ceiling mid-acceptance; Diary 0031:842 one-command-per-mutation;
Diary 0030:537 "documented as a runtime grant, but codegen" verbatim);
and the no-evidence-regression section paraphrases 0115 constraint 1
faithfully. Option renumbering cross-references (1–8, OQ3, Relationship
"options 3/5", "options 2–8") are internally consistent throughout.

## 2. New concerns in the delta

1. **NIT — "digest-anchored rerun detection instead of the mtime
   heuristic" (Option 4) slightly mislabels the mechanism.** What is
   digest-anchored is *selection and consumption-time validation*; the
   payload watch set is still Cargo `rerun-if-changed`, i.e. mtime-based
   path watching. The protection against the incident class comes from
   store immutability plus address-change-triggers-rerun plus digest
   validation when the build does run — and the document's own OQ8
   already carries the honest residual (TOCTOU/post-link mutation), so
   this is wording, not substance.
2. **NIT — the error-fidelity sub-option's "cheap" elides an ABI
   boundary.** `ex_hermes_create_no_eval()` returns only a null pointer
   (`src/runtime.rs:614`), so carrying the native refusal reason
   requires adding a channel to the vendored Ibex C ABI (e.g. a
   last-error getter) — mechanically trivial, but a cross-repo
   coordination cost the word "cheap" hides.
3. **NIT (optional) — `scripts/build-hermes.sh` in Option 5 is
   Ibex-repo-relative** (`vendor/ibex/scripts/build-hermes.sh` from this
   repo's root). It matches build.rs's own spelling and the settled
   §Why-dynamic text round 1 accepted, so this is a reader-clarity
   touch, not an error.

No MINOR or higher concerns in the delta. No new unfair costings,
smuggled decisions, or unlabeled empirical claims found; the delta in
fact moves two v0.1 assertions the honest direction (the Convex
sealed-artifact account demoted to labeled inference with a named
verification path; Option 7's "cheap" demoted to hypothesis).

## 3. Verdict

**READY.** Round 1's sole blocking concern — the missing server-side
readiness option — is genuinely resolved, not reworded: the new option
is fully argued, factually grounded (every code claim in it verified
against the tree), honestly costed, and owner-routed, and the option
space now spans tool-side witnessing, server-side witnessing, three
distribution/link shapes, engine strategy, and the two experience
surfaces, with a per-option evidence-regression check. All four detail
concerns are fixed as requested. The remaining items are three nits
that do not touch the bar.

## 4. Recommended next step

Accept at the author's discretion; no further review round is needed
from this family. The three nits (rerun-detection wording, the
ABI-boundary caveat on "cheap," the build-hermes.sh path spelling) can
ride any future revision. The natural follow-on is the one the document
itself names: route option 2 to its owners (LLP 0031 `/health` block,
LLP 0030 refuse-vs-degraded lifecycle, LLP 0010 diagnostics) and let
OQ7's adoptability question gate any pursuit of option 4.
