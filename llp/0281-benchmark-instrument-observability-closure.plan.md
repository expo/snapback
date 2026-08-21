# LLP 0281: Benchmark instrument observability closure

**Type:** Plan
**Status:** Draft
**Systems:** Benchmarks, Competitive evaluation, Testing, Agent experience,
Developer experience
**Author:** Claude (Fable 5) / Charlie Cheever
**Date:** 2026-08-17
**Revised:** 2026-08-20 (W4 reconciliation: provider/model preflight is
implemented; the abandoned 0.1.21 cell fill is superseded by the completed
published-0.1.24 matrix); 2026-08-17 (initial Draft: consolidates the instrument gaps
recorded across the Clique 0.1.21 sweep and the Coterie M1–M3 program into
one worklist under LLP 0201/0266 authority)
**Related:** LLP 0201, LLP 0236, LLP 0266, LLP 0277,
Diary 0078, Diary 0080, Diary 0081, Diary 0086,
`issues/20260815-clique-choreography-typing-observation-boundary.md`,
`issues/closed/20260815-clique-sweep-model-auth-preflight.md`

## Summary

The benchmark instrument — the frozen UI kit, `sm-*` selector vocabulary,
choreography harness, and run protocol — is now the limiting factor on what
the benchmark can prove. In the latest run, every lane on every backend
recorded the same structural skips (media composition, semantic receipts,
sender avatars, membership lifecycle), one required-check red was a
measurement artifact that survived seven platform mitigation attempts
(typing observation boundary), one lane burned its entire budget on absent
provider credentials, and selector breadth produced a false DM match.
Instrument defects steer product API design when they are not fixed; the
typing artifact nearly did.

This plan is the closure worklist. LLP 0201 remains the benchmark's
governing plan and LLP 0266 the Coterie program's; this document owns only
the instrument work and follows the kit's existing freeze discipline: each
change is a versioned kit/choreography bump with a migration note, following
the paved pattern of the `sm-convo-quote-preview` migration
(`issues/closed/20260817-clique-kit-quote-preview-migration.md`).

## Worklist

### W1. Fix the typing observation boundary — highest priority, ticketed

The choreography starts its clock before the synthetic
`pressSequentially(..., {delay: 25})` action, so reported visibility includes
the typing action itself; the platform path measures 1.68 ms where the
instrument reported 2,045+. LLP 0013 now publishes the 1,000 ms
accept-to-overlay-apply ceiling with an observation-honesty rule. Implement
the corrected boundary and rerun the lanes the artifact touched.
Ticket: `issues/20260815-clique-choreography-typing-observation-boundary.md`.

### W2. Media composition becomes observable

The frozen composer exposes no media-picker test ID, so both media
live-delivery checks are structurally unimplemented in every lane — the
benchmark cannot distinguish a backend with a real media path from one
without. Extend the kit composer contract with picker/attachment `sm-*` IDs
and implement the two checks. This is the instrument half of the media
happy-path program; landing it makes the media capability differences the
diaries describe measurable. Sequence behind the Exact file-input primitive
only for the Coterie/Contract arm; the RN-web Clique kit does not need to
wait.

### W3. Semantic receipt, avatar, and membership observability

The four recurring optional skips — sender-avatar identity, semantic receipt
transitions (sent/delivered/read as tokens, not glyphs), group aggregate
receipts, and member add/remove/promote/leave controls — need contract
vocabulary: `sm-*` state tokens on receipt indicators and avatar nodes, and
kit-level group-lifecycle controls. Removed-member history retention (a
brief-required behavior proved only through public function surfaces today)
becomes drivable once membership controls exist.

### W4. Provider-credential preflight — implemented

The Supabase lane spent its whole M1 budget discovering that its packet had
placeholder credentials and no DDL authority. Preflight must validate
provider credentials and required authority *before the clock starts* and
report `provider-setup` failure distinctly.
The live model probes, provider-authority probe, just-in-time credential
recheck, and bounded retry landed in the retained 0.1.21 sweep harness. The
old run's unfilled cells were superseded by the completed published-0.1.24
matrix; resolution is recorded in
`issues/closed/20260815-clique-sweep-model-auth-preflight.md`.

### W5. Outcome classification in the first summary line

Adopt LLP 0236 R6 as an instrument requirement: every red states whether the
application, the platform under test, provider/setup, or the instrument
failed. The Coterie closing artifact's skipped-by-claim vocabulary and the
Clique lanes' structurally-unimplemented vocabulary are the existing pieces;
the missing piece is one consistent first-line taxonomy across suite,
choreography, and run-level receipts.

### W6. Suite-status linkage ergonomics

Two lanes produced structurally non-green final runs solely because the
harness was invoked without its `--suite-status` linkage and reported it
late. The runner should refuse to start without required linkage inputs
rather than aggregate to non-green after the run.

### W7. Selector hygiene

A group-preview containing "Alice Alvarez" won the regex intended for the
direct chat row; DM-versus-group identification must come from `sm-*`
structure, not text breadth. Sweep the choreography for text-regex matches
that have a structural alternative, and add the static-vocabulary check
(the closed `sm`-vocabulary misuse check pattern) to CI for the harness
itself.

### W8. Known layout-contract assumptions become explicit contract

Two assumptions surfaced in every lane as app-side rediscovery: feed tabs
must remain reachable from profile surfaces, and the profile heading must be
observable despite the kit's Edit-first component order. Either the kit
supplies these surfaces (preferred: a contracted profile-header/nav slot) or
the choreography contract documents them as explicit app obligations; today
they are folklore learned from failures.

### W9. Coterie-owed real-host proofs

LLP 0266 D10's two-browser-context and native-host proofs remain owed; the
in-process Acto mount (LLP 0279 item 13) adds a mounted headless tier if it
lands first. Track here so instrument capacity and the owed evidence move
together rather than each waiting on the other.

## Sequencing

W1 and W4 first (they corrupt or waste entire runs). W5/W6 next (cheap,
protocol-level). W2/W3/W8 are one coordinated kit+choreography version bump
— batch them to pay the freeze-migration cost once, with the quote-preview
migration as the template. W7 rides that bump. W9 follows its external
dependencies.

The rerun that validates this plan is the LLP 0236 recommended-sequence
rerun: one published release, provider preflight, and the expanded
choreography proving media selection, semantic receipts, membership removal,
and process-restart custody — the checks this worklist makes implementable.

## Open questions

1. Does W3's group-lifecycle vocabulary belong in the shared kit or in a
   per-benchmark extension? (The kit is shared by Clique and Coterie's
   ported vocabulary; a shared answer keeps the choreography aggregator
   single-sourced.)
2. Should W5's taxonomy be enforced by the receipt schema (a required
   `outcome-class` field) rather than convention?
3. After W1 lands, do any historical typing-timing observations in the
   diaries warrant a correcting annotation, or does the existing Diary 0081
   addendum suffice as the canonical record?
