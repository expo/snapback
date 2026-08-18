# LLP 0133: Local settlement — settle-time trust and re-derivation

**Type:** Spec
**Status:** Accepted
**Systems:** Sync, Storage, Runtime, Client integration, Auth, Wire Protocol, Testing
**Author:** Charlie Cheever / Claude (Fable 5)
**Date:** 2026-07-31
**Revised:** 2026-08-03 (LLP 0163 durable slice widens the existing retained
client mutation identity in place with authenticated issuance facts and
compares those facts on replay; no parallel retry id was introduced, and
public range issuance/custody remains unclaimed); 2026-08-02 (Accepted LLP 0135 owner fold: sequence allocation is
a settlement-only host answer outside both captured-environment lanes);
2026-08-02 (implementation record — the buildable-now
settlement substrate landed through the six-ticket program: additive lane
labels/private claim ledgers, exact settlement identity, synthetic lane-L
re-derivation, logical-mint id maps, bounded-skew admission, and client
rewrite/cascade/bridge behavior. Acceptance sketches 1–4 and 7–10 are green;
sketches 5–6 remain explicitly deferred to their owning programs. The
implementation record below names the concrete spellings and scope residues;
Status stays Accepted.) 2026-07-31 (ACCEPTED under LLP 0130 SD-4's standing
authorization: dual-family READY — Fable round 2, Codex round 3 —
with the three conditions checked and satisfied: (1) zero unresolved
MATERIAL concerns in either family's final round; (2) within the
decided scope of its commission (LLP 0129 ledger row 1, decision 10);
(3) no evidence boundary weakened — re-derivation is stricter than
the shipped pin and every extension is additive. Recorded per SD-4's
honesty rule: this is the author's standing acceptance made in
advance, not a fresh manual adjudication. Review artifacts:
reviews/0133-local-settlement.{fable,codex}.md.) 2026-07-31 (v0.3, round-2 fixes: round 2 of the Wave-1
Spec loop returned READY from Fable
(`reviews/0133-local-settlement.fable.md`: both round-1 MATERIALs and
all eight DETAILs resolved; fresh findings one DETAIL + two NITs,
none blocking) and NOT READY from Codex
(`reviews/0133-local-settlement.codex.md`: M1/M3–M6 and D1–D2
resolved; one surviving MATERIAL, the round-1 M2 residue — raw
call-index id-map pairing lets equal-count divergent branches map a
speculative row's mint onto an unrelated authoritative row).
Applied: the Codex M2 residue — §Divergence class 1's id-map pairing
rekeyed from ctx call index to logical mint identity, (mint site,
occurrence), with count-or-site mismatch left unmapped into the
existing cascade path, never a guessed pairing; sketch 3 gained the
equal-count/different-mint-site adversarial variant and OQ2's
residue narrowed to the within-site occurrence case. Fable D9 —
lane-L intent records, claims included, are immutable after capture;
a retry re-presents the identical recorded claim set or fails closed
in the reused family (§Re-derivation). Fable N1 — sketch 9 names the
bridge-marking surface: the store seam's exposed layer status via
the seam extension and OQ1's projection.) 2026-07-31 (v0.2,
round-1 fixes: round 1 of the Wave-1
Spec loop returned NOT READY from both families
(`reviews/0133-local-settlement.fable.md`: 2 MATERIAL + 8 DETAIL;
`reviews/0133-local-settlement.codex.md`: 6 MATERIAL + 3 DETAIL).
Applied: Fable M1 = Codex M2 (the cascade guarantee scoped to
leaf-visible references; id-map pairing defined by ctx call index
with unmapped-never-guessed on divergence; the copied-id false
positive, the unminted case, and submission serialization stated;
OQ2 named as the graduation path); Fable M2 (the bounded-skew
declaration is normatively inert in lane Q); Codex M3 (§Divergence
rewritten to the shipped external-store seam — rejection splices
immediately, confirmation retains a bridge layer until a matcher or
the first-delivery-after-confirmation fallback retires it,
convergence awaits authoritative delivery, the receipt id-map named
as this Spec's explicit seam extension, the composed invariant
re-scoped to the delivery point); Codex M4 (element-1/5 mismatch
disposition downgraded to a registered dependency on ledger rows
3/5's owners; element-2/3 gating left with the tuple owners); Codex
M5 (bounded skew narrowed to directly-assigned untransformed
now-answers under a structural admission check, one settlement clock
sample, declaration-time bound validation); Codex M6 (the
settlement-identity extension, duplicate fail-closed collision
behavior, and gate ordering specified against the shipped
`ClientMutationIdentity` ledger); Codex D1–D3 and Fable D1–D8
(wording sweeps plus four new acceptance sketches). Adjudicated, not
applied — Codex M1 (client-attested lane label defeats the policy):
re-verified against the LLP 0008 pin and the shipped code, the
privilege-free argument holds — the lane-Q wire message is
constructible by any client without local execution, so mislabeling
grants nothing the shipped pin does not already grant any queued
mutation, no server-checkable capture-mode fact can verify a
client-side act, and the receipt disposition is server-observed and
unforgeable; recorded as strengthened rule 2 with the adversarial
acceptance sketch Codex asked for (sketch 7).)
**Related:** LLP 0003, LLP 0008, LLP 0012, LLP 0034, LLP 0043, LLP 0051, LLP 0053, LLP 0059, LLP 0081, LLP 0090, LLP 0093, LLP 0094, LLP 0107, LLP 0114, LLP 0115, LLP 0118, LLP 0123, LLP 0126, LLP 0129, LLP 0130

## Summary

This Spec is the settlement Spec LLP 0129 names: the owner of the
settle-time trust policy for client-captured values under the
local-first program (ledger row 1), specifying the policy the author
decided on 2026-07-30 as 0127 decision 10 (registry of record:
LLP 0115 open question 8, item 10). The decided policy, made normative
here: **server re-derivation is the default** for client-captured
application-visible values at settlement; client-captured values travel
in receipts as **labeled claims, never authority**; **bounded-skew
acceptance exists only as a per-field declared opt-in**. That the
opt-in carries its own capability fact is this Spec's addition beyond
the registry text (§The bounded-skew opt-in), not part of the decided
policy. The Spec makes the program's two-lane split
normative — the queued-intent replay lane ships under LLP 0008's
replay-accept pin, the local-execution lanes settle by re-derivation —
and specifies what a client reconciles when re-derived values diverge
from its optimistic view.

## Scope and authority

This Spec owns:

- the settle-time trust policy for application-visible client-captured
  values (time, minted ids entering durable state) across both
  settlement lanes;
- the lane vocabulary, the lane-assignment rule, and the requirement
  that receipts label which lane settled each mutation;
- divergence-on-settle semantics: what the client reconciles when the
  authoritative outcome differs from the speculative one;
- the protocol-identity carve-out (`clientMutationId` and its peers);
- how settlement consumes the execution-identity tuple: element 4
  normatively (decision 10's subject); elements 1/5 as recorded
  claims whose mismatch disposition stays with ledger rows 3/5's
  owners (§What settlement consumes of the execution-identity tuple).

This Spec does **not** own:

- **LLP 0008's replay-accept pin.** The shipped contract (LLP 0008
  §Mutation Replay, "Replay environment contract") — the wire transmits
  `{generatedIds, now}` and the server accepts them on replay —
  **stands for its lane**. This Spec restates and consumes that pin;
  any change to it lands as a dated LLP 0008 amendment, outside this
  Spec's authority.
- Receipt wire shapes and encodings. LLP 0129 ledger row 4 proposes
  LLP 0043/0034/0093 as owners; this Spec states the settlement-trust
  *content* receipts must carry, and the wire projection lands there.
- Queue mechanics, leases, and the `Parity` claim rule (LLP 0043); the
  authorization barrier and reservation choreography (LLP 0059); the
  IR evaluator and ctx-answer ledger (LLP 0051); schema-at-capture
  versus schema-at-settle policy (ledger row 3, proposed LLP 0081).

Acceptance path: this document is commissioned by an accepted program,
so LLP 0130 SD-4's standing acceptance rule applies (dual-family READY,
zero unresolved MATERIAL concerns, within decided scope, weakening no
evidence boundary). Its decided scope is exactly decision 10's policy;
a revision proposing a different default escalates (LLP 0130 ER-2).

## Vocabulary

- **Client-captured value.** A value produced by the runtime's ambient
  surface during optimistic capture or local execution: the captured
  environment's `generatedIds` and `now` (LLP 0008), and under local
  execution the answers of `ctx.runtime.now()` / `ctx.runtime.id()`
  (LLP 0051 D1's ctx surface). An application arg the developer passes
  explicitly is **not** client-captured: it is ordinary validated data
  under the declared contract, and decision 10 does not govern it.
- **Application-visible value.** A client-captured value that enters
  durable application state (a stored timestamp, a minted row id).
- **Protocol-lane identity.** Correlation/idempotency/custody facts
  that never enter durable application state as application values:
  `clientMutationId`, the client-local sequence number, the opaque
  authority-instance descriptor, and `(stream, version)` cursors.
- **Speculative result.** The outcome of a local execution or
  optimistic overlay before settlement. Never presented as settlement
  (LLP 0129 governing constraint 3).
- **Settlement.** Authoritative server execution of the submitted
  intent, committing under LLP 0003's execution semantics and
  LLP 0059's authorization choreography, producing a receipt bound to
  the committed `snapshotVersion`.
- **Claim.** A client-captured value carried to settlement and
  recorded in the receipt with the authoritative value beside it.
- **Disposition.** How settlement treated a claim: `accepted` (lane Q),
  `accepted-bounded-skew` (declared opt-in, within bound), or
  `re-derived` (the default in lane L). Divergence is computable from
  the pair (claimed ≠ authoritative); it is not a separate disposition.

## The two settlement lanes

The split is normative. Every queued or locally executed mutation
settles in exactly one lane, fixed at capture time:

**Lane Q — queued-intent replay (Phase 0; shipped).** An intent
captured *without* local handler execution: the client queued
function + args + captured environment, with at most an
args/write-plan-derived optimistic overlay (LLP 0043 M2). Settlement
replays under LLP 0008's pin: the wire carries `{generatedIds, now}`
and the server **accepts** them, because divergent ids or timestamps
between the optimistic run and the server run would corrupt data —
the captured ids are already woven into the client's optimistic state
and later queued args (the pin's own grounds, LLP 0008). The pin is
shipped, the commission scopes it to this lane (LLP 0129 row 1 v0.3),
and Phase 0 ships it before any id-rewrite machinery exists; this
Spec does not retrofit one. The pin stands for this lane; this Spec
changes nothing about it.

**Lane L — local-execution settlement (Phase 1 on).** An intent
captured *by executing the handler locally* (the LLP 0051 D2 IR
evaluator or any later admitted executor). Settlement is authoritative
server **re-execution**, and the server **re-derives** every
application-visible client-captured value by default: `now` is the
server's settlement-time clock; minted ids come from the server's own
generator. The locally captured values travel as claims and are
recorded in the receipt; they are never authority. The client
reconciles per §Divergence on settle.

Rules:

1. **Lane assignment is a capture-time fact.** Recorded at enqueue,
   immutable, echoed in the settlement receipt. A client never
   relabels an intent.
2. **Labeling is client-attested, and the policy is privilege-free by
   construction.** The label selects which *server-side* policy runs;
   it grants nothing. The argument, step by step, so no reader can
   find a bypass in it:
   (a) the lane-Q wire message — function + args + captured
   environment — is constructible by any client, local execution or
   not. A client that wants its captured values accepted needs no
   mislabel: it can capture a genuine lane-Q intent with whatever
   `{generatedIds, now}` it chooses. Capture is a client-side act, so
   no server-checkable capture-mode fact can exist; any "witness" of
   how the client produced the intent would itself be client-attested.
   (b) Therefore a lane-L intent mislabeled as lane Q obtains exactly
   what the shipped 0008 pin already grants any queued mutation
   today — client-supplied opaque ids and a client timestamp — still
   subject to validation, the declared contract, authorization, the
   LLP 0059 barrier, and unique constraints, identical under both
   labels. Mislabeling changes nothing the pin does not already allow.
   (c) Re-derivation is *stricter* than acceptance, so no evidence
   boundary weakens under either label. The trust boundary against
   client-supplied values is the pin's own — validation plus
   authorization — never the lane label.
   (d) The receipt's lane and dispositions record what the server
   *did*, a fact the server knows first-hand. A client can move
   itself into the values-accepted-and-labeled bucket; it can never
   forge `re-derived` provenance for values the server did not
   derive. The audit trail stays honest under mislabeling.
   Acceptance sketch 7 exercises the adversarial case.
3. **Mixed queues are normal.** One outbox may hold lane-Q intents
   captured before local execution existed and lane-L intents captured
   after. Replay order stays the client-local sequence order
   (LLP 0008); lane policy applies per mutation.
4. **Receipts label the lane.** Every settlement receipt carries the
   lane (`"replay-accept"` or `"re-derive"`; wire spelling final with
   the receipt-shape owners). The lane label is safe for fan-out; the
   claim ledger is not (§Receipts).

## Re-derivation semantics (lane L)

- Settlement re-executes the mutation under LLP 0003's boundary:
  buffered `ctx.db`, drive-to-completion, one brief commit with
  captured-read validation. The server validates **its own** reads;
  the local run's *captured* read baseline is not an OCC input. This
  leaves LLP 0003 E3's deliberate client-declared `readSet` CAS
  channel (`validate_read_set`) untouched: a declared read set is an
  ordinary contract input, available to lane-L submissions like any
  other; only the local run's captured replica baseline is
  diagnostic-only.
- The local run's read baseline (replica versions observed) MAY travel
  as a claim so a divergent outcome can be *explained*; it is
  diagnostic, never validation.
- Settlement runs inside LLP 0059's authorization-write choreography
  unchanged: descriptor comparison before settlement lookup or effects
  (LLP 0043 M2), the snapshot-bound (data head, durable authorization)
  reservation pair, and the `SNAPBACK_AUTH_RESERVATION_STALE` typed
  stale result. Staleness is detected before the durable transaction
  commits: the attempt has no committed effect, and the handler is
  not rerun inside the attempt (LLP 0059's one-shot rule). A later
  client retry of the complete operation under the same
  `clientMutationId` is a fresh full settlement; under re-derivation
  the fresh run re-derives again, so no captured value can go stale
  across retries. In lane Q the retry re-presents the same captured
  environment, per the pin. In lane L the intent record, claims
  included, is immutable after capture: a retry re-presents the
  identical recorded claim set — never a local re-capture — or fails
  closed in the reused family (§Exactly-once identity).

## Exactly-once identity under the new semantics

The settlement ledger keys by `clientMutationId` (protocol lane), and
the shipped durable identity already binds more than the key: the
function, the auth fingerprint, the authority-instance descriptor,
and an input fingerprint over `{args, readSet, ctxLedger}`
(`ClientMutationIdentity` / `mutation_input_fingerprint`,
`crates/snapback/src/storage.rs`). A duplicate submission with the identical identity
republishes the stored settlement — never re-derives twice — and any
mismatch fails closed today: `SNAPBACK_CLIENT_MUTATION_ID_REUSED` for
function/input divergence, the `SNAPBACK_AUTH_STALE_RESULT` family
for auth/authority divergence.

This Spec extends that identity rather than riding beside it. Every
semantics-affecting fact it introduces joins the retained identity:

- the lane;
- the element-1/5 identity claims a lane-L submission carries
  (implementation hash, activation);
- the bounded-skew declaration identity in force at capture;
- the lane-L claim set (the captured-environment/ctx-answer analog —
  the slot the shipped `ctxLedger` fingerprint input already covers
  for lane Q).

Whether these land as new fingerprint inputs or new compared columns
is implementation detail; the collision behavior is normative: a
duplicate `clientMutationId` whose semantics-affecting facts
changed — lane, hash, activation, claims, or declaration — **fails
closed in the shipped reused/stale family**. It never receives the
stored result under semantically different input, and it never
silently re-executes.

Gate ordering, normative:

1. Descriptor comparison first — before settlement lookup or any
   effect (LLP 0043 M2, shipped).
2. Settlement-ledger lookup with full identity comparison. An
   identical identity republishes the stored settlement, and no
   freshness gate re-runs: an already-settled mutation republishes
   even if the activation has since moved — idempotent re-delivery of
   a settlement that already happened, not a new admission. A changed
   identity fails closed as above.
3. Only an unsettled `clientMutationId` proceeds: lane policy,
   admission and identity-claim dependencies (§What settlement
   consumes of the execution-identity tuple), then fresh execution
   under the declared lane's policy.

## The bounded-skew opt-in

Acceptance of a client-captured **time** value in lane L exists only
as a per-field declared opt-in:

- **Declaration.** The mutation's declared contract names the field
  and the bound — illustratively `boundedSkew: { field, maxSkewMs }`.
  The final grammar lands with the declared-contract vocabulary
  (LLP 0115 move 1); this Spec fixes the semantics. The grammar
  validates the bound at declaration time — positive, finite, under a
  grammar-set maximum — so settlement never sees a malformed bound.
- **Narrowed domain (v0.2).** The opt-in is defined only for a
  declared field whose written value is a **directly assigned**
  captured-time answer: the admitted write for that field is
  structurally a `ctx.runtime.now()`-answer assignment — no
  transform, no arithmetic, no nesting inside a derived value. The
  check is structural, against the declared contract and the admitted
  write shape (row 2's admission vocabulary carries it), not a
  dataflow analysis. A transformed or derived use is outside the
  opt-in by construction — inexpressible, not merely discouraged.
  The narrowing is deliberate, and stated as such: it is what makes
  the per-field vocabulary executable without dataflow provenance.
- **Semantics.** At settlement the server re-executes with a single
  authoritative clock sample — the same sample that answers
  re-derived time everywhere in that settlement. Skew = |that
  sample − claimed value|. Within the bound, the claimed value is
  written at the declared field's direct write slot and the receipt
  records disposition `accepted-bounded-skew` with the measured skew.
  Every other sink of the same captured answer — other fields, nested
  or derived values, control flow — uses the server sample. Out of
  bound, settlement **falls back to the default** — the server
  re-derives — and the receipt records the claim with disposition
  `re-derived`; the mutation is not refused for skew alone. If the
  settlement branch never writes the declared field, no acceptance
  occurs; the claim rides the ledger unused.
- **Inert in lane Q — normative.** In lane Q the declaration is
  inert: the pin accepts the captured `now` with no bound check, and
  the value settles with disposition `accepted` under lane label
  `replay-accept`. Rule 3's mixed queues make this a normal case, not
  an edge: the same declared field is bounded in lane L and unbounded
  in lane Q within one application. The `settlement.bounded_skew`
  capability fact therefore asserts lane-L settlement policy only —
  never a cross-lane data-integrity bound. An application that needs
  a hard bound *as data* models the value as an explicit arg,
  validated under the declared contract in both lanes.
- **Capability fact.** The opt-in surfaces as its own capability fact
  (working id `settlement.bounded_skew`; final id with the LLP 0012
  claim machinery and the guide capability row). This requirement is
  this Spec's addition beyond the registry text, aligned with the
  claims-equal-acceptance discipline (LLP 0129 exit criterion 4). No
  target claims the opt-in without shipping the declaration, the
  structural admission check, the bound check, and the receipt
  disposition.
- **Ids have no skew metric.** The opt-in is defined only for
  time-valued fields. An id-typed value cannot declare bounded skew;
  id continuity is achieved through the receipt id-map (§Divergence on
  settle), never through acceptance.
- **Offline age defeats the bound by design.** An intent queued
  offline for hours exceeds any sane bound at settlement and degrades
  to re-derivation, labeled. An application that needs "when the user
  acted" as data models it as an explicit arg — visible in the
  contract, validated as ordinary data, outside decision 10's domain.

## The protocol-identity carve-out

`clientMutationId` is idempotency and correlation, not an application
value. It is client-minted (LLP 0129 Phase 0), keys the exactly-once
settlement ledger (LLP 0043 M2), and is never re-derived — re-deriving
it would destroy the idempotency it exists to provide. The same
carve-out covers the client-local sequence number (ordering), the
authority-instance descriptor (custody; never a ctx-ledger member),
and opaque cursors. Decision 10 governs none of these; their contracts
stay with LLP 0043/0059. The settlement Spec pins the two domains
separately so no future revision conflates "the server re-derives ids"
with the protocol lane.

## Divergence on settle

What the client reconciles when the authoritative outcome differs
from the speculative one. The base rule is the shipped external-store
seam (`packages/snapback-client/external-store.mjs`, LLP 0114/0107),
specified here as it actually behaves, and extended only where this
Spec says so explicitly:

- **Rejection retires immediately.** A rejected settlement splices
  the mutation's speculative layer at once and re-materializes rows
  from the latest authoritative base (shipped: the rejection path
  plus `materializeRows`).
- **Confirmation bridges; delivery converges.** A settlement receipt
  carries settlement facts, not the affected query's canonical rows.
  On confirmation the shipped store *retains* the speculative layer —
  deliberately, so the view does not flicker back to pre-mutation
  state — until the authoritative rows arrive by live delivery. The
  layer is retired when a provider/generated matcher recognizes the
  authoritative rows, or conservatively at the first authoritative
  delivery strictly after confirmation (shipped:
  `acceptAuthoritativeRows`). Both orders are defined: a delivery
  arriving before confirmation suppresses the layer via the matcher
  and confirmation then splices it; confirmation before delivery
  retains the layer until matcher or fallback. Convergence therefore
  awaits authoritative delivery; settlement alone never applies
  authoritative rows. Delivery continuity and resnapshot are the
  live protocol's contract (LLP 0008/0090), not this Spec's.
- **Overlays rebase from the latest base.** On every authoritative
  delivery, every retained overlay recomputes from the latest
  authoritative rows — never from a snapshot captured at mutation
  start (shipped; LLP 0114's rollback rule).
- **The receipt anchors correlation.** Settlements apply in server
  commit order; the receipt's committed `snapshotVersion` — shipped
  on `Receipt::Mutation` as `Option<u64>`, with LLP 0034's receipts
  closure pinning confirmed ⇒ non-null (null only on a rejected
  invocation that could not safely read the durable cursor) — is the
  anchor: under the version-non-decreasing guards, an authoritative
  delivery at or past that version reflects the settlement's commit.
  LLP 0008's doc-id suppression clears per mutation as it settles,
  so divergent authoritative rows flow with the next delivery.
- **Seam extension (this Spec's).** Under lane-L id re-derivation, a
  retirement matcher keyed on a speculative id can never succeed.
  This Spec extends the seam: the receipt id-map is delivered to the
  store layer so matchers can recognize authoritative rows under
  their re-derived ids; absent a map-aware matcher, the shipped
  conservative fallback bounds the bridge at the first delivery
  strictly after confirmation.

Divergence classes:

1. **Id divergence (lane L default).** The receipt carries a
   normative **id-map** for the ids the local run minted.
   *Construction:* pairing is by **logical mint identity** — (mint
   site, occurrence) — never raw call index. The mint site is the
   stable identity of the minting instruction within the executed
   artifact: for the shipped HostPlan form, the plan-step identity
   plus the within-step mint slot (an `Insert`/`InsertEach` row id or
   an expression-evaluated `ctx.runtime.id()` answer position — the
   shipped `PlanIdSource` answers positionally, and every answer is
   already anchored at exactly one such site); for the LLP 0051 D2 IR
   evaluator, the IR instruction's stable identity. The occurrence
   index counts that site's mints in execution order (fan-out
   iterations at one site). A lane-L submission's recorded claim set
   carries each minted id's (mint site, occurrence) — the recorded-
   answer format is versioned (LLP 0051 D5) precisely so the lane-L
   recording can carry this — and the settlement run records its own
   mint sequence first-hand. The two are server-comparable because
   both runs execute the identical artifact: the elements-1/5
   mismatch dependency (§What settlement consumes) already requires
   that a submission whose executed identity differs from the
   server's active artifact never silently settles as matched. The
   local run's mint at (site, occurrence) maps to the authoritative
   mint at the same (site, occurrence) and to nothing else. Every
   mismatch leaves ids **unmapped**, never re-paired: a speculative
   mint at a site the settlement run never reached (divergent branch,
   or the mutation was rejected), the unpaired occurrences of a site
   whose per-site count diverged, and every mint of a claim set that
   recorded no mint sites at all. An unmapped id takes the cascade
   path below exactly like a rejected mint — never a guessed
   pairing — so equal mint counts across divergent branches can no
   longer cross-map unrelated rows' ids. Stated residue, narrowed:
   within one site, occurrence pairing is positional, so a fan-out
   whose source collection diverged between runs can pair different
   items' mints at the same (site, occurrence); OQ2's typed
   references graduate that residue too.
   *Rewrite:* the client (a) lets overlay retirement replace retained
   rows with the authoritative ones, and (b) rewrites
   **not-yet-submitted** pending intents whose args reference a
   speculative id, by exact value-equality of string leaves against
   the client's own minted-id ledger. Scope honesty, both error
   classes stated: leaf equality treats *every* occurrence of a
   minted-id string as a reference, so a minted id an application
   deliberately copied into a non-reference field is rewritten too
   (false positive); a speculative id surviving only embedded inside
   a longer string or derived value is neither rewritten nor detected
   (false negative). Both are the leaf rule's scope, and OQ2's typed
   id declarations remove both.
   *Serialization:* a pending intent whose args leaf-reference a
   speculative id never crosses the submission boundary before every
   predecessor minting intent has settled. Sequence-order serial
   replay (LLP 0008) already provides this; it is normative here, so
   a pipelining client must preserve it — which is also why no
   already-submitted dependent exists to repair.
   *Cascade:* a pending intent referencing a speculative id with
   **no** mapping — rejected mint or unmapped — fails locally as a
   cascade: the drop-and-mark-failed family (LLP 0008), surfaced as
   observable client state with a stable diagnostic (working code
   `SNAPBACK_SPECULATIVE_ID_UNRESOLVED`). The check runs at the
   minting mutation's terminal failure and again at each dependent's
   submission slot; a cascade failure is itself terminal, so cascades
   propagate transitively. The guarantee, scoped exactly: such an
   intent is never silently submitted with a dangling
   **leaf-visible** reference. An id surviving only embedded or
   derived shares the rewrite's stated scope limit — that intent is
   submitted carrying the stale embedded value and both sides durably
   agree on it; the residue is the application's until OQ2 graduates
   it.
2. **Time divergence.** Authoritative timestamps replace speculative
   ones through ordinary overlay retirement; the protocol itself
   never references a timestamp, so no rewrite pass exists. Scope
   honesty, mirroring class 1: an application can copy a speculative
   timestamp into a later intent's explicit arg (a derived bucket
   key, say); explicit args are ordinary data outside decision 10, so
   the copy is neither rewritten nor detected — the same residue
   class as an embedded id, with the same graduation path. A field
   settled under `accepted-bounded-skew` shows no divergence by
   construction.
3. **Outcome divergence.** Re-execution against moved state may take a
   different branch, write different rows, or fail: conflicts surface
   as LLP 0008's typed conflict payload under the v1 LWW-per-field /
   delete-wins defaults; a speculative unique-index pass may still
   lose to `SNAPBACK_UNIQUE_CONSTRAINT_VIOLATION` at settle
   (LLP 0126, "What stays impossible"). This Spec adds no merge
   semantics; the authoritative outcome wins, the speculative layer is
   retired, and rejection reconciles exactly like rejection today.

Transient view honesty: between a settlement and its authoritative
delivery, the confirmed bridge layer may keep rendering pre-map
speculative content, and a later pending intent's optimistic overlay
may keep rendering a pre-map speculative id until that intent
settles. Both transients are inside the invariant below, which binds
at the convergence point, not per receipt.

The composed invariant, query-scoped: once the last pending intent
has settled or failed **and** the client has received authoritative
delivery at or past the last settlement's `snapshotVersion` for a
query, the client's rows for that query equal the server's at that
delivered version — later server commits move the target, and
speculative residue never survives that point.

## Receipts

Normative content (wire projection with the receipt-shape owners,
LLP 0129 ledger row 4):

- **Speculative receipts** are marked speculative, carry the content
  address (implementation hash) and the captured environment, and are
  never presented as settlement — they carry no authoritative
  `snapshotVersion` binding.
- **Settlement receipts** carry: the lane label; the disposition-
  labeled claim ledger — one entry per application-visible
  client-captured value: `{field-or-slot, claimed, authoritative,
  disposition, skewMs?}`; the id-map with its unmapped markers
  (lane L); and the committed `snapshotVersion` (shipped;
  `Option<u64>` on the wire, confirmed ⇒ non-null per LLP 0034's
  receipts closure).
- **Privacy.** Claimed values can embed application data, so the full
  claim ledger and id-map ride only the submitting authority's own
  mutation response / stored settlement (the LLP 0043 replay ledger,
  auth-bound). Fan-out receipts to other subscribers carry the lane
  label and the shipped write-surface facts only, per the receipt
  privacy rule ("the diagnostic CODE only").

## What settlement consumes of the execution-identity tuple

Per LLP 0126 approach 9's five elements. Only element 4 is this
Spec's to decide — it is decision 10's subject; the rest are recorded
as consumed dependencies with their owners named, per LLP 0129
constraint 7's ownership discipline.

- **Element 4 (host-call answer surface) — normative here, per
  lane.** Lane Q replays `{generatedIds, now}` (the pin); lane L
  records the ctx answers as claims and re-derives. Neither lane
  treats a ctx-answer ledger entry as authority over credentials —
  handler identity is always the server-prepared credential
  projection (LLP 0051 D1's ENG-24605 boundary).
- **Elements 1 and 5 (source/plan identity; store semantics / schema
  epoch) — carried as claims; disposition is rows 3/5's.** A lane-L
  submission carries the implementation hash and the schema/artifact
  activation the local run executed against, **as claims** —
  claims-never-authority applies to identity facts too: settlement
  records them and never trusts them. What settlement *does* on a
  mismatch with the server's active artifact — the refusal typing and
  the quarantine/resync disposition (LLP 0081's shipped seam is the
  proposed shape) — is ledger rows 3 and 5's design, proposed for
  LLP 0081 and LLP 0051/0123 (LLP 0129), and is **not decided
  here**. This Spec registers one dependency with those owners: its
  receipts and divergence semantics are defined only for a settlement
  whose executed identity is what the receipt says it was, so a
  design in which a mismatched submission silently settles *as if
  matched* contradicts this Spec — the owners' disposition must make
  mismatch detectable, whatever it is. Lane Q needs no new machinery
  for this: queued intents already ride the shipped LLP 0081
  quarantine/resync-before-replay seam, which guards activation skew
  for that lane today.
- **Elements 2 and 3 (runtime identity, deterministic-tier
  semantics) — not consumed per-settlement.** Their harnesses are
  out-of-band (LLP 0123 attestation; LLP 0051 D5's conformance
  corpus) under LLP 0129 exit criterion 3. Whether element 2 ever
  gates commit is the tuple owners' call (row 5), tracked here only
  as OQ4 — a future strictness increase, never a weakening. This
  Spec's sole statement in its own scope: a settlement receipt MAY
  carry the claimed evaluator identity as a labeled claim.

## Acceptance sketches

Falsifiable, per house rule; each lands with the implementing slice.

1. **Lane-Q pin holds.** An offline-queued intent replays with its
   captured `{generatedIds, now}`; settled rows carry exactly those
   values; the receipt labels `replay-accept`. Falsified if the server
   substitutes values in this lane.
2. **Lane-L re-derivation.** A locally executed mutation under a
   deliberately skewed client clock settles with server-derived time
   and ids; the receipt labels `re-derive` and its claim ledger shows
   claimed ≠ authoritative; the client converges to the authoritative
   values. Falsified if any client-captured value enters durable state
   without the lane-Q label or a declared opt-in.
3. **Id-map cascade.** Two pending lane-L intents, the second
   referencing the first's minted id: after settlement re-derives a
   different id, the second submits with the mapped id and settles
   against the authoritative row. Rejection variant: the first is
   rejected; the second fails locally as a surfaced cascade, never
   submitted with the dangling id. Transitive variant: a third intent
   references the second's minted id; the second's cascade failure is
   terminal, so the third cascades too. Divergence variant: the
   settlement run's mint sequence differs from the local run's; every
   speculative mint without an authoritative mint at the same
   (mint-site, occurrence) comes back unmapped and dependents
   cascade. Adversarial equal-count variant: local and settlement
   runs take divergent branches that each mint exactly one id, at
   different mint sites — row A's insert locally, an unrelated row
   B's insert authoritatively; the speculative mint comes back
   unmapped — no cross-site pairing — and the dependent referencing
   speculative row A cascades instead of being rewritten to row B and
   submitted against the wrong row. Leaf-rule
   variant: a minted id copied into a non-reference arg field is
   rewritten — the documented false positive, pinning the rule's
   exact scope. Falsified by a guessed pairing (any cross-site
   mapping) or a dependent submitted past an unmapped or failed
   predecessor.
4. **Bounded skew.** A declared field within `maxSkewMs` settles with
   the claimed value, disposition `accepted-bounded-skew`, capability
   fact present; the same field out of bound settles re-derived and
   labeled. Mixed-sink variant: one captured answer feeds the
   declared direct field and an undeclared field — the declared field
   accepts within bound, the undeclared sink settles server-derived.
   Lane-Q variant: the same declared field in a lane-Q capture
   settles `accepted` under `replay-accept` with no bound check — the
   declaration is inert there by rule. Falsified by opt-in acceptance
   without the capability fact, beyond the bound, past the declared
   direct slot, or by a bound enforced in lane Q.
5. **Speculative is never settlement.** Kill the client after local
   execution, before reconnect: on relaunch the result renders marked
   speculative with no authoritative `snapshotVersion` binding, and a
   non-empty outbox takes full resync before replay (LLP 0090's rule).
6. **Identity-mismatch dependency** (lands with rows 3/5's owners;
   recorded because this Spec's semantics depend on it). A lane-L
   submission with a stale activation or a mismatched implementation
   hash is never silently settled as if matched; the owners'
   disposition (typed refusal into the quarantine/resync path is the
   proposed shape) surfaces the mismatch. Falsified by a silent
   settle-as-matched.
7. **Adversarial lane relabel.** A submission produced by local
   execution but labeled lane Q obtains exactly the pin's semantics —
   captured values accepted under the same validation, declared
   contract, authorization, and unique-constraint checks as any
   queued mutation — and nothing more; the receipt labels
   `replay-accept`. Falsified if the label reaches any authority the
   shipped pin does not already grant a queued mutation, or if any
   receipt records `re-derived` for a value the server did not
   derive.
8. **Duplicate identity.** A duplicate submission with identical
   identity republishes the stored settlement, even after the
   activation has moved; the same `clientMutationId` with a changed
   lane, hash, activation, claim set, or bounded-skew declaration
   fails closed in the reused/stale family. Falsified by a republish
   under changed facts or by double execution.
9. **Receipt/delivery ordering.** Confirmation before delivery: the
   confirmed layer bridges until a matcher or the
   first-delivery-after-confirmation fallback retires it, and the
   view converges at delivery ≥ the receipt's `snapshotVersion`.
   Delivery before confirmation: the matcher suppresses the layer and
   confirmation splices it. Delayed delivery: the bridge persists,
   marked speculative — the mark is the store seam's exposed layer
   status, carried to applications by §Divergence's seam extension
   under OQ1's projection, not per-row provenance — without
   flickering to pre-mutation state.
   Falsified if settlement alone is treated as convergence or a
   confirmed layer outlives the conservative fallback.
10. **Reservation-stale retry.** A settlement attempt that loses its
    reservation returns `SNAPBACK_AUTH_RESERVATION_STALE` with no
    committed effect; the client's retry of the complete operation
    under the same `clientMutationId` settles exactly once, with
    values re-derived by the fresh run. Falsified by duplicate
    effects or by a first-attempt captured value surviving into the
    retry's settled rows.

## Non-goals

No CRDT or semantic merge (LLP 0008's pin); no offline authoritative
settlement, revocation delivery, global uniqueness, or trusted
timestamps (LLP 0126, "What stays impossible"); no change to the lease
contract (LLP 0043 M1 / LLP 0053 — inherited unwidened); no action
replay (the action tier is nondeterministic and never auto-replayed);
no receipt wire encoding (row 4's owners); no admission rule for which
handlers may execute locally (row 2's territory).

## Open questions

1. Final receipt field names and wire projection — with the row 4
   owners (LLP 0043/0034/0093, per 0129 row 4; the wire projection
   flows to LLP 0094 like every other receipt, per LLP 0115). This
   Spec's vocabulary is semantic, not wire spelling. The id-map's
   delivery to the store layer (§Divergence's seam extension) rides
   the same projection.
2. Should lane-L admission *require* id-typed arg declarations so the
   id-map rewrite surface is contract-visible rather than
   leaf-equality-based? Interacts with row 2's bounded-profile
   admission vocabulary. The leaf-equality rule above is the stated
   floor, with its two error classes and the within-site occurrence
   residue of (mint-site, occurrence) pairing explicitly scoped
   (§Divergence, class 1); OQ2 is the graduation path that removes
   them.
3. The capability-fact spelling and guide row for
   `settlement.bounded_skew`, with LLP 0012's claim classes and the
   guide conventions.
4. Whether the claimed evaluator identity (element 2) should ever gate
   settlement once LLP 0123 attestation is consumable server-side —
   the tuple owners' call (row 5, §What settlement consumes), tracked
   here; a future strictness increase, never a weakening.

## Status

**Accepted (2026-07-31)** under LLP 0130 SD-4 after a dual-family review
loop; the metadata header is authoritative and this section previously
lagged it at `Draft` (corrected 2026-08-01, found by the LLP 0129
super-refine round 3).
Authored as LLP 0129 ledger row 1's owning Spec
under the author's decided policy (0127 decision 10, adjudicated
2026-07-30; registry LLP 0115 open question 8). Landing un-gates
ledger row 1; rows 2–5 still gate any `Parity`-by-construction claim
(LLP 0129 exit criterion 3). Review proceeds under LLP 0005 with
LLP 0130 SD-4 as the acceptance path.

## Amendment (2026-08-02): implementation record and rulings

The buildable-now half of this Spec landed on main through
`issues/closed/20260802-0133-00-settlement-substrate-program.md`, tickets 01–06
(`5aa8dd03`, `2d63f246`, `e266c633`, `9cad757e`, `38d74e1a`, and
`63d980b6`; each ticket's closure names its complete proof). This amendment
records the shipped substrate rather than widening it into the local executor
the program deliberately excluded.

What landed:

- Mutation receipts additively carry `settlementLane`; the submitting
  authority's response and exactly-once settlement retain `claimLedger` and
  lane-L `idMap`, while fan-out strips both private value carriers. The
  provisional wire spellings and row-4 ownership are recorded in
  `issues/20260802-0133-receipt-wire-coordination.md`.
- `ClientMutationIdentity` binds the lane, activation/implementation claims,
  recorded claim set, and bounded-skew declaration before freshness or
  effects. Exact duplicates republish retained settlement facts; any identity
  collision fails closed.
- Synthetic lane-L submissions execute the admitted server artifact afresh,
  re-derive `now` and ids, retain one settlement clock sample, roll back a
  stale authorization reservation, and retry by fresh re-derivation. The
  lane label remains client-attested and privilege-free; the adversarial
  relabel proof is green.
- Host-plan mint observations are paired by `(site, occurrence)`, never raw
  answer index or equal total count. Missing, duplicate, cross-site, or excess
  claims remain unmapped. The client receives that map at the external-store
  seam, rewrites not-yet-submitted args by exact string-leaf equality, gates
  every submission on predecessor settlement, and transitively marks
  unresolved dependents failed with
  `SNAPBACK_SPECULATIVE_ID_UNRESOLVED`.
- The declared mutation grammar ships `boundedSkew: { field, maxSkewMs }`
  beside the existing argument/result contracts, capped at 86,400,000 ms.
  Admission accepts exactly one direct, untransformed `runtimeNow()` write;
  lane L applies the one-sample bound and labels the disposition, while lane Q
  remains inert under `replay-accept`. The stable capability id is
  `settlement.bounded_skew`; its guide row is Partial because local capture is
  not yet shipped.
- Confirmation retains an inspectable external-store bridge until a
  map-aware matcher or the first authoritative delivery strictly after
  confirmation retires it. Delivery-before-confirmation is rechecked when the
  private id-map arrives, so both orderings converge without a pre-mutation
  flicker.

Implementation-specific rulings and residues:

1. The working wire spellings above are implemented additively, not frozen on
   behalf of LLP 0129 ledger row 4. That row's owners still ratify or supersede
   them through their own dated amendments.
2. Exact string-leaf rewrite is the shipped floor. A deliberately copied id
   rewrites and an embedded/derived id survives, exactly as §Divergence states;
   no OQ2 typed-id declarations or dataflow inference landed.
3. The implementation records execution-identity claims but makes no
   identity-mismatch disposition owned by ledger rows 3/5. It also builds no
   local/client mutation executor, optimistic runtime capture, or speculative
   receipt. Consequently acceptance sketch 5 remains with LLP 0155 Stage 2 /
   LLP 0051, and sketch 6 remains with the execution-identity and schema-skew
   owners. Neither deferred sketch is claimed by this landing.

Acceptance sketches 1–4 and 7–10 are executable in the Rust and client test
corpora, including the relabel, equal-count/no-cross-pairing, collision, stale
reservation, rewrite/cascade, and both delivery-order adversaries. This
implementation unblocks LLP 0129 ledger row 1's settlement substrate only;
rows 2–5 and the remaining Phase-1 evidence still bar any
`Parity`-by-construction claim.

## Amendment (2026-08-02): LLP 0135 sequence-answer boundary

Sequence allocations are settlement-only host answers. They are outside both
lane H's captured environment and lane L's re-derived environment; neither
lane may replay them as handler input. Settlement retains and republishes the
committed allocation so an idempotent replay never allocates twice. When LLP
0129's local-execution admission vocabulary lands, operations that allocate a
sequence must register as excluded from local execution unless that owner
admits an explicit successor. This amendment records the accepted boundary;
it does not claim the LLP 0135 primitive is implemented.

## Amendment (2026-08-03 — LLP 0162, effective with its acceptance)

Accepted LLP 0162 widens this Spec's exactly-once identity, under this
Spec's own extend-don't-ride-beside rule; LLP 0163 carries the
implementation-altitude contracts and schemas.

- `operationId` is `clientMutationId` widened to every originator. The
  physical key becomes `(streamId, originatorClass, operationId)`; the
  audience and every semantics-affecting fact this Spec binds remain
  **compared facts, never key components** — the collision rule and the
  shipped reused/stale diagnostic families are unchanged. Host-derived
  identities are server-authenticated and deterministic from durable
  upstream identities; the host namespace is unwritable by client
  admission.
- Identities carry server-issued authenticated issuance epochs with
  preallocated finite offline ranges; the suppression lifecycle adds
  identity tombstones (retained until the per-audience floor passes an
  epoch) and two dispositions to this Spec's vocabulary: `result-expired`
  (outcome-known, payload gone — a declared change from the
  republish-the-stored-result rule) and `identity-horizon-passed`
  (outcome-unknown, never a terminal client `failed`). Lookup precedence:
  suppression record → envelope/tombstone → epoch floor.
- This Spec remains the duplicate-suppression authority for
  collision/identity semantics. Parameter values are owned elsewhere and
  referenced here: range size/window and ACK/retention values by LLP
  0043's same-dated amendment; disposition spellings and generated schemas
  by LLP 0163; the detail/envelope/checkpoint retention windows by LLP
  0162 OQ1 until LLP 0163/0165 land them.

### Dated implementation note (2026-08-03 — LLP 0163 durable slice)

`ClientMutationIdentity` now carries optional `OperationIssuanceV1` facts, and
the same `_snapback_client_mutations` settlement row persists those facts with
the existing function, authority, and input collision boundary. Lookup compares
the serialized issuance exactly and refuses divergence in the shipped reused-id
family; identities without issuance preserve their predecessor digest and
remain outside LLP 0163 coverage. This satisfies the extend-don't-ride-beside
constraint at the storage seam, but does not claim the missing server range
issuance wire or client-side atomic range/outbox custody.
