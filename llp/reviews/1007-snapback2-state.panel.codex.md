# Panel: the state of Snapback 2 (codex gpt-5.6-sol)

**Reviewed:** the whole of `snapback2/` at `cc7eb764f`, with `rules/RULES.md`,
`rules/NOT-DOING.md`, LLP 1000–1006, the Quarry fixtures and `quarryc` source,
the TypeScript templates, the packaged guide, `metrics/loop.jsonl`, and the
open `issues/` set, in a read-only worktree.
**Family:** codex gpt-5.6-sol
**Provider/runtime:** OpenAI Codex CLI 0.151.0 (`codex exec`), model gpt-5.6-sol, reasoning effort **ultra**
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

---

## Round 1

# Snapback 2 panel

## Verdict

Snapback 2 has an unusually good center: finite-work certificates carry explicit scan, step, heap, output, and closure ceilings; executions return typed states plus an authoritative trace; and live invalidation follows touched index keys (`snapback2/crates/snapback2-core/src/certificate.rs:48-74`, `snapback2/crates/snapback2-core/src/engine/mod.rs:175-202`, `snapback2/crates/snapback2-core/src/live.rs:151-176`). The actual product loop is already excellent—latest recorded project check is 0.338 s, incremental rebuild 0.97 s, and init-to-dev 0.628 s (`snapback2/metrics/loop.jsonl:129`). Preserve that bounded engine, single-owner shape, typed live states, and version-matched packaged guide (`snapback2/crates/snapback2/src/owner.rs:138-190`, `snapback2/crates/snapback2/src/guide.rs:64-83`). The project has nevertheless begun repeating Snapback 1's failure mode: it is paying for unshipped future behavior while its stated default is not executable (`snapback2/packages/evaluator/package.json:1-8`, `snapback2/crates/snapback2/src/init.rs:34-58`). LLP 1004's Quarry-default-plus-fully-supported-TypeScript ruling directly contradicts “one language, one spelling” (`llp/1004-quarry-default-surface.decision.md:15-22`, `rules/NOT-DOING.md:16-18`). Quarry is promising—the diagnostic run produced a 3.0× smaller backend—but that evidence is one same-family, media-free, unpublished comparison whose own report says it licenses continued testing, not a switch (`llp/0329.014.011-clique-executed-ts-vs-quarry.research.md:15-36`, `llp/0329.014.011-clique-executed-ts-vs-quarry.research.md:108-127`). Meanwhile the canonical bar needs Expo, avatars, image/video posts, and a published package, while the asset proposal is still Draft and deliberately excludes video (`benchmarks/briefs/social-messenger.md:19-22`, `benchmarks/briefs/social-messenger.md:382-416`, `benchmarks/briefs/social-messenger.md:425-476`, `llp/1006-assets.rfc.md:443-451`, `rules/NOT-DOING.md:7-12`). My prescription is to choose Quarry as the sole destination, delete the compatibility and future-facing twins, and spend the recovered complexity on the exact M1–M3 bar.

## Q1 — The Quarry ruling

**The coexistence ruling is wrong; the Quarry direction is right.** A permanent “default” plus a fully supported escape hatch is exactly two authoring profiles. The evidence was encouraging but not dispositive, and LLP 1004 records that the author overrode the recommendation to replicate before flipping (`llp/1004-quarry-default-surface.decision.md:24-31`).

More seriously, Quarry is not the executable default at this commit:

- `init` accepts only the `todos` and `chat` templates, requires `snapback/schema.ts`, and offers only `react|none` as its client choice (`snapback2/crates/snapback2/src/init.rs:34-58`, `snapback2/crates/snapback2/src/init.rs:85-109`).
- The publishable npm package copies the TypeScript templates and bundles the TS compiler; Quarry is a separate private package whose bin points at source (`snapback2/packages/snapback2/build.mjs:57-65`, `snapback2/packages/snapback2/build.mjs:121-139`, `snapback2/packages/quarry/package.json:1-17`). The blocking suite never invokes Quarry (`snapback2/scripts/test.sh:6-12`).
- `quarryc` writes generated code into the authored `snapback/` tree and emits both `<module>.ts` and identical `<module>.q.ts`; for the schema it emits a second module containing a fake `__quarrySource` query (`snapback2/packages/quarry/src/compiler.ts:39-56`, `snapback2/packages/quarry/src/compiler.ts:93-96`). Quarry's tests consequently expect two authored todo operations to certify as five programs and 16 full-surface operations as 33 (`snapback2/packages/quarry/src/test.ts:44-70`). That is duplicate product surface, not merely a filename bridge.

The target should be one public data-program language: Quarry. Keep the TS lowerer temporarily as an invisible compiler implementation, emit at most one intermediate module under `.snapback/`, then lower Quarry directly to IR; delete the `.q.ts` copies, fake schema query, TS backend templates/docs, and handwritten-TS escape hatch. Before calling that target “default,” the package must make `init`, `check`, `dev`, and `test` understand `.q`, preserve structured `.q` source sites, and cover the bar's asset and maintained-count shapes. Today Quarry explicitly refuses assets and `maintain`, even though the shipped chat schema uses a maintained count (`snapback2/packages/quarry/README.md:124-138`, `snapback2/packages/snapback2/templates/chat/snapback/schema.ts:63-72`, `snapback2/packages/snapback2/templates/chat/snapback/schema.ts:93-97`). If the project will not delete public TS authoring, Quarry should remain a private experiment; the forbidden answer is parity forever.

## Q2 — The language

### Three worst choices

1. **Context-sensitive brackets and trailing index selection.** The parser first creates an undifferentiated `table[...]` read, then suffixes turn it into a range and later type/index inference decides whether it means primary-key get, unique get, existence, or scan (`snapback2/packages/quarry/src/parser.ts:420-478`, `snapback2/packages/quarry/src/program.ts:325-340`). Thus `users[name = name]` and `posts[author] before cursor last 3 by byAuthorAt` make the important access path least visible (`snapback2/packages/quarry/fixtures/full-surface/snapback-quarry/surface.q:1-5`, `snapback2/packages/quarry/fixtures/full-surface/snapback-quarry/surface.q:14-32`). Reserve `table[id]` for primary key and spell alternate access at the table—`users.byName[name]`, `posts.byAuthorAt[author] last 3 before cursor`. Delete named-key inference and trailing `by`. Keep the requirement that every scan says `first/last N`.

2. **Position-sensitive return combined with invisible absence behavior.** The final statement is implicitly returned; a final `match` synthesizes a result local, while the same `match` moved earlier discards both arm values (`snapback2/packages/quarry/src/program.ts:74-129`, `snapback2/packages/quarry/src/program.ts:166-188`). Auto-dereference silently propagates null and every comparison guards both operands, making even `null = null` false (`snapback2/packages/quarry/src/program.ts:258-302`). Add explicit `return`; make `match` consistently an expression; give equality ordinary total null semantics; add `is absent`/`is present` rather than hiding absence in optional chains.

3. **Punctuation bought too many tokens at the cost of reviewability.** `+`, `~`, `+~`, and `-` map to four materially different writes (`snapback2/packages/quarry/src/parser.ts:498-505`), while postfix `! else CODE` is accepted after any expression even though the documented intent is a required point read (`snapback2/packages/quarry/src/parser.ts:404-428`, `snapback2/packages/quarry/README.md:99-100`). Spell `insert`, `update`, `upsert`, and `delete`; spell the guard `user = require users[u] else USER_NOT_FOUND`. Stable refusal codes are good; punctuation is not the source of that value.

### Three best choices

1. **Bounds are grammar, not convention.** Range reads require a literal `first/last N`, and loops accept only bounded pages/lists/ranges/token lists/literals (`snapback2/packages/quarry/src/parser.ts:456-478`, `snapback2/packages/quarry/src/program.ts:145-160`). Do not add an unbounded list spelling.
2. **Schema, indexes, identity, and row rules are visible together.** The compact table block exposes all four without builder noise (`snapback2/packages/quarry/fixtures/full-surface/snapback-quarry/schema.q:1-33`). `use identity` plus a unique field is especially good agent-facing compression.
3. **Focused shapes are concise and still bounded.** Nested author projections say what crosses the wire and the emitter materializes a bounded page result (`snapback2/packages/quarry/fixtures/full-surface/snapback-quarry/surface.q:14-32`, `snapback2/packages/quarry/src/program.ts:343-411`). Keep shapes and explicit `require … else CODE`; make their nullable result types visible rather than implicit.

## Q3 — What to delete

Ranked by architectural leverage:

1. **The public TypeScript authoring profile and Quarry bridge duplicates.** Delete the compatibility promise, TS backend templates/docs, `.q.ts` copies, and fake schema operation when Quarry is promoted; retain the TS compiler only as a hidden intermediate until direct IR lowering exists. What breaks: handwritten TS backends and the current TS-only init path (`snapback2/crates/snapback2/src/init.rs:85-101`). That is intentional pre-promotion breakage, not a migration problem.
2. **Effects, the core outbox/emit surface, and Ibex/Hermes.** M1–M3 requires none of the external email/SMS/push behavior (`benchmarks/briefs/social-messenger.md:96-102`), yet this lane adds a second runtime, durable job lifecycle, and per-source Hermes compartments (`snapback2/crates/snapback2-effects/src/lib.rs:1-21`, `snapback2/crates/snapback2-effects/src/ibex.rs:83-120`). It even evaluates effect source at job time (`snapback2/crates/snapback2-effects/src/ibex.rs:304-331`). What breaks: `fetch`, durable retries, `then`, and the chat template's fake notification; delete that notification with the lane (`snapback2/packages/snapback2/templates/chat/snapback/notifications.ts:24-43`).
3. **The TypeScript client evaluator and Rust client replay.** The evaluator is private and absent from the public package exports, while the package client sends query/mutation requests to the owner and consumes SSE (`snapback2/packages/evaluator/package.json:1-8`, `snapback2/packages/snapback2/package.json:8-24`, `snapback2/packages/snapback2/src/client.ts:319-393`). What breaks: optimistic/offline replay, evaluator corpus parity, and future local prediction—not current package query, mutation, subscription, or React behavior. Delete `packages/evaluator` and the product-unused `ClientStore`; keep the server checker (`snapback2/crates/snapback2-core/src/client.rs:15-123`, `snapback2/crates/snapback2-core/src/lib.rs:21-25`).
4. **Prediction-only key provenance.** Delete `KeyProvenance`, `prefix_template`, `prediction_sites`, `check_pair`, and the recursive read-key classifier; retain the certificate's finite-work, rule, collection-growth, and trace-containment analysis. `check_pair` derives only Closed/Partial prediction from computed read prefixes (`snapback2/crates/snapback2-core/src/certificate.rs:437-469`), and the current flat variable namespace can already make that classification contradict runtime lookup (`issues/20260831-snapback2-compiler-flat-variable-namespace-collision.md:10-20`, `issues/20260831-snapback2-compiler-flat-variable-namespace-collision.md:28-38`). What breaks: future client prediction classification.
5. **The 40 `random-*` committed corpus projections.** They are five deterministic samples apiece of eight fixed expression templates, each embedding the full schema (`snapback2/crates/snapback2-core/src/bin/export_corpus.rs:809-947`). What breaks: redundant cross-language sample vectors; named edge cases remain. Once the evaluator goes, replace its existing `test.sh` leg with the already-needed packed-consumer `init → check → test` exercise—this substitutes for, rather than adds, a blocking check (`snapback2/scripts/test.sh:6-12`, `issues/20260831-packaged-consumer-smoke-rung.md:22-27`).
6. **`decimal` and `money`.** Both store as integer values, but add branded public types and specialized arithmetic analysis; Quarry cannot spell either, and Decimal already has an open propagation gap (`snapback2/crates/snapback2-core/src/schema.rs:54-70`, `snapback2/crates/snapback2-core/src/engine/index.rs:320-347`, `snapback2/packages/quarry/src/ast.ts:3-11`, `snapback2/packages/compiler/src/type-analysis.ts:258-344`, `issues/20260831-snapback2-object-literal-decimal-field-types.md:10-12`). What breaks: compile-time scale/currency checking. Use integer minor units until the bar presents a fractional domain.
7. **The public `fork` verb and a separate raw `trace` verb.** Keep the owner's private snapshot primitive for deterministic replay, but remove the thin public fork adapter (`snapback2/crates/snapback2/src/verbs.rs:229-244`, `snapback2/crates/snapback2/src/test.rs:500-545`). Fold the useful trace detail into `why`, which already fetches and returns the authoritative trace (`snapback2/crates/snapback2/src/why.rs:71-84`, `snapback2/crates/snapback2/src/why.rs:104-175`). What breaks: named manual SQLite snapshots and a second raw-inspection spelling.
8. **Append-only committed loop history.** `measure` appends on every run and the command sheet admits the file conflicts on every merge (`snapback2/scripts/measure.mjs:260-268`, `snapback2/AGENTS.md:30-32`). Keep the current result as command output or one replaceable snapshot. What breaks: an in-repository timing time series, which is not product behavior.

Do **not** delete the core certificate, authoritative trace, `why`, or the packaged guide. The guide is copied beside the npm package, not embedded in the Rust binary (`snapback2/crates/snapback2/src/guide.rs:1-3`, `snapback2/crates/snapback2/src/guide.rs:64-83`, `snapback2/packages/snapback2/build.mjs:105-140`). Do not delete `_commits` immediately either: it currently supplies sequence and records consumed by live invalidation (`snapback2/crates/snapback2-core/src/store.rs:215-255`, `snapback2/crates/snapback2/src/writer.rs:844-877`). A later simplification can move the sequence to `_meta`, pass the just-created `CommitRecord` directly, and then delete 10,000-row historical retention (`snapback2/crates/snapback2-core/src/engine/mod.rs:904-929`); doing the table deletion first would break realtime.

## Q4 — What the bar actually needs

1. **The exact asset slice, not the attractive asset subsystem in RFC 1006.** Canonical M1 needs an avatar; M2 needs one-to-four images and one video, with JPEG/PNG/WebP and MP4 accepted as uploaded (`benchmarks/briefs/social-messenger.md:45-49`, `benchmarks/briefs/social-messenger.md:397-416`, `benchmarks/briefs/social-messenger.md:425-455`). Implement bounded upload, row-authorized delivery, client rendering, and replacement against those formats. The Draft instead prioritizes HEIC normalization, two renditions, and a sweep while excluding first-slice video (`llp/1006-assets.rfc.md:212-226`, `llp/1006-assets.rfc.md:443-451`, `llp/1006-assets.rfc.md:487-503`); trim it to the brief.
2. **One real Quarry package path.** Package `quarryc`; make init/check/watch/test consume `.q`; emit one hidden artifact with structured source locations; teach the one-screen grammar; and add only the acceptance-needed `maintain` and asset forms. The current watcher observes only `snapback/`, and the guide still teaches TS (`snapback2/crates/snapback2/src/watch.rs:26-30`, `snapback2/packages/snapback2/guide/grammar.md:3-22`).
3. **Correctness at the paths Clique already exercised.** Fix branch write accounting (the checker takes a branch maximum after summaries have already collapsed same-kind writes), hygienic variable identities, direction-aware descending cursors, and explicit mutation read authority (`snapback2/crates/snapback2-core/src/certificate.rs:541-558`, `snapback2/crates/snapback2-core/src/certificate.rs:933-956`, `issues/20260831-snapback2-compiler-flat-variable-namespace-collision.md:28-38`, `issues/20260831-descending-cursor-after-semantics.md:6-13`, `issues/20260831-mutation-reads-obey-read-rules-admin-null.md:6-16`). Also remove the restricted-seed test wedge before claiming `snapback2 test` as the done-oracle (`issues/20260831-snapback2-test-wedge-rule-restricted-seeds.md:6-9`).
4. **The actual Expo/published-package acceptance.** The canonical client is Expo for iOS, Android, and web, with an iOS Hermes bundle each milestone; current init offers only React or no client (`benchmarks/briefs/social-messenger.md:19-22`, `benchmarks/briefs/social-messenger.md:103-111`, `snapback2/crates/snapback2/src/init.rs:28-52`). The existing comparison was explicitly media-free, React-web-only, and non-comparable (`spikes/clique-diagnostic-runs/brief-diagnostic.md:1-6`). Exercise the complete bar from installed published artifacts, and pay for that package-consumer proof by deleting the evaluator leg named in Q3—not by adding a sixth check.

Effects, offline prediction, `fork`, schedules, deploy, Decimal/Money, and more corpus breadth are not M1–M3 gaps.

## Q5 — Speed

The interactive product is fast; the self-hosting gate is slow. `test.sh` already runs the full Cargo workspace, then evaluator and compiler suites (`snapback2/scripts/test.sh:6-12`). `measure --check` separately touches `value.rs`, rebuilds release, and immediately runs all core tests again (`snapback2/scripts/measure.mjs:126-179`). The open ticket measured 32.49 s in that forced-touch sequence versus 17.9 s fully warm and attributes roughly half to test-target recompilation (`issues/20260831-snapback2-core-test-budget-breach.md:10-14`); the latest run is still 25.18 s (`snapback2/metrics/loop.jsonl:129`). Combined with the documented ~40 s `test.sh`, those two checks alone exceed the stated 60 s total budget (`snapback2/AGENTS.md:7-12`, `rules/RULES.md:14-26`).

Delete the duplicate core-test step from `measure --check`: measurement should retain the one-line incremental rebuild, program/project check, doctor, init/dev, and product-test timings, while `test.sh` remains the correctness suite. Then delete the evaluator/effects/provenance/random-case coverage described above and consolidate the remaining integration tests into fewer test binaries; the latter is an inference from the ticket's test-target recompilation diagnosis, not a measured result. Do not “solve” this by raising 30 s.

The 8.13 MB number is not a shipped-size problem. `measure` stats the incremental, loop-optimized `release` binary, whereas publication uses the stripped, fat-LTO `production` profile (`snapback2/scripts/measure.mjs:117-130`, `snapback2/scripts/measure.mjs:205-208`, `snapback2/Cargo.toml:11-23`, `snapback2/scripts/publish.mjs:20-38`). The recorded production dry run was 5,714,416 bytes with Hermes and 2,479,936 without it (`snapback2/metrics/loop.jsonl:51`). Single-digit megabytes is immaterial here; install latency, cold start, rebuild/link cost, and the architectural obligation represented by those bytes matter. Delete Hermes for scope and simplicity, not to improve an 8.13 MB proxy.

## Q6 — The rules themselves

The rules are directionally excellent: one bar, one spelling, bounded work, no compatibility before promotion, generated artifacts out of git, five checks/60 seconds, and deletion as the default (`rules/RULES.md:12-26`, `rules/RULES.md:49-63`, `rules/NOT-DOING.md:7-23`). They need enforcement by subtraction, not more governance.

Several are already green in letter and red in spirit:

- The author-approved Quarry ruling satisfies the approval exception while creating the expressly forbidden second profile (`llp/1004-quarry-default-surface.decision.md:15-31`, `rules/NOT-DOING.md:16-18`).
- Runtime Hermes source evaluation is an acknowledged exception to “nothing compiled at runtime” (`snapback2/crates/snapback2-effects/src/ibex.rs:304-331`, `llp/1003-effects-on-ibex2.spec.md:210-218`, `rules/RULES.md:53-55`).
- `caps` counts five command names but never their aggregate duration, so the declared suite can be green while its two largest commands exceed 60 s (`scripts/caps.mjs:81-93`, `snapback2/scripts/test.sh:6-12`, `snapback2/metrics/loop.jsonl:129`). Delete the duplicate core timing rung; do not add a duration gate.
- The 1,500-line ceiling has become a target: successor tests end at line 1,493, compiler tests at 1,490, and owner tests at 1,481, while `caps` rejects only `>1500` (`snapback2/crates/snapback2-core/tests/successor.rs:1493`, `snapback2/packages/compiler/src/test.ts:1490`, `snapback2/crates/snapback2/tests/owner.rs:1481`, `scripts/caps.mjs:134-171`). Splitting files alone would honor geometry, not simplicity; delete subsystems and cases first.
- Forty generated random cases plus a duplicate manifest are committed even though generated projections are forbidden (`snapback2/crates/snapback2-core/src/bin/export_corpus.rs:92-120`, `snapback2/crates/snapback2-core/src/bin/export_corpus.rs:809-947`, `rules/NOT-DOING.md:41-43`). Delete them rather than inventing an exemption.
- The append-only metrics log is tracked despite a documented merge conflict on every merge (`snapback2/scripts/measure.mjs:260-268`, `snapback2/AGENTS.md:30-32`). Delete the history rather than building metrology apparatus around it.

The numeric rules are useful tripwires, not evidence of elegance. No new cohesion score, registry, or drift check is needed.

## Q7 — The one change

Make Quarry the only public backend authoring language. Wire `init`, `check`, `dev`, `test`, packaging, and the one-screen guide to `.q`; emit one hidden intermediate under `.snapback/`; reject handwritten backend TS; and delete the TypeScript templates, compatibility promise, `.q.ts` duplicates, and fake schema operation. Retain the TS lowerer only as an invisible implementation stage until Quarry lowers directly to IR. This restores the project's thesis, makes every missing construct an honest product decision, and prevents source mapping, diagnostics, fixtures, docs, and benchmark work from doubling forever.

## Ranked recommendations

| rank | change | why | cost | risk if we don't |
|---:|---|---|---|---|
| 1 | Make Quarry the sole public data-program surface | Restores one language/one spelling and realizes the agent-size advantage | High, one-time migration | Permanent two-front-end tax and contradictory defaults |
| 2 | Fix trace accounting, binding hygiene, cursors, and mutation read authority | Current certified/runtime behavior can disagree on bar-shaped programs | Medium | Silent wrong data or check-green/runtime-red apps |
| 3 | Implement only the canonical M1–M3 asset and Expo slice | It is the largest real capability hole | High | The declared acceptance bar remains impossible |
| 4 | Prove the full bar from the published package, replacing the evaluator check | Tests the surface agents actually receive without adding a gate | Medium | In-repo green continues to mask package failures |
| 5 | Delete effects/outbox/Ibex | It serves post-bar external I/O and violates the runtime-compilation rule | Medium | Build, binary, and semantic complexity grow around unused behavior |
| 6 | Delete client evaluator and Rust replay | Neither is in the shipped client path | Medium | Two interpreters must agree before their feature exists |
| 7 | Delete prediction-only provenance and random generated projections | They exist chiefly for the unshipped evaluator | Medium | Compiler/test complexity keeps compounding |
| 8 | Delete Decimal/Money | No bar requirement; disproportionate type-analysis surface | Low–medium | More special cases and false refusals |
| 9 | Remove public `fork`; fold raw `trace` into `why` | Fewer ways to inspect the same owner | Low | CLI vocabulary grows before promotion |
| 10 | Remove duplicate core timing and committed metric history | Restores the 60 s budget by subtraction | Low | The gate becomes the slow product |

---

## Round 2 — cross-examination

## D1

**Correct `NOT-DOING.md` to the canonical brief; do not reduce the bar.** A text-only React target could be a useful intermediate shakeout, but calling it Clique M1–M3 would make the bar certify only the already-strong server path while excluding the largest missing end-to-end seams. Clique is explicitly Expo on iOS/Android/web, with an iOS Hermes artifact per milestone (`benchmarks/briefs/social-messenger.md:19-22`, `benchmarks/briefs/social-messenger.md:103-111`), and M1/M2 explicitly grade avatar replacement, 1–4 images, and one video (`benchmarks/briefs/social-messenger.md:397-415`, `benchmarks/briefs/social-messenger.md:425-455`). Correct `rules/NOT-DOING.md:9-12`, move that exact Expo/media slice onto the doing-list, and cut LLP 1006 to the brief's pass-through formats; its first-slice video exclusion is incompatible (`llp/1006-assets.rfc.md:443-451`). This is much more work, but it is the honest architecture-forcing bar.

## D2

**Keep the durable-job kernel unwired and unpublished; my wholesale-delete recommendation was too broad.** Enqueue is atomic with application writes and the commit record, and `then` plus settlement share a transaction (`snapback2/crates/snapback2-core/src/engine/mod.rs:376-401`, `snapback2/crates/snapback2-core/src/engine/mod.rs:600-623`). Preserve `_outbox`, internal enqueue/settlement, trace accounting, and focused durability tests. Remove the public effect/emit authoring path, template notification, owner runner, publication wiring, and current Ibex/Hermes executor until an in-scope consumer exists. The executor evaluates compiler-supplied source while constructing the job runtime (`snapback2/crates/snapback2-effects/src/ibex.rs:304-331`), contrary to the ahead-of-time rule (`rules/RULES.md:54-55`). Re-expose effects only with AOT bytecode or a different host. Rebuilding the transactional kernel later is costlier and riskier than carrying that narrow private seam.

## D3

**Delete it now: it is a second implementation that must agree, not a current correctness oracle.** Rust `ClientStore` wraps the same `Engine` (`snapback2/crates/snapback2-core/src/client.rs:15-18`, `snapback2/crates/snapback2-core/src/client.rs:46-79`); the exporter derives expected answers through that store (`snapback2/crates/snapback2-core/src/bin/export_corpus.rs:1011-1022`, `snapback2/crates/snapback2-core/src/bin/export_corpus.rs:1048-1067`); and the blocking TS leg merely compares against committed answers without regenerating them (`snapback2/packages/evaluator/src/test.ts:37-43`, `snapback2/scripts/test.sh:8-11`). That checks a private TS twin against a frozen Rust snapshot, not current Rust against an independent specification. The shipped client still uses HTTP/SSE only (`snapback2/packages/snapback2/src/client.ts:319-393`). Reintroduce a twin when a shipped JS client actually executes IR; basic Expo M1–M3 does not require the deferred offline replay lane (`rules/NOT-DOING.md:32-37`).

## D4

**The committed-projection answer is not conditional on D3: delete the 40 JSON projections either way.** With D3 deleted, drop the cases; if the twin survives or later returns, generate them transiently from the seed/template table. They are only five deterministic inputs for each of eight fixed shapes (`snapback2/crates/snapback2-core/src/bin/export_corpus.rs:809-947`). The whole current corpus is the rule being broken, not a defensible unwritten exception: its exporter deletes and rewrites every JSON file, then writes a second full manifest (`snapback2/crates/snapback2-core/src/bin/export_corpus.rs:92-120`), while generated projections are expressly built, not committed (`rules/NOT-DOING.md:41-43`). Cross-implementation conformance needs stable cases, not 2.8 MB of expanded duplicated bytes; commit compact authored cases/seeds and build the expansion in a temporary directory.

## D5

Grok's strongest point was the `db.insert` return-value bug, which I missed. I was wrong to omit it from my immediate correctness ranking: the lowerer uses the row expression both for `Insert` and as the returned expression (`snapback2/packages/compiler/src/compiler.ts:874-883`), so inline `ctx.newId()` is evaluated twice and the returned ID can name no stored row; the verified repro produced silent referential corruption (`issues/20260831-insert-return-reevaluates-row-expression.md:1-26`). That is a bar-shaped P1 and belongs ahead of several deletions I ranked.
