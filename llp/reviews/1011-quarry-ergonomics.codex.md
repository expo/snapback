# Panel: LLP 1011 — Quarry ergonomics (codex gpt-5.6-sol)

**Reviewed:** `llp/1011-quarry-ergonomics.rfc.md` revision (a), overlaid on a read-only
worktree at `4a33e55de`, with LLP 1010 and its panel record, the Quarry front end,
the reference, templates, fixtures, the wire (`writer_wire.rs`, `client.ts`,
`react.tsx`), the certificate and engine, and the rules.
**Family:** codex gpt-5.6-sol
**Provider/runtime:** OpenAI Codex CLI 0.153.0 (`codex exec -s read-only`), model gpt-5.6-sol, reasoning effort **ultra**
**Date:** 2026-09-03
**Redacted:** No — the panelist read the in-repo documents and sources directly in a
read-only worktree; no content left the local machine beyond the model serving this CLI.
**Method:** Two rounds. Round 1 mutually blind on an identical brief
(`~/projects/snapback-1011-panel/brief-r1.md`). Round 2 cross-read: each panelist
received the other's round-1 review verbatim, the author's verified list of what was
settled, and seven enumerated disagreements. The orchestrating Claude session
authored the RFC and is not an independent reviewer.
**Recorded by:** Claude Fable 5.1 (orchestrator), verbatim from the CLI's final message.

## Round 1 (blind)

**Family:** OpenAI GPT-5.6 / gpt-5.6-sol · **Date:** 2026-09-03 · **Method:** blind round 1, read-only checkout at 4a33e55de

## 1. Overall assessment

The RFC sorts the enduring constraints correctly—bounded indexed reads, explicit caps, strict money, and no unbounded control flow are prices of the thesis—but B1–B6 is not yet the right set. Opaque cursors, named shapes, consistent missing-write behavior, and whole-unit seeds address real correction loops; B4 lacks enough evidence and is unsound as specified, while `data --filter` adds surface without deleting a demonstrated workflow. The claim that the thesis is untouched is also too strong: B1 changes the normative typed-state, wire, certificate, and trace contracts, and B3 as drafted would change table-block authorization.

## 2. Per amendment

### B1 — ACCEPT WITH CHANGES

The defect is real: authors currently supply the complete post-prefix tuple and encounter tuple-shape, ordering, and totality checks in `snapback2/packages/compiler/src/quarry/program.ts:539-593`, while the guide exposes those mechanics at `guide/quarry.md:91-109`. The delivery envelope is the right location because `Page<T>` is only an array (`packages/compiler/lib.d.ts:47-52`), shaping demotes it to an ordinary sequence (`quarry/program.ts:740-754`), and the wire already owns `{state,data,seq}` (`crates/snapback2/src/writer_wire.rs:8-24`); make `next` required as `cursor|null` on successful page deliveries and absent elsewhere. Forward-only meets the loop bar: `before … last` already lowers to descending `after` (`quarry/program.ts:537,594-598`), although total-order validation must remain rather than being counted as deleted. An unsigned token is acceptable for authority, but it needs a bounded, versioned, canonical tagged encoding bound to page site, table, index, order, and suffix schema; plain JSON collapses IDs and strings that cursor validation distinguishes (`protocol.rs:177-215`, `engine/index.rs:295-359`). Do not expose a site’s internal `Limit` versus `Exhausted`: preserve LLP 1001’s opacity with `Complete → null`, nonempty `Capped → token from the last visible row`, and empty `Capped → null` (`llp/1001-query-engine.spec.md:189-199`, `engine/mod.rs:1105-1131`). The result-page origin must be unique, statically determined, plan-bound, and preserved through aliases and one-to-one shaping; today neither the Quarry-to-TypeScript path nor `Program` carries that provenance (`quarry/index.ts:23-74`, `core/src/ir.rs:5-13`). Merge needs separate work because it sorts, deduplicates, and slices but records only union length, not the final output anchor (`lower/merge.ts:30-35`, `engine/runner.rs:561-575`), and uniqueness of `(lane-prefix, suffix)` does not make the shared suffix globally total across lanes—require the shared suffix to end in intrinsic `id`. Accept once those rules, LLP 1001/1002 updates, evaluator parity, and the real migration census are specified; strike the unexplained React `loadMore`, since the current hook fixes one argument set and replaces rather than accumulates data (`react.tsx:87-157`).

### B2 — ACCEPT WITH CHANGES

Named shapes solve a demonstrated defect: the same profile projection occurs fourteen times across `fixtures/quarry-clique/snapback/social.q:81-113`, `chat.q:101-130`, and `pay.q:43-54`. AST-level shape expansion can reuse the existing focal-row shaping logic (`quarry/program.ts:757-779`) and genuinely deletes substantially more literal structure than it adds. General effectful `fn`, however, is not supported by the cited precedent: TypeScript helpers are single returned expressions with positional substitution (`lower/helper-expansion.ts:7-39,58-62`), not arbitrary reads, writes, emits, nested returns, or statement/expression calls. Correct expansion requires call-by-value evaluation, hygienic renaming, localized return control flow, mutual-cycle detection, expansion-unique temporaries, namespace rules, type joining, and multi-site diagnostic provenance; those are language semantics, not one expansion pass. From taste as well as mechanics, hiding writes inside expression-capable helpers also makes the human-readable authorization story worse. Split B2: accept named shapes now and either defer `fn` or constrain it to a fully specified hygienic subset; if B2 remains indivisible and effect-general, my verdict becomes REJECT.

### B3 — ACCEPT WITH CHANGES

The inconsistency is real, though the RFC misses the focal by-ID update branch: direct delete no-ops, simple update leaks `E_INPUT`, focal update synthesizes `UPDATE_ROW_MISSING`, and alternate-key forms explicitly require `NOT_FOUND` (`quarry/program.ts:802-877`, `compiler/src/compiler.ts:636-714`). The proposed visible `db.get` is wrong because it applies read authorization and emits a point trace (`core/src/engine/runner.rs:631-668`), whereas internal write-preimage access does neither. That silently changes authority from `write` to `read AND write`, breaking valid tables such as chat notifications with `read <- deny` and `update <- system` (`templates/chat/snapback/schema.q:98-106`). Normalize genuinely missing direct-ID updates and deletes to `NOT_FOUND` at the engine and evaluator write primitive instead. Upsert absence must continue to insert; only its present branch updates, by-ID upsert derives identity from its key, and only absent alternate-key upsert mints an ID. Banning authored `id` in an upsert row is a good subtraction and deletes the second lookup plus `UPSERT_ID_IN_USE`/`UPSERT_ID_MISMATCH` branches at `quarry/program.ts:880-908`. Accept after correcting the authorization mechanism, the upsert wording, and the understated engine/evaluator/test migration cost.

### B4 — REJECT

The defect exists at only the same three Clique watermark sites (`fixtures/quarry-clique/snapback/chat.q:80-99`) already judged insufficient evidence in both LLP 1010 reviews. The implementation is not “one environment feature”: `and` eagerly lowers both operands in the same environment (`quarry/program.ts:319-325`), including any right-hand preludes, before JavaScript short-circuiting. Spelling is not identity because block bindings can shadow an outer name (`quarry/program.ts:103-120,164-172`), and member chains may perform a fresh implicit dereference each time (`:409-440`); a write between the check and reuse can invalidate the narrowed value. Bound-name narrowing could be sound, but it would not remove the cited member-chain `!` sites, while caching checked member values would introduce different semantics and machinery. The explicit assertion is presently the honest price of strict optional typing; new corpus evidence plus a binding-identity or cached-value design would change my verdict.

### B5 — ACCEPT WITH CHANGES

The defect is real: Quarry money/decimal literals are whole units while seeds require safe-integer minor units (`guide/quarry.md:31-42`, `project-seed.ts:76-77`). The cost is not one validator branch: `lowerSeed` validates but returns the original rows unchanged (`packages/compiler/src/project.ts:307-325`), so this needs schema-directed normalization recursively through optional and list values. Scaling must use an exact character/BigInt path with explicit grammar, sign, scale, and i53 checks; ordinary multiplication of a parsed JavaScript number cannot enforce exact decimal spelling (`lower/static.ts:50-80`). The cited `fixtures/quarry-money/snapback/seed.ts` does not exist; actual migrations include `fixtures/todos/snapback/seed.ts:6`, the seed-invalid regression at `verified-regression-tests.ts:1252-1263`, and generated pay test seeds at `crates/snapback2/tests/quarry_pay.rs:160-217`. This deletes the seed-specific exception, not the global two-rule split, because client arguments remain minor-unit wire values.

### B6 — REJECT

A better exact-index diagnostic is potentially worthwhile, but the implementation is not a prose rewrite: `where` currently refuses before predicate AST construction and before catalog selection (`quarry/parser.ts:639-644`, `quarry/index.ts:25-41`). A sound proposal must reuse an existing compatible index, deduplicate predicate columns already in the prefix or suffix, preserve totality and uniqueness, avoid name collisions, and never recommend non-indexable columns (`quarry/catalog.ts:136-183`, `core/src/engine/index.rs:323-355`). “One paste” is also false under the current single-site, single-rewrite diagnostic model, whose multiline rewrites are flattened (`compiler/src/ir.ts:184-192`, `quarry/index.ts:181-188`). `data --filter` has no corpus evidence or named deletion, repeated flags are rejected by the current option parser (`crates/snapback2/src/verbs.rs:335-399`), and filtering after a capped page can return zero matches while later matches remain unreachable. Existing `--json` already supports local `jq` exploration (`verbs.rs:279-287`). Strike the filter and resubmit an index-diagnostic-only amendment with an honest two-file repair contract and explicit deletion of the manual index-derivation loop.

## 3. Open questions

1. Put `next` on the envelope, forward-only is sufficient, and unsigned is acceptable with strict versioned/tagged validation. A merge token must bind to the header table/index/order/shared-suffix schema, be validated before any lane scan, and derive from a newly traced final merged-page anchor.

2. Expand at the Quarry AST level; TypeScript helpers are too narrow and are not the authoring language. Operation-argument scalar types are sufficient for a first helper subset; row parameters would add aliasing and coercion semantics without evidence.

3. No visible traced point read: it changes authority. Missing update/delete should normalize inside the write primitive, while upsert retains its internal atomic existence decision because absence means insertion.

4. Arbitrary spelling-based member-chain narrowing is unsound under shadowing, repeated implicit dereference, and intervening writes. Limit any future narrowing to stable binding identity, or cache and reuse the checked value.

5. Strike B4, general effectful `fn`, and `data --filter`; retain shapes and the corrected portions of B1, B3, B5, and the index diagnostic. The two missed items below are better additions.

## 4. What the RFC missed

1. **Expose paging in `snapback2 data`.** The CLI stops at `--index`, `--prefix`, and `--limit` (`crates/snapback2/src/verbs.rs:140-188`), while the control/writer path already accepts `after` (`control.rs:153-180`, `writer.rs:1172-1205`). Surface that capability—then migrate it to B1’s opaque token—to delete the first-page-only exploration blind spot and manual control-request workaround.

2. **Delete the stale generated Quarry golden.** `packages/compiler/fixtures/quarry-surface/lowered.json:3104-3279` is an unreferenced 3,329-line artifact still containing deleted `__q_where*` lowering, while the authored source now uses `byAuthorVisibleAt` (`fixtures/quarry-surface/snapback/schema.q:49-50`, `surface.q:28`). Deleting it removes a false source of truth and directly follows the prohibition on committed generated code in `rules/NOT-DOING.md:37-38`.

## 5. What the RFC should strike

- B4 in full.
- B2’s arbitrary statementful/effectful `fn`; retain named shapes and reconsider a narrow helper separately.
- B6’s `data --filter`, “deletes nothing,” “smallest item,” and “one small verb flag” claims.
- B1’s per-site `Limit` disclosure, claim that total-order refusals disappear, and automatic React `loadMore`.
- B3’s visible pre-read and the statement that missing upsert is `NOT_FOUND`.
- B5’s “one validator branch,” nonexistent money-seed migration, and claim to delete the global units split.
- The “13 cursor sites” census: the enumerated template/Clique/surface sources contain seven paging expressions.

## 6. Verdict on the document

**NOT READY.** The shortest route to readiness is:

1. Rewrite B1’s state-opacity, result-origin, token, merge-totality, trace, wire, and React contracts.
2. Split B2 into shapes and a narrowed/deferred helper proposal.
3. Move B3’s absence normalization into the write primitive and correct upsert semantics.
4. Strike B4 and `data --filter`; fully cost B5 and the index-only part of B6, and correct the migration census.

## Round 2 (cross-read)

**Family:** OpenAI GPT-5.6 / gpt-5.6-sol · **Date:** 2026-09-03 · **Method:** cross-read round 2, read-only checkout at 4a33e55de

## Disagreements

### D-A — hold: defer `fn`

Ship `shape`; defer `fn`. The subset removes most control-flow and effect concerns, but a valued call preceded by `require` still needs statement lifting and evaluation-order rules because Quarry has no block expression and `emitBinary` eagerly emits expression preludes (`program.ts:319–325`). Fresh argument temporaries also do not prevent repeated body temporaries from colliding: `temporary()` uses only the definition line and column (`program.ts:1268`), while free names still need definition-scope validation. Two module-local three-use guard patterns do not buy enough deletion for those semantics.

### D-B — hold, with precision fixes

Confirm engine-primitive normalization: a visible `db.get` applies read authority, so making it universal would break `notifications` (`schema.q:98–106`). Store-authoritative missing update/delete should raise `NOT_FOUND` from `runner_ops.rs:49–56,118–126`, with evaluator parity, while upsert retains insertion on absence. Focal by-id update is an existing exception: its callback lowers to a real `Get` plus `UPDATE_ROW_MISSING` (`compiler.ts:690–705`); rename that code to `NOT_FOUND`, but do not claim every by-id update is read-free. Receipt-only twins must distinguish held row, authoritative by-id absence → `NOT_FOUND`, and unheld row → `Partial("missing-authority")`; that permits deletion of `missing_preimages` and maintained-target tainting.

### D-C — new: `if` narrowing now, conjunct narrowing later

Binding-object identity answers shadowing, and one-hop fields of a bound row are snapshot property accesses rather than the dereference path in `emitMember` (`program.ts:409–433`), so intervening writes do not invalidate them. But emitting the right operand in a narrowed clone does not make its preludes conditional: `emitBinary` still places them before the runtime `&&`, and an optional reference can therefore cause an unconditional `db.get`. Accept `if x != null` narrowing for bound names and one-hop fields of bound rows; defer `x != null and R` until right-hand preludes are conditionally buffered. One hop covers all three cited watermark sites exactly (`chat.q:83–95`).

### D-D — change: accept the narrowed diagnostic

Accept via a parsed, diagnostic-only `where` intent followed by a post-catalog analyzer; the current parser refuses too early (`parser.ts:639–644`) and `compileQuarry` exits before catalog construction (`index.ts:25–41`). Two coordinated schema/read diagnostics fit the one-rewrite-per-diagnostic model, but the cursor test is sequential rather than a simultaneous precedent (`quarry-checks.ts:455–483`). Reuse a compatible index or propose a collision-free index preserving base order and totality, with deduplicated source-order predicate columns and the platform’s eight-column bound. Conflicting duplicate predicates, ambiguous base indexes, lists, declared JSON, or any uncertain derivation must retain the generic refusal.

### D-E — change: do not bind the token to the site

The other argument convinced me: a site selects the trace used to mint the token but is not part of the index coordinate, and lexical site ordinals can change after unrelated edits. Bind instead to version, table, index, order, the exact remaining-suffix descriptor, and typed suffix values; sharing across operations is then sound only when that descriptor matches. Keep canonical tagged encoding because `protocol.rs:177–215` collapses `Id` and `String`, plus decoded-size bounds and canonical re-encoding on strict decode.

### D-F — hold: confirm

Require every pageable merge index to end in intrinsic `id`, enforced by Quarry and the certifier. Merge sorts only the shared suffix before dedupe and slice (`lower/merge.ts:30–35`); uniqueness of the full `(lane prefix, suffix)` still permits equal suffixes across lanes. Resuming strictly after that tied suffix would skip rows.

### D-G — change only the placement

Include all three. `data --after <token>` should travel with B1, not B6: the current control path accepts only one raw post-prefix scalar (`writer.rs:1172–1185`), so it needs B1’s full-suffix decoder, result-page metadata, and returned `next`. Migrate both copies of chat `thread`, whose `last 50` currently has no continuation, and delete the unreferenced 3,329-line `quarry-surface/lowered.json` generated golden.

## Final recommended amendment set, ranked

1. Put `next: cursor | null` on complete/capped envelopes with result-page provenance and the settled mint rule — deletes client tuple extraction and LLP 1010 A6.
2. Use forward-only, typed canonical tokens bound to table/index/order/suffix descriptor, with merge anchors and end-in-`id` certification — deletes `before` and the tuple refusal families.
3. Normalize missing writes inside authoritative primitives, add the receipt-only three-way rule, rename focal `UPDATE_ROW_MISSING`, and ban upsert-row `id` — deletes four absence stories, two upsert codes, minted form, `missing_preimages`, and tainting.
4. Land AST-level named `shape` in a new file and defer `fn` — deletes fourteen repeated projections and the proposed helper-semantics burden.
5. Add binding-identity `if` narrowing for names and one-hop bound-row fields only — deletes the three watermark `!` assertions.
6. Recursively normalize decimal/money seed values with exact BigInt scaling — deletes the seed-only minor-unit exception.
7. Add the catalog-aware, coordinated two-site `where` repair with strict fallback conditions — deletes the manual index-derivation correction loop.
8. Add `data --after <token>` using B1’s decoder and envelope — deletes first-page-only exploration and manual control requests.
9. Correct the seven-expression/nine-physical census and migrate both chat `thread` copies — deletes tuple signatures and the copied 50-row wall.
10. Delete `fixtures/quarry-surface/lowered.json` — deletes a stale generated false source of truth.
11. Amend LLP 1001, LLP 1002, guide text, migrations, and named line/byte budgets in the same change — deletes stale contracts and cost claims.
12. Strike `data --filter`, React `loadMore`, and valued/effectful `fn` — deletes three proposed surfaces without losing the demonstrated workflow.

## What I would steal

I would steal the other review’s chat `thread` migration outright; it is the user-facing copied operation my first review missed. I would also steal its `fn` completeness checklist—void versus valued calls, exact postfix shape grammar, reserved-word handling, and membership-code unification—even though checking those points is what leaves me recommending deferral.

## Verdict after the changes

Ready for the author to rule on and implement with `fn` and conjunct narrowing deferred. Keeping expression-valued `fn`, or `and` narrowing without conditional right-prelude lowering, would remain blocking.
