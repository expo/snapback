# Convex-ergonomics completion program (Program G)

**Status:** Resolved 2026-08-02
**Opened:** 2026-08-02, from Charlie's close-the-Convex-gap directive on the
parity synthesis (LLP 0116–0127 series + capability-index GAP rows + the
2026-08-02 backlog survey)
**Systems:** API, Codegen, Runtime, Client integration, Scheduling, Live queries
**Related:** LLP 0127 (six-move parity program), LLP 0115 (course-corrections
board), LLP 0070, LLP 0118, LLP 0121, LLP 0131, LLP 0155

## Why

The measured Convex preference in the sweeps came from daily authoring feel,
not platform breadth. The 2026-08-02 gap synthesis found four ergonomics items
that were designed but absent from every active program: the LLP 0127 move-1
type-flow remainder beyond LLP 0131, `runAfter`-class scheduling, the helper
reuse slice, and the register cliff. This program owns them.

Naming care: LLP 0127's moves (parity program) and LLP 0155's Moves
(local-sync direction) are different numbering. Tickets here say which they
mean.

## Tickets

- 01 scheduling: verify what Wave-1 lane C2 landed vs LLP 0070's
  transactional `runAfter`; scope and implement the remainder
- 02 LLP 0127 move-1 type-flow remainder: schema-referencing contract nodes +
  generated interior types (beyond the landed LLP 0131 args contracts)
- 03 helper reuse slice — BLOCKED on the helper-class cutline author decision
  (in the decision packet); verify what lane C1 (CV-7) already landed first
- 04 register cliff — CLOSED 2026-08-02 onto path (b), landed at `ceb205a6`
  and re-verified on current main: the cliff is the all-live format-1 group
  artifact, not sibling delivery. The mixed-route successor shape is now
  author-endorsed (`e87c37d8`), but its design and implementation remain
  deliberately sequenced after LLP 0157 acceptance; G-04 is not implemented.

Every ticket starts with a verify-against-main step: the fleet lands fast and
the survey's facts are hours old. Deliberately NOT here: aggregates (deferred
to LLP 0130 SD-2's evidence branch by the 0155 acceptance), Kotlin/Dart
clients (consciously deferred), hosted lifecycle (own future program).

## Coordination

- Ticket 02 must coordinate with the commissioned LLP 0155 Move-1
  composition-algebra Spec — both touch generated query/contract types.
- LLP 0135 snapshot-batch (Program A) and 0155 Move 1 are both LLP 0120
  option-3a family; whoever implements first pins the shared cursor grammar.
- House rules as in 20260802-0133-00: @ref annotations, ref-check, sketches as
  exit tests, ticket → issues/closed/ with resolution note, docs land with
  code.

## Running log

- **2026-08-02 — G-04 reproduced; protocol amendment proposed.** Current
  main retains live delivery and delta classification per child. The actual
  cliff is LLP 0112's generated format-1 all-`LiveQuery` group gate: a mixed
  route stays read-bundle-valid but loses registered boot as a group. Because
  LLP 0090's read/register mode is whole-request, an honest gradient requires
  a versioned mixed profile rather than a local codegen relaxation. The
  non-normative proposal is recorded in LLP 0090; implementation is gated on
  author acceptance and no change was made to the separately owned LLP 0157.
- **2026-08-02 — G-04 path-(b) exit verified and closed.** Current main and
  `eda8f231^` both pass the codegen mixed-route characterization; their
  `live_delta_v0` suites pass 9/9 and 7/7 respectively. The two additional
  current-main cases are the narrowed-contract replacement guards, not a
  moved register cliff. The filesystem ticket is closed onto the successor
  profile's acceptance gate; no gated implementation or capability claim was
  added.
- **2026-08-02 — G-03 closed as an already-landed duplicate.** Verification
  against current main found C1 commit `4d72c407` already implements the full
  context-reader-admitting LLP 0118 option-1a cut, with declared reads/writes
  retained as evidence rather than ceilings. Its current helper-sharing suite
  and LLP references are green; the redundant G-03 ticket moved to
  `issues/closed/` without changing code.
- **2026-08-02 — G-02 implementation complete, closure verification in
  progress.** Result-side app schema references expand through the existing
  document contract/hash, generated handler and `ctx.db` interiors derive
  from the same manifest artifacts, and A2 consumes both without changing its
  served result witness. The focused schema-evolution, unknown-table,
  args/stored-field refusal, capability split, and checkJs mismatch proofs are
  green. LLP 0157 remains Draft; no composition/query-graph type was authored
  or changed in this lane.
- **2026-08-02 — G-04 gate updated from the author packet.** Commit
  `e87c37d8` endorses the versioned mixed-route successor shape while
  sequencing its design and implementation after LLP 0157 acceptance. This
  changes the gate from “awaiting a ruling” to “accepted direction, deferred
  sequence”; it does not make the successor implemented and G-02 leaves LLP
  0157 untouched.

## Resolution

Program G closes with all four filesystem tickets resolved on current main:

- G-01 (`2cb96f4f`) verified that Wave-1 C2 already shipped LLP 0070's honest
  action-callee `runAfter` class and added its missing crash/reopen proof.
- G-02 (`f7112bd0`) landed result-side schema references and manifest-derived
  typed interiors within the LLP 0157 Draft boundary.
- G-03 verified Wave-1 C1 (`4d72c407`) had already landed the decided
  context-reader helper slice and closed as a duplicate.
- G-04 (`ceb205a6`) closed through its author-decision path. The mixed-route
  successor direction is endorsed by `e87c37d8`, but design and
  implementation remain sequenced after LLP 0157 acceptance; the successor
  is not implemented and no capability claim is made here.

The remaining composition and mixed-route work is therefore deliberately
owned by the accepted sequencing gates, not an open Program G ticket.
