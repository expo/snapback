I graded valid local constructs independently, but did not credit semantics that directly depend on an invalid Quarry expression. No item was wholly not-attempted.

| submission | item | verdict |
|---|---|---|
| haiku-A-T03.ts | R1 | committed |
| haiku-A-T03.ts | R2 | avoided |
| haiku-A-T03.ts | R3 | avoided |
| haiku-C-T03.q | R1 | avoided |
| haiku-C-T03.q | R2 | avoided |
| haiku-C-T03.q | R3 | avoided |
| codex-C-T04.q | R1 | avoided |
| codex-C-T04.q | R2 | avoided |
| codex-C-T04.q | R3 | avoided |
| grok-C-T10.q | R1 | avoided |
| grok-C-T10.q | R2 | avoided |
| grok-C-T10.q | R3 | avoided |
| haiku-C-T01.q | R1 | avoided |
| haiku-C-T01.q | R2 | avoided |
| haiku-C-T01.q | R3 | committed |
| codex-A-T09.ts | R1 | avoided |
| codex-A-T09.ts | R2 | avoided |
| codex-A-T09.ts | R3 | avoided |
| grok-C-T09.q | R1 | avoided |
| grok-C-T09.q | R2 | avoided |
| grok-C-T09.q | R3 | avoided |
| haiku-A-T07.ts | R1 | avoided |
| haiku-A-T07.ts | R2 | committed |
| haiku-A-T07.ts | R3 | avoided |
| haiku-A-T07.ts | R4 | avoided |
| codex-C-T07.q | R1 | avoided |
| codex-C-T07.q | R2 | avoided |
| codex-C-T07.q | R3 | avoided |
| codex-C-T07.q | R4 | avoided |
| haiku-C-T08.q | R1 | committed |
| haiku-C-T08.q | R2 | avoided |
| haiku-C-T08.q | R3 | avoided |
| grok-A-T02.ts | R1 | avoided |
| grok-A-T02.ts | R2 | avoided |
| grok-A-T02.ts | R3 | avoided |
| codex-B-T05.ts | R1 | avoided |
| codex-B-T05.ts | R2 | avoided |
| codex-B-T05.ts | R3 | avoided |
| codex-B-T05.ts | R4 | avoided |

Notes:

- **haiku-A-T03.ts:** No invented API apparent. The unbounded applications scan and loop tally are exactly the prohibited structural-count implementation.
- **haiku-C-T03.q:** Quarry type-invalid: `postings[a.posting]` is `Row?`, so `.employer` cannot be accessed without handling absence. The dashboard itself uses the maintained total correctly.
- **codex-C-T04.q:** Quarry-valid; disclosure is explicitly declared with `(readable: public)`.
- **grok-C-T10.q:** Quarry-valid; the maintained count is complete and the `match` makes repeated joins idempotent.
- **haiku-C-T01.q:** Quarry-invalid: `classId` is a reference, not a row/page, so `classId { ... }` cannot be shaped. Consequently the required class-detail result is not produced, although the booking range and name access forms are locally correct.
- **codex-A-T09.ts:** No invented API apparent. The manual `hasMore ? "99+" : count()` presentation preserves capped semantics.
- **grok-C-T09.q:** Quarry-valid; `| count` remains a displayable `capped int`, and the nested show row includes its title.
- **haiku-A-T07.ts:** No invented API apparent. `db.scan(members.byClub, …)` has no `take`, so fanout is unbounded despite the stated club cap.
- **codex-C-T07.q:** Quarry-valid; the 200-row page and upsert implement bounded, correct fanout.
- **haiku-C-T08.q:** Quarry-invalid: the continued `or` line is not a specified continuation construct; `journalId.owner` accesses a field on a reference; and `journals[e.journal].owner` dereferences a `Row?` unsafely. Thus the owner-or-coach guard is not valid.
- **grok-A-T02.ts:** No invented API apparent. The viewer-prefix scan is bounded, descending, and preserves pagination through its page result and `after` input.
- **codex-B-T05.ts:** No invented API apparent. Expiry uses `ctx.commitTime`; `ctx.now()` is used only for the stored redemption timestamp.
