# LLP 1007: The state of Snapback 2, and the work

**Type:** Plan
**Status:** Draft
**Systems:** `snapback2/packages/quarry`, `snapback2/packages/compiler`,
`snapback2/packages/evaluator`, `snapback2/crates/snapback2` (`init`, `check`,
`dev`, `test`, `guide`), `snapback2/crates/snapback2-core` (scan cursors, the
corpus exporter), `snapback2/crates/snapback2-effects`, `snapback2/scripts`,
`rules/RULES.md`, `rules/NOT-DOING.md`
**Author:** Claude Opus 5 (orchestrator), commissioned by Charlie Cheever
2026-09-01 in session
**Date:** 2026-09-01
**Revised:** 2026-09-03
**Related:** LLP 1000 (the root), LLP 1001, LLP 1002, LLP 1003, **LLP 1004**
(the ruling this plan finds unimplemented), LLP 1005, LLP 1006, LLP 0005 (the
review loop the panel ran), LLP 0329.014.004, LLP 0329.014.011,
LLP 0329.016 §5.11 §8, `rules/RULES.md`, `rules/NOT-DOING.md`,
`benchmarks/briefs/social-messenger.md`,
`llp/reviews/1007-snapback2-state.panel.codex.md`,
`llp/reviews/1007-snapback2-state.panel.grok.md`

## Summary

A three-voice panel read the whole of `snapback2/` at `cc7eb764f` on
2026-09-01: codex gpt-5.6-sol (ultra) and grok-4.6 (xhigh) mutually blind, then
cross-examined, with Claude Opus 5 orchestrating and not voting. The brief made
simplicity, elegance, speed, ease, and ergonomics priority 1 and features a
floor rather than a scoreboard, and required every addition to name a deletion.

Both panelists opened by saying the center is right, and the center should be
read as settled before anything below: bounds are grammar rather than
convention, states are typed and never a silent empty, live invalidation
follows the authoritative trace, one owner writes the store, the table block is
the authorization model, and the agent-facing loop is already fast (`check`
0.23 s, incremental rebuild 0.97 s, `init`→`dev` 0.63 s). Nothing in this plan
touches any of that.

Both panelists then found the same thing first, independently: **LLP 1004
declared Quarry the default authoring surface, and none of the five things it
says "default" binds are true in the code.** That is §2. Two further findings
are the orchestrator's own (§2 last paragraph, §6). One question the panel
could not settle is the author's and is §4.

**This is a proposal.** `rules/RULES.md`: only implemented specs bind, and a
spec needs an implementer and a date. §5 gives both per item; nothing here
binds until the code runs. It was commissioned in-session, which is the
explicit approval the agent rule requires for adding a document.

## 1. What this plan is counterweighted by

`rules/RULES.md` requires that moving something onto the doing-list takes
something off. This plan is net-negative in surface on purpose: §7 deletes the
client evaluator twin, the 40 generated corpus cases, the Ibex 2 executor and
the `effect()` authoring path, `decimal`/`money`, the public `fork` verb, and —
if the author rules that way in §4b — the entire TypeScript authoring surface.
The additions in §5 are repairs to paved paths and one script that *replaces* a
blocking rung rather than adding a sixth.

`llp/current/` stood at its 59-document cap when this landed. The
`0329.014.009` link was archived in the same change: that exercise is executed
and reported, and its conclusion is carried by LLP 1004, which cites it.
Archiving is only removing a link; the document is unchanged.

## 2. Finding: the flip was ruled but not built

LLP 1004 §"What default binds" names five bindings. At `cc7eb764f` the string
`quarry` does not appear anywhere in `snapback2/crates/`.

| LLP 1004 binds | The code at `cc7eb764f` |
|---|---|
| `init` scaffolds `snapback-quarry/*.q`; `--template ts` is the escape hatch | `init.rs:44` accepts only `todos` \| `chat`; `init.rs:85–101` copies templates over `snapback/schema.ts`. No `--template ts` flag exists. |
| `check`/`dev` run `quarryc` when `snapback-quarry/` exists | No reference to quarry in any Rust source; the watcher fingerprints `snapback/` only. |
| Diagnostics map back to `.q` sites | The `// q:<file>:<line>` markers are emitted (`quarry/src/schema.ts:162`), but the owner reports compiler sites on the generated `.ts`. |
| The packaged guide teaches Quarry, via `snapback2 guide quarry` | `packages/snapback2/guide/` has six pages; none is Quarry. `grammar.md` still teaches `snapback/schema.ts`. |
| Spec truth rule: v0.3 states what the platform does | `packages/quarry/README.md` is still "provisional Quarry v0.2" and still documents refused constructs as language. |

`quarryc` is also absent from `snapback2/scripts/test.sh`: **the declared
default authoring surface is covered by no blocking check.**

Two consequences are worse than the gap.

**The default language cannot express the shipped template.** Quarry's parser
refuses `maintain`, `#` aggregate reads, `effect`, `schedule`, and `asset`
(`quarry/src/parser.ts:46, 47, 52, 53, 64, 211, 364`). The `chat` template uses
both a maintained count and `emit`
(`templates/chat/snapback/schema.ts:93–97`, `messages.ts:25`). The surface being
made default is a strict subset of the surface it compiles to. This is a
sharper failure than Snapback 1's two profiles — not two spellings of one
capability, but a default that cannot reach the platform.

**The bridge is a compatibility shim, which `rules/RULES.md` bans by name.**
`quarryc` emits `<name>.q.ts` *and* an identical `<name>.ts`, plus a synthetic
`schema.q.__quarrySource` query so the unchanged worker will accept a schema
module (`quarry/src/compiler.ts:39–56, 93–96`). Quarry's own tests therefore
expect two authored todo operations to certify as five programs, and sixteen
full-surface operations as thirty-three (`quarry/src/test.ts:44–70`).
`RULES.md`: "Delete; don't deprecate. No compat shims or migration paths before
promotion."

Under `RULES.md`'s own "only implemented specs bind," the flip has not
happened. The corpus nonetheless reads as though it has, and the next session
orienting from LLP 1000 will teach Quarry-first while `init` writes TypeScript.
An Accepted ruling the binary contradicts is how Snapback 1 grew a guide
describing a product nobody was running.

**Resolved 2026-09-02 (`b2bebb49a`).** The three findings above are now false in
code: the Quarry front end lives in `packages/compiler/src/quarry/` and the
worker compiles `snapback/*.q` in memory (no `.q.ts`, no `__quarrySource`,
`packages/quarry` deleted); the `chat` template ships in Quarry (`maintain`,
`emit`, constraints, transition rules, and the channel all spelled) and its
journeys pass unchanged; the Quarry tests run in the compiler leg of
`scripts/test.sh`. The implementation record, including where the code departs
from LLP 1004's letter (one directory, no generated files, no `quarryc`
program), is LLP 1004 §"Implementation record".

## 3. Finding: where `check` is green and the runtime is red

Loud refusal over silent degradation is the product. These are the places it
currently fails on paved paths. Each was found by an agent building Clique, and
each cost that lane a redesign.

| Defect | Effect |
|---|---|
| **Insert re-evaluates its row expression** (`compiler.ts:874–883`): the row AST is used both for the `Insert` and as the returned value, so an inline `ctx.newId()` mints twice. | The returned id names no stored row — silent referential corruption. The TS template hides it by hoisting the id; the paved Quarry emission does not. Verified: `issues/20260831-insert-return-reevaluates-row-expression.md`. |
| **quarryc undercounts branch-arm writes**: a `.q` mutation whose branches write the same table passes `check`, then fails at runtime with `E_TRACE_SUBSET`. | Green certify, red run, on the surface being made default. `issues/20260831-quarryc-branch-write-trace-undercount.md`. |
| **`Page.hasMore` is typed but unreadable**: `packages/compiler/lib.d.ts:48` declares `Page<T> = Array<T> & { hasMore: boolean }`; reading it is `E_TYPE` at runtime. | The type system invites the exact call that fails. The Clique TS lane took the invitation. |
| **Descending `after` is exclusive greater-than in both directions.** | Page 2 of any newest-first feed returns the wrong half of the index and duplicates page 1. Both bars in §4 have a reverse-chronological feed. |
| **Mutation reads obey read rules**: `db.get` inside a mutation returns null for rows the viewer cannot read. | Admin flows see silent nulls; the Clique lane burned two designs and then invented a roster table. Undocumented in `guide/`. |
| **`snapback2 test` wedges on realistic seeds**: rule checks probe every stored row × every persona; invalidation checks are queries × mutations (`test_policy.rs:19–108, 159–176`). | 9+ minutes at 98% CPU, then killed. The acceptance bar's last clause is "and `snapback2 test` proves it." |

Both panelists put this class above every deletion; codex explicitly withdrew
its round-1 ranking to say so. Nothing else in this plan matters if the
compiler lies.

## 4. Two decisions that are the author's

### 4a. What is the acceptance bar?

`rules/NOT-DOING.md` states the bar as: a fresh agent builds *Clique M1–M3
(accounts, feed, realtime chat)* on the published package in under 1,200 s with
at most one Snapback-attributed correction loop. Everything not required by
that bar does not exist yet.

`benchmarks/briefs/social-messenger.md` — the brief that name refers to — is
materially larger. M1 requires an avatar image (`:397`). M2 requires "images
(1–4 fixture images); video (exactly 1)" (`:428–430`). The client is Expo
across iOS, Android, and web with a per-milestone iOS Hermes bundle (`:19–22`).
The brief also puts email, SMS, and real APNs/FCM delivery out of scope
**everywhere** (`:96–102`), so M1–M3 needs no external I/O at all.

The paraphrase drops precisely the capabilities whose absence fails the bar.
This is not a hypothetical: one panelist read the paraphrase and concluded
assets and Expo were out of scope and that effects were required for M3; the
other read the brief and concluded the opposite. Both are careful readers. The
document called the most valuable file in the repository understates its own
acceptance bar, and then lists media as not-being-built while LLP 1006 sits in
Draft with video deferred and its schedule an open question (LLP 1006 rev (d),
OQ2).

The two positions, both argued in the panel record:

- **Correct the file to the brief** (codex). Move the exact Expo and media
  slice onto the doing-list and trim LLP 1006 to the brief's formats. A
  text-only React target would certify only the already-strong server path
  while excluding the largest missing end-to-end seams. More work, but the
  honest architecture-forcing bar.
- **Name two bars** (grok). The 1,200 s one-correction clock is an *agent-loop*
  bar; the brief is a *capability* bar; they were never one object. Write both
  down and stop calling the near one Clique M1–M3.

**Orchestrator's recommendation: take the split, with the honesty requirement
attached.** It does not shrink anything — it stops one name from covering two
objects, which is what produced the disagreement. Let the near bar keep the
1,200 s clock and the published-package requirement, since those test the loop.
Keep the brief as the capability bar; when it starts, trim LLP 1006 to what it
actually asks for, video included. The ordering argument decides it: both
panelists diagnosed the same failure mode — paying for unshipped future
behavior — and building a media pipeline on an engine whose paved insert
corrupts ids is that failure mode wearing a deadline.

**Until this is ruled, §5's items 1–8 proceed unchanged** (they are correctness
and coherence, required under either answer); items 9–11 are scoped by it.

**Ruled 2026-09-02.** The author delegated this decision to the orchestrator,
who took the split: `rules/NOT-DOING.md` now names a loop bar (the 1,200 s
one-correction clock on the reduced Clique M1–M3, React web, no media, on a
published package) and a capability bar (the brief as written, Expo and media
included) that starts only after the loop bar is met, at which point LLP 1006
is trimmed to the brief's formats (`8c6a82483`, item 11).

### 4b. Does the TypeScript authoring surface stay?

LLP 1004 keeps TypeScript as a "fully supported compatibility surface and
escape hatch." Both panelists, independently and again after cross-reading,
said that clause is the Snapback 1 two-profile mistake and should be deleted:
Quarry becomes the only public language for tables, rules, channels, queries,
and mutations; TypeScript remains the lowering target and the file you write
for `seed.ts` and journeys. Neither panelist wanted parity maintained.

This contradicts an Accepted author ruling, so it is recorded here as a
decision and not acted on. The alternative is coherent too: keep both, and
accept the standing cost of a second front end, a site-mapping hop, and a
parity fixture lane. What is *not* coherent is the present state, where the
ruling names a default the binary does not implement.

**Ruled 2026-09-02 (author): keep only Quarry.** The TypeScript authoring
surface is deleted in `8c6a82483`; LLP 1004 carries the amendment. TypeScript
stays as the lowering target and the harness language (seeds, journeys,
effect bodies).

## 5. The work

Implementer for every code item: **codex gpt-5.6-sol (xhigh)**, per the
standing roster, orchestrated and landed by Claude. `rules/RULES.md` requires
an implementer and a date or the spec is not written; dates are targets, and an
item that slips its date returns here rather than sitting silently.

| # | Item | Lane | Date |
|---|---|---|---|
| 1 | Insert evaluates its row expression once; returned row equals stored row. Regression pins it. Inline `ctx.now()` is the same class. | `s2/quarry-default` | landed 2026-09-02 (`b2bebb49a`) |
| 2 | quarryc branch-arm write accounting matches runtime; fixture with per-branch writes. | `s2/quarry-default` | landed 2026-09-02 (`b2bebb49a`) |
| 3 | Drop `Page.hasMore` from `lib.d.ts`; refuse composite cursors and invalid `Id` scalars at certify time with a rewrite. Landed as: `hasMore` gone; cursors are full ordering tuples with shape refusals; invalid Id scalars and Id-to-text in Id positions refuse with pasteable rewrites; static analysis stays silent where the runtime accepts. | `s2/q-platform` | landed 2026-09-02 (`e410e8042`) |
| 4 | Direction-aware descending `after`, or `before` documented as the only newest-first page and the other refused. Landed as: `after`/`before` are scan-order relative and are the full post-prefix tuple; a cursored index must be a total order (ends in `id`, or unique); Quarry pages with `after (a, b)`. Also fixed on the way: the compiler-worker shutdown hang behind a `node` shim. | `s2/q-platform` | landed 2026-09-02 (`e410e8042`) |
| 5 | Bound `test`'s rule and invalidation probes so a Clique-sized seed finishes. | `s2/test-bounds` | 2026-09-04 |
| 6 | Mutation-read authority: a `guide/` recipe and a diagnostic now. A `reads:` declaration only if §4b lands Quarry-only, and only then. | `s2/mutation-reads` | 2026-09-05 |
| 7 | Packaged-consumer smoke rung: pack, install, `init`, `check`, `test` from tarballs. **Replaces** `measure --check`'s duplicate core-test step; the check count stays five. | `s2/consumer-smoke` | 2026-09-05 |
| 8 | Fold `packages/quarry/src/test.ts` into the existing compiler leg of `test.sh`, so the default surface is covered without a sixth check. | `s2/quarry-default` | landed 2026-09-02 (`b2bebb49a`) |
| 9 | Execute LLP 1004's five bindings: `init` scaffolds `.q`, `check`/`dev` run `quarryc`, diagnostics report `.q` sites, `guide quarry` exists, README becomes v0.3 platform truth. Delete the dual `.ts`/`.q.ts` emit and `__quarrySource` by teaching the worker about generated modules. | `s2/quarry-default` | landed 2026-09-02 (`b2bebb49a`); see LLP 1004 §"Implementation record" for the two layout departures |
| 10 | Give Quarry a `return`; make `match` an expression in every position. The one language change both panelists asked for unprompted — position-dependent semantics is what an agent gets wrong silently. | `s2/quarry-default` | landed 2026-09-02 (`b2bebb49a`): `return` in every position; `match` stays a statement |
| 11 | Scoped by §4a: either the media and Expo slice, or the two-bar rewrite of `rules/NOT-DOING.md`. | `s2/quarry-default-merge` | landed 2026-09-02 (`8c6a82483`): the two-bar rewrite; the media and Expo slice waits for the loop bar |

## 6. Finding: the 60-second budget is enforced by nothing

`rules/RULES.md:14` reads "**5 blocking checks, 60s total.** A sixth requires
deleting one, in the same PR. **[check]**". `scripts/caps.mjs:81–93` parses the
backticked names under the "Blocking checks" heading and compares their *count*
to five. No code measures aggregate duration anywhere in the repository.

Meanwhile `snapback2/AGENTS.md:9` documents `scripts/test.sh` alone at ~40 s,
and `measure --check` then re-runs the core suite (25.2 s at `15b48c03c`, with
`issues/20260831-snapback2-core-test-budget-breach.md` open against the 30 s
budget). Two of the five checks already exceed the 60 s total between them.

The open ticket contains the honest diagnosis: a fully warm `cargo test -p
snapback2-core` is 17.9 s, and roughly half the measured cost is test-target
recompilation forced by `measure`'s own touch. The instrument is the expense.

**The fix is subtraction, not a duration gate** — §5 item 7 deletes measure's
duplicate core-test rung and spends the recovered time on the consumer smoke.
Adding a `caps` duration check would be adding apparatus to enforce a budget
that gets met by removing work, which is the wrong direction and is what
`RULES.md` exists to prevent.

## 7. Deletions

Converged after cross-examination; the reviewers opened split on the first
three and agreed on all of them by round 2.

- **The client IR evaluator twin** (`packages/evaluator`) and the Rust
  `ClientStore` replay. It looks like a second independent implementation and
  is not: the corpus's expected answers are produced *by the Rust engine
  itself* (`bin/export_corpus.rs:1011–1067`, via `ClientStore` over the same
  `Engine`) and then committed, so the TypeScript twin is checked against a
  frozen Rust snapshot. It catches twin drift, not engine error, while making
  every IR change wait on twin parity. Reintroduce it when a shipped JS client
  actually executes IR; offline is deferred (`NOT-DOING.md`).
- **The 40 `random-*` corpus cases, and committing the corpus at all.** Five
  deterministic samples of eight fixed templates, each re-embedding the full
  schema (`export_corpus.rs:809–947`). The corpus is 2.8 MB of committed
  generated JSON including an 826 KB `manifest.json` that reprints every case,
  in a repository whose `NOT-DOING.md` says generated projections are built,
  not committed. Both panelists called this the rule being broken rather than
  an exception worth writing down. Commit compact authored cases and expand at
  test time.
- **The Ibex 2 / Hermes executor, `effect()` authoring, and the chat
  template's notification.** The brief puts external I/O out of scope
  everywhere for M1–M3, and the executor evaluates effect source at job time
  (`effects/src/ibex.rs:304–331`) against `RULES.md`'s "nothing is compiled,
  transpiled, or generated at runtime that could be built ahead of time".
  LLP 1003 §"Deferred (not binding)" records this as "a recorded deviation"
  and names `hermesc` bytecode at `check` time as the fix — which is the honest
  form, and also confirms the AOT path exists. **Keep `_outbox` and in-commit
  enqueue, unwired and unpublished:** re-adding a transactional outbox later is
  a store-and-writer protocol change, whereas re-adding Hermes is a feature
  flag. Both panelists landed on exactly this split from opposite starts.
- **`decimal` and `money` as taught surface.** Both store as integers, both
  pull specialized type analysis, Quarry cannot spell either, and
  `issues/20260831-snapback2-object-literal-decimal-field-types.md` is open.
  Neither bar needs them. Do not rip the engine variants out this week; keep
  them out of the grammar and stop growing the analysis. **Ruled 2026-09-02
  (author): kept.** They implement LLP 0329.014.004's exact value model for
  the paper archetype apps; once the TypeScript surface was gone nothing could
  reach them, and the author chose to spell them in Quarry (`decimal <scale>`,
  `money <CUR> [scale]`, decimal literals; `929a45268`) rather than delete them.
  Clique Pay (`benchmarks/briefs/clique-pay.md`, `35b4b6349`) subsequently worked
  out their arithmetic, Euclidean split builtins, exact sum maintains, and
  integer argument wire form through a complete app fixture.
- **The public `fork` verb.** Keep the owner's snapshot primitive, which
  `test`'s replay needs; drop the thin CLI adapter.
- **The TypeScript authoring surface** — templates, docs, escape hatch,
  `.q.ts` duplicates, `__quarrySource`. Conditional on §4b — ruled and deleted
  2026-09-02 (`8c6a82483`).

Explicitly **not** deleted, in both rounds: the certificate, the authoritative
trace, `why`, `_commits` (live invalidation consumes it today), and the
packaged guide.

## 8. The language, as read

Recorded because it is evidence for item 10 and for §4b, not as a change list.
Both panelists chose the same three worst spots from different directions.

Worst: **the bracket carries four meanings** — point read, unique read,
existence probe, and scan share one syntax, resolved by trailing keywords and
index inference, with `by <index>` existing as the disambiguator the overload
requires; **return depends on position** — there is no `return`, a final
`match` synthesizes a result local while the same `match` moved earlier
silently discards both arms, and comparisons guard both operands so `null =
null` is false; **sigils that do not mean what they return** — `+`, `~`, `+~`,
`-` are four materially different writes at one character each, and `+t { … }`
lowers to an expression whose value is not the stored row, which is §3's P1.

Best: **bounds are punctuation** (`first 50` cannot be omitted); **the table
block shows columns, indexes, identity, and all four rules together**, with
`exists memberships[group, viewer]` replacing a four-line combinator call
repeated per rule — this is most of the 3.0× size difference LLP 0329.014.011
measured; **focused shapes** state the page once and stay bounded.

## 9. Non-claims

This plan does not accept or amend LLP 1004, LLP 1006, or any other document;
§4b records a recommendation against LLP 1004's compatibility clause and leaves
the ruling standing. It does not change `rules/NOT-DOING.md` — §4a is the
finding, and the correction is the author's. It does not publish anything, does
not change Snapback 1, and does not decide promotion. It adds no check: item 7
replaces one and item 8 folds into an existing leg. Nothing here binds until
the code in §5 runs.
