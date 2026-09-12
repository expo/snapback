# LLP 3000: Snapback 4 — the decided-substrates candidate

**Type:** Explainer
**Status:** Active
**Role:** Root of the Snapback 4 corpus (LLPs 3000 and up)
**Systems:** Everything under `snapback4/` once it exists; the bakeoff protocol shared with Snapback 3 (LLP 2000) and Snapback 2 (LLP 1000)
**Author:** Charlie Cheever / Claude Fable 5.1
**Date:** 2026-09-12
**Revised:** 2026-09-12 (§7: toolchain, simulator host, the clock's commit); 2026-09-12 (initial: the author's decisions of 2026-09-12, the bet on one page, the bakeoff protocol, the fence, the first four weeks)
**Related:** [LLP 2000](./2000-snapback3.rfc.md) (Snapback 3, the sibling candidate), [LLP 2000.000](./2000.000-keep-the-core-flip-two-substrates.rfc.md) (the design brief this corpus builds), [LLP 1000](./1000-snapback2.explainer.md) (Snapback 2, the incumbent and the control), LLP 0000, LLP 0329, LLP 0329.014.004, LLP 0329.016, LLP 1001, LLP 1002, LLP 1012, LLP 1016, LLP 1019, LLP 1020, [LLP 1023](./1023-clique-builder-jump.rfc.md), `rules/RULES.md`, `rules/NOT-DOING.md`, [`benchmarks/protocol.md`](../benchmarks/protocol.md), [`benchmarks/briefs/social-messenger.md`](../benchmarks/briefs/social-messenger.md), [`benchmarks/briefs/messaging-day2-evolution.md`](../benchmarks/briefs/messaging-day2-evolution.md)

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
| Client bytes | Online tier ≤ Convex's shipped React client; local-first tier ≤ PowerSync's shipped web client | Measured on one pinned toolchain, recorded once in the journal, never assumed |
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

## 8. Implementation map

Nothing runs yet. This section replaces itself as code lands, as LLP 1000's
did; the journal carries the chronology.

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
