# Day-2 diary — grok-day2 / snapback2@0.0.21

Lane copy of a finished Clique app. Live store in `.snapback/store.sqlite` (WAL recovered on owner start). Ports 52500 (owner) and 52501 (Expo web). No other lanes or Snapback checkouts inspected.

## CR1 — nullable `editedAt` on messages, migrate live data

**What the platform made easy.** Adding `editedAt: time ?` is an additive successor. `snapback2 check` certified a new generation; the already-running owner installed it in place: `addedColumns: ["messages.editedAt"]`, `from`/`to` reported, no drop, no restart, no `--apply-migration`. All 43 existing messages survived. Unedited rows came back with `editedAt: null` automatically. `messages.edit` could stamp `editedAt: now` in the same patch as `edited: true`.

**What was hard / ceremony.** A true backfill of the three already-edited rows is not implicit. The documented path is a `job` with `chunk … first 100 by byId` (tables already have implicit `byId`). That meant a new `snapback/admin.q`, then `run --plan`, `--dry-run`, `--wait` as `system`. The wait receipt wrote `messages: 3` plus `messageCounts: 3` and `visibleMessageCounts: 3` — the engine re-touched maintained counts even though grouping columns did not change.

**Migration procedure (5 steps, no drop).**

1. `snapback2 check` — certify (`generation=154dca…`, 71 ops).
2. Owner successor install — additive column, live.
3. `snapback2 run admin.fillEditedAt --as system --plan` — ceilings only.
4. `--dry-run` — `state=done`, `chunks=1`, discarded copy.
5. `--wait` — `state=done`, `chunks=1`, 3 message rows filled with `editedAt = at`.

Elapsed for the actual wait job: well under a second (43 rows, one chunk of 100). Plan+dry-run+wait together ~10s of wall, almost all CLI overhead.

**SQL/ORM comparison.** This is `ALTER TABLE messages ADD COLUMN editedAt … NULL` plus `UPDATE messages SET editedAt = at WHERE edited = 1`. Snapback’s additive successor is the ALTER: no lock I had to take, no expand/contract dance, and it refused to let me put a required column on populated rows (`E_SUCCESSOR_COLUMN_REQUIRED` is the documented trap). The fill job is the UPDATE, but chunked and resumable instead of one statement. More ceremony than a SQL migration file, less than a hand-rolled ORM expander: I never opened SQLite, never dumped rows, never wrote a down migration. I also never got a SQL-like “length of the UPDATE” — the receipt only says rows written per table.

**Proof.** Pre-migration thread snapshot (`d-alice-bob` sm0001–sm0006, `g-starter` 12 rows). After successor, those bodies still query. After fill, the three historical `edited=true` rows carry `editedAt`. A fresh send+edit on the live DM carries `editedAt=1789080307678`. Client surfaces `editedAt:<ms>` next to the bubble.

**Forced resets:** 0. Owner pid 57256 stayed up.

## CR2 — pinned messages

**What the platform made easy.** A new `pins` table + `pin`/`unpin`/`pinned` programs is another additive successor: `addedTables: ["pins"]` and four indexes, installed on the same owner without a drop. `unique byMessage` plus membership `read`/`insert` rules meant a non-member (`carol` on `d-alice-bob`) was refused (`NOT_FOUND` — she cannot read the message, so she cannot pin it). `client.observe(api.messages.pinned, …)` on two authenticated clients updated after Bob’s pin with no extra pub/sub code.

**What was hard.** Cap/index/immutability have to be spelled in Quarry; there is no “belongs-to conversation” join constraint beyond `after insert` / mutation `require`. I copied `conversationId` from the message in `pin` so a member cannot pin a foreign message into this conversation. Live observe needed an explicit wait loop (SSE is real but not instantaneous in a script). Playwright `getByTestId('sm-convo-bubble')` did not see RN-web nodes even when the screenshot showed bubbles — had to wait on visible text.

**Migration procedure (2 steps, no data job).**

1. `snapback2 check` — `generation=564cc1…`, 74 ops.
2. Owner successor install — new table, empty, existing messages untouched.

No fill job: pins start empty, which is the correct live-data meaning.

**SQL/ORM comparison.** Equivalent to `CREATE TABLE pins (…)` with FKs and a unique `(message_id)`. Snapback did the CREATE as a successor and wired live queries for free. I did not have to migrate existing rows. Adding the table did not rewrite messages. That is easier than an ORM that rebuilds the whole schema on diff. Harder: I cannot `SELECT` the new table from `psql`; `snapback2 data pins --as system` is the operator seat.

**Proof.** Bob pins `sm0001` → committed. Alice’s and Bob’s observers both show 1 row. Pins are per conversation (`d-alice-bob` has `sm0001`, `g-starter` has `sm0007`). Carol’s pin is rejected. Idempotent second pin does not duplicate. UI: Pin/Unpin on bubbles, “Pinned” list, Bob’s mobile viewport sees Alice’s pin live.

**Forced resets:** 0.

## CR3 — rename send-path proc + doc comment; re-run acceptance

**What the platform made easy.** Renaming `proc fanoutSend` → `proc dispatchOutbound` at all five send call sites compiled. Public operation shapes did not change. `snapback2 check` returned the **same** generation as CR2 (`from=to`). Internal procs appear to be elaborated/inlined, so a rename is a pure source refactor with no successor install, no client reload, no ID churn. `delivery.notify` accepted a JSDoc block (TypeScript effect module). After the rename, Alice’s send still landed in Bob’s thread.

**What was hard.** Quarry has **no** line comments. `// …` above the proc refused `E_QUARRY_SYNTAX` “unexpected top-level `/`”. That is a one-loop agent-error, not a platform crash; the refused successor never replaced the live generation. Acceptance `m7-a06` asserts `groups.get(d-alice-bob).count === 6`. That snapshot was true at end of day-1; CR1’s proof edit and CR3’s rename ping made it 8. The six starter bodies are still there. I did not drop the database to make the snapshot green.

**Migration procedure.** None for schema. One failed check (comment), one successful check (generation unchanged). Expo was restarted once by me (CI mode disabled hot reload; not a Snapback-forced reset).

**SQL/ORM comparison.** This is renaming a private helper and adding a doc comment. In SQL there is nothing to migrate. Snapback matched that: generation hash unchanged, live rows untouched. The surprise was the missing comment syntax in `.q` files.

**Proof.** Acceptance m1–m6 and m8 pass on the live owner (fresh accounts). m7 poll tests pass; m7 count snapshot fails for the reason above; a separate proof shows starter ids `sm0001`–`sm0006` still render and `g-starter` count still increments 12→13. `snapback2 test` journey passes; derived families block because `seed.ts` has no conversation/message rows (pre-existing). UI still shows history, `editedAt`, and live pins after the refactor.

**Forced resets:** 0. Owner never restarted.

## Overall

Snapback 0.0.21’s successor story for **additive** day-2 work is real: optional column and new table installed onto a populated store without a drop. The fill-job path is closer to a guarded, chunked UPDATE than to “just ALTER”. It is more steps than a single SQL migration, and the receipts are better than an ORM that only prints “schema is now X”. Destructive drops were not required. The honest pain is documentation of comments, the m7 snapshot coupling to exact live counts, and Expo web layout (chat strip overlapping the thread — pre-existing chrome, not introduced by the pins table).
