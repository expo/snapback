# Migration-experience program — execute LLP 0160's gap ledger

**Status:** Open (program)
**Opened:** 2026-08-03, commissioned by Charlie ("make 0160 actionable").
**Systems:** CLI, Runtime, Storage, Admin console, Guide, Testing
**Related:** LLP 0160 (north-star + the §5 gap ledger — THE single source
of truth for scope; this ticket deliberately does not restate ledger rows),
LLP 0081 (owns migration semantics; D-class rows conform code TO it,
A-class rows require dated amendments to it BEFORE semantics move),
LLP 0158 (G7/G7′ dependency), LLP 0093 (OQ3's protocol half)


## Triage (2026-08-26 leftover sweep)

Still open as the remaining 0160 ledger. Struck since filing: G1/G2/G6/G11. LLP 0160 table records **OQ6 ruled 2026-08-03** (tombstone-and-re-entry + dated 0081 amendment), so G4′b is no longer blocked on that question. G7/G7′ still blocked on LLP 0081 §7. Remaining live rows: G3′, G5, G9a+G10+G12+G13+G16, G14, G15, G8, G4′a.

## Structure

Work the §5 ledger in the doc's own suggested order, as tranches:

- **Tranche 1 (start now):** G2 (refusal message-text slice — zero
  infrastructure, ships immediately), then G1 (human rendering of
  plan/receipt with the golden fixture set and presentation contract),
  then G11 (populate `preconditionRows` — the example's own data source).
- **Tranche 2:** G3′ (intent scaffold), G6 (guide page + capability row),
  G5 (`snapback migrate status` + recovery experience).
- **Tranche 3 — the drift audit block:** G9a+G10+G12+G13+G16 as one
  conformance pass over the CLI, receipt, capability, dry-run, and
  rehearsal/backup seams. Route G9b (rollback input) to Charlie with the
  audit's evidence on why the shipped input was deliberate (OQ7).
- **Tranche 4:** G14 (diagnostic→recovery matrix, generated from the
  registry), G15 (admin inspection — meet the 0081 acceptance floor
  first, then the experience half), G8 (migration-scale evidence — the
  D-half is conformance drift: no test crosses the second batch
  boundary), G4′a.
- **Blocked, do not start:** G7/G7′ (fork rehearsal — F0a/F0b are landed, but
  the dated 0081 §7 amendment remains required), G4′b
  (needs the OQ6 Moment-8 ruling).

**Dependency update — 2026-08-03:** LLP 0158 F0a's custody/fidelity,
publication, credential-negative, and deny-all proofs landed, followed by
F0b's local CLI consumer and fleet dogfood. G7/G7′ is no longer blocked on
fork substrate or consumer availability; it remains blocked on the separately
required dated LLP 0081 §7 amendment. No rehearsal receipt is qualified by
F0a/F0b alone.

## Tranche 1 row status notes

- **2026-08-03 — G2 verified complete.** The ledger row asked every named
  non-additive field-retype and required-field/backfill refusal, including the
  physical-schema backstops, to route the operator to the reviewed migration
  workflow. The shipped messages name
  `snapback migrate preview --help`; tranche verification strengthened the
  regression contract from substring checks to full literal-message equality
  and added the dormant-table `NOT NULL` physical-backstop witness. Evidence:
  `cargo test --test local_v0` — 98 passed, 0 failed.
- **2026-08-03 — G1 verified complete.** The ledger row asked for default-on
  human plan/receipt presentation, review/narration redaction faces,
  render-before-approval authorization, deterministic width/color/exit
  behavior, traceability, and committed goldens. The shipped renderer retains
  those behaviors and now emits the explicit stable grammar identifier
  `migration-presentation-v1` on every human face; the contract and all six
  goldens pin it. Evidence: `cargo test --lib migration_presentation::tests`
  — 2 passed, 0 failed; `cargo test --test migration_cli_presentation_v1` —
  2 passed, 0 failed; `scripts/check-generated-artifacts` — passed.
- **2026-08-03 — G11 verified complete.** The ledger row asked preview to
  populate the separately digested `preconditionRows` carrier from the
  example's own target data source. Preview reads the target head and
  ceiling-bounded per-step row summaries in one pinned snapshot; the witness
  now also proves a target-row change advances the head, changes the summaries,
  and changes the observation digest without moving plan identity. Evidence:
  `cargo test --lib
  guarded_commit_tests::migration_preview_populates_bounded_precondition_rows`
  — 1 passed, 0 failed; the CLI witness is included in the 2/2 suite above.

These notes record row status only. LLP 0160 ledger reconciliation remains the
landing orchestrator's responsibility.

## Tranche 2 row status notes

- **2026-08-15 — G6 verified complete.** Commit `2e0e5e03a` joins the
  established `guide/backend/migrations.md` command loop to the new
  `guide/backend/schema-evolution.md` sessions narrative: schema identity
  rotation, complete-pair pin semantics, managed successor activation,
  diagnostic hashes, and exact-carrier recovery after partially materialized
  data. The capability index now has distinct migration and sessions-evolution
  rows, generated diagnostics route the startup-artifact and schema-evolution
  codes to the recovery sections, and retrieval case 56 proves intent routing.
  Evidence: `node scripts/check-guide.mjs` passed (140 pages, 1513 snippets,
  171 routes); `node scripts/check-retrieval-eval.mjs` passed (57 cases, 0
  errors); `packages/snapback-cli/sessions-dev-loop.test.mjs` passed; the
  filtered served-guide Rust route test passed.

## House rules

As the 0133/0154 programs: verify-against-main first; the R/D/A
governance lanes are binding — an A-class change lands its dated
amendment to the owning doc in the same commit or not at all; @ref
annotations; ./ref-check + guide check green on touched surfaces;
own-correctness green per the current wave policy; tickets for
sub-slices only if a tranche needs parallel hands; dated
implementation-record notes on LLP 0160 as tranches complete; ledger
rows get struck through in the LLP (with commit ids) as they close, so
the doc stays the single source of truth.

## Author rulings routed out of this program

> **2026-08-06 (sitting #4):** OQ3 is BLESSED as proposed — the
> compatibility-verdict presentation half stays owned here, the protocol
> fact is restated in LLP 0093. Record in the LLPs at implementation
> time. OQ6/OQ7 remain routed with their evidence packets as below.


- **OQ6 (Moment 8 settlement)** — gates G4′b; presented to Charlie
  separately with the decision input 0160 records.
- **OQ7 (G9b rollback input)** — presented with the drift audit's
  evidence when tranche 3 reaches it.
- **OQ3 (compatibility-verdict owner)** — 0160's proposed split
  (presentation half here, protocol fact restated in LLP 0093) awaits a
  cheap author blessing; record it in the LLP when given.

**Exit:** every unblocked ledger row closed with its class's governance
respected; blocked rows carry dated notes naming their dependency; guide
page live; LLP 0160 carries the implementation record. This ticket closes
citing the final ledger state.
