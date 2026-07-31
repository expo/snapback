# Review: LLP 0133 — Local settlement (round 1, Fable family)

**Family:** Fable (Claude)
**Runtime:** Claude Code / claude-fable-5
**Effort:** session-inherited
**Date:** 2026-07-31
**Method:** fresh non-author context, blind to this Spec's codex artifact
**Target:** `llp/0133-local-settlement.spec.md` (374 lines)
**Target SHA-256:** `05d9a000ac9db0ef0ca996ca5b3197977461ed84932b47dbb0c10e2e60101c0a`
**Status:** completed

Reviewed against: LLP 0129 v0.3 (ledger row 1, decision-10 record, lane
split), LLP 0008 §Mutation Replay ("Replay environment contract",
lines 331–340), LLP 0003 (OCC channels), LLP 0043 (M1/M2, settlement
ledger), LLP 0059 (reservation choreography), LLP 0090 (outbox rule),
LLP 0107/0114 + `packages/snapback-client/external-store.mjs`
(rollback-from-latest-authoritative), LLP 0115 OQ8 item 10, LLP 0126
v0.4 (OQ3, approach 9, the tuple, "What stays impossible"), LLP 0130
(SD-4, ER-2), LLP 0012 (claim rule), plus code spot-checks in
`src/storage.rs` and `src/live_wire.rs`.

## Overall assessment

A disciplined, commission-faithful Spec. It specifies exactly decision
10's policy (verified verbatim against the LLP 0115 OQ8 item-10
registry text and 0129 ledger row 1's v0.3 domain/lane scoping),
restates the LLP 0008 pin faithfully without claiming authority over
it, and its composition claims against the shipped substrate check out
in code. The lane-label privilege-free argument is rigorous (see
Strengths). Two MATERIAL defects remain, both honesty/completeness
wording at the app-visible contract surface, both cheaply resolvable;
no structural flaw and no evidence-boundary weakening found. With the
MATERIALs resolved this converges.

## Verification log (raw data)

- **0008 pin restated faithfully.** 0008 lines 331–340: wire transmits
  only `{generatedIds, now}`; "divergent ids or timestamps between the
  optimistic run and the server run would corrupt data";
  `randomValues` captured but not transmitted. 0133 §Scope and lane Q
  restate the transmitted pair and the corruption rationale, decline
  authority, and route changes to a dated 0008 amendment. Faithful.
  (Section cite nit: the heading is "Mutation Replay and Conflict
  Semantics"; the contract is a bolded paragraph inside it — fine.)
- **Commission match.** 0115 OQ8 item 10 (lines 1374–1379) and 0129
  §Decision posture + ledger row 1 v0.3 (lines 290–319): re-derivation
  default, labeled claims never authority, per-field bounded-skew
  opt-in, two lanes both labeled, `clientMutationId` protocol-lane
  carve-out, 0008-pin-stands-for-its-lane. 0133 matches on every
  element. The lane split and dual-domain pinning are explicitly
  assigned to this Spec by 0129 row 1 v0.3 ("The settlement Spec pins
  the two domains separately"; "Two lanes, two policies, both labeled
  in receipts"), so making them normative here is within the
  commission, not scope creep. Divergence-on-settle semantics is the
  necessary completion of a re-derivation default (the policy is
  unimplementable without it); receipt *content* vs wire projection is
  correctly split per row 4. I found nothing decided beyond decision
  10's scope plus that necessary completion.
- **0130 SD-4/ER-2 path** cited correctly (§Scope, §Status); the
  ER-2 escalation for any different-default revision is stated.
- **0059 composition.** The snapshot-bound (data head, durable
  authorization) pair: 0059:718–719. Stale detection precedes the
  durable commit — "the operation has no durable effect and is safe to
  re-enter from its beginning"; served boundary 409s and "clients
  retry the complete operation" (0059:766–772). So a retry is a fresh
  full execution: 0133's "the retry re-derives again, so no captured
  value can go stale across retries" is sound, and lane Q re-presenting
  the same captured environment is consistent (the environment is part
  of the queued record, 0043:135–136). Descriptor comparison before
  settlement lookup or effects: 0043:152–154 verbatim.
- **Exactly-once ledger.** `_snapback_client_mutations` with
  `client_mutation_id TEXT PRIMARY KEY` (src/storage.rs:4674);
  `client_mutation_result` republishes the stored settlement with
  function/auth/authority fail-closed checks (src/storage.rs:1966–2050).
  "A duplicate submission republishes the stored settlement, never
  re-derives twice" is code-true.
- **Rollback composition.** `external-store.mjs`: `materializeRows`
  reduces every unsuppressed optimistic layer over the *current*
  `authoritativeRows` (packages/snapback-client/external-store.mjs:133–138);
  rejection splices the layer and re-materializes from the latest
  authoritative base (lines 381–395); authoritative delivery retires
  layers (lines 139–160). Matches 0133's "recomputes every remaining
  overlay from the latest authoritative rows — never from a snapshot
  captured at mutation start" (LLP 0114:455–465 states the same rule).
- **Receipt anchor.** `Receipt::Mutation` carries `snapshotVersion`
  (src/live_wire.rs:543, 557, 572–575). It is `Option<u64>` on the
  wire, but LLP 0034's receipts closure pins confirmed ⇒ non-null
  (0034:654–656), so the ordering-anchor use for settlements is sound
  (see DETAIL 7).
- **0090 outbox rule** (0090:708–713) and 0008 doc-id suppression
  clearing incrementally per confirmed write (0008:354–361): both
  restated faithfully; acceptance sketch 5 matches.
- **Tuple.** Five elements match 0126:512–525; element-4 credential
  boundary matches 0051's ENG-24605 record (handler identity is always
  the server-prepared credential projection, never a replay-ledger
  answer; descriptor outside the ledger — 0051 header, 0043:139–140).
  Elements 2/3 out-of-band matches 0129 exit criterion 3's per-element
  harness list. "What stays impossible" items match 0126:648–654,
  including the `SNAPBACK_UNIQUE_CONSTRAINT_VIOLATION` speculative
  unique-index loss.
- **Working ids** `SNAPBACK_SPECULATIVE_ID_UNRESOLVED` and
  `settlement.bounded_skew` collide with nothing in the repo outside
  this Spec.

## Strengths

1. **The privilege-free lane-label argument holds under adversarial
   reading.** A mislabeling client can only select which *server*
   policy runs, and the two policies are ordered: lane Q's acceptance
   is exactly what the shipped pin grants any queued mutation today
   (the wire message is constructible by any client, local execution
   or not), and re-derivation is strictly stricter. Crucially, the
   receipt's lane label records what the server *did*, which the
   server knows first-hand — so a client can move itself into the
   client-values-labeled bucket but can never forge "re-derive"
   provenance for client-supplied values. No evidence boundary
   depends on believing the client's label; the audit trail stays
   honest under mislabeling. This is the right construction and the
   Spec states it plainly.
2. **Fail-closed where it must be.** Elements 1/5 refuse into the
   shipped LLP 0081 quarantine/resync seam, never silently settle;
   bounded-skew out-of-bound degrades to the labeled default rather
   than refusing (correct: refusal would permanently fail every
   offline-aged intent for skew alone, and the explicit-arg escape
   hatch for data-grade time is named).
3. **The carve-out is pinned with its rationale.** "Re-deriving
   `clientMutationId` would destroy the idempotency it exists to
   provide" is the one-sentence proof that decision 10 *cannot*
   govern the protocol lane; pinning the two domains separately
   forecloses the future conflation 0129 row 1 worried about.
4. **Honest claim scaling throughout.** Elements 2/3 explicitly not
   verified per-settlement; evaluator identity "never gates commit in
   this Spec's version" with OQ4 reserving the strictness increase
   (never a weakening); the capability fact gates the bounded-skew
   claim per LLP 0012's rule; acceptance sketches are genuinely
   falsifiable and cover both directions of each rule (including the
   rejection variant of the id-map cascade).
5. **Composition claims are code-true**, not aspirational — every
   shipped-behavior citation I checked (rollback recompute, settlement
   ledger republish, reservation re-entry, doc-id suppression, outbox
   rule, receipt version binding) matched the code or owning document
   at the cited semantics.

## Concerns

### BLOCKING-FOR-BAR

None.

### MATERIAL

**M1 — "never silently submitted with a dangling reference"
overclaims against the leaf-equality scope disclaimed two sentences
earlier (§Divergence, class 1).** The rewrite's scope honesty is
stated: an id embedded inside a longer string or derived value is not
rewritten and is the application's responsibility. But detection
shares the same leaf-equality net: a *rejected* speculative id that
survives only embedded/derived in a later intent's args is neither
rewritten nor detected — that intent IS silently submitted with a
dangling (embedded) reference, and both sides durably agree on the
corrupt value. The closing "never silently submitted with a dangling
reference" is therefore true only for leaf-visible references, while
reading as a global guarantee. In an honesty-policed Spec this is a
real defect, not a nit. *Resolution:* scope the guarantee explicitly
("never silently submitted with a dangling **leaf** reference; the
embedded/derived class shares the rewrite's stated scope limit"), or
widen detection — and note that OQ2's id-typed arg declarations are
the graduation path for the residue.

**M2 — the bounded-skew declaration's lane-Q semantics are
unstated.** §Bounded-skew is scoped to lane L, and lane Q's pin
accepts the captured `now` unconditionally — so a declared
`boundedSkew` field settles with *arbitrary* skew whenever its
mutation was captured as a lane-Q intent (server-side execution
answers `ctx` from the captured environment). Rule 3 makes mixed
queues normal, so the same declared field is bounded in lane L and
unbounded in lane Q within one app, and an author reading the
declaration (or the `settlement.bounded_skew` capability fact) as a
data-integrity bound is wrong on one of the two normal lanes. The
behavior is *derivable* from the two sections, but the app-visible
consequence of a declared per-field bound must be stated, not
derivable. *Resolution:* one normative sentence — the declaration is
inert in lane Q (no bound check, disposition `accepted`, lane label
`replay-accept`); an application needing a hard bound as data models
the value as an explicit arg, which the section's last bullet already
recommends for "when the user acted."

### DETAIL

**D1 — lane-Q rationale gloss overstates.** "no local execution
exists to rebase them" is not the load-bearing ground: the client
knows its captured `generatedIds`, and the id-map/leaf-rewrite
machinery could in principle rebase lane-Q ids too. The real grounds
are the shipped pin, the commission's lane scoping (0129 row 1 v0.3),
and that Phase 0 ships before any rewrite machinery exists. Tighten
the clause so the pin's justification doesn't rest on an
impossibility claim that isn't one.

**D2 — time class lacks the derived-value honesty parallel.**
"nothing references a timestamp, so no rewrite pass exists" is true
of the protocol's reference semantics, but an app can snapshot a
speculative timestamp into a later intent's *explicit arg* (a derived
bucket key, say) exactly as it can embed an id. That residue is
outside decision 10 by the Spec's own vocabulary (explicit args are
ordinary data), but class 1 states its scope honesty and class 2
asserts flatly. One mirroring clause keeps the two classes equally
honest.

**D3 — "the local run's read baseline is not an OCC input" could be
misread against LLP 0003 E3.** The deliberate client-declared
`readSet` CAS channel (`validate_read_set`, src/storage.rs:10402) is
a client-supplied baseline that *is* an OCC input by contract, and it
remains available to lane-L submissions as ordinary declared input.
Distinguish the deliberate CAS channel (unchanged) from the local
run's *captured* baseline (diagnostic only) in one clause.

**D4 — row-4 owner lists disagree.** §Scope says row 4 proposes
LLP 0043/0034/0093 (matching 0129 row 4 verbatim); OQ1 says "the
row 4 owners (LLP 0043/0034/0093/0094)". 0094 as the wire-projection
consumer is plausible (0115 decision 7 routes receipt wire
projections to LLP 0094), but say it once consistently — and 0094 is
cited in the body while absent from Related.

**D5 — attribution precision in the Summary.** "bounded-skew
acceptance exists only as a per-field declared opt-in **carrying its
own capability fact**" is presented inside "the decided policy," but
the registry text (0115 OQ8 item 10; 0129 row 1) contains no
capability-fact clause — that requirement is this Spec's own
(stricter, constraint-2-motivated) addition. Attribute it as such.

**D6 — lane Q's element-5 story is implied, not stated.** §Tuple
verifies elements 1/5 for "a lane-L submission" only. Lane Q's
activation-skew protection is the shipped LLP 0081 quarantine/resync
seam for queued intents — real, but unstated here, so the fail-closed
gates read as lane-L-only protection with lane Q unguarded. One
sentence closes the misreading.

**D7 — the shipped `snapshotVersion` is nullable.** `Receipt::Mutation`
carries `Option<u64>` (src/live_wire.rs:572–575); the ordering-anchor
claim is sound because confirmed receipts require non-null (LLP 0034
receipts closure), with a rejected/null-on-cursor-read-failure edge.
Worth a parenthetical so "(shipped)" stays exact.

**D8 — interim overlay content after a remap.** The id-map rewrites
retained rows and pending *args*; a later pending intent's optimistic
overlay content may keep rendering the pre-map speculative id until
that intent settles. This is within the end-state invariant (which
binds only "after the last pending intent settles or fails"), but a
sentence acknowledging the transient would prevent reading "divergent
authoritative rows flow immediately after" as covering speculative
layers too.

## Suggestions

- Fold M1/D2 into one "scope honesty" statement shared by divergence
  classes 1 and 2, and name OQ2 as the graduation path for both
  residues.
- Consider stating explicitly that the lane label selects server
  policy and the receipt records server-observed fact — the two-line
  version of the privilege-free proof — since that is the sentence a
  future security review will look for.
- When the cascade lands, pin *when* the no-mapping check runs (at the
  minting mutation's terminal failure, before the referencing intent's
  submission slot) — implementation-slice territory, but the acceptance
  sketch 3 rejection variant should exercise the transitive case (C
  references B's id where B itself failed as a cascade).

## Open questions

None beyond the Spec's own four, which are honestly scoped (wire
spelling, admission-declaration interaction, capability-fact spelling,
future element-2 gating — all deferred to their proper owners).

## Verdict

**NOT READY** — solely on M1 and M2. Both are one-to-three-sentence
wording/completion fixes at the app-visible contract surface; neither
touches the architecture, the lane split, the commission fidelity, or
any evidence boundary, all of which verified clean. With M1/M2
resolved (and the DETAILs at author's discretion) this review's
family position is READY.

## Recommended next step

Author applies M1/M2 (and whichever DETAILs are cheap in the same
pass) as a v0.2 revision; round 2 can be delta-scoped to the changed
sections plus the codex round-1 artifact's concerns. SD-4's standing
acceptance then needs only the dual-family READY convergence — no
author adjudication is required unless a revision proposes a different
default (ER-2 / 0130 escalation).
