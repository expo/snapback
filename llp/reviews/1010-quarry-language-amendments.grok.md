# Panel: LLP 1010 — Quarry language amendments (grok-4.6)

**Reviewed:** `llp/1010-quarry-language-amendments.rfc.md` revision (a), overlaid on a
read-only worktree at `18b69426b`, with the Quarry front end
(`snapback2/packages/compiler/src/quarry/`), the reference and templates, the Quarry
fixtures, `lib.d.ts`, LLP 1001/1004/1007, LLP 0329.014.004/.010, and the rules.
**Family:** grok-4.6
**Provider/runtime:** grok CLI 1.0.13 (headless `--prompt-file`), model grok-4.6, reasoning effort **xhigh**
**Date:** 2026-09-03
**Redacted:** No — the panelist read the in-repo documents and sources directly in a
read-only worktree; no content left the local machine beyond the model serving this CLI.
**Method:** Two rounds. Round 1 mutually blind on an identical brief
(`~/projects/snapback-1010-panel/brief-r1.md`, preserved in the round-1 brief record
below the reviews). Round 2 cross-read: each panelist received the other's round-1
review verbatim, the author's verified list of what was settled, and eight enumerated
disagreements. The orchestrating Claude session authored the RFC and is not an
independent reviewer; it synthesized and revised.
**Recorded by:** Claude Fable 5.1 (orchestrator), verbatim from the CLI's final message.

## Round 1 (blind)

**Family:** grok-4.6 · **Date:** 2026-09-03 · **Method:** blind round 1, read-only checkout at 18b69426b

## 1. Overall assessment

The RFC’s reading of the *center* is correct: bounds are grammar, the table block is the authorization model, states are typed, one language, and the shipped `followingFeed` is the hidden-take the design refuses. The citation work is mostly real — `parseRange` really does accept `after`/`where` together (`parser.ts:668–686`), `merge` is refused at `parser.ts:555`, writes really are four sigils with insert-only yield (`program.ts:720–740`, `lib.d.ts:71–74`), and `where` really retypes a `page` to a `sequence` (`program.ts:597` vs `619`). Two facts in the code contradict the RFC and should change the amendment set. First, the paper-exercise NULL trap was a **rule** predicate; shipped `rule.eq` is already total (`runner_ops.rs:681–686`, `Value::Null == Value::Null`). The trap that still ships is program `emitBinary` (`program.ts:327–358`) and the **split** with rules. Second, a `where` scan is still a traced `db.scan` (`program.ts:596–601`); “no `capped` state on the wire” is not what that lowering does. A1 and A3 are the right notation cuts. A2 is the right equality cut once restated. A4 is cost without a deletion — kill it, as invited. A5’s diagnosis is the most important finding in the document; the right cut is to **delete `where`** and pave bounded `merge`, not to keep `where` behind a viewer heuristic and a new code. The set is close. It is not yet the set I would accept.

## 2. Per amendment

### A1 — ACCEPT

The defect is real and was already on the LLP 1007 §8 worst list. Four writes share a character (`lexer.ts:6` `+~`, `parser.ts:548` / `706–714`) while only insert is an expression (`program.ts:720–723` returns a row; `740` / `749` / `772` return `null` with `effectOnly`). `-t[k]` is disambiguated against unary minus and `--` comments (`parser.ts:531–534`, `lexer.ts:52`) rather than being a token a reader can trust. The token-economy argument is taste; I share it, but the yield/sigil mismatch is the reason to move. Words that are already the rule effects (`parser.ts:122`: `read`/`insert`/`update`/`delete`) are the deletion that earns the addition. Cost is mechanical (printer at `program.ts:923`, every `E_QUARRY_*` rewrite that pastes a write, ~80 sites). `delete` is already in `RESERVED_BINDINGS` (`parser.ts:24`) as a JS word; `insert`/`update`/`upsert` must become expression-prefix reserved so `insert = 1` cannot collide. Keep insert-as-expression; do not yield-fix upsert here (correctly parked in §0 — `lib.d.ts:73` is `void`). What would change the verdict: evidence that agents regularly mis-parse the words as rules inside programs. I have none.

### A2 — ACCEPT WITH CHANGES

The program defect is real: `=` / `!=` on a nullable pair lower to `left !== null && right !== null && <cmp>` (`program.ts:345–358`), with a one-sided exception for a `null` literal (`328–329`). So `a != b` is not `not (a = b)`, and `x = x` is false when `x` is absent. The Clique fixture **depends on that** as a presence test:

```55:57:snapback2/packages/compiler/fixtures/quarry-clique/snapback/social.q
  -- Preserve the old fixture's absence workaround: guarded equality is false
  -- for an absent optional parent and true when the parent is present.
  require not (post.parent = post.parent) else CANNOT_REPOST_REPLY
```

After total equality that line refuses every repost. Rewrite it to `post.parent != null`. That is the corpus cost, not the hypothetical `where .expiresAt > now` (zero `.q` hits).

The RFC’s motivating citation is the wrong layer. LLP 0329.014.010 §2.4 was `next.historyThru = old.historyThru` in an **update rule**. Shipped rules do not go through `emitBinary`; they become `rule.eq` / `rule.ne` (`schema.ts:138–153`) and the engine compares `Value`s (`runner_ops.rs:681–686`). `Value` derives `Eq` (`value.rs:10–12`); optional holes are materialized to `Null` before the probe. **`Null = Null` is already true in authorization.** `immutable` plus already-total `rule.eq` is why the memberships `(old, next)` matrix (`templates/chat/snapback/schema.q:48–54`) is redundant today, not “at least correct after A2.” Drop it as an `immutable` cleanup, not as an A2 consequence.

The right amendment is therefore **one equality**: delete the guarded branch so programs match rules and match `None`/`null` in every language an agent has read. Ordered comparison on an optional should refuse (`E_QUARRY_TYPE`, rewrite `x! < y` or `(x ?? default) < y`). Rules already refuse `<`/`<=`/`>`/`>=` (`schema.ts:161`); the new refusal is program-only. Do not touch `rule.eq`. Add the four absent/present cases **and** `absent != present` (today false, after A2 true — the actual `!=` flip). What would change the verdict: a rule-eval path I missed that still three-values `Eq`. I did not find one.

### A3 — ACCEPT

Nothing is wrong today. Two binders for one focal row is still a real extra convention: rules require a word (`parser.ts:228–250`), `readable` invents `r` when the word is omitted (`parser.ts:202`), `where` and shapes already use `.` (`program.ts:605`, `guide/quarry.md` §Programs). `after insert` has its own binder (`parser.ts:141–149`). Cost is every rule line plus one lowering the RFC does not name: `ruleTerm` only accepts `member` whose base is a **named** binder (`schema.ts:168–176`). Focal `.field` in a rule will refuse until that arm exists. Cheap now (two templates, six fixtures); it will never be cheaper. Keep `update (old, next)` as the one named form. What would change the verdict: a demonstration that `.` in `exists memberships[.conversationId, viewer]` is less readable for agents than `r` in a table block. Taste, and I would still take one convention.

### A4 — REJECT

Kill it, as the RFC asks if the cost is real and the benefit imagined. The benefit is imagined. Cardinality is already a leading word for the two reads that have one: `exists` and `#`. Range cardinality is `first N`/`last N` after the bracket because the bracket names the subject (`parser.ts:626–627`, `660–686`). Moving the bound in front is English (“last 50 messages”) rather than English (“messages, last 50”) — taste. Nothing is deleted; every range site, the printer (`program.ts:954`), and every pasted rewrite move. `rules/RULES.md` is right to be suspicious of a reorder with no deletion. The four-meaning bracket (LLP 1007 §8) remains after this kill; `exists` / `first`/`last` / complete unique key already disambiguate, and `by <index>` remains the overload’s named escape (`catalog.ts:168–172`). Do not keep A4 as a proxy fix for that overload. If the author overrides and keeps it: `after`/`before` sit **after** the bracket (`last 50 messages[c] after cursor by byConvTime`). Putting the cursor before the table is unreadable. What would change the verdict: a measured agent-error rate on trailing `first N`. None is offered.

### A5(a) — ACCEPT WITH CHANGES (fallback only; prefer deleting `where`)

The defect that is real: `after`/`before` and `where` parse in one loop with no refusal (`parser.ts:668–686`). “Cursors do not survive filtering” is a sentence in `guide/quarry.md` §Programs, not a diagnostic. A `followingFeedBefore` would certify. Refuse that, `E_QUARRY_TYPE`, rewrite: drop the cursor or put the predicate in the prefix.

The defect that is overclaimed: “the read has no `capped` state on the wire.” The inner `db.scan` is still emitted (`program.ts:596–601`). If it hits `take`, LLP 1001 already labels the query `Capped`. If it `Exhausted`, the filtered list **is** the whole matching population of that prefix. Always-`Capped` would be the non-uniform-site rule (LLP 1001: a non-uniform site is capped-only regardless of candidates). That is a policy choice the RFC should state, not a description of today’s wire.

The mechanism the RFC wanted, and missed, is the **retype**: `where` returns `{ kind: "sequence", …}` (`program.ts:619`) and `count(x)` is `x.length` (`program.ts:495–496`). That is how a page reduction becomes a population fact. The corpus case is `visiblePosts` (`fixtures/quarry-surface/snapback/surface.q:34–36`): `where .visible = true` then `count(page)`. If `where` stays, A5(a) must say whether `count` of a where-result is `E_STRUCTURAL_COUNT`. What would change the verdict: keeping `where` at all — see missed #1.

### A5(b) — ACCEPT WITH CHANGES (same fallback)

The shipped template is the defect (`templates/chat/snapback/feeds.q:8–12`): a public `posts[] last 50` post-filtered by `viewer` / `exists follows[viewer, .author]`. That is the codex half of the pincer (LLP 0329.014.010 §2.2) spelled as `where` so it certifies. Clique took the other honest-but-unpaved road (`social.q:103–114`: per-actor `laneFeed`, comment “Quarry intentionally has no merge primitive”). Three designs, none paved. The viewer heuristic catches that form and leaves `where exists profiles[.author]` and `where .visible = true`. The second is a missing index prefix, not a viewer-starve; the heuristic is too narrow if `where` stays, and too much apparatus if `where` goes.

Do not add `E_QUARRY_STARVING`. `QuarryCode` is six values (`ast.ts:96`); `NOT-DOING.md` forbids a code without family, site, rewrite, **and a page**. Paste the starving rewrite on `E_QUARRY_TYPE` (`diagnostics.ts:37–38`, guide `quarry/types`) unless you are willing to add the page in the same change. Without (c), (b) makes the loop-bar feed inexpressible. That coupling is right. What would change the verdict: deleting `where` (then (b) is moot).

### A5(c) — ACCEPT WITH CHANGES

This is the only amendment that is a platform addition, and it is the right one. `merge(prefixes)` is the design’s own read (`0329.014.004` §1 and §3); `mergeByTime` is the stdlib hole §9 named. Fan-out-on-write is the grok half of the pincer and needs unbuilt `maintain.rows` / `propagate`. Client-side N lanes work and paginate (Clique `laneFeed` / `laneFeedBefore`) but are not a paved form. Bounded k-way fan-in, `maxExamined = lanes.max × N`, `complete` iff the lane list and every lane are complete, is the certificate the product already knows how to print.

Three holes in the spelling:

1. **Own posts.** The brief’s M2 item 2 is explicit: no self-follow edge; own posts still appear; counts exclude self (`social-messenger.md:91–95, 463–465`). The proposed grammar is one range with a free name over a bounded list of follow **rows**. That does not admit a singleton `posts[viewer]` lane without either a self-follow (forbidden) or a second merge of two pages (not in the grammar). Specify prefixes as **values** (`[viewer]` plus `f.followed` for `f` in `follows[viewer] first 50`), or specify `merge` of already-fetched pages of one index. The template must pick the brief’s implicit-self, not `createMyProfile` minting a self-follow.

2. **Cursorless vs the bar.** M2 item 8 is infinite scroll, 20 per page, no duplicates, no gaps, **both** tabs (`social-messenger.md:446–452, 478–480`). Cursorless merge is an honest **top N**. It is not M2. Do not put `frontier(vector)` in this change — that is a second platform RFC. Do say the template Following tab is top N until that RFC, and Clique keeps per-lane cursors until then. Do not pretend cursorless satisfies the brief.

3. **IR opcode vs K scans.** “The lowering target already has the shape (K `db.scan` calls, a sort, a slice)” and “one IR primitive” cannot both be the proposal. Quarry `for` already emits nested bodies (`program.ts:178–194`). Prefer K certified scans plus a sort/slice **unless** examined/completeness cannot be honest that way. A new IR opcode is a twin-parity obligation (`NOT-DOING.md` still names the evaluator twin). Justify it or don’t add it. `lanes first 50` dropping the 51st followee is acceptable only if the certificate and the guide both say so.

What would change the verdict: proving the loop bar can be met with client-side lane merge alone **and** that the shipped template may keep lying until then. I would still want (c), because the template is what agents copy.

## 3. Open questions

1. **A4:** Kill. If kept, `after`/`before` after the bracket, before or after `by`.

2. **A2 ordered-on-optional:** Refuse, as proposed. The corpus does not contain `where .expiresAt > now`. The corpus **does** contain `post.parent = post.parent` (`social.q:55–57`) and `if cursorAt != null` (`surface.q:15`), which stay presence tests against the `null` literal. Rules already refuse ordered comparison (`schema.ts:161`).

3. **A5(c) cursors:** Cursorless is enough for an honest template top-N. It is not enough for brief M2 infinite scroll. Do not wait for frontier in this RFC. Say that.

4. **A3:** Yes. The language is two templates and six fixtures old. `ruleTerm` must learn `.`. That is still cheaper than a second convention living into the first published package.

5. **Sixth, or strike:** Strike A4. The sixth I would rank above A4 and above A5(a)(b) as written is deleting `where` (below). Nothing else in this reading outranks A1, restated A2, A3, or A5(c).

## 4. What the RFC missed

1. **Delete `where`.** Defect: it is the hidden-take combinator, admitted on a uniform public scan, shipped as the template every agent copies, and used in exactly four real places — starving `followingFeed` (template + `quarry-chat` copy), join-filter `globalFeed` (`feeds.q:2`), and missing-prefix `where .visible = true` (`surface.q:35`). Evidence: `parser.ts:668–686`, `program.ts:597–619`, `guide/quarry.md` §Programs (“filtering does not backfill”). What it deletes: the `where` production, the sequence retype, A5(a)(b) as a linter on a kept footgun, and the viewer-starving analysis. Residual `exists profiles[.author]` becomes a write-time `require exists profiles[viewer]` on `createPost` (profiles are already `delete <- deny`). Residual `.visible = true` becomes `posts[author, true]` or it does not exist. A5(c) remains the paved following feed. This is simpler than keeping a combinator that is always `capped`, never cursored, and illegal when it mentions `viewer`.

2. **`count` of a filtered `sequence` is a population fact.** Defect: even if `where` stays, `program.ts:619` plus `count` as `.length` (`495–496`) is the completeness lie A5(a) attributed to the wire label. Evidence: `surface.q:34–36`. What it deletes: `count(where-result)` as a legal program; the rewrite is `#` / a maintained aggregate / an index prefix. Fold into A5(a) if `where` is kept; it falls out if `where` is deleted.

I do not have a third that is a deletion from the current language and is not already §0/§6 or inside A1–A5.

§6’s named-column keys (`parser.ts:648–650`, `catalog.ts:146–153`) and two-name `sorted` (`program.ts:105–107`, `448–450`) are guide-truth under LLP 1004, not language amendments. Document named keys; do not refuse them — Clique uses them as the unique-index spelling (`users[principal = viewer]`, `social.q:7–18`). `by <index>` stays the ambiguity escape.

## 5. What the RFC should strike

- **A4** in full.
- **A2’s claim that the paper-exercise rule trap still ships**, and the memberships matrix as an A2 consequence. Rules are already total. The matrix goes because `immutable conversationId, principal, joinedAt` already exists (`schema.q:38`).
- **A5(a)’s “no `capped` state on the wire.”** Replace with the sequence retype and the `after`/`before` hole.
- **`E_QUARRY_STARVING` as a seventh code**, unless a guide page ships in the same change. Use `E_QUARRY_TYPE`.
- **“One IR primitive” as the default shape of A5(c)** until K `db.scan` is shown not to certify. The deletion A5(c) names is the `merge` refusal (`parser.ts:555`). That deletion does not by itself require a new opcode.
- **Self-follow as a listed honest spelling** for the template. The brief forbids it.

## 6. Verdict on the document

**NOT READY.**

Shortest list:

1. Strike A4.
2. Restate A2 as: delete `emitBinary`’s null guard so programs match already-total `rule.eq`; refuse ordered comparison on optionals; rewrite `social.q:55–57`; do not change the engine’s `Eq`.
3. Replace A5(a)(b) with **delete `where`**, or keep them only as a fallback and then (i) refuse `after`/`before` on `where`, (ii) define `count` of a where-result, (iii) drop the wire-`capped` claim, (iv) reuse `E_QUARRY_TYPE`.
4. Close A5(c)’s three holes: own-posts without a self-follow edge; cursorless = template top-N, not M2 item 8; IR opcode only if K scans cannot certify.
5. In A3, name the `ruleTerm` focal arm (`schema.ts:168`). In A1, reserve `insert`/`update`/`upsert` as prefixes.

Then the author can rule. I would accept A1, restated A2, A3, delete-`where`, and A5(c) with those holes closed. I would reject A4. I would not accept a following feed that still filters a global scan, and I would not accept a merge that cannot name the viewer’s own posts without lying about the follow graph.

## Round 2 (cross-read)

**Family:** grok-4.6 · **Date:** 2026-09-03 · **Method:** cross-read round 2, read-only checkout at 18b69426b

## 1. D-A … D-H

### D-A — Delete `where`? **HOLD: delete**

Codex is right that the inner `db.scan` still reports `Limit` (`program.ts:596–601`; `query_state` at `engine/mod.rs:978–993`). That does not save the combinator. Every corpus use has a better spelling: starving `followingFeed` (template + `quarry-chat` copy) becomes merge; `globalFeed`’s `where exists profiles[.author]` is already `require exists profiles[viewer]` on `createPost` with `delete <- deny`; `surface.q:35` is a missing `(author, visible)` prefix; the nested-where test (`quarry-checks.ts:590–606`) is a test of the feature, not a product need. The keep-argument is join-filters that an index prefix cannot say without denormalizing — and that is how the starving feed shipped. Deleting `where` removes the production, the `sequence` retype (`program.ts:619`), and every fence A5(a)/(b) would have needed. Keep it and you are farming a linter on a footgun the template still teaches.

### D-B — `count` of a `where` result? **HOLD: moot; else refuse**

Falls out if `where` goes. If the author keeps it, `count` is `.length` (`program.ts:495–496`) of a `sequence` whose max is the inner take (`:619`). `surface.q:34–36` is that lie: a page reduction reported as a population fact. Refuse `count` of a where-result as `E_STRUCTURAL_COUNT` (already the hidden-structure family, `diagnostics.ts:153`). No seventh `E_QUARRY_*` code.

### D-C — Slice truncation. **CHANGE → (iii)**

Round 1 I wrote “complete iff every lane is complete.” Codex is right, and that formula is false. `AuthoritativeTrace` records `ranges`, not slices (`engine/mod.rs:163–170`); `query_state` only looks at range `StopReason` and certificate `Completeness` (`:978–993`); `Builtin::Slice` truncates arrays with no trace (`runner.rs:466–476`). (i) is the blanket-cap we already rejected for `where` (S6): a 15-row following feed would never report `complete`, so infinite scroll cannot stop. (ii) as a new stop-reason vocabulary is more than we need. (iii) is the predicate the runtime knows: every lane `Exhausted` and post-dedupe concat length ≤ N. Implement it as a merge *site* in the certificate plus a trace `StopReason` (`Limit`/`Exhausted` reused) — not a k-way evaluator opcode. That is the hole S8 left: K `Concat`+`Sort`+`Slice` scans certify their pages, not the composition’s truncation.

### D-D — Merge spelling. **NEW**

**(1) Duplicates:** certify-refuse statically equal prefixes; runtime-dedupe by `id` (first in suffix order wins). Leaving duplicates fails M2 item 8 (`social-messenger.md:479–480`). `mergeByTime` does not dedupe (`compiler.ts:986–997`); bake it into merge lowering. Self∩followee is already `SELF_FOLLOW` (`follows.q:2`, `social.q:70`); unique follow pairs cover the rest; dedupe is the belt.

**(2) Capped lane list:** yes for the loop bar, if the certificate and the guide both say so. The follow scan’s own `Limit` already caps the query via `query_state`; the 51st followee is a named product gap, not a silent drop. Name `50` in the recipe (Clique’s `myFollowing` is `first 100` — pick one number and print it). Do not default the bound.

**(3) Block form:** keep it. Require one table, one index (`by` required), equal prefix arity; merge order is the *shared suffix* of that index, not the full key (`byAuthorTime` is `(author, at, id)`; the feed is `(at, id)`). The cursor tuple is that suffix, applied to every lane. `for` domain must be a bounded page; empty body refuses. Do not put optional-typed cursors in the example unless A6 lands.

### D-E — A6 optional cursor. **CHANGE: include (i)**

I missed this in round 1. Merge pagination without it re-teaches Clique’s paired queries (`social.q:103–125`, `chat.q:124–136`) and the if-duplicated body (`quarry-checks.ts:285–290`, `surface.q:14–26`). (ii) is a new argument type; `ArgDecl` is `ScalarType` only (`ast.ts:16, 83`) — too big. (iii) leaves the duplication A5(c) should delete. (i) uses existing `?`. Crucial: `Null` is the pre-first *cursor sentinel* (`index.rs:296–299`, `guide/quarry.md:101`), so all-absent must *omit* the clause, not pass `(null, null)`; mixed presence is runtime `E_INPUT` (args family, no seventh Quarry code). Deletes paired `Foo`/`FooBefore` ops and if-duplicated merge blocks.

### D-F — A7 `insertIfAbsent`. **HOLD: not this RFC**

Agree with the author. `AuthoritativeTrace.absences` (`engine/mod.rs:170`) already records the point-get, so `profiles.q:7–12` / `follows.q:1–10` are OCC-safe; the defect is boilerplate. `db.upsert` is `void` (`lib.d.ts:73`); a non-disclosing outcome is a second platform write, and §0 already parked upsert-yields-row. Ticket it. This RFC’s platform addition is merge.

### D-G — A8 canonical modifier order. **CHANGE: accept**

Stolen from Codex; no dissent. `parseRange` accepts any permutation; `after`/`before`/`first`/`last`/`where` refuse a second copy, but a second `by` silently overwrites (`parser.ts:668–683`). Printer order is already the corpus: cursor, then `first`/`last` N, then `by` (`program.ts:953–956`; every `.q` range). Require that; refuse a repeated modifier including `by`. Merge shares it after the word `merge`: `merge [after|before T] first|last N by index:`. Point-read `t[k] by index` stays. Postfix `t[k] by idx first N` (`parser.ts:623–627`) is a permutation and goes. `where` is gone, so it is not in the order.

### D-H — narrowing. **HOLD: refuse now; `!` is acceptable**

`chat.q:83, 91, 94` are already unguarded `m.lastDeliveredAt >= upTo` on `time ?` (`schema.q:98–99`). After the ordered-on-optional refusal they do not type-check even inside `!= null`, because there is no narrowing (`emitBinary` uses `isNullableValue` on the operand type, `program.ts:345, 1091–1094`; `if` only requires Boolean, `:164–165`). `!` exists (`parser.ts:628–632`). Three sites. `and`-narrowing is a type-system feature, not an equality fix; folding it into A2 is a second language. If the `!`-after-check pattern spreads past watermarks, ticket narrowing then.

## 2. Final recommended amendment set (ranked)

1. **A1** — `insert`/`update`/`upsert`/`delete` replace `+`/`~`/`+~`/`-`; reserve the four words; a sigil is `E_QUARRY_SYNTAX`. Deletes sigil productions, the `+~` token, the sigil guide paragraph.
2. **A2** — program `=`/`!=` become total (delete `emitBinary`’s null guard); refuse ordered comparison on optionals; migrate `social.q:55–57` to `post.parent != null` and `chat.q:83,91,94` with `!` after a presence test. Deletes the guard and the “except null” sentence. No engine `Eq` change, no narrowing, no memberships-matrix-as-A2.
3. **A3** — one-row rules bind `.`; `update (old, next)` stays; `ruleTerm` learns the focal arm. Deletes binder words and `readable`’s implicit `r`.
4. **Delete `where`** — migrate feeds to merge / write-time `require` / index prefix. Deletes the production, `RangeSpec.where`, the sequence retype, A5(a)(b), and the nested-where test.
5. **A5(c) merge** — block form, explicit self lane, shared-suffix cursor, `Concat`+`Sort`+`Slice`, runtime id-dedupe, certify-refuse static duplicate prefixes, lane-list bound named in the guide. Deletes the `merge` refusal (`parser.ts:555`) and client-side Clique lane-merge as the paved form.
6. **Merge completeness (iii)** — certificate merge site; trace `StopReason::Limit` iff post-dedupe concat > N or any lane/list `Limit`. Deletes the false-complete formula. Not a k-way opcode; not blanket `Capped`.
7. **A6** — optional cursor-tuple components; all absent omits the clause; mixed is `E_INPUT`. Deletes paired `Before` ops and if-duplicated bodies.
8. **A8** — printer order (cursor, `first`/`last`, `by`); refuse a repeated modifier; merge shares it. Deletes permutations and last-one-wins `by`.
9. **§6** — document named-column keys and two-name `sorted`; do not refuse them.
10. **Strike** A4, A5(b), a seventh `E_QUARRY_*` code, “one IR primitive” as the default, self-follow, “no `capped` on the wire,” A2’s rule-trap claim, A1’s “upsert is a rule name.”
11. **A7 `insertIfAbsent`** — ticket, not this RFC.
12. **Template** — `followingFeed` is the merge block (self lane + `follows[viewer] first 50`); `globalFeed` drops `where`; the chat memberships matrix is independent `immutable` cleanup.

## 3. What I would steal

From Codex, which I did not have: Slice truncation as a false-`complete` (I had under-specified A5(c) completeness); optional cursor as an amendment rather than a template wart; canonical modifier order and the silent second `by`; naming `insertIfAbsent` even though I still defer it; the `take+2` reserve in the cost formula (now S8).

## 4. Verdict

**Ready for the author to rule and implement**, provided the ruling is: delete `where`; merge completeness (iii); block merge with suffix order, id-dedupe, and a named lane cap; include A6(i); ticket A7; A8 in printer order; no narrowing. If the author cuts A6 to save scope, still ready: the template keeps an if-duplicated merge block until a follow-up. Nothing factual still blocks.
