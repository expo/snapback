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

## Round 2 — 2026-07-31

**Family:** Fable (Claude)
**Runtime:** Claude Code / claude-fable-5
**Effort:** session-inherited
**Method:** round-2 delta review — this family's round-1 concerns,
the fixer's cross-family adjudication of the codex round-1 M1, and
the new/rewritten v0.2 text; no re-litigation of round-1-verified
material. Codex artifact still unread except as characterized in the
v0.2 Revised header.
**Target:** `llp/0133-local-settlement.spec.md` v0.2 (666 lines)
**Target SHA-256:** `2401bd74e9f1f2d25252fe9ca71644304ca1bf16caac81636e705e9d9216548f`
**Status:** completed

### Resolution of this family's round-1 concerns

- **M1 — RESOLVED.** §Divergence class 1 now scopes the cascade
  guarantee exactly: "never silently submitted with a dangling
  **leaf-visible** reference," with the embedded/derived false
  negative stated (including the honest consequence — "both sides
  durably agree on" the stale embedded value), the copied-id false
  positive stated as the leaf rule's other error class, and OQ2 named
  as the graduation path for both. Sketch 3 gained the leaf-rule
  variant pinning the false positive, and OQ2 restates the two error
  classes plus the call-index pairing residue. Exceeds the requested
  fix.
- **M2 — RESOLVED.** New normative bullet "Inert in lane Q" in §The
  bounded-skew opt-in: no bound check, disposition `accepted`, lane
  label `replay-accept`; mixed queues make it a normal case; the
  `settlement.bounded_skew` capability fact asserts lane-L settlement
  policy only, never a cross-lane data-integrity bound; hard-bound-
  as-data via explicit arg. Sketch 4 gained the lane-Q variant with
  "a bound enforced in lane Q" as a falsifier. Exactly the requested
  completion.
- **D1 — RESOLVED.** The lane-Q paragraph's grounds are now the
  pin's own corruption rationale (ids woven into optimistic state and
  queued args), the commission's lane scoping (0129 row 1 v0.3), and
  Phase-0 sequencing ("ships it before any id-rewrite machinery
  exists; this Spec does not retrofit one"). The false impossibility
  claim is gone.
- **D2 — RESOLVED.** Class 2 now carries the mirrored scope-honesty
  clause (speculative timestamp copied into a later intent's explicit
  arg; same residue class, same graduation path).
- **D3 — RESOLVED.** §Re-derivation's first bullet distinguishes
  LLP 0003 E3's deliberate client-declared `readSet` CAS channel
  (`validate_read_set`, still src/storage.rs:10402), available to
  lane-L submissions unchanged, from the local run's captured replica
  baseline (diagnostic-only).
- **D4 — RESOLVED.** OQ1 now states one consistent story
  (0043/0034/0093 per 0129 row 4; wire projection flows to LLP 0094
  per LLP 0115), and LLP 0094 was added to Related.
- **D5 — RESOLVED.** The Summary and the capability-fact bullet both
  attribute the capability-fact requirement as this Spec's addition
  beyond the registry text, not part of the decided policy.
- **D6 — RESOLVED.** Elements 1/5 bullet closes with lane Q's
  activation-skew guard: the shipped LLP 0081 quarantine/resync-
  before-replay seam, needing no new machinery.
- **D7 — RESOLVED.** Both §Divergence and §Receipts now state
  `Option<u64>` with LLP 0034's closure (confirmed ⇒ non-null; null
  only on a rejected invocation that could not safely read the
  durable cursor). Verified verbatim against the field doc comment on
  `Receipt::Mutation` (src/live_wire.rs:570–575, including the
  schemars confirmed⇒integer refinement) and LLP 0034's receipts
  closure text.
- **D8 — RESOLVED.** The "Transient view honesty" paragraph names
  both transients (confirmed bridge rendering pre-map content; later
  pending overlays rendering pre-map speculative ids) and binds them
  inside the re-scoped convergence-point invariant.

### Cross-family adjudication check (codex M1, ruled not-a-defect)

Verified against LLP 0008:331–340 and the code; the ruling is
**sound** and the strengthened rule 2 holds step by step:

- **(a) constructibility, code-true.** The lane-Q wire message is
  function + args + `CtxAnswerLedger` — a plain client-deserialized
  struct carrying `ids: Vec<String>` and `now: u64`
  (src/manifest.rs:4936–4965). Its validation is purely structural:
  version, id count bound, opaque-id alphabet/length, portable
  timestamp range, optional auth-fingerprint consistency
  (`validate_ctx_answer_ledger`, src/manifest.rs:5027–5077). Nothing
  in the path witnesses *how* the ledger was produced; any client can
  present chosen `{ids, now}` with no local execution. The new
  load-bearing step — no server-checkable capture-mode fact can
  exist — holds under the program's trust model (every candidate
  witness arrives as client-attested data; LLP 0123 attestation is
  element-2, out-of-band, and attests evaluator identity, not a
  per-intent capture mode). Note, not a defect: the conclusion does
  not even need the modal — the first half of (a) alone (a genuine
  lane-Q capture with chosen values is always available) already
  makes the label privilege-free.
- **(b) grant-nothing, code-true.** The replay path consumes the
  client's ledgered ids positionally (`PlanIdSource::next`,
  src/storage.rs:14823–14866, with exhaustion/unused-ids fail-closed
  codes) and the frozen `now` — exactly what LLP 0008:331–340 pins
  for any queued mutation, still under contract validation, auth, the
  0059 barrier, and unique constraints. A mislabeled lane-L intent
  obtains precisely this and nothing more.
- **(c)** re-derivation is strictly stricter, so neither label
  weakens an evidence boundary — unchanged from this family's
  round-1 Strengths 1.
- **(d) unforgeable provenance, structurally true.** `Receipt` values
  are server-constructed; the only client-influenced receipt field is
  the explicitly opaque, never-interpreted `correlation` echo
  (src/live_wire.rs:535–580). Lane/disposition record server action;
  `re-derived` cannot be forged for values the server did not derive.
- **Sketch 7** is a genuine falsifier for both halves (label reaching
  authority beyond the pin; forged `re-derived` provenance) and
  matches the code paths above. The fixer's not-applied disposition
  is confirmed; it rests on the ground this family's round 1 argued,
  correctly strengthened.

### New v0.2 text — verification and fresh findings

- **§Divergence seam rewrite — code-true.** Verified against
  packages/snapback-client/external-store.mjs: rejection splices
  immediately and re-materializes (lines 381–395); confirmation
  retains the layer (`status = 'confirmed'`, `confirmedAtRevision`)
  and splices only an already-suppressed layer — the
  delivery-before-confirmation order (lines 363–371); delivery
  retires via the `isAuthoritative` matcher or the conservative
  first-delivery-strictly-after-confirmation fallback (lines
  139–160, matching the code's own comment); overlays rebase from
  the current authoritative base (`materializeRows`, lines 133–138).
  "Settlement alone never applies authoritative rows" is exact: the
  confirmation path stores the result on the layer and
  re-materializes from the existing base. The re-scoped composed
  invariant (settled-or-failed AND delivery ≥ last settlement's
  `snapshotVersion`) is the correct strengthening.
- **§Exactly-once identity — code-true.** `ClientMutationIdentity`
  binds id, function, auth fingerprint, authority-instance id, and
  `mutation_input_fingerprint` over `{args, readSet, ctxLedger}`
  (src/storage.rs:638–661, 14907–14921); the ledger schema keys
  `client_mutation_id TEXT PRIMARY KEY` (src/storage.rs:4674);
  `client_mutation_result` fails closed exactly as the Spec says —
  `SNAPBACK_CLIENT_MUTATION_ID_REUSED` for function and input
  divergence, the `SNAPBACK_AUTH_STALE_RESULT` family (including the
  legacy-quarantine variants, honestly covered by "family") for
  auth/authority divergence (src/storage.rs:1966–2060). The claim
  that the shipped `ctxLedger` fingerprint input already covers the
  lane-Q claim-set slot is verified. Gate ordering (descriptor →
  ledger lookup with no freshness re-run → fresh execution) is
  consistent with the shipped code (no activation check in
  `client_mutation_result`) and with sketch 8.
- **Bounded-skew narrowing — coherent.** The single settlement clock
  sample matches the shipped frozen-invocation-clock model
  (`CtxAnswerLedger.now`, one `u64`); the structural direct-
  assignment check is honestly assigned to row 2's admission
  vocabulary as a named dependency; declaration-time bound
  validation, mixed-sink semantics, never-writes case, and labeled
  out-of-bound fallback are internally consistent, and sketch 4's
  variants cover them.
- **Sketches 8–10** match the verified code and LLP 0059 semantics
  (round-1 verification log); falsifiers are genuine.

Fresh concerns (new in v0.2 text; none blocking):

**D9 (new, DETAIL) — lane-L retry claim-set immutability is
derivable but unstated.** The identity extension makes the lane-L
claim set identity-bearing, and §Re-derivation states the lane-Q
retry rule ("re-presents the same captured environment") — but not
the lane-L analog. A client that *re-captures* (re-executes locally)
on retry of the same `clientMutationId` after a settled-but-response-
lost first attempt presents a changed claim set and fails closed
`REUSED` instead of republishing. That outcome is the section's own
intended fail-closed behavior — nothing false is stated, and the
failure is loud and typed, which is why this is DETAIL, not
MATERIAL — but the operational rule deserves one clause: the intent
record, claims included, is immutable after capture; a retry
re-presents it (rule 1 pins only the lane label's immutability
today).

**N1 (NIT) — sketch 9's "marked speculative" bridge.** A confirmed-
but-undelivered bridge layer is settlement-confirmed while its
*content* is still speculative; the sketch asserts an observable
mark, but the marking surface for that half-state is unspecified
(the shipped store exposes layer status, not row provenance).
A parenthetical routing it to the store-seam extension / OQ1
projection would keep the sketch executable as written.

**N2 (NIT, observation).** The conservative fallback retires the
bridge at the first authoritative delivery strictly after
confirmation even if that delivery does not yet contain the settled
rows; on a single ordered transport this cannot precede the commit's
effects, and the invariant is correctly scoped at delivery ≥
`snapshotVersion` either way, with multi-transport ordering
delegated to LLP 0090/0093. Recorded as raw data; no change
required.

### Verdict

**READY.** Both round-1 MATERIALs are resolved exactly as specified
(M1 exceeds the ask), all eight DETAILs are resolved, the fixer's
adjudication of the other family's M1 is confirmed sound against
LLP 0008:331–340 and the shipped code, and the new v0.2 sections
(§Divergence seam, §Exactly-once identity, the bounded-skew
narrowing, sketches 7–10) verified code-true. Fresh findings are one
DETAIL and two NITs, none of which misstate behavior or weaken an
evidence boundary; D9's failure mode is the Spec's own intended
fail-closed path. Nothing at MATERIAL severity remains from this
family.

### Recommended next step

If the codex round-2 artifact also lands READY, LLP 0130 SD-4's
standing acceptance applies (dual-family READY, zero unresolved
MATERIALs, within decision 10's scope, no evidence boundary
weakened) — no author adjudication needed. D9/N1 can ride the next
editorial pass or the implementing slice; neither gates acceptance.
