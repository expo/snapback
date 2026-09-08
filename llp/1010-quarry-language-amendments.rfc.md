# LLP 1010: Quarry amendments — words for writes, total equality, one row binder, no `where`, a merged feed, an opaque cursor, one modifier order

**Type:** RFC
**Status:** Implemented (author, 2026-09-03 in session: "once you've revised
the RFC to your liking, go ahead and implement the changes" — revision (b),
after the two-family panel recorded in §9; landed the same day, §8)
**Systems:** Authoring surface (`snapback2/packages/compiler/src/quarry/`), the
Quarry reference (`snapback2/packages/snapback2/guide/quarry.md`,
`guide/grammar.md`), the `quarry` diagnostics family and
`guide/families.source.json`, templates (`todos`, `chat`), the Quarry fixtures;
for A5 and A6 the certificate (`snapback2-core/src/certificate*.rs`), the
engine's state derivation (`engine/mod.rs`), and the corpus
**Author:** Claude Fable 5.1 (proposal and revision), commissioned by Charlie
Cheever 2026-09-03 in session, from a reading of the language as shipped at
`18b69426b`; revised after a blind two-family panel (codex gpt-5.6-sol at ultra,
grok-4.6 at xhigh), `llp/reviews/1010-quarry-language-amendments.*`
**Implementer:** codex gpt-5.6-sol (xhigh), lane `s2/quarry-amend`
(`~/projects/snapback-s2`), orchestrated and landed by Claude Fable 5.1
**Date:** 2026-09-03
**Revised:** 2026-09-07 (`sorted` canonical pair order and once-only operand evaluation); 2026-09-07 (typed direct compiler supersedes the two-hop non-proposal); 2026-09-06 (pooled logical merge streams and bounded shared seek template); 2026-09-05 (Clique L10 — lazy merge implemented by GPT-6 Astra); 2026-09-05 (time arithmetic and divmod tuple rules implemented by GPT-6 Astra, Clique L2); 2026-09-03 (d — A6's optional cursor group was replaced by LLP
1011 B1's opaque, forward-only cursor); 2026-09-03 (c — implemented: §8 records the two landing commits
and the one departure from the brief, the guide budget); 2026-09-03 (b — after the panel: bounds-first withdrawn; A2
restated as program-only because rules and the IR already compare totally;
`where` is deleted instead of fenced; merge gains the table-in-header block
form, a self lane, the shared-suffix cursor, id-dedupe, a certificate merge
site for truthful completeness, and an honest cost; the optional cursor group
(since replaced by LLP 1011 B1) and one canonical modifier order are added; `insertIfAbsent` deferred to a
ticket; every fact the panel corrected is corrected here); 2026-09-03 (a —
initial draft, pre-panel)
**Related:** LLP 1004 (Quarry is the only surface; the spec-truth rule), LLP
1007 §8 (the previous panel's reading of the language), LLP 1000, LLP 1001
(typed states, the trace, the certificate), LLP 0329.014.004 (the design: §1
`merge(prefixes)`, §2.1-A, §9 the standard library), LLP 0329.014.010 (§2.2 the
pincer, §2.4 the NULL trap, §2.5 the verdicts), `rules/RULES.md`,
`rules/NOT-DOING.md`, `benchmarks/briefs/social-messenger.md` (M2 items 2 and
8), `spikes/clique-diagnostic-runs/brief-diagnostic.md` (item 7),
`snapback2/packages/compiler/fixtures/quarry-clique/`,
`snapback2/packages/snapback2/templates/chat/`

## Summary

Quarry's center is right and this document does not touch it: bounds are
grammar, the table block is the authorization model, states are typed and
never a silent empty, one trace drives invalidation and OCC, refusals carry
rewrites, and there is one language. What follows is seven amendments to the
notation, one platform read form, and the template migrations they force.
Each names the defect, what it deletes, and its cost. Revision (a) proposed
five; the panel killed one, corrected the facts under two, replaced one with
a deletion, and added two of its own (§9).

| # | Amendment | Defect it answers | Deletes |
|---|---|---|---|
| A1 | `insert`/`update`/`upsert`/`delete` replace `+`/`~`/`+~`/`-` | four one-character sigils whose yields differ; no token economy | four sigil productions, the `+~` token |
| A2 | program `=`/`!=` become total; ordered comparison on an optional refuses | the program lowering guards equality while rules and the IR compare totally; `a != b` is not `not (a = b)` | the guard branch, the "except null" sentence |
| A3 | rules bind the row as `.`, like shapes | two conventions for one concept | the binder word in three rule paths, `readable`'s implicit `r` |
| A4 | delete `where` | the residual post-filter that starves; every corpus use has a better spelling | the production, the page-to-sequence retype, every fence it would need |
| A5 | bounded `merge`, table in the header, lanes as prefixes | the loop bar's own feed has three designs and no paved one | the `merge` refusal; the starving template; client-side lane merging |
| A6 | superseded by LLP 1011 B1 opaque cursors | paired operations and duplicated bodies | the paired operations and tuple cursor machinery |
| A7 | one modifier order; a repeated modifier refuses | any permutation parses; a second `by` silently wins | the permutations, last-one-wins |

Withdrawn from revision (a): bounds-first (nothing deleted, benefit imagined);
the viewer-syntax starvation heuristic (aliases evade it); a seventh
`E_QUARRY_*` code; "`where` erases the `capped` state" (the inner scan's
`Limit` already sets it); a persisted self-follow (the brief forbids it); a
new IR primitive for merge (the initial A5 used existing collection ops;
Clique L10 later replaces that lowering). Deferred:
`insertIfAbsent` (a platform write; ticket
`issues/20260903-snapback2-insert-if-absent.md`) and flow-sensitive narrowing
(revisit on authored evidence).

## 0. Not proposed

- The bracket's index inference by argument type and `by index` as the
  disambiguator. Read; kept. The bracket still carries point read, unique
  read, prefix scan, and probe; `exists`, `first`/`last`, and a complete
  unique key already tell them apart.
- `unchanged(f)` as a rule primitive. Rules already compare totally (§A2),
  and the unconditional case is `immutable f`.
- `upsert` yielding the row, and `insertIfAbsent`. `db.upsert` is `void`
  (`packages/compiler/lib.d.ts:70`); a non-disclosing outcome is a second
  platform write with engine, evaluator, certificate, and outcome semantics.
  The get-or-create idiom (`profiles.q`, `follows.q`, `social.q`'s
  `toggleRepost`) is race-safe under the single-writer transaction and the
  traced point read; the defect is boilerplate. Ticketed, not here.
- A direct Quarry → IR lowering. This was outside revision (b)'s commissioned
  language scope. The 2026-09-07 LLP 1004 amendment supersedes the implementation
  fact: production now uses one typed bound elaboration and direct IR lowering;
  TypeScript remains only for effects, seeds, and journeys.
- The second-family replication LLP 1004 schedules as P1.

## A1. Words for writes

**Today.** `+t { … }`, `~t[k] { … }`, `+~t[k] { … }`, `-t[k]`
(`guide/quarry.md` §Programs; `parser.ts:548, 706–713`; the `+~` token at
`lexer.ts:6`). Insert yields the row; update, upsert, and delete yield
nothing (`program.ts:717–772`; `lib.d.ts:68–71`). Across the six Quarry
fixtures and two templates: 43 inserts, 3 upserts, 21 updates, 13 deletes
— 80 sites.

**The defect.** LLP 1007 §8: sigils that do not mean what they return.
Four materially different writes at one character each, where `+t {…}` is
an expression whose value matters and `~t[k] {…}` is a statement whose
value is nothing. `-t[k]` is disambiguated against unary minus and the
first character of a `--` comment rather than being a token a reader can
trust; `~` means nothing outside Quarry. There is no token economy: a word
and a sigil each cost one token in the tokenizers that author Quarry.

**Amendment.**

```q
row = insert messages { conversationId, authorId: viewer, body, at: now }
update memberships[membership] { role: 'admin' }
upsert profiles[viewer] { principal: viewer, displayName, handle }
delete follows[existing]
```

Yields unchanged: `insert` is an expression, the other three are
statements. Three of the four words are the table block's own rule effects
(`read`/`insert`/`update`/`delete`, `ast.ts:58`, `parser.ts:122`); `upsert`
is not a rule name and does not need to be. All four join
`RESERVED_BINDINGS` (`parser.ts:24`; `delete` already is). A sigil write is
a plain `E_QUARRY_SYNTAX` naming the four words; nothing is published, so
there is no legacy recognizer and no pasted sigil rewrite.

**Deletes.** Four sigil productions, the `+~` token, the sigil paragraph in
the reference and the grammar page.

**Cost.** One mechanical pass over 80 sites, the printer, and every
`E_QUARRY_*` rewrite that spells a write.

## A2. Total equality — program-only

**Today, by layer.** Rules lower to `rule.eq`/`rule.ne` (`schema.ts:138–154`)
and the engine compares `Value`s totally (`runner_ops.rs:679–684`; `Value`
derives `Eq`). The IR's own `BinaryOp::Eq` is `left == right`
(`runner.rs:414`). Only the Quarry *program* lowering guards: `a = b` becomes
`a !== null && b !== null && a === b`, and `a != b` becomes
`a !== null && b !== null && a !== b` (`program.ts:317–358`), with a
one-sided exception for a `null` literal. So in programs, with one absent
operand, both `a = b` and `a != b` are false, and `!=` is not `not (=)`.

**The defect, corrected.** Revision (a) cited LLP 0329.014.010 §2.4's
authorization NULL trap; the panel showed that trap is not reproducible in
shipped rules, because rules are already total. The defect is narrower and
sharper: three of the four layers agree on `absent = absent`, and the one
that disagrees is the one agents write. The Clique fixture depends on the
guard as an absence test —
`require not (post.parent = post.parent) else CANNOT_REPOST_REPLY`
(`social.q:55–57`) — which after this amendment would refuse every repost.

**Amendment.**

- Delete the guard. Program `=` and `!=` are total and Boolean, matching
  rules and the IR: `absent = absent` is true, `absent = present` is false,
  `!=` is exactly `not (=)`. The `x != null` presence test becomes a
  consequence of the rule instead of an exception to it. The engine's `Eq`
  does not change.
- Ordered comparison (`<`, `<=`, `>`, `>=`) on an operand whose type is
  optional is refused at certify time, `E_QUARRY_TYPE`, rewrite `x! < y` or
  `(x ?? default) < y`. Rules already refuse ordered comparison
  (`schema.ts:161`); this is program-only.
- Quarry has no flow-sensitive narrowing, and this amendment does not add
  it. The migration shape is an outer presence branch and then `!`:

  ```q
  if m.lastDeliveredAt != null:
    if m.lastDeliveredAt! >= upTo:
      return false
  ```

  Not `x != null and x! >= y`: the `!` assertion prelude is emitted before
  the `&&`, so it may run before the short circuit. If the nested form
  proves noisy in authored code, narrowing on a `!= null` conjunct is a
  later, separate change.

**Migrations.** `social.q:55–57` becomes
`require post.parent = null else CANNOT_REPOST_REPLY` (the repost guard
requires an original post, i.e. an absent parent). `quarry-clique/snapback/chat.q:83, 91, 94`
(optional watermark `>=`) take the nested form above. The chat template's
memberships update rule spells `old.conversationId = next.conversationId and
old.principal = next.principal` over columns the same table declares
`immutable` (`schema.q:38, 48–54`); that matrix is redundant with the
constraint today, independent of this amendment, and the migration drops it.

**Tests.** A corpus case for each of the four absent/present combinations
on `=` and on `!=` (the `absent != present` flip from false to true is the
one that matters); a refusal test for ordered comparison on an optional.

**Deletes.** The guarded lowering branch and its temporaries; the "except
comparison with `null`" sentence.

### Time arithmetic

Implemented 2026-09-05 by GPT-6 Astra under the Clique L2 brief: `time - time`
yields an `int` duration in milliseconds; `time + int`, `time - int`, and
`int + time` yield `time`. Operands must be present. All other time arithmetic
refuses with that rule; `0 + now` is therefore `time`. `divmod(time, int)`
splits epoch milliseconds into integer quotient and remainder. Time comparisons
remain nominal. The existing numeric wire, engine and twin execute these rules.
`(q, r) = divmod(a, b)` evaluates once and binds its quotient and remainder with
their result types, including decimal/money brands; `.quotient` and `.remainder`
remain available. This adds no general destructuring.

## A3. One row binder

**Today.** Three rule paths name their row: table rules
(`read r <- r.ownerId = viewer`, `parser.ts:228–249`), maintain
`read`/`readable` (`:174–216`, with `readable` silently defaulting the
binder to `r` at `:202`), and `after insert r <- …` (`:141–149`). `where`
and shapes bind the row as `.` (`program.ts:605`; `page { post: . }`).
Schema lowering recognizes only named binders (`schema.ts:120–123,
165–177`). Two conventions for the one concept "the row under
consideration"; in the corpus the binder is uniformly called `r`, which is
the tell that it carries no information.

**Amendment.** Rules use the focal dot in all three paths.

```q
table messages:
  …
  read <- exists memberships[.conversationId, viewer]
  insert <- .authorId = viewer and exists memberships[.conversationId, viewer]
  update <- .authorId = viewer
  delete <- .authorId = viewer
  after insert <- exists memberships[.id, .creatorId, 'admin']

maintain messageCounts = count messages by conversationId:
  read <- exists memberships[.conversationId, viewer]
```

In a one-row `update` rule `.` is the candidate image (what `r` was);
`update (old, next) <- …` stays as the one named-binder form because it has
two rows. `ruleTerm` learns the focal arm; the diagnostic that today says
"rule terms may only be viewer, literals, or direct fields of the ruled
row" is reworded for `.`.

**Deletes.** The binder word in three rule productions, the `readable`
default-binder special case, one paragraph of the reference.

**Cost.** Every rule line in the fixtures and templates, mechanically; the
parser, the schema lowering's focal arm, the printer, the guide. Nothing is
wrong today; this is the one-convention amendment, and the language is two
templates and six fixtures old — it will never again be this cheap.

## A4. Delete `where`

**Today.** `table[prefix] first N where predicate` fetches at most the
page and filters it once per row; "filtering does not backfill … cursors
do not survive filtering" (`guide/quarry.md` §Programs). The parser accepts
`after`/`before` with `where` and refuses nothing (`parser.ts:668–686`);
the lowering retypes the page as a bounded `sequence` (`program.ts:619`),
on which `count` is `.length` (`:495–497`). The state on the wire is
already honest — the inner scan's `Limit` stop derives `Capped`
(`engine/mod.rs:978–993`) — so revision (a)'s "no `capped` state" claim
was wrong, and its two fences (refuse cursors; refuse a viewer-dependent
predicate) were a linter on a footgun.

**The uses, enumerated.** Five physical occurrences, three semantic uses:

1. The chat template's `followingFeed` (`templates/chat/snapback/feeds.q:8–16`
   and its `fixtures/quarry-chat` copy): a public `posts[] last 50` filtered
   by `viewer` and `exists follows[viewer, .author]`. For a viewer who
   follows few authors on a busy network the page is near-empty and cannot
   be paged. This is the codex half of the pincer LLP 0329.014.010 §2.2
   recorded — the hidden-take family the design refuses when spelled as a
   read rule — admitted because it is spelled as `where`, and shipped as
   the template every agent copies. **Better spelling:** A5.
2. `globalFeed`'s `where exists profiles[.author]`: a join filter standing
   in for an invariant. **Better spelling:** the invariant on the table —
   `after insert <- exists profiles[.author]` on `posts` (profiles are
   `delete <- deny`, so it cannot be broken later). The seed's
   `post-charlie` row ("Profile setup pending", `seed.ts:24–27`) exists
   only to exercise the filter and goes with it; the feed journey in
   `tests/chat.test.ts` that asserts its absence is adjusted. `createPost`'s
   `require exists profiles[viewer] else PROFILE_REQUIRED` stays for its
   named refusal; the invariant is what binds every writer.
3. `fixtures/quarry-surface/snapback/surface.q:34–36`
   (`where .visible = true` then `count(page)`): a missing index prefix,
   and a page reduction returned as a population count through the
   retype. **Better spelling:** an index with `visible` in the prefix and a
   plain prefix scan.

The nested-prelude test (`quarry-checks.ts:590–606`) and the `visiblePosts`
assertion (`:263–276`) test the feature, not a product need.

**Amendment.** Delete `where`: `RangeSpec.where`, the parse arm, the
filter-loop lowering and the sequence retype, the printer arm, the reference
sentences, the two tests, and the three uses via their better spellings. The
`E_QUARRY_UNSUPPORTED` refusal for `where` names the three spellings in its
rewrite text. The read form is once again exactly: a bounded prefix scan
whose result is a page.

**Deletes.** The production and everything above; also revision (a)'s
A5(a) and A5(b) in their entirety.

## A5. The merged feed

**Today.** `merge` is refused at `parser.ts:555` with the rewrite "name one
bounded index scan or maintain a feed table". Neither reaches the following
feed: one scan starves (A4), and a maintained feed table needs engine
fan-out (`maintain rows`, unbuilt, unbounded for a followed account with
many followers — the grok half of the pincer). The executed Clique lane
took a third route, one lane per followed actor merged on the client
(`fixtures/quarry-clique/snapback/social.q:103–125`). Three designs for the
loop bar's own screen; none paved.

**Amendment.** Bounded fan-in over prefixes of one index, the design RFC's
own read form (`merge(prefixes)`, LLP 0329.014.004 §1; `mergeByTime` in its
§9 standard library).

```q
query followingFeed(c: cursor ?):
  page = merge posts after c last 20 by byAuthorTime:
    [viewer]
    [f.followed] for f in follows[viewer] first 50 by byFollower
  return page { post: ., author: profiles[.author] }
```

- **Header.** As amended by LLP 1011 B1,
  `merge <table> [after cursor] first|last N by <index>:`
  — the table and the index are named once, so one-table, one-index
  ownership is syntactic; the header `by` is required; the modifier order
  is A7's.
- **Lanes.** An indented block of one or more lines, each a bracketed
  prefix of that index, optionally `for <name> in <bounded page>`. Every
  lane's prefix has the same width and types, so every lane leaves the
  same suffix — for `byAuthorTime: author, at, id` the suffix is `(at,
  id)`. An empty block refuses. Two lanes with the same prefix expression
  refuse at certify time (`E_QUARRY_TYPE`, drop-lane rewrite).
- **Semantics (Clique L10, 2026-09-05).** Equal runtime prefixes and bounds
  collapse to one stream. Each lane retains the header's order and logical
  position. Uniform intrinsic-id-ended lanes use pooled one-row seeks; other
  lanes keep a live SQLite cursor. A bounded shared initial template and its
  strict-seek fallback preserve those semantics (LLP 1001 §3). A heap emits
  the least/greatest shared suffix,
  deduplicates intrinsic `id` on emission, then advances that lane only. Stop
  after N plus two lookahead rows; return the first N. The own-posts lane
  stays explicit as `[viewer]`. This is the true top-N of the sorted streams.
- **Pagination.** Every lane shares one total suffix order, so the opaque
  `next` token minted from the last returned merged row, applied to every
  lane on the next call, gives no duplicates and no gaps (the ordinary cursor semantics of
  `guide/quarry.md` §Programs, on every lane at once). This meets M2 item 8
  and the diagnostic brief's item 7 (infinite scroll, 20 per page, both
  tabs). No frontier vector.
- **Lowering (Clique L10).** `Expr::Merge` carries bounded lane sources
  and scans through certification, execution, retention, and the evaluator
  twin. The eager `Concat`/`Sort`/`DedupeById`/`Slice` merge composition and
  `DedupeById` opcode are deleted.
- **Completeness.** A merge site groups the member range sites and N, and
  records maximum lanes and uniformity. `MergeTrace` retains union length
  and last returned suffix; union length is observed up to N+2. `complete`
  requires all streams exhausted and union length at most N. An unfinished
  lane or a truncated lane-discovery scan makes the result `capped`.
- **Cost (Clique L10).** Uniform distinct prefixes cost L heads + N advances
  + 2 lookahead, plus lane discovery and shaped reads. The template now costs
  52 + 51 + 20 + 2 = **125** before shaped reads; a self lane and 500 follows
  cost 502 + 501 + 20 + 2 = **1,025**. Non-uniform lanes keep conservative
  per-lane accounting; ceilings are unchanged. Heap comparisons/advances
  consume runtime steps. Retention prices heads, the emitted page, lookahead,
  and discovery pages with their halos (LLP 1001 §3).
- **The capped lane list.** `follows[viewer] first 50` omits the 51st
  followee and the query reports `capped`. The certificate and the guide's
  recipe say so, with the number, and say that it does not meet the later
  capability bar's larger follow graphs; that is a named product gap, not a
  silent drop, and it is acceptable for the loop bar.

**Deletes.** The `merge` refusal and its rewrite text; the starving
template and its fixture copy; client-side lane merging as the paved form
(the Clique fixture's `laneFeed`/`laneFeedBefore` pair becomes one merge);
two sentences of the reference.

**Cost.** The parser form, the lowering, the certificate merge site and the
state derivation, corpus cases (a small feed that is `complete`; a
truncating union that is `capped`; a runtime-overlapping pair that dedupes;
page two with the shared cursor), the evaluator twin's dedupe, the guide
recipe, and the template. The only platform work in this RFC.

## A6. Opaque cursor replacement

Superseded by LLP 1011 B1. Quarry now has one branded `cursor` value: a read
accepts `after c` with `c: cursor ?`, null means page one, and the caller feeds
the prior delivery's `next` back as `c`. Tuple cursors, mixed-presence optional
groups, scalar cursor sugar, and `before` are no longer Quarry forms. The raw
IR keeps tuple `after`/`before` only as an internal lowering target.

## A7. One modifier order

**Today.** `parseRange` accepts `after`/`before`, `first`/`last`, `by`, and
(until A4) `where` in any permutation; a second `by` silently overwrites
the first (`parser.ts:668–683`), and the postfix `by` arm at `:623–625`
can also be repeated or precede the range. The printer already emits one
order (`program.ts:953–956`) and every `.q` in the corpus uses it.

**Amendment.** The canonical order is the printer's:
`table[prefix] [after cursor] first|last N [by index]`. A repeated
modifier, or a permutation, is `E_QUARRY_SYNTAX` with the complete
canonical rewrite pasted. Both `parseRange` and the postfix `by` arm are
covered; a point read `t[k] by index` stays. The merge header shares the
order after the table name.

**Deletes.** The permutations and last-one-wins.

## 6. Guide truth, not amendments

- The bracket accepts a named-column key, `users[principal = .actor]`
  (`parser.ts`, `parseRead`; 17 uses in the Clique fixture, its unique-index
  spelling). The reference does not mention it. Document it; do not refuse
  it.
- `sorted` exists only as the two-name tuple form `(lo, hi) = sorted(a, b)`.
  It evaluates `a` and then `b` exactly once and orders the resulting present,
  compatible scalar values by the engine's total scalar order. Equal values
  remain equal. The earlier generated and initial direct routes preserved
  authored operand order instead of producing the canonical pair; that was a
  semantic defect, corrected with native/twin execution rather than recorded
  as parity.

## 7. Migrations, enumerated

| Site | Change |
|---|---|
| every `.q` under `fixtures/` and `templates/` | A1 words; A3 dot binders; A7 order (already canonical) |
| `quarry-clique/snapback/social.q:55–57` | `require post.parent = null else CANNOT_REPOST_REPLY` |
| `quarry-clique/snapback/chat.q:83, 91, 94` | nested presence branch + `!` (A2) |
| `templates/chat/snapback/schema.q:48–54` (+ fixture copy) | drop the immutable-redundant matrix terms |
| `templates/chat/snapback/schema.q` `posts` (+ copy) | `after insert <- exists profiles[.author]` |
| `templates/chat/snapback/seed.ts` (+ copy) | drop `post-charlie`; `tests/chat.test.ts` feed journey adjusted |
| `templates/chat/snapback/feeds.q` (+ copy) | `followingFeed` = A5 block; `globalFeed` drops `where` (cursor form later replaced by LLP 1011 B1) |
| `quarry-surface/snapback/surface.q:34–36` | index with `visible` in the prefix; plain scan; paired paging later replaced by LLP 1011 B1 |
| `quarry-clique/snapback/social.q:103–125`, `chat.q:124–136` | lane pairs → one merge; thread pairs → one operation (cursor form later replaced by LLP 1011 B1) |
| `guide/quarry.md`, `guide/grammar.md`, `families.source.json` | every form above; §6; the recipe for the merged feed with its named lane cap |

## 8. Sequencing and landing record

Two sequential codex gpt-5.6-sol (xhigh) lanes on `s2/quarry-amend`, each
verified out of sandbox by the orchestrator before commit:

| Lane | Items | Commit | Out-of-sandbox suite |
|---|---|---|---|
| 1 — notation | A1, A2, A3, A7, §6, and their migrations | `1f4b90a6d` | 339/339 Rust, 113/113 evaluator, 278/278 compiler |
| 2 — reads | A5, A6, A4, the `posts` invariant, the feed migrations | `2b2dd6e32` | 339/339 Rust, 122/122 evaluator, 279/279 compiler; on the merged tree (`661f5e2d4` + `ce221e90c`): 371/371, 122/122, 287/287 |

Lane 2's codex run stalled after writing every item but its report; the
orchestrator finished the two mechanical remainders (twenty test-only `Scan`
initializers gaining the new fields; the template's following feed made
byte-identical to the reference's snippet) and verified.

**Departure from the brief.** The Quarry reference's byte budget rose from
12,288 to 14,336 (`packages/snapback2/build.mjs`) to hold the merge contract
and the optional-cursor paragraph after the `where` prose was removed; the
rise is commented with this LLP's A5.

**Landing.** `git push origin s2/quarry-amend:main`, `114430434..ce221e90c`,
2026-09-03. The landing verification was green on `test.sh`, `caps` (59 of 59),
and `ref-check`; `check-inventories` carried the two pre-existing root reds
(`scripts-test`, `guide-manifest`); `measure --check`'s core-test step read
43 s against its 30 s budget under a load average of 10 with three concurrent
codex lanes, with zero Rust tests added by this landing — the case
`issues/20260903-snapback2-core-test-budget-headroom.md` was filed for; the
over-budget record was not committed.

**What binds now.** The reference (`snapback2 guide quarry`) states the
implemented language. The original landing's optional-cursor corpus cases
were replaced by LLP 1011 B1's opaque-cursor cases; the raw IR tuple target
remains internal. This document is archived from the working set with the
landing — the work it commissioned is done.

## 9. Panel record

Round 1 was blind on an identical brief; round 2 was a cross-read with
eight enumerated disagreements. Both families returned NOT READY on
revision (a) and READY-after-changes on the same list; revision (b) is that
list. Records: `llp/reviews/1010-quarry-language-amendments.{codex,grok}.md`
(both rounds, verbatim), `.panel.brief.md` (both briefs), and
`.panel.synthesis.md` (the author-side synthesis).

What the panel changed, and who found it:

- **Bounds-first killed** (both, independently): nothing deleted, benefit
  imagined, does not touch the bracket overload.
- **A2 cited the wrong layer** (both): rules and the IR already compare
  totally; the guard is a Quarry-lowering artifact. The Clique absence hack
  (`social.q:55–57`) was the corpus cost neither the author nor revision (a)
  had seen (grok). The `!`-before-`&&` prelude hazard for the migration
  (codex).
- **"No `capped` on the wire" was wrong** (both); the viewer-syntax
  heuristic is evadable by aliasing (codex) and either too narrow or too
  much apparatus (grok); no seventh code (both).
- **Delete `where`** (grok in round 1; codex changed to it in round 2 after
  enumerating the corpus). The `post-charlie` seed row and the invariant
  migration (codex).
- **Merge**: the shared-suffix cursor applied to every lane (both; the
  author had derived the same while reading round 1); the explicit self
  lane (both); no new IR primitive (both); truncation makes "complete iff
  every lane complete" false and the merge site is the fix (codex; grok
  changed to it); id-dedupe at runtime (both); the `take + 2` reserve and
  the corrected numbers (codex); the table-in-header spelling (codex).
- **A6 cursor grouping, since superseded by LLP 1011 B1** (codex proposed; grok changed to include it); the
  empty-page-on-`last N` defect was the author's finding while verifying
  round 1.
- **A7 canonical order** (codex proposed; grok accepted); the postfix `by`
  arm (codex).
- **`insertIfAbsent` deferred** (both, agreeing with the author's lean).
- **No narrowing** (both).

What did not change: A1 and A3 as proposed (both accepted, with the census
and the rule-name claim corrected and the three rule paths named).

## Non-claims

This does not change LLP 1004 or `rules/NOT-DOING.md`, does not adopt any
unimplemented dimension of LLP 0329.014.004 beyond the one read form A5
names, does not publish anything, and does not change Snapback 1. Per
`rules/RULES.md` it binds when the code in §8 runs; the implementer and date
are in the header.
