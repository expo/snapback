# Local-first continuation program — close the loop, then open the write lane

**Status:** Closed — all six lanes landed; the 2026-08-04 carrier exit records
16 PASS, the single still-owner-blocked Fleet GAP, 0 skipped, and no partial
result
**Opened:** 2026-08-03, by the Track A session on Charlie's direction to
continue the Zero-like local-first work
**Related:** LLP 0166 (Accepted; the store this program feeds), LLP 0157
(Accepted; the proofs this program makes real), LLP 0155 (the six-move
charter; Moves 1–2 read lane closing here, Move 3 opened by P0's
ruling), LLP 0129 (write-lane authority), the carrier-exit receipt's two
structural GAP rows, `issues/closed/20260803-0166-impl-program.md`

## Rules

The 0166 program's rules carry over verbatim: the Specs are law;
capability honesty (nothing advertises until its oracles pass); owner
machinery consumed, never reimplemented; S4 legacy parity stays green at
every landing; fresh worktrees; verification pass before every landing.
**Step-0 constraint:** Rust lanes are blocked in fresh worktrees by
`issues/20260803-bootstrap-hermes-profile-provenance-mismatch.md` — that
ticket is this program's step 0 (ibex/Hermes owner), or Rust lanes run
in a cargo-capable checkout until it lands.

## Lanes

| Lane | Ticket | What | Depends on |
| --- | --- | --- | --- |
| P0 | `20260803-p0-0129-phase1-ruling.md` | **Charlie's decision**: the LLP 0129 Phase-1 owner/timebox ruling that opens Move 3 (the shared mutation IR — the write half of the Zero-like experience) | nobody; it gates the write lane's start |
| P1 | `20260803-p1-server-proof-issuance.md` | Server-side `CompletenessProofV1` issuance: the trusted activation artifact + proof-key manifest through the generated/deployment path, Ed25519 signing at establishment, golden vectors (0157 §D3) | step 0 (Rust) |
| P2 | `20260803-p2-client-hydration-bridge.md` | The public client bridge that seeds LLP 0166 v3 materializations from a live backend (establishment → `commitPage` with real proofs) and renders the answer-class projection; flips the retained-render receipt GAP | P1 |
| P3 | `20260803-p3-triage-successor-app.md` | The fresh Triage Graph successor app on composites + the store (the Move 1/2 exit half not blocked by 0135 OQ5) + the OQ9 custody/hydration budget freeze from its first controlled run | P1+P2 |
| P4 | `20260803-p4-single-table-node-class.md` | The `single_table_v1` node-class proposal to the LLP 0004/0007 owners + 0157 registry (brings the shipped `rqsEligible` population under `qmk1`; carries 0166's anonymous-retention precondition) | none (design/owner work) |
| P5 | `20260803-p5-result-transform-implementation.md` | `TransformPlanV1` + the dual-runtime conformance corpus (0157 OQ9's home decision with the LLP 0051 owners first); per-plan owner opt-in stays the ship gate | corpus-home ruling |

Sequencing: P1 → P2 → P3 serial (each consumes the previous's wire
reality); P4 and P5 parallel to everything; P0 is Charlie's and unlocks
the *next* program (Move 3 implementation is deliberately not scoped
here — it gets its own program under 0129's machinery once P0 rules).

**Exit:** retained-render flips in a dated carrier-exit rerun; Triage
runs on the new machinery with its budgets frozen; P4/P5 land their
design outcomes (or record owner refusals honestly); a closing corpus
audit. Fleet Observatory stays explicitly out (blocked on 0135 OQ5 —
that admission belongs to its owners, not this program).

## 2026-08-04 wave-drift ownership note

The wave-end batch pass at main `640bae8db90b9fc6f4b9acef6dfbad9d9dad7b11`
cannot honestly regenerate the retained carrier-exit receipt. Its source
closure guard reports that
`packages/snapback-client/materialization-store.mjs` now hashes to
`dea7124b342782de1b97fa7216dcd77f1349d03dfae87ab9257fbd7a1313eff0`, while
the retained evidence is bound to
`c6bfcf376263b4d78d2533f661e3f7fcf8dedb72b674f743c612583dbfab7a3a`.
More importantly, the dated runner/evidence still treats the absence of the
Triage successor as a structural GAP even though P3 has now landed. Rerunning
that historical program unchanged would mint a knowingly false current
receipt, so the drift pass did not do so. This program owns the required
carrier-exit successor run: update its current assertions to the landed P2/P3
reality, preserve the standards-real lifecycle legs, and retain a newly dated
receipt before claiming this exit closed.

## Resolution — 2026-08-04

All P0–P5 lane tickets are closed. The successor carrier ran from clean source
`13f026cd31af3886e5e68512fd58912adf88eb29` on Darwin/arm64 with the coded
Ibex bootstrap and exact Node 24.18.0. It retained
`tests/acceptance/fixtures/local-persistent-store/carrier-exit.2026-08-04.v1.json`
and its dated bundle attribution: 16 legs PASS, the predeclared Fleet
Observatory successor remains one honest GAP on LLP 0135 OQ5, 0 legs were
skipped, and the receipt is not partial. Triage now passes from the P3
controlled-run receipt, OQ9 budget freeze, and current trusted successor
activation instead of remaining a stale structural GAP.

The closing LLP corpus audit found no code/document contradiction in the
receipt-only diff. `./ref-check --verbose` reports 168 LLP documents, 3,816
references across 10,667 files, 0 errors, and 0 unchecked references. The
Fleet GAP changes no capability claim and remains outside this program exactly
as commissioned.

## Coordination

Track B (forking: 0163→0164→0165, F0b dogfood) and Track C's 0160
migration program run in parallel under their own ownership — this
program touches neither territory. The 0160 program needs no new
tickets; its tranche 1 is dispatch-ready as written.
