# Move-3 Phase-1 implementation program — the shared mutation IR, browser-side

**Status:** Open — program of tickets (LLP 0129 Phase 1, ADVANCED by
Charlie's dated 2026-08-03 gate ruling at OQ5; Kanban-gate exit
presentation due 2026-08-17)
**Related:** LLP 0129 Phase 1 (the phase machinery and gates — binding),
LLP 0155 §Move 3 (the execution contract), LLP 0051 (the IR + D5, now
including the 37/37 evidence baseline), LLP 0133 (settle-time trust),
LLP 0166 (the landed store the evaluator reads), the sizing spike + D5
evidence artifacts under `tests/acceptance/fixtures/write-lane/`

## Rules

The 0166 program's rules carry over (Specs are law; capability honesty;
owner machinery consumed; S4 green; verification pass per landing).
Phase-specific: LLP 0129's gates stay binding — OQ8's unshipped
mechanisms are THIS program's obligations; every claim rides D5-class
evidence; no `Parity` claim before the composition rule is satisfied;
advancement past Phase 1 is author-presented, never automatic.

## Lanes

| Lane | Scope | Gate |
| --- | --- | --- |
| M1 | The shipping browser-safe IR evaluator for the sized subset (Insert/Get/Guard/Patch): closed evaluation over admitted materialized rows only, private optimistic-layer writes, deterministic ctx-answer consumption as labeled claims, refusal classes ready/predictable-with-partial-input/server-only/refused (LLP 0155 §Move 3's execution contract), sized against the spike's ~20 KB envelope | D5 extension rows green on the shipping evaluator at pinned identities; bundle attribution measured |
| M2 | Local-read admission against the store: per-operation declared reads resolved through demanded materializations; the missing-vs-absent honesty rule; server-only degradation as an ordinary inspectable outcome | admission matrix oracle; no fabricated row effects |
| M3 | Rebase + settlement composition: authoritative delivery replaces base, confirmed layers retire by settlement identity, remaining IR ops replay in sequence, rebase outcomes recorded (LLP 0155 §Move 3 rebase steps; LLP 0133 identities) | 20-rapid-moves + locked-card + reload-during-settlement legs |
| M4 | The Kanban exit application: fresh provider-native Latency Kanban on generated IR with zero application-authored duplicate transforms; the full LLP 0155 Move-3 acceptance gate; boot-time IR replay closing the restart-renders-pre-intent gap (the Candidate-A payoff 0155 names) | the Move-3 gate transcribed: create/edit/assign/archive/reorder paint from IR; loss-free reload; separate receipts for source identity, local eval, settlement, observer convergence |

M1 → M2 → M3 → M4 serial in spirit; M1/M2 may interleave where the
evaluator's read admission demands it. Exit: the Kanban gate presented
to Charlie by 2026-08-17 with retained receipts; Phase-2 scheduling
stays 0129's.

## Progress

- **M1 LANDED 2026-08-03.** `@expo/snapback-client/ir-evaluator`: the
  shipping browser-safe evaluator; D5 harness now a thin adapter over
  shipped code — 37/37 Rust-vs-shipping-JS exact, 5/5 multi-table;
  full client suite green outside the sandbox; used-exports closure
  20,833 min / 7,383 gzip (inside the spike envelope; increment over
  the store 20,795 / 6,917). M2 (read admission against the store) is
  next.
- **M2 LANDED 2026-08-04.** `local-read-admission` in the client:
  fail-closed admission from declared IR reads through the ledger's
  demanded materializations; structural missing-vs-absent (rows null vs
  authoritative-empty []); only authoritative answers admit; degraded
  outcomes are inspectable objects. Admission oracle 4/4 with the
  20-cell matrix; S4 74/74 unchanged. M3 (rebase + settlement
  composition) is next.
- **M3 LANDED 2026-08-04.** `optimistic-rebase` in the client: layer
  identity = durable clientMutationId; layers reconstruct from outbox
  IR on reload (never persisted); replay = M2 admission then the M1
  evaluator; bridging layers retire on exact settlement identity;
  refused/server-only replays persist queued-only and inspectable;
  base + stack + rebase record publish atomically. Gates 3/3
  (20-rapid-moves, locked-card, reload-during-settlement); S4 74/74.
  M4 (the Kanban exit application) is the last lane.
