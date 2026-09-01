# Panel: the state of Snapback 2 (grok-4.6)

**Reviewed:** the whole of `snapback2/` at `cc7eb764f`, with `rules/RULES.md`,
`rules/NOT-DOING.md`, LLP 1000–1006, the Quarry fixtures and `quarryc` source,
the TypeScript templates, the packaged guide, `metrics/loop.jsonl`, and the
open `issues/` set, in a read-only worktree.
**Family:** grok-4.6
**Provider/runtime:** grok CLI 1.0.13 (headless `-p`), model grok-4.6, reasoning effort **xhigh**
**Date:** 2026-09-01
**Redacted:** No — the panelist read the in-repo documents and sources directly
in a read-only worktree; no content left the local machine beyond the model
serving this CLI.
**Method:** Two rounds. Round 1 mutually blind on an identical brief. Round 2
cross-read: each panelist received the other's round-1 document verbatim, the
orchestrator's adjudication of one factual dispute, and five numbered questions.

> **Independence (LLP 0005).** Neither panelist authored any document under
> review. The orchestrator (Claude Opus 5) convened the panel, adjudicated the
> D1 factual dispute against the canonical brief, contributed two findings of
> its own (recorded in LLP 1007 §2 and §6), and did not vote.

**Brief constraint, stated to both panelists as binding:** simplicity, elegance,
speed, ease, and ergonomics are priority 1; features are a floor — "can we do
everything we need to do" — never a scoreboard. A recommendation that removes
something is first-class. No recommendation may add a check without naming the
check it deletes.

> **Correction of record.** This panelist's round-1 answer took the acceptance
> bar from the `rules/NOT-DOING.md` paraphrase ("accounts, feed, realtime chat")
> rather than from the canonical brief it names, and concluded on that basis
> that assets and Expo were out of scope and that effects were needed for M3.
> Both conclusions are wrong; the panelist retracted them in round 2 (D5). The
> round-1 text is preserved unedited, and the error is itself the evidence for
> LLP 1007 §4.

---

## Round 1

# Panel: the state of Snapback 2

Panelist: grok-4.6. Worktree `origin/main`. Read code and the named docs; did not run cargo.

## Verdict

The engine, the owner, and the refusal envelope are the good thing. Keep them. One IR, one SQLite writer, live queries from the authoritative trace, typed states instead of silent empties, personas instead of an auth mode, JavaScript only behind `--features hermes` — that is the product, and three days of it is unusually coherent.

The rest is already starting to accrete around a language decision that has not actually been made. LLP 1004 declared Quarry the default authoring surface on 2026-08-31. The binary still scaffolds TypeScript, `check`/`dev` never invoke `quarryc`, the one-screen grammar still teaches `snapback/schema.ts`, and `quarryc` dual-emits a dummy query so the old worker will load. That is the Snapback 1 two-profile mistake wearing a compiler-as-bridge coat, and it is worse than either surface alone: two spellings, neither finished, a paved path that is check-green / runtime-red.

I would keep the bounded-program model, the owner, the certificate-as-gate, the small guide, the measured loop, and the effects seam. I would make Quarry the only data-program language, treat TypeScript as a lowering and as the JS effects/seed/test seam, and spend the next week closing the certify/runtime gaps rather than adding column types, a second surface fixture, or assets.

The 0329.014.011 research said the head-to-head "licenses 'the Quarry path is viable and cheap to keep testing,' not 'switch.'" The author switched anyway. Directionally right, operationally premature, and then implemented as dual-support instead of as a deletion.

---

## Q1 — The Quarry ruling

**Verdict: the two-profile mistake, not yet simplicity.** Keep Quarry. Delete TypeScript as an *authoring* surface for schema/query/mutation. Do not keep it as a "fully supported compatibility surface."

What the ruling bought is real. The executed Clique diagnostic (`llp/0329.014.011-clique-executed-ts-vs-quarry.research.md`) is the only evidence that matters: both lanes green, Quarry 434 lines / 13.9 KB vs TS 1,211 / 42.0 KB, zero hand-edits of generated code, and a silent-corruption P1 that the TS template idiom hid. Agents writing less, against sited refusals, is the ergonomics priority. That part of the author's override I agree with.

What the ruling *did* is not that. "Default" in LLP 1004 binds five things. None of them are true in the binary:

| Binding (LLP 1004) | Code |
|---|---|
| `init` scaffolds `snapback-quarry/*.q`; `--template ts` is the escape hatch | `init.rs:44–47` accepts only `todos` \| `chat`. `init.rs:85–101` copies `templates/{todos,chat}/snapback` and requires `schema.ts`. There is no `--template ts` and no Quarry scaffold. |
| `check`/`dev` run `quarryc` when `snapback-quarry/` exists | `project.rs:20–35` compiles `snapback/schema.ts`. `watch.rs:26–29` fingerprints only `snapback/`. Grep of `crates/snapback2/**/*.rs` finds no `quarry`. |
| Diagnostics map through `// q:<file>:<line>` | Mapping exists in the emitter (`schema.ts:162–163`) but the owner reports compiler sites on generated `.ts`. |
| Guide teaches Quarry first | `guide/grammar.md:1–4` is the TS layout. `guide.rs:15, 32–37` has no `quarry` page. |
| Spec truth (v0.3, platform not intent) | README is still "provisional v0.2" and still documents refused `maintain`/`#`/`merge`/assets as language. |

Meanwhile `quarryc` is a sidecar CLI (`packages/quarry/src/cli.ts`) that is not in `scripts/test.sh`. The packaged-worker filename bridge (`packages/quarry/README.md:21–38`; `compiler.ts:43–51, 93–97`) emits `<name>.ts` *and* `<name>.q.ts`, plus a dummy `schema.q.__quarrySource = query({}, () => null)` so the worker will accept a schema module. The todos fixture then certifies **5** programs for **2** authored ops (`test.ts:52`; `todos.q` has `list` and `add`). That is not a lowering. That is a compatibility shim for a worker nobody taught about generated files.

`rules/NOT-DOING.md:16–18` forbids "a second authoring profile." LLP 1004 created one and did not take anything off the doing-list. "Delete; don't deprecate" (`RULES.md:53`) is the rule the "fully supported compatibility surface" clause violates on purpose. The standing two-surface fixture in LLP 1004's P2 is apparatus; do not add it. The "bug-finding instrument" argument (`0329.014.011 §3`) is true once and then becomes a reason to never pick. One afternoon of a second emitter found the insert P1. Keep a couple of dual fixtures in `packages/quarry/fixtures/`, not a second product.

Effects stay TypeScript. That is not a second authoring profile; that is the JS seam `NOT-DOING.md:19–21` already named. Seed and journeys already stay handwritten (`quarry/README.md:19`). Maintain is refused at parse (`parser.ts:46–47`) and the Quarry Clique lane still went 19/19, so Clique does not require it.

**Exact change:** Quarry is the only language for tables, rules, channels, queries, mutations. `init` writes `snapback-quarry/*.q`. `check`/`dev` run `quarryc` then the existing compiler. Grammar is Quarry. No `--template ts`. Teach the worker to load generated modules (or to ignore `.q.ts` and accept a schema with no ops) and delete the dual emit and the dummy query. Keep `packages/compiler` as the lowering and certifier. Keep TS for `effect()`, `seed.ts`, and `tests/`.

Until that lands, stop calling Quarry the default. A ruling that the binary does not implement is how v1 grew a million-word guide that described a different product than the one you ran.

---

## Q2 — The language

Read as a language, Quarry is the right size. The inelegance is almost all overload and control-flow borrowed from the TS lowering's limits.

### Three worst

**1. Bracket selection plus `by <index>`.** `t[x]`, `t[col = value]`, positional keys, and `first`/`last`/`after`/`before` share one `[]` (`parser.ts:420–423, 438–454, 456–478`; `catalog.ts:137–174`). Point vs range is decided by trailing keywords; unique vs scan is inferred; ambiguity refuses with "name it with `by <name>`" (`catalog.ts:172`). The `by` you write in the table (`schema.q:29`, `by byUserActive: user, active`) is a different `by` than the `by` on a scan (`surface.q:16`). A human reading `posts[author] after cursor first 3 by byAuthorAt` has to know that `author` is a prefix of `byAuthorAt`, that `first` means ascending, and that `before … last` is secretly `order: "desc"` plus `after` (`README.md:79–82`). The overload created the disambiguation syntax.

**2. `match` has no `return`, and `! else CODE` is a postfix.** Final-position `match` assigns through a generated `let __q_matchResult` and returns it; mid-body `match` discards arm values (`program.ts:166–188`; `README.md:102–103`). There is no `return` in the grammar (`parser.ts:247–274`). `users[u]! else USER_NOT_FOUND` is a postfix on any expression (`parser.ts:424–428`). `require condition else CODE` is a different `else` (`parser.ts:303–309`). Three absence-handling forms, none of which is `return`, and the interesting one changes meaning by position. The todos mutation that wants to return `{ id }` has to bind, then shape (`todos.q:4–6`) because insert-as-value is the only way to get a row back.

**3. Write sigils, and they do not mean what they return.** `+ ~ - +~` (`parser.ts:363, 498–506`) is dense in a way agents like and humans trip on (`+~` vs `~` vs `+`). Writes accept only a scalar id (`program.ts:421–424`) — composite keys refuse with a get-then-id rewrite, so `unique group, user` cannot be the write key. Worse, `+t { … }` is emitted as an *expression* `db.insert(...)` (`program.ts:416–419`) whose value is not the stored row: the TS compiler copies the row AST into both the `Insert` statement and the expression (`compiler.ts:874–883`), and the engine evaluates `self.expr(row)` at insert (`runner.rs:172–175`) and again when the value is read. Inline `ctx.newId()` mints twice (`issues/20260831-insert-return-reevaluates-row-expression.md`). The paved todos *template* hides it by hoisting (`templates/todos/snapback/todos.ts:8–12`). The paved Quarry *emission* is the bug. That is a language lie.

Honorable mention, not a top three: absence is `null` after a platform normalize, comparisons pre-bind and guard both sides (`program.ts:264–270`), `??` is TypeScript `??`, and `row.note = 'set'` is the "is this optional set" test (`surface.q:47–49`). Agents will write `if row.note` and get a surprise.

### Three best

**1. The table is the authorization model.** `read r <- r.ownerId = viewer` (`todos-quarry/.../schema.q:8–11`) is the whole rule. `exists memberships[group, viewer]` on a channel (`full-surface/.../schema.q:72–75`) is the membership pattern Clique independently rediscovered. `public` / `allow` / `deny` / `viewer` are the only combinators, and the compiler refuses what the packaged rules cannot say (`schema.ts:101–107`). Small and honest.

**2. Every scan names its bound.** `first 50` / `last 3` is required (`parser.ts:477`). No unbounded `db.scan`. The TS surface has the same rule (`guide/grammar.md:17`) but Quarry makes it punctuation instead of an options bag. This is the bounded-program thesis in the syntax.

**3. Shape/focal projection.** `posts[author] first 3 { *, author: .author { name, role }, edited: .editedAt ?? .at }` (`surface.q:16–20`) is the page the agent actually wants. `.` is only legal inside a shape or patch (`program.ts:199–201`). Nested refs auto-`get` with null propagation (`program.ts:275–291`). This is why the authored backend is 3× smaller: the TS equivalent is a `for-of` plus object literals plus `db.get`.

Ranges-as-only-bounded-scan is a feature, not a gap. `walk … depth N` is the one recursion and it is bounded (`parser.ts:520–530`). Keep both.

---

## Q3 — What to delete

Ranked. "What breaks" is the cost.

**1. TypeScript as an authoring surface for schema/query/mutation.** (Keep the compiler.) Breaks: existing TS templates, `--template` as currently spelled, anyone who already wrote `snapback/*.ts` by hand, the "escape hatch" in LLP 1004. Does not break: IR, certificate, client, effects, seed, tests, `quarryc`'s emission target. This is the deletion that makes Q1 true. The two-surface fixture in LLP 1004 P2 dies with it.

**2. The dual-file bridge and `schema.q.__quarrySource`.** `compiler.ts:43–51, 93–97`. Breaks: today's worker, which requires `schema.ts` and refuses a module with no ops (`project.ts:24–32, 51–61`). Fix the worker in the same change. Until then this is a known lie in the manifest (duplicate ops, dummy query).

**3. `fork` as a user verb.** `verbs.rs:229–244` is a thin POST to `/control/fork`. Agents building Clique do not snapshot the store; `test`'s replay needs `Store::snapshot_to` (`1001` store API; `store.rs` backup), not the CLI. Breaks: `snapback2 fork <name>` and whatever docs mention it. Keep `reset`. Keep the engine snapshot.

**4. `decimal` / `money` as taught surface.** Engine stores them as i53 (`1001 §9`). Clique does not need them. They already pull compiler surface (`t.decimal` in `lib.d.ts:83–87`; open P3 `issues/20260831-snapback2-object-literal-decimal-field-types.md`; the exponential `analyzeBinary` path was the *int* side of the same type-analysis file). Breaks: the compiler fixture that declares `price`/`budget` (`packages/compiler/fixtures/todos/...`). Do not grow them. Do not put them in `guide/grammar.md`. I would not rip the engine variants out this week — that is churn — but they should not have shipped in week one and they should not be in the one-screen grammar.

**5. `Page.hasMore` on the lib.** `lib.d.ts:48` types a field the runtime does not provide (`issues/20260831-certify-green-runtime-red-gaps.md`). Breaks: anyone who read the type and used it — which is exactly the Clique TS lane. Delete the field; completeness is `state: "capped"`, already on the wire.

Do **not** delete:

- **Client IR evaluator twin.** Not in the npm package (`packages/snapback2/package.json` exports `.` / `client` / `react` / `test` only). Used as the corpus twin (`scripts/test.sh:10`) and by `collection-fact-checks.ts:4`. 7.8 KB gzip, private package. It is the proof that the IR is one language. Offline is deferred (`NOT-DOING.md:33–34`); when it comes, this is the web arm. Keep.
- **Effects crate / Ibex 2.** The only JS seam. Default build links none (`snapback2-effects/Cargo.toml:18–20`; `1003 §4`). Chat template emits through it (`templates/chat/snapback/notifications.ts:24–43`). Clique M3 notifications need it on the published binary. Deleting it puts JS back in the data plane or puts I/O in mutations.
- **Certificate.** The product. Provenance complexity (`lower/provenance.ts`, `provenance-site-checks.ts` at 992 lines) is a tax on the TS surface's expressiveness; a Quarry-only authoring path eventually lowers closer to IR and that tax falls. Do not delete the certificate to save the tax.
- **`why` / `trace`.** The bar is "at most one Snapback-attributed correction loop." These are how the agent spends that loop instead of guessing. Separate verbs are cheap (`why.rs`, `trace.rs` are small adapters over control routes). Merge later if the verb table hurts; do not delete the capability.
- **Random corpus cases.** 40 of 82 JSON files (`corpus/random-00.json` … `random-39.json`). Named/edge/scenario cases carry meaning; random cases catch interpreter drift between Rust and the twin. Cheap. If `core_test_s` needs cutting, cut elsewhere.
- **`_commits`.** `trace` reads it (`1002 §8`; `engine/mod.rs:905–928`, last 10,000). Without it, `trace latest` is reconstructed from syntax, which the spec forbids. Keep. The 10k trim is fine (`1001` open question 1 is not worth a week).
- **Packaged guide.** It is not in the binary (`guide.rs:1–2, 64–72`; `1002 §8`). Twelve short recipes. This is the allowed guide in `NOT-DOING.md:34–36`. Keep, and rewrite `grammar.md` to Quarry.

---

## Q4 — What's missing that the bar needs

The bar: a fresh agent, published package, Clique M1–M3 (accounts, feed, realtime chat), ≤ 1,200 s, ≤ one Snapback-attributed correction, `snapback2 test` proves it. Diagnostic runs were worktree tarballs, not a published package (`0329.014.011 §1`; `NOT-DOING.md:8–12`).

Required, not a wishlist:

1. **A published package a stranger can install, and a consumer-side smoke that packs, installs, `init`, `check`, `test`.** `issues/20260831-packaged-consumer-smoke-rung.md`: the first pack found `E_OPAQUE` duplicate-module and a template that failed its own `check`. The suite still has no consumer rung. The bar is the published package. Without this, every publish ships an unconsumed surface. (If this becomes a blocking check, it replaces `measure.mjs --check`'s "forced-touch then `cargo test -p snapback2-core`" step, which is measuring rustc — see Q5.)

2. **Certify ≡ runtime for the paved idioms.** Open today: insert double-eval P1 (`compiler.ts:874–883`); quarryc branch-arm write undercount (`issues/20260831-quarryc-branch-write-trace-undercount.md`); `Page.hasMore` / composite cursors / Id scalars (`issues/20260831-certify-green-runtime-red-gaps.md`). The loud-refusal law is the product. An agent who `check`s green and then corrupts ids spends the one correction loop on Snapback, and the bar fails.

3. **`snapback2 test` that terminates on a realistic seed.** `issues/20260831-snapback2-test-wedge-rule-restricted-seeds.md`: 9+ min at 98% CPU, killed, Quarry Clique lane. Mechanism is visible in code: `check_rules` hits `/control/verdicts` for *every stored row* of every non-public table × every persona (`test_policy.rs:19–108`; `1002 §4` control route). `check_invalidation` is queries × mutations (`test_policy.rs:159–176`). Clique-sized seeds make this combinatorial. If `test` does not prove the app, the bar's last clause is false.

4. **Newest-first pagination that paginates.** `issues/20260831-descending-cursor-after-semantics.md`: descending `after` is still exclusive greater-than, so feed page 2 duplicates page 1. Clique M2 is a feed. The workaround (negated-time `ord` column) is not something a fresh agent should have to invent.

5. **Mutation reads and admin authority, at least as a taught refusal.** `issues/20260831-mutation-reads-obey-read-rules-admin-null.md`: `db.get` inside a mutation returns null for rows the viewer's read rule hides; Clique burned two designs. `guide/grammar.md` does not mention it. Minimum: a recipe and a diagnostic. `reads:` per mutation is the paved design (LLP 0329.014.004 dimension L) and is the one language addition I would allow, because the alternative is a denormalized "roster table" every app rediscovers.

6. **The default matching the binary.** If the published package still `init`s TypeScript while the guide-of-record says Quarry, the fresh agent is in the two-profile maze on minute one. Either Q1's deletion lands before publish, or the docs say TypeScript until it does.

Not required for the bar:

- Assets (LLP 1006). The diagnostic brief struck media. `NOT-DOING.md:9` names accounts, feed, realtime chat. The RFC's simplification pass is the right instinct (`1006 §12` killed the projection seam, intent declaration, width ladder, refcount, upload rule); implement it after a stranger has built Clique without photos.
- Expo, Exact 2, offline, schedules, deploy, WASM, `Bytes`, `decimal` in the grammar, a second authoring profile, a standing two-surface lane, replication of .011 as a blocker.
- `maintain` in Quarry. The Quarry lane shipped Clique without it. Add when a feed count cannot be a client `length` or a write-time counter.

---

## Q5 — Speed

The agent's loop is already fast. Latest `metrics/loop.jsonl` (sha `15b48c03c`): warm build 0.08 s, incremental 0.97 s, `check` 0.23 s / 0.34 s, `doctor` 0.13–0.44 s, `init`→`dev` 0.63 s, `test` todos 0.85 s. Those are the numbers that matter for the bar. Do not spend a week on them.

`core_test_s` at 25.2 s against a 30 s budget is *our* loop, and the open ticket is honest (`issues/20260831-snapback2-core-test-budget-breach.md`): a warm `cargo test -p snapback2-core` is 17.9 s; measure's forced mtime touch then rebuilds test targets, and the same SHA has printed 22–32 s. Several recent lines in `loop.jsonl` are already over 30 s (`31.82`, `31.76`, `36.19` earlier the same day) with `"ok": true` on the step object — the budget bite is in `--check`, and it is machine-dependent. Do not raise the budget. Stop counting rustc as "test what you just changed": measure should rebuild the library, not force a full test-target relink, or it should run `cargo test --lib`. The 60 s blocking gate is `caps` + `ref-check` + `scripts/test.sh` (~ cargo workspace + evaluator + compiler, claimed ~40 s in `AGENTS.md:9`) + `measure --check` + `check-inventories`. The thing that will break 60 s is `test.sh`'s `cargo test --workspace` growing, not `check` on a program.

I counted lines. Brief said ~12 k Rust src / ~9 k tests. This tree: `crates/**/src/*.rs` **26,716**; `crates/**/tests/*.rs` **11,323**. The 1,500-line files are real: `tests/successor.rs` 1493, `packages/compiler/src/test.ts` 1490, `tests/owner.rs` 1481, `tests/outbox.rs` 1445, `effects/src/ibex.rs` 1391, `bin/export_corpus.rs` 1360, `src/writer.rs` 1350, `evaluator.ts` 1353, `certificate.rs` 1318. They are not "several"; they are the shape of the crate. Splitting `writer.rs` into `writer_effects.rs` / `writer_ledger.rs` already happened. Further splits do not save `core_test_s`.

**8.13 MB release binary.** `loop.jsonl` `release_binary_bytes: 8131568`. LLP 1000's "what exists" still says 5.06 MB with engine / 2.18 without — that sentence is already stale. The number matters as a *trend* (Hermes + image decoders in LLP 1006 §14 will jump it) and as the "one binary" download for `npx`. It does not matter at 8 vs 5 for the Clique bar. Do not strip effects to shrink it. Do not embed a guide in it (already not: `1002 §8`). Watch it; do not panic.

Quarry is not in the blocking suite (`scripts/test.sh:1–13`). Fold `packages/quarry/src/test.ts` into the compiler test run; do not add a sixth check.

---

## Q6 — The rules

The rules are the right rules. They are already being used as a dress code.

**Letter yes, spirit no:**

- **1,500-line cap.** `caps` would refuse 1501. Nine files sit at 1,318–1,493. The rule's point was "split on the way in" (`NOT-DOING.md:54–55`). The spirit being honored is "do not trip the check." `compiler/src/test.ts` at 1490 is the tell: tests grew into the cap rather than a second file.
- **Second authoring profile.** `NOT-DOING.md:16–18` vs LLP 1004 in the same week, without taking anything off the doing-list. The most valuable file in the repository was overridden by a decision that the binary does not implement.
- **Delete; don't deprecate.** Compatibility surface, dual emit, dummy query, `--template ts` in the ruling (not even in the CLI). That is deprecation theater without the deletion.
- **Only implemented specs bind** (`RULES.md:57–58`). LLP 1004 is `Accepted`. The flip workstreams are tickets. Agents reading `1000` decision 10 will teach Quarry-first to the next session while `init` writes TS. An unimplemented Accepted ruling is a spec blocking a PR in all but name.
- **Agents remove apparatus freely and add none** (`RULES.md:62–63`). Three days added: `packages/quarry` (~1,930 lines), the filename bridge, `__quarrySource`, provenance (`provenance-site-checks.ts` 992, `collection-fact-checks.ts` 812), `decimal`/`money`/`Bytes`, LLP 1004, LLP 1006 (a design doc: allowed only because commissioned), and a verb table that already includes `fork`/`why`/`trace`/`guide`/`doctor`. Some of that is the product. The dual-surface and the dummy query are apparatus. The standing two-surface fixture would be more.

**Letter and spirit, keep:** five blocking checks; 60 s; fail-all not fail-fast; `NOT-DOING` as a taking-turns list; no committed generated code; no JS in the data plane; no drift registries; sparse guide. `RULES.md` itself is 543 words against a 700-word cap — that one is clean.

**Fix the spirit without adding a check:** when a file crosses 1,200 lines, split it in the same PR that grows it. When a ruling names a default, the same PR changes `init`/`check`/`grammar.md` or the ruling stays Draft. When something is added to the doing-list, something comes off — including "a second authoring profile" if Quarry is the language.

---

## Q7 — The one change

Make Quarry the only authoring surface for tables, rules, channels, queries, and mutations, and make the binary tell the truth about that: `init` writes `snapback-quarry/*.q`, `check`/`dev` run `quarryc` then the existing compiler, `guide grammar` is Quarry, the dual `.ts`/`.q.ts` emit and `schema.q.__quarrySource` are deleted by teaching the worker, and the TypeScript templates for schema/programs go away. TypeScript remains the lowering, and remains the file you write for `effect()`, `seed.ts`, and journeys. Do this in the same movement as the insert-once and branch-write-trace fixes, because a default compiler that is check-green / runtime-red is how the one correction loop gets spent on Snapback. Do not keep an escape hatch.

---

## Ranked recommendations

| change | why | cost | risk if we don't |
|---|---|---|---|
| Quarry-only for data programs; delete TS authoring templates; wire `quarryc` into `init`/`check`/`dev`; rewrite `grammar.md` | Ends the two-profile maze; matches the agent's measured advantage | A few days on the owner + templates; effects/seed/tests stay TS | Every published-package agent gets the v1 Familiar/Explicit tax on day one |
| Delete dual emit + `__quarrySource`; teach the worker generated modules | The manifest currently certifies 5 ops for 2 authored (`test.ts:52`) | Small, same PR as the row above | Duplicate ops, dummy query, site-mapping hop become load-bearing |
| Insert evaluates the row once; returned row = stored row (`compiler.ts:874–883`) | Silent id corruption on the paved Quarry idiom | Small engine/compiler fix + one regression | Paved path corrupts feed FKs; bar's one correction is spent here |
| quarryc branch-arm write trace matches runtime | Check-green / runtime-red on paved `if`/`match` writes | Small, fixture already requested | `E_TRACE_SUBSET` after green `check` |
| Drop `Page.hasMore`; refuse composite cursors and invalid Ids at certify | Lib lies (`lib.d.ts:48`); Clique redesigns | Small | Fresh agent copies the type and burns a loop |
| Direction-aware descending `after` (or document `before` as the only newest-first page) | Clique M2 is a feed; page 2 duplicates page 1 today | Medium (scan semantics + corpus) | Every newest-first feed is wrong |
| Bound `test`'s rules/invalidation probes so Clique seeds finish | Bar requires `snapback2 test` to prove it; wedge is 9+ min kill | Medium; `test_policy.rs` × seed size | Agents cannot prove the app they just built |
| Mutation-read honesty: recipe now, `reads:` if one language addition is allowed | Admin flows see silent nulls; Clique burned two designs | Small (guide) to medium (language) | Rediscovered "roster table" in every app |
| Packaged-consumer smoke (`init`→`check`→`test` from tarballs); *replace* measure's forced-touch core-test step so the check count stays 5 | Bar is the published package; first pack was red | One script, in `test.sh` or publish, swapping a check that currently measures rustc | Every publish ships an unconsumed surface |
| Do not implement LLP 1006 until Clique-without-media is green on a published package | Assets are on the doing-list; they are not on the bar as written | Zero (wait) | A column type with decoders jumps the 8.13 MB binary and another week before a stranger has built chat |
| Do not add LLP 1004's P2 two-surface fixture | Apparatus; one dual fixture directory is enough | Negative (don't do it) | A standing second profile, forever |
| Freeze `decimal`/`money` out of the grammar; do not grow type-analysis for them | Not on the bar; already leaking P3s | Zero | Grammar and compiler complexity in week two for a ledger nobody is building |

---

## Round 2 — cross-examination

# Round 2 — grok

## D1 — the bar's actual scope

**Reduce the now-bar to the paraphrase, and stop calling it Clique M1–M3.** Write two named targets. Do not leave `rules/NOT-DOING.md:8-12` pointing at a name whose absence-fails capabilities it drops.

The 1,200 s / one-correction clock is an agent-loop bar (`llp/0329.016-agentic-dev-loop-from-scratch.rfc.md:993`, Clique M1 typical ~2,100 s). The canonical brief is a different object: Expo iOS/Android/web plus a per-milestone iOS Hermes bundle (`benchmarks/briefs/social-messenger.md:19-22`, `:103-111`), M1 avatar (`:397-400`, `:415-416`), M2 “images (1–4 fixture images); video (exactly 1)” (`:428-430`, `:453-454`). Matching that *this cycle* puts upload/MP4/Expo on an engine that still double-evals inserts, wedges `test` on Clique seeds, and does not implement its own default. The likely output is a rushed LLP 1006 that *excludes the video M2 requires* (`llp/1006-assets.rfc.md:443-451`) while `check` still lies. The clock and the brief were never one bar; pretending they are is how you get a million-word excuse corpus.

The now-bar is accounts, text feed, realtime chat, published package, React web, `snapback2 test`. That matches LLP 1000 decision 5 and `NOT-DOING.md:27-28` (React web, then Expo, then Exact 2). The brief’s M1–M3 (avatar, 1–4 images, one MP4, Expo + iOS bundle) is the named later bar. Media is not “not-building” while 1006 sits in Draft (`NOT-DOING.md:29-31` already names assets as until-the-bar work; the bug is the bar line’s name). When the later bar starts, trim 1006 to JPEG/PNG/WebP + MP4, bounded upload, row-authorized delivery — no HEIC-first, no rendition ladder, video in the first slice.

The trade of matching the brief instead: honesty of name, and you cannot ship a chat app and call it Clique. Cost is weeks of media+Expo competing with engine honesty, a larger binary, and a 1,200 s clock that becomes unreachable. If the author picks that, still do insert-once and the default-matching-the-binary first — a green `check` that corrupts ids with photos is not closer.

## D2 — effects / Ibex 2

**Yes, the answer changes.** M3 does not need effects (`social-messenger.md:96-102`). Delete Ibex/Hermes, `effect()`/`then` authoring, and the chat fake-notify (`templates/chat/snapback/notifications.ts:24-43`, `messages.ts:25`). The “only JS seam” argument was protecting a door M1–M3 does not walk through; job-time `eval` (`ibex.rs:304-331`) is a recorded violation of `rules/RULES.md:54-55` (`llp/1003-effects-on-ibex2.spec.md:210-218`). Default already links none (`snapback2-effects/Cargo.toml:18-20`).

**Keep `_outbox` DDL and in-commit `emit` enqueue, unwired and unpublished** — not in the grammar, not in templates, not drained by a JS engine. Re-adding “a mutation commit atomically enqueues a durable job with a `then` continuation” is a store+writer protocol (`store.rs:151-167`, `writer.rs:499-516`). Re-adding Hermes is a feature flag and git history. Asset finalize (`1006:496`) and a later digest/push both want the table, not a second runtime.

## D3 — the client IR evaluator twin

**A second thing that must agree before either can change.** Not a load-bearing correctness instrument for the product that ships.

The shipped client is HTTP + SSE (`packages/snapback2/src/client.ts:319-393`). The evaluator is private and not in the package exports (`packages/snapback2/package.json:8-24`, `packages/evaluator/package.json:2`). Offline is deferred (`NOT-DOING.md:33-34`). `scripts/test.sh:10` still makes every IR change wait on twin parity. That is the same “instrument once, then a reason to never pick” pattern as a standing two-surface fixture. The Rust engine plus named/edge/scenario traces *is* the oracle. `ClientStore` is not on the owner path (`lib.rs:25`; uses are `tests/spike.rs`, `export_corpus.rs:1048`, `collection-fact-checks.ts:4`). Delete `packages/evaluator` from the blocking suite; keep the server checker. Point those collection-fact tests at `rustCheck`, which they already import.

## D4 — the 40 `random-*` cases

**Conditional on D3: yes.** If the twin goes, the random cases have no second implementation to disagree with. They are five deterministic samples of eight templates, each embedding the full schema (`export_corpus.rs:809-947`). Delete them even if the twin stayed — they are not the named edges.

The 2.8 MB committed corpus (826,442-byte `manifest.json` reprinting every case, `export_corpus.rs:117-119`) **is the rule being broken**, not a defensible exception to write down (`NOT-DOING.md:22-23`, `:41-43`). A twin-vs-engine fixture could justify *named* pinned traces. Forty generated projections plus a duplicate manifest cannot. Generate expected traces at test time from the engine; stop committing them.

## D5 — one thing I got wrong

I was wrong that assets and Expo are not on the bar, and I used that miss twice. Sol read the brief (`social-messenger.md:19-22`, `:397-400`, `:428-430`); I read `NOT-DOING.md:8-12`’s paraphrase and treated it as the acceptance criteria for a name — “Clique M1–M3” — whose milestones fail without an avatar, 1–4 images, one video, and an Expo client. That is also why I kept effects “for M3 notifications,” which `:96-102` puts out of scope everywhere. The live finding I missed is the one sol named: the most valuable file understates its own bar, then lists media as not-being-built while LLP 1006 sits in Draft.
