# LLP 1022: Local-first v1 implementation history

**Type:** Explainer
**Status:** Draft
**Systems:** `snapback2/packages/snapback2`, `snapback2/packages/compiler`, `snapback2/crates/snapback2`, `snapback2/crates/snapback2-core`, LLP 1012 review and landing history
**Author:** Codex GPT-5.6 Sol (structural curator; original authorship and review provenance remain attributed below)
**Date:** 2026-09-11
**Revised:** 2026-09-11
**Related:** [LLP 1012](./1012-local-first-v1.spec.md), [LLP 1019](./1019-derived-delivery-custody.rfc.md), [LLP 1018.000](./1018.000-client-runtime-integration.plan.md), [LLP 1018.003](./1018.003-client-item-surface.plan.md), `llp/reviews/1012-local-first-v1.*`

## Purpose and provenance

This companion preserves implementation, measurement, and review history
extracted from LLP 1012 on 2026-09-11 so the implemented specification stays
below the repository's 1,500-line document cap. It does not amend LLP 1012,
ratify a proposal, or claim author or reviewer acceptance. LLP 1012 remains the
normative contract and retains all of its existing section and subsection
anchors. The original author and reviewer attributions below are carried from
LLP 1012 and its provenance-addressed review artifacts.

The curation moved only dated baseline observations, superseded implementation
records and allocations, landing chronology, review synthesis, and a scheduling
question made historical by the recorded landings. Current rules remain in LLP
1012. When this explainer and LLP 1012 differ, LLP 1012 controls.

## Revision and status chronology

LLP 1012 reached `Implemented` in revision (j), 2026-09-05. Its recorded
landings were 4–6 (`9f4f4953a`, `e992c391e`, `4f5eef21f`), the fence
(`2dded8335`), overlay retirement (`3b483d652`), supersession (`d4de10457`),
the owner split (`ba8e6309e`), the loop index and ruler (`685b883b5`,
`1e39b0d9d`), and Expo E1/E2 (`aa2ec8d33`, `926d62ad7`; LLP 1013).

The design record began with a 2026-09-04 panel and author rulings. Revision
(c) applied the author's principle to go straight to the ideal design: no
staging, the twin is the client, trace-validated OCC ships in v1, and retention
ruling 8 stands. Revisions (d) through (h) recorded implementation and review
repairs across the wire, validator, replay, twin, carriers, asset cache, and
overlay lifecycle. Later amendments recorded the engine schedule, auth and
startup recovery, indexed held search, follower ownership, item presentation,
runtime allocation, clock reads, coverage reset, and derived delivery custody.

This is chronology, not a new status decision. The current status and contract
are stated only by LLP 1012 and its related accepted/implemented LLPs.

## Pre-implementation baseline (2026-09-04)

Revision (a) checked `origin/main` at `9ffdf6dd0`; six panelists rechecked it.
The shipped client was in-memory, had no outbox or local evaluation, and ignored
`Last-Event-ID` on subscribe. The conformant TypeScript evaluator existed but
was not wired into the public client. Receipts distinguished absent from hidden
for primary point reads, while range receipts were limited to certified-uniform
sites and non-uniform ranges carried no range fact.

The owner was one thread over an `mpsc` channel with SQLite in exclusive
locking mode. One sequence was an owner-action property rather than a
transaction property. The invoked mutation path had no OCC comparison;
`new_ids` came from the store reservation. Sessions had a hard thirty-day
lifetime without renewal. Quarry refused schedules and had no retention
spelling. Governance had deferred offline work despite the messenger brief's
M5/M6 obligations. These observations motivated the author rulings retained in
LLP 1012 §2; they are not descriptions of the current implementation.

## Superseded recipe implementation

Lane O1c initially delivered tombstone and edit rows only to a conversation's
current members. Two attempted original-recipient spellings failed the language
available on 2026-09-04: an `or`-based sender/member index failed uniformity
certification, and Quarry could not construct a recipient list from a range.
The certified private log therefore used current-member fan-out, a maintained
member count, and a `GROUP_FULL` check at 51 members. Departed-member eviction
then depended on a primary point absence.

That authored-log design and its `messages.send` / `deliveries.post`
coexistence were superseded first by LLP 1002's template consolidation and then
on 2026-09-10 by LLP 1019's schema-derived `deliver` custody. LLP 1012 §3 now
states the current template, schedule, delivery, and drain rules.

## Read-store and witness implementation record

Lane O2b split the TypeScript evaluator into store, runner, and entry; hydrated
it from held schema and `coverage()`; mirrored Rust schema hashing; rejected
unknown fields on known wire shapes; and derived coverage from held-answer
receipts. The drained-prefix implementation linked pages from `after: null` to
`Exhausted`, rejected broken links, and distinguished `evicted`, `computed-key`,
and `never-held` partial reasons. Retained answers remained fallbacks for local
reruns denied, partial, or unavailable.

The 2026-09-06 browser witness corrected tail selection: an offline drain opens
at the held page chain's last cursor, while the stored watermark is reserved for
resume. Expo E2 then found that offline remounts must not overwrite that
watermark with a locally reconstructed cursor. The fix adopted the stored
watermark for offline views and made offline `mark` a no-op. It also established
that a reopened database is inspected before constructing a writing client.

These implementation details remain test and commit history. The current
offline-read, drain, search, and custody rules are in LLP 1012 §6.

## Indexed-search allocation history

The indexed held-search work was delegated on 2026-09-07 and implemented under
LLP 1018. The initial 34,000/30,000 allocation was speculative. A pinned
Node 22.23.2 / esbuild 0.25.9 / gzip-9 checkpoint found incomplete 44,290 and
46,838-byte candidates; they omitted required projection, receipt, or carrier
bodies and were explicitly retained as non-passing evidence.

A boundary audit replaced that with a 66,000-byte ceiling and 64,000 target for
the complete five-root local runtime. Same-toolchain measurements then showed
62,624 bytes in the work in progress and 63,023 bytes in an exhaustive export
cross-check. LLP 1018.000 later moved the canonical toolchain to Node 24.18.0
and adopted an 82,000 ceiling / 80,000 target after exact integrated values of
77,571, 79,272, and 79,207 bytes. Separate complete `client.ts` measurements
were 103,794, 110,485, and 110,520 bytes and were not app-download estimates.

Subsequent superseded allocations were:

- 82,500 bytes on 2026-09-07 for merged-schema reconciliation; the measured
  candidate was 82,085 bytes.
- 84,000 bytes on 2026-09-07 for the item surface, retaining the 80,000 target.
- 84,000 bytes frozen again on 2026-09-08 under the elegance program.
- 85,000 bytes explicitly approved by Charlie on 2026-09-09 after an
  84,580-byte integrated candidate.

The 2026-09-08 measured consolidation reduced a paired 82,085-byte baseline to
81,907 bytes and later reduced the item-integrated pair from 83,413 to 83,227
bytes. These are historical observations, not current ceilings. LLP 1012
§"Bytes — frozen allocation" retains the current 90,000-byte ceiling, 80,000
target, five-root method, pinned toolchain, and comparable-growth checks.

## Write-path implementation record

Lane O1b established principal-bound replay grants, server-side remaining-ID
and operation-demand pricing, trace-conflict precedence, canonical row and
verdict digests, ledger-before-grant deduplication, stored partial terminals,
and live-session checks. A byte-identical retry consults the ledger before
current operation lookup, allowing settled work to survive program evolution.

Lane O2c made intents, grants, FIFO order, traces, and overlays durable on both
carriers. Enqueue consumed the certified ID slice; replay sent one identical
envelope at a time; transport loss kept the intent queued; settlement and its
log tail landed atomically. A serial ledger tail prevented duplicate grant-slice
consumption. The 2026-09-04 afternoon ruling removed client-clock expiry: after
successful resume, the server alone judges old queued work.

The cancellation follow-up raced every resume-owned transport await against its
captured signal. Offline, close, auth transition, or terminal expiry leaves the
durable envelope queued and fences late results; fresh same-principal recovery
retries the identical envelope through the server ledger.

Lane F bound replay trust to intent and partition and required a successful
post-fence resume. Lane O2b ran prediction in the ledger critical section,
persisting overlay, trace, and `predicted` atomically. It recorded the accepted
range-read deviation, maintained-target omission, authoritative retirement,
bounded miss rule, and strict authority/supersession behavior. Later T1/T2
landings refined retirement and coverage reset. LLP 1012 §7 and §8 retain those
current normative rules; this section preserves only their landing chronology.

## Lane and landing chronology

The original implementation plan named O1 (wire, server, compiler), O2 (range
store, twin, outbox, web witness), and O4 (asset bytes and Expo carrier). The
external `purgeExpired` dependency was replaced on 2026-09-05 by LLP 1016 D5's
owner-fired `expireMessage` schedule.

O1c landed at `7438b6a4b`; O1a landed in `7438b6a4b` and `f24ad7d6d`; O2a
landed at `f24ad7d6d`; O1b landed at `37281c059`. Later 2026-09-04 landings
carried O1b fix rounds, O2c, O4-web, the close/drain integration seams, O2b,
and fourteen scaffolded-template journeys. The Expo carrier and simulator
witness followed under the Expo arm. LLP 1012's `Implemented` status records
the completed result; this chronology does not independently certify it.

## Panel and review record

Six blind round-one reviews and five round-two design contributions occurred on
2026-09-04. The original artifacts remain under
`llp/reviews/1012-local-first-v1.*`, with synthesis in
`llp/reviews/1012-local-first-v1.panel.synthesis.md`. Round one was six of six
NOT READY. Round two, at the author's instruction, contributed designs that
converged on the eventual range, retention, outbox, resume, and witness model.

The record attributes the range-absence gap, unbounded resume, and missing
replay envelope to all six round-one reviewers; the page-200 refusal, hard
session wipe, and receipt oracle to Fable; missing OCC and the client-clock
problem to Codex; unrelated digests and exclusive locking to Grok; missing
drain rotation to Codex and Muse; view-once timing to Gemini; purge-with-proof
independently to Fable, Grok, and Codex; the strong-validator analogy to Codex;
and the journey primitive to all five round-two contributors.

No review artifact was created or altered by this curation, and this explainer
does not convert any review verdict into author acceptance.

## Historical scheduling question

Revision (b) left a schedule question: whether O1 should begin before the loop
bar because its server/compiler work did not compete with client-facing lanes.
The document recommended starting O1 immediately while keeping O2/O4 relative
to `T`. The recorded landings make that recommendation historical. The three
substantive revision-(b) questions were already recorded as closed by the
author's principle: retention ruling 8 stands, trace-validated OCC ships, and
the twin is the client.


## Verbatim extracted record

The following blocks are copied verbatim from LLP 1012 immediately before the
2026-09-11 structural curation. They preserve exact historical measurements,
fix-round details, review attribution, and superseded wording. Their local
words such as “above” and “below” refer to the pre-curation LLP 1012 layout;
they are archival, not current normative instructions.

### Original status and revision metadata

**Status:** Implemented (revision (j), 2026-09-05: every lane of §12 and the close-out lanes landed on main — landings 4–6 (`9f4f4953a`, `e992c391e`, `4f5eef21f`), the fence (`2dded8335`), overlay retirement (`3b483d652`), supersession (`d4de10457`), the owner split (`ba8e6309e`), the loop index and ruler (`685b883b5`, `1e39b0d9d`), and the Expo arm E1/E2 (`aa2ec8d33`, `926d62ad7`; LLP 1013); the simulator witness passes all ten steps; residuals are tickets under `issues/` (`20260904-snapback2-*-followups`, `20260905-snapback2-e2-round-3-leftovers`). Revision (c)'s record — revision (c): the author's principle of 2026-09-04, "go as straight as possible to the ideal thing", closed revision (b)'s three questions — no staging, the twin is the client, trace-validated OCC in v1, ruling 8 stands; one scheduling question remains in §"Open questions (author)"; per `rules/RULES.md` it binds lane by lane as each lane's code lands)

**Revised:** 2026-09-11 (asset URL lists preserve positions and session view-once bytes share the configured byte ceiling, with no independent count cap); 2026-09-10 (delivered custody survives coverage reset; bounded client-owned recovery and honest grant demand); 2026-09-09 (author-approved 85,000-byte runtime ceiling, unchanged 80,000 target); 2026-09-08 (Lane E review fixes: accepted comparable byte baselines, private shared bundle, executing condition tests); 2026-09-08 (elegance program §E: frozen complete-runtime allocation); 2026-09-08 (template send/post coexistence superseded by LLP 1002 template consolidation); 2026-09-08 (measured runtime consolidation); 2026-09-07 (LLP 1018.003 item surface: retained terminal history, image-bound proof, explicit 84,000-byte ceiling with 80,000 target); 2026-09-08 (LLP 1018.000 implemented and qualified; current Snapshot contracts reconciled); 2026-09-07 (explicit merged-schema allocation: 82,500 ceiling, 80,000 target); 2026-09-07 (LLP 1018.003: rule 3 fires on the schema's `tombstones` declaration, §5; screens retire committed intents after rendered arrival and cleared prediction custody, predicted rows carry ids, §7); 2026-09-07 (row-specific prediction admission and durable contradiction); 2026-09-07 (durable exact-absence admission and same-sequence tombstone precedence); 2026-09-07 (public zero-count prediction through existing paired proof custody; implementer Codex); 2026-09-07 (self-contained external SDK declaration root and private compiler ambient library, §8); 2026-09-07 (ambient offline declaration copy and unfiltered package consumers; implementer GPT-6 Astra); 2026-09-07 (explicit 82,000-byte architecture allocation, 80,000 working target; pinned Node 24 measurement); 2026-09-07 (LLP 1018.000 §8: bounded durable browser-follower admission and recovery, §4 and §7); 2026-09-07 (LLP 1018 §6: named Unicode indexed search replaces app-side filtering, §6 and §10); 2026-09-07 (LLP 1018 §4: mounted named queries publish committed effective-store revisions, §6); 2026-09-07 (LLP 1018 §3: the second browser tab follows the writer and inherits its queue, §4); 2026-09-06 (bounded drain admission and persistent resume diagnostics); 2026-09-06 (first-epoch adoption is not a session change, §4; an `unchanged` replay of a held denied answer keeps the plain wire shape, §8; the offline drain watches its tail from the page chain's cursor, §6; the browser witness bundles web-only and reports the composer's reason); 2026-09-06 (fixed complete local-runtime measurement roots: 66,000-byte ceiling, 64,000 target); 2026-09-06 (measured full-entry search trade: 50,000-byte ceiling, 48,000 target); 2026-09-06 (session-delegated indexed search, 34,000-byte total twin, Exact 2 deferral; foundation first); 2026-09-06 (overlay retirement follow-ups, §7); 2026-09-06 (reconnect — full delivery after conditional sequence refresh, §8); 2026-09-06 (auth startup review: queued transitions, interrupted sync, live held reads); 2026-09-05 (auth startup recovery and held transition reads, §4); 2026-09-05 (L11 — schema-derived one-use images, §9); 2026-09-05 (Clique L8a — §3 uniformity follow-up); 2026-09-05 (LLP 1016 J2 — the purge is a schedule, §3 and §12 amended); 2026-09-05 (local-data review fixes: purge, row identity, typed extents, escape parity, session epochs, cold cursors, replay and recovery); 2026-09-04 (i — author rulings of the afternoon: the fence never discards a queued write, the queue replays after a successful resume and the server judges (§1, §5, §7; lane F implements); the twin's size ceiling is 30 KB gzip, 19.7 KB measured (§14, NOT-DOING); the prediction over an uncovered range stands as recorded (§7)); 2026-09-04 (h — fix-forward record, lane O2b fix round 2: a committed intent's overlay leaves on a page of the tail chooser's query or a delivery holding a predicted row, and any other swap that moves the store past the commit is one miss of two, after which the overlay is dropped and the entry retired from prediction (§7); the hasher's `List` arms refuse unknown fields (§8); the twin's hydrate catch is typed and a bug propagates (§6); a delivery under another generation or schema is not held and supersedes the coverage, so offline reads are `hydrating` until the next resume's reset, while `E_OFFLINE_AUTHORITY` keeps principal and auth-epoch mismatches (§8, §15); `client.outbox.ready()`, `useOutbox().ready`, and `useMutation().ready` gate the chat composer until a drained query has earned a grant (§7)); 2026-09-04 (g — implementation record, lane O2b and its fix round, the twin is the client: the evaluator is split into a store, a runner, and the entry and traces every point read with the digest of the wire row it disclosed, a hidden hit as an absence, and verdicts only from rule checks that disclosed their row (§6, §7); one schema and rule hasher mirrors serde's field order, refuses any field serde's struct does not carry, deep-sorts unknown variants, and the hydrate path recomputes the hash and refuses a mismatch (§6, §8); the program is held per generation beside the write bounds and re-fetched after `E_OFFLINE_RESET` (§6, §8); the drained-prefix rule is a chain of held pages on one (table, index, prefix, rule) from `after: null` to Exhausted, a page that lost a member since it was recorded is no link, and once Exhausted a page of the group holding a row the chain does not hold breaks it (§6); prediction runs inside the grant's critical section with the slice as its ids and lands overlay, trace, and `predicted` in the entry's own swap (§7); three deviations from "if every read is covered" are recorded: an uncovered range does not block a prediction, an unheld engine-maintained aggregate target does not block it and the omitted names ride the prediction, and a committed intent's overlay is dropped by an answer at or after the commit seq that touches one of its tables or any page of a drained op, never by an unrelated answer (§7); with a partition open every write carries the replay envelope or refuses `E_OFFLINE_ID_BLOCK` before any request, and only a client with no store sends plain bytes (§7); local authority violations are `E_OFFLINE_AUTHORITY` and keep coverage (§15); the IndexedDB `ranges`/`absences`/`verdicts` projections are gone (§6); the twin measures 19.7 KB gzip, engine alone 16.9 KB, and NOT-DOING's 9.7 KB is re-baselined to the measurement (§13, §14)); 2026-09-04 (f — implementation record, lanes O1b fix rounds 1–2, O2c, O4-web and its fix round, and the integration seams: grants are minted only when the request's `remaining` is absent or below 1,024 (§7, §8); the resume log op must be a certified ascending cursor page of at most 50 rows and its envelope counts against the 1 MiB budget (§8); the intent ledger is consulted before any grant check (§7); a replayed intent that rolls back on missing authority is stored as its partial terminal (§7); on the rejected path the compare set is every traced point plus every verdict a reached or probed rule check derived on a disclosed row, unreached verdicts re-derive only through the read rule, and the rule inputs a hidden candidate minted are excluded on both paths (§7); the verdict `inputsDigest` is `sha256(canonical([table, index, key]))` over wire values (§7); a replay needs a live session and the grant outlives the session (§7); the outbox's grant slice is `1 + maxNewIds` from the op's certificate, a transport failure keeps the intent queued and the retry is the same envelope, and a committed settlement lands in the same swap as the log tail (§7); `close()` resolves when the carrier is quiet (§6); asset bytes are keyed `(assetId, width|null)`, evicted least-recently-read by each entry's own stamp under the store's logical clock, and a view-once row is tracked per `(table, id)` in a durable viewed set, marked at the first byte fetch for an image and at play for a clip, read `null` on every path and excluded from coverage (§9); `E_ASSET_VIEWED` and `E_OFFLINE_CONFLICT` join the `offline` family (§15); the former `messages.send`/`deliveries.post` coexistence record is superseded by LLP 1002 §Templates are products (§3); one open question for the author, the fence's local expiry of queued intents (§7)); 2026-09-04 (e — implementation record, lane O1b: grants are minted on every login, guest, and resume because the server cannot see the client's remaining count (§7); a trace conflict takes precedence over a program rejection, so a member removed while offline settles `conflict` rather than the program's own refusal (§7); the point digest is over the canonical wire row, which is what the pool carries (§7); an empty trace commits without a conflict check, which is the client's spelling until the twin lands (§7)); 2026-09-04 (d — implementation record, lanes O1a/O1c: the validator covers the row pool, `args`, `reason`, and `rule` (§8); row references carry engine provenance and application values are escaped (§8); `n2Key` is not on the wire; `GET /api/program` returns the schema; the recipe's tombstones reach current members and a departed member's copy is evicted by point absence, because the engine's uniformity analysis collects both arms of an `or` and Quarry cannot build a list from a range (§3); the membership cap is a maintained count (§3)); 2026-09-04 (c — the author's principle applied: the twin is the client from the start and stored-answer replay is its covered case (§6); intents carry the twin's trace and the server validates point reads and verdicts at commit (§7); the retention word ships as ruled, on the table whose rows can hide, with its twin-side meaning (§5); the bar gains one acceptance only the twin can pass (§12); lanes collapse to O1, O2, O4; (b)'s Q1–Q3 closed); 2026-09-04 (b — the panel's designs folded: positive-fact purge (tombstone rows, point absences, uniform-extent holes; no engine change), a frozen delivery envelope with one server-minted validator, resume as one owner action over the log's watermark plus mounted queries, a replay grant with an intent ledger for exactly-once, the corrected and certified recipe (page 50, `*`, a second log index for threads, compare-and-set edits), seal-not-wipe on session expiry, Web Locks across tabs, the journey primitives, the split witness, lane O3 off the bar's path pending ruling; §16 records who found what) (j — 2026-09-05: Status Implemented; the E2 witness record in §6)

### Pre-implementation baseline

Checked against `origin/main` at `9ffdf6dd0`, the commit that carried
revision (a), and re-checked by six panelists:

- **The shipped client is in-memory.** `packages/snapback2/src/client.ts`
  reconnects SSE with backoff and keeps the last delivery as `stale`; there
  is no durable store, no outbox (`queued` is reserved and never claimed, LLP
  1002 §9), and no local evaluation. The server sends a full result per
  delivery; the subscribe path sends `Last-Event-ID` and the server ignores it.
- **The twin exists and is unwired.** `packages/evaluator` is conformant with
  the Rust engine on the corpus; the public client never imports it
  (`issues/20260830-…`). The Rust `ClientStore` hydrates an in-memory engine
  from a closure receipt as a harness — the S1 spike's descendant.
- **The receipt distinguishes absent from hidden for point reads only.** A
  missing row records an absence; a hidden row returns `Null` with none
  (`snapback2-core/src/engine/runner.rs:671-688`). A range receipt is
  emitted only for a certified-uniform site and carries `row_ids`, `stop`,
  and a whole-range `absence` flag (`runner.rs:985-1008`); hidden
  candidates are truncated out (`runner.rs:895-902`); non-uniform ranges
  carry no range fact at all.
- **The owner is one thread over an `mpsc` channel** (`snapback2/src/writer.rs:70-82`)
  holding SQLite in `locking_mode = EXCLUSIVE` (`snapback2-core/src/store.rs:97-108`);
  every execution opens its own transaction (`engine/mod.rs:734`). "One seq"
  is a property of one owner action, not of a transaction.
- **There is no OCC in the invoked path.** `POST /api/mutation` carries `op`
  and `args` (`serve.rs:402-412`); the engine executes against current rows;
  nothing compares a base version. `mutation_context` overwrites
  `context.new_ids` from the store's reservation on every call
  (`writer_auth.rs:152-156`); the engine's own hook is the `new_ids` queue
  (`engine/mod.rs:23`, `runner.rs:392-397`).
- **Sessions are a hard thirty days with no renewal** (`identity.rs:15`).
- **`schedule` is refused** (`quarry/parser.ts:71`) and rules cannot read
  time, so nothing on the server expires a message on its own.
- **Quarry has no retention spelling**; `retention.rs` is cost estimation.
- **Governance read all of offline as deferred**, on a NOT-DOING line whose
  key phrase was defined nowhere, while the brief's offline obligations sat
  at M5 and M6 outside both bars.

### Superseded O1c recipe record

**Implementation record (lane O1c, 2026-09-04; superseded).** Tombstone and edit rows
reach the conversation's *current* members, not every original recipient. Two
private spellings were tried and refused by the language as it exists: a
`sender` column in the fan-out index's prefix with `read <- .recipient = viewer
or .sender = viewer` fails certification because the uniformity analysis
collects every field in both arms of an `or` (`E_STRUCTURAL_COUNT`), and a
`recipients` list on the message row cannot be built because Quarry has no way
to make a list from a range read. The only spelling that certified *and* kept
the log private fans out over current members. A departed member's copy of an
unsent body is therefore evicted by §5 rule 1, the point absence its inbox page
records when that page next revalidates, not by a tombstone. The delivery log
is never public (orchestrator ruling; a public log discloses membership and
activity). The membership cap is `maintain memberCounts` plus a `require` in
`memberAdd`, refusing the 51st member `GROUP_FULL`. Both language limits are
filed as tickets and would let the recipe return to the original-recipient
fan-out. **Superseded 2026-09-08:** lane O2c's `messages.send` /
`deliveries.post` coexistence and template/fixture byte-identity constraint
are replaced by the accepted [LLP 1002 template consolidation](./1002-dev-loop.spec.md#templates-are-products).
The shipped template uses `messages.send(conversationId, body, expiresAt?)`
and `messages.thread` over the delivery log; `deliveries.q` is deleted.
The `post` spelling in the historical recipe and schedule amendment above
is likewise superseded by `messages.send`.

### O2b and witness read records

**Implementation record (lane O2b and its fix round, 2026-09-04).** The twin is
`snapback2-evaluator` split into a store, a runner, and the entry, hydrated from
`coverage()` through the held schema. One hasher: known shapes are reconstructed in
serde's field order (proven equal to Rust's `Schema::hash()` on every golden and the
corpus, and the goldens fail when the hasher is perturbed); a payload carrying a field
serde's struct does not carry is refused; an unknown rule, constraint, or column variant
is deep-sorted so it hashes deterministically and never as a known shape; the hydrate
path recomputes the hash and a mismatch is `hydrating`. Every pooled row of a delivery
joins its answer's refs, so the closure rows a read rule probed survive. The
drained-prefix rule is a chain of held pages on one (table, index, prefix, rule): every
`after: null` page is tried as a start; a link is the previous page's last recorded row,
by its index suffix when held and by its id alone when it is a viewed view-once row and
the index ends in `id`; a page that lost a member since it was recorded (`evictedIds`)
is no link and covers nothing whole; once Exhausted is reached, a page of the group
holding a row the chain does not hold breaks the chain, and a page whose rows the chain
already holds adds nothing. A query whose prefix binds every drained column equality is
covered on any index of the table. `partial` reasons: `evicted` for a primary-key read
of an evicted row or a range over a table one of whose held pages lost a member,
`computed-key` for a Shape-provenance read, else `never-held`. A view is `hydrating`
when no program is held for the coverage's generation or schema. A held row of a
`retain delivered-history` table is readable to the twin. A retained answer remains
the fallback when a certified local rerun is denied, partial, or unavailable; a
complete, capped, or held rerun over independently held facts may reconstruct a
projection whose unproven literals were cleared by revocation. The auth-epoch fence is the coverage facts' epoch
bound into the verdict lookup. The IndexedDB `ranges`/`absences`/`verdicts` projections
were write-only and are deleted on upgrade; coverage derives from the held answers'
receipts.

**Implementation record (the browser witness, 2026-09-06).** The tail an offline drain
watches is opened at the page chain's own last cursor, as online; the adopted store
watermark is reported and used for the resume position only. A tail opened at the
persisted watermark answers only the rows past it and, since a view is the latest
delivery, replaced the whole caught-up inbox with the newest chat on a cold start.

**Implementation record (lane E2's witness, 2026-09-05).** An offline drain keeps the
watermark the last online drain or resume persisted. The simulator witness found a remounted
`drain: true` on an offline cold start following the twin's own page chain (the twin mints
`next` from the rows it holds — `null` for a one-page log — and the held-only path re-marks
with a fresh `updatedAt`) and recording that as the watermark, which moved the resume position
to the prefix root on every offline start. `drain.ts` now adopts the store's watermark when
its pages were answered offline (`connection: "offline"`, the base page's held `watermark`) and
`mark(…, offline)` records nothing; the five-page drain test's cold-reopen tail pins it (the
whole coverage is deep-equal before and after an offline remount). The witness's structural
consequence: a reopened database is inspected before any client constructs, because a mounted
app writes. Two narrowings of §9 landed with the same lane: a byte consumer holds an explicit
viewing token for the life of its mounted instance on both arms (a missing token refuses
before the fetch). Its video play stand-in was removed by L11: server one-use
delivery is an image column modifier; video ranges remain unspecified.


### Superseded indexed-search allocation record

**Measured scope revision, 2026-09-06.** Root revises the earlier speculative
34,000/30,000 allocation under the same unattended delegation. A pinned
Node22.23.2/esbuild0.25.9/gzip9 checkpoint reproduces the legacy entry at21,745
bytes, that baseline with existing projection/receipt bodies retained at24,094,
and the then-measured WIP entry at46,838. Its minified bytes are138,082;
minified attribution is not additive gzip attribution. The earlier44,290 figure
omitted required `ProjectionCache.prepare` and `toClosureReceipt` bodies despite
including their modules; retain it as an incomplete measurement, not a pass.
Reaching34,000 would require a27.4% reduction with no identified redundant code
supporting that estimate. The revised50,000 ceiling/48,000 target pays for the
complete indexed, Unicode, receipt and carrier behavior instead of deleting it.
This is a new scope decision, not retroactive compliance with34,000. Exact2
remains deferred; 1M steps/4MiB closure/8MiB heap/1MiB output are unchanged.
A subsequent boundary audit found that the46,838 entry still omitted edited
PersistentRangeStore commit/applySwap/retirement bodies; it is also incomplete.
The50,000 decision above remains historical pending a complete boundary audit,
not evidence of compliance. Integrated measurement must
retain every required body and data payload. Evidence:
[exact checkpoint](../benchmarks/runs/2026-09-06-clique-improvement/evidence/search-byte-decision/byte-checkpoint.json).

**Final boundary decision, 2026-09-06.** Root supersedes the earlier speculative
34,000 and partially measured 50,000 allocations with a 66,000-byte gzip ceiling,
64,000 target. The fixed entry retains complete Twin, PersistentRangeStore,
OfflineRuntime plus offlineView, the full projection namespace, and the full
receipt-protocol namespace. It includes all local execution, custody, retirement,
normalization data and decoding; HTTP/SSE framing and physical-driver forwarding
remain explicit adapter exclusions. No required algorithm may move there to
escape measurement. This is the complete local runtime, not the entire SDK or
an estimate of downloaded application size.

Pinned Node 22.23.2 / esbuild 0.25.9 / gzip 9 measures the same roots at 39,671
bytes on exact foundation 1f9 and 62,624 in current WIP. An exhaustive 156-export,
28-module cross-check is 63,023; parsing the minified canonical output confirms
all methods of 21 edited/new exported classes survive. The 399-byte difference
is unused standalone helper exports. The earlier 54,140 generic-carrier result
omitted edited OfflineRuntime custody paths; 46,838 and 44,290 also omitted
required bodies. All remain historical incomplete measurements, not passes.
This superseding decision preserves required behavior and makes room for final
review repairs; it changes no runtime resource ceiling or Exact 2 deferral.
The final frozen source must be measured again using these same roots and must
pass runtime, native, durable-store and independent review qualification.
[Boundary manifest](../benchmarks/runs/2026-09-06-clique-improvement/evidence/search-byte-decision/boundary-manifest.md)
and its adjacent exact entry, measurements, method-retention and excluded-input
records establish what is counted. No final capability is claimed here.

**Architecture allocation amendment, 2026-09-07.** Under the user's explicit
commission to refine and implement LLP 1018.000, Root adopts an **82,000-byte
gzip ceiling and 80,000-byte working target** for the same five-root entry.
The canonical toolchain is **Node 24.18.0 / esbuild 0.25.9 / gzip level 9**.
The historical 62,624 figure above used Node 22.23.2; it is not a controlled
subtraction from these Node 24 measurements.

Exact same-toolchain measurements are 77,571 before forwarding (`3253187d2`),
79,272 at `c5c562667`, and 79,207 after Words retirement and intervening
integration fixes (`527861e673`; 244,019 minified bytes). The last measurement
fails the old 66,000 ceiling. The 65-byte decrease is an observed integrated
delta, not an isolated causal saving from Words. The revised ceiling adds
16,000 bytes (24.2%) and leaves **2,793 bytes for remaining integration/review
repairs**; the working target is 793 bytes above the measured candidate. The
reserve cannot silently fund another feature, and exceeding 82,000 still fails.

The separately measured complete `client.ts` source entry grows from
103,794 to 110,485 gzip with forwarding, then to 110,520 at `527861e673`.
Both earlier numbers reproduce exactly alongside the latest result. These
isolated complete-source measurements retain the same two optional SDK
imports, `expo-file-system` and `expo/fetch`, as runtime imports; installed
Expo/React Native SDK code is outside this source-footprint comparison. A
warm-checkout attempt that bundled those SDKs failed on their Flow/module
syntax and produced no measurement. Neither entry estimates an app download.

No measured alternative establishes a safe route back to 66,000. Unicode
packet/codec experiments grew; replacing inverse indexes with scans loses
bounded work; retaining only surviving answers loses durable guards and
historical key proofs. A tagged proof design still needs global, answer and
transaction ownership, reverse lookups, interning, rollback and exact slot
charges; it established no substantial deletion. This is evidence for a
footprint trade, not proof of global optimality. Public Words and the old
Quarry data frontend are retired within the commissioned simplification.
No required payload moves outside the entry, no dependency/gate is added,
and the 1M-step/4MiB-closure/8MiB-heap/1MiB-output limits stay.

The [Sol allocation review](./reviews/1018.000-runtime-allocation.sol.md) and
[Grok allocation review](./reviews/1018.000-runtime-allocation.grok.md) both
mark the same frozen amendment READY. Root accepts that allocation under
the current delegation. This does not qualify unfinished code, latency,
Web/Expo behavior, publication, or the published-package bars. Final
integration and review repairs were required to fit 82,000; the explicit merged-schema amendment below supersedes that allocation.


### Later superseded allocation and measurement record

**2026-09-09 (author amendment; historical, superseded above).** After reviewing the integrated six-item candidate at 84,580 bytes gzip, Charlie explicitly approved raising the ceiling to **85,000 bytes** and landing everything. The **80,000 target**, five-root measurement, pinned toolchain and 1% comparable-growth checks remain unchanged. This specific allocation supersedes the 2026-09-08 ceiling below; future features still fit by deletion or descope unless the author rules otherwise.

**2026-09-08 (author; historical allocation, superseded above).** The complete local-runtime ceiling is frozen at 84,000 bytes gzip, 80,000 the target; a feature that does not fit is descoped or paid for by deletion, superseding every prior allocation increase.

**Item-surface allocation amendment, 2026-09-07 (historical; superseded by the 2026-09-08 freeze).** Under the user's explicit
commission to design and implement the composed client, Root adopts an
**84,000-byte gzip ceiling**, retaining the **80,000-byte working target** and
the unchanged five-root instrument. LLP 1018.003 records the measured delta,
full-client cost, independent reviews and author disposition. This supersedes
the historical 82,500 allocation below. The trade replaces repeated screen
joins and automatic cleanup with private image evidence and shared read models;
no wire field, compiler pass, second queue, automatic compactor, dependency or
new gate enters scope. Existing deferred work remains deferred.

**Merged-schema allocation amendment, 2026-09-07 (historical; superseded by the 2026-09-08 freeze).** Root adopts an
**82,500-byte gzip ceiling**, with the **80,000-byte target unchanged**, under
the existing LLP 1018.000 review/implementation delegation. The upstream
LLP 1018.003 reconciliation brings schema-declared tombstones into the measured
runtime, along with truthful shared-query provenance and hash validation.
Pinned whole-tree measurement at `fc1e6bbf9` is **252,559 minified / 82,085
gzip** bytes. It still fails the former 82,000 ceiling by 85; that failure is
not rewritten. Compared with the earlier combined `32d137c2d` measurement of
82,375, the net reduction is 290 bytes after readable predicate and optional-fact
projection consolidation plus correctness fixes, not an isolated optimization
benchmark. Compared with the previously qualified `3a66182cd` runtime, the net
increase is 712 gzip bytes; this does not attribute that increase to one feature.

The explicit 500-byte allocation increase is 0.61% and leaves 415 bytes at the
measured candidate. Bounded cleanup established no further readable saving
sufficient for the old ceiling; no global size optimum is claimed. This trade
keeps the complete five-root entry, pinned toolchain, existing resource limits,
Exact 2 deferral, and every required predicate/authority behavior. It funds this
reconciliation, not another feature. Closing independent code reviews assess
the amendment with the implementation; both final reviews are now READY and
platform qualification passes, as recorded in LLP 1018.000 §10. The earlier
allocation reviews did not approve this amendment. The old-ceiling and working-
target misses remain explicit.

**Measured consolidation, 2026-09-08.** Under the author's request to reduce
test time and then runtime size, `f2d59a7ef` measures **251,713 minified /
81,907 gzip bytes** with the same five roots, Node 24.18.0, esbuild 0.25.9,
and gzip level 9. The paired baseline is 252,559 / 82,085: a reduction of
846 minified and 178 gzip bytes. That candidate retains the then-current
82,500 ceiling and misses the 80,000 target by 1,907 bytes.

The delivery decoder reuses the store's row-reference and escaped-object
helpers after its recursive plain-wire validation. Carrier reopen applies one
list of the existing nullish map defaults; explicit null retains its prior
empty-map meaning. Statement identity keeps serde field order and expression
normalization in one hoisted descriptor, avoiding reconstruction of the shape
table for each statement. Only own variant names select a descriptor. No
authority evidence, index, normalization payload, or runtime resource limit
is removed. A broader domain/expression descriptor experiment increased the
gzip result by 17 bytes and was discarded. Qualification is recorded with the
implementation in LLP 1018.000 §10.

The final integration includes the independently landed client-item surface
and its 84,000-byte allocation above. Pinned upstream `f5d90cd54` measures
256,811 minified / 83,413 gzip; integration `43e06fa90` measures
**255,964 / 83,227**, a reduction of **847 / 186 bytes**.
The current 80,000 target remains missed by 3,227 bytes; this cleanup does
not increase the allocation. The complete measurement and the original
pre-item pair are retained separately.

### Write-path lane and fix records

**Implementation record (lane O1b, 2026-09-04).** Grants are minted when the
request's optional `remaining` (the client's count of unused ids) is absent or
below 1,024; a client that omits it gets a grant on every resume, so the client
now sends usable remaining capacity (zero if expired). That client-side field
was missing until the 2026-09-10 correction. Optional `demand` names a mutation
in the request's generation: the owner prices `1 + Insert/Upsert max_rows`
from its certificate and also mints if that exceeds remaining IDs. Grant size
and lifetime are unchanged. A write-only partition may acquire capacity
through the existing logless resume using authenticated epoch and held program,
but only while it has no coverage facts: that path cannot publish coverage,
advance a resume sequence, or renew trust in old grants. A trace
conflict takes precedence over a program rejection: when a member removed
while offline replays a send, the `require` fails before any verdict, and the
honest answer is `conflict`, not the program's `NOT_MEMBER`. Point digests are
SHA-256 over the canonical wire row, the form the pool carries. An intent with
an empty trace commits against current rows with no conflict check; that is
the outbox's spelling until the twin produces traces. The resume's log page is
filed by the client under the tail key (the page the server evaluated after the
watermark), never under the base page's key. *Fix rounds 1–2:* the intent
ledger is consulted before any grant check, so a stored terminal answers a
byte-identical retry even after its grant is spent; a replayed intent that rolls
back on missing authority is stored as its partial terminal; on the rejected path
the server compares every traced point, probing unreached points through the
table's read rule as the replaying principal, and every verdict a reached or
probed rule check derived on a disclosed row, and it skips a traced verdict no
disclosed rule check derived (a hidden or absent row settle byte-identically);
the rule inputs minted while a candidate turned out hidden are recorded at
rollback and excluded from the compare set on both paths, so a hidden hit can
no longer vouch for a verdict on the committed path; on the committed path a
traced verdict no disclosed rule check derived is a conflict (strict), never a
skip, because a commit must not proceed on a claim the run could not verify;
conflict precedence is
independent of `require` order; the verdict `inputsDigest` is
`sha256(canonical([table, index, key]))` over wire values, computable from the
envelope; a replay needs a live session (`E_AUTH_SESSION` before the ledger,
the grant, or the slice) and the grant, bound to the principal only, outlives
the session so a fresh login finishes the outbox.

**Implementation record (lane O2c, 2026-09-04).** Intents are durable in the
range store on both carriers with their grants, a FIFO order, and the twin's
overlay seam; enqueue consumes a slice of `1 + maxNewIds` from the current grant
and refuses `E_OFFLINE_ID_BLOCK` when it is spent; the drain replays one
envelope per request after a resume; a transport failure keeps the intent
`queued` and the retry is the same envelope; a rejection or a trace conflict
settles only its own intent; a grant past the fence settled `expired` locally
until the afternoon ruling (lane F removed that; its record follows);
a committed settlement lands in the same swap as the log tail; `useOutbox()`
and `useMutation().pending` expose the queue; the provider creates its client
once so StrictMode does not leak a lock holder. *Fix round 1:* the ledger's
adopt, enqueue, and dismiss run on one serial tail so a grant slice is never
consumed twice; a committed reply whose log-tail fetch fails leaves the intent
`queued` (the retry is the same bytes and the server's ledger answers
unexecuted), so rows and settlement always land in one swap; the settlement
tail and the resume `log` name the drained query whose watermark the partition
recorded first; `settled()` rejects with the refusal that stopped the replay; a
terminal settlement drops the prediction overlay in the same swap; each op's
certified `maxNewIds` is persisted in the store and an enqueue with no known
bound refuses `E_OFFLINE_ID_BLOCK` rather than pricing from a fallback; the
provider compares offline options by store factory and values; `online()`
drains a held queue even when no resume can be built. *Revision (f)'s open question
is ruled (2026-09-04 afternoon):* the local expiry of intents whose grant is past the
fence discarded writes the server would still accept for thirty days and would
validate by trace; the client now replays after a successful resume and lets the
server judge, keeping the fence for prediction and the `stale` label only (lane F).

**Cancellation follow-up (2026-09-06).** Resume-owned transport awaits race the
resume signal, including replay responses/bodies and the log-tail fetch. Cancellation
unwinds the existing serialized drain without waiting for transport cooperation;
the durable intent stays queued. Replacement recovery retries that exact envelope
before later intents, even if the old request already committed at the owner.
The ledger provides exactly-once execution and the old signal fences late results
before they can settle intents, advance the drain, or change the client snapshot.
The same cancellation applies to mutation-owned and explicit outbox drains on
offline, close, an auth transition, or terminal expiry. Expiry cancels sibling
drains while the request that observed the terminal keeps its original refusal;
it neither rereads a sealed store nor enqueues a new call behind an older intent
after that terminal. This includes typed HTTP 200 `rejected`/`refused` session
terminals: the JSON boundary applies the same captured-custody expiry as HTTP
401 before replay settlement, resume admission, or log-tail decoding. The
exact durable envelope stays queued, including after an owner commit whose
tail refused; fresh same-principal login retries it through the ledger. Ordinary
intent refusals remain local to that intent. A tracked mutation lends its captured
authority to its drain, so it cannot wait on the transition that is waiting for
that write. Cancellation keeps the durable intent and releases the serialized
drain; fresh recovery still retries the identical envelope.

**Implementation record (lane F and its fix round, 2026-09-04).** Replay eligibility is
per intent and per partition: an intent whose grant is past the fence, or that was
enqueued past it, replays only after a successful resume of *its* partition since the
fence was crossed; a fresh login grant never releases older queued work; missing trust
waits, and nothing expires on the client's clock. The resume trust anchor is cleared on a
partition change, seal, wipe, close, and coverage reset. A partition holding a grant and
queued intents but no coverage facts recovers by a receipt query that supplies facts and
then the owner's logless resume; when no query can supply them, `online()` refuses
`E_OFFLINE_RESUME` and keeps the queue. `drain()` and `settled()` return
`{ stopped: "fence" }` past the fence; `ready()` means a current grant (the fence does not
gate it) and `useOutbox().fence` is `inside | past`, which the chat composer renders as
"Queued until the next sync". An intent enqueued past the fence carries no trace and is
marked unpredicted with `reason: "fence"`: the server commits it with no OCC (the O1b
record's empty-trace rule), so past the fence the program's own `require`s — the recipe's
compare-and-set `edit` — are the only conflict rule, which the real-owner journey proves
(a stale past-fence edit is rejected by the program's `CONFLICT`). Empty-trace commits
are therefore routine after a long absence, not rare; an app that needs stronger
protection writes its `require`. The historical client omitted `remaining`;
LLP 1018.008.000 corrects that defect and verifies real healthy resumes mint
nothing, while expired and selected-operation-deficient capacity renews.

**Implementation record (lane O2b and its fix round, 2026-09-04).** Prediction runs
inside the ledger's critical section with the grant slice as the twin's `new` ids; the
overlay, the trace (points with the digest of the wire row read, or `null` for an absence
or a hidden hit; verdicts only from disclosed rule checks, deduped; `inputsDigest`
through the shared canonical function), and `predicted` land in the entry's own swap.
Three deviations from "if every read is covered", recorded because §12's twin acceptance
cannot pass without the first: an uncovered **range** does not block a prediction (ranges
are never validated and re-execute fresh at commit; the twin evaluates over held rows and
names the range in `partialRanges`; a fan-out row of which the viewer's own copy is minted
under another id than the server's is pinned by the three-member group journey; the
author accepted this deviation on 2026-09-04 afternoon); an
unheld engine-maintained aggregate target does not block it, and the omitted target names
ride the prediction and the outbox entry (`omitted`); authoritative evidence at or after
the commit seq for any ordinary row retires the mutation's ordinary write group, including
fan-out rows whose server ids differ, while each engine-maintained target waits for its own
row or negative evidence. A proven page of a drained op or the bounded miss rule retires
what remains. This keeps a maintained target's predicted value until its own authoritative
row arrives instead of exposing a transaction assembled from an arrived source row and a stale aggregate. An
unrelated answer still retires nothing, and with no watermark and no matching delivery the
overlay stays. An uncovered point read, an uncovered rule input, or a local
refusal still queues without a prediction and with an empty trace. With a partition open
every write carries the replay envelope, online or not, or refuses `E_OFFLINE_ID_BLOCK`
(no grant, unknown bound, spent grant) before any request; only a client with no store
sends plain bytes. Local authority violations (a delivery for another principal or
auth epoch; a commit with no partition) are `E_OFFLINE_AUTHORITY`, and the client keeps
its coverage. *Fix round 2:* the overlay drop is a page of the tail chooser's query
(same op and arguments but for the cursor) or a delivery holding one of the predicted
rows by table and id; any other swap that moves the store past the commit seq is one
miss, and at two misses the overlay is dropped and the entry's `predicted` retired, so a
bubble neither vanishes on an unrelated delivery nor leaks. A delivery under another
generation or schema is not refused and not held: it records `superseded`, the online
caller gets the live answer, no held validator leaves the device, and offline reads are
`hydrating` until the next resume's `E_OFFLINE_RESET` runs the reset path (when the
generation and the auth epoch both differ, supersession wins over the epoch refusal; the
reset is not self-triggered — the follow-ups ticket of 2026-09-04 records that and the
`ready()` and catch-all residuals of the third review round).
`client.outbox.ready()` (a current grant inside the fence, or no partition) is exposed as
`useOutbox().ready` and `useMutation().ready`; the chat composer is disabled with the
reason until the inbox drain has earned a grant, and a refusal's rewrite is shown, never
retried blindly.

### Lane plan and landing record

Implementer for every lane: **codex gpt-5.6-sol (xhigh)** under the standing
roster, orchestrated and landed by Claude. `T` is the day the loop bar is met
on a published package; dates are targets, and a lane that slips returns here.

| Lane | Content | Systems | Target |
|---|---|---|---|
| O1 | **First landing, types only:** `DeliveryEnvelopeV1`, the row pool, the primary-index absence projection, the validator, mirrored in TypeScript with golden fixtures that round-trip byte-identically — **O2 starts here.** Then: `receipt=1` and `validator` on query and subscribe; the program and certificate served per generation; `POST /api/resume` with its caps and order; grants, the replay envelope with the trace, trace validation at commit, `_client_intents`, injection through `Context.new_ids`; `retain` in Quarry, the certificate, and the manifest; the `offline` runtime diagnostics with their page; the recipe's `check` output pasted into §3 | `snapback2-core`, `snapback2`, `packages/compiler` | T+12 |
| O2 | `RangeStore` + IndexedDB and Node carriers; the twin hydrated from `coverage()`, the drained-prefix coverage rule, local evaluation, `partial` reasons; the outbox, grants, traces, the prediction overlay, FIFO drain, `queued`/`expired`; `useOutbox`, `drain: true`, the pending bubble; §5's four rules with the word's two behaviors; Web Locks; seal/wipe; the journey primitives and the `offline` derived check; the `chat` template adopts the recipe with `retain delivered-history` on `messages`; the browser witness; the evaluator ticket closed | `packages/snapback2`, `packages/evaluator` | T+16 |
| O4 | `ByteCache` by row lease (LLP 1006 §9b); the view-once `viewed` set; the expo-sqlite carrier qualified on the simulator; the simulator witness | `packages/snapback2`, the Expo package | with the Expo arm |

Dependencies outside these lanes, named so they have an owner: the
`purgeExpired` recipe mutation (M5 acceptance 1); LLP 1006's one-use
delivery for the row-level cache refusal.

Each lane lands under two-family blind review (LLP 0005), and the spec's
status moves to **Implemented** lane by lane in a record appended here.

**Landing record.** Lane O1c landed on `main` at `7438b6a4b` (2026-09-04): `retain`
grammar, IR, and core default; the certified delivery-log recipe with the membership
cap and the private log; three review rounds (codex, grok, Muse). Lane O1a landed at
`7438b6a4b` (round 1) and `f24ad7d6d` (round 2): the frozen envelope with a
provenance-addressed row pool, the validator over every delivered byte, conditional
reads, program custody behind a session, hidden-candidate memo rollback, the engine
receipt module, the package tests in the gate; three rounds. Lane O2a landed at
`f24ad7d6d`: the range store on IndexedDB and a Node file carrier, atomic swaps, the
four eviction rules, seal and wipe, Web Locks, `drain: true`, the resume client, the
journey primitives, the client split under the cap; two rounds. The codex account hit
its usage limit at 06:02 during the second rounds of O1a and O2a and twelve minutes
into O1b; those two rounds were verified and landed on grok and Muse alone. From 06:50
Claude Fable subagents implemented and grok + Muse reviewed. Lane O1b landed at
`37281c059` (landing 3): resume, grants, the replay envelope, trace validation, the
intent ledger, `retain` on the manifest and certificate. Landing 4 (2026-09-04, the
commit carrying this revision): O1b fix rounds 1–2 (three review rounds), O2c (the
outbox, grants on the client, the chat template's screens, the browser witness in
headless Chrome; one review round plus a fix round), O4-web (byte cache under the row
lease, view-once; two rounds), and the integration seams (`close()` resolves when the
carrier is quiet; the guide page at 4,091 of 4,096 bytes). Lane O2b landed at landing 5 (2026-09-04, the commit carrying this revision): the
twin as the client, two review rounds; the never-opened-thread journey, the traced conflict
journey, and the three-member group journey pass on the scaffolded template (14 journeys);
the evaluator ticket of 2026-08-30 is closed. The Expo carrier and the simulator witness
wait for the Expo arm.

### Panel synthesis

Six blind round-1 reviews and five round-2 design contributions, all on
2026-09-04, all preserved with provenance under `llp/reviews/1012-local-first-v1.*`
and synthesized in `1012-local-first-v1.panel.synthesis.md`. Round 1: six of
six NOT READY as written; every engine claim verified by the orchestrator
against the tree; the recipe run through the compiler worker and a built
binary. Round 2, at the author's instruction, was designs rather than
critique, and the five converged on §3, §5, §7, §8, and §10 as written here.
Who found what, for the record: the range-absence gap, the unbounded resume,
and the missing replay envelope, all six; the page-200 refusal by hand
before the binary confirmed it, and the thirty-day session wipe, Fable; the
absence of any OCC in the invoked path and the client-clock problem, codex;
the two unrelated digests and the exclusive lock, grok; the drain's missing
rotation, codex and Muse; view-once at view time, Gemini; the receipt as an
existence oracle, Fable; the purge-with-its-proof mechanism, Fable, grok, and
codex independently; the validator as HTTP's strong ETag, codex; the
journey primitive, all five.

### Scheduling question

One, on schedule rather than design. Ruling 12 says the build starts when the
loop bar is met. Under the author's principle of going straight to the ideal
in a fast-moving moment, the orchestrator recommends starting **lane O1 now**:
it is server-side Rust and compiler work that does not compete with the loop
bar's client-facing lanes, and its first landing — the frozen envelope — is
what everything else waits on. O2 and O4 keep their dates from `T`. This
changes ruling 12's start and is the author's to make.

The three questions of revision (b) are closed by the author's principle:
ruling 8 stands (§5); trace-validated OCC ships (§7); the twin is the client
and the bar has an acceptance only it can pass (§6, §12).
