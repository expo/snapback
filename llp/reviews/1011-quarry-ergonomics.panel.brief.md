# Panel: LLP 1011 — the briefs, preserved verbatim

**Type:** Review input
**Date:** 2026-09-03
**Panel:** codex gpt-5.6-sol (ultra), grok-4.6 (xhigh); orchestrator Claude Fable 5.1 (author of the RFC, not a voter)
**Related:** LLP 1011, `llp/reviews/1011-quarry-ergonomics.{codex,grok,panel.synthesis}.md`

Preserved so the verdicts can be read against what was asked. The round-2
"settled" list and D-A … D-G are the author's framing, not neutral prompts.

---

## Round 1 brief (identical for both panelists)

# Panel brief — LLP 1011 "Quarry ergonomics", revision (a), round 1 (blind)

You are one of two independent reviewers from different model families. The
orchestrating Claude session authored the document and is NOT an independent
reviewer; it will synthesize your two reviews and run one cross-read round.
This round is mutually blind. Your review will be recorded verbatim under
`llp/reviews/` with a provenance header, per LLP 0005.

## What you are reviewing

`llp/1011-quarry-ergonomics.rfc.md`, a Draft RFC proposing six ergonomic
amendments (B1–B6) to Quarry, the only backend authoring language of
Snapback 2, following LLP 1010 (landed today). You are in a read-only
checkout at `origin/main` (4a33e55de) with the RFC overlaid. Read the RFC in
full first. Then read, as needed:

- `llp/1010-quarry-language-amendments.rfc.md` — what landed today (A1–A7),
  its §9 panel record, and `llp/reviews/1010-quarry-language-amendments.*`
- `snapback2/packages/snapback2/guide/quarry.md`, `guide/grammar.md` — the
  reference as it now stands
- `snapback2/packages/snapback2/templates/chat/snapback/*.q`,
  `snapback2/packages/compiler/fixtures/quarry-clique/snapback/*.q`,
  `fixtures/quarry-surface/`, `fixtures/quarry-money/` — the sources the
  migrations would touch
- `snapback2/packages/compiler/src/quarry/{parser,program,schema,catalog}.ts`,
  `src/lower/{helper-expansion,optional-cursor,merge}.ts`,
  `src/project-seed.ts` — bind every claim to `path:line`
- `snapback2/packages/snapback2/src/{client.ts,react.tsx}` — the wire as the
  client validates it; `snapback2/crates/snapback2/src/{protocol.rs,serve.rs,verbs.rs}`
- `snapback2/crates/snapback2-core/src/{certificate.rs,ir.rs}`,
  `src/engine/{mod.rs,index.rs,runner.rs}` — the trace, the certificate, the
  cursor encoding, `query_state`
- `llp/1001-query-engine.spec.md` §3, `llp/1002-dev-loop.spec.md` §4,
  `rules/RULES.md`, `rules/NOT-DOING.md`

## Binding constraint

Simplicity, elegance, speed, ease, and ergonomics are priority 1. The
primary user is an AI agent authoring from the served guide; the second is a
human reading what the agent wrote. Features are a floor (the loop bar in
`rules/NOT-DOING.md`), never a scoreboard. Every addition must name what it
deletes; a deletion is first-class. The center is settled: bounded certified
reads, the table block as the authorization model, typed states, one trace,
one language. Do not restate the document; assume the reader has it open.
Argue from the code and the corpus, and say when you are arguing from taste.

## Deliver, in this order, in markdown, at most ~3,000 words

Open with exactly this header line:

`**Family:** <your model family and id> · **Date:** 2026-09-03 · **Method:** blind round 1, read-only checkout at 4a33e55de`

1. **Overall assessment** (one paragraph): is the RFC's sorting of the rough
   edges into "price of the thesis" versus "fixable" right, and is B1–B6 the
   right set?
2. **Per amendment, B1 through B6**: verdict **ACCEPT / ACCEPT WITH CHANGES /
   REJECT**, then two to eight sentences: whether the defect is real (cite
   the code), whether the fix is the right one, what it costs, what it
   deletes, and what would change your verdict. For B1 address the envelope
   placement, forward-only paging, the unsigned token, the result-page site,
   and the merge case separately.
3. **The RFC's open questions 1–5**: your answer to each, one to four
   sentences.
4. **What the RFC missed**: at most three amendments it should have proposed
   and did not, ranked, each with the defect, the evidence, and what it
   deletes. Deletions count. Do not pad.
5. **What the RFC should strike**: anything whose defect is imagined, whose
   cost is underpriced, or which belongs in "price of the thesis".
6. **Verdict on the document**: READY for the author to rule on / NOT READY
   and the shortest list of changes that would make it ready.

Write for the author, who will read both reviews and rule.

---

## Round 2 brief (head; the two round-1 reviews followed verbatim)

# Panel brief — LLP 1011 "Quarry ergonomics" revision (a), round 2 (cross-read)

You reviewed `llp/1011-quarry-ergonomics.rfc.md` blind in round 1. Below are
both round-1 reviews verbatim — yours and the other family's — then what the
two of you already agree on (verified by the author against the checkout),
then seven numbered disagreements or open points, each with the author's
lean stated so you can argue with it. The orchestrating Claude session
authored the RFC and is the author-side voice, not an independent reviewer.

The same binding constraint applies: simplicity, elegance, speed, ease,
ergonomics first; the agent authoring from the served guide is the user;
features are a floor; every addition names what it deletes; the center is
settled. The read-only checkout at 4a33e55de is available to re-verify.

## Deliver, in markdown, at most ~2,200 words

Open with exactly this header line:

`**Family:** <your model family and id> · **Date:** 2026-09-03 · **Method:** cross-read round 2, read-only checkout at 4a33e55de`

1. **Resolve each disagreement D-A … D-G**: your position (hold / change /
   new), two to five sentences each, bound to the code where the code
   decides it. If you changed your mind, say what convinced you.
2. **Final recommended amendment set, ranked**, at most twelve one-line
   items: what changes, what it deletes.
3. **What you would steal** from the other review that you did not have.
4. **Verdict after the changes**: ready to rule on and implement, or what
   still blocks.

## Settled in round 1 (no need to re-argue unless you dissent)

- **S1 — B1 `next` on the delivery envelope** (both): `next: cursor | null`
  beside `data` on `complete` and `capped` deliveries only; shaped feeds are
  `T[]` in `api.d.ts`, unshaped scans `Page<T>`, and `execution_json`
  (`writer_wire.rs:8–24`) is where it goes. LLP 1001 §3 and 1002 §4 are
  amended in the same change.
- **S2 — forward-only; `before` leaves the grammar** (both). The lowering
  already emits only `after:` (`program.ts:594–598`); the IR and `lib.d.ts`
  `before` stay for the lowering target. Total-order validation stays and is
  not counted as a deletion (codex).
- **S3 — unsigned token, strict decode** (both).
- **S4 — the mint rule, corrected** (grok's two cases, codex's opacity):
  `complete` → `null`; nonempty `capped` → a token from the **last returned
  row** of the result-page site; empty `capped` → `null` (a hidden run that
  ate the budget is terminal, LLP 1001 §3). No per-site `Limit`/`Exhausted`
  is exposed. Merge truncation (every lane exhausted, union > N) makes the
  query `capped` and therefore mints, from the last returned merged row — a
  new anchor the merge trace must record (`engine/runner.rs:561–575` records
  only the union length today).
- **S5 — page provenance** (grok's seventh, codex's "result-page origin"):
  the compiler tracks the result page through bindings and one-to-one shapes
  to the top-level return (`emitPageShape` retypes to `sequence`,
  `program.ts:740–754`, so a post-shape type check matches nothing); two
  scans in `if`/`else` → no site → no `next`; a merge's site is the merge
  site.
- **S6 — no React `loadMore`** (both); the caller passes `next` back as `c`.
- **S7 — census**: seven distinct paging expressions (nine physical with the
  `quarry-chat` fixture copy), not thirteen; the chat template's `thread`
  (`messages.q:3–5`, unpaged `last 50`) joins the migration (grok).
- **S8 — B2 shapes accepted** (both; codex counts fourteen repeated
  projections across `social.q`, `chat.q`, `pay.q`); expansion at the Quarry
  AST level in a new file, not through `helper-expansion.ts` (single
  expression only); scalar operation-argument types only; `fn`, `shape`,
  `cursor` reserved.
- **S9 — B3 no `id` in an upsert row** (both); **upsert keeps its absent
  branch** — "every keyed write requires the row" was wrong for upsert
  (both); the focal by-id update's `UPDATE_ROW_MISSING` (`compiler.ts:704`)
  is a fourth missing-row story to unify (codex).
- **S10 — B5 is the seed validator only** (both): normalization must
  actually rewrite rows recursively through optional and list values
  (`project.ts:307–325` returns rows unchanged), exact BigInt scaling, and
  the real migrations (`fixtures/todos/snapback/seed.ts:6` `price: 999`,
  `verified-regression-tests.ts:1252–1263`, `crates/snapback2/tests/quarry_pay.rs:160–217`);
  no money-fixture seed exists; wire arguments stay minor units.
- **S11 — B6 `data --filter` struck** (both).
- **S12 — budgets named**: `program.ts` is 1,293 of 1,500 lines;
  `quarry.md` is 13,455 of 14,336 bytes.

## Disagreements and open points

**D-A — `fn`: accept a subset, or defer?** grok: accept, with holes closed
(void calls as statements, postfix shape grammar specified, lead with
`shape`, unify the membership codes). codex: general effectful `fn` needs
call-by-value, hygiene, return control flow, cycle detection, temporaries,
and multi-site diagnostics — language semantics, not a pass — and hiding
writes in helpers worsens the readable authorization story; ship `shape`,
defer `fn`. **Author's lean:** `shape` now; `fn` only as the guard-and-pure
subset: a body of zero or more `require … else CODE` statements and at most
one `return <expression>`; scalar arguments bound to fresh temporaries at
the call; no bindings, writes, `emit`, or nested `fn` calls (depth one); a
void `fn` is a statement, a returning `fn` an expression. That subset has
trivial hygiene and covers the six repeated membership guards once their
codes are unified. Accept the subset, or defer `fn` entirely?

**D-B — B3's mechanism.** grok: a read-ruled `db.get` before every keyed
write, so an unreadable row is `NOT_FOUND` everywhere (closes the
E_RULE/NOT_FOUND existence oracle). codex: a visible pre-read changes
authority from write to read-and-write and breaks tables like the chat
template's `notifications` (`read <- deny`, `update <- system`,
`schema.q:98–106`); normalize missing by-id update/delete to `NOT_FOUND`
inside the engine's write primitive (`runner_ops.rs:49–56, 118–126`) and the
evaluator twin, with no visible read. **Author's lean:** codex's — the
`notifications` table settles it. The residual (by-id unreadable → `E_RULE`,
alternate-key unreadable → `NOT_FOUND`) is pre-existing and is named, not
fixed here. Confirm or dissent.

**D-C — B4 narrowing.** grok: accept for bound names and one-hop members of
a bound name, clone-and-narrow before emitting the right operand of `and`.
codex: reject — three sites, `and` lowers both operands eagerly with their
preludes (`program.ts:319–325`), spelling is not identity under block
shadowing (`:103–120`), member chains re-dereference (`:409–440`), and an
intervening write can invalidate the value. **Author's lean:** include,
narrowed and re-founded: narrowing attaches to the **binding object** in the
cloned environment, not to a spelling (a shadowing rebind replaces the
binding and drops the narrowing); the right operand of `and` is emitted in
the narrowed clone, so its preludes lower narrowed too; member narrowing is
limited to one hop off a bound row, and a bound row is a snapshot value that
a later `update` does not mutate. codex: do those three answer your four
objections? grok: is one hop enough for the three sites?

**D-D — B6 as an index diagnostic.** codex: the `where` refusal fires
before the predicate is parsed (`parser.ts:639–644`), rewrites are one
string per site with multiline flattened, and a sound proposal must reuse a
compatible existing index, dedupe columns already in the prefix or suffix,
keep totality, and never name a non-indexable column. grok: paste the index.
**Author's lean:** parse the predicate for the diagnostic and emit **two
sited refusals** — one at `schema.q` whose rewrite is the index line, one at
the read whose rewrite is the prefix scan — which is the pattern the
non-total cursor index already uses (`quarry-checks.ts`, "cursor refusals
stay sited and rewrite Quarry source"); reuse a compatible index when one
exists; indexable columns only. Accept as narrowed, or strike?

**D-E — the token's binding.** codex: a versioned, tagged, canonical
encoding bound to page site, table, index, order, and suffix schema, using
the wire's typed value encoding (`protocol.rs:177–215`) because plain JSON
collapses ids and strings. grok: index and order suffice. **Author's lean:**
version tag, table, index, order, and typed suffix values — but **not the
site**: a token is a position in an index, and two operations paging the
same index may share one. Bind to the site, or not?

**D-F — merge totality.** codex: uniqueness of (lane prefix, suffix) does
not make the shared suffix total across lanes; require the shared suffix to
end in intrinsic `id`. **Author's lean:** agree — a merge header's index
must end in `id` (a certify-time refusal), since a unique index whose suffix
lacks `id` can tie across lanes. Confirm.

**D-G — the missed items.** codex: (1) expose paging in `snapback2 data`
(`control.rs:179` already accepts `after`) — fold into B6 as `--after
<token>` once B1 lands; (2) delete the unreferenced 3,329-line generated
golden `fixtures/quarry-surface/lowered.json` (committed generated code,
`rules/NOT-DOING.md`). grok: (3) the chat `thread` pages (S7). **Author's
lean:** all three in. Dissent?

---
