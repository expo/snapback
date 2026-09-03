# Panel: LLP 1010 — the briefs, preserved verbatim

**Type:** Review input
**Date:** 2026-09-03
**Panel:** codex gpt-5.6-sol (ultra), grok-4.6 (xhigh); orchestrator Claude Fable 5.1 (author of the RFC, not a voter)
**Related:** LLP 1010, `llp/reviews/1010-quarry-language-amendments.{codex,grok,panel.synthesis}.md`

Preserved so the verdicts can be read against what was actually asked. The
round-2 "settled" list and the disagreements D-A … D-H are the author's
framing and were not neutral prompts; the round-1 reviews appended to the
round-2 brief are omitted here because they are the review records themselves.

---

## Round 1 brief (identical for both panelists)

# Panel brief — LLP 1010 "Quarry amendments", revision (a), round 1 (blind)

You are one of two independent reviewers from different model families. The
orchestrating Claude session authored the document and is therefore NOT an
independent reviewer; it will synthesize your two reviews and run one
cross-read round afterward. This round is mutually blind. Your review will be
recorded verbatim under `llp/reviews/` with a provenance header, per LLP 0005.

## What you are reviewing

`llp/1010-quarry-language-amendments.rfc.md`, a Draft RFC proposing five
amendments (A1–A5) to Quarry, the only backend authoring language of Snapback
2. You are in a read-only checkout of the repository at `origin/main`
(18b69426b) with the RFC overlaid. Read the RFC in full first. Then read, as
needed, in roughly this order:

- `snapback2/packages/snapback2/guide/quarry.md` and `guide/grammar.md` —
  the Quarry v0.3 reference, which states what the platform does
- `snapback2/packages/snapback2/templates/chat/snapback/*.q` and
  `templates/todos/snapback/*.q` — the two shipped templates
- `snapback2/packages/compiler/fixtures/quarry-clique/snapback/*.q` — the
  executed Clique backend in Quarry; `fixtures/quarry-surface/`,
  `fixtures/quarry-money/`, `fixtures/quarry-invalid/`
- `snapback2/packages/compiler/src/quarry/{parser,program,schema,catalog}.ts`
  — the front end: how brackets, ranges, `where`, writes, rules, and
  comparisons parse and lower. Bind every claim about the language to this
  code (`path:line`); the RFC cites it and you should check those citations.
- `snapback2/packages/compiler/lib.d.ts` — the lowering target's `db` API
- `llp/1004-quarry-default-surface.decision.md` — the ruling that Quarry is
  the only surface, its implementation record, and the spec-truth rule
- `llp/1007-state-of-snapback2-and-the-work.plan.md` §3 and §8 — the
  previous panel's findings and its reading of the language
- `llp/0329.014.010-quarry-clique-paper-exercise.research.md` §2.2, §2.4,
  §2.5 — the pincer, the NULL trap, the convergent verdicts
- `llp/0329.014.004-bounded-data-programs-v1-design.rfc.md` §1, §2.1-A, §9
  — the design the language implements a subset of
- `llp/1001-query-engine.spec.md` — typed states (`complete | capped |
  partial | denied`), the trace, the certificate
- `rules/RULES.md`, `rules/NOT-DOING.md` — binding on Snapback 2 work

## Binding constraint

Simplicity, elegance, speed, ease, and ergonomics are priority 1. The
primary user is an AI agent building an app from the installed package and
the served guide; the second is a human reading what the agent wrote.
Features are a floor — the loop bar in `rules/NOT-DOING.md` (reduced Clique
M1–M3: accounts, feed, realtime chat; React web) — never a scoreboard. Every
addition must name what it deletes; a deletion is first-class. Do not
restate the document; assume the reader has it open. Argue from the code and
the evidence in the corpus, and say when you are arguing from taste.

## Deliver, in this order, in markdown, at most ~3,000 words

Open with exactly this header line, then the sections:

`**Family:** <your model family and id> · **Date:** 2026-09-03 · **Method:** blind round 1, read-only checkout at 18b69426b`

1. **Overall assessment** (one paragraph): is the RFC's reading of the
   language correct, and is the amendment set the right one?
2. **Per amendment, A1 through A5**: verdict **ACCEPT / ACCEPT WITH CHANGES /
   REJECT**, then two to eight sentences: whether the defect is real (cite
   the code), whether the proposed fix is the right one, what it costs, what
   it deletes, and what would change your verdict. For A5, treat (a), (b),
   and (c) separately. For A4, the RFC asks you to kill it if the cost is
   real and the benefit imagined; do so if that is your read.
3. **The RFC's open questions 1–5**: your answer to each, one to four
   sentences.
4. **What the RFC missed**: at most three amendments the RFC should have
   proposed and did not, ranked, each with the defect, the evidence, and what
   it deletes. Deletions from the current language count. Do not pad this
   section.
5. **What the RFC should strike**: anything proposed whose defect is
   imagined or whose cost the RFC underprices.
6. **Verdict on the document**: READY for the author to rule on / NOT READY
   and the shortest list of changes that would make it ready.

Write for the author, who will read both reviews and rule.

---

## Round 2 brief (head; the two round-1 reviews followed verbatim)

# Panel brief — LLP 1010 "Quarry amendments" revision (a), round 2 (cross-read)

You reviewed `llp/1010-quarry-language-amendments.rfc.md` blind in round 1.
Below are both round-1 reviews verbatim — yours and the other family's —
then what the two of you already agree on (with the author's verification
against the code), then eight numbered disagreements or open points. The
orchestrating Claude session authored the RFC and is the author-side voice
here, not an independent reviewer; where it states a lean, argue with it.

The same binding constraint applies: simplicity, elegance, speed, ease,
ergonomics first; the primary user is an agent authoring from the served
guide; features are a floor (the loop bar: reduced Clique M1–M3, React web,
no media, on a published package — `rules/NOT-DOING.md`); every addition
names what it deletes. The read-only checkout at 18b69426b is still
available if you need to re-verify a claim against the code.

## Deliver, in markdown, at most ~2,200 words

Open with exactly this header line:

`**Family:** <your model family and id> · **Date:** 2026-09-03 · **Method:** cross-read round 2, read-only checkout at 18b69426b`

1. **Resolve each disagreement D-A … D-H**: your position (hold / change /
   new), two to five sentences of reasoning each, bound to the code where
   the code decides it. If you changed your mind, say what convinced you.
2. **Final recommended amendment set, ranked**, at most twelve one-line
   items: what changes, what it deletes. These are what the author will read
   and implement.
3. **What you would steal** from the other review that you did not have.
4. **Verdict after the changes**: ready for the author to rule on and
   implement, or what still blocks.

## Settled in round 1 (no need to re-argue unless you dissent)

The author checked each of these against the checkout after reading both
reviews.

- **S1 — A1, words for writes: accepted by both.** Census corrected to 43
  inserts / 3 upserts / 21 updates / 13 deletes = 80 sites (codex). `upsert`
  is not a rule name; the rule names are `read`/`insert`/`update`/`delete`
  (`ast.ts:58`, `parser.ts:122`). The four words become reserved bindings
  (`delete` already is, `parser.ts:24`). No sigil recognizer survives: a
  sigil write is a plain `E_QUARRY_SYNTAX` naming the four words — nothing
  is published yet, so there is no legacy to paste rewrites for.
- **S2 — A2, equality: the RFC cited the wrong layer.** Rules lower to
  `rule.eq`/`rule.ne` (`schema.ts:138–154`) and the engine compares `Value`s
  totally (`runner_ops.rs:679–684`); the IR's own `BinaryOp::Eq` is
  `left == right` (`runner.rs:414`). Only the Quarry program lowering guards
  (`program.ts:317–358`). So the amendment is program-only and its argument
  is consistency: three of four layers already agree, and the fourth is the
  one agents write. The Clique fixture depends on the guard as an absence
  test (`social.q:55–57`) and migrates to `require post.parent = null`. The
  chat membership matrix (`schema.q:48–54`) is `immutable` cleanup,
  independent of A2. (both)
- **S3 — A2, ordered comparison on an optional operand: refuse (both).**
  Quarry has no flow-sensitive narrowing (codex); the migration sites are
  `quarry-clique/snapback/chat.q:83, 91, 94`. See D-H for the shape of that
  migration.
- **S4 — A3, one row binder: accepted by both.** Must cover all three
  rule-parsing paths — table rules (`parser.ts:228–249`), maintain
  `read`/`readable` (`:174–216`, the implicit-`r` exception at `:202`), and
  `after insert` (`:141–149`) — and `ruleTerm` must learn the focal arm
  (`schema.ts:165–177`). In a one-row update rule `.` is the candidate
  image; `update (old, next)` stays the one named form. (both)
- **S5 — A4, bounds first: killed.** Nothing deleted, benefit imagined,
  does not touch the bracket overload. (both)
- **S6 — A5(a): refuse `after`/`before` on a `where` read (both); strike
  "no `capped` state on the wire" (both).** `query_state` derives `Capped`
  from any range that stopped `Limit` or any non-hoisted site
  (`engine/mod.rs:978–993`), so the inner scan already reports it. No
  blanket capping.
- **S7 — A5(b): the viewer-syntax heuristic is dead (both).** Bindings
  resolve before the viewer intrinsic, so `me = viewer` evades it (codex);
  it is too narrow if `where` stays and too much apparatus if `where` goes
  (grok). No seventh `E_QUARRY_*` code. (both)
- **S8 — A5(c), merge: accepted by both, with the same four changes found
  independently.** (i) Pagination is the ordinary shared-tuple cursor:
  every lane shares one total suffix order, so the last merged row's
  suffix tuple is applied to every lane; no frontier vector. (ii) An
  explicit self lane; no persisted self-follow (the brief forbids it,
  `social-messenger.md:91–95`). (iii) No new IR primitive: `Concat`,
  multi-key `Sort`, and `Slice` exist (`ir.rs:212–239`) and `mergeByTime`
  already composes them (`compiler.ts:969–998`). (iv) Cursorless does not
  meet M2 item 8 / the diagnostic brief's item 7 (infinite scroll, 20 per
  page, both tabs). Cost: the outer lane scan plus K lanes × (N + 2)
  reserve (`certificate.rs:928–946`) — 2,652 examined for the RFC's 50×50
  example, not 2,500 (codex).
- **S9 — §6: document the named-column key form and two-name `sorted`;
  do not refuse them** (Clique uses `users[principal = viewer]` as its
  unique-index spelling). (grok)

## Disagreements and open points for round 2

**D-A — Delete `where` outright?** grok: delete it — every corpus use has
a better spelling (the starving `followingFeed` → merge; `globalFeed`'s
`where exists profiles[.author]` is already enforced at write time by
`createPost`'s `require exists profiles[viewer]`; `surface.q:35`'s
`.visible = true` is a missing index prefix), and deleting it removes the
production, the `sequence` retype (`program.ts:619`), and every fence
A5(a)/(b) would have needed. codex: keep it with only the cursor refusal,
since `capped` already reports incompleteness honestly. **The author
leans delete.** Argue it. If you would keep it, answer D-B.

**D-B — If `where` stays, what is `count` of a `where` result?** grok:
`surface.q:34–36` (`where .visible = true` then `count(page)`) is the
page-reduction-as-population-fact the design's dimension A refuses, hidden
by the retype; refuse it (`E_STRUCTURAL_COUNT`) or delete `where`. codex
did not address it. Position?

**D-C — Merge completeness when the final slice truncates.** codex: if
every lane exhausts but their union exceeds N, `Slice` truncates and
"complete iff every lane is complete" reports a false `complete`; the
truncation must enter the authoritative trace. The author accepts the
refinement. The open question is mechanism, given the lowering is
`Concat` + `Sort` + `Slice` and the trace records ranges, not slices:
(i) label every merge `Capped` unless it has one lane (opaque, honest,
loses `complete` on small feeds); (ii) a merge-aware trace entry, i.e. a
merge site with its own stop reason; (iii) label `complete` iff every
lane's range stopped `Exhausted` and the concatenation's length ≤ N —
which the runtime knows — via a merge site in the certificate. Which, and
why?

**D-D — The merge spelling.** The author's revision (b) candidate is a
block form:

```q
query followingFeed(cursorAt: time ?, cursorId: posts ?):
  return merge before (cursorAt, cursorId) last 20 by byAuthorTime:
    posts[viewer]
    posts[f.followed] for f in follows[viewer] first 50 by byFollower
```

One table, one index (the merge's `by`), each lane a prefix, optionally
`for x in <bounded list>`; the merge's `first`/`last` N is every lane's
take; the merge's cursor is applied to every lane. Open: (1) duplicate
prefixes across lanes — refuse at certify time when statically equal,
dedupe by `id` at runtime, or leave overlap as duplicates? (2) the capped
lane list (`follows[viewer] first 50` drops the 51st followee) — the
certificate and guide say so; is that acceptable for the loop bar, and
should the guide's recipe name the number? (3) anything about the block
form itself you would change.

**D-E — A6, an optional cursor (codex's first missed amendment).** Today
the pattern is `cursorAt: time ?, cursorId: posts ?` plus
`if cursorAt != null: return … after (cursorAt, cursorId) … / return …`
(`quarry-checks.ts:285–290`); Clique duplicates whole queries
(`social.q:103–125`, `chat.q:124–136`). Candidate spellings: (i) cursor
tuple components may be optional-typed; all absent = no cursor; mixed
presence = runtime `E_INPUT` (the static shape cannot express
both-or-neither); (ii) a `cursor` argument type bound to an index — bigger;
(iii) leave as is — the `if` form is three lines. grok: position on
including it at all? codex: which spelling, and what does it delete beyond
the duplicated queries?

**D-F — A7, `insertIfAbsent` (codex's second missed amendment).** The
get-or-create idiom is read/branch/insert (`profiles.q:7–12`,
`follows.q:1–10`, `social.q`'s `toggleRepost`); the design RFC has
`insertIfAbsent` returning an outcome without disclosing the conflicting
row; `db.upsert` is `void` (`lib.d.ts:70`). The author's lean: under
trace-validated OCC the read is in the trace, so the idiom is race-safe
and the defect is boilerplate, not correctness — defer to a ticket rather
than widen this RFC with a platform addition. grok: position? codex: is
this RFC the place?

**D-G — A8, canonical range-modifier order and duplicate-`by` refusal
(codex's third missed amendment).** `parseRange` accepts any permutation
of `after`/`before`/`first`/`last`/`by`/`where` and a second `by` silently
overwrites the first (`parser.ts:668–683`). The author accepts this as an
amendment: require the printed canonical order, refuse a repeated
modifier; it deletes the permutations and last-one-wins. grok: dissent?
Both: which canonical order, and does `merge` share it?

**D-H — A2's migration shape without narrowing.** After refusing ordered
comparison on optionals, `if m.lastDeliveredAt != null and
m.lastDeliveredAt >= upTo` still refuses, so `chat.q:83, 91, 94` become
`m.lastDeliveredAt! >= upTo` inside a presence-checked branch — `!` right
after a `!= null` test. Is that acceptable, or should `and`-narrowing on a
`!= null` conjunct be part of A2? The author leans: refuse now, add
narrowing later only if the `!`-after-check pattern proves noisy in
authored code.

---

## Round-1 reviews, verbatim
