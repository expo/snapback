# LLP 3000: Snapback 4 — the decided-substrates candidate

**Type:** Explainer
**Status:** Active
**Role:** Root of the Snapback 4 corpus (LLPs 3000 and up)
**Systems:** Everything under `snapback4/` once it exists; the bakeoff protocol shared with Snapback 3 (LLP 2000) and Snapback 2 (LLP 1000)
**Author:** Charlie Cheever / Claude Fable 5.1
**Date:** 2026-09-12
**Revised:** 2026-09-14 (§7: bounded HTTP query reader reuse and signal-stack diagnostics); 2026-09-13 (§7: ruling 15 — LLP 3000.007 §8.7 and §5.9 as revised are built); 2026-09-13 (§7: LLP 3000.007 accepted as ruled — every §14 question; the blind review of write authority commissioned; `sql` a fifth verb); 2026-09-13 (§7: the first ruling on LLP 3000.007 — the SDK media cache lands with the language); 2026-09-13 (§7: LLP 3000.007 rev 2 — pushed further after the Grok and Muse lanes; LLP 3000.006 absorbed and superseded); 2026-09-13 (§7: relaxed Quarry and explicit residency proposed in LLP 3000.007); 2026-09-13 (§7: explicit data residency and server execution proposed in LLP 3000.006); 2026-09-13 (§7: qualified packaged SQLite page-cache policy); 2026-09-13 (ticket repair qualification: logical device expiry and generation-bound native cache); 2026-09-13 (§7: SQLite plan reuse across bound inputs); 2026-09-13 (§7 and §9: security boundary and remediation); 2026-09-13 (§7: the device-side twin — native reads, LLP 3000.005 §9); 2026-09-13 (search, effects, services, presence, the ranked feed: §7, §8); 2026-09-13 (§7: production compiler trade); 2026-09-13 (§7: native jobs — the app's Rust in the data plane, hosted as wasm, metered like a job; §8: LLP 3000.005); 2026-09-13 (§7: the guide is compiled); 2026-09-13 (§7: explicit reference-ID semantics; remaining open-ticket corrections); 2026-09-13 (§7: borrowed query serialization, shared chat observations and HTTP worker reservation); 2026-09-13 (§9: implementation of the review corrections); 2026-09-12 (§9: architecture review and 37 correction tickets); 2026-09-13 (§7: feeds — the serving half is the substrate's, the model half is the app's; LLP 3000.004); 2026-09-13 (§7: one interpreter hosted two ways, the wasm measurement, ordered merge heads and measured performance work); 2026-09-12 (§8: the full-brief Clique record, 0.1.1–0.1.9); 2026-09-12 (§7: expiry as a lifetime, one asset one home, jobs as sweeps and schedules as boundaries; §8: 0.1.0, the whole brief); 2026-09-12 (§8: the local-first tier, H0); 2026-09-12 (§7: Quarry in Rust, one key encoding, sync forms, operation names; §8: the week-two day-one map); 2026-09-12 (§8: the week-one implementation map);  2026-09-12 (§7: toolchain, simulator host, the clock's commit); 2026-09-12 (initial: the author's decisions of 2026-09-12, the bet on one page, the bakeoff protocol, the fence, the first four weeks)
**Related:** [LLP 2000](./2000-snapback3.rfc.md) (Snapback 3, the sibling candidate), [LLP 2000.000](./2000.000-keep-the-core-flip-two-substrates.rfc.md) (the design brief this corpus builds), [LLP 1000](./1000-snapback2.explainer.md) (Snapback 2, the incumbent and the control), LLP 0000, LLP 0329, LLP 0329.014.004, LLP 0329.016, LLP 1001, LLP 1002, LLP 1012, LLP 1016, LLP 1019, LLP 1020, [LLP 1023](./1023-clique-builder-jump.rfc.md), [LLP 3000.004](./3000.004-feeds-and-the-interview-reference-app.rfc.md) (feeds; Interview as the second reference application), [LLP 3000.005](./3000.005-native-jobs.rfc.md) (native jobs), [LLP 3000.006](./3000.006-explicit-data-residency-and-server-execution.rfc.md) (explicit online-only data, execution classification and synced projections), [LLP 3000.007](./3000.007-relaxed-quarry-and-explicit-residency.rfc.md) (relaxed Quarry and explicit residency: the language's constraints re-derived under the meter), `rules/RULES.md`, `rules/NOT-DOING.md`, [`benchmarks/protocol.md`](../benchmarks/protocol.md), [`benchmarks/briefs/social-messenger.md`](../benchmarks/briefs/social-messenger.md), [`benchmarks/briefs/messaging-day2-evolution.md`](../benchmarks/briefs/messaging-day2-evolution.md)

## Summary

Snapback 4 is one of two parallel candidates for the successor to Snapback 2,
and the sibling of Snapback 3, not its successor. It builds
[LLP 2000.000](./2000.000-keep-the-core-flip-two-substrates.rfc.md) as
written: the Snapback 2 core kept verbatim, two substrates flipped up front —
resources metered at runtime instead of priced statically, and a client that
replicates the viewer's declared partition instead of caching receipted
results — proved first on the hub fixture, with a deterministic simulator as
the primary harness. Snapback 3 ([LLP 2000](./2000-snapback3.rfc.md), led by
Codex / GPT-6 Astra) keeps the same two questions open and discovers their
answers in its first slice. Snapback 2 ([LLP 1000](./1000-snapback2.explainer.md))
continues as the incumbent and the control. All three are judged by one
pre-registered comparison on one clock.

This document records the author's decisions of 2026-09-12 that created the
track, restates the bet on one page so a reader can orient without the brief,
fixes the bakeoff protocol, draws the fence, and plans the first four weeks.
The design argument and its evidence stay in LLP 2000.000. Only running code
will bind (`rules/RULES.md`).

## 1. Decisions (author, 2026-09-12)

On 2026-09-12 Charlie Cheever asked whether Claude Fable 5.1 should lead a
Snapback 4 while Codex / GPT-6 Astra leads Snapback 3 and Snapback 2
continues, "and see which one turns out best." The lead answered yes with
conditions; the author accepted them ("Sounds good") and asked for this
document. The decisions below are therefore the lead's proposal as accepted
by the author. Where the author has not separately ruled, the text says so.

1. **Three tracks, one comparison.** Snapback 2 continues as the incumbent
   and the control. Snapback 3 builds LLP 2000; Snapback 4 builds LLP
   2000.000. This is a bakeoff of *bets* — discover the substrates in the
   slice versus decide them first — not of models. The result will say more
   about the bets than about the leads, and §3 is written so that it can.
2. **The name is Snapback 4.** Siblings, not a sequence: "4" does not mean
   "after 3." A separate number gives the track its own corpus root,
   directory, package identity and data directory with no rename when the
   bakeoff resolves, and files never move in LLP. If Snapback 4 loses, it is
   a number that never shipped. "Snapback 3b" was considered and rejected:
   it reads as a variant of 3, and this is a different bet.
3. **Snapback 4 builds LLP 2000.000 as written.** Its §14 open questions are
   the lead's to decide inside the track, recorded in §7 as they are
   decided. The author rules on the bar, the comparison and promotion (§3).
4. **One owner on the core.** The lead writes the engine, the store and the
   client contract. Codex lanes build the fixture generator, the reference
   applications, the device witnesses and the periphery. Blind reviews from
   two model families are reserved for the two disclosure-sensitive
   mechanisms: partition inversion of read rules (LLP 2000.000 §7.1) and
   the meter's cut behaviour on non-uniform scans (LLP 2000.000 §6). This
   departs from the standing rule that Codex codes and Claude orchestrates,
   deliberately, for the core only.
5. **The clock is four weeks** from the first commit under `snapback4/` to
   the first slice running on the hub fixture. At the clock the author kills
   the track, merges its substrates into a survivor, or continues it. There
   is no third month without a ruling.
6. **Shared and not shared.** Shared with Snapback 3: the LLP corpus, the
   Clique harness and scorers, the fixtures, the briefs, and the simulator
   once either track has one. Not shared: code, except the Snapback 2 pieces
   both are expected to copy (LLP 2000.000 §5.1).
7. **Snapback 2 keeps shipping and freezes new substrate work for the
   duration.** Fix-forward, the loop bar, acquisition and papercuts continue;
   no new certificate axes, client custody mechanisms or ceiling changes.
   This is accepted here as a condition of the bakeoff. Making it binding on
   concurrent Snapback 2 sessions needs one line in `rules/NOT-DOING.md`'s
   Moves ledger, which this document does not write.
8. **Reading load.** This root, updated in place, and one append-only
   journal, `snapback4/JOURNAL.md`. Sub-LLPs only for a decision that must
   outlive the journal. No panels beyond decision 4's two reviews.

## 2. The bet on one page

**Keep verbatim from Snapback 2** (LLP 2000.000 §5.1): the rule language
with its uniformity and hoist analysis, `decided_true` and the
structural-fact refusals; one data language, Quarry, with `--` comments,
`require … else CODE`, `shape`, `merge`, `walk`, `chunk`; the value model
and its conformance corpus; typed read and write states with no silent state
and the refusal envelope `{code, family, site, message, rewrite, guide}`; the
successor classifier (widening additive, checked narrowing, exact projection
ownership); `deliver`'s engine-computed audience, tombstones and
`bootstrap`; `schedule`, `job`, `chunk` and rehearsal; personas; `init`,
`dev`, `check`, `doctor`, `run`, `test`, `why`, `trace`, `guide`; H0
`deploy`, `rollback`, `secret`; channels; assets; the word-prefix index.

**Flip 1 — certify authorization, meter resources** (LLP 2000.000 §6). The
certificate keeps every read site's shape, uniformity, completeness class
and prediction eligibility, and stops pricing bytes and steps. A
deterministic meter charges examined rows, index entries, rule probes,
steps, heap, output and rows written as the program runs, on the server and
in the client interpreter alike. A query cut by the meter returns `capped`
with no continuation past the cut, the same observable outcome as a static
ceiling cut today; a mutation aborts with `E_BOUND` naming actual work; a
job is chunked. `check --cost` prints the structural cost class; `test`
prints measured meters on the hub fixture.

**Flip 2 — the viewer's partition is the unit of sync** (LLP 2000.000 §7).
`sync to <audience> last N by <index>` on a table makes the engine maintain,
per principal, the rows that principal may read, as a change log with a
horizon; a table without the word is online-only, and `check` says which
rule term prevented inversion. The client holds a replica of its partitions,
one watermark each, a durable outbox with client-minted ids, and the
interpreter; queries run locally and are `complete` inside the horizon.
Revocation is a scope tombstone; `until-revoked` and `delivered-history`
survive as the client's leave policy. Two client tiers — online-only
without a store, local-first with one — share one language and one server.

**The vocabulary is fixed before the mechanism** (LLP 2000.000 §8):

```ts
type Read<T> = { data: T; complete: boolean; fresh: boolean; since?: number; next?: Cursor }
            | { loading: true } | { denied: Refusal };
row.pending: boolean;
type Write = { state: "pending" } | { state: "sent"; seq: number } | { state: "failed"; why: Refusal };
type Link = "online" | "offline" | "signed-out";
```

A screen that needs a word not on that card is a defect in the mechanism,
not a gap in the card.

**The hub comes first** (LLP 2000.000 §11): the Clique generator's `u0001`
with 1,000 memberships, `u0500` with 500 follows, and about 100,000
messages are the first fixture; day-two changes are designed before the
day-one screen; the native client is in slice one; physical floors are
measured before targets; the simulator is the primary harness.

## 3. The bakeoff protocol

Shared with Snapback 3; LLP 2000 or a sibling record should adopt the same
text so that the two tracks are measured by one instrument.

**Brief.** [`benchmarks/briefs/social-messenger.md`](../benchmarks/briefs/social-messenger.md)
(Clique) M1–M8, plus
[`benchmarks/briefs/messaging-day2-evolution.md`](../benchmarks/briefs/messaging-day2-evolution.md).
The field-work application (LLP 2000 §4) tests generality after the first
slice, on whichever tracks survive the clock.

**Fixture.** The Clique generator at the instrument freeze LLP 1023 and
LLP 1024 record (`f40559f37722c79178be664a11f8a6485f1508fd`): hub `u0001`
with 100 groups and 900 DMs, `u0500` with 500 follows, and the 100,015
messages of the retained 0.0.25 replay database. The same fixture for every
track and for the control.

**Harness and judge.** [`benchmarks/protocol.md`](../benchmarks/protocol.md);
the same three scorers as the 2026-09-05 run (gpt-6-astra, grok-4.6,
muse-spark); Convex as the control arm; published packages; fresh cold
agents with only the installed package and the task. Neither lead runs the
comparison or grades their own track. The author rules on the numbers.

**Decision rule, pre-registered.**

| Gate | Threshold | How measured |
| --- | --- | --- |
| Loop bar | Fresh agent, published package, reduced Clique M1–M3, ≤ 1,200 s, ≤ 1 Snapback-attributed correction loop, N ≥ 3 | The existing loop-bar protocol (`rules/NOT-DOING.md` §"The bars") |
| Hub acquisition | Full durable content plus first offline thread and search on `u0001`, within 2× the measured physical floor | Floors recorded in the journal in week 1 (§5); the same script on every track |
| Client bytes | Online tier ≤ Convex's shipped React client; the local-first tier's JavaScript ≤ PowerSync's shipped web client, with the wasm device measured beside it and its own budget set by the diet (§7, 2026-09-13: one implementation) | Measured on one pinned toolchain, recorded once in the journal, never assumed |
| Scenarios | LLP 2000 §4's six scenarios green under the simulator on the hub fixture; LLP 2000 §10's outcomes 1–5 and LLP 2000.000 §11's 6–7 | The simulator run record plus the device witnesses |
| Interaction budgets | LLP 2000 §7's targets | Recorded beside the gates; descriptive, not gating, in slice one |
| Holistic score | Three-scorer Clique score with the Convex control | Reported; descriptive, not gating |

A track that passes every gate is a candidate for promotion. A track that
fails the loop bar or acquisition is killed at the clock unless the author
rules otherwise. A mixed result names the gains and the remaining costs, and
the author decides which substrates move into a survivor — which may be
Snapback 2 (LLP 2000.000 §13).

**Clock and checkpoints.** Week 1: floors, experience prototype, simulator
skeleton, first publish. Week 2: server core, partition stream, meter,
simulator invariants. Week 3: web replica, outbox, local queries, the chat
app on the real client. Week 4: Expo, day-two scenarios, deploy, the loop
bar, the Clique hub run, the comparison record. Four weeks from the first
commit.

## 4. Fence, numbering, routing

- **Directory.** `snapback4/`, with its own Cargo workspace and Bun
  workspace, excluded from the root workspace as `snapback2/` is. No
  Snapback 1 or Snapback 2 gate, inventory, backstop, registry or script
  applies; the pre-push hook selects none.
- **Identities.** Binary and npm shim `snapback4`; data directory
  `.snapback4/`; ephemeral ports; its own personas, credentials and process
  ownership. It never depends at runtime on Snapback 2 internals. It copies
  source deliberately, split under the 1,500-line cap on the way in.
- **Numbering.** LLPs 3000 and up; sub-LLPs `3000.NNN`; `llp-create
  --under 3000`. The 2000 series remains Snapback 3's and the 1000 series
  Snapback 2's. Design work for Snapback 4 extends this root or LLP 2000.000
  before it creates a new number.
- **Rules.** `rules/RULES.md` binds "LLPs numbered 1000 and up" by its
  letter, as LLP 2000 §9 noted for its own series. Snapback 4 adopts its
  budgets and loop shape as its own: five blocking checks in sixty seconds,
  `check` under a second, `doctor` under half a second, 1,500 lines per
  file, a bounded working set, delete rather than deprecate, only
  implemented specs bind. Its not-doing list is `snapback4/NOT-DOING.md`,
  written with the directory. The root `AGENTS.md`/`CLAUDE.md` routing line
  and the rules fence note land with the directory, not with this document.
- **Publication.** From week one, `0.0.x`, one script; the benchmark runs
  the published pin.

## 5. The first four weeks

**Week 1 — before any engine.**

- The index-card client API as TypeScript types, and the chat reference
  application written against it with a mocked client; mocks labelled.
- The hub fixture generator, copied from the Clique instrument.
- Five floor measurements recorded in the journal: one gzipped HTTP response
  of 10,000 rows; one IndexedDB transaction writing 10,000 rows; one
  `expo-sqlite` bulk insert of 10,000 rows; a local query over 100,000 rows
  in the TypeScript interpreter and in SQLite; a 50-member send's partition
  fan-out on the server.
- The simulator skeleton: a single-threaded scheduler, a virtual clock, an
  in-process server and N clients, and fault injection (drop, reorder,
  duplicate and delay; failed `fsync`; kill at any await; clock skew).
- The Snapback 2 pieces copied in: rule analysis, Quarry front end, value
  model and corpus, successor classifier.
- 0.0.1 published by day five, even if it serves one query.

**Week 2 — server.** SQLite transaction and interpreter; rules and
uniformity; the meter; the partition log with `sync`, `bootstrap`,
tombstones and receipts, generalised from `deliver`; generations; personas;
the wire with typed states; `check`, `dev`, `run`, `test`, `why`, `guide`;
the seven simulator invariants (§6) running on every commit.

**Week 3 — web client.** The replica store on IndexedDB; the outbox with
client-minted ids; the local interpreter; reactive local queries; the
online-only tier; the chat application on the real client; the Chromium
witness for the boundaries the simulator cannot reach.

**Week 4 — native, day two, comparison.** The Expo client on native SQLite,
with the Rust-core-as-native-module measurement (LLP 2000.000 §9); the
day-two scenarios (additive, widening, narrowing, rule change, rename, each
with a queued write and an old client attached); H0 deploy, rollback and
secrets copied; the loop bar run; the Clique hub run; the comparison record.

The journal records what actually happened against this plan. This section
is not rewritten to match it.

## 6. The simulator's invariants

Pinned here so that no slice can drop one quietly.

1. No silent state: every read is complete, capped, partial or denied;
   every write is pending, sent or failed.
2. A row revoked at sequence S never renders on a client whose watermark
   has passed S.
3. A write with a given id applies at most once.
4. Every prediction converges to the server's state or to a typed conflict.
5. Every screen state is on the card (§2).
6. Watermarks are monotone per partition.
7. After faults stop, every client converges.

## 7. Decisions during execution

Recorded here, dated, as they are made. The provisional answers carried from
LLP 2000.000 §14 until the lead rules: `sync` is explicit, not the default;
a count horizon is required and a time horizon optional; the online-only
tier ships in slice one as the control for every local-first measurement;
the native-module decision follows the week-1 measurement; the effects host
is measured on the four reference effects before it is chosen; ids are a
time-ordered 128-bit form.

- **2026-09-12 — toolchain (author).** `tsc` for typechecking; `rolldown`
  for bundles and the client byte measurement; `oxc` for transforms and
  minification; esbuild only with a reason written in the journal first.
  Snapback 2's measurements are pinned to esbuild 0.25.9 and are therefore
  not byte-comparable with Snapback 4's; the competitor anchors in §3 are
  measured with Snapback 4's own pinned toolchain.
- **2026-09-12 — the simulator is Rust (lead).** `crates/snapback4-sim`
  hosts the Rust server core from week 2. Whether it hosts the client
  through a Rust client core or through an embedded JS engine running the
  TypeScript client is decided with the week-3 byte measurement
  (LLP 2000.000 §9); until then the client is exercised by the simulator's
  witnesses only where its logic is shared with the server.
- **2026-09-12 — the clock started** at the fence commit `961a3eb1c5`.
- **2026-09-12 — Quarry is bound in Rust (lead).** Snapback 2 lowers Quarry
  in a TypeScript worker the binary spawns; Snapback 4 ports the lexer and
  parser and binds to the IR in `crates/snapback4-lang`, so `check` needs no
  other runtime, the simulator compiles programs, and one front end serves
  every host. The IR and value model stay Snapback 2's serialized forms so
  the corpus binds both.
- **2026-09-12 — one key encoding (lead).** Index keys are one
  order-preserving byte encoding of the value model's order, in SQLite now
  and in IndexedDB in week 3, so a device scans the same bytes in the same
  order as the server.
- **2026-09-12 — `sync` forms (lead).** `sync public`, `sync to .column`,
  `sync to target[.prefix]`, each with an optional `last N by index`
  horizon; the read rule must carry the matching disjunct; a `maintain`
  grouped by the audience inherits it. LLP 2000.000 §14's questions 1 and 2
  are thereby answered: explicit, count horizon optional per table.
- **2026-09-12 — operation names (lead).** Operations in `schema.q` are bare
  (`api.thread`); operations in `snapback/<module>.q` are `<module>.<name>`
  (`api.feed.home`). Generated types are built into
  `snapback/generated/api.ts` by `check` and `dev`, never committed.

- **2026-09-12 — delivery is bound to the rule's probe (lead, after the
  partition review).** `sync to target[.prefix]` is sound only when the
  table's read rule is exactly `exists target[.prefix, viewer]` (a second
  disjunct or a conjunct is refused with the rewrite) and the audience
  index is unique; the partition log delivers by that probe's index and
  never by a mapping reconstructed from column names or types; principal
  partitions are tagged so no principal's name collides with `public`; a
  commit is delivered whole however large; a grant that ends inside its
  own commit delivers nothing; a delivered aggregate's audience is its
  source's. Horizons bound acquisition, not holdings: a device holds what
  was delivered, and a local read past the horizon says `complete: false`.
- **2026-09-12 — completeness is a class, not a count (lead, after the
  meter review).** As Snapback 2 (LLP 1001 §3): a query with a scan the
  prefix does not decide is `complete: false` whatever the meter found,
  and a capped page's `next` continues from its last visible row or ends
  on an empty page; the meter's numbers, its cut site and a refusal's
  count stay off the viewer wire; a hidden row costs what a miss costs and
  a hoisted-false range what an empty one costs. The device runs the same
  hoist; its `complete` speaks of the horizon and the meter alone, since a
  device holds only its partition.

- **2026-09-12 — the log is keyed by group (lead, after the Snapback 2 run
  report).** A target audience's events are logged once under the group;
  a device's stream merges its own partition, the public one, and every
  group it held over the interval it held it, expanding a `join` to the
  group's rows when streamed. Storage and write cost are one event per row
  change however many recipients; the per-recipient fan-out that cost
  Snapback 2 its 5.2 GB is not reproduced.

- **2026-09-12 — the device does not re-judge its partition (lead, after
  the Clique lane's M3).** A synced table's rows reach a device under the
  read rule and leave it on revocation, so the device runs no read rule on
  them; what `retain delivered-history` keeps after a leave is readable
  there through a query without a membership `require`, while the server
  refuses that query. The device's read-rule hoist applies to online-only
  tables alone.

- **2026-09-12 — a row's life ends by `expire at .col`, not by a rule
  (lead, after the author moved the struck brief onto the doing-list).** A
  rule that varies with time is no audience a partition can hold; a
  lifetime is a fact of the row. A row past its `expire` column is absent
  to every reader on every host from that moment, before any rule; the
  server's sweep deletes it and the log carries the deletion; a null time
  never expires; the device filters on its own clock while the server's
  word is authoritative.
- **2026-09-12 — one asset, one home; serving is the home row's read rule
  (lead).** An upload is the uploader's until a row's `image`/`video`
  column claims it, once; the row carries the facts the server sniffed,
  never the client's; the bytes are served to a viewer the home row's
  read rule admits on the row as it stands, and to nobody once the row
  is deleted, the column cleared, or the row expired; `once` is one view
  per principal, never cached. Hidden, released and absent are one word.
- **2026-09-12 — jobs are sweeps, schedules are boundaries (lead, LLP
  1016 §4 carried).** A chunk is one page per commit with its cursor, as
  the system principal, over an index whose columns cannot move; a
  schedule fires once per period boundary of the server's clock, the
  boundary committed with the job row, so restarts never double-fire and
  a schedule first seen starts from its next boundary. No client calls a
  job.

- **2026-09-13 — one interpreter, hosted two ways (lead, after the author
  asked for a native Rust module for Expo and Exact2).** The core's
  interpreter runs over a `Rows` trait; with the `sqlite` feature off it
  compiles to wasm. Measured on the pinned toolchain: the device core as
  wasm is 194,465 B gzip (680,459 raw) against 7,067 B for the TypeScript
  interpreter and 16,842 B for the whole local-first TypeScript tier, nine
  times the Convex anchor of §3. So the web keeps the TypeScript twin, held
  to the Rust interpreter by the key and cursor vectors, the corpus and
  the device tests; and the Rust core is the native module on hosts where
  SQLite is native and bytes are a library — Expo, and Exact2's Apple and
  Linux hosts — owning the store, the stream's application, the outbox,
  queries and predictions, with the JavaScript client reduced to session,
  link and transport. The conformance obligation between the two
  interpreters is then the web's alone.

  Native prediction reads remove the device-owned `pending` field before
  passing rows into the shared mutation interpreter; query reads still expose
  it on the card. This applies to primary-key reads, indexed lookups and scans,
  including replay after offline reopen. Application-row validation remains
  strict: neither `pending` nor another undeclared user field becomes a schema
  column. The profile/vote regression fixture exercises repeated updates and
  upserts, maintained totals, durable queue order and authoritative replacement
  on both client tiers (`snapback4-device/tests/native.rs` and
  `packages/snapback4/test/client-lifecycle.test.mjs`).

- **2026-09-13 — wide uniform merges read heads (performance work).**
  A merge without per-lane setup, whose lane rules are uniform and whose
  index ends in `id` or is unique over required columns, keeps one ordered
  head per lane and advances only the winning lane. At eight lanes or fewer
  it buffers a page per lane to avoid a SQLite call per returned row. Lane
  discovery, lookahead, expired rows, duplicate rows and rule probes remain
  metered; no ceiling changes. Non-uniform lanes, lane setup and indexes
  without a safe resume position keep their existing scan order. Nullable
  unique keys are not resume positions: uniqueness allows repeated nulls.
  The Rust and device interpreters share this strategy and retain cursor
  scope checks, deduplication and typed caps. A local page that reaches an
  exhausted horizon still reports incomplete. The SQLite server and Node
  replica also reuse prepared SQL statements; data and results are never
  cached by this change. `scripts/measure-storage.mjs --workloads` records
  HTTP and replica measurements with artifact hashes and result completeness;
  these are within-Snapback observations, not a competitor performance claim.

- **2026-09-13 — reuse SQLite plans across bound inputs.**
  Every SQLite store enables the query planner stability guarantee before
  preparing cached store statements, including independent read-only
  connections created for HTTP queries and sync. This setting belongs to
  each connection; a reader cannot inherit it from the writer it detached
  from. The server and native device use fixed
  indexed application reads; rebinding a key or limit must not repeatedly
  compile that statement. With bundled SQLite 3.53.2, the membership diagnostic found one
  automatic reprepare per indexed read even with the statement cache; fresh
  statements prepared with QPSG eliminated these recompiles. Setting the
  option after caching statements is insufficient because existing VDBEs
  retain their parameter-expiry masks. SQLite schema changes still invalidate
  plans; transaction boundaries, activation checks, rules and ceilings remain
  in force. Independent readers retain their current snapshot across a
  concurrent commit and see the new rows in their next transaction. Every
  invocation reads its transaction's rows, with no result or authority
  cache. QPSG trades parameter-sensitive planning for plan reuse, so other SQL
  shapes still need their own measurements. The
  [membership record](../benchmarks/runs/snapback4-public-catalog-20260913/README.md)
  separates direct statement diagnostics from complete-query evidence.

- **2026-09-14 — reuse successful HTTP query readers.**
  The HTTP host retains detached read-only engines after successful queries,
  up to the existing 32-request worker bound. A request checks one out under
  the owning engine's lock and releases both host locks before executing.
  Each query still starts and ends its own activation-checked SQLite
  transaction with the current request's viewer and arguments. Reusing the
  connection preserves prepared statements and page caches; query results
  and authorization decisions are evaluated again. A refused or failed
  query discards its reader. Stores without a detached connection retain
  their existing query path through the owning engine.

  Every successful backend adoption in this host retires idle readers before native
  module installation. This includes native-only edits that retain the same
  schema generation: a pool epoch has its own identity, and a loan from an
  earlier epoch cannot return to the new pool. Already executing reads keep
  their existing transaction semantics. Retained connections consume memory
  between requests; the worker bound limits their count, not their combined
  physical memory. SQLite cache settings, query ceilings and write
  acknowledgements are unchanged. The
  [comparison record](../benchmarks/runs/snapback4-public-catalog-20260913/README.md)
  retains the read improvements, concurrent-write regression and observed
  process memory cost separately from integration qualification.

- **2026-09-14 — signal diagnostics fit the alternate stack.**
  The host's signal handler uses a 256-byte line buffer for its fixed fields;
  ordinary panic, thread and exit diagnostics retain their 4 KiB capacity.
  The main thread's observed alternate signal stack on native x86 Linux is
  8 KiB, shared with the kernel's signal frame. With the previous handler,
  standalone TERM, truncated-mapping BUS and abort probes exited with
  SIGSEGV in both unoptimized and optimized builds. The smaller
  buffer preserves the complete diagnostic and expected signal in all six
  probes. Handler installation, errno restoration, direct writes, atomics
  and worker-cleanup semantics are unchanged; existing lifecycle tests
  continue to require the original OS status and worker cleanup.

- **2026-09-13 — feeds: the serving half is the substrate's, the model half
  is the app's (lead, proposed; [LLP 3000.004](./3000.004-feeds-and-the-interview-reference-app.rfc.md)).**
  A feed's delivery, sync, read state, freshness and bounds are declared on
  tables — a per-reader partition (the `feeds` card), or a shared scored
  partition every device holds plus the viewer's own signals synced to the
  viewer — and scored by a job on a cadence from maintains; candidate
  generation and learned scoring are an external ranker writing through
  mutations under a rule. Ranked and vector search stay after the clock.
  Proven in shape on an Interview sketch compiled and run at 0.1.14 (twelve
  tables, ten operations, the order moving on the cadence). Interview is
  proposed as LLP 2000 §4's second reference application; the author rules
  on the position and the spike.

- **2026-09-13 — JSON HTTP responses are framed before writing.**
  For ordinary prebuffered requests, the server coalesces the already
  materialized JSON response's headers and body. This avoids the separate
  small socket writes that produced long Linux page-read delays. The pinned
  HTTP library may drain an unread streaming request body when its writer is
  extracted, so Expect, Transfer-Encoding, large Content-Length and upgrade
  requests retain the original response-before-drain path. JSON uses one
  additional transient response-sized buffer; asset streaming is unchanged.
  Persistent-connection and early-response tests cover the wire lifecycle.
  The [public-catalog record](../benchmarks/runs/snapback4-public-catalog-20260913/README.md)
  measures this change and current local competitors on identical verified
  data; it is a read microbenchmark, not the independent Clique bakeoff.

- **2026-09-13 — borrow values while encoding query replies.**
  Plain wire JSON can serialize the result's existing value tree directly;
  it need not clone strings and build another map/array tree first. Tagged
  storage and replica forms stay unchanged. The HTTP reply retains the same
  fields, including dependency tables and viewer identity, and excludes private
  meter details. Encoding still stops at the 16 MiB response ceiling through
  the bounded writer. Session resolution, metadata,
  sequence and operation/count reads also reuse the connection's bounded
  prepared-statement cache, rebinding and executing on every invocation.
  Neither change stores query or authorization results. The catalog evidence
  separates isolated encoding cost from end-to-end HTTP latency.

- **2026-09-13 — chat checks share one observation of an event boundary.**
  The four fixed chat invariants do not mutate their hosts. They share one
  fresh diagnostic snapshot per invocation, in the original failure order,
  and preserve the watermark checker's history across events and schema-change
  phases. Authoritative at-most-once counts are still queried on every check.
  Generic simulator invariants retain independent observations; no snapshot
  survives a check or hides an engine change between phases. Fault schedules,
  seeds, timers, persistence, trace payloads and convergence checks are unchanged.

- **2026-09-13 — accepted connections reserve idle HTTP workers.**
  A notified worker remains counted as idle until it reacquires the dispatch
  mutex. The pool must subtract already queued connections before assigning
  another accept to that reported capacity; otherwise long-lived keep-alive
  connections can strand later accepts until a connection closes. The author
  approved a minimal vendored tiny_http 0.12.0 fix, with a deterministic
  old-fail/new-pass witness. Integration extends main's existing vendor copy
  and preserves its bounded unread-body drain. Parsing, framing, authentication and database
  behavior are unchanged. The dependency stays outside workspace membership;
  its library tests run explicitly during qualification. Source and binary
  distributions retain the upstream license notice.

- **2026-09-13 — reference IDs have no implicit foreign-key check (lead).**
  A table reference validates the ID value; insert, update and upsert do
  not read the target, and deleting it neither cascades nor refuses because
  references remain. This preserves the existing value and replica model,
  where a target can be outside the viewer's partition or retained history.
  An operation requiring a visible target says
  `require exists prompts[promptId] else PROMPT_NOT_FOUND`; that explicit
  point read is metered and treats absent and hidden targets alike. It
  establishes visibility at this transaction, not a permanent foreign key.
  The string `"null"` is an ID, distinct from JSON null on an optional type.
  The types/writes cards, E_INPUT explanation and executable regression
  make the policy explicit; LLP 3000.004's recipe uses guards accordingly.
- **2026-09-13 — the guide is compiled (lead, after the author's review
  of the docs against the code).** A guide page can promise what the
  parser refuses; the Clique lane paid for that class four times. So the
  guide is tested text: every ```quarry block on every card and in the
  package README is compiled with no diagnostic and no note by
  `crates/snapback4-lang/tests/guide.rs`, the language card — one file
  exercising every form the parser accepts, then what is left out on
  purpose and the idiom for each — is run against the engine, every
  refusal code the sources emit is one `why` explains, every guide keyword
  a diagnostic carries is a card, and the numbers the cards state are the
  engine's. A form enters the parser and the language card together, or
  the suite is red. Forms the docs promised and the parser refused were
  added (`break`); forms the parser accepted and did nothing with were
  refused with their rewrite (`from` imports, `readable` on a maintain).
- **2026-09-13 — native jobs: the app's Rust in the data plane, hosted as
  wasm, metered like a job (author: "write up an LLP about this and then
  implement"; [LLP 3000.005](./3000.005-native-jobs.rfc.md)).** `job
  name(): native` is a job whose body is the app's crate under
  `snapback/native/`, built to wasm by `check`, hosted by the engine one
  chunk per commit under the job ceilings and a fuel ceiling, its reads
  and writes the interpreter's own so rules' companions and the log apply
  and the ordinary query serves what it wrote; it returns `again` with a
  state of its choosing to be called again after the commit, `done` to
  end; the first refusal parks it, a trap parks it with the panic's text.
  Quarry still declares the table, its rules and its `sync`; the module
  imports one host function and nothing else, so it runs under the
  simulator. Hosted with `wasmi`, optional (an app without the crate never
  pays for it), the guest SDK a path crate until published. Answers LLP
  2000.000 §10's effects-host question for compute over the store only;
  the network stays outside.

- **2026-09-13 — one implementation, in Rust (author ruling, on the lead's
  recommendation).** The author asked whether the TypeScript twin existed
  only because wasm measured larger, and ruled: unify, one implementation
  in Rust. The device (`crates/snapback4-device`) is generic over a
  `DeviceStore` — the core's SQLite on a native host, memory on the web —
  and runs as wasm in the browser over the memory store, reporting each
  commit's changes for the host to persist in IndexedDB behind the call;
  a cold start loads them back. The byte anchor of §3 (the local-first
  tier under Convex's client) is retired as a bar for the web: the wasm
  device measured 312,924 B gzip whole (194,465 as query and predict
  alone), which is the size other local-first stacks ship a database at,
  and a diet follows. Consequences accepted: the web device holds its
  partition in memory, bounded per viewer by sync lines and horizons; a
  tab is a device, and an orphaned tab's queued writes are adopted by the
  next device that opens the store; Expo Go, which loads no native code
  and no wasm under Hermes, runs the online tier. The TypeScript
  interpreter, replica and stores retire once the wasm tier passes the
  Chromium and scale witnesses; the conformance obligation between two
  interpreters ends with them.

- **2026-09-13 — local development is a loopback capability; deployed HTTP
  is private by default (security review).** Development personas and seed
  are admitted only from a loopback peer whose `Host` and optional `Origin`
  are also literal loopback names; CORS reflects only an admitted local
  origin. `serve` binds loopback unless an operator explicitly accepts
  cleartext exposure, and still refuses the development doors. The catalog,
  schema, native module and change feed require a live principal. The host
  authenticates before buffering protected bodies, caps connections, active
  requests, long polls and expensive password or upload work, and gives every
  socket operation a deadline. TLS remains the reverse proxy's job. On Unix,
  store directories are 0700 and database, WAL, shared-memory and asset files
  are 0600; unsupported permission models fail closed.

- **2026-09-13 — sessions are short, rotated credentials (security review).**
  Password hashing runs outside the engine mutex behind a bounded work queue;
  password bodies and attempts per peer and normalized email are bounded, and
  unknown accounts pay the same verification work. Ordinary sessions last
  seven days. Refresh replaces the presented session, logout-all revokes every
  session for its principal, and expired sessions are pruned. Change polls and
  effect claims reauthenticate after waiting before observing or claiming new
  work. The web client
  keeps credentials in memory by default, exposes localStorage only as an
  explicit compatibility store, and refreshes a near-expiry session before it
  becomes unusable.

- **2026-09-13 — hidden rows stay hidden at write and replay boundaries
  (security review).** A unique conflict with a row the caller cannot read is
  the generic rule refusal. Audience insertion is admitted only when the
  caller already has the matching grant; audience keys cannot be changed to
  acquire one. The private mutation log may retain old operator data, but sync
  catch-up re-evaluates the current row and emits only its current readable
  image, or a deletion for a row that disappeared or expired. Previously
  delivered device data remains a property of that device.

- **2026-09-13 — assets are staged, bounded and viewer-private (security
  review).** Server IDs use operating-system or Web Crypto entropy. Upload
  bytes and asset deletion run outside the engine mutex, with bounded slots
  and a generation/session check before commit. A once asset is consumable by
  its placed recipient, while its unplaced uploader retains preview access;
  ranged reads cannot bypass consumption. Image dimensions, total pixels and
  video duration are capped. Unsatisfiable ranges return 416 and every asset
  response is `private, no-store`, so a browser cache cannot cross principals.

- **2026-09-13 — optimize the production server for speed.**
  The production Cargo profile uses optimization level 3 after an
  identical-source comparison with the former size setting. On the recorded
  100,000-row catalog, the speed build has lower median p50 in eight of eight
  HTTP cases and lower p95 in seven; continuation-page p95 worsens. The Linux
  ARM64 executable grows from 3,296,936 B to 5,787,152 B, below the recorded
  PocketBase size anchor. This is a measured trade under shared-host variance,
  not a universal read or platform win. The separate wasm profile and the
  native xcframework build keep size optimization; the ordinary incremental
  release loop is unchanged. The
  [comparison record](../benchmarks/runs/snapback4-public-catalog-20260913/README.md)
  retains all trials, compiler inputs, remaining losses and qualification.

- **2026-09-13 — search is one index shape, one tokenizer, one read
  (lead, after the author asked for what Clique and Interview still
  needed).** `words(cols)` is an index component with one entry per
  distinct folded token and a recorded contract; `matching q` is the only
  read of such an index: the first term's words, found by one seek each
  and bounded, merge as ordered lanes into one page with one cursor,
  further terms filter the page. No relevance ranking, no stemming, no
  phrase or mid-word match. The device runs the same interpreter over the
  same entries, so offline search is the same code, not a second
  implementation.

- **2026-09-13 — the engine never calls out; a worker with a seat does
  (lead).** `emit` keeps the effect in the mutation's commit; a service
  principal claims it under a lease over the wire, performs it, settles
  it; failures back off to a bound; leases expire back to the queue. The
  "embedded JS engine for effects, until measured" question of LLP
  2000.000 §10 is decided against: JavaScript stays out of the process.

- **2026-09-13 — services and custom sessions (lead).** `service:<name>`
  is a principal with its own session, admitted by rules by name; it
  mints and revokes sessions for accounts the application authenticated
  itself, outside the engine's namespaces. The engine is not an identity
  provider; the application's worker is.

- **2026-09-13 — presence is the server's own knowledge (lead).**
  `connected[p]` counts a principal's open long polls (and a grace after
  one answered); it is not a table and syncs nothing. A device does not
  know and says so: a query is `complete: false`, a prediction reads
  everyone as connected and the server decides.

- **2026-09-13 — the ranked feed is on the card (lead; LLP 3000.004 §9
  decision 3 taken as "now").** Shape 4.2 — a shared scored partition, the
  viewer's own signals, an external ranker through a service seat — is
  compiled and run beside the fan-out recipe, and the fan-out recipe is
  measured at the brief's probe: 500 follows examine what 5 examine.

- **2026-09-13 — remaining-ticket corrections (lead).** A partition stream
  reconstructs membership through one transaction head, batches its
  authorized intervals, and expands join candidates from images at that commit,
  including intervals closed by a later leave. The later security ruling below
  screens those candidates against current row visibility before delivery.
  A durable internal collection reservation blocks reclamation before file
  removal leaves the engine mutex; ordinary release remains reclaimable.
  Detached read owners keep
  the same catalog/generation identity without reserving the writer.
  Acquisition counts live rows; internal continuations retain the stored
  id. Schedule boundaries are monotone and shape changes start at the next
  boundary. Released asset bytes may be reclaimed until collection reserves them; a
  view-once grant is consumed only after the host successfully sends its
  full response. Viewer changes and terminal write settlements have client
  subscriptions, and reads carry their next visible expiry for invalidation.

- **2026-09-13 — logical lifetimes and stream history.** Membership grants
  carry their expiry in the internal ledger; a stream filters each authorized
  interval by the commit timestamp as well as its join/leave sequences;
  serving also enforces the current visibility boundary described below.
  Renewing the lifetime creates a new interval. Legacy expiring grants whose
  lifetime cannot be recovered authorize no history. Snapshot, constraints
  and maintained reads treat expired rows as absent before the physical sweep;
  the simulator supplies its virtual clock explicitly. Local reads whose
  maintained source is not fully held count live held rows and remain
  incomplete; they do not present the stored global count as current. An
  until-revoked device read rechecks an expiring audience on its local clock
  and reports the next lifetime boundary; delivered history retains its
  policy. Drained catch-up emits a scope for an expired open grant, even when
  no new commit advanced the watermark. Source and target
  rebuild buffers are paged; retained aggregate state still scales with the
  number of groups. The client observes auth and terminal mutation changes,
  and visible-query lifetimes schedule reruns even on an idle commit stream.

- **2026-09-13 — expiry review corrections.** A replacement membership
  opens its own interval even before an expired predecessor is swept; sweeping
  that predecessor does not revoke a still-live replacement. Catch-up across
  an expired grant resets its until-revoked group before acquiring the new
  grant, so deletions during the gap cannot leave stale held rows. A renewal
  before expiry keeps the acquired horizon. An expiring
  maintained sum keeps a physical zero candidate while its source group has
  rows, because later logical expiry can make the live sum nonzero. Opening an
  older server store backfills these candidates once, from its stored backend,
  in a logged transaction. Reads recompute live contributions under the meter;
  capped points and scans return contributions examined so far with incomplete
  coverage, and a capped nonempty scan resumes after its last returned row.
  Fully held device scans still use horizon and meter for completeness while
  rechecking expiring audiences. Paged snapshots recheck authority on each
  page: their watermark pins catch-up, not membership across the acquisition.
  Delivered history retains rows already delivered; a membership expiring
  between pages does not entitle the device to acquire the remaining rows.

- **2026-09-13 — the device-side twin: native reads (author: "seems like
  device-side twin over the same Rows trait is the next native-module
  step"; [LLP 3000.005 §9](./3000.005-native-jobs.rfc.md)).** `query
  name(args): native` runs the app's module on the server as the viewer,
  every read under the viewer's rules and the read meter, and on a native
  device over the rows it holds with the device's words; the client fetches
  the module from `/native.wasm` once per digest and the device keeps it
  for a cold start offline; `wasmi` is built deterministic so the same rows
  give the same answer. Proven: the server's answer and both device
  stores' are byte-equal on the fixture's personalizer. The web device
  carries no host — with one its wasm doubled to 648 KB gzip — and asks
  the server; a mutation cannot be native.

- **2026-09-13 — qualified packaged SQLite page-cache policy.**
  The publisher supplies
  `LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT` to both its full
  qualification suite and production Cargo build, replacing any inherited
  value for that build input. It records the input beside the packed CLI's
  digest and Cargo profile. The installed-consumer digest check and refusal
  on a red suite remain in force. An inherited `SNAPBACK4_BIN` cannot divert
  the publication suite's HTTP/device tests to a different executable.

  The bundled SQLite dependency normally enables a single page-cache
  recycling group across connections. Its global LRU mutex was prominent
  in the eight-request membership-feed diagnostic. Removing this compile
  option selects independent recycling groups in the current thread-safe
  SQLite build. This changes neither the configured page-cache size nor
  thread safety, QPSG, SQL shapes, authorization, transaction/activation
  boundaries, on-disk format, WAL policy or application ceilings. It does
  give up recycling spare pages across connections and makes the global
  `sqlite3_release_memory` call a no-op; per-connection reclamation remains
  available. The current Snapback runtime makes no direct global
  release-memory or custom page-cache/heap-limit calls. Memory use under
  pressure is a separate tradeoff, not a result of the latency experiment.

  This policy covers the packaged CLI's bundled SQLite paths, including
  the `device` RPC used by Node's `processDevice`. Qualification retains
  native SQLite/device tests and the real native process client. The wasm
  device uses the memory store and contains no SQLite. Separately invoked
  developer and xcframework builds retain their own build inputs; invoking
  a fresh ordinary Cargo build without this variable restores the
  dependency's ordinary policy. Merely running an executable left by the
  publisher does not rebuild it.

  A matching standalone CLI build, from `snapback4/`, uses the qualified
  source/toolchain with:

  ```sh
  LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT cargo build --locked --profile production -p snapback4
  ```

  The variable is a build input and is unnecessary at runtime. The
  [membership record](../benchmarks/runs/snapback4-public-catalog-20260913/README.md)
  binds the separate diagnostic, isolated HTTP experiment, and publication
  receipts; a matching option alone does not establish exact artifact or
  workload equivalence. The existing store regression checks the linked
  SQLite options when built with the publisher's input, before exercising
  plan rebinding, changed rows and schema invalidation.

- **2026-09-13 — explicit data residency is the proposed escape hatch,
  not an untyped server side channel (author question; draft in
  [LLP 3000.006](./3000.006-explicit-data-residency-and-server-execution.rfc.md)).**
  Snapback 4 already makes `sync` opt-in: a table without it is online-only,
  and rows beyond a horizon remain readable from the server. The proposed
  ergonomic refinement makes that choice explicit in source, classifies every
  query and mutation by where it can run, gives a fully server-dependent read
  a typed offline outcome rather than plausible empty data, and makes a
  compact synced projection the ordinary answer to a large or sensitive
  server-only source. It preserves rules, metering, types and transactions;
  it does not introduce arbitrary code or a second API plane. The RFC remains
  Draft and this paragraph records direction, not implementation or acceptance.

- **2026-09-13 — relaxed Quarry and explicit residency (the author's
  thesis after building Clique; proposed in
  [LLP 3000.007](./3000.007-relaxed-quarry-and-explicit-residency.rfc.md)).**
  The author observed that Quarry is "great except too constraining," that
  its value is one language over data synced locally and in the cloud, and
  that without that need Convex or Supabase looked easier for agents. The
  analysis of the four Snapback 4 Clique lanes and the September
  three-backend wave agrees that the language is too constraining and
  disagrees about why: the constraints that cost builders loops — a local
  binds once, no accumulators, no `continue`, no `else if`, no `where`, no
  text `+`, no `/` — are Snapback 2's static pricing carried into the
  binder, not device requirements, and the one interpreter on every host
  already runs the forms the binder refuses (`Assign`, `Push`, `Continue`,
  `Concat`). The proposal finishes the flip LLP 2000.000 §4.1 asked for:
  admit the seven forms everywhere under the meter; compute and print where
  each operation runs and whether each mutation predicts (`check
  --residency`, `api.ts`, `why`, two notes when a class moves); pave the
  online-only mode with `init --online`; close the client seams the lanes
  hit (a mutation's result on the card, `pending` through shapes, the wasm
  persisted by the opener, `dev`'s loopback identity limits); and specify
  SQL reads and worker actions as hatches to rule on after a rerun. Its
  second revision, at the author's request to push further, read the
  Grok and Muse 0.2.6 lanes and found the two frictions that stopped
  the weaker builders were restatements, not program forms: the
  audience spelled twice (rule and `sync`) and counters one principal
  keeps in another's row, refused as hidden collisions until the tables
  were made world-readable. It proposes the audience inferred from the
  read rule, write authority decided by the write rule (through the
  blind security review), helpers with bodies, job preludes, range
  seeks, `group`, defaults, an `upsert` that patches, the guessed
  spellings, `data --sql`, `check --fix`, `init --expo`, and a ceremony
  bar that measures the five shapes every lane paid for. It absorbs
  LLP 3000.006, now Superseded. The author's first ruling on it,
  2026-09-13: the SDK media cache (§8.13) lands with the language. The
  remaining rulings are the next entry.

- **2026-09-13 — LLP 3000.007 is Accepted as ruled (author).** The
  author ruled on every question of its §14: the seven forms and the six
  additions whole, after the meter is made to charge what they allocate,
  with the note that any form found to cause problems can come back out;
  the language stays one spelling — guessed spellings are not admitted,
  the diagnostic names the canonical form and `check --fix` applies it;
  reads inside `where` from the start; the sync audience inferred from
  the read rule; the blind security review commissioned for write
  authority (§8.7) and the non-predicting mutation's page pass (§5.9),
  which land only when it returns; `online only` optional until the
  rerun; `result` on a sent write and nothing else on the card; `dev`'s
  loopback identity limits lifted to what the host can carry; `sql` as a
  fifth named observability verb, with its Moves line in `NOT-DOING.md`;
  worker actions commissioned with the seams, Interview proving them,
  while SQL reads wait for the reporting gap to be measured; LLP 3000.006
  stays superseded; the media cache with the language. The meter (§5.0)
  is the first landing.

- **2026-09-13 — LLP 3000.007's implementation goes to Codex (author:
  "Go. Use Astra on xhigh for coding").** Decision 4's rule that the lead
  session alone writes the engine, the store and the client contract is
  relaxed for this program: Codex (gpt-6-astra, xhigh) implements every
  lane, the lead cuts the lanes by file ownership, reviews each diff, runs
  the blocking suite outside the sandbox and lands. Five lanes run
  concurrently from 2026-09-13: M (the meter, §5.0), L (the language,
  §5.1–§5.8), R (residency and the inferred audience, §6), C (the client
  and dev seams and the media cache, §8.1–§8.6, §8.13), B (the ceremony
  bar's "before" on the published 0.2.8, §10.3). Not yet launched: the
  periphery verbs (`sql`, `check --fix`, `init --online`, `init --expo`),
  worker actions (§9.2, phase C2), and §8.7/§5.9, which wait on the blind
  security review commissioned the same day. The journal carries the
  lane cut and the file ownership.

- **2026-09-13 — ruling 15 (author): write authority is the write rule,
  and the uniform page pass, as revised after the blind review, are
  built.** LLP 3000.007 §15 records both families' findings and the
  narrowed contract: engine-private target resolution, one failure word
  for an unreadable target, the merged image kept in the engine and
  withheld before the at-most-once log records it, no device prediction
  against an unheld target, S05 kept for every other row, and the
  non-predicting pass admitted on uniformly authorized prefixes only.
  The twenty-two regressions the reviewers named are the acceptance, and
  the implementation returns to both reviewers before it lands (option 1
  of the lead's recommendation).

- **2026-09-13 — 0.2.9 published: the language landing is on npm.** The
  pin LLP 3000.007 §10.3 runs on, carrying every lane of the
  implementation program but W (§8.7 and §5.9, in their second blind
  pass): the meter, the bar, `sql` and `check --fix`, residency with the
  inferred sync audience, the client seams and the media cache, the
  language in full, worker actions; `snapback4-expo@0.2.2` beside it. The
  ceremony bar's "after" runs on it; the Clique rerun waits for W. Ruling
  16 (the `Act<R>` card word) is open in §14.

- **2026-09-14 — the second blind pass on §8.7 and §5.9 returns NOT
  READY and READY WITH CHANGES.** LLP 3000.007 §17 records both
  families' findings on lane W's implementation and their dispositions:
  one wrong word (a secondary hidden collision on a readable target is
  `E_RULE`, not `NOT_FOUND`), the absent-target path made one word with
  the hidden path on every branch and every meter field, cap
  diagnostics without values, an exhaustive purity check with a runtime
  write prohibition, a receipt that records the replay-shaped body,
  §5.9 narrowed to plain prefix scans, and one observation helper for
  the acceptance. Three findings are rulings 17 (a)–(c), built
  conservatively by lane W2 until the author relaxes them. The
  implementation returns to both families once more before it lands.

- **2026-09-14 — the third pass on §8.7 and §5.9: NOT READY and READY
  WITH CHANGES, every §17 row built.** What remains is deeper: the meter
  charged before a uniform verdict, resolution work that can abort before
  its one word, an overflow that prints a sum, an explicit asset id as an
  equality probe, and the two conservative rulings running on the hit arm
  only, so an `upsert` reopened an existence bit. LLP 3000.007 §17's
  third-pass table disposes each; lane W3 builds them; the lead's
  recommendation on ruling 17 (a) moves from refusing to ignoring
  immutable columns on an unreadable target.

- **2026-09-14 — the fourth pass on §8.7 and §5.9: Grok READY, GPT NOT
  READY on three narrower corners.** LLP 3000.007 §17's fourth-pass table
  disposes them (a page attempt charged before its verdict; `created`
  with equalities in the reservation; value equalities on a maintain
  over an expiring source refused at `check`); lane W4 builds them and
  the implementation lands on four passes where ruling 15 asked for two,
  with a final GPT-only check against the landed commit.

- **2026-09-14 — write authority landed on four passes; a fifth GPT-only
  check against the landed commit found one channel W4's repair introduced
  (short-circuit probe counts on a denied verdict).** LLP 3000.007 §17
  records it and its fix, a schema-derived probe allowance for the
  verdict; lane W5 builds it forward on main. Published as 0.2.10 with
  `snapback4-expo@0.2.3`; the ceremony bar's third run and the three-model
  Clique cell run on that pin.

- **2026-09-14 — the ceremony bar's third run records lane S's result.**
  On published `snapback4@0.2.10` (with `snapback4-expo@0.2.3`), three
  green and independently reverified: 437/407/419 s, loops 1/2/1 all
  agent-error, nine tables each, and the natural private membership rule
  retained in every run. The before duplicated membership; the after
  made its roster public; the third does neither. LLP 3000.007 §16 and
  its linked record retain the evidence and N = 3 limits; the Clique
  cell and the author's rulings remain pending.

## 8. Implementation map

This section replaces itself as code lands, as LLP 1000's did; the journal
carries the chronology. After week four, 2026-09-12 (0.1.0):

| Piece | What runs | Landed |
| --- | --- | --- |
| `crates/snapback4-core` | the value model and IR (Snapback 2's serialized forms); the schema with `sync` and the leave policy; one order-preserving key encoding; the two-table SQLite store; rule evaluation with `decided_true`/uniform hoisting; the runtime meter with capped reads and aborted writes; the interpreter (points, scans with opaque cursors, merges, walks, writes with unique/cap/immutable/after-insert constraints, maintained aggregates); the partition log (audience inversion, joins expanded when streamed, scope tombstones, snapshot, merged stream); at-most-once mutations by client-minted id, replayed before the current generation judges a resend; generations on adopt; the day-two classifier; the plain-JSON wire forms; after the two blind reviews: tagged partitions, the audience bound to the read rule's probe index, whole commits per page, same-commit grants withdrawn, completeness as a class, meter marks; then the log keyed by group (1.15× the rows at scale). Corpus: 172 pass, 0 fail, 121 skipped by named reason | `b7449cdaac`, `1ff36fe04d`, the reviews landing |
| `crates/snapback4-lang` | the Quarry lexer and parser (ported), the catalog with generated maintain targets, schema binding (rules, probes, constraints, sync with the principal resolved, inherited audiences), program lowering to the IR with typed scope, diagnostics with rewrites and did-you-mean names, the `N_NEVER_COMPLETE` and `N_NO_CURSOR` notes, the TypeScript emitter | `b7449cdaac`, the note landing |
| `loopbar/` | the loop-bar brief (reduced Clique M1–M3, four-part proof) and the serial runner with independent verification → `metrics/loopbar.jsonl`; **the bar met on 0.0.11** (3/3 green in 443–537 s, no attributed loop; record under `benchmarks/runs/2026-09-12-snapback4-loopbar/`) | `11c5202532`, the loop-bar landing |
| `crates/snapback4` | `init`, `check [--cost]`, `dev` (serve + watch + adopt with the day-two class), `run`, `test [--fixture]` (meters beside ceilings), `why`, `guide`, `data`, `doctor`, `deploy`, `rollback`, `serve` (a release, tokens only); the HTTP wire (`/q`, `/m`, `/sync`, `/changes`, `/schema`, `/seed`, `/auth/*`) | `b7449cdaac`, then H0 |
| `crates/snapback4-core/src/identity.rs` | guests and password accounts (argon2id), bearer sessions by digest, logout | `c3f983744a` |
| `llp/reviews/3000-*.md`, `crates/snapback4-sim/tests/reviews.rs` | decision 4's two blind reviews (partition inversion, gpt; the meter's cut, grok), each finding reproduced as a test against the fix | the reviews landing |
| `packages/snapback4/src/local.ts`, `web.ts`, `native.ts`, `backend.ts`, `auth.ts` | the one client over one device interface (`DeviceOpener`: `open(name, backend)` → one JSON call): the session, the link, the transport, the observation of reads; three openers — `webDevice()` (the wasm device, memory with IndexedDB written behind each call, one device per tab, an orphaned tab's queued writes adopted), `nativeDevice` (`snapback4-expo`), `processDevice()` (Node); the TypeScript interpreter, replica and stores retired (the ruling of 2026-09-13); the lifecycle suite runs on both the wasm and the process tier | the one-implementation landing |
| `witness/idb.mjs`, `witness/scale.mjs`, `witness/expo.mjs` | the Chromium witness on the wasm device over IndexedDB; cold sync at scale on it; the simulator witness on the native module in a development build | `c5db8c1585`, `72af994205`, the Expo landing, the one-implementation landing |
| `apps/chat-expo` | the chat app on React Native: the native module in a development build, the online tier in Expo Go (no custom native code, no wasm under Hermes), secure-store session, the same client and generated api | the Expo landing, the one-implementation landing |
| `packages/snapback4-darwin-arm64`, `packages/snapback4/bin` | the binary as an optional dependency of the client package; `npx snapback4` | the Expo landing |
| `crates/snapback4-sim` | seeded scheduler, virtual clock, faulty network and disks, kill/restart, trace digest; the real engine as a host; a replica device with a durable outbox and predictions that survive a re-bootstrap; the chat world under faults with §6's invariants 1, 2, 3, 5, 6 per event and 4, 7 at quiescence; the five day-two scenarios with a partitioned device and queued writes | `1700c1c755`, `b7449cdaac`, `1ff36fe04d` |
| `packages/snapback4` | the card (`contract.ts`), the online-tier client (`client.ts`), the React hooks, the labelled mock; `snapback4@0.0.1` on npm (week one's client only; republish pending) | `39af0c81a6`, this landing |
| `apps/chat` | the reference app on the one client over the wasm device (`webDevice()`), and the generated `api.ts`; `snapback/schema.q` with `sync` lines, `invite`, `leave`, `send`, `edit`, `unsend`, `thread`, `inbox` | this landing; the one-implementation landing |
| `fixtures/`, `floors/`, `corpus/`, `scripts/`, `metrics/` | as week one | `1700c1c755`, `224fb1d24e`, `6bc29eab02` |

| `benchmarks/runs/2026-09-12-snapback4-clique-0002/`, `benchmarks/runs/2026-09-12-snapback4-loopbar/` | the Clique hub run on 0.0.2 (Astra medium, media and scheduled work struck): every milestone green in 7,725 s, graded 69/80 applicable with two majors read against main, M7 green in 917 s; the loop bar met on 0.0.11 (3/3, 443–537 s, no attributed loop); every finding and its fix | the run's landings |

| `crates/snapback4-core/src/assets.rs`, `engine/job.rs`, `crates/snapback4/src/assets.rs` | 0.1.0, the whole brief: `expire at .col` (absent everywhere at once, swept, streamed); assets (sniffed JPEG/PNG/WebP/MP4, one asset one home, served by the home row's read rule, `once`); jobs (`chunk` sweeps, a page per commit with its cursor, parked on refusal) and `schedule … every N [at HH:MM]` (once per boundary across restarts); the maintenance thread; the client's `upload`/`asset`/`assetSource`/`useAsset` | the 0.1.0 landing |

| `benchmarks/runs/2026-09-13-snapback4-clique-0003/` | the Clique hub run on 0.1.0, the whole brief, nothing struck: every milestone green in 7,002 s (M8 at 6,926 s), graded 84/1/16 of 101 (O1 62, O2 48, O4 35, O5 band 30), M7 capability-failure on the app's pre-existing logout crash after delivering its polls and migration; eight fix-forward releases the same night (0.1.1–0.1.8: one thread per request, asset facts on the argument, `a if cond else b`, `sum(page, .x)`, a one-second clock, the paged snapshot with `N_NO_HORIZON`, the outbox in submission order, `N_WIDE_MERGE`); then what the run said to do next: the `feeds` card (fan-out on write, compiled and run in `tests/clique.rs`), `onSession`/`useSession` for the sign-out contract the app's logout crash exposed, and the simulator witness proving a cold start offline and writes composed offline surviving a restart on SQLite | the run's landings, 0.1.12 |

| `crates/snapback4-device` | one device over a `DeviceStore` (`store.rs`): `device.rs` applies the stream with the watermark, stages paged snapshots, keeps the outbox in submission order over confirmed images, answers queries and predictions through `engine::local`; `sqlite.rs` binds the core's store on a native host with the C ABI (`ffi.rs`, `include/snapback4.h`); `memory.rs` is the store for the web, transactions as an undo log, each commit's changes reported for the host to persist; `call.rs` is the one JSON dispatcher; `web.rs` the wasm surface (open with what the host kept, call, drain). `tests/device.rs` runs every scenario on both stores against a real engine; `tests/native.rs` what only SQLite has (two devices on one store, a failing store). Measured whole as wasm: 312,924 B gzip before the diet | the native landing; the one-implementation landing |

| `packages/snapback4-expo`, `apps/chat-expo/src/client.ts`, `witness/expo.mjs` (`WITNESS_DEV_CLIENT=1`) | the Expo module: Swift over the C ABI, the Rust library as a 9.1 MB xcframework (staticlib alone, stripped; 3.3 MB on npm), `nativeAvailable()` choosing the tier at import; the simulator witness on a development build passes the five proofs on the module (303 rows synced in 31 ms, reopen 6 ms, cold start offline 2 ms) → `metrics/witness.jsonl` `dev-client-native`; `snapback4-expo@0.1.14` on npm | the Expo module landing |

| `crates/snapback4-core/src/engine/native.rs`, `crates/snapback4-native`, `crates/snapback4/src/native.rs`, `native-fixtures/rescore`, `crates/snapback4-sim/tests/native.rs` | native jobs (LLP 3000.005): the wasm host over the chunk's `Runner` (get, lookup, scan, mint, insert, insert-if-absent, update, upsert, delete, log, now), one chunk per call with the module's state in the job row, fuel per chunk, refusals and traps parking the job; the guest SDK (`Ctx`, `Chunk`, `Next`, `jobs!`, `from_row`/`row_of`); `check` writing `native.rs` and building `native.wasm`, `dev` rebuilding on save, `deploy` shipping the module, `doctor` and `check --cost` reporting it; the fixture: Interview's rescore in Rust with a float exponent, resumed across three chunks, plus a write past the ceiling and a panic, each parked with its reason | the native-jobs landing |

| `crates/snapback4-core/src/words.rs`, `engine/read.rs` (`scan_words`), `engine/effects.rs`, `identity.rs` (services, custom sessions), `engine/mod.rs` (`Presence`), `crates/snapback4/src/serve.rs` (`/effects/*`, `/auth/session`, `/auth/revoke`, the `Live` registry), `verbs.rs` (`token`), `packages/snapback4/src/worker.ts` | 0.2.1, what Clique and Interview still needed: word-prefix search on one index shape on every host; effects claimed and settled by a worker with a service token; service seats and sessions for the application's own accounts; `connected[p]`; the feed ratio measured at 1× and the ranked recipe on the `feeds` card | the 2026-09-13 landing |

Not in this slice by decision: relevance-ranked search, an identity
provider in the engine, push delivery itself (`NOT-DOING.md`).

## 9. Architecture and code review, 2026-09-12

The author's request for a comprehensive review adds a findings record to
this root before opening focused research children. The review covers the
engine, compiler, HTTP/CLI host, both client tiers and stores, React arms,
reference apps, simulator, fixtures, witnesses and release tooling at
Snapback 4 tree `cf0a13dca32b3e1721d1d947a3f82c262a0807f0`
(repository commit `d6c803878a5432cce5f045777786a049972d3d70`, version
0.0.16). It does not change the bakeoff decisions or accept new designs.

The prescribed suite passes, but additional probes reproduce
schema-admission and projection failures, lost or regressed replica state,
incorrect predictions, stale observations, compiler semantic errors and
request-worker starvation. Passing the existing suite does not establish
the missing properties. The author's updated scope reserves security holes
for another model; this record covers architecture, correctness,
performance and ergonomics and makes no security-review claim.

Four questions need design work beyond an isolated patch:

- [LLP 3000.000](./3000.000-atomic-schema-and-release-activation.research.md):
  the atomic unit and owner of schema/release activation.
- [LLP 3000.001](./3000.001-durable-replica-and-write-lifecycle.research.md):
  confirmed replica data, speculative writes and durable outcomes.
- [LLP 3000.002](./3000.002-end-to-end-resource-bounds.research.md):
  physical resource bounds across requests and replication.
- [LLP 3000.003](./3000.003-one-semantics-and-credible-verification.research.md):
  one semantic contract across Rust, TypeScript and verification hosts.

The [detailed review and 37-ticket index](./reviews/3000-architecture-code-review-20260912.md)
record evidence, alternatives and acceptance examples. All four children are
Draft Research. They remain review findings and proposals; the core owner
retains implementation custody under §1 decision 4.

The author subsequently requested implementation of the 37 concrete tickets.
All 37 are now closed; the [correction qualification record](./reviews/3000-review-corrections-20260913.md)
contains the executed checks, independent reviews and remaining research scope.
Their resolution records and the children's `Implementation follow-up`
sections describe the delivered boundaries: transactional semantic activation,
confirmed-base replay and atomic snapshot ownership, bounded admission/output,
and compiler/client parity corrections. Integration preserves the concurrently
landed native Expo module and ordered-merge performance work. The four children
remain Draft Research for their explicitly outstanding choices; the ticket
fixes do not claim that every architecture question has been settled.

The separate [security review](./reviews/3000-security-review-20260913.md)
opened twelve findings across the HTTP, identity, storage, synchronization and
asset boundaries. Its
[remediation record](./reviews/3000-security-remediation-20260913.md) closes
those findings and three overlapping comprehensive-review findings. The four
security decisions in §7 state the lasting contract; individual tickets retain
the counterexamples, acceptance evidence and limits.

## How to orient

Read this document, then LLP 2000.000 for the argument and its evidence,
then `snapback4/AGENTS.md` once it exists, then the journal. For the
sibling's position read LLP 2000; for the incumbent, LLP 1000; for the
history both inherit, LLP 0329 and its family.

## Non-claims

- This document accepts nothing in LLP 2000.000 on the author's behalf; it
  is the brief, and only running code binds.
- It changes no Snapback 2 or Snapback 3 status, scope, ceiling or gate, and
  edits neither rules file.
- It decides no promotion; the comparison and its ruling are the author's.
- It claims no result; every number above is a threshold or a plan.
