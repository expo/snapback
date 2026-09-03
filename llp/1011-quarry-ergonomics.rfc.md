# LLP 1011: Quarry ergonomics — opaque cursors, named shapes, one missing-row rule, narrowing, whole-unit seeds, a repair for the refused filter

**Type:** RFC
**Status:** Accepted (under the author's standing instruction of 2026-09-03,
"revise until you are happy with it, then if you think it's good, implement
the changes": revision (b) is the version both panel families marked READY,
and the orchestrator judges it good)
**Systems:** Authoring surface (`snapback2/packages/compiler/src/quarry/`), the
Quarry reference (`snapback2/packages/snapback2/guide/`), templates and
fixtures, the `quarry` diagnostics family; for B1 the wire
(`snapback2/crates/snapback2/src/writer_wire.rs`, `control.rs`, `verbs.rs`,
`packages/snapback2/src/client.ts`, `react.tsx`), the certificate, trace, and
engine (`snapback2-core`), and the evaluator twin; for B3 the engine's write
primitives and the twin; for B5 `packages/compiler/src/project-seed.ts` and
`project.ts`
**Author:** Claude Fable 5.1 (proposal and revision), commissioned by Charlie
Cheever 2026-09-03 in session ("anything we could do about these rough
edges?"), from the migrations LLP 1010 forced and a reading of the code at
`4a33e55de`; revised after a blind two-family panel (codex gpt-5.6-sol at
ultra, grok-4.6 at xhigh), `llp/reviews/1011-quarry-ergonomics.*`
**Implementer:** codex gpt-5.6-sol (xhigh), lane `s2/quarry-ergo`
(`~/projects/snapback-s2`), orchestrated and landed by Claude Fable 5.1
**Date:** 2026-09-03
**Revised:** 2026-09-03 (b — after the panel: `fn` deferred and `shape` kept;
B1 gains the corrected mint rule, page provenance through shapes, a typed
site-free token, the merge anchor and the end-in-`id` rule, `data --after`,
and the chat `thread`; B3 moves into the engine's write primitives with the
twin's three-way rule; B4 is `if`-narrowing only, on binding identity; B5 is
the seed validator with exact scaling and the real migrations; B6 is a
catalog-time two-site repair and loses `--filter`; the stale generated golden
is deleted; every corrected fact is corrected); 2026-09-03 (a — initial
draft, pre-panel)
**Related:** LLP 1010 (the amendments this follows; its A6 is superseded by
B1), LLP 1004 (spec-truth rule), LLP 1001 §3 (typed states — amended by B1),
LLP 1002 §4 and §6 (the wire and `data` — amended by B1), LLP 0329.014.004 §9,
LLP 0329.014.010 open question 4 (shape reuse), `rules/RULES.md`,
`rules/NOT-DOING.md`, `issues/20260903-snapback2-insert-if-absent.md`

## Summary

After LLP 1010 landed, the author listed the language's remaining rough
edges: indexes designed upfront, load-bearing cursor shapes, absence corners,
strict arithmetic without narrowing, and no escape hatches. Sorted honestly,
some are the price of the thesis and stay (§0). The rest are ergonomics that
can be fixed without touching the model. Revision (a) proposed six; the panel
kept all six, narrowed three, deferred one half of one, and added three
items of its own (§9).

| # | Amendment | Rough edge it answers | Deletes |
|---|---|---|---|
| B1 | opaque cursors: `next: cursor \| null` on a page delivery; reads take `after c` with `c: cursor ?`; forward-only | the tuple shape, `before` vs `after`, the optional group's mixed-presence case, the tuple-widening rewrites; first-page-only CLI exploration | tuple cursors, `before`, LLP 1010 A6's group, three refusal families, the client's suffix plucking |
| B2 | `shape name = { … }`, expanded at the Quarry AST level at each use | fourteen repeated projections in the Clique fixture and the templates' copies | the repeats; the "user functions" refusal is *kept* — `fn` is deferred |
| B3 | one missing-row rule inside the engine's write primitives; no `id` in an upsert row | by-id delete no-op, by-id update `E_INPUT`, focal update `UPDATE_ROW_MISSING`, alternate-key `NOT_FOUND` — four stories; the minted-form/mismatch/in-use trio | the no-op, the platform-code leak, the fourth code, two `UPSERT_ID_*` refusals, the minted form, `missing_preimages` |
| B4 | narrowing on `if x != null:` for bound names and one-hop fields of a bound row | `if x != null: if x! >= y:` | the nested-`!` idiom at its three sites |
| B5 | whole-unit seeds, exactly scaled by the validator | seeds in minor units while literals are whole units | the seed-only minor-units exception |
| B6 | the refused `where` becomes a two-site repair: the index line for `schema.q` and the prefix scan for the read | "an ad-hoc filter becomes a new index" | the three-spelling prose; the manual index-derivation loop |
| — | delete `fixtures/quarry-surface/lowered.json` | 3,329 lines of committed generated IR still carrying `__q_where` lowering | the golden |

The thesis is untouched: every certified read is still a bounded prefix scan,
every write still passes the table block, and nothing here admits an
unbounded program. B1 changes the normative typed-state and wire contracts
(LLP 1001 §3, LLP 1002 §4) and says so.

## 0. Not proposed — the price of the thesis, and what the panel deferred

- `while` and recursion. Bounded `for` and `walk … depth N` are the honest
  forms.
- **`fn`, including the guard-and-pure subset.** Revision (a) proposed
  general helpers; the panel showed the general form needs call-by-value,
  hygiene, return control flow, and multi-site diagnostics, and that the
  guard subset deletes too little to earn a keyword: the six repeated
  membership guards use three refusal codes that client tests assert
  (`packages/snapback2/tests/client.test.ts`), so collapsing them is a
  product change, not a language fix. `fn` stays reserved. Revisit with a
  census that collapses without unifying denial codes.
- **Narrowing inside `x != null and R`.** Right operands lower with their
  preludes before the runtime `&&` (`program.ts:319–325`), so a point read in
  `R` would execute unconditionally on an absent `x`. Deferred until
  right-hand preludes are conditionally lowered; `if` narrowing covers every
  site in the corpus.
- Ad-hoc filters, in programs or in the dev tool. `data --filter` was a
  post-filter on a bounded dump — `where` returning through the CLI — and
  is struck. Exploration is `data --index --prefix`, and after B1 `--after`.
- The 50-followee cap on the merged feed, the money and decimal model,
  `#agg` reading zero for an absent or unreadable group, and
  `insertIfAbsent` (ticketed): unchanged, as revision (a) argued.
- A concatenating React `loadMore`. `useQuery` fixes one argument set and
  replaces data (`react.tsx:87–157`); the caller passes `next` back as `c`.

## B1. Opaque cursors

**Today.** A cursor is the suffix tuple of the index after the prefix,
assembled by the client from the previous page's rows: `after (cursorAt,
cursorId) first 20`. `before c last N` is sugar the lowering already turns
into descending `after` (`program.ts:537, 594–598`). Since LLP 1010 A6, a
tuple of optional arguments is an optional group whose mixed presence
refuses. Three refusal families teach the tuple's shape
(`program.ts:539–593`). Every shipped feed then shapes its page, and
shaping retypes the page to a plain sequence (`emitPageShape`,
`program.ts:740–754`; shaped feeds are `T[]` in `api.d.ts`), so the client
must pluck suffix columns the shape may have dropped. Seven distinct paging
expressions exist (nine physical with the `quarry-chat` fixture copy):
chat `globalFeed`/`followingFeed`, Clique `globalFeed`/`followingFeed`/
`chatThread`, surface `postsAfter`/`postsBefore`; the chat template's
`thread` is an unpaged `last 50` with no continuation at all.

**Amendment.**

- **A `cursor` value type.** A delivery whose operation's result is one
  page carries `next: cursor | null` beside `data`, on `complete` and
  `capped` deliveries only (`execution_json`, `writer_wire.rs:8–24`;
  `client.ts` validates it; `denied` and `partial` carry none).
- **The mint rule.** `complete` → `null`. Nonempty `capped` → a token from
  the **last returned row** of the result-page site. Empty `capped` →
  `null`: a hidden run that consumed the budget is terminal, never a
  continuation from an examined position (LLP 1001 §3). No per-site
  `Limit`/`Exhausted` is exposed. A merge whose lanes all exhausted but
  whose union exceeded N is `capped` and therefore mints — from the last
  returned merged row, a new anchor the merge trace records (today it
  records only the union length, `engine/runner.rs`, `DedupeById`).
- **Page provenance.** The compiler tracks the result page from one scan or
  merge through bindings and one-to-one shapes to the top-level `return`,
  and records that site in the certificate as the operation's
  **result-page site**. Two scans in `if`/`else`, a page nested inside an
  object, or a page consumed by `for` yield no site and no `next`; the
  reference says so. A merge's site is the merge site.
- **The token.** Canonical, versioned, tagged: version, table, index, scan
  order, the exact remaining-suffix descriptor, and the suffix values typed
  by the index's columns — because the wire collapses ids and strings
  (`protocol.rs:177–215`) while cursor validation distinguishes them
  (`index.rs:295–359`). Base64url of that encoding; unsigned (a crafted
  token can only re-page a scan the certificate already admits, exactly as
  a crafted tuple could); strict decode with a size bound and canonical
  re-encoding. **Not bound to the site**: a token is a position in an
  index; two operations paging the same index with the same suffix
  descriptor may share one, and a descriptor mismatch is `E_INPUT` before
  any scan.
- **Reads** take `after c` where `c` is an argument typed `cursor ?`:
  `posts[author] after c first 20 by byAuthorAt`. Absent means page one.
  The merge header takes the same; the token's suffix is applied unchanged
  to every lane (LLP 1010 A5). **A pageable merge index must end in
  intrinsic `id`**, certified by Quarry and the certifier: uniqueness of
  `(lane prefix, suffix)` does not make the shared suffix total across
  lanes (the Clique `feedItems` unique index `actor, post, kind` ties across
  actors; its working merge index is `byActorOrd: actor, ord, id`).
- **`before` leaves the grammar.** Forward-only paging meets the loop bar;
  the IR and `lib.d.ts` keep `before` for the lowering target; total-order
  validation of cursored indexes stays.
- **`data --after <token>`** joins `--index`, `--prefix`, `--limit`
  (`verbs.rs:140–188`); the control path already accepts `after`
  (`control.rs:179`) and gains the decoder; `data` prints `next`.
- **Client and React.** `Delivery` gains `next?: string | null` on
  `complete`/`capped`; `api.d.ts` types the argument as `Cursor | null`.
- **LLP 1001 §3 and LLP 1002 §4/§6** are amended in the same change: `next`
  is a receipt-time position of the last returned row, never an examined
  position.

**Deletes.** Tuple cursors in the grammar and their three refusal families;
`before`; LLP 1010 A6's optional group and its mixed-presence `E_INPUT`
(superseded the day it landed, which is the right day); the "scalar sugar"
rule; the client's suffix plucking; first-page-only CLI exploration.

**Cost.** Engine mint and validate; the certificate result-page site and
the merge anchor; the wire field; client and React types; the twin's
identical mint; the compiler's provenance and grammar; the seven paging
expressions and both chat `thread` copies; the journeys that page; LLP
1001/1002 text. `program.ts` is 1,293 of 1,500 lines and `quarry.md` is
13,455 of 14,336 bytes: the provenance pass goes in a new file and the
reference is compressed before anything grows.

## B2. `shape`

**Today.** User functions and shape reuse refuse as `E_QUARRY_UNSUPPORTED`
(`program.ts:453–454`). The same profile projection occurs fourteen times
across the Clique fixture's `social.q`, `chat.q`, and `pay.q`; the chat
template repeats a two-line author card. LLP 0329.014.010 open question 4
asked for exactly this spelling. The TypeScript lowering's helper inliner
(`lower/helper-expansion.ts`) takes a single pure expression and is not a
vehicle for this.

**Amendment.** One module-level declaration, allowed in any operations
`.q` (not `schema.q`), expanded at the Quarry AST level at each use so every
read inside is certified in the calling program:

```q
shape authorCard = { displayName, handle }

query thread(conversationId: conversations, c: cursor ?):
  return messages[conversationId] after c last 50 { *, author: profiles[.authorId] authorCard }
```

- `shape name = { … }` is a projection over the focal row, with the same
  field forms a shape block has.
- A named shape stands wherever a shape block stands: postfix after a read
  (`profiles[.authorId] authorCard`), after a page or row binding
  (`page feedItem`), and as a field value. Inside a shape block,
  `...name` splices the named shape's fields at that position.
- Expansion lives in a new file (`quarry/expand.ts`); a shape that names
  itself, directly or through another, refuses (`E_QUARRY_UNSUPPORTED`);
  depth is capped at 8. A refusal inside an expansion is sited at the
  definition and names the use in its message. `shape`, `fn`, and `cursor`
  are reserved.

**Deletes.** The fourteen repeats and the template's copies; the
"user functions or recursion" refusal keeps its recursion half.

**Cost.** Parser, the expansion pass, printer, guide, tests for cycles and
depth. No platform change.

## B3. One missing-row rule; no `id` in an upsert row

**Today.** Four stories. A by-id `delete` of a missing row is a no-op with a
`missing_preimages` note (`program.ts:806–808`; `runner_ops.rs:118–126`); a
by-id `update` of a missing row leaks the platform's `E_INPUT`
(`runner_ops.rs:49–56`); a focal by-id update lowers to a real `Get` and
synthesizes `UPDATE_ROW_MISSING` (`compiler.ts:690–705`); an alternate-key
update or delete reads the unique index and requires `NOT_FOUND`
(`program.ts:859–865`). The reference admits that key spelling changes the
outcome. Upsert rows may spell `id: new` (the minted form) or an authored
`id`, guarded by `UPSERT_ID_IN_USE` and `UPSERT_ID_MISMATCH`
(`program.ts:880–908`).

**Amendment.**

- **Inside the write primitives, not with a visible read.** The engine's
  `update` and `delete` raise the authored-style `NOT_FOUND` when the
  addressed row is missing; the evaluator twin does the same; the focal
  update's `UPDATE_ROW_MISSING` becomes `NOT_FOUND`; the alternate-key forms
  keep their read (they need it to find the id) and already say
  `NOT_FOUND`. A read-ruled pre-read was revision (a)'s mechanism and is
  wrong: it would turn write authority into read-and-write and break tables
  like the chat template's `notifications` (`read <- deny`,
  `update <- system`).
- **The receipt-only twin's three-way rule:** a held row → the ordinary
  path; an authoritative by-id absence → `NOT_FOUND`; an unheld row →
  `partial` ("missing-authority"). That is what lets `missing_preimages` and
  the maintained-target tainting it fed be deleted.
- **Upsert keeps its absent branch** — absence means insert; only the
  present branch updates. An upsert row may not spell `id` (`E_QUARRY_TYPE`,
  drop-field rewrite): by-id upsert derives identity from its key,
  alternate-key upsert keeps the present row's id or mints. Pre-minting an
  id to reference from a second row stays an `insert`.
- **Named, not fixed:** a by-id write to an *unreadable* row is `E_RULE`
  while an alternate-key write to one is `NOT_FOUND`. That is the
  existence-oracle family of LLP 0329.014.004 dimension L, pre-existing,
  and out of scope here. An idempotent double `delete` becomes `NOT_FOUND`;
  that is the point.

**Deletes.** The no-op, the platform-code leak, `UPDATE_ROW_MISSING`, the
two `UPSERT_ID_*` refusals, the minted form, `missing_preimages`, the
key-spelling sentence.

**Cost.** Two engine primitives, the twin, corpus cases for each write form
on a missing row, the compiler's upsert branch and focal-update code, the
guide.

## B4. Narrowing on `if x != null:`

**Today.** No flow-sensitive narrowing (LLP 1010 A2 waited for evidence);
the Clique fixture carries `if m.lastDeliveredAt != null:` followed by
`m.lastDeliveredAt! >= upTo` at three watermark sites (`chat.q:83–98`).

**Amendment.** `if x != null:` narrows `x` to non-optional in its `then`
branch, where `x` is a bound name or **one** field of a bound row. Soundness
rests on binding identity, not spelling: the lowering already clones the
environment per branch (`Environment.clone`, `program.ts:56–62`), the
narrowing attaches to the binding object in the clone, and a shadowing
rebind replaces the object and drops the narrowing (`bindings.set`,
`:118–119`). A one-hop field of a bound row is a property access on a
snapshot value, not a dereference (`emitMember`, `:409–433`), and a later
`update` does not mutate the bound value. Conjunct narrowing is deferred
(§0). No assertion is emitted, so the `!`-before-`&&` hazard LLP 1010 A2
recorded does not arise.

**Deletes.** The nested-`!` idiom, its paragraph in A2's migration note,
and the `!` at the three sites.

**Cost.** One environment feature and tests; nothing on the platform.

## B5. Whole-unit seeds

**Today.** `project-seed.ts:76–77` requires decimal and money seed values to
be safe-integer minor units, while Quarry literals are whole units (`2.50`
in a `money USD` position is `250`). `lowerSeed` validates and returns the
rows unchanged (`project.ts:307–325`). The todos fixture seeds `price: 999`;
`verified-regression-tests.ts:1252–1263` pins the invalid-seed refusal; the
generated Pay seeds live in `crates/snapback2/tests/quarry_pay.rs:160–217`.
No money-fixture `seed.ts` exists.

**Amendment.** Seed values for decimal and money columns are whole units —
a number or a decimal string — and the seed validator **normalizes** them
to minor units by the column's declared scale, recursively through optional
and list values, on an exact character path (BigInt), refusing more
fractional digits than the scale with the literal's message. The engine
still stores minor units; **wire arguments stay minor units** (the reference
keeps that sentence).

**Deletes.** The seed-only minor-units exception.

**Cost.** The normalization pass, exact scaling, the three migrations above,
a test per column kind.

## B6. The refused `where` as a two-site repair

**Today.** `where` refuses in the parser before its predicate is built
(`parser.ts:639–644`), and `compileQuarry` returns on parse diagnostics
before the catalog exists (`quarry/index.ts:34`), so no index proposal can
be computed there. The refusal names three spellings in prose.

**Amendment.** The parser keeps the predicate as diagnostic-only intent on
the read; a post-catalog analyzer refuses with **two sited one-line
rewrites**: at `schema.q`, the index line (the read's prefix columns, then
the predicate's `.column = value` columns in source order and deduplicated
against columns already in the prefix or suffix, then the existing suffix,
ending in `id` or unique; a conventional, collision-free name; the
platform's eight-column bound); at the read, the prefix scan over that
index. A compatible existing index is reused instead of proposed. If the
predicate is not a conjunction of `.column = value` on indexable scalar
columns, or the derivation is uncertain, the refusal keeps today's prose.
Two sited refusals in one compile is the shape the non-total cursor index
already uses.

**Deletes.** The three-spelling prose and the manual index-derivation loop.

**Cost.** Parser intent, one analyzer, tests for the conjunction, the reuse
case, and each fallback.

## 6a. Cleanup

`snapback2/packages/compiler/fixtures/quarry-surface/lowered.json` (3,329
lines) is a generated lowering golden no test reads (the checks call
`lowerProject` live) and it still carries `__q_where` lowering deleted by
LLP 1010. `rules/NOT-DOING.md` says generated projections are built, not
committed. Delete it.

## 7. Migrations, enumerated

| Site | Change |
|---|---|
| chat `feeds.q` (+ fixture copy), Clique `social.q` (`globalFeed`, `followingFeed`), `chat.q` (`chatThread`), surface `postsAfter` | one `c: cursor ?` argument; `after c`; `before` gone |
| chat `messages.q` `thread` (+ fixture copy) | pages with `c` |
| surface `postsBefore` | folded into `postsAfter`, or deleted |
| journeys that page (`tests/chat.test.ts`, Clique tests) | page through `next` |
| Clique `social.q`, `chat.q`, `pay.q`; chat `feeds.q` | named shapes replace the fourteen repeats and the author card |
| Clique `chat.q:83–98` | drop `!` under the presence branch (B4) |
| surface `surface.q` alternate-key upsert with authored `id` | drop the `id` (B3) |
| `fixtures/todos/snapback/seed.ts`, `verified-regression-tests.ts:1252–1263`, `quarry_pay.rs:160–217` | whole units (B5) |
| `guide/quarry.md`, `grammar.md`, `families.source.json`; LLP 1001 §3; LLP 1002 §4, §6 | cursors, `next`, `shape`, one missing-row rule, narrowing, seeds, the two-site repair |

## 8. Sequencing

Two sequential codex lanes on `s2/quarry-ergo`, each leaving
`scripts/test.sh` green:

| Lane | Items | Why |
|---|---|---|
| 1 — notation and primitives | B2, B3, B4, B5, B6, §6a | compiler and guide, plus two engine write primitives and the twin; no wire change |
| 2 — cursors | B1, `data --after`, the `thread` migration, LLP 1001/1002 text | the wire, certificate, engine, client, twin, grammar, and migrations that all depend on the token |

## 9. Panel record

Round 1 was blind on an identical brief; round 2 a cross-read with seven
enumerated disagreements. Both families returned NOT READY on revision (a)
and READY-after-changes on the same list; revision (b) is that list.
Records: `llp/reviews/1011-quarry-ergonomics.{codex,grok}.md` (both rounds
verbatim), `.panel.brief.md`, `.panel.synthesis.md`.

What the panel changed, and who found it:

- **B1's mint rule was wrong** (grok's two cases, codex's opacity): revision
  (a) minted on `Limit`; an empty capped page must not continue from an
  examined position, and a truncated merge must mint from the last returned
  row. **Page provenance through shapes** (both): shaping retypes the page,
  so "the returned value is a page" matched no shipped feed. **The token
  needs typed values** (codex): the wire collapses ids and strings.
  **Not bound to the site** (author's lean; both agreed in round 2).
  **Merge index ends in `id`** (codex; grok confirmed with the `feedItems`
  counterexample). **Census** seven, not thirteen (both). **`thread`
  pages** (grok). **`data --after`** (codex; placed with B1 by codex).
- **`fn` deferred** (codex in both rounds; grok changed in round 2 on the
  deletion count and the client-asserted codes). `shape` kept (both).
- **B3 moved into the write primitives** (codex; grok changed on the
  `notifications` counterexample); the fourth story `UPDATE_ROW_MISSING`
  (codex); the twin's three-way rule and the `missing_preimages` deletion
  (codex); the unreadable-row residual named (grok).
- **B4 narrowed** to `if` on binding identity and one hop (both); conjunct
  narrowing deferred on the prelude argument (codex).
- **B5 corrected**: the validator must normalize, exactly; the real
  migrations; wire arguments unchanged (both).
- **B6's `--filter` struck** (both); the index repair made catalog-time and
  two-sited (codex's mechanics, grok's shape).
- **The stale golden** (codex).

## Non-claims

This does not change `rules/NOT-DOING.md`, does not build the fan-out feed
table, does not add `fn` or `insertIfAbsent`, does not publish anything, and
does not change Snapback 1. Per `rules/RULES.md` it binds when the code in
§8 runs; the implementer and lane are in the header.
