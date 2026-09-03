# Panel: LLP 1011 — Quarry ergonomics (grok-4.6)

**Reviewed:** `llp/1011-quarry-ergonomics.rfc.md` revision (a), overlaid on a read-only
worktree at `4a33e55de`, with LLP 1010 and its panel record, the Quarry front end,
the reference, templates, fixtures, the wire (`writer_wire.rs`, `client.ts`,
`react.tsx`), the certificate and engine, and the rules.
**Family:** grok-4.6
**Provider/runtime:** grok CLI 1.0.13 (headless `--prompt-file`), model grok-4.6, reasoning effort **xhigh**
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

**Family:** grok-4.6 · **Date:** 2026-09-03 · **Method:** blind round 1, read-only checkout at 4a33e55de

## 1. Overall assessment

The thesis-price list in §0 is right: `while`/recursion, ad-hoc certified filters, the 50-followee cap, exact money, `#agg` zero, and ticketed `insertIfAbsent` should stay off this RFC. The “fixable” pile is also mostly right — tuple cursors, no user functions, three missing-row stories, nested `!`, seed/literal unit split, and a refused-`where` rewrite that names spellings instead of pasting an index. B1–B4 are the right *kinds* of cut. The set as written is not yet the set I would accept: B1’s mint rule is the wrong predicate and does not survive the shaped-page lowering the corpus actually uses; B3’s “trace the engine keeps anyway” is false; B5’s corpus and deletion are overclaimed; B6’s `--filter` adds a second surface for the combinator 1010 just deleted. Fix those and B1–B5 plus the index-paste half of B6 is the right follow-on to 1010.

## 2. Per amendment

### B1 — ACCEPT WITH CHANGES

The defect is real. A cursor is still the post-prefix tuple (`guide/quarry.md:101–109`); three refusal families teach its shape (`program.ts:539–591`); A6’s optional group is a mixed-presence `E_INPUT` before any scan (`engine/mod.rs:896–911`, twin at `evaluator/src/value-runtime.ts:275–280`). Authored `.q` paging is **4 `after` + 5 `before`** (chat template + `quarry-chat` copy, Clique `globalFeed`/`followingFeed`/`chatThread`, surface `postsAfter`/`postsBefore`), not “8 after”. Clique’s three paged ops do carry two optional args each. Every shipped feed then *shapes* the page, and the client must pluck suffix fields that the shape may have dropped.

**Envelope, not the page value.** Keep `next` beside `data`. `execution_json` is `{ state, data, seq }` (`writer_wire.rs:10–15`). Shaped feeds are already `T[]` in `api.d.ts` (`api-shape-checks.ts:21` `social.globalFeed`, `:46` `surface.postsAfter`), not `Page<T>`. Wrapping the result as `{ data, next }` retypes every paged op. Envelope leaves `data` as the array. `wireQuery` already forbids `site`/`take`/`reason` on capped (`client.ts:140–142`) and treats an empty capped array as terminal (`client.ts:375–376`, LLP 1001 §3 / 1002 §4). `next` is not those fields; it is the existing last-visible-row `after`, relocated. Denied/partial carry no `next`. Amend 1001/1002 in the same change: this is not examined-position continuation.

**Forward-only, `before` deleted — yes for the loop bar.** Quarry `before` is already sugar: `before` is refused except with `last N` (`program.ts:537, 611–612`), and the lowering always emits `after:` (`program.ts:595`). Newest-first infinite scroll is `last N` plus a token that encodes desc. Bidirectional paging is one fixture (`surface.q:21–25`) and not M2. Delete `before` from the grammar; leave IR/`lib.d.ts` `before` for the TS lowering target.

**Unsigned token — yes.** A crafted tuple already seeks any position the certificate admits. Encoding index name + order is *stricter* than the tuple (wrong index → `E_INPUT`). Do not HMAC. Decode strictly.

**Result-page site — underspecified, and it currently matches nothing in the corpus.** `emitPageShape` retypes a page to `{ kind: "sequence", max: 1000 }` (`program.ts:740–754`). Bindings then shapes then `return` are the paved form (`templates/chat/snapback/feeds.q:1–12`, Clique `social.q:81–103`, `chat.q:125–130`). “Returned value is a page” as a post-shape type check yields no `next` on any shipped feed. Track provenance through one scan or merge, through binds and shapes, to the top-level return. Two different scans in `if`/`else` → no site. Nested scans inside a shape (`quarry-checks.ts:916`) → no envelope `next`. For merge, the site is the merge site (`certificate.rs:55, 78–82`, `program.ts:650`), not a lane.

**Mint rule is wrong.** “null on Exhausted, token on Limit” fails two cases the engine already distinguishes:

1. Empty capped because a hidden run ate the budget: `StopReason::Limit` with `returned_ids` empty (`engine/mod.rs:114–118`). Minting from scan position is the continuation LLP 1001 forbids. **No last visible row ⇒ no `next`.** Empty capped stays terminal.
2. Merge truncation: every lane `Exhausted` but `deduplicated_union_len > take` (`engine/mod.rs:1117–1126`). The query is `capped` and *must* page, or A5’s infinite scroll is a lie. Mint from the last **returned** merged row’s suffix when the merge site is not complete.

Predicate: token iff this result page is not the last page of that site; last visible/returned row only; never an examined position.

**Merge validation.** Decode; require `token.index` and `token.order` equal the header; suffix width/types equal the header suffix after the (uniform) lane prefix width; apply that suffix as `after` on every lane, which is A5’s shared cursor (`guide/quarry.md:118`). Do not validate against lane prefixes.

**Cost, honestly.** Engine mint/validate, certificate site, wire, client validator, twin, grammar, 9 `.q` ops, journeys. Also: `program.ts` is 1293/1500 (`RULES.md`); `quarry.md` already sits on the 14336-byte cap 1010 raised (`build.mjs:146`). Name both. Strike React `loadMore`. `useQuery` identities on args (`react.tsx:93–99`); concatenating inside the hook fights that. Put `next?: string | null` on complete/capped; the caller passes it back as `c`.

What would change the verdict: minting from examined position; putting `next` on the page value; keeping `before` “just in case”; a concatenating hook.

### B2 — ACCEPT WITH CHANGES

The defect is real: `emitCall` refuses any name outside the builtin list as `user function or recursion` (`program.ts:453–454`). Clique repeats `authorProfile` / `reposter` (`social.q:82–113`, `chat.q:102–123`). Chat repeats `require exists memberships[…]` (`messages.q:4,8,15`, `groups.q:14,20,28`). LLP 0329.014.010 open question 4 is the fragment/reuse spelling (`:265–266`); this is that cut.

**AST expansion, not TS helpers.** `helper-expansion.ts:15–19` inlines a *single pure return expression* and is leftover TS-authoring lowering. A Quarry `fn` with `require`/`emit`/writes cannot go through it. Expand at the Quarry AST so each read/write is certified in the caller. Recursion/`E_QUARRY_UNSUPPORTED` stays; depth 8 is fine.

**Operation-argument types only.** `ArgDecl` is `ScalarType` (`ast.ts:108`). A row parameter is a new kind. Clique’s repeats are shapes, not fns over rows. If a helper needs a row, the caller passes an id and the fn re-reads (honest extra site). Do not take rows in v1.

Holes to close:

- Chat queries use `MEMBERSHIP_REQUIRED`, `send` uses `NOT_MEMBER` (`messages.q:4–15`). The example `fn` hardcodes one code and does not delete those repeats unless you unify the codes (a real deletion) or pass a code (a new parameter kind). Lead with `shape`; treat `requireMember` as the fn example only after that choice.
- Void `fn` vs `a non-final expression must be a write` (`program.ts:159`). A require-only `fn` must be statement/`effectOnly`; using it as an expression refuses.
- Postfix grammar: `profiles[.author] authorCard` and `{ *, …name }` are new. Specify them. Reserve `fn`, `shape`, `cursor` (`parser.ts:26–30` has none of them; `function` is already reserved).
- Put the expansion pass in a **new file**. Do not grow `program.ts` through 1500.

Deletes the blanket user-function refusal (keep recursion), and the repeated projections. Cost is parser + expansion + printer + tests. No platform. What would change the verdict: lowering to TS helpers; row parameters in v1; expansion dumped into `program.ts`.

### B3 — ACCEPT WITH CHANGES

The defect is real and the guide admits it (`quarry.md:256–261`). By-id `delete` is `db.delete` with no read (`program.ts:806–808`); engine missing-delete is a no-op plus `missing_preimages` (`runner_ops.rs:120–125`). By-id `update` of a missing row is `E_INPUT` (`runner_ops.rs:51–55`). Alternate-key update/delete `db.get` then `NOT_FOUND` (`program.ts:859–865`). Upsert has minted `id: new` plus `UPSERT_ID_IN_USE` / `UPSERT_ID_MISMATCH` (`program.ts:883–904`). Surface still authors `id` on an alternate-key upsert (`surface.q:103–105`).

The unification for **missing** update/delete is the right cut: one `NOT_FOUND`, drop the no-op, drop the platform leak, drop the minted form. Pre-minting a second-row id stays `insert` (Clique `createPost`, `social.q:24–28`).

Two factual repairs:

1. **The extra point read is not “in the trace anyway.”** `fetch_id` is an untraced SQLite get (`runner_ops.rs:954–975`). A Quarry `db.get` is a new certificate point site. Name it. Acceptable if named; it is how alternate-key already works.
2. **Unreadable rows.** Today, alternate-key maps unreadable to `NOT_FOUND`; by-id update of an unreadable row is `E_RULE` (`quarry.md:258–260`). If the new get is read-ruled `db.get`, unreadable becomes `NOT_FOUND` and that oracle closes. If it is internal `fetch_id`, E_RULE stays. Pick one in the RFC. I would take read-ruled `db.get` (one rule, disclosure-safe). That is a bigger change than “missing row”; do not bury it.

**Upsert must not `require` the row.** The sentence “every keyed write requires the row (`NOT_FOUND`)” is false for upsert’s absent branch. Present-branch get stays *inside* upsert (engine `upsert` already `fetch_id`s, `runner_ops.rs:72–76`; alternate-key already `db.get`s). Do not turn upsert into update.

Idempotent double-delete becomes `NOT_FOUND`. Name it; it is the point. What would change the verdict: requiring the row on upsert; leaving the unreadable split unnamed; claiming the get is already traced.

### B4 — ACCEPT WITH CHANGES

The defect is the one 1010 deferred (`1010` A2, panel D-H): Clique now has the nested form at three watermark sites (`chat.q:83–98`). `Environment.clone` exists (`program.ts:56–62`) and `if` already clones (`:164–176`). `match` already binds `someName` non-null (`:214–215`). `!` still emits a `db.require` prelude (`:281–286`), so `x != null and x! >= y` remains the 1010 hazard; narrowing with **no assertion** is the right way around it. `x != null and R` must clone-and-narrow *before* emitting `R` (`emitBinary` currently emits both sides then `&&`, `:322–325`).

**Spelling is identity for bound names in practice, not by enforcement.** Rebind is `env.bindings.set` with no check (`program.ts:118–119`); same-block rebind happens to explode as duplicate `const`. Do not rest the soundness argument on an unenforced rule. Limit v1 to: a bound name, or **one** member of a bound name (`m.lastDeliveredAt`), matched by spelling, in the `then` of `if x != null` and in `R` of `x != null and R`. Deeper chains wait. That covers the three corpus sites.

Deletes the nested-`!` idiom and those three `!`s. Cost is one env feature. What would change the verdict: narrowing `a.b.c`; emitting `!` inside the conjunct.

### B5 — ACCEPT WITH CHANGES

The split is real: Quarry literals are whole units; `project-seed.ts:76–77` and `guide/quarry.md:41–42` demand integer minor units for seeds **and arguments**. Scaling seeds by the declared scale, refusing extra fractional digits with the literal’s message, is the right seed cut.

Do not claim a money-fixture seed. `fixtures/quarry-money/snapback/` is `money.q` + `schema.q`; literals there are already whole (`money.q:9`, `2.50`). No fixture `seed.ts` carries money. Do not claim this deletes “the two-rule split”: wire args remain minor units (`api.d.ts` still says so, `quarry-checks.ts:77–78`). Keep the arguments sentence. What would change the verdict: changing wire args in this RFC (that is platform, and §0 parks the money model).

### B6 — ACCEPT WITH CHANGES (rewrite) / REJECT (`--filter`)

The refused-`where` rewrite is three spellings in prose (`parser.ts:639–643`). Pasting the index declaration (read prefix + conjunct columns + existing suffix, conventional name) plus the rewritten read is a real deletion of that prose and the right agent fix. One paste, hot successor. Do it.

**Strike `--filter`.** `data` is already a bounded, rule-checked prefix scan (`verbs.rs:140–157`, `writer.rs:1099–1180`, LLP 1002 §6). A post-filter is `where` on the dump. It deletes nothing, teaches the combinator 1010 removed, and is a control-protocol flag the RFC prices as “no wire change.” Exploration is `data --index --prefix`. If the prefix is unknown, that is the index the rewrite just pasted.

## 3. Open questions

1. **Envelope**, not the page value — shaped results are `T[]`. Forward-only is enough for the loop bar; delete `before`. Unsigned is correct. Merge: validate index+order against the header, apply the suffix to every lane; mint when the **merge site** is not complete, not when a lane reports `Limit`.
2. **AST expansion.** Scalar operation-argument types only. No rows in v1.
3. Extra traced point read is **new** and acceptable if the certificate site is named. Upsert’s get stays inside upsert; do not `NOT_FOUND` the absent branch.
4. Bound names and one-hop members of bound names, by spelling. Not deeper chains. Do not call unenforced rebind-refusal “single-assignment.”
5. Strike `--filter`. Do not strike B1–B5. The seventh is not a new item: it is B1’s missing page-provenance rule (below). Nothing else I read outranks these.

## 4. What the RFC missed

1. **Page provenance through shapes** (fold into B1; if it stays unnamed it is the seventh amendment). Defect: `emitPageShape` returns `sequence` max 1000 (`program.ts:754`); API shaped feeds are `T[]` (`api-shape-checks.ts:21,46`); unshaped scans stay `Page<T>` (`:25,45`). B1’s “returned value is a page” therefore misses every corpus feed. Evidence as above, plus `feeds.q:3–6`. Deletes that retype — the same class 1010 deleted for `where`.
2. **Unreadable-row behavior under B3** (fold into B3, not a new item). Defect: by-id vs alternate-key is also an existence oracle for *unreadable* rows (`quarry.md:258–260`), not only missing ones. Evidence: `program.ts:806–865` vs `runner_ops.rs:51–55`. Deletes the E_RULE/NOT_FOUND split if the new get is read-ruled.
3. **Chat `thread` is still an unpaged `last 50`** (`templates/chat/snapback/messages.q:3–5`). After B1 it should take `c`. §7 lists the feeds and Clique threads, not this template op — the one agents copy. Deletes the 50-row wall on the paved thread.

No fourth. `insertIfAbsent` stays ticketed.

## 5. What the RFC should strike

- B6 `--filter` in full.
- React `loadMore` as a concatenating hook.
- “The extra point read … is in the trace the engine keeps anyway.”
- Mint = Limit/Exhausted.
- “Every keyed write requires the row” as applied to upsert.
- B5’s `seed.ts` migration and the claim that the minor-units sentence dies.
- “8 after sites.”
- Citing `helper-expansion.ts` as if Quarry could reuse it.

Do not strike B1–B5 as items. Do not move opaque cursors into “price of the thesis”: the tuple’s honesty is not doing work the certificate does not already do. Do not move indexes-upfront out of §0; B6’s paste is the relief.

## 6. Verdict on the document

**NOT READY.**

Shortest list:

1. B1: envelope `next`; provenance through binds/shapes to one top-level scan or merge; mint from last returned row iff that site is not done (empty capped ⇒ no `next`; merge truncation ⇒ `next`); delete `before`; unsigned token; merge checks header index+order; `next` on complete/capped only; no `loadMore`; amend 1001/1002; name line/byte budgets; fix the census; add chat `thread`.
2. B2: AST expansion in a new file; scalar args; void calls; postfix `shape`; reserve the words; lead with shape reuse; decide membership codes.
3. B3: new traced `db.get`; name unreadable rows; upsert keeps its absent branch; drop `id` from the upsert row.
4. B4: bound names + one-hop members; conjunct narrowing without `!`.
5. B5: seed validator only; retract the missing seed file and the two-rule deletion.
6. B6: index-paste rewrite only.

Then the author can rule. I would accept that list. I would not accept a `next` that continues from an empty hidden run, a result-page site that ignores shapes, or `where` returning through `data --filter`.

## Round 2 (cross-read)

**Family:** grok-4.6 · **Date:** 2026-09-03 · **Method:** cross-read round 2, read-only checkout at 4a33e55de

## 1. D-A … D-G

**D-A — defer `fn` (change).** Round 1 I wanted `fn` once the holes were closed. The author’s subset (zero or more `require … else CODE`, at most one `return <expr>`, scalar args bound to fresh temporaries, no bindings/writes/`emit`/nested calls, void = statement / returning = expression) *does* close Codex’s hygiene, return-control-flow, cycle, and write-hiding objections: expansion is substitution, and `program.ts:159` already refuses a non-write non-final expression, so a void call is `effectOnly`. What convinced me to defer is the deletion, not the mechanics. The six `require exists memberships[…]` lines (`messages.q:4,8,15`, `groups.q:14,20,28`) use three codes and two key arities; live-query tests bind `deniedDelivery.rule` to `MEMBERSHIP_REQUIRED` (`real-owner.test.ts:143`). Unifying `MEMBERSHIP_REQUIRED` with `NOT_MEMBER` is a client-visible product change, not a language fix. Without it, two tiny helpers save five lines and add a keyword, two call forms, an expansion pass, and a family of “fn cannot X” rewrites agents will hit. Ship `shape` (fourteen projections). Defer `fn`. Reserve the word. What would change this: a census that collapses without unifying denial codes.

**D-B — confirm the write-primitive (change).** Round 1 I wanted a read-ruled `db.get` so unreadable rows became `NOT_FOUND` everywhere. `notifications` (`templates/chat/snapback/schema.q:98–106`: `read <- deny`, `update <- system`) settles it. `Runner::get` (`runner.rs:631–654`) applies the read rule and traces a point; `fetch_id` (`runner_ops.rs:954`) does neither. A visible pre-read would make a system `update notifications[id]` see null and `NOT_FOUND`. Normalize missing by-id update/delete to `NOT_FOUND` inside `update`/`delete` (`runner_ops.rs:51–56, 118–126`) and the evaluator twin, and fold the focal `UPDATE_ROW_MISSING` (`compiler.ts:704`) into that same code. Name the residual: by-id unreadable → `E_RULE`, alternate-key unreadable → `NOT_FOUND` (`quarry.md:258–260`). Do not fix it here.

**D-C — accept, re-founded (hold accept; change the soundness story).** One hop is enough for the three sites: `m.lastDeliveredAt` / `m.lastReadAt` (`chat.q:83–98`) are one column off a bound row already non-null from `members[c, viewer]!`. The three re-foundings answer Codex’s four objections against this checkout: (1) `emitBinary` today emits both `and` operands in one env (`program.ts:319–325`) — emit the right operand in the narrowed clone so its preludes see narrowed types; a row field select has no deref prelude (`:427–433`); (2) `Environment.clone` copies the binding object (`:56–59`) and `bindings.set` replaces it (`:118–119`), so narrowing-on-the-object drops on a shadowing rebind; (3) one hop off a bound row is `.column`, not `db.get`; (4) `m` is a snapshot `const`; `update members[m.id]` does not mutate it. Do not call this “single-assignment.” Cover nested `if` and `x != null and R`. No `!` in the conjunct.

**D-D — accept as narrowed (hold, sharpened).** Do not strike. Today `where` throws in the parser (`parser.ts:639–644` → `unsupported()`, never returns) before a predicate AST exists, and `compileQuarry` returns on parse diagnostics before it builds the catalog (`index.ts:34`). A paste that reuses a compatible index cannot live there. Parse the predicate onto the read (not certified, not lowered), refuse after catalog, emit two one-line rewrites — schema.q gets the index line, the read gets the prefix scan. That is the non-total cursor *shape* (`quarry-checks.ts:455–467`) with both sites in one compile. Reuse a compatible existing index; dedupe columns already in the prefix or suffix; keep totality (`…, id` or unique); indexable scalars only (`index.rs:319` — lists are not). If the predicate is not a conjunction of `.col = expr` on indexable columns, keep today’s prose. Flattening (`index.ts:187`) is fine because each rewrite is one line. `--filter` stays struck.

**D-E — not the site; typed values and table (change).** Round 1 I said index and order suffice. That encoding is wrong: `value_to_json` / `json_to_value` collapse `Id` and `String` (`protocol.rs:182, 204`), while cursor validation distinguishes them (`index.rs:303–308`; `encode_index_value` tags `3:` vs `4:`). Bind version, table, index, order, and tagged suffix values. Do **not** bind the page site: a token is a position in an index, as reusable as the tuple it replaces; two operations paging the same index with the same remaining suffix may share one; a different prefix width is already `E_INPUT` on arity. Site belongs on the certificate (S5), not in the token.

**D-F — confirm (new vs my round 1).** Uniqueness of `(lane prefix, suffix)` does not totalize the shared suffix across lanes. `feedItems` has `unique actor, post, kind` (`schema.q:53`); prefix `actor` leaves suffix `(post, kind)`, which ties across actors. The working merge is `byActorOrd: actor, ord, id` (`:56`). Certify: a merge header’s index ends in intrinsic `id`. Clique already complies. I did not have this as a certify-time rule in round 1; Codex is right.

**D-G — all three in (hold my #3; take 1–2).** (1) `control.rs:179` already accepts `after`; `data()` never sends it (`verbs.rs:176–187`). Fold `--after <token>` into B6 once B1 lands. (2) `fixtures/quarry-surface/lowered.json` is 3,329 lines, still contains `__q_wherePage`, and no test reads it (`quarry-checks.ts` calls `lowerProject` live). Delete it; that is `NOT-DOING.md:37–38`. (3) chat `thread` (`messages.q:3–5`) takes `c`. No dissent.

## 2. Final recommended amendment set

1. **B1 envelope** — `next: cursor|null` on complete/capped only; provenance through binds/one-to-one shapes to one scan or merge; mint from the last returned row iff that site is not done (empty capped → null; merge truncation → next); unsigned tagged token (version, table, index, order, typed suffix; not site); merge index ends in `id`; amend 1001/1002; no `loadMore`. **Deletes** tuple cursors, `before`, A6’s group, three refusal families, a concatenating hook.
2. **Chat `thread` pages** with `c`. **Deletes** the `last 50` wall on the paved template.
3. **B2 `shape` only** — Quarry AST expansion in a new file; postfix / `{ *, …name }` specified; reserve `shape`, `fn`, `cursor`. **Deletes** fourteen repeated projections.
4. **Defer `fn`** (including the guard-and-pure subset). **Deletes** nothing this RFC; keeps the grammar small.
5. **B3 write-primitive `NOT_FOUND`** — missing by-id update/delete (and `UPDATE_ROW_MISSING`) normalize inside the engine/twin; no visible `db.get`; upsert’s absent branch stays insert; no authored `id` in an upsert row. **Deletes** the delete no-op, the `E_INPUT` leak, `UPSERT_ID_*`, the minted form. Names, does not close, the unreadable oracle.
6. **B4 binding-object narrowing** — one hop off a bound row; `and`’s right operand emitted in the narrowed clone; snapshot rows. **Deletes** nested `!` at the three watermark sites.
7. **B5 seed validator** — recursive rewrite through optionals/lists, exact BigInt scaling, the real seed migrations. **Deletes** the seed-specific minor-units exception only.
8. **B6 two-sited `where` diagnostic** after catalog (index line + prefix scan); reuse a compatible index; indexable columns; totality. **Deletes** the three-spelling prose.
9. **`data --after <token>`** once B1 lands. **Deletes** first-page-only CLI exploration. Strike `--filter`.
10. **Delete** unreferenced `fixtures/quarry-surface/lowered.json`. **Deletes** 3,329 lines of committed generated IR.
11. **Name the budgets** — `program.ts` 1,293/1,500; `quarry.md` 13,455/14,336 — and keep expansion off `program.ts`.
12. **Census** — seven distinct paging expressions (nine physical with the quarry-chat copy), not thirteen.

## 3. What I would steal

- `notifications` as the B3 authority counterexample; I had proposed the mechanism that breaks it.
- `UPDATE_ROW_MISSING` as the fourth missing-row story.
- Tagged token values, because JSON collapses Id/String; merge-suffix totality (`id`).
- `data --after` already on the control path; delete the stale `lowered.json` golden.
- B4’s four objections (eager `and`, shadowing, re-deref, intervening write) — I had only the spelling caveat.
- `where` throws before catalog, so a sound index proposal cannot be a parser rewrite; the reuse/dedupe/totality/indexable-column contract.

## 4. Verdict

**Ready to rule on and implement** once the RFC text matches the list above. Nothing in D-A…D-G still blocks: defer `fn`, write-primitive B3, re-founded B4, catalog-time two-sited B6, token without site, merge-`id`, all three missed items. I would not accept a visible pre-read, a plain-JSON token, a result site that ignores shapes, an `fn` that unifies live-query denial codes, or `data --filter`.
