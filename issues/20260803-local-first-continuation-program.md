# Local-first continuation program — close the loop, then open the write lane

**Status:** Open — program of tickets (wave-3 Track A follow-on; the
0166 implementation program exited with the read-side store landed and
two structural GAPs pointing exactly here)
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

## Coordination

Track B (forking: 0163→0164→0165, F0b dogfood) and Track C's 0160
migration program run in parallel under their own ownership — this
program touches neither territory. The 0160 program needs no new
tickets; its tranche 1 is dispatch-ready as written.
