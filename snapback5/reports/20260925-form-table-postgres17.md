# LLP 4001 §9 step 3 — Postgres 17 and Quarry form-table verification

**Status:** shared-baseline form-table binding recheck completed at
`da443e4d44` on 2026-09-25. All three provisional GAP rows now bind and
return from ✗ to ≈; the eight predeclared GAPs remain. RFC remains Draft.
Pre-test 1 is authorized from this commit and was not run. The
[dated recheck](#2026-09-25--shared-baseline-recheck-at-da443e4d44) records the
new commands and exact output; the original failures below remain historical
evidence, not current verdicts.

The original verification starting commit was `d9f177a434082e30dc295a0ed31440e1239bf75c`, branch
`sb5/proposal`. Revision 4 is local commit `0a2f2ce4f8`. Both commits have the
same Snapback 4 subtree, `f301a6910c90123238c26de7a2c6def2f9369843`.
No engine changes, other worktree, push, stash, publication or deployment.
The original report and its fixtures were the second local commit.

PostgreSQL is **17.10 (Homebrew)** at `/opt/homebrew/opt/postgresql@17/bin`.
Rust and Cargo are **1.97.0**. Cargo built the unchanged Snapback 4 workspace
once; subsequent `cargo run` checks reused that build. Its only warning was
the existing unused `MustBeShareDummy` trait in vendored tiny_http.

## Scope and outcomes

The row is one physical normative-table row in §3.1–§3.6, including all
alternatives in that row. Prose grammar witnesses are additional and do not
inflate the denominator. ✓/≈ are the RFC's mapping classifications, not
execution verdicts. The machine-readable mapping is
[rows.json](../stubs/rows.json); every admitted SQL row has an executed ROW
marker in [form-table.sql](../stubs/form-table.sql), and every lowering maps
to checked projects under [lowered](../stubs/lowered/).

| Snapshot | Total | ✓ | ≈ | ✗ |
| --- | ---: | ---: | ---: | ---: |
| Revision 3 (input) | 69 | 11 | 55 | 3 |
| Revision 4, before verification | 82 | 10 | 64 | 8 |
| After original verification | 82 | 10 | 61 | 11 |
| After shared-baseline recheck at `da443e4d44` | 82 | 10 | 64 | 8 |

**74 SQL rows PASS (original Postgres 17 run); 74 Quarry rows PASS
(shared-baseline recheck); 0 Quarry rows FAIL; 8 predeclared GAP rows have
neither SQL nor a lowered column.** The three rows that originally failed
occupy four isolated projects because field authority is checked both with
and without `readable by audience`. The SQL fixtures and all lowered
sources are unchanged; this recheck reruns Quarry only.

SQL stubs are IMMUTABLE typed constants with no side effects. The fixed mint
returns one dummy id, not a real allocator. PostgreSQL's FK/RLS/materialized
view behavior and those constants are not Snapback semantics. This exercise
checks executable spellings and binding; it does not implement the SQL
front end, prove IR equivalence, run the future §4 harness, or measure
runtime performance. All 34 fixture routines (including the trigger and both procedures) are
called. Their branches and embedded statements
are exercised by seeded calls, with page/mutation/policy calls under the
non-owner `form_reader` as well as ordinary calls. Expected E_RULE,
NOT_FOUND and CANNOT_FOLLOW_SELF are caught only by harness blocks that
assert the exact error message; unexpected failures abort the session.

## What the original verification changed

| Row / contract | Observation and correction |
| --- | --- |
| §3.1-02 effect work policy | The first lowering used a quoted file path and `attempts`, which Quarry rejects. Final form is `effect push retry 5 backoff 30s deadline 1h`; SQL has `attempts => 5`. Removed the no-op legacy module argument rather than implying SQL loads a worker. Bare effect remains a separate default-policy witness. |
| §3.1-08 scalar types | Stated that duration literals are ints in Quarry; `time` is integral Unix milliseconds spelled `timestamptz`, never a separate SQL `time` type. Epoch literals and interval helpers execute. |
| §3.2-10 residency | Added an explicit multi-principal membership fixture and clarified that the probe's viewer column determines the lowered `by .principal`; `recipient` remains the direct-row principal option. |
| §3.2-13 field authority / visibility | SQL configuration calls execute, but both proposed Quarry spellings fail: marked ✗ at this checkout. The owner-transition ambiguity is reported, not resolved by changing the engine or baseline spec. |
| §3.2-14 sequence | Generated SQL column executes; Quarry `sequence by` fails: marked ✗. |
| §3.3 grammar / §3.3-06 composed rules | Bare `.flag` / `old.flag` is not a Quarry rule. Required SQL booleans lower explicitly to `= true` (or `!= true` for NOT); corrected fixture binds. |
| §3.4-07 row-keyed maintain | SQL LEFT JOIN aggregate executes; proposed Quarry row-key syntax fails: marked ✗. |
| §3.5-09 streamed aggregate | A global messages count lacks a uniformly decided rule prefix. Qualified SQL and Quarry now pin conversationId; the matching count binds. |
| §3.5-13 list growth | Arguments cannot be reassigned, and general list binary `+` is unsupported. Copy ids into a local, then use its recognized single-item append (`grown = grown + [extra]`) with a typed id argument; cardinality/text-length witnesses bind. |
| §3.5-15 unpaged scans | Unscoped roster failed E_QUARRY_BOUND. Pin conversationId under the member cap/read audience; state the admitted bound requirement. |
| §3.6-09 jobs | A filtered sweep's principal index was mutable: E_JOB_CURSOR_INDEX. Its schema now declares principal immutable; the row states every sweep index uses id/immutable columns. Both sweeps bind. |
| §3.6-02 fixture | A positional one-field upsert is ambiguous between id and principal keys. Use `counters[principal = who]`, the row's full named unique key; no new language rule. |
| Stub emit signature | SQL-language functions cannot accept plain `record`. `once anyelement` accepts heterogeneous `row(...)` keys without lying about the SQL type; all stub functions remain IMMUTABLE constants. |

Revision 4 already repaired the review's six called-body failures: Home's
Following-row cast, expanded composite returns for Home/Global/Trending/
Thread, qualified set_like argument and omitted-id defaults. They all run
in the final transcript. The effect named argument and timestamp zero were
also repaired before that run. Both branches of people terminate; empty
and nonempty range/list cases, nullable comparisons, expression/block
helpers, hidden-miss-preserving shape spelling, jobs and qualified calls
are included. PostgreSQL successful execution is not a witness of future
Snapback disclosure behavior.

## Original Quarry failures (resolved by the dated recheck)

| RFC row | Exact final fixture | Observed diagnostic |
| --- | --- | --- |
| §3.2-13 | `field-authority/snapback/schema.q`; `field-authority-visible/snapback/schema.q` | E_QUARRY_TYPE: default for readUpTo must be a literal, now or viewer fitting int; the parser does not recognize the following `written by` / visibility clauses. |
| §3.2-14 | `sequence/snapback/schema.q` | E_QUARRY_SYNTAX: expected the end of the line, got `by`. |
| §3.4-07 | `row-keyed/snapback/schema.q` | E_QUARRY_SYNTAX: unknown maintain property `where`, with subsequent indentation recovery errors; this parser has no row-keyed maintain form. |

At the original verification, LLP 3000.015 was still Draft and its three
additions were absent from the assigned Snapback 4 source tree. No baseline
implementation was imported from another worktree or branch during that
verification. The required landing and recheck are now complete at
`da443e4d44`; the dated section below supersedes these failure verdicts.
Ordinary-column lookalikes were never counted as passes for these rows.

## Row-by-row results

SQL line links point to the relevant ROW marker (some DDL rows share setup).
Quarry links name representative programs that were actually bound; when
there is no emitted syntax (RLS enablement, implicit id, default residency)
the surrounding bound declaration is the witness. For the three rechecked
rows, the mark history is revision 4 → original verification → recheck;
`rows.json` retains revision 4 in `before` and the current mark in `after`.

| Row | Quarry form | Before → after | Postgres 17 | Quarry check |
| --- | --- | --- | --- | --- |
| §3.1-01 | `use identity password` | ≈ → ≈ | [PASS](../stubs/form-table.sql#L105) | PASS — [social](../stubs/lowered/social/snapback/schema.q), [types](../stubs/lowered/types/snapback/schema.q) |
| §3.1-02 | `effect push` | ≈ → ≈ | [PASS](../stubs/form-table.sql#L107) | PASS — [social](../stubs/lowered/social/snapback/schema.q), [effects](../stubs/lowered/effects/snapback/schema.q) |
| §3.1-03 | `viewer` | ≈ → ≈ | [PASS](../stubs/form-table.sql#L110) | PASS — [types](../stubs/lowered/types/snapback/schema.q) |
| §3.1-04 | `principal` column | ✓ → ✓ | [PASS](../stubs/form-table.sql#L11) | PASS — [types](../stubs/lowered/types/snapback/schema.q) |
| §3.1-05 | `t` reference column, `t ?` | ≈ → ≈ | [PASS](../stubs/form-table.sql#L11) | PASS — [social](../stubs/lowered/social/snapback/schema.q), [types](../stubs/lowered/types/snapback/schema.q) |
| §3.1-06 | intrinsic table `id` | ≈ → ≈ | [PASS](../stubs/form-table.sql#L11) | PASS — [types](../stubs/lowered/types/snapback/schema.q), [writes](../stubs/lowered/writes/snapback/schema.q) |
| §3.1-07 | bare `id` column, `id` argument | ≈ → ≈ | [PASS](../stubs/form-table.sql#L112) | PASS — [types](../stubs/lowered/types/snapback/schema.q) |
| §3.1-08 | `text`, `text <=N`, `text M..N`, `int`, `bool`, `time`, duration literals (`int`) | ≈ → ≈ | [PASS](../stubs/form-table.sql#L11) | PASS — [types](../stubs/lowered/types/snapback/schema.q), [social](../stubs/lowered/social/snapback/schema.q) |
| §3.1-09 | `format handle`, `format url` | ≈ → ≈ | [PASS](../stubs/form-table.sql#L11) | PASS — [types](../stubs/lowered/types/snapback/schema.q) |
| §3.1-10 | `enum('a','b')` | ✓ → ✓ | [PASS](../stubs/form-table.sql#L11) | PASS — [types](../stubs/lowered/types/snapback/schema.q), [rules](../stubs/lowered/rules/snapback/schema.q) |
| §3.1-11 | `default now`, literals | ✓ → ✓ | [PASS](../stubs/form-table.sql#L11) | PASS — [types](../stubs/lowered/types/snapback/schema.q) |
| §3.1-12 | `image <=N`, `video <=N`, `once` | ≈ → ≈ | [PASS](../stubs/form-table.sql#L11) | PASS — [types](../stubs/lowered/types/snapback/schema.q) |
| §3.2-01 | `unique a, b` | ✓ → ✓ | [PASS](../stubs/form-table.sql#L11) | PASS — [social](../stubs/lowered/social/snapback/schema.q) |
| §3.2-02 | `unique handle else HANDLE_TAKEN 'That handle is taken.'` | ≈ → ≈ | [PASS](../stubs/form-table.sql#L11) | PASS — [social](../stubs/lowered/social/snapback/schema.q), [types](../stubs/lowered/types/snapback/schema.q) |
| §3.2-03 | `immutable a, b` | ≈ → ≈ | [PASS](../stubs/form-table.sql#L118) | PASS — [social](../stubs/lowered/social/snapback/schema.q), [types](../stubs/lowered/types/snapback/schema.q) |
| §3.2-04 | `search a, b` | ≈ → ≈ | [PASS](../stubs/form-table.sql#L121) | PASS — [social](../stubs/lowered/social/snapback/schema.q), [types](../stubs/lowered/types/snapback/schema.q) |
| §3.2-05 | `cap 50 by conversationId` | ≈ → ≈ | [PASS](../stubs/form-table.sql#L11) | PASS — [social](../stubs/lowered/social/snapback/schema.q) |
| §3.2-06 | `cap 1 by principal`, `cap 50 by chat, message` | ≈ → ≈ | [PASS](../stubs/form-table.sql#L11) | PASS — [types](../stubs/lowered/types/snapback/schema.q) |
| §3.2-07 | `retain delivered-history` | ≈ → ≈ | [PASS](../stubs/form-table.sql#L123) | PASS — [social](../stubs/lowered/social/snapback/schema.q), [types](../stubs/lowered/types/snapback/schema.q) |
| §3.2-08 | `expire at .expiresAt` | ≈ → ≈ | [PASS](../stubs/form-table.sql#L125) | PASS — [social](../stubs/lowered/social/snapback/schema.q), [types](../stubs/lowered/types/snapback/schema.q) |
| §3.2-09 | online-only table | ✓ → ✓ | [PASS](../stubs/form-table.sql#L11) | PASS — [types](../stubs/lowered/types/snapback/schema.q) |
| §3.2-10 | `sync public`, `sync to members[.conversationId]`, `sync to .principal`, `sync … last N by .k`, `by .principal` | ≈ → ≈ | [PASS](../stubs/form-table.sql#L127) | PASS — [social](../stubs/lowered/social/snapback/schema.q), [types](../stubs/lowered/types/snapback/schema.q) |
| §3.2-11 | `likeCount: count likes`, `count posts by .parentId`, `sum likes of .weight`, `count … where …` | ≈ → ≈ | [PASS](../stubs/form-table.sql#L11) | PASS — [types](../stubs/lowered/types/snapback/schema.q) |
| §3.2-12 | `public 'reason'` | ≈ → ≈ | [PASS](../stubs/form-table.sql#L146) | PASS — [social](../stubs/lowered/social/snapback/schema.q), [types](../stubs/lowered/types/snapback/schema.q) |
| §3.2-13 | LLP 3000.015 `written by .principal` (+ `readable by audience`) | ≈ → ✗ → ≈ | [PASS](../stubs/form-table.sql#L142) | **PASS at `da443e4d44`** — [field-authority](../stubs/lowered/field-authority/snapback/schema.q), [field-authority-visible](../stubs/lowered/field-authority-visible/snapback/schema.q) |
| §3.2-14 | LLP 3000.015 `sequence by conversationId` | ≈ → ✗ → ≈ | [PASS](../stubs/form-table.sql#L11) | **PASS at `da443e4d44`** — [sequence](../stubs/lowered/sequence/snapback/schema.q) |
| §3.2-15 | `enable row level security` | ≈ → ≈ | [PASS](../stubs/form-table.sql#L146) | PASS — [rules](../stubs/lowered/rules/snapback/schema.q), [social](../stubs/lowered/social/snapback/schema.q) |
| §3.3-01 | `read <- expr` | ≈ → ≈ | [PASS](../stubs/form-table.sql#L146) | PASS — [rules](../stubs/lowered/rules/snapback/schema.q), [social](../stubs/lowered/social/snapback/schema.q) |
| §3.3-02 | `insert <- expr` | ✓ → ✓ | [PASS](../stubs/form-table.sql#L146) | PASS — [rules](../stubs/lowered/rules/snapback/schema.q), [social](../stubs/lowered/social/snapback/schema.q) |
| §3.3-03 | `delete <- expr` | ≈ → ≈ | [PASS](../stubs/form-table.sql#L146) | PASS — [rules](../stubs/lowered/rules/snapback/schema.q) |
| §3.3-04 | `update <- expr` (single image, tests the next row) | ≈ → ≈ | [PASS](../stubs/form-table.sql#L146) | PASS — [rules](../stubs/lowered/rules/snapback/schema.q), [social](../stubs/lowered/social/snapback/schema.q) |
| §3.3-05 | `update (old, next) <- expr` | ≈ → ≈ | [PASS](../stubs/form-table.sql#L184) | PASS — [rules](../stubs/lowered/rules/snapback/schema.q) |
| §3.3-06 | several rules for one effect | ≈ → ≈ | [PASS](../stubs/form-table.sql#L184) | PASS — [rules](../stubs/lowered/rules/snapback/schema.q) |
| §3.3-07 | `or viewer = 'service:x'` | ≈ → ≈ | [PASS](../stubs/form-table.sql#L146) | PASS — [rules](../stubs/lowered/rules/snapback/schema.q) |
| §3.3-08 | `created chats[.chat]` / `created messages[.message]` | ≈ → ≈ | [PASS](../stubs/form-table.sql#L181) | PASS — [rules](../stubs/lowered/rules/snapback/schema.q) |
| §3.3-09 | `through .ref` (LLP 3000.014) | ✗ → ✗ | GAP — no spelling | GAP — no lowered column |
| §3.4-01 | `view activity: posts where … { post: .id, actor: .authorId, at, repost: false }` + `reposts { … }` | ≈ → ≈ | [PASS](../stubs/form-table.sql#L223) | PASS — [social](../stubs/lowered/social/snapback/schema.q) |
| §3.4-02 | `view following: activity where .actor = viewer or exists follows[viewer, .actor]` | ≈ → ≈ | [PASS](../stubs/form-table.sql#L227) | PASS — [social](../stubs/lowered/social/snapback/schema.q) |
| §3.4-03 | `view followerCount: count follows by .followedId` | ≈ → ≈ | [PASS](../stubs/form-table.sql#L230) | PASS — [social](../stubs/lowered/social/snapback/schema.q) |
| §3.4-04 | `view originalPosts: count posts where .parentId = null by .authorId` | ≈ → ≈ | [PASS](../stubs/form-table.sql#L234) | PASS — [social](../stubs/lowered/social/snapback/schema.q) |
| §3.4-05 | `view receivedLikes: count likes by .postId.authorId` | ≈ → ≈ | [PASS](../stubs/form-table.sql#L237) | PASS — [social](../stubs/lowered/social/snapback/schema.q) |
| §3.4-06 | `view dailyLikes: count likes by .postId.authorId, day(.at)` | ≈ → ≈ | [PASS](../stubs/form-table.sql#L240) | PASS — [social](../stubs/lowered/social/snapback/schema.q) |
| §3.4-07 | LLP 3000.015 `view unread: count messages by members m where …` | ≈ → ✗ → ≈ | [PASS](../stubs/form-table.sql#L244) | **PASS at `da443e4d44`** — [row-keyed](../stubs/lowered/row-keyed/snapback/schema.q) |
| §3.4-08 | `view postTotals: … online only` | ≈ → ≈ | [PASS](../stubs/form-table.sql#L247) | PASS — [social](../stubs/lowered/social/snapback/schema.q) |
| §3.4-09 | `shape postCard = { *, author: profiles[principal = .authorId], replyCount: replyCount[.id], liked: exists likes[.id, viewer] }`, applied to two sources | ≈ → ≈ | [PASS](../stubs/form-table.sql#L252) | PASS — [social](../stubs/lowered/social/snapback/schema.q) |
| §3.4-10 | maintain residency without an override | ≈ → ≈ | [PASS](../stubs/form-table.sql#L230) | PASS — [social](../stubs/lowered/social/snapback/schema.q) |
| §3.4-11 | maintain `read <-` override | ✗ → ✗ | GAP — no spelling | GAP — no lowered column |
| §3.4-12 | nested point shapes and field replacement (`activityCard`, `messageCard`) | ≈ → ≈ | [PASS](../stubs/form-table.sql#L264) | PASS — [social](../stubs/lowered/social/snapback/schema.q) |
| §3.4-13 | spread `{ ...p, followers, following }` | ≈ → ≈ | [PASS](../stubs/form-table.sql#L272) | PASS — [social](../stubs/lowered/social/snapback/schema.q) |
| §3.5-01 | `query home(c: cursor ?): return following last 20 by .at after c activityCard` | ✓ → ✓ | [PASS](../stubs/form-table.sql#L275) | PASS — [social](../stubs/lowered/social/snapback/schema.q) |
| §3.5-02 | `query global(c)` | ✓ → ✓ | [PASS](../stubs/form-table.sql#L280) | PASS — [social](../stubs/lowered/social/snapback/schema.q) |
| §3.5-03 | `query thread(postId: posts, c)` | ≈ → ≈ | [PASS](../stubs/form-table.sql#L285) | PASS — [social](../stubs/lowered/social/snapback/schema.q) |
| §3.5-04 | `query people(q: text <=100, c)` | ≈ → ≈ | [PASS](../stubs/form-table.sql#L290) | PASS — [social](../stubs/lowered/social/snapback/schema.q) |
| §3.5-05 | `matching q` | ≈ → ≈ | [PASS](../stubs/form-table.sql#L290) | PASS — [social](../stubs/lowered/social/snapback/schema.q) |
| §3.5-06 | `socialProfile(handle: text 3..20 format handle)`: `profiles[handle = handle]! else NOT_FOUND`, spread, aggregate point reads, `exists` | ≈ → ≈ | [PASS](../stubs/form-table.sql#L298) | PASS — [social](../stubs/lowered/social/snapback/schema.q) |
| §3.5-07 | `insights`: `for d in range(a, b)`, list building, object return | ≈ → ≈ | [PASS](../stubs/form-table.sql#L311) | PASS — [social](../stubs/lowered/social/snapback/schema.q) |
| §3.5-08 | `trending`: `where .parentId = null and not .removed and .at > now - 24h and .at <= now last 10 by .likeCount, .at` | ≈ → ≈ | [PASS](../stubs/form-table.sql#L322) | PASS — [social](../stubs/lowered/social/snapback/schema.q) |
| §3.5-09 | aggregate reads without a view (streaming) | ≈ → ≈ | [PASS](../stubs/form-table.sql#L327) | PASS — [social](../stubs/lowered/social/snapback/schema.q) |
| §3.5-10 | `fn` helpers (`editWindow`, `receiptState`, …) | ≈ → ≈ | [PASS](../stubs/form-table.sql#L330) | PASS — [social](../stubs/lowered/social/snapback/schema.q) |
| §3.5-11 | `mutation edit(…): server` | ≈ → ≈ | [PASS](../stubs/form-table.sql#L345) | PASS — [writes](../stubs/lowered/writes/snapback/schema.q) |
| §3.5-12 | optional reference / bounded media argument | ≈ → ≈ | [PASS](../stubs/form-table.sql#L347) | PASS — [social](../stubs/lowered/social/snapback/schema.q) |
| §3.5-13 | `[id] <=50`, list growth and cardinality, text length | ≈ → ≈ | [PASS](../stubs/form-table.sql#L350) | PASS — [types](../stubs/lowered/types/snapback/schema.q) |
| §3.5-14 | `now - m.at <= editWindow()`, `now + shortTTL()` | ≈ → ≈ | [PASS](../stubs/form-table.sql#L330) | PASS — [social](../stubs/lowered/social/snapback/schema.q) |
| §3.5-15 | unpaged shaped scans (`roster`, `typingNow`), `first(read)` (`otherProfile`, `findGroup`) | ≈ → ≈ | [PASS](../stubs/form-table.sql#L355) | PASS — [social](../stubs/lowered/social/snapback/schema.q) |
| §3.5-16 | local `group(rows, 'emoji') { key, count(.items) }` | ✗ → ✗ | GAP — no spelling | GAP — no lowered column |
| §3.5-17 | named index `by byActorTime: actor, at` and dynamic `merge feedEvents … by byActorTime` | ✗ → ✗ | GAP — no spelling | GAP — no lowered column |
| §3.5-18 | reference list `[messages] <=50` | ✗ → ✗ | GAP — no spelling | GAP — no lowered column |
| §3.5-19 | independent sibling pages in one object | ✗ → ✗ | GAP — no spelling | GAP — no lowered column |
| §3.5-20 | LLP 3000.009 §6.2 `sql reading … returning …` | ✗ → ✗ | GAP — no spelling | GAP — no lowered column |
| §3.6-01 | `insert t { … } if absent` | ≈ → ≈ | [PASS](../stubs/form-table.sql#L373) | PASS — [writes](../stubs/lowered/writes/snapback/schema.q) |
| §3.6-02 | `upsert t[k] { … }` | ≈ → ≈ | [PASS](../stubs/form-table.sql#L379) | PASS — [writes](../stubs/lowered/writes/snapback/schema.q) |
| §3.6-03 | `update t[k] { … }` | ≈ → ≈ | [PASS](../stubs/form-table.sql#L386) | PASS — [writes](../stubs/lowered/writes/snapback/schema.q) |
| §3.6-04 | `update t[k] { … } if cond` | ≈ → ≈ | [PASS](../stubs/form-table.sql#L389) | PASS — [writes](../stubs/lowered/writes/snapback/schema.q) |
| §3.6-05 | `delete t[k]` | ≈ → ≈ | [PASS](../stubs/form-table.sql#L392) | PASS — [writes](../stubs/lowered/writes/snapback/schema.q) |
| §3.6-06 | `require cond else CODE` | ≈ → ≈ | [PASS](../stubs/form-table.sql#L395) | PASS — [writes](../stubs/lowered/writes/snapback/schema.q) |
| §3.6-07 | `emit push { … } once [a, b]` | ≈ → ≈ | [PASS](../stubs/form-table.sql#L399) | PASS — [writes](../stubs/lowered/writes/snapback/schema.q) |
| §3.6-08 | `if … else if exists likes[postId, viewer]` | ✓ → ✓ | [PASS](../stubs/form-table.sql#L402) | PASS — [writes](../stubs/lowered/writes/snapback/schema.q) |
| §3.6-09 | `job daily(periodStart, periodEnd): for p in profiles: …` | ≈ → ≈ | [PASS](../stubs/form-table.sql#L415) | PASS — [social](../stubs/lowered/social/snapback/schema.q) |
| §3.6-10 | `schedule dailyDigest every 1d at 08:00: daily` | ≈ → ≈ | [PASS](../stubs/form-table.sql#L428) | PASS — [social](../stubs/lowered/social/snapback/schema.q) |
| §3.6-11 | `schedule … : insights.daily` | ≈ → ≈ | [PASS](../stubs/form-table.sql#L432) | PASS — [social](../stubs/lowered/social/snapback/schema.q) |
| §3.6-12 | presence deciding only an emit | ✓ → ✓ | [PASS](../stubs/form-table.sql#L415) | PASS — [writes](../stubs/lowered/writes/snapback/schema.q), [social](../stubs/lowered/social/snapback/schema.q) |
| §3.6-13 | `after insert <-` | ✗ → ✗ | GAP — no spelling | GAP — no lowered column |

## Commands and process ownership

Run from `/Users/ccheever/projects/snapback-sb5` unless a different cwd is
shown. The exact expanded initdb/start/psql/stop commands, actual port and
recorded PID are in the transcript below; no running cluster was used.
Every attempt used a fresh `mkdtemp` directory beneath the authorized
`snapback-sb5-pg` root and a free port above 55000, then stopped that exact
postmaster after checking its PID file. All earlier attempts were stopped,
including the failed stub attempt. No process-name kill or cluster reuse.

```sh
# One initial build, cwd snapback4:
CARGO_TARGET_DIR=/Users/ccheever/projects/snapback-sb5/snapback5/stubs/.build cargo build --locked -p snapback4
# SQL verification (initdb, start, single psql session, PID-checked stop):
python3 snapback5/stubs/run-postgres.py
# Binding: one invocation per fixture project, reusable optional name filter:
python3 snapback5/stubs/run-quarry.py
python3 snapback5/stubs/run-quarry.py effects types field-authority-visible
python3 snapback5/stubs/run-quarry.py types
python3 snapback5/stubs/run-quarry.py social types
# Generate this report and the machine-readable row results:
python3 snapback5/stubs/write-report.py
# Corpus/reference check:
./ref-check --verbose
```

The requested `cd snapback4 && cargo run -p snapback4 -- check <file>` needs
a project cwd with this CLI: `check` ignores a positional file and discovers
`snapback/schema.q` from cwd. The runner therefore uses
`cargo run --locked --manifest-path /Users/ccheever/projects/snapback-sb5/snapback4/Cargo.toml -p snapback4 -- check <absolute-file>`
from each fixture project. Each project contains only that file plus its
explicit module (social also has `insights.q`). The same checked-out Cargo
workspace and built binary are used; generated clients and incremental
build output stay ignored under stubs. Exact commands and outputs follow.

All raw attempts, including intermediate failures and their corrected
rechecks, are committed as `20260925-postgres17-attempt-*.log` and
`20260925-quarry-*-attempt-*.log`; the final JSON results select the latest
check for each project. Display-only trailing spaces are normalized.

## Final Postgres transcript

```text
$ /opt/homebrew/opt/postgresql@17/bin/initdb -D /Users/ccheever/projects/snapback-sb5-pg/rev4-h7_da9lm/data -A trust --no-locale -E UTF8
The files belonging to this database system will be owned by user "ccheever".
This user must also own the server process.

The database cluster will be initialized with locale "C".
The default text search configuration will be set to "english".

Data page checksums are disabled.

creating directory /Users/ccheever/projects/snapback-sb5-pg/rev4-h7_da9lm/data ... ok
creating subdirectories ... ok
selecting dynamic shared memory implementation ... posix
selecting default "max_connections" ... 100
selecting default "shared_buffers" ... 128MB
selecting default time zone ... America/Los_Angeles
creating configuration files ... ok
running bootstrap script ... ok
performing post-bootstrap initialization ... ok
syncing data to disk ... ok

Success. You can now start the database server using:

    '/opt/homebrew/opt/postgresql@17/bin/pg_ctl' -D /Users/ccheever/projects/snapback-sb5-pg/rev4-h7_da9lm/data -l logfile start


[exit 0]
$ /opt/homebrew/opt/postgresql@17/bin/pg_ctl -D /Users/ccheever/projects/snapback-sb5-pg/rev4-h7_da9lm/data -l /Users/ccheever/projects/snapback-sb5-pg/rev4-h7_da9lm/server.log -o '-h 127.0.0.1 -k /Users/ccheever/projects/snapback-sb5-pg/rev4-h7_da9lm -p 55101 -c wal_level=logical' -w start
waiting for server to start.... done
server started

[exit 0]
Started postmaster PID 11240; data=/Users/ccheever/projects/snapback-sb5-pg/rev4-h7_da9lm/data; port=55101
$ /opt/homebrew/opt/postgresql@17/bin/psql -X -h /Users/ccheever/projects/snapback-sb5-pg/rev4-h7_da9lm -p 55101 -d postgres -v ON_ERROR_STOP=1 --echo-all -f /Users/ccheever/projects/snapback-sb5/snapback5/stubs/snapback.sql -f /Users/ccheever/projects/snapback-sb5/snapback5/stubs/form-table.sql
-- LLP 4001 §3.7 A: executable syntax/type dummies, never a runtime.
-- Every function is IMMUTABLE and returns a typed constant without side effects.
create schema snapback;
CREATE SCHEMA
create schema auth;
CREATE SCHEMA
create schema cron;
CREATE SCHEMA
create domain snapback.id as text;
CREATE DOMAIN
create domain snapback.principal as text;
CREATE DOMAIN
create domain snapback.cursor as text;
CREATE DOMAIN
create domain snapback.image as text;
CREATE DOMAIN
create domain snapback.video as text;
CREATE DOMAIN
create function snapback.mint() returns snapback.id language sql immutable as $$ select 'dummy-minted-id'::snapback.id $$;
CREATE FUNCTION
create function snapback.count(source text, by text default null, "where" text default null) returns bigint language sql immutable as $$ select 0::bigint $$;
CREATE FUNCTION
create function snapback.sum(source text, "of" text, by text default null, "where" text default null) returns bigint language sql immutable as $$ select 0::bigint $$;
CREATE FUNCTION
create function snapback.sequence(parent anyelement) returns bigint language sql immutable as $$ select 1::bigint $$;
CREATE FUNCTION
create function snapback.recorded(ref snapback.id, field text) returns snapback.principal language sql immutable as $$ select 'alice'::snapback.principal $$;
CREATE FUNCTION
create function snapback.day(at timestamptz) returns bigint language sql immutable as $$ select 0::bigint $$;
CREATE FUNCTION
create function snapback.hour(at timestamptz) returns bigint language sql immutable as $$ select 0::bigint $$;
CREATE FUNCTION
create function snapback.bytes(asset text) returns bigint language sql immutable as $$ select 0::bigint $$;
CREATE FUNCTION
create function snapback.duration(asset snapback.video) returns interval language sql immutable as $$ select interval '0 seconds' $$;
CREATE FUNCTION
create function snapback.format(name text) returns text language sql immutable as $$ select '.*'::text $$;
CREATE FUNCTION
create function snapback.cap(maximum bigint, variadic keys text[]) returns boolean language sql immutable as $$ select true $$;
CREATE FUNCTION
create function snapback.matches(row_value anyelement, query text) returns boolean language sql immutable as $$ select true $$;
CREATE FUNCTION
create function snapback.connected(who snapback.principal) returns boolean language sql immutable as $$ select false $$;
CREATE FUNCTION
create function snapback.emit(effect text, payload json, once anyelement) returns boolean language sql immutable as $$ select true $$;
CREATE FUNCTION
create function snapback.period_start() returns timestamptz language sql immutable as $$ select '2026-09-25 00:00:00+00'::timestamptz $$;
CREATE FUNCTION
create function snapback.period_end() returns timestamptz language sql immutable as $$ select '2026-09-26 00:00:00+00'::timestamptz $$;
CREATE FUNCTION
create function snapback.bound(items anyarray, maximum bigint) returns boolean language sql immutable as $$ select true $$;
CREATE FUNCTION
create function snapback.created(table_name text, key snapback.id) returns boolean language sql immutable as $$ select true $$;
CREATE FUNCTION
create function snapback.identity(kind text) returns boolean language sql immutable as $$ select true $$;
CREATE FUNCTION
create function snapback.effect(name text, attempts integer default null, backoff text default null, deadline text default null) returns boolean language sql immutable as $$ select true $$;
CREATE FUNCTION
create function snapback.publish(table_name text, horizon text default null, recipient text default null) returns boolean language sql immutable as $$ select true $$;
CREATE FUNCTION
create function snapback.retain(table_name text, mode text) returns boolean language sql immutable as $$ select true $$;
CREATE FUNCTION
create function snapback.expire_at(table_name text, column_name text) returns boolean language sql immutable as $$ select true $$;
CREATE FUNCTION
create function snapback.search(table_name text, variadic columns text[]) returns boolean language sql immutable as $$ select true $$;
CREATE FUNCTION
create function snapback.immutable(table_name text, variadic columns text[]) returns boolean language sql immutable as $$ select true $$;
CREATE FUNCTION
create function snapback.written_by(table_name text, column_name text, by text, visible boolean default false) returns boolean language sql immutable as $$ select true $$;
CREATE FUNCTION
create function snapback.once(table_name text, column_name text) returns boolean language sql immutable as $$ select true $$;
CREATE FUNCTION
create function snapback.online_only(view_name text) returns boolean language sql immutable as $$ select true $$;
CREATE FUNCTION
create function snapback.server(operation text) returns boolean language sql immutable as $$ select true $$;
CREATE FUNCTION
create function auth.uid() returns snapback.principal language sql immutable as $$ select 'alice'::snapback.principal $$;
CREATE FUNCTION
create publication snapback;
CREATE PUBLICATION
create function cron.schedule(name text, cron text, command text) returns bigint language sql immutable as $$ select 1::bigint $$;
CREATE FUNCTION
-- Complete executable witnesses for LLP 4001 §3.1–§3.6.
-- Fixture setup/DO assertions/GRANT/seed DML are harness, not admitted app syntax.
-- Non-GAP SQL rows execute; the three proposed-baseline rows also execute here.
set timezone = 'UTC';
SET
set datestyle = 'ISO, YMD';
SET
select version();
                                                            version
--------------------------------------------------------------------------------------------------------------------------------
 PostgreSQL 17.10 (Homebrew) on aarch64-apple-darwin25.6.0, compiled by Apple clang version 21.0.0 (clang-2100.1.1.101), 64-bit
(1 row)

create schema private;
CREATE SCHEMA
create schema insights;
CREATE SCHEMA
create role form_reader nologin;
CREATE ROLE
\echo ROW 3.1-04 3.1-05 3.1-06 3.1-08 3.1-09 3.1-10 3.1-11 3.1-12 3.2-01 3.2-02 3.2-05 3.2-06 3.2-09 3.2-11 3.2-14 definitions
ROW 3.1-04 3.1-05 3.1-06 3.1-08 3.1-09 3.1-10 3.1-11 3.1-12 3.2-01 3.2-02 3.2-05 3.2-06 3.2-09 3.2-11 3.2-14 definitions
create type role as enum ('member', 'admin');
CREATE TYPE
create type variant_role as enum ('a','b');
CREATE TYPE
select 'a'::variant_role;
 variant_role
--------------
 a
(1 row)

create table profiles (
 id snapback.id primary key default snapback.mint(),
 principal snapback.principal not null unique,
 display_name text not null check (length(display_name) between 1 and 50),
 handle text not null check (length(handle) between 3 and 20) check (handle ~ snapback.format('handle')),
 link text check (link ~ snapback.format('url')),
 created_at timestamptz not null default now(),
 constraint handle_taken unique(handle),
 check (snapback.cap(1, principal))
);
CREATE TABLE
comment on constraint handle_taken on profiles is 'That handle is taken.';
COMMENT
create table posts (
 id snapback.id primary key default snapback.mint(),
 author_id snapback.principal not null,
 parent_id snapback.id references posts(id),
 body text not null check (length(body) <= 500),
 photo snapback.image, video snapback.video,
 at timestamptz not null default now(), removed boolean not null default false,
 like_count bigint generated always as (snapback.count('likes')) stored,
 children_count bigint generated always as (snapback.count('posts', by => 'parent_id')) stored,
 weight_total bigint generated always as (snapback.sum('likes', of => 'weight')) stored,
 selected_count bigint generated always as (snapback.count('likes', by => 'post_id', "where" => 'selected')) stored,
 check (snapback.bytes(photo) <= 10000000), check (snapback.bytes(video) <= 50000000)
);
CREATE TABLE
create table likes (
 id snapback.id primary key default snapback.mint(),
 post_id snapback.id not null references posts(id), principal snapback.principal not null,
 at timestamptz not null default now(), weight bigint not null default 1,
 selected boolean not null default true, unique(post_id, principal)
);
CREATE TABLE
create table reposts (
 id snapback.id primary key default snapback.mint(),
 post_id snapback.id not null references posts(id), actor_id snapback.principal not null,
 at timestamptz not null default now(), unique(actor_id, post_id)
);
CREATE TABLE
create table follows (
 id snapback.id primary key default snapback.mint(),
 follower_id snapback.principal not null, followed_id snapback.principal not null,
 at timestamptz not null default now(), unique(follower_id, followed_id)
);
CREATE TABLE
create table conversations (id snapback.id primary key default snapback.mint());
CREATE TABLE
create table members (
 id snapback.id primary key default snapback.mint(),
 conversation_id snapback.id not null references conversations(id),
 principal snapback.principal not null, role role not null default 'member',
 read_up_to bigint not null default 0, left_at timestamptz,
 unique(conversation_id, principal), constraint at_most_50 check(snapback.cap(50, conversation_id))
);
CREATE TABLE
create table messages (
 id snapback.id primary key default snapback.mint(),
 conversation_id snapback.id not null references conversations(id), sender_id snapback.principal not null,
 body text not null, ordinal bigint generated always as (snapback.sequence(conversation_id)) stored,
 tombstone boolean not null default false, at timestamptz not null default now(),
 expires_at timestamptz, photo snapback.image not null default 'dummy-image',
 constraint photo_bound check(snapback.bytes(photo) <= 10000000)
);
CREATE TABLE
create table receipts (
 id snapback.id primary key default snapback.mint(),
 chat snapback.id not null references conversations(id),
 message snapback.id not null references messages(id),
 principal snapback.principal not null,
 read_at timestamptz not null default 'epoch'::timestamptz,
 unique(message, principal), check(snapback.cap(50, chat, message))
);
CREATE TABLE
create table scalar_forms (
 id snapback.id primary key default snapback.mint(), owner snapback.principal not null,
 tag snapback.id not null, plain text not null, small text not null check(length(small)<=20),
 ranged text not null check(length(ranged) between 3 and 20), n bigint not null,
 flag boolean not null, at timestamptz not null default now(),
 read_at timestamptz not null default 'epoch'::timestamptz,
 kind text not null check(kind in ('a','b')), photo snapback.image not null,
 clip snapback.video not null, check(snapback.bytes(photo)<=10000000),
 check(snapback.bytes(clip)<=50000000)
);
CREATE TABLE
insert into profiles(id,principal,display_name,handle) values ('pr-a','alice','Alice','alice'),('pr-b','bob','Bob','bobby');
INSERT 0 2
update profiles set link='https://example.com' where id='pr-a';
UPDATE 1
insert into posts(id,author_id,parent_id,body) values ('p1','alice',null,'hello');
INSERT 0 1
insert into posts(id,author_id,parent_id,body) values ('p2','bob','p1','reply');
INSERT 0 1
insert into likes(id,post_id,principal) values ('l1','p1','bob');
INSERT 0 1
insert into reposts(id,post_id,actor_id) values ('rp1','p1','alice');
INSERT 0 1
insert into follows(id,follower_id,followed_id) values ('f1','alice','bob'),('f2','bob','alice');
INSERT 0 2
insert into conversations(id) values ('c1');
INSERT 0 1
insert into members(id,conversation_id,principal,role) values ('m1','c1','alice','admin'),('m2','c1','bob','member');
INSERT 0 2
insert into messages(id,conversation_id,sender_id,body) values ('msg1','c1','bob','hello');
INSERT 0 1
insert into receipts(id,chat,message,principal) values ('r1','c1','msg1','alice');
INSERT 0 1
insert into scalar_forms(owner,tag,plain,small,ranged,n,flag,kind,photo,clip) values ('alice','tag','unbounded','small','range',3,true,'a','image','video');
INSERT 0 1
select id,owner,read_at,photo,clip from scalar_forms;
       id        | owner |        read_at         | photo | clip
-----------------+-------+------------------------+-------+-------
 dummy-minted-id | alice | 1970-01-01 00:00:00+00 | image | video
(1 row)

select like_count,children_count,weight_total,selected_count from posts order by id;
 like_count | children_count | weight_total | selected_count
------------+----------------+--------------+----------------
          0 |              0 |            0 |              0
          0 |              0 |            0 |              0
(2 rows)

select ordinal from messages;
 ordinal
---------
       1
(1 row)

\echo ROW 3.1-01 identity
ROW 3.1-01 identity
select snapback.identity('password');
 identity
----------
 t
(1 row)

\echo ROW 3.1-02 effect bare and explicit work policy
ROW 3.1-02 effect bare and explicit work policy
select snapback.effect('push');
 effect
--------
 t
(1 row)

select snapback.effect('push', attempts => 5, backoff => '30s', deadline => '1h');
 effect
--------
 t
(1 row)

\echo ROW 3.1-03 viewer
ROW 3.1-03 viewer
select auth.uid();
  uid
-------
 alice
(1 row)

\echo ROW 3.1-07 bare id argument
ROW 3.1-07 bare id argument
create function echo_id(value snapback.id) returns snapback.id language sql immutable as $$ select value $$;
CREATE FUNCTION
select echo_id('client-minted-id');
     echo_id
------------------
 client-minted-id
(1 row)

\echo ROW 3.1-12 media metadata and once
ROW 3.1-12 media metadata and once
select snapback.bytes('image'), snapback.duration('video'::snapback.video);
 bytes | duration
-------+----------
     0 | 00:00:00
(1 row)

select snapback.once('messages','photo');
 once
------
 t
(1 row)

\echo ROW 3.2-03 immutable
ROW 3.2-03 immutable
select snapback.immutable('posts','author_id','parent_id','at');
 immutable
-----------
 t
(1 row)

select snapback.immutable('members','principal');
 immutable
-----------
 t
(1 row)

\echo ROW 3.2-04 search
ROW 3.2-04 search
select snapback.search('profiles','display_name','handle');
 search
--------
 t
(1 row)

\echo ROW 3.2-07 retain
ROW 3.2-07 retain
select snapback.retain('messages','delivered-history');
 retain
--------
 t
(1 row)

\echo ROW 3.2-08 expiry
ROW 3.2-08 expiry
select snapback.expire_at('messages','expires_at');
 expire_at
-----------
 t
(1 row)

\echo ROW 3.2-10 inferred and explicit residency
ROW 3.2-10 inferred and explicit residency
select snapback.publish('profiles');
 publish
---------
 t
(1 row)

select snapback.publish('messages');
 publish
---------
 t
(1 row)

select snapback.publish('messages',horizon => 'last 500 by at');
 publish
---------
 t
(1 row)

select snapback.publish('receipts',recipient => 'principal');
 publish
---------
 t
(1 row)

select snapback.publish('receipts',horizon => 'last 500 by read_at',recipient => 'principal');
 publish
---------
 t
(1 row)

-- Membership recipient qualification is inferred from the read-policy probe.
create table audience_groups(id snapback.id primary key);
CREATE TABLE
create table audience_members(id snapback.id primary key, group_id snapback.id not null references audience_groups(id), principal snapback.principal not null, added_by snapback.principal not null, unique(group_id,principal));
CREATE TABLE
alter table audience_members enable row level security;
ALTER TABLE
create policy audience_read on audience_members for select using(exists(select 1 from audience_members m where m.group_id=audience_members.group_id and m.principal=auth.uid()));
CREATE POLICY
select snapback.publish('audience_members');
 publish
---------
 t
(1 row)

-- Read this self-probe as the owner for spelling verification; Postgres RLS
-- recursion is the already-registered policy-semantic difference.
select * from audience_members;
 id | group_id | principal | added_by
----+----------+-----------+----------
(0 rows)

\echo ROW 3.2-13 field authority private and readable by audience
ROW 3.2-13 field authority private and readable by audience
select snapback.written_by('members','read_up_to',by => 'principal');
 written_by
------------
 t
(1 row)

select snapback.written_by('members','read_up_to',by => 'principal',visible => true);
 written_by
------------
 t
(1 row)

\echo ROW 3.2-12 3.2-15 3.3-01 3.3-02 3.3-03 3.3-04 3.3-07 policies
ROW 3.2-12 3.2-15 3.3-01 3.3-02 3.3-03 3.3-04 3.3-07 policies
alter table profiles enable row level security;
ALTER TABLE
alter table posts enable row level security;
ALTER TABLE
alter table likes enable row level security;
ALTER TABLE
alter table reposts enable row level security;
ALTER TABLE
alter table follows enable row level security;
ALTER TABLE
alter table members enable row level security;
ALTER TABLE
alter table messages enable row level security;
ALTER TABLE
alter table receipts enable row level security;
ALTER TABLE
create policy profiles_public on profiles for select using(true);
CREATE POLICY
comment on policy profiles_public on profiles is 'Clique profiles are discoverable';
COMMENT
create policy profiles_insert on profiles for insert with check(principal=auth.uid());
CREATE POLICY
create policy profiles_update on profiles for update using(principal=auth.uid()) with check(principal=auth.uid());
CREATE POLICY
create policy posts_public on posts for select using(true);
CREATE POLICY
create policy posts_insert on posts for insert with check(author_id=auth.uid());
CREATE POLICY
create policy posts_update on posts for update using(author_id=auth.uid());
CREATE POLICY
create policy likes_public on likes for select using(true);
CREATE POLICY
create policy likes_insert on likes for insert with check(principal=auth.uid());
CREATE POLICY
create policy likes_delete on likes for delete using(principal=auth.uid());
CREATE POLICY
create policy reposts_public on reposts for select using(true);
CREATE POLICY
create policy follows_public on follows for select using(true);
CREATE POLICY
-- A plain owner rule makes PostgreSQL non-owner probes nonrecursive. Snapback's
-- self-probe spelling is exercised separately below through the admitted helper.
create policy members_read on members for select using(principal=auth.uid());
CREATE POLICY
create policy messages_read on messages for select using(exists(select 1 from members m where m.conversation_id=messages.conversation_id and m.principal=auth.uid()) or auth.uid()='service:x');
CREATE POLICY
create policy messages_insert on messages for insert with check(sender_id=auth.uid() and exists(select 1 from members m where m.conversation_id=messages.conversation_id and m.principal=auth.uid()));
CREATE POLICY
create policy receipts_read on receipts for select using(principal=auth.uid());
CREATE POLICY
\echo ROW 3.3-01 probe residuals and null-safe grammar
ROW 3.3-01 probe residuals and null-safe grammar
create function private.is_member(c snapback.id) returns boolean language sql stable security definer as $$
 select exists(select 1 from members m where m.conversation_id=c and m.principal=auth.uid() and m.left_at is null)
$$;
CREATE FUNCTION
select private.is_member('c1'),private.is_member('missing');
 is_member | is_member
-----------+-----------
 t         | f
(1 row)

create policy residual_member on messages as restrictive for select using(exists(select 1 from members m where m.conversation_id=messages.conversation_id and m.principal is not distinct from auth.uid() and m.left_at is null));
CREATE POLICY
create policy self_probe on members for insert with check(exists(select 1 from members m where m.conversation_id=members.conversation_id and m.principal=auth.uid() and m.role='admin'));
CREATE POLICY
create policy null_safe on posts as restrictive for select using(parent_id is null or parent_id is not distinct from id or parent_id is distinct from id);
CREATE POLICY
\echo ROW 3.3-08 created messages
ROW 3.3-08 created messages
create policy fresh on receipts for insert with check(snapback.created('messages',message));
CREATE POLICY
select snapback.created('messages','msg1');
 created
---------
 t
(1 row)

\echo ROW 3.3-05 3.3-06 transition and explicit grant
ROW 3.3-05 3.3-06 transition and explicit grant
create policy update_base on receipts for update using(true) with check(true);
CREATE POLICY
create policy owner_restrict on receipts as restrictive for update using(principal=auth.uid()) with check(principal=auth.uid());
CREATE POLICY
create function receipt_transition() returns trigger language plpgsql as $$ begin
 if not (new.principal is not distinct from old.principal) then raise exception 'E_RULE'; end if;
 return new;
end $$;
CREATE FUNCTION
create trigger receipt_guard before update on receipts for each row execute function receipt_transition();
CREATE TRIGGER
create table all_rules(id snapback.id primary key, owner snapback.principal not null, flag boolean not null);
CREATE TABLE
alter table all_rules enable row level security;
ALTER TABLE
create policy owner_all on all_rules for all using(owner=auth.uid()) with check(owner=auth.uid());
CREATE POLICY
create policy flag_restrict on all_rules as restrictive for all using(flag) with check(flag);
CREATE POLICY
insert into all_rules values ('a1','alice',true);
INSERT 0 1
-- Privileges are harness only. All policy-sensitive calls run as a non-owner.
grant usage on schema public,snapback,auth,private,insights to form_reader;
GRANT
grant select,insert,update,delete on all tables in schema public to form_reader;
GRANT
set role form_reader;
SET
select current_user,private.is_member('c1');
 current_user | is_member
--------------+-----------
 form_reader  | t
(1 row)

select * from messages;
  id  | conversation_id | sender_id | body  | ordinal | tombstone |              at               | expires_at |    photo
------+-----------------+-----------+-------+---------+-----------+-------------------------------+------------+-------------
 msg1 | c1              | bob       | hello |       1 | f         | 2026-09-25 06:54:20.809012+00 |            | dummy-image
(1 row)

insert into profiles(id,principal,display_name,handle) values ('pr-test','alice','Another','another') on conflict do nothing;
INSERT 0 0
update profiles set display_name='Alice updated' where id='pr-a';
UPDATE 1
update posts set body='hello updated' where id='p1';
UPDATE 1
insert into members(id,conversation_id,principal,role) values ('m-existing','c1','alice','admin') on conflict do nothing;
INSERT 0 0
insert into receipts(id,chat,message,principal) values ('r-existing','c1','msg1','alice') on conflict do nothing;
INSERT 0 0
update receipts set read_at='2026-09-25 00:00:00+00' where id='r1';
UPDATE 1
update all_rules set flag=true where id='a1';
UPDATE 1
delete from all_rules where id='missing';
DELETE 0
-- Harness catches the deliberately triggered exception so ON_ERROR_STOP stays on.
do $$ begin
 begin
  update receipts set principal='mallory' where id='r1';
  raise exception 'HARNESS: expected E_RULE';
 exception when raise_exception then
  if sqlerrm <> 'E_RULE' then raise; end if;
  raise notice 'EXPECTED transition E_RULE';
 end;
end $$;
psql:/Users/ccheever/projects/snapback-sb5/snapback5/stubs/form-table.sql:220: NOTICE:  EXPECTED transition E_RULE
DO
reset role;
RESET
\echo ROW 3.4-01 activity union
ROW 3.4-01 activity union
create view activity as select id,id as post,author_id as actor,at,false as repost from posts where parent_id is null and not removed
union all select id,post_id,actor_id,at,true from reposts;
CREATE VIEW
select * from activity order by id;
 id  | post | actor |              at               | repost
-----+------+-------+-------------------------------+--------
 p1  | p1   | alice | 2026-09-25 06:54:20.807579+00 | f
 rp1 | p1   | alice | 2026-09-25 06:54:20.80817+00  | t
(2 rows)

\echo ROW 3.4-02 following
ROW 3.4-02 following
create materialized view following as select * from activity where actor=auth.uid() or exists(select 1 from follows f where f.follower_id=auth.uid() and f.followed_id=activity.actor);
SELECT 2
select * from following order by id;
 id  | post | actor |              at               | repost
-----+------+-------+-------------------------------+--------
 p1  | p1   | alice | 2026-09-25 06:54:20.807579+00 | f
 rp1 | p1   | alice | 2026-09-25 06:54:20.80817+00  | t
(2 rows)

\echo ROW 3.4-03 3.4-10 count and inherited residency
ROW 3.4-03 3.4-10 count and inherited residency
create materialized view follower_count as select followed_id,count(*) as count from follows group by followed_id;
SELECT 2
create materialized view following_count as select follower_id,count(*) as count from follows group by follower_id;
SELECT 2
select * from follower_count;
 followed_id | count
-------------+-------
 bob         |     1
 alice       |     1
(2 rows)

\echo ROW 3.4-04 filtered count
ROW 3.4-04 filtered count
create materialized view original_posts as select author_id,count(*) as count from posts where parent_id is null group by author_id;
SELECT 1
select * from original_posts;
 author_id | count
-----------+-------
 alice     |     1
(1 row)

\echo ROW 3.4-05 recorded attribution
ROW 3.4-05 recorded attribution
create materialized view received_likes as select snapback.recorded(post_id,'author_id') as author_id,count(*) as count from likes group by 1;
SELECT 1
select * from received_likes;
 author_id | count
-----------+-------
 alice     |     1
(1 row)

\echo ROW 3.4-06 day aggregate
ROW 3.4-06 day aggregate
create materialized view daily_likes as select snapback.recorded(post_id,'author_id') as author_id,snapback.day(at) as day,count(*) as count from likes group by 1,2;
SELECT 1
select * from daily_likes;
 author_id | day | count
-----------+-----+-------
 alice     |   0 |     1
(1 row)

select snapback.day(now()),snapback.hour(now());
 day | hour
-----+------
   0 |    0
(1 row)

\echo ROW 3.4-07 row keyed view proposed baseline
ROW 3.4-07 row keyed view proposed baseline
create materialized view unread as select m.id,count(x.id) as count from members m left join messages x on x.conversation_id=m.conversation_id and x.ordinal>m.read_up_to and x.sender_id<>m.principal and not x.tombstone group by m.id;
SELECT 2
select * from unread order by id;
 id | count
----+-------
 m1 |     1
 m2 |     0
(2 rows)

\echo ROW 3.4-08 online maintain
ROW 3.4-08 online maintain
create materialized view post_totals as select author_id,count(*) as count from posts group by author_id;
SELECT 2
select snapback.online_only('post_totals');
 online_only
-------------
 t
(1 row)

select snapback.online_only('follower_count');
 online_only
-------------
 t
(1 row)

create materialized view reply_count as select parent_id,count(*) as count from posts group by parent_id;
SELECT 2
\echo ROW 3.4-09 shape with nullable aggregate point
ROW 3.4-09 shape with nullable aggregate point
create type post_card_t as (
 id snapback.id,author_id snapback.principal,parent_id snapback.id,body text,photo snapback.image,video snapback.video,
 at timestamptz,removed boolean,like_count bigint,children_count bigint,weight_total bigint,selected_count bigint,
 author profiles,reply_count bigint,liked boolean
);
CREATE TYPE
create function post_card(p posts) returns post_card_t language sql stable as $$
 select p.*,(select pr from profiles pr where pr.principal=p.author_id) as author,
 (select c.count from reply_count c where c.parent_id=p.id) as reply_count,
 exists(select 1 from likes l where l.post_id=p.id and l.principal=auth.uid()) as liked
$$;
CREATE FUNCTION
select (post_card(p)).* from posts p order by p.id;
 id | author_id | parent_id |     body      | photo | video |              at               | removed | like_count | children_count | weight_total | selected_count |                                         author                                         | reply_count | liked
----+-----------+-----------+---------------+-------+-------+-------------------------------+---------+------------+----------------+--------------+----------------+----------------------------------------------------------------------------------------+-------------+-------
 p1 | alice     |           | hello updated |       |       | 2026-09-25 06:54:20.807579+00 | f       |          0 |              0 |            0 |              0 | (pr-a,alice,"Alice updated",alice,https://example.com,"2026-09-25 06:54:20.807063+00") |           1 | f
 p2 | bob       | p1        | reply         |       |       | 2026-09-25 06:54:20.807789+00 | f       |          0 |              0 |            0 |              0 | (pr-b,bob,Bob,bobby,,"2026-09-25 06:54:20.807063+00")                                  |             | f
(2 rows)

\echo ROW 3.4-12 nested shape and replacement
ROW 3.4-12 nested shape and replacement
create type activity_card_t as (id snapback.id,post post_card_t,actor profiles,at timestamptz,repost boolean);
CREATE TYPE
create function activity_card(a activity) returns activity_card_t language sql stable as $$
 select a.id,(select post_card(p) from posts p where p.id=a.post) as post,
 (select pr from profiles pr where pr.principal=a.actor) as actor,a.at,a.repost
$$;
CREATE FUNCTION
select (activity_card(a)).* from activity a;
 id  |                                                                                   post                                                                                   |                                         actor                                          |              at               | repost
-----+--------------------------------------------------------------------------------------------------------------------------------------------------------------------------+----------------------------------------------------------------------------------------+-------------------------------+--------
 p1  | (p1,alice,,"hello updated",,,"2026-09-25 06:54:20.807579+00",f,0,0,0,0,"(pr-a,alice,""Alice updated"",alice,https://example.com,""2026-09-25 06:54:20.807063+00"")",1,f) | (pr-a,alice,"Alice updated",alice,https://example.com,"2026-09-25 06:54:20.807063+00") | 2026-09-25 06:54:20.807579+00 | f
 rp1 | (p1,alice,,"hello updated",,,"2026-09-25 06:54:20.807579+00",f,0,0,0,0,"(pr-a,alice,""Alice updated"",alice,https://example.com,""2026-09-25 06:54:20.807063+00"")",1,f) | (pr-a,alice,"Alice updated",alice,https://example.com,"2026-09-25 06:54:20.807063+00") | 2026-09-25 06:54:20.80817+00  | t
(2 rows)

select (activity_card(row(f.id,f.post,f.actor,f.at,f.repost)::activity)).* from following f;
 id  |                                                                                   post                                                                                   |                                         actor                                          |              at               | repost
-----+--------------------------------------------------------------------------------------------------------------------------------------------------------------------------+----------------------------------------------------------------------------------------+-------------------------------+--------
 p1  | (p1,alice,,"hello updated",,,"2026-09-25 06:54:20.807579+00",f,0,0,0,0,"(pr-a,alice,""Alice updated"",alice,https://example.com,""2026-09-25 06:54:20.807063+00"")",1,f) | (pr-a,alice,"Alice updated",alice,https://example.com,"2026-09-25 06:54:20.807063+00") | 2026-09-25 06:54:20.807579+00 | f
 rp1 | (p1,alice,,"hello updated",,,"2026-09-25 06:54:20.807579+00",f,0,0,0,0,"(pr-a,alice,""Alice updated"",alice,https://example.com,""2026-09-25 06:54:20.807063+00"")",1,f) | (pr-a,alice,"Alice updated",alice,https://example.com,"2026-09-25 06:54:20.807063+00") | 2026-09-25 06:54:20.80817+00  | t
(2 rows)

\echo ROW 3.4-13 spread object
ROW 3.4-13 spread object
create type social_profile_t as (id snapback.id,principal snapback.principal,display_name text,handle text,link text,created_at timestamptz,followers bigint,following boolean);
CREATE TYPE
\echo ROW 3.5-01 home
ROW 3.5-01 home
create function home(c snapback.cursor default null) returns setof activity_card_t language plpgsql stable as $$ begin
 return query select (activity_card(row(f.id,f.post,f.actor,f.at,f.repost)::activity)).* from following f order by f.at desc limit 20; return;
end $$;
CREATE FUNCTION
select * from home();
 id  |                                                                                   post                                                                                   |                                         actor                                          |              at               | repost
-----+--------------------------------------------------------------------------------------------------------------------------------------------------------------------------+----------------------------------------------------------------------------------------+-------------------------------+--------
 rp1 | (p1,alice,,"hello updated",,,"2026-09-25 06:54:20.807579+00",f,0,0,0,0,"(pr-a,alice,""Alice updated"",alice,https://example.com,""2026-09-25 06:54:20.807063+00"")",1,f) | (pr-a,alice,"Alice updated",alice,https://example.com,"2026-09-25 06:54:20.807063+00") | 2026-09-25 06:54:20.80817+00  | t
 p1  | (p1,alice,,"hello updated",,,"2026-09-25 06:54:20.807579+00",f,0,0,0,0,"(pr-a,alice,""Alice updated"",alice,https://example.com,""2026-09-25 06:54:20.807063+00"")",1,f) | (pr-a,alice,"Alice updated",alice,https://example.com,"2026-09-25 06:54:20.807063+00") | 2026-09-25 06:54:20.807579+00 | f
(2 rows)

\echo ROW 3.5-02 global
ROW 3.5-02 global
create function global(c snapback.cursor default null) returns setof activity_card_t language plpgsql stable as $$ begin
 return query select (activity_card(a)).* from activity a order by a.at desc limit 20; return;
end $$;
CREATE FUNCTION
select * from global();
 id  |                                                                                   post                                                                                   |                                         actor                                          |              at               | repost
-----+--------------------------------------------------------------------------------------------------------------------------------------------------------------------------+----------------------------------------------------------------------------------------+-------------------------------+--------
 rp1 | (p1,alice,,"hello updated",,,"2026-09-25 06:54:20.807579+00",f,0,0,0,0,"(pr-a,alice,""Alice updated"",alice,https://example.com,""2026-09-25 06:54:20.807063+00"")",1,f) | (pr-a,alice,"Alice updated",alice,https://example.com,"2026-09-25 06:54:20.807063+00") | 2026-09-25 06:54:20.80817+00  | t
 p1  | (p1,alice,,"hello updated",,,"2026-09-25 06:54:20.807579+00",f,0,0,0,0,"(pr-a,alice,""Alice updated"",alice,https://example.com,""2026-09-25 06:54:20.807063+00"")",1,f) | (pr-a,alice,"Alice updated",alice,https://example.com,"2026-09-25 06:54:20.807063+00") | 2026-09-25 06:54:20.807579+00 | f
(2 rows)

\echo ROW 3.5-03 thread
ROW 3.5-03 thread
create function thread(post_id posts.id%type,c snapback.cursor default null) returns setof post_card_t language plpgsql stable as $$ begin
 return query select (post_card(p)).* from posts p where p.parent_id is not distinct from thread.post_id order by p.at asc limit 20; return;
end $$;
psql:/Users/ccheever/projects/snapback-sb5/snapback5/stubs/form-table.sql:288: NOTICE:  type reference posts.id%TYPE converted to snapback.id
CREATE FUNCTION
select * from thread('p1');
 id | author_id | parent_id | body  | photo | video |              at               | removed | like_count | children_count | weight_total | selected_count |                        author                         | reply_count | liked
----+-----------+-----------+-------+-------+-------+-------------------------------+---------+------------+----------------+--------------+----------------+-------------------------------------------------------+-------------+-------
 p2 | bob       | p1        | reply |       |       | 2026-09-25 06:54:20.807789+00 | f       |          0 |              0 |            0 |              0 | (pr-b,bob,Bob,bobby,,"2026-09-25 06:54:20.807063+00") |             | f
(1 row)

\echo ROW 3.5-04 3.5-05 people alternatives and matching
ROW 3.5-04 3.5-05 people alternatives and matching
create function people(q varchar(100),c snapback.cursor default null) returns setof profiles language plpgsql stable as $$ begin
 if q='' then return query select p.* from profiles p order by p.created_at desc limit 20; return; end if;
 return query select p.* from profiles p where snapback.matches(p,q) order by p.created_at desc limit 20; return;
end $$;
CREATE FUNCTION
select * from people('');
  id  | principal | display_name  | handle |        link         |          created_at
------+-----------+---------------+--------+---------------------+-------------------------------
 pr-b | bob       | Bob           | bobby  |                     | 2026-09-25 06:54:20.807063+00
 pr-a | alice     | Alice updated | alice  | https://example.com | 2026-09-25 06:54:20.807063+00
(2 rows)

select * from people('ali');
  id  | principal | display_name  | handle |        link         |          created_at
------+-----------+---------------+--------+---------------------+-------------------------------
 pr-b | bob       | Bob           | bobby  |                     | 2026-09-25 06:54:20.807063+00
 pr-a | alice     | Alice updated | alice  | https://example.com | 2026-09-25 06:54:20.807063+00
(2 rows)

select * from profiles where snapback.matches(profiles,'ali');
  id  | principal | display_name  | handle |        link         |          created_at
------+-----------+---------------+--------+---------------------+-------------------------------
 pr-b | bob       | Bob           | bobby  |                     | 2026-09-25 06:54:20.807063+00
 pr-a | alice     | Alice updated | alice  | https://example.com | 2026-09-25 06:54:20.807063+00
(2 rows)

\echo ROW 3.5-06 social profile and expected NOT_FOUND
ROW 3.5-06 social profile and expected NOT_FOUND
create function social_profile(handle profiles.handle%type) returns social_profile_t language plpgsql stable as $$
declare p profiles;
begin
 select * into strict p from profiles where profiles.handle=social_profile.handle;
 return (select row((p).*,(select c.count from follower_count c where c.followed_id=p.principal),exists(select 1 from follows f where f.follower_id=auth.uid() and f.followed_id=p.principal))::social_profile_t);
 exception when no_data_found then raise exception 'NOT_FOUND';
end $$;
psql:/Users/ccheever/projects/snapback-sb5/snapback5/stubs/form-table.sql:305: NOTICE:  type reference profiles.handle%TYPE converted to text
CREATE FUNCTION
select social_profile('alice');
                                       social_profile
--------------------------------------------------------------------------------------------
 (pr-a,alice,"Alice updated",alice,https://example.com,"2026-09-25 06:54:20.807063+00",1,f)
(1 row)

do $$ begin
 begin perform social_profile('missing'); raise exception 'HARNESS: expected NOT_FOUND';
 exception when raise_exception then if sqlerrm<>'NOT_FOUND' then raise; end if; raise notice 'EXPECTED social_profile NOT_FOUND'; end;
end $$;
psql:/Users/ccheever/projects/snapback-sb5/snapback5/stubs/form-table.sql:310: NOTICE:  EXPECTED social_profile NOT_FOUND
DO
\echo ROW 3.5-07 initialized arrays and end-exclusive range
ROW 3.5-07 initialized arrays and end-exclusive range
create type day_t as(day bigint,likes bigint);
CREATE TYPE
create type insights_t as(days day_t[]);
CREATE TYPE
create function insights(a integer,b integer) returns insights_t language plpgsql stable as $$
declare d integer; days day_t[] := array[]::day_t[];
begin
 for d in a..b-1 loop days:=days || row(d,(select c.count from daily_likes c where c.author_id=auth.uid() and c.day=d))::day_t; end loop;
 return row(days)::insights_t;
end $$;
CREATE FUNCTION
select insights(0,7),cardinality((insights(0,7)).days);
                               insights                                | cardinality
-----------------------------------------------------------------------+-------------
 ("{""(0,1)"",""(1,)"",""(2,)"",""(3,)"",""(4,)"",""(5,)"",""(6,)""}") |           7
(1 row)

select insights(2,2);
 insights
----------
 ({})
(1 row)

\echo ROW 3.5-08 cursor-free trending
ROW 3.5-08 cursor-free trending
create function trending() returns setof post_card_t language plpgsql stable as $$ begin
 return query select (post_card(p)).* from posts p where parent_id is null and not removed and at>now()-interval '24 hours' and at<=now() order by like_count desc,at desc limit 10; return;
end $$;
CREATE FUNCTION
select * from trending();
 id | author_id | parent_id |     body      | photo | video |              at               | removed | like_count | children_count | weight_total | selected_count |                                         author                                         | reply_count | liked
----+-----------+-----------+---------------+-------+-------+-------------------------------+---------+------------+----------------+--------------+----------------+----------------------------------------------------------------------------------------+-------------+-------
 p1 | alice     |           | hello updated |       |       | 2026-09-25 06:54:20.807579+00 | f       |          0 |              0 |            0 |              0 | (pr-a,alice,"Alice updated",alice,https://example.com,"2026-09-25 06:54:20.807063+00") |           1 | f
(1 row)

\echo ROW 3.5-09 streaming count
ROW 3.5-09 streaming count
create function message_total(conversation_id conversations.id%type) returns bigint language plpgsql stable as $$ declare n bigint; begin select count(*) into n from messages m where m.conversation_id=message_total.conversation_id; return n; end $$;
psql:/Users/ccheever/projects/snapback-sb5/snapback5/stubs/form-table.sql:328: NOTICE:  type reference conversations.id%TYPE converted to snapback.id
CREATE FUNCTION
select message_total('c1');
 message_total
---------------
             1
(1 row)

\echo ROW 3.5-10 3.5-14 expression and block helpers, interval arithmetic
ROW 3.5-10 3.5-14 expression and block helpers, interval arithmetic
create function private.edit_window() returns interval language sql immutable as $$ select interval '60 seconds' $$;
CREATE FUNCTION
create function private.short_ttl() returns interval language sql immutable as $$ select interval '180 seconds' $$;
CREATE FUNCTION
create function private.receipt_state(m messages) returns bigint language plpgsql stable as $$
declare r record; n bigint:=0;
begin
 for r in select * from receipts where message=m.id loop n:=n+1; end loop;
 return n;
end $$;
CREATE FUNCTION
create function private.other_profile(who snapback.principal) returns profiles language plpgsql stable as $$ declare p profiles; begin select * into p from profiles where principal=who order by created_at limit 1; return p; end $$;
CREATE FUNCTION
create function private.unread(m members) returns bigint language plpgsql stable as $$ declare n bigint; begin select count(*) into n from messages x where x.conversation_id=m.conversation_id and x.ordinal>m.read_up_to and x.sender_id<>m.principal and not x.tombstone; return n; end $$;
CREATE FUNCTION
select private.edit_window(),private.short_ttl();
 edit_window | short_ttl
-------------+-----------
 00:01:00    | 00:03:00
(1 row)

select private.receipt_state(m),now()-m.at<=private.edit_window(),now()+private.short_ttl() from messages m;
 receipt_state | ?column? |           ?column?
---------------+----------+-------------------------------
             1 | t        | 2026-09-25 06:57:20.848374+00
(1 row)

select private.other_profile('bob'),private.other_profile('missing');
                     other_profile                     | other_profile
-------------------------------------------------------+---------------
 (pr-b,bob,Bob,bobby,,"2026-09-25 06:54:20.807063+00") | (,,,,,)
(1 row)

select private.unread(m) from members m;
 unread
--------
      1
      0
(2 rows)

\echo ROW 3.5-11 server marker
ROW 3.5-11 server marker
select snapback.server('edit');
 server
--------
 t
(1 row)

\echo ROW 3.5-12 optional nominal reference and bounded media
ROW 3.5-12 optional nominal reference and bounded media
create function optional_media(photo posts.photo%type,parent posts.id%type default null) returns snapback.id language plpgsql stable as $$ begin return parent; end $$;
psql:/Users/ccheever/projects/snapback-sb5/snapback5/stubs/form-table.sql:348: NOTICE:  type reference posts.photo%TYPE converted to snapback.image
psql:/Users/ccheever/projects/snapback-sb5/snapback5/stubs/form-table.sql:348: NOTICE:  type reference posts.id%TYPE converted to snapback.id
CREATE FUNCTION
select optional_media('image','p1'),optional_media(null);
 optional_media | optional_media
----------------+----------------
 p1             |
(1 row)

\echo ROW 3.5-13 list bounds/growth/cardinality/text length
ROW 3.5-13 list bounds/growth/cardinality/text length
create function list_forms(ids snapback.id[],extra snapback.id,body text) returns bigint language plpgsql stable as $$ declare n bigint; grown snapback.id[]; begin
 perform snapback.bound(ids,50); grown:=ids; grown:=grown || array[extra]; n:=cardinality(grown); n:=n+length(body); return n;
end $$;
CREATE FUNCTION
select list_forms(array[]::snapback.id[],'x','hello'),list_forms(array['p1'::snapback.id],'x','');
 list_forms | list_forms
------------+------------
          6 |          2
(1 row)

\echo ROW 3.5-15 unpaged shaped scan and first
ROW 3.5-15 unpaged shaped scan and first
create type roster_t as (principal snapback.principal);
CREATE TYPE
create function roster(conversation_id conversations.id%type) returns setof roster_t language plpgsql stable as $$ begin return query select m.principal from members m where m.conversation_id=roster.conversation_id; return; end $$;
psql:/Users/ccheever/projects/snapback-sb5/snapback5/stubs/form-table.sql:357: NOTICE:  type reference conversations.id%TYPE converted to snapback.id
CREATE FUNCTION
select * from roster('c1');
 principal
-----------
 alice
 bob
(2 rows)

-- Additional expression/statement grammar witnesses (§3.6 prose, §3.7).
create function private.expression_forms(a bigint,b bigint) returns text language plpgsql immutable as $$ declare s text; begin
 s:=substr('abcdefghijklmno',5,10);
 return case when a<b then s else coalesce(null::text,'fallback') end;
end $$;
CREATE FUNCTION
select private.expression_forms(1,2),private.expression_forms(3,2),least(2,4),greatest(2,4);
 expression_forms | expression_forms | least | greatest
------------------+------------------+-------+----------
 efghijklmn       | fallback         |     2 |        4
(1 row)

create function private.loop_forms(items bigint[]) returns bigint language plpgsql immutable as $$ declare x bigint; n bigint:=0; begin
 foreach x in array items loop
  if x=0 then continue; elsif x<0 then exit; else n:=n+x; end if;
 end loop;
 return n;
end $$;
CREATE FUNCTION
select private.loop_forms(array[0,1,2,-1,3]::bigint[]);
 loop_forms
------------
          3
(1 row)

\echo ROW 3.6-01 insert if absent, explicit and omitted ids
ROW 3.6-01 insert if absent, explicit and omitted ids
create function create_post(post_id snapback.id,body varchar(500),parent_id posts.id%type default null) returns posts language plpgsql volatile as $$ declare r posts; begin
 insert into posts(id,author_id,parent_id,body) values(create_post.post_id,auth.uid(),create_post.parent_id,create_post.body) on conflict do nothing returning * into r;
 return r;
end $$;
psql:/Users/ccheever/projects/snapback-sb5/snapback5/stubs/form-table.sql:377: NOTICE:  type reference posts.id%TYPE converted to snapback.id
CREATE FUNCTION
select create_post('new-post','new'),create_post('new-post','duplicate');
                            create_post                            |  create_post
-------------------------------------------------------------------+---------------
 (new-post,alice,,new,,,"2026-09-25 06:54:20.849633+00",f,0,0,0,0) | (,,,,,,,,,,,)
(1 row)

\echo ROW 3.6-02 upsert matched fields
ROW 3.6-02 upsert matched fields
create table counters(id snapback.id primary key default snapback.mint(),principal snapback.principal not null unique,n bigint not null);
CREATE TABLE
create function upsert_counter(who snapback.principal,value bigint) returns void language plpgsql volatile as $$ begin
 insert into counters(principal,n) values(who,value) on conflict(principal) do update set n=excluded.n;
end $$;
CREATE FUNCTION
select upsert_counter('alice',1),upsert_counter('alice',2);
 upsert_counter | upsert_counter
----------------+----------------
                |
(1 row)

select * from counters;
       id        | principal | n
-----------------+-----------+---
 dummy-minted-id | alice     | 2
(1 row)

\echo ROW 3.6-03 unconditional point update
ROW 3.6-03 unconditional point update
create function edit(post_id posts.id%type,body text) returns void language plpgsql volatile as $$ begin update posts p set body=edit.body where p.id=edit.post_id; end $$;
psql:/Users/ccheever/projects/snapback-sb5/snapback5/stubs/form-table.sql:387: NOTICE:  type reference posts.id%TYPE converted to snapback.id
CREATE FUNCTION
select edit('new-post','changed');
 edit
------

(1 row)

\echo ROW 3.6-04 conditional update
ROW 3.6-04 conditional update
create function edit_if(post_id posts.id%type,body text) returns void language plpgsql volatile as $$ begin update posts p set body=edit_if.body where p.id=edit_if.post_id and not p.removed; end $$;
psql:/Users/ccheever/projects/snapback-sb5/snapback5/stubs/form-table.sql:390: NOTICE:  type reference posts.id%TYPE converted to snapback.id
CREATE FUNCTION
select edit_if('new-post','conditional');
 edit_if
---------

(1 row)

\echo ROW 3.6-05 point delete
ROW 3.6-05 point delete
create function delete_post(post_id posts.id%type) returns void language plpgsql volatile as $$ begin delete from posts p where p.id=delete_post.post_id; end $$;
psql:/Users/ccheever/projects/snapback-sb5/snapback5/stubs/form-table.sql:393: NOTICE:  type reference posts.id%TYPE converted to snapback.id
CREATE FUNCTION
select delete_post('new-post');
 delete_post
-------------

(1 row)

\echo ROW 3.6-06 require and custom code
ROW 3.6-06 require and custom code
create function require_other(who snapback.principal) returns boolean language plpgsql volatile as $$ begin if not (who<>auth.uid()) then raise exception 'CANNOT_FOLLOW_SELF'; end if; return true; end $$;
CREATE FUNCTION
select require_other('bob');
 require_other
---------------
 t
(1 row)

do $$ begin begin perform require_other('alice'); raise exception 'HARNESS expected require'; exception when raise_exception then if sqlerrm<>'CANNOT_FOLLOW_SELF' then raise; end if; raise notice 'EXPECTED CANNOT_FOLLOW_SELF'; end; end $$;
psql:/Users/ccheever/projects/snapback-sb5/snapback5/stubs/form-table.sql:398: NOTICE:  EXPECTED CANNOT_FOLLOW_SELF
DO
\echo ROW 3.6-07 emit once heterogeneous record
ROW 3.6-07 emit once heterogeneous record
create function emit_example() returns void language plpgsql volatile as $$ begin perform snapback.emit('push',json_build_object('principal',auth.uid()),once => row(auth.uid(),now())); end $$;
CREATE FUNCTION
select emit_example();
 emit_example
--------------

(1 row)

\echo ROW 3.6-08 elsif exists and omitted id insert
ROW 3.6-08 elsif exists and omitted id insert
create function set_like(post_id posts.id%type,want boolean) returns boolean language plpgsql volatile as $$ declare r likes; begin
 if want then insert into likes(post_id,principal) values(set_like.post_id,auth.uid()) on conflict do nothing returning * into r;
 elsif exists(select 1 from likes l where l.post_id=set_like.post_id and l.principal=auth.uid()) then delete from likes l where l.post_id=set_like.post_id and l.principal=auth.uid();
 end if;
 return found;
end $$;
psql:/Users/ccheever/projects/snapback-sb5/snapback5/stubs/form-table.sql:408: NOTICE:  type reference posts.id%TYPE converted to snapback.id
CREATE FUNCTION
-- Non-owner repeats exercise body SQL and policies, including insert conflict.
grant select on all tables in schema public to form_reader;
GRANT
set role form_reader;
SET
select * from home(); select * from global(); select * from thread('p1'); select * from people(''); select * from people('ali'); select * from trending();
 id  |                                                                                   post                                                                                   |                                         actor                                          |              at               | repost
-----+--------------------------------------------------------------------------------------------------------------------------------------------------------------------------+----------------------------------------------------------------------------------------+-------------------------------+--------
 rp1 | (p1,alice,,"hello updated",,,"2026-09-25 06:54:20.807579+00",f,0,0,0,0,"(pr-a,alice,""Alice updated"",alice,https://example.com,""2026-09-25 06:54:20.807063+00"")",1,f) | (pr-a,alice,"Alice updated",alice,https://example.com,"2026-09-25 06:54:20.807063+00") | 2026-09-25 06:54:20.80817+00  | t
 p1  | (p1,alice,,"hello updated",,,"2026-09-25 06:54:20.807579+00",f,0,0,0,0,"(pr-a,alice,""Alice updated"",alice,https://example.com,""2026-09-25 06:54:20.807063+00"")",1,f) | (pr-a,alice,"Alice updated",alice,https://example.com,"2026-09-25 06:54:20.807063+00") | 2026-09-25 06:54:20.807579+00 | f
(2 rows)

 id  |                                                                                   post                                                                                   |                                         actor                                          |              at               | repost
-----+--------------------------------------------------------------------------------------------------------------------------------------------------------------------------+----------------------------------------------------------------------------------------+-------------------------------+--------
 rp1 | (p1,alice,,"hello updated",,,"2026-09-25 06:54:20.807579+00",f,0,0,0,0,"(pr-a,alice,""Alice updated"",alice,https://example.com,""2026-09-25 06:54:20.807063+00"")",1,f) | (pr-a,alice,"Alice updated",alice,https://example.com,"2026-09-25 06:54:20.807063+00") | 2026-09-25 06:54:20.80817+00  | t
 p1  | (p1,alice,,"hello updated",,,"2026-09-25 06:54:20.807579+00",f,0,0,0,0,"(pr-a,alice,""Alice updated"",alice,https://example.com,""2026-09-25 06:54:20.807063+00"")",1,f) | (pr-a,alice,"Alice updated",alice,https://example.com,"2026-09-25 06:54:20.807063+00") | 2026-09-25 06:54:20.807579+00 | f
(2 rows)

 id | author_id | parent_id | body  | photo | video |              at               | removed | like_count | children_count | weight_total | selected_count |                        author                         | reply_count | liked
----+-----------+-----------+-------+-------+-------+-------------------------------+---------+------------+----------------+--------------+----------------+-------------------------------------------------------+-------------+-------
 p2 | bob       | p1        | reply |       |       | 2026-09-25 06:54:20.807789+00 | f       |          0 |              0 |            0 |              0 | (pr-b,bob,Bob,bobby,,"2026-09-25 06:54:20.807063+00") |             | f
(1 row)

  id  | principal | display_name  | handle |        link         |          created_at
------+-----------+---------------+--------+---------------------+-------------------------------
 pr-b | bob       | Bob           | bobby  |                     | 2026-09-25 06:54:20.807063+00
 pr-a | alice     | Alice updated | alice  | https://example.com | 2026-09-25 06:54:20.807063+00
(2 rows)

  id  | principal | display_name  | handle |        link         |          created_at
------+-----------+---------------+--------+---------------------+-------------------------------
 pr-b | bob       | Bob           | bobby  |                     | 2026-09-25 06:54:20.807063+00
 pr-a | alice     | Alice updated | alice  | https://example.com | 2026-09-25 06:54:20.807063+00
(2 rows)

 id | author_id | parent_id |     body      | photo | video |              at               | removed | like_count | children_count | weight_total | selected_count |                                         author                                         | reply_count | liked
----+-----------+-----------+---------------+-------+-------+-------------------------------+---------+------------+----------------+--------------+----------------+----------------------------------------------------------------------------------------+-------------+-------
 p1 | alice     |           | hello updated |       |       | 2026-09-25 06:54:20.807579+00 | f       |          0 |              0 |            0 |              0 | (pr-a,alice,"Alice updated",alice,https://example.com,"2026-09-25 06:54:20.807063+00") |           1 | f
(1 row)

select set_like('p1',true),set_like('p1',true),set_like('p1',false),set_like('p1',false);
 set_like | set_like | set_like | set_like
----------+----------+----------+----------
 t        | f        | t        | f
(1 row)

reset role;
RESET
\echo ROW 3.6-09 3.6-12 multiple sweeps, nested locals, presence-only emit
ROW 3.6-09 3.6-12 multiple sweeps, nested locals, presence-only emit
create procedure daily(period_start timestamptz,period_end timestamptz) language plpgsql as $$ declare p record; m record; begin
 for p in select * from profiles loop
  declare n bigint; begin
   select count(*) into n from messages where at>=daily.period_start and at<daily.period_end;
   if not snapback.connected(p.principal) then perform snapback.emit('push',json_build_object('n',n),once => row(p.principal,period_end)); end if;
  end;
 end loop;
 for m in select * from members where principal=auth.uid() loop
  perform snapback.emit('push',json_build_object('member',m.id),once => row(m.id,period_end));
 end loop;
end $$;
CREATE PROCEDURE
call daily(snapback.period_start(),snapback.period_end());
CALL
\echo ROW 3.6-10 schedule period plus offset
ROW 3.6-10 schedule period plus offset
select cron.schedule('daily-digest','0 8 * * *',$$ call daily(snapback.period_start(),snapback.period_end()) $$);
 schedule
----------
        1
(1 row)

select cron.schedule('every-two','*/2 * * * *',$$ call daily(snapback.period_start(),snapback.period_end()) $$);
 schedule
----------
        1
(1 row)

select cron.schedule('hourly','15 * * * *',$$ call daily(snapback.period_start(),snapback.period_end()) $$);
 schedule
----------
        1
(1 row)

\echo ROW 3.6-11 qualified procedure
ROW 3.6-11 qualified procedure
create procedure insights.daily(period_start timestamptz,period_end timestamptz) language plpgsql as $$ declare p record; begin
 for p in select * from profiles loop perform snapback.emit('push',json_build_object('principal',p.principal),once => row(p.principal,period_end)); end loop;
end $$;
CREATE PROCEDURE
call insights.daily(snapback.period_start(),snapback.period_end());
CALL
select cron.schedule('insights-digest','0 8 * * *',$$ call insights.daily(snapback.period_start(),snapback.period_end()) $$);
 schedule
----------
        1
(1 row)

\echo GAP 3.3-09 3.4-11 3.5-16 3.5-17 3.5-18 3.5-19 3.5-20 3.6-13 no admitted SQL spelling
GAP 3.3-09 3.4-11 3.5-16 3.5-17 3.5-18 3.5-19 3.5-20 3.6-13 no admitted SQL spelling
-- Null-safe grammar is legal both in probes and in value positions.
create type null_test_t as(is_null boolean,is_not_null boolean,equal boolean,different boolean);
CREATE TYPE
create function null_forms(a bigint,b bigint) returns null_test_t language sql immutable as $$ select a is null,a is not null,a is not distinct from b,a is distinct from b $$;
CREATE FUNCTION
select null_forms(null,null),null_forms(null,1),null_forms(1,1),null_forms(1,2);
 null_forms | null_forms | null_forms | null_forms
------------+------------+------------+------------
 (t,f,t,f)  | (t,f,f,t)  | (f,t,t,f)  | (f,t,f,t)
(1 row)

\echo ALL_SQL_ROWS_COMPLETED
ALL_SQL_ROWS_COMPLETED

[exit 0]
$ /opt/homebrew/opt/postgresql@17/bin/pg_ctl -D /Users/ccheever/projects/snapback-sb5-pg/rev4-h7_da9lm/data -m fast -w stop
waiting for server to shut down.... done
server stopped

[exit 0]
Stopped only recorded postmaster PID 11240; pid file absent=True
```

## Original final Quarry transcripts

### effects — exit 0

```text
$ cd /Users/ccheever/projects/snapback-sb5/snapback5/stubs/lowered/effects
$ CARGO_TARGET_DIR=/Users/ccheever/projects/snapback-sb5/snapback5/stubs/.build cargo run --locked --manifest-path /Users/ccheever/projects/snapback-sb5/snapback4/Cargo.toml -p snapback4 -- check /Users/ccheever/projects/snapback-sb5/snapback5/stubs/lowered/effects/snapback/schema.q
warning: trait `MustBeShareDummy` is never used
   --> vendor/tiny_http/src/lib.rs:167:7
    |
167 | trait MustBeShareDummy: Sync + Send {}
    |       ^^^^^^^^^^^^^^^^
    |
    = note: `#[warn(dead_code)]` (part of `#[warn(unused)]`) on by default

warning: `tiny_http` (lib) generated 1 warning
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.13s
     Running `/Users/ccheever/projects/snapback-sb5/snapback5/stubs/.build/debug/snapback4 check /Users/ccheever/projects/snapback-sb5/snapback5/stubs/lowered/effects/snapback/schema.q`
check: ok — 0 tables (0 synced), 0 operations, no problems, 5.0 ms
scale: 0 of 0 operations are constant; 0 grow with data — `check --cost` gives the certificate
[exit 0]
```

### field-authority — exit 1

```text
$ cd /Users/ccheever/projects/snapback-sb5/snapback5/stubs/lowered/field-authority
$ CARGO_TARGET_DIR=/Users/ccheever/projects/snapback-sb5/snapback5/stubs/.build cargo run --locked --manifest-path /Users/ccheever/projects/snapback-sb5/snapback4/Cargo.toml -p snapback4 -- check /Users/ccheever/projects/snapback-sb5/snapback5/stubs/lowered/field-authority/snapback/schema.q
warning: trait `MustBeShareDummy` is never used
   --> vendor/tiny_http/src/lib.rs:167:7
    |
167 | trait MustBeShareDummy: Sync + Send {}
    |       ^^^^^^^^^^^^^^^^
    |
    = note: `#[warn(dead_code)]` (part of `#[warn(unused)]`) on by default

warning: `tiny_http` (lib) generated 1 warning
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.04s
     Running `/Users/ccheever/projects/snapback-sb5/snapback5/stubs/.build/debug/snapback4 check /Users/ccheever/projects/snapback-sb5/snapback5/stubs/lowered/field-authority/snapback/schema.q`
schema.q:4:38 — E_QUARRY_TYPE: default for readUpTo must be a literal, now or viewer fitting int
  rewrite: readUpTo: int default <literal | now | viewer>
  guide: types

check: 1 problem
[exit 1]
```

### field-authority-visible — exit 1

```text
$ cd /Users/ccheever/projects/snapback-sb5/snapback5/stubs/lowered/field-authority-visible
$ CARGO_TARGET_DIR=/Users/ccheever/projects/snapback-sb5/snapback5/stubs/.build cargo run --locked --manifest-path /Users/ccheever/projects/snapback-sb5/snapback4/Cargo.toml -p snapback4 -- check /Users/ccheever/projects/snapback-sb5/snapback5/stubs/lowered/field-authority-visible/snapback/schema.q
warning: trait `MustBeShareDummy` is never used
   --> vendor/tiny_http/src/lib.rs:167:7
    |
167 | trait MustBeShareDummy: Sync + Send {}
    |       ^^^^^^^^^^^^^^^^
    |
    = note: `#[warn(dead_code)]` (part of `#[warn(unused)]`) on by default

warning: `tiny_http` (lib) generated 1 warning
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.06s
     Running `/Users/ccheever/projects/snapback-sb5/snapback5/stubs/.build/debug/snapback4 check /Users/ccheever/projects/snapback-sb5/snapback5/stubs/lowered/field-authority-visible/snapback/schema.q`
schema.q:4:61 — E_QUARRY_TYPE: default for readUpTo must be a literal, now or viewer fitting int
  rewrite: readUpTo: int default <literal | now | viewer>
  guide: types

check: 1 problem
[exit 1]
```

### row-keyed — exit 1

```text
$ cd /Users/ccheever/projects/snapback-sb5/snapback5/stubs/lowered/row-keyed
$ CARGO_TARGET_DIR=/Users/ccheever/projects/snapback-sb5/snapback5/stubs/.build cargo run --locked --manifest-path /Users/ccheever/projects/snapback-sb5/snapback4/Cargo.toml -p snapback4 -- check /Users/ccheever/projects/snapback-sb5/snapback5/stubs/lowered/row-keyed/snapback/schema.q
warning: trait `MustBeShareDummy` is never used
   --> vendor/tiny_http/src/lib.rs:167:7
    |
167 | trait MustBeShareDummy: Sync + Send {}
    |       ^^^^^^^^^^^^^^^^
    |
    = note: `#[warn(dead_code)]` (part of `#[warn(unused)]`) on by default

warning: `tiny_http` (lib) generated 1 warning
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.04s
     Running `/Users/ccheever/projects/snapback-sb5/snapback5/stubs/.build/debug/snapback4 check /Users/ccheever/projects/snapback-sb5/snapback5/stubs/lowered/row-keyed/snapback/schema.q`
schema.q:19:3 — E_QUARRY_SYNTAX: unknown maintain property where
  rewrite: read <- rule
  guide: language

E_QUARRY_SYNTAX: the parser expected the token or construct named at file:line:column. Object fields use name: expression (or a bare name for name: name); ...value spreads a present row or object; ...shape inside a row/page shape names a declared shape. Operations need name(args): followed by an indented body, including () for no arguments. Close each (, [ and { with its matching delimiter; separate fields and arguments with commas. The rewrite names the expected spelling; `check --fix` applies only repairs marked mechanical. Read `snapback4 guide language` for complete examples. `check` hides a parser-proven empty-operation cascade after an earlier error in that operation; `--verbose` and `--json` retain it. Independent errors stay visible. A query merge lane takes a prefix page, range(a, b), or a bounded list; walk is not a lane domain. A time function occurs at most once per index.

## Refusals

E_QUARRY_SYNTAX means the parser could not read the form at the reported
file, line and column. For example, `query answer:` is missing its argument
parentheses: write `query answer():`, then indent `return 42` by two spaces
on the next line. Keep the colon, close each `(`, `[` and `{`, and separate
arguments and object fields with commas. Follow the diagnostic's rewrite;
`snapback4 check --fix` applies it only when marked mechanical. Fix the first
bad line and rerun `check`; a later empty-body error may be its consequence.

Full card: snapback4 guide language

schema.q:20:1 — E_QUARRY_SYNTAX: expected a name, got "<indent>"
  rewrite: write an identifier here; object fields use name: expression, and row fields use row.name or .name inside a shape
  guide: language

schema.q:21:1 — E_QUARRY_SYNTAX: unexpected top-level "<dedent>"
  rewrite: fix this Quarry line and rerun snapback4 check
  guide: language

check: 3 problems
[exit 1]
```

### rules — exit 0

```text
$ cd /Users/ccheever/projects/snapback-sb5/snapback5/stubs/lowered/rules
$ CARGO_TARGET_DIR=/Users/ccheever/projects/snapback-sb5/snapback5/stubs/.build cargo run --locked --manifest-path /Users/ccheever/projects/snapback-sb5/snapback4/Cargo.toml -p snapback4 -- check /Users/ccheever/projects/snapback-sb5/snapback5/stubs/lowered/rules/snapback/schema.q
warning: trait `MustBeShareDummy` is never used
   --> vendor/tiny_http/src/lib.rs:167:7
    |
167 | trait MustBeShareDummy: Sync + Send {}
    |       ^^^^^^^^^^^^^^^^
    |
    = note: `#[warn(dead_code)]` (part of `#[warn(unused)]`) on by default

warning: `tiny_http` (lib) generated 1 warning
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.04s
     Running `/Users/ccheever/projects/snapback-sb5/snapback5/stubs/.build/debug/snapback4 check /Users/ccheever/projects/snapback-sb5/snapback5/stubs/lowered/rules/snapback/schema.q`
check: ok — 7 tables (0 synced), 0 operations, no problems, 6.9 ms
scale: 0 of 0 operations are constant; 0 grow with data — `check --cost` gives the certificate
[exit 0]
```

### sequence — exit 1

```text
$ cd /Users/ccheever/projects/snapback-sb5/snapback5/stubs/lowered/sequence
$ CARGO_TARGET_DIR=/Users/ccheever/projects/snapback-sb5/snapback5/stubs/.build cargo run --locked --manifest-path /Users/ccheever/projects/snapback-sb5/snapback4/Cargo.toml -p snapback4 -- check /Users/ccheever/projects/snapback-sb5/snapback5/stubs/lowered/sequence/snapback/schema.q
warning: trait `MustBeShareDummy` is never used
   --> vendor/tiny_http/src/lib.rs:167:7
    |
167 | trait MustBeShareDummy: Sync + Send {}
    |       ^^^^^^^^^^^^^^^^
    |
    = note: `#[warn(dead_code)]` (part of `#[warn(unused)]`) on by default

warning: `tiny_http` (lib) generated 1 warning
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.05s
     Running `/Users/ccheever/projects/snapback-sb5/snapback5/stubs/.build/debug/snapback4 check /Users/ccheever/projects/snapback-sb5/snapback5/stubs/lowered/sequence/snapback/schema.q`
schema.q:7:21 — E_QUARRY_SYNTAX: expected the end of the line, got "by"
  rewrite: end this statement here; put the next statement on its own line at the same indentation
  guide: language

check: 1 problem
[exit 1]
```

### social — exit 0

```text
$ cd /Users/ccheever/projects/snapback-sb5/snapback5/stubs/lowered/social
$ CARGO_TARGET_DIR=/Users/ccheever/projects/snapback-sb5/snapback5/stubs/.build cargo run --locked --manifest-path /Users/ccheever/projects/snapback-sb5/snapback4/Cargo.toml -p snapback4 -- check /Users/ccheever/projects/snapback-sb5/snapback5/stubs/lowered/social/snapback/schema.q
warning: trait `MustBeShareDummy` is never used
   --> vendor/tiny_http/src/lib.rs:167:7
    |
167 | trait MustBeShareDummy: Sync + Send {}
    |       ^^^^^^^^^^^^^^^^
    |
    = note: `#[warn(dead_code)]` (part of `#[warn(unused)]`) on by default

warning: `tiny_http` (lib) generated 1 warning
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.13s
     Running `/Users/ccheever/projects/snapback-sb5/snapback5/stubs/.build/debug/snapback4 check /Users/ccheever/projects/snapback-sb5/snapback5/stubs/lowered/social/snapback/schema.q`
check: ok — 23 tables (21 synced), 25 operations, no problems, 6 notes, 25.9 ms
note: schema.q:144:1 — N_NO_HORIZON: table messages: `sync to members[.conversationId]` has no horizon, so every row of every group a device holds reaches it and stays; a device that holds many groups, or a public table that grows, pays for all of it at every cold start; measure what it costs with `check --residency`
  rewrite: sync to members[.conversationId] last 500 by .id
  guide: sync
  why: snapback4 why N_NO_HORIZON

note: schema.q:10:1 — N_NO_HORIZON: table profiles: `sync public` has no horizon, so every row of every group a device holds reaches it and stays; a device that holds many groups, or a public table that grows, pays for all of it at every cold start; measure what it costs with `check --residency`
  rewrite: sync public last 500 by .createdAt
  guide: sync
  why: snapback4 why N_NO_HORIZON

note: schema.q:100:1 — N_NO_CURSOR: query trending returns a page of 10 posts rows with no cursor: when more rows exist the card reads `complete: false` and there is no `next` to continue on
  rewrite: declare `c: cursor ?` in trending and append `after c` to this posts page, keeping its current predicate, direction and column order; read the whole group with its where predicate and no page clause when its schema cap fits the examined ceiling; otherwise this page still needs continuation
  guide: reads
  why: snapback4 why N_NO_CURSOR

note: schema.q:209:1 — N_NEVER_COMPLETE: query receiptExample: the page over receipts[..] by read or declaration on receipts (message, id) at schema.q:195:12 is never `complete` — the read rule `.principal = viewer` reads .principal, which the scan does not pin, so the server cannot tell "no more" from "more you may not read"
  rewrite: pin .principal with where equalities as well as the current equality prefix, choosing the intended scope (this narrows the answer); or read the page on the device, where the partition holds exactly what the viewer may read
  guide: reads
  why: snapback4 why N_NEVER_COMPLETE

note: schema.q:87:1 — N_MAINTAIN_SYNCED: 9 synced maintains.
  rewrite: keep inherited sync for local readers, or add `online only` to opt out; measure cold rows with `snapback4 test --residency`
  guide: residency
  why: snapback4 why N_MAINTAIN_SYNCED

note: schema.q:42:3 — N_MAINTAINED_COLUMN_STREAM: posts: each contributing commit logs and streams the whole parent image per destination partition, coalesced once per row; a 4,000-byte parent costs every holder about 4 KB per change
  rewrite: use a column when readers want the count with the row; for a large row or a counter changing far more often than it is read, use a view with online only
  guide: maintains
  why: snapback4 why N_MAINTAINED_COLUMN_STREAM

scale: 14 of 25 operations are constant; 11 grow with data (home, trending, people, history, searchAll, daily, peopleAlternative, messageTotal, receiptExample, helperReads, twoSweeps); 3 job(s) assessed per chunk — `check --cost` gives the certificate
1 mutations never predict: setFollow (reads online-only table followingWork) — snapback4 why <op>
[exit 0]
```

### types — exit 0

```text
$ cd /Users/ccheever/projects/snapback-sb5/snapback5/stubs/lowered/types
$ CARGO_TARGET_DIR=/Users/ccheever/projects/snapback-sb5/snapback5/stubs/.build cargo run --locked --manifest-path /Users/ccheever/projects/snapback-sb5/snapback4/Cargo.toml -p snapback4 -- check /Users/ccheever/projects/snapback-sb5/snapback5/stubs/lowered/types/snapback/schema.q
warning: trait `MustBeShareDummy` is never used
   --> vendor/tiny_http/src/lib.rs:167:7
    |
167 | trait MustBeShareDummy: Sync + Send {}
    |       ^^^^^^^^^^^^^^^^
    |
    = note: `#[warn(dead_code)]` (part of `#[warn(unused)]`) on by default

warning: `tiny_http` (lib) generated 1 warning
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.04s
     Running `/Users/ccheever/projects/snapback-sb5/snapback5/stubs/.build/debug/snapback4 check /Users/ccheever/projects/snapback-sb5/snapback5/stubs/lowered/types/snapback/schema.q`
check: ok — 6 tables (5 synced), 7 operations, no problems, 3 notes, 9.3 ms
note: schema.q:30:1 — N_NO_HORIZON: table likes: `sync public` has no horizon, so every row of every group a device holds reaches it and stays; a device that holds many groups, or a public table that grows, pays for all of it at every cold start; measure what it costs with `check --residency`
  rewrite: sync public last 500 by .id
  guide: sync
  why: snapback4 why N_NO_HORIZON

note: schema.q:3:1 — N_NO_HORIZON: table posts: `sync public` has no horizon, so every row of every group a device holds reaches it and stays; a device that holds many groups, or a public table that grows, pays for all of it at every cold start; measure what it costs with `check --residency`
  rewrite: sync public last 500 by .id
  guide: sync
  why: snapback4 why N_NO_HORIZON

note: schema.q:29:3 — N_MAINTAINED_COLUMN_STREAM: posts: each contributing commit logs and streams the whole parent image per destination partition, coalesced once per row; a 4,000-byte parent costs every holder about 4 KB per change
  rewrite: use a column when readers want the count with the row; for a large row or a counter changing far more often than it is read, use a view with online only
  guide: maintains
  why: snapback4 why N_MAINTAINED_COLUMN_STREAM

scale: 7 of 7 operations are constant; 0 grow with data — `check --cost` gives the certificate
[exit 0]
```

### writes — exit 0

```text
$ cd /Users/ccheever/projects/snapback-sb5/snapback5/stubs/lowered/writes
$ CARGO_TARGET_DIR=/Users/ccheever/projects/snapback-sb5/snapback5/stubs/.build cargo run --locked --manifest-path /Users/ccheever/projects/snapback-sb5/snapback4/Cargo.toml -p snapback4 -- check /Users/ccheever/projects/snapback-sb5/snapback5/stubs/lowered/writes/snapback/schema.q
warning: trait `MustBeShareDummy` is never used
   --> vendor/tiny_http/src/lib.rs:167:7
    |
167 | trait MustBeShareDummy: Sync + Send {}
    |       ^^^^^^^^^^^^^^^^
    |
    = note: `#[warn(dead_code)]` (part of `#[warn(unused)]`) on by default

warning: `tiny_http` (lib) generated 1 warning
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.04s
     Running `/Users/ccheever/projects/snapback-sb5/snapback5/stubs/.build/debug/snapback4 check /Users/ccheever/projects/snapback-sb5/snapback5/stubs/lowered/writes/snapback/schema.q`
check: ok — 3 tables (0 synced), 9 operations, no problems, 10.1 ms
scale: 9 of 9 operations are constant; 0 grow with data — `check --cost` gives the certificate
6 mutations never predict: createPost (writes online-only table posts), deletePost (writes online-only table posts), edit (writes online-only table posts), editIf (writes online-only table posts), setLike (reads online-only table likes), upsertCounter (writes online-only table counters); 3 mutations have insert arms that never predict: createPost (posts is online only), setLike (likes is online only), upsertCounter (counters is online only) — snapback4 why <op>
[exit 0]
```

## Fixture digests

| File | SHA-256 |
| --- | --- |
| `snapback5/stubs/snapback.sql` | `d748f8b4e182a07fee2e49f14694032b0c28002479f60cea5328e9955c07a753` |
| `snapback5/stubs/form-table.sql` | `88daae99c32fa1ce74962bb84ec9974ad199d6eec5b83e3bb87b814bbbf011d6` |
| `snapback5/stubs/lowered/effects/snapback/schema.q` | `d817ce84d06136bf61bd36db954482faea235d5c099db4799006520f93b7f378` |
| `snapback5/stubs/lowered/field-authority/snapback/schema.q` | `3ad349a59e574da3f80b2f47df7dbfafe63623edf978f0ae48541c73246673a2` |
| `snapback5/stubs/lowered/field-authority-visible/snapback/schema.q` | `92a1f2a1e805c8dc81aed5ffe9982b8b2781ff62c60c6488ea8d5d0dd585b65d` |
| `snapback5/stubs/lowered/row-keyed/snapback/schema.q` | `54d6fc7faca50b681497db63fdd187a52774bf18149f3eb958edbad1e0f4a34f` |
| `snapback5/stubs/lowered/rules/snapback/schema.q` | `95f38338e7b36a522379ed9873c7ec6d01c778eef25aadec651a6b01903c6acf` |
| `snapback5/stubs/lowered/sequence/snapback/schema.q` | `c712af4767c5c92dd9b8951a31e4baaa5952fdaed95fa79ab69829fc7adcdafe` |
| `snapback5/stubs/lowered/social/snapback/insights.q` | `9cc4ad664c460d0aecce46ffc3341855771d7efa746b8301541bb0add153a7dd` |
| `snapback5/stubs/lowered/social/snapback/schema.q` | `be8956ff7f79ef8bc837e317f4cecddf26b913c73edf5cff16e0415a92318327` |
| `snapback5/stubs/lowered/types/snapback/schema.q` | `91add289b7a3c8d199c68051f2616d40553eb43540c51bf95986e08efa66113c` |
| `snapback5/stubs/lowered/writes/snapback/schema.q` | `4556d80eefed648c0e669ca4a581fb87deb94fb6658dc1fc4d3ba27dcf4ed17a` |

## Original reference validation

```text
ref-check: ok — 508 LLP docs, 9272 refs in 25996 files, 0 errors, 0 unchecked
```

## Original review dispositions and stopping point

Every round-3 item, including the choices where reviewers differed, is in
[LLP 4001 §12](../../llp/4001-snapback5-sql-front-end.rfc.md#round-3-dispositions).
The three original reviews have append-only pointers, not fabricated new
verdicts. The journal records the authoring-clarity choices and the missing
baseline. No fourth review, pre-test 1, corpus replay, SQL compiler, runtime
change, performance run, push, or publication occurred.


## 2026-09-25 — shared-baseline recheck at da443e4d44

Rechecked in `/Users/ccheever/projects/snapback-sb5`, branch `sb5/proposal`,
on starting commit `da443e4d44a07d275acc392e68dc765658298486` and Snapback 4
subtree `8baace2598b79ac6f2963cfbcbbcf4e2e6492781`. This commit carries LLP
3000.015's three additions. Ran the existing runner unchanged:

```sh
python3 snapback5/stubs/run-quarry.py
```

The runner invokes `cargo run --locked --manifest-path …/snapback4/Cargo.toml
-p snapback4 -- check …/snapback/schema.q` from each lowered project's root:
`check` discovers that project's `snapback/*.q` from its working directory.
Cargo rebuilt the landed shared crates once, on `effects` (19.20 s), then
reused the build for the remaining eight projects. Cargo and rustc are
1.97.0. The only compiler warning is the existing unused
`MustBeShareDummy` trait in vendored tiny_http; exact output is retained.
No lowered spelling needed correction, including the multiline row-keyed
`count messages by members m` / `where …` form. All fixture digests above
remain valid.

| Row | Form | Before → after recheck | Quarry result |
| --- | --- | --- | --- |
| §3.2-13 | `written by .principal`, with and without `readable by audience` | ✗ → ≈ | Both projects exit 0; output distinguishes private-owner and audience visibility. |
| §3.2-14 | `sequence by conversationId` | ✗ → ≈ | Exit 0; output identifies the shared parent counter, immutability and provisional state. |
| §3.4-07 | `view unread: count messages by members m where …` | ✗ → ≈ | Exit 0; output identifies the row key, fanout ≤50, writer recount ≤1024 and background chunks ≤256. |

The restored mark is ≈, the original mapping classification with the
stated SQL/Snapback semantic differences, not ✓. Every other lowered
project also exits 0. All 74 rows with lowerings now bind; the eight
predeclared SQL GAPs remain. Postgres execution evidence is the original
run above; the SQL fixtures were unchanged and Postgres was not rerun.

| Lowered project | Exit | Exact recheck log |
| --- | ---: | --- |
| `effects` | 0 | [20260925-quarry-effects-attempt-04.log](./20260925-quarry-effects-attempt-04.log) |
| `field-authority` | 0 | [20260925-quarry-field-authority-attempt-03.log](./20260925-quarry-field-authority-attempt-03.log) |
| `field-authority-visible` | 0 | [20260925-quarry-field-authority-visible-attempt-02.log](./20260925-quarry-field-authority-visible-attempt-02.log) |
| `row-keyed` | 0 | [20260925-quarry-row-keyed-attempt-03.log](./20260925-quarry-row-keyed-attempt-03.log) |
| `rules` | 0 | [20260925-quarry-rules-attempt-03.log](./20260925-quarry-rules-attempt-03.log) |
| `sequence` | 0 | [20260925-quarry-sequence-attempt-03.log](./20260925-quarry-sequence-attempt-03.log) |
| `social` | 0 | [20260925-quarry-social-attempt-04.log](./20260925-quarry-social-attempt-04.log) |
| `types` | 0 | [20260925-quarry-types-attempt-06.log](./20260925-quarry-types-attempt-06.log) |
| `writes` | 0 | [20260925-quarry-writes-attempt-03.log](./20260925-quarry-writes-attempt-03.log) |

LLP 4001 §3 and `rows.json` now carry the restored marks. §7 records that
the shared-baseline prerequisite is met at `da443e4d44` and pre-test 1 is
authorized from this commit, subject to its instrument freeze. The §6 and
§9 baseline pointers agree. This is binding evidence, not execution of a
transpiler or the future §4 equivalence gate. No pre-test, compiler/runtime
change, push or publication was performed.

### Exact check transcripts for the three rechecked rows

#### field-authority — exit 0

```text
$ cd /Users/ccheever/projects/snapback-sb5/snapback5/stubs/lowered/field-authority
$ CARGO_TARGET_DIR=/Users/ccheever/projects/snapback-sb5/snapback5/stubs/.build cargo run --locked --manifest-path /Users/ccheever/projects/snapback-sb5/snapback4/Cargo.toml -p snapback4 -- check /Users/ccheever/projects/snapback-sb5/snapback5/stubs/lowered/field-authority/snapback/schema.q
warning: trait `MustBeShareDummy` is never used
   --> vendor/tiny_http/src/lib.rs:167:7
    |
167 | trait MustBeShareDummy: Sync + Send {}
    |       ^^^^^^^^^^^^^^^^
    |
    = note: `#[warn(dead_code)]` (part of `#[warn(unused)]`) on by default

warning: `tiny_http` (lib) generated 1 warning
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.07s
     Running `/Users/ccheever/projects/snapback-sb5/snapback5/stubs/.build/debug/snapback4 check /Users/ccheever/projects/snapback-sb5/snapback5/stubs/lowered/field-authority/snapback/schema.q`
check: ok — 1 tables (0 synced), 0 operations, no problems, 5.9 ms
  members.readUpTo: written by .principal; visibility: private to owner
scale: 0 of 0 operations are constant; 0 grow with data — `check --cost` gives the certificate

[exit 0]
```

#### field-authority-visible — exit 0

```text
$ cd /Users/ccheever/projects/snapback-sb5/snapback5/stubs/lowered/field-authority-visible
$ CARGO_TARGET_DIR=/Users/ccheever/projects/snapback-sb5/snapback5/stubs/.build cargo run --locked --manifest-path /Users/ccheever/projects/snapback-sb5/snapback4/Cargo.toml -p snapback4 -- check /Users/ccheever/projects/snapback-sb5/snapback5/stubs/lowered/field-authority-visible/snapback/schema.q
warning: trait `MustBeShareDummy` is never used
   --> vendor/tiny_http/src/lib.rs:167:7
    |
167 | trait MustBeShareDummy: Sync + Send {}
    |       ^^^^^^^^^^^^^^^^
    |
    = note: `#[warn(dead_code)]` (part of `#[warn(unused)]`) on by default

warning: `tiny_http` (lib) generated 1 warning
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.04s
     Running `/Users/ccheever/projects/snapback-sb5/snapback5/stubs/.build/debug/snapback4 check /Users/ccheever/projects/snapback-sb5/snapback5/stubs/lowered/field-authority-visible/snapback/schema.q`
check: ok — 1 tables (0 synced), 0 operations, no problems, 5.4 ms
  members.readUpTo: written by .principal; visibility: readable by audience
scale: 0 of 0 operations are constant; 0 grow with data — `check --cost` gives the certificate

[exit 0]
```

#### sequence — exit 0

```text
$ cd /Users/ccheever/projects/snapback-sb5/snapback5/stubs/lowered/sequence
$ CARGO_TARGET_DIR=/Users/ccheever/projects/snapback-sb5/snapback5/stubs/.build cargo run --locked --manifest-path /Users/ccheever/projects/snapback-sb5/snapback4/Cargo.toml -p snapback4 -- check /Users/ccheever/projects/snapback-sb5/snapback5/stubs/lowered/sequence/snapback/schema.q
warning: trait `MustBeShareDummy` is never used
   --> vendor/tiny_http/src/lib.rs:167:7
    |
167 | trait MustBeShareDummy: Sync + Send {}
    |       ^^^^^^^^^^^^^^^^
    |
    = note: `#[warn(dead_code)]` (part of `#[warn(unused)]`) on by default

warning: `tiny_http` (lib) generated 1 warning
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.03s
     Running `/Users/ccheever/projects/snapback-sb5/snapback5/stubs/.build/debug/snapback4 check /Users/ccheever/projects/snapback-sb5/snapback5/stubs/lowered/sequence/snapback/schema.q`
  sequence messages.ordinal: counter per conversations row through .conversationId; immutable, provisional while pending
check: ok — 2 tables (0 synced), 0 operations, no problems, 6.7 ms
scale: 0 of 0 operations are constant; 0 grow with data — `check --cost` gives the certificate

[exit 0]
```

#### row-keyed — exit 0

```text
$ cd /Users/ccheever/projects/snapback-sb5/snapback5/stubs/lowered/row-keyed
$ CARGO_TARGET_DIR=/Users/ccheever/projects/snapback-sb5/snapback5/stubs/.build cargo run --locked --manifest-path /Users/ccheever/projects/snapback-sb5/snapback4/Cargo.toml -p snapback4 -- check /Users/ccheever/projects/snapback-sb5/snapback5/stubs/lowered/row-keyed/snapback/schema.q
warning: trait `MustBeShareDummy` is never used
   --> vendor/tiny_http/src/lib.rs:167:7
    |
167 | trait MustBeShareDummy: Sync + Send {}
    |       ^^^^^^^^^^^^^^^^
    |
    = note: `#[warn(dead_code)]` (part of `#[warn(unused)]`) on by default

warning: `tiny_http` (lib) generated 1 warning
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.04s
     Running `/Users/ccheever/projects/snapback-sb5/snapback5/stubs/.build/debug/snapback4 check /Users/ccheever/projects/snapback-sb5/snapback5/stubs/lowered/row-keyed/snapback/schema.q`
check: ok — 4 tables (0 synced), 0 operations, no problems, 10.3 ms
scale: 0 of 0 operations are constant; 0 grow with data — `check --cost` gives the certificate
  view unread: key messages.conversationId = members.conversationId; one value per members row; source fanout <= 50; writer recount <= 1024 examined source rows within remaining meter, then pending/background chunks <= 256

[exit 0]
```

### Recheck reference validation

```text
$ ./ref-check --verbose
ref-check: ok — 509 LLP docs, 9389 refs in 26776 files, 0 errors, 0 unchecked
[exit 0]
```
