# LLP 1011: Quarry ergonomics — opaque cursors, named shapes, one missing-row rule, narrowing, whole-unit seeds, a repair for the refused filter

**Type:** RFC
**Status:** Implemented (under the author's standing instruction of 2026-09-03,
"revise until you are happy with it, then if you think it's good, implement
the changes": revision (b) is the version both panel families marked READY;
implemented and landed the same day, §8)
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
**Revised:** 2026-09-09 (final header normalization and explicit decimal values, implemented by GPT-6 Astra); 2026-09-08 (one spelling third repair: scope the write-refusal oracle to shared owner denial; preserve independent write authority and absent upsert insertion); 2026-09-08 (one spelling second repair: exact compiler receipt sites, point-read guide scope, carrier test headroom, historical lowering/budget references); 2026-09-08 (one spelling review fixes: maintained reference repairs, source word dispatch coverage, engine/twin numeric and visibility evidence); 2026-09-08 (one spelling: commissioned B1–B6, implemented by GPT-6 Astra in lane B); 2026-09-08 (one cursor-bearing page through composite records); 2026-09-08 (statement helpers, LLP 1018.005); 2026-09-07 (expression helpers refuse authorization assertions throughout nested shapes); 2026-09-07 (typed bound shape/function elaboration and one decimal representation); 2026-09-06 (session-delegated Unicode key/cursor integration contract, foundation only); 2026-09-06 (nested named-shape collection snapshots implemented by GPT-6 Astra; conditional page returns implemented by GPT-6 Astra; certification-derived provenance); 2026-09-05 (null keys and non-empty Id literals implemented by GPT-6 Astra, Clique L2); 2026-09-05 (d — Codex implements imported shapes, read-authorized
write results, and order-preserving filter repairs under the author's request
to advance Quarry); 2026-09-03 (c — implemented: §8 records the two lane commits
and the one re-pinned expectation); 2026-09-03 (b — after the panel: `fn` deferred and `shape` kept;
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
| B2 | `shape name = { … }` plus acyclic expression-only `fn`, instantiated by typed bound elaboration | repeated projections, membership predicates and bounded fanout reads | the repeats, copied membership/fanout expressions, AST expansion and generated data modules |
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
  census that collapses without unifying denial codes. **Superseded
  2026-09-07:** real chat migration found reusable membership predicates and
  bounded membership reads while callers retained their own refusal codes.
  The implemented form below is expression-only and read-pure.
- **Historical, superseded 2026-09-08 by §One spelling:** the deleted TS lowering's
  unconditional right-hand preludes once prevented `and` narrowing; `bound.ts`
  now narrows the right operand and `direct.ts`'s `lowerBinary` runs its preludes conditionally.
- Ad-hoc filters, in programs or in the dev tool. `data --filter` was a
  post-filter on a bounded dump — `where` returning through the CLI — and
  is struck. Exploration is `data --index --prefix`, and after B1 `--after`.
- The 50-followee cap on the merged feed, the money and decimal model,
  `agg[key]` reading zero for an absent or unreadable group (the old `#agg`
  spelling is superseded 2026-09-08 by §One spelling), and
  `insertIfAbsent`: deferred in this revision; the 2026-09-09 platform
  amendment implements `insert ... if absent` under LLP 1001 §3.
- A concatenating React `loadMore`. `useQuery` fixes one argument set and
  replaces data (`react.tsx:87–157`); the caller passes `next` back as `c`.

## B1. Opaque cursors

**Historical baseline (2026-09-03, superseded below).** A cursor was the suffix tuple of the index after the prefix,
assembled by the client from the previous page's rows: `after (cursorAt,
cursorId) first 20`. `before c last N` is sugar the lowering already turns
into descending `after` (deleted `program.ts:537, 594–598`). Since LLP 1010 A6, a
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

- **A `cursor` value type.** A delivery whose operation returns one
  certified page, directly or through record fields, carries
  `next: cursor | null` beside `data`, on `complete` and
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
- **Page provenance (implemented amendment, 2026-09-06).** The Rust
  certifier derives a map from structural return paths to result-page sites
  directly from the IR. The compiler's single-site hint and duplicate
  provenance pass are removed. Each `if`/`else` or early-return branch can
  return its own range or merge, through branch-local bindings and one-to-one
  shapes, including nullable point enrichment. The engine and twin select the
  map entry for the return that actually executed; an auxiliary page read
  cannot select the cursor. The uniqueness proof visits every evaluated operand,
  including `Get`/`Exists` keys, scan prefixes and bounds, and merge discovery
  and lane operands. A repeated result-page site refuses with `E_TRACE_SUBSET`
  even when its expressions are identical: reassigned bindings can make their
  runtime positions differ. An overlong prefix also refuses page derivation
  without losing the structural checker's accumulated diagnostics.
  A shape collector must start empty and receive
  exactly one unconditional push per row without early exits or other writes.
  **Composite amendment (2026-09-08):** record fields, nested records,
  field extraction and value aliases transport page provenance. A record has
  one continuation only when it contains one distinct supported page origin
  continued through an argument typed `cursor` or `cursor ?`. Repeating that
  same page in several fields is unambiguous. A fixed preview without a
  cursor argument is auxiliary, even when evaluated after the returned page.
  Two distinct cursor-bearing origins, even through the same cursor argument,
  produce `next: null`; there is no designated field or multiple-cursor format.
  An unproved returned cursor binding also prevents continuation; it cannot
  be treated as an uncursored fixed preview.
  Reassigning or pushing into a binding kills its provenance; earlier value
  copies retain theirs, matching the native and twin value semantics.
  Array wrapping (`other: [page]`), truncation/reordering and other derived
  collections carry no supported page provenance. This is a record-field
  proof, not a detector for every scan contained in a returned value. Such
  siblings do not contribute a continuation candidate; a supported page in
  another record field can still supply the one `next`. An unexecuted merge is not
  counted as an unfinished union. The return path stays internal; result
  shapes need not expose index columns and receipts gain no hidden position.
  The mint rule stays global: a fixed preview can keep the composite `capped`
  after the selected page exhausts. A nonempty selected page can then yield
  one extra request; its empty successor has `next: null` even when the
  preview is still capped. No preview row or hidden examined row becomes the
  continuation anchor. An object result remains unsupported for resume/drain;
  those require the existing direct ascending log page (LLP 1012 §6).
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
  the selected page or its merge lane discovery opens, even when discovery
  would find no lanes. Canonical decoding of cursor arguments still happens
  before execution. Scope validation follows executed control flow: a token
  need not match an unselected branch's different index.
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
1001/1002 text. The 2026-09-03 budget estimate was 1,293/1,500 lines
for the now-deleted `program.ts` and 13,455/14,336 bytes for `quarry.md`.
That implementation split is historical. Current cursor/range lowering lives
in `quarry/direct.ts`; `quarry/bound.ts` binds its types, and native
certification supplies page provenance. Current caps and guide budgets apply.

### Unicode search cursor integration (2026-09-06 session decision)

LLP 1001 §"Unicode search foundation" supplies preparatory component/key types;
it does not yet change Quarry's accepted index declarations or existing cursors.
The downstream `wordPrefixes` component is equality-bound and absent from the
ordered suffix. Server cursors keep their typed ordinary suffix, size limit and
site-free identity. A derived binding does not bind the source column for rules.

LLP 1012 §"Indexed held search" specifies a distinct local `h1` continuation,
exact query bindings and revision/partition/incarnation fences. Server preflight
rejects it before any discovery; ordinary partial results still have no cursor.
Compiler migration must price independent query text Q, optional indexed fields,
and key semantic equality together with the engine; the foundation alone does
not make a new word valid in the grammar. B6 repairs may propose the new index
only after that coherent integration; the current repair behavior stays active.

## B2. `shape`

**Historical baseline (2026-09-03; `program.ts` is now deleted).** User functions and shape reuse refused as `E_QUARRY_UNSUPPORTED`
(`program.ts:453–454`). The same profile projection occurs fourteen times
across the Clique fixture's `social.q`, `chat.q`, and `pay.q`; the chat
template repeats a two-line author card. LLP 0329.014.010 open question 4
asked for exactly this spelling. The TypeScript lowering's helper inliner
(`lower/helper-expansion.ts`) takes a single pure expression and is not a
vehicle for this.

**Amendment.** One module-level declaration, allowed in any operations
`.q` (not `schema.q`), instantiated at each use so every
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
- Expansion lives in the typed bound elaborator; a shape that names
  itself, directly or through another, refuses (`E_QUARRY_UNSUPPORTED`);
  depth is capped at 8. A refusal inside an expansion is sited at the
  definition and names the use in its message. `shape`, `fn`, and `cursor`
  are reserved.

**Deletes.** The fourteen repeats and the template's copies; the recursion
refusal remains.

**Cost.** Parser, bound elaborator, guide, tests for cycles and depth. No
platform change.

### Statement helpers (2026-09-08, LLP 1018.005)

`proc name(arg: type, …):` and an indented block declare a module-local
statement helper; `proc name from module` imports it; `name(args)` on its own
line calls it. The body elaborates at each call under the caller's program:
arguments bind once as for `fn`, caller locals are invisible, writes, `emit`,
and `require` bind where the caller allows them (a `require` inside a proc
refuses the caller with its own code), `return` refuses, effect names resolve
in the proc's module, and a parameter's declared type is the bound the
certificate prices. `fn` stays expression-only. The chat recipe's delivery
fan-out is one `proc deliver` used eight times. Decision and review record:
LLP 1018.005.

### Expression-only functions (2026-09-07)

`fn name(arg: type, …): expression` declares a module-local typed helper;
`fn name from module` imports the same declaration from `module.q`. Calls are
acyclic and expand to one bound expression. Actual arguments evaluate once,
left to right, before the body; parameters and all generated temporaries have
fresh symbol identities. A helper can use its parameters and read-pure context
(`viewer`, query `now`/read time), and may perform bounded reads. It cannot
capture caller locals or a caller shape's focal row, allocate `new`, use commit
time, write, emit, or assert presence/authorization with `!` or `! else CODE`. A named shape
reached by the helper inherits that purity boundary. Shape and function frames
share depth 8 and 4,096-node limits, retain definition plus use sites, and
refuse cycles. Callers keep their own `require … else CODE` or `! else CODE`,
so reuse does not collapse public refusal identities.

### Shape imports and hygiene (2026-09-05)

`shape card from cards` imports the named projection from `cards.q`. A module
may contain only shapes/imports; it creates no operation or generated API
namespace. Names remain module-local, including nested shape dependencies in
the definition. Imports can re-export, but cycles refuse across module
boundaries. Definitions may use the focal row, context built-ins, and their
own bounded merge binders; they never capture caller arguments or locals.
Expanded instances receive distinct temporaries while retaining definition
and use sites. The depth-8 limit is joined by a 4,096-node expansion bound so
a broad acyclic shape cannot explode the compilation work. The Clique fixture
shares its author and feed cards across modules as executed coverage.

Nested collection fields use an explicit spread copy at the generated binding
that preserves the field's diagnostic site. That binding must not alias the
mutable shape collector (LLP 1002 §2's collection mutation ruling); internal
name spelling grants no exemption. Each expansion and enclosing row iteration
keeps its own collection, including when a named shape contains both point
enrichment and another named collection shape. Every nested read still counts
toward the certificate and obeys its read rule; a nested page cannot take over
the enclosing result's cursor. The compiler regression covers local/imported
message cards in history, inbox recent-message pages, and repeated point uses.

## B3. One missing-row rule; no `id` in an upsert row

**Historical baseline (2026-09-03; `program.ts` is now deleted).** Four stories. A by-id `delete` of a missing row is a no-op with a
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
- **Existence oracle (scope corrected 2026-09-08):** when the same owner
  predicate denies read and update/delete, by-id yields `E_RULE` while
  alternate-key yields `NOT_FOUND`. This supersedes the categorical
  unreadable-write claim: read and write authority are independent. An ignored
  by-id update with `read <- deny` and `update <- allow` writes without a
  `Get`; alternate-key upsert retains its insertion path when lookup returns
  absence. The existing owner-predicate update refusal test in
  `quarry-direct-contract-checks.ts` establishes the narrower oracle, in
  LLP 0329.014.004 dimension L. An idempotent double `delete` becomes `NOT_FOUND`.

**Deletes.** The no-op, the platform-code leak, `UPDATE_ROW_MISSING`, the
two `UPSERT_ID_*` refusals, the minted form, `missing_preimages`, the
key-spelling sentence.

**Cost.** Two engine primitives, the twin, corpus cases for each write form
on a missing row, the compiler's upsert branch and focal-update code, the
guide.

### Consumed write results (2026-09-05)

An update or upsert used as a value, including a body's implicit return,
performs an immediate post-write `Get` by its once-evaluated intrinsic id.
The value is a snapshot of the row if its read rule admits the caller, else
absence. A self-revoking write can commit and return absence; asserting the
result with `! else CODE` instead rolls the mutation back. Returning a result
never grants read authority merely because write authority was granted.
An ignored write statement adds no read, preserving write-only operations.
The existing IR and certificate account for the consumed form's extra read;
there is no new engine write primitive. Insert keeps its authored-row result;
delete remains effect-only. The strict `NOT_FOUND` missing-write contract is
unchanged. This implements the result ergonomics deferred by LLP 1010 §0.

## B4. Narrowing on `if x != null:`

**Today.** No flow-sensitive narrowing (LLP 1010 A2 waited for evidence);
the Clique fixture carries `if m.lastDeliveredAt != null:` followed by
`m.lastDeliveredAt! >= upTo` at three watermark sites (`chat.q:83–98`).

**Amendment.** `if x != null:` narrows `x` to non-optional in its `then`
branch, where `x` is a bound name or **one** field of a bound row. Soundness
rests on binding identity: `quarry/bound.ts`'s `narrowedScope` clones the
bound-symbol scope, preserving each symbol ID and refining its type or
`narrowedMembers`; a shadowing declaration binds a fresh symbol.
`quarry/direct.ts` maps symbol IDs to IR values. Its `lowerExpression`
member arm reads a bound row snapshot; a later `update` does not mutate
that snapshot. The original deferral of conjunct
narrowing is **superseded 2026-09-08 by §One spelling**: the direct lowering
conditionally executes right-hand preludes. The else branch of `if x = null`
and the remainder after a successful `require x != null` narrow too.

**Deletes.** The nested-`!` idiom, its paragraph in A2's migration note,
and the `!` at the three sites.

**Cost.** One environment feature and tests; nothing on the platform.

### Null keys and Id literals (2026-09-05)

Implemented by GPT-6 Astra under the Clique L2 brief: `null` selects the null
group wherever the corresponding key column is optional, including maintained
lookups, point reads, `exists`, and capped groups; a required column refuses
null and names the requirement. Omitted and explicit-null groups agree across
SQLite, maintained aggregates, and the twin. Equality against null inside a
write object is still a Boolean comparison, not a required Id sink.
A non-empty text literal is an Id in named and positional keys (including merge
prefixes), equality, and `??` fallbacks; computed text and references to another
table refuse. The
lowering's typed tuple cursor positions retain the same literal rule; authored
Quarry `after` uses B1's opaque token and cannot take an Id literal.
Optional list domains in `for` require `?? []` or B4's presence narrowing;
their declared maxima survive aliases, shapes, and the empty default. This
refuses absence at compile time instead of allowing a runtime array type error.

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

The same single-representation rule now applies inside a typed Quarry
expression. When an optional `[decimal 3]` value uses `[2, 3]` as its `??`
fallback, the fallback is normalized once to `[2000, 3000]` at the typed
boundary. The captured result, returned result, and any stored copy all carry
those minor units. A supplied wire argument `[1250]` remains `[1250]`, and a
plain uncontextualized `[2, 3]` remains an integer list. This corrects the old
generated path's split behavior where the same fallback returned `[2, 3]` but
stored `[2000, 3000]`.

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

**Repair correctness (2026-09-05).** Equality terms may put the focal column
on either side. Rewrites preserve all-named or all-positional keys and the
original varying suffix order after pinning predicate columns. An existing
index is reusable only when its full column order matches that derivation;
a matching prefix alone is insufficient. Row-dependent expressions, reads,
assertions, fresh IDs, and non-scalar asset/list predicates keep the honest
fallback instead of being hoisted into a prefix. Repaired paged projections
are compiled, certified, and executed through two pages in the regression
suite. A caller discards any old token when changing the index.

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

## 8. Sequencing and landing record

Two sequential codex gpt-5.6-sol (xhigh) lanes on `s2/quarry-ergo`, each
verified out of sandbox by the orchestrator before commit. Both lanes wrote
their reports incrementally, as the LLP 1010 stall taught, and neither
stalled.

| Lane | Items | Commit | Out-of-sandbox suite |
|---|---|---|---|
| 1 — notation and primitives | B2, B3, B4, B5, B6, §6a | `d58c89d76` | 371/371 Rust, 126/126 evaluator, 290/290 compiler |
| 2 — cursors | B1, `data --after`, the `thread` migration, LLP 1001/1002 text | `c91e51938` | 375/375 Rust, 130/130 evaluator, 289/289 compiler |

The orchestrator's one hand edit after lane 2: the chat template receipt test
pins the interpreter step count of `messages.thread`; the thread now pages, so
an admitted execution costs one more step (7 → 8).

**Historical budgets at the 2026-09-03 landing.** The now-deleted
`quarry/program.ts` was 1,247 of 1,500 lines;
`guide/quarry.md` 13,509 of 14,336 bytes; `guide/grammar.md` 2,032 of 2,048 —
both guide pages shrank when tuples, `before`, the optional group, and three
refusal families left. No budget was raised.

**At that landing (2026-09-03).** The reference (`snapback2 guide quarry`) states the
implemented language; the corpus carries 130 cases including eight
opaque-cursor and five missing-row cases; LLP 1001 §3 and LLP 1002 §4/§6
carry `next` and `data --after`; LLP 1010's A6 is marked superseded. This
document lands with no working-set link — the work it commissioned is done.

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

## One spelling

**2026-09-08, commissioned rulings.** The following text is plan.md §B of
the Snapback 2 elegance program, delegated by the author to the orchestrator.
It supersedes older spellings and narrowing deferrals in this document and LLP 1010.

B1. Absence. `x ! else CODE` is the one must-exist spelling; a bare `!` is refused with the rewrite. `match … some/none` is deleted (parser, binder, lowering, printer, guide, `guide.rs` pin, the two fixtures rewritten to `if`). `if x != null:` / `if x = null:` is the one branching spelling, and it narrows: the else branch of `if x = null:` (x non-null), the right operand of `and` (`x != null and x.body = body`), and the rest of the block after `require x != null else CODE`. `??` stays (defaulting is not absence branching). Ordered comparison on an optional still refuses until narrowed.
B2. Maintained reads. A point read of a maintain, `messageCounts[conversationId]`, yields the typed value with typed zero when absent; that is the only form in a program. `#` is deleted for maintains and for `connected` (`connected[p]` yields the int count; `exists connected[p]` stays). `api.d.ts` types the read as the value (`number`), never as a row. The `data` verb and rules still see maintain rows.
B3. Index naming. Every index is declared with its name: `by name: columns`, `unique name: columns`. The `by column` shorthand and unnamed `unique a, b` are refused, the rewrite spelling the inferred name (`by byOwnerId: ownerId`). Resolution at a read is unchanged: implicit by key types/arity when exactly one index matches, `by name` otherwise.
B4. `walk table[seed] up .column depth N` stays, with its grammar bullet, its `guide.rs` pinned definition, and one sentence on `quarry.md`.
B5. Freeze. **2026-09-10, LLP 1019 D6:** `tombstones` leaves the word inventory; `deliver`, `to`, `as`, `with`, `receipts`, and `bootstrap` are its six-word declaration replacement. A compiler test pins the complete inventory of significant words (declaration, table-body, rule, statement, range, builtin, type, modifier words — everything the lexer or binder gives meaning to) as one sorted literal; the grammar page's construct count stays pinned (23: minus `match`, plus `walk`). Adding a word means editing the literal and writing the one-line why in `rules/NOT-DOING.md` § Moves.
B6. Every `.q` in the repository (templates, corpus, fixtures, guide snippets, benchmarks) follows B1–B3; corpus regenerated; diagnostics families that mention `#`, `match`, or the shorthand updated; byte budgets respected (deletions free bytes; raise none).

**Implementation.** The AST, parser, binder and lowering have no `match` form;
`#` is no longer a token. A materialized maintain marks its catalog table so
only its point reads bind as a numeric aggregate; ordinary tables with a
`value` column remain row reads. The existing engine/twin row get, null
check and typed zero implement the value read, preserving authority and
same-mutation writes. Implicit typed-reference row projections and member
access, including aliases and named shapes, refuse in `bound.ts`'s `shapeBase`
with a canonical bracket-read repair, including `counts[c ! else CODE]`
for optional references. Count, money and decimal API regressions compile the repairs.
The shared corpus covers grouping-index and by-id absence, existing and
new-group same-mutation counts and branded sums, and unreadable groups.
Hidden rows contribute no payload or absence to the receipt. The server
returns typed zero; receipt-only replay computes the same value but remains
partial at each uncovered point, never a falsely established zero. Compiler
lowering replays those native typed results and custody states. The second
repair pass pins count/money/decimal grouping Gets at `probe.valuesFor.0`,
`.1`, and `.2`: all three partial for unreadable custody, none partial for
the fresh absent-group receipt. Bounded maintained ranges retain rows/pages;
only program point reads and their API types yield values. Carrier tests
retain the public-wire refusal of alternate-index absence proofs.
Names and one-hop fields narrow by binding identity on the proven path.

**Third repair (2026-09-08).** The guide and B3's oracle warning now cover
only update/delete denied by the same owner predicate as read. Independent
write authority and upsert's absent insertion path remain explicit. This is
a prose correction within the unchanged guide budget; runtime, tests, corpus,
point/range semantics, and optional-reference repairs remain unchanged.

**Source word freeze (review revision, 2026-09-08).** One sorted literal pins
123 words. The extractor scans `src/quarry/*.ts` for literal equality/inequality
comparisons and switch labels on `value`, `name`, `table`, or `column` properties
(dot/bracket access), contextual `name`/`unit`/`policy` variables and their
initializer aliases; parser `this.at/take/maybe` calls; literal array/Set/Map
lookups; lexer word arrays; and intrinsic `name` declarations in catalog/index.
It includes refused words and reserved API module names (`channels`, `op`,
`then`, `toJSON`), not just accepted grammar keywords. Regression probes exercise
switches, aliases, equality and lookups. This is a source-AST freeze, not a runtime
census: computed strings, regex dispatch, cross-file aliases and dispatch outside
that directory are not inferred. New dispatch mechanisms must extend this same
extractor; adding a significant word still requires the B5 literal and Moves edit.


## Final grammar pass (2026-09-09)

The user commissioned the remaining header, numeric and retention-token warts
as the last small grammar pass. `:` now separates declarations from their body:
`fn twice(n: int): n * 2`, `proc deliver(...):` with its block, and
`maintain counts: count messages by conversationId` with indented read rules.
The maintain aggregate line has no second trailing colon. Queries, mutations,
procs and jobs always declare arguments in parentheses, including `job sweep():`.
Schedules have one inline target call, `schedule daily every 24h: sweep()`;
the bare target and indented target alternatives are deleted. Imports retain
`fn name from module` and `proc name from module` because they declare no body.
Named shapes retain their value-definition spelling `shape name = { fields }`.
The existing significant-word test and explicit accepted/refused header cases
freeze these spellings; no second grammar gate is added.

Retention policy words are single reserved lexer tokens in every context.
The parser controls where they are accepted; they cannot name bindings.
Ordinary `a-b` subtraction is unchanged.

A fractional literal infers its exact scale (`2.50` is `decimal 2`) even in a
standalone return or binding. It still uses safe integer minor units in IR and
on the wire; generated result types retain the scale. A contextual money or
decimal destination may type a literal, but a bound value keeps its descriptor.
Nonzero integer literals with a positive-scale destination refuse with `2.0`
as the explicit whole-decimal-unit repair. Zero and scale-zero destinations
are unambiguous. Integer aliases and defaulted integer lists never rescale:
`values ?? [2,3]` refuses for decimal lists; `[2.000,3.000]` explicitly names
decimal-3 values. The unused late scale/list-scale bound nodes and their lowering
are deleted. Whole-unit seed JSON normalization remains the B5 contract above.

### Bounded text slices (2026-09-09)

`slice(text, start, end)` exposes the existing IR `Slice` builtin for present
text. Positions are Unicode scalar values, matching text-column bounds in LLP
1001 §9; the end is exclusive and negative positions clamp to zero. Literal
endpoints narrow the inferred output maximum, so an application can derive one
`text <=80` value and use it unchanged for a stored preview and an emitted
payload. Dynamic integer endpoints remain sound at the input text's maximum.

### Period schedule bindings (2026-09-09)

An `every` schedule exposes only `.periodStart` and `.periodEnd`, both `time`,
to its target binding. They are the logical timer-occurrence boundaries, not
the possibly late fire clock. A multi-chunk job can therefore carry one pinned
cutoff across all sweeps. Zero-argument period schedules remain valid; row
schedule fields and bindings are unchanged.
