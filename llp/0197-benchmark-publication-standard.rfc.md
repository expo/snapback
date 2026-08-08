# LLP 0197: Competitive benchmark publication standard

**Type:** RFC
**Status:** Review
**Systems:** Competitive evaluation, Publishing, Documentation
**Author:** Charlie Cheever / Claude
**Date:** 2026-08-08
**Revised:** 2026-08-08 (r9, round-7 fixes: rule 5's earlier sentences reconciled with the r8 boundary (raw tool calls private-only, keyed commitments replace retained hashes); rule 2's balance defined for every lane-count/N combination.) 2026-08-08 (r8, round-6 fixes: rule 5 gains an explicit public/private boundary — opaque evidence IDs, keyed integrity commitments over private originals, fail-closed publisher; rule 2 defines near-balance at odd N; rule 3 conditioned on 0195 D4 with an alternate-home fallback.) 2026-08-08 (r7, author-merge: Charlie's restructure after the
first harness-native run — counterbalanced repetitions, mandatory machine
records, action-economy evidence with semantic action classes,
receipt-backed proof over LLP 0146 verify, the `snapback-defect`
attribution class, recomputed publication via a checked publisher,
implementation-first sequencing, Acceptance criteria, D4 and OQ3/OQ4 —
merged onto the r6 review spine, which contributes the corrected series
numbers and directional caveat, rule-1 preregistration items, the
equal-proof-bar failure protocol and denominator-aware ratio floor, the
publication-safe redaction/human-review requirements, and the
no-cross-vendor-numbers history-narrative rule.) 2026-08-08 (r6/r5/r4/r2/r1
— see llp/reviews/0193-*.run.md for the full round ledger.)
**Related:** LLP 0186 (OQ5 — this RFC develops it), benchmarks/
(harness, records), LLP 0146 (`snapback verify` receipt), LLP 0195
(public surface), LLP 0196 (template portfolio), diaries
0058 (`0058-relay-room-expo-backend-bakeoff`)/0065
(`0065-rematch-published-closure-bakeoff`)/0066/0068/0069

## Summary

The measurement program can now produce candidate numbers worth
calibrating — five runs, a committed harness, token metering, and a
directional series (2.91x tokens for the first published-consumer lane
on 0.1.13 to 2.24x for the skill lane on 0.1.15; bases differ across
rows, the records themselves say the series is directional rather than
a controlled sequence, and diary 0069 disclaims N=1 ratio movement as
signal). The existing series motivates this standard; it is not itself
a publishable controlled comparison. LLP 0186 OQ5 asked what disclosure
makes a public comparison credible rather than vendor noise; this RFC
proposes the standard. The governing principle is **publish the
instrument, not just the number**: every claim must be inspectable from
public artifacts and rerunnable wherever the pinned model and harness
are available; "reproduced" is reserved for observed reruns.

## The standard

A published Snapback benchmark claim requires:

1. **N≥3 runs per configuration, preregistered**, with all runs
   reported (no best-of, no post-hoc configuration designation): the
   run matrix — configurations, budgets, stopping and exclusion rules,
   frozen harness/prompt commits, attempt IDs, and the rule-7
   thresholds — is committed before results are observed. Charts show
   median, range, every constituent value, and the exact aggregation
   rule. The observed approximately ±30% per-lane spread (diary 0069)
   makes a single run evidence of existence, not magnitude. N≥8 remains
   the floor for a variance or regression-attribution claim under the
   W1 protocol.
2. **Counterbalanced repetitions.** Lanes remain serial and
   same-machine within a comparison set, but their order rotates across
   repetitions using a predeclared rotation schedule ("balanced" means:
   when the repetition count is divisible by the lane count, every
   lane appears exactly N/lanes times in each position; otherwise
   every lane's per-position counts differ by at most one). The record pins
   machine state and load, package-manager/cache posture, fresh versus
   reused backend state, occupied ports, model, effort, harness, and
   package versions. A favorable lane may not always receive the same
   warm-cache or machine-load position.
3. **The full harness public:** briefs verbatim, instantiated lane
   prompts, fairness rules, ordering schedule, record schema, and run
   records (the `benchmarks/` tree, published via LLP 0195 — this rule
   is conditional on 0195 D4 admitting benchmark artifacts to the
   public site; if D4 rules otherwise, an alternate public home is
   named before any claim publishes), plus a
   reproducibility manifest per record (harness commit, model
   identity/build and settings as run, closure and competitor versions,
   tool versions, environment and machine class, stopping rules, seeds
   where available). Public artifacts identify every parameter needed
   to rerun the measurement; unavailable proprietary model or harness
   access is stated as a reproducibility limit rather than papered
   over.
4. **A schema-valid machine record for every lane run.** The current
   optional JSON record becomes mandatory before publication. The
   human-readable comparison record and diary are generated from or
   linked to those records, not used as a substitute for them. Missing
   metrics remain explicit nulls and cannot support a derived claim.
5. **Action-economy evidence, not only aggregate tool counts.** Each
   record retains raw tool invocations, input/output/cache token fields
   exposed by the harness, phase times, and a sanitized action trace.
   The trace classifies at least guide/reference lookups,
   package-source reads, binary/string excavation, edits, process
   launches, proof commands, and retries. Raw tool calls remain visible only in the
   private record — publicly, normalized invocation metadata stands in
   for them (boundary below) — and semantic action classes are the
   cross-harness diagnostic because tool APIs batch work differently. Redaction
   passes through the publication-safe artifact schema — automated
   secret/credential/PII and private-material scanning, path and
   machine-identifier scrubbing with documented redactions and reason
   codes, keyed integrity commitments over private originals (as the
   boundary below defines), and a human with
   repository-disclosure authority reviewing before anything ships —
   and may not remove the action class, timestamp, result status, or a
   stable evidence pointer. The public/private boundary is explicit:
   the PUBLIC record carries normalized invocation metadata (action
   class, tool name, timing, result status) and opaque evidence IDs;
   raw tool arguments, transcripts, and sensitive originals stay in an
   access-controlled private store keyed by those IDs, with keyed
   integrity commitments rather than plain hashes of low-entropy
   values (which permit confirmation attacks). The publisher fails
   closed when safe redaction would destroy required auditability.
6. **Fairness notes attached to every chart:** cold-context agents;
   published surfaces only; same model, effort, and within-set machine;
   counterbalanced serial discipline; competitor lanes free to use web
   docs; model prior-familiarity asymmetry stated plainly where it can
   be supported. Prior familiarity is a caveat, not a numeric causal
   adjustment.
7. **Proof-bar disclosure:** every chart states what each lane proved.
   The headline chart should be the **equal-proof-bar variant**
   (`briefs/messaging-equal-proof-bar.md`), with the bar stated as
   vendor-neutral outcomes (e.g. "cold-start reads of prior history
   with the backend unreachable"), not feature names. The unequal-bar
   table may be published alongside with the asymmetry stated
   (competitor lanes' own-words caveats quoted, not paraphrased).
   7a. **Equal-proof-bar failure protocol (preregistered):** identical
   budgets and stopping rules per lane; every failed attempt retained
   and reported as a capability failure — never converted to a timeout
   duration, silently excluded, or substituted with a weaker result.
   7b. **Denominator-aware ratio floor:** attempt counts per lane are
   equal and preregistered; a ratio requires the preregistered minimum
   successful observations per lane (N≥3 successes — the same floor as
   rule 1's run count, applied to successes) AND a preregistered
   minimum success rate; when either lane misses either criterion, or
   success rates differ beyond the preregistered threshold, the ratio
   is omitted or subordinated and the capability-outcome comparison is
   the headline, with per-lane success counts stated on the chart
   itself.
8. **Receipt-backed proof.** A lane's final report is evidence, not the
   proof oracle. The harness independently executes the brief's
   acceptance checks and retains their receipts and UI artifacts. A
   Snapback lane reuses the canonical LLP 0146 `snapback verify`
   profiles and receipt rather than inventing a second system verifier;
   the neutral benchmark checker then grades the brief-level claims for
   every lane. Any proof that still needs human judgment is identified
   and its evidence retained.
9. **Version pinning:** every run names the exact closure and
   competitor versions; claims age out when either moves materially.
10. **Aid and starter disclosure.** Every lane names any official
    starter, template, recipe, published example app, skill content, or
    generated scaffold it used — any vendor-authored
    benchmark-targeted artifact (including examples LLP 0195 publishes)
    — with its version and the policy that made it eligible.
    Competitors receive the same right to their public official
    accelerators under predeclared selection criteria. An aid-assisted
    result is a valid measure of the recommended path but is labeled as
    such; a broad claim about authoring-surface generality additionally
    needs a predeclared holdout brief not substantially implemented by
    any such aid. LLP 0196 owns the portfolio and holdout policy; where
    no equivalent aid exists, aid-assisted and bare-start
    configurations publish separately.
11. **Attribution symmetry:** lane reports and correction-loop content
    (both vendors') are part of the public record — including runs
    unfavorable to Snapback; the credibility of the
    five-measurement-run, four-published-consumer-audit honesty
    discipline is the asset. The canonical class `snapback-defect`
    means a defect in the platform under test for every lane and
    includes platform-owned documentation, templates, CLI, SDK, and
    runtime — not only the backend. Charts may add a component label
    such as `docs` or `backend`, but may not turn "zero backend loops"
    into "zero platform loops."
12. **Recomputed publication.** Tables and charts are produced from the
    committed machine records by a checked publisher that verifies
    schema conformance, evidence pointers, record digests, aggregation,
    and disclosure completeness. The headline ratio convention is
    predeclared: ratio of lane medians for the primary chart, with the
    median of paired repetition ratios and all raw values shown beside
    it. Hand-transcribed arithmetic is not a publication source.

## What publishing looks like

A benchmarks page on the LLP 0195 site: a program-history narrative
that contains NO cross-vendor numbers or ratios — the single-run era
(including the losing origin run, diary
`0058-relay-room-expo-backend-bakeoff`) is told as dated prose with
links to the raw records, because a comparative chart communicates a
comparison whatever its label; the current N≥3 medians as the only
comparative presentation, with distribution and action-economy views;
links to briefs/records/prompts/proof receipts; a "run it yourself"
section stating expected run cost; and the reproducibility manifest per
record. Aid-assisted and holdout results are visually distinct. No
superlatives that a record and its scoped evidence cannot back.

The first implementation step is therefore not a marketing page. It is
to extend the machine-record schema and harness capture, counterbalance
an N≥3 calibration set, and build the deterministic record-to-chart
check. Existing historical records remain visible with their missing
fields labeled; they are not silently upgraded from diary prose.

## Acceptance criteria

This RFC is implementable when:

1. the protocol, schema, and lane runner encode the ordering, cache,
   action-trace, proof-receipt, and aid fields above;
2. an N≥3 calibration set validates every machine record and exposes
   all constituent values without transcript reconstruction;
3. the checked publisher reproduces every displayed aggregate from the
   committed records and fails closed on missing claim evidence;
4. at least one aid-assisted result and, before making a generality
   claim, one eligible holdout result meet the same disclosure bar; and
5. a person outside the benchmark run can follow the public rerun
   instructions and obtain a valid record, even if their result differs
   because agent execution is nondeterministic.

## Author decisions required

- D1: Whether to publish at all and when (proposal: after the N≥3
  calibration set and the equal-proof-bar run, not before).
- D2: Which competitors appear (Convex is measured; Supabase/
  PocketBase/Postgres lanes are unbuilt — publishing claims about
  unmeasured competitors is out under this standard).
- D3: Whether competitor names appear in charts or as "backend A/B"
  (proposal: names, with rule 3's reproducibility as the defense).
- D4: Whether the first publication waits for a holdout brief
  (proposal: required only for a generality claim; a clearly labeled
  recommended-path/aid-assisted claim may publish earlier).

## Open questions

- OQ1: Token-count comparability across models if the harness ever runs
  on non-Fable models (current standard: one model per published
  series, stated).
- OQ2: Whether an independent third party rerunning the harness is
  worth soliciting before first publication (strongest possible
  credibility; costs a relationship and time).
- OQ3: Which trace representation preserves enough evidence to audit
  semantic action classification without publishing prompts, secrets,
  or proprietary harness internals.
- OQ4: What cache posture best represents a real first use while still
  being portable across npm, package managers, and competitor CLIs.
