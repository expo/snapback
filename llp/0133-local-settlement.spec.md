# LLP 0133: Local settlement — settle-time trust and re-derivation

**Type:** Spec
**Status:** Draft
**Systems:** Sync, Storage, Runtime, Client integration, Auth, Wire Protocol, Testing
**Author:** Charlie Cheever / Claude (Fable 5)
**Date:** 2026-07-31
**Revised:**
**Related:** LLP 0003, LLP 0008, LLP 0012, LLP 0034, LLP 0043, LLP 0051, LLP 0053, LLP 0059, LLP 0081, LLP 0090, LLP 0093, LLP 0107, LLP 0114, LLP 0115, LLP 0118, LLP 0123, LLP 0126, LLP 0129, LLP 0130

## Summary

This Spec is the settlement Spec LLP 0129 names: the owner of the
settle-time trust policy for client-captured values under the
local-first program (ledger row 1), specifying the policy the author
decided on 2026-07-30 as 0127 decision 10 (registry of record:
LLP 0115 open question 8, item 10). The decided policy, made normative
here: **server re-derivation is the default** for client-captured
application-visible values at settlement; client-captured values travel
in receipts as **labeled claims, never authority**; **bounded-skew
acceptance exists only as a per-field declared opt-in** carrying its
own capability fact. The Spec makes the program's two-lane split
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
- which execution-identity tuple elements settlement verifies.

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
and later queued args, and no local execution exists to rebase them.
The pin stands for this lane; this Spec changes nothing about it.

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
2. **Labeling is client-attested, and honestly so.** The server applies
   the policy of the declared lane. A client that mislabels a lane-L
   intent as lane Q obtains exactly what the shipped 0008 pin already
   grants any queued mutation today — client-supplied opaque ids and a
   client timestamp, still subject to validation, authorization, and
   the LLP 0059 barrier. Re-derivation is *stricter* than acceptance,
   so no evidence boundary weakens under either label; the lane label
   is a semantics selector, not a privilege.
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
  the local run's read baseline is not an OCC input.
- The local run's read baseline (replica versions observed) MAY travel
  as a claim so a divergent outcome can be *explained*; it is
  diagnostic, never validation.
- Settlement runs inside LLP 0059's authorization-write choreography
  unchanged: descriptor comparison before settlement lookup or effects
  (LLP 0043 M2), the snapshot-bound (data head, durable authorization)
  reservation pair, and `SNAPBACK_AUTH_RESERVATION_STALE` retry. A
  stale-reservation retry re-runs the whole settlement; under
  re-derivation the retry re-derives again, so no captured value can
  go stale across retries. In lane Q the retry re-presents the same
  captured environment, per the pin.
- Exactly-once is untouched: the settlement ledger keys by
  `clientMutationId` (protocol lane); a duplicate submission
  republishes the stored settlement, never re-derives twice.

## The bounded-skew opt-in

Acceptance of a client-captured **time** value in lane L exists only
as a per-field declared opt-in:

- **Declaration.** The mutation's declared contract names the field
  and the bound — illustratively `boundedSkew: { field, maxSkewMs }`.
  The final grammar lands with the declared-contract vocabulary
  (LLP 0115 move 1); this Spec fixes the semantics.
- **Semantics.** At settlement, skew = |server settlement clock −
  claimed value|. Within the bound, the claimed value settles and the
  receipt records disposition `accepted-bounded-skew` with the
  measured skew. Out of bound, settlement **falls back to the
  default** — the server re-derives — and the receipt records the
  claim with disposition `re-derived`; the mutation is not refused for
  skew alone.
- **Capability fact.** The opt-in surfaces as its own capability fact
  (working id `settlement.bounded_skew`; final id with the LLP 0012
  claim machinery and the guide capability row). No target claims the
  opt-in without shipping the declaration, the bound check, and the
  receipt disposition.
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

What the client reconciles when the authoritative outcome differs from
the speculative one. The base rule composes with the external store's
shipped rollback rule (LLP 0114/0107): on any settlement, the client
retires that mutation's speculative layer, applies the authoritative
outcome, and **recomputes every remaining overlay from the latest
authoritative rows** — never from a snapshot captured at mutation
start. Settlements apply in server commit order under the
version-non-decreasing guards; the receipt's `snapshotVersion` binding
(shipped, `Receipt::Mutation`) is the ordering anchor. LLP 0008's
doc-id suppression clears per mutation as it settles, so divergent
authoritative rows flow immediately after.

Divergence classes:

1. **Id divergence (lane L default).** The receipt carries a normative
   **id-map**: `{speculativeId → authoritativeId}` for every id the
   local run minted that settlement re-derived. The client MUST
   (a) rewrite its retained rows via overlay retirement (the
   authoritative rows simply replace them), and (b) rewrite
   **not-yet-submitted** pending intents whose args reference a
   speculative id, by exact value-equality of string leaves against
   the client's own minted-id ledger — the client minted these
   high-entropy ids, so it knows exactly which values are its own.
   Scope honesty: leaf-equality rewrite only; a speculative id
   embedded inside a longer string or derived value is not rewritten
   and is the application's responsibility. A pending intent
   referencing a speculative id that has **no** mapping (its minting
   mutation was rejected) fails locally as a cascade — the
   drop-and-mark-failed family (LLP 0008), surfaced as observable
   client state with a stable diagnostic (working code
   `SNAPBACK_SPECULATIVE_ID_UNRESOLVED`), never silently submitted
   with a dangling reference.
2. **Time divergence.** Authoritative timestamps replace speculative
   ones through ordinary overlay retirement; nothing references a
   timestamp, so no rewrite pass exists. A field settled under
   `accepted-bounded-skew` shows no divergence by construction.
3. **Outcome divergence.** Re-execution against moved state may take a
   different branch, write different rows, or fail: conflicts surface
   as LLP 0008's typed conflict payload under the v1 LWW-per-field /
   delete-wins defaults; a speculative unique-index pass may still
   lose to `SNAPBACK_UNIQUE_CONSTRAINT_VIOLATION` at settle
   (LLP 0126, "What stays impossible"). This Spec adds no merge
   semantics; the authoritative outcome wins, the speculative layer is
   retired, and rejection reconciles exactly like rejection today.

The composed invariant: after the last pending intent settles or
fails, the client's durable view equals the server's at the receipt's
`snapshotVersion` — speculative residue never survives settlement.

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
  disposition, skewMs?}`; the id-map (lane L); and the committed
  `snapshotVersion` (shipped).
- **Privacy.** Claimed values can embed application data, so the full
  claim ledger and id-map ride only the submitting authority's own
  mutation response / stored settlement (the LLP 0043 replay ledger,
  auth-bound). Fan-out receipts to other subscribers carry the lane
  label and the shipped write-surface facts only, per the receipt
  privacy rule ("the diagnostic CODE only").

## What settlement verifies of the execution-identity tuple

Per LLP 0126 approach 9's five elements:

- **Element 1 (source/plan identity) — verified, fail-closed.** A
  lane-L submission carries the implementation hash the local run
  executed; settlement refuses a mismatch with the server's active
  artifact with a typed refusal into the resync-before-replay path
  (LLP 0081's quarantine seam). Never silently settled.
- **Element 5 (store semantics / schema epoch) — verified,
  fail-closed.** The submission carries the schema/artifact activation
  the local run executed against; mismatch takes the same typed
  refusal path. The capture-versus-settle *policy* (what the client
  does next) is ledger row 3's, proposed for LLP 0081; this Spec only
  requires that settlement detect and refuse, never guess.
- **Element 4 (host-call answer surface) — consumed per lane.** Lane Q
  replays `{generatedIds, now}` (the pin); lane L records the ctx
  answers as claims and re-derives. Neither lane treats a ctx-answer
  ledger entry as authority over credentials — handler identity is
  always the server-prepared credential projection (LLP 0051 D1's
  ENG-24605 boundary).
- **Elements 2 and 3 (runtime identity, deterministic-tier
  semantics) — not verified per-settlement.** They are proven
  out-of-band by their harnesses (LLP 0123 attestation; LLP 0051 D5's
  conformance corpus) under LLP 0129 exit criterion 3. A settlement
  receipt MAY carry the claimed evaluator identity as a labeled claim;
  it never gates commit in this Spec's version.

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
   submitted with the dangling id.
4. **Bounded skew.** A declared field within `maxSkewMs` settles with
   the claimed value, disposition `accepted-bounded-skew`, capability
   fact present; the same field out of bound settles re-derived and
   labeled. Falsified by opt-in acceptance without the capability fact
   or beyond the bound.
5. **Speculative is never settlement.** Kill the client after local
   execution, before reconnect: on relaunch the result renders marked
   speculative with no authoritative `snapshotVersion` binding, and a
   non-empty outbox takes full resync before replay (LLP 0090's rule).
6. **Tuple gate.** A lane-L submission with a stale activation or a
   mismatched implementation hash is refused typed into the
   quarantine/resync path; nothing settles. Falsified by a silent
   settle under either mismatch.

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
   owners (LLP 0043/0034/0093/0094); this Spec's vocabulary is
   semantic, not wire spelling.
2. Should lane-L admission *require* id-typed arg declarations so the
   id-map rewrite surface is contract-visible rather than
   leaf-equality-based? Interacts with row 2's bounded-profile
   admission vocabulary; the leaf-equality rule above is sound without
   it and stays the floor.
3. The capability-fact spelling and guide row for
   `settlement.bounded_skew`, with LLP 0012's claim classes and the
   guide conventions.
4. Whether the claimed evaluator identity (element 2) should ever gate
   settlement once LLP 0123 attestation is consumable server-side — a
   future strictness increase, never a weakening.

## Status

Draft (2026-07-31). Authored as LLP 0129 ledger row 1's owning Spec
under the author's decided policy (0127 decision 10, adjudicated
2026-07-30; registry LLP 0115 open question 8). Landing un-gates
ledger row 1; rows 2–5 still gate any `Parity`-by-construction claim
(LLP 0129 exit criterion 3). Review proceeds under LLP 0005 with
LLP 0130 SD-4 as the acceptance path.
