# Open points in the Lean model of Quarry's core

This file lists each place where the documents are silent or ambiguous. For
each point it gives the question, what the documents say, the model's choice
and the reason for it. The model was written from the language card, the
guide cards (reads, rules, bounds, writes, types, indexes, refusals and the
`why` pages), LLP 3000.007, LLP 3000.003, LLP 3000.035 and the conformance
corpus's value cases. The interpreter, binder, `value.rs` and `key.rs` were
not read (LLP 3000.035 §5.2).

**The engine's behaviour was not consulted when the model was written.**
Since 2026-10-08 the Lean oracle (`snapback4-difftest run-lean`, LLP
3000.035 §5.2) compares the engine with the model on generated cases. Each
point it exercised now carries an **Engine (observed)** line, from the
60,000-case run of 2026-10-08 (seeds 0–59,999) unless it says otherwise. An
observation is not a ruling: a point stays open until a document decides it.
A disagreement is classified as a Rust defect, a model defect (only when a
document contradicts the model), or an open question for Charlie with both
behaviours stated; the shrunk cases are in
`crates/snapback4-difftest/cases/found/lean--*`.

Points marked **(confirmed)** are settled by a document or corpus case. They
are listed so that nobody reopens them.

## Values

**V1. Does an id equal a text with the same characters?**
- *Documents:* the closed ticket
  `issues/closed/20260913-snapback4-rule-equality-id-string-divergence.md`
  records that `Eq(Id('u1'), String('u1'))` is false on the server. Its fix
  made the device agree.
- *Model:* the two never coincide (`id_ne_text`). A rule such as
  `viewer = 'service:pusher'` compares two ids only if the binder types the
  literal as a principal. The emitter must emit that literal as an id.
- *Reason:* the ticket is explicit. The only open part is the emitter's
  typing of literals compared with ids.
- *Engine (observed):* agrees. Data is compared tagged, so an id never
  matches a text. A text literal written to an `id` column is stored as an
  id. In a rule, the binder accepts a text literal beside `viewer` as a
  principal and refuses one beside a principal column (`E_QUARRY_TYPE`), so
  the emitter's retagging never reaches a case the binder refuses.

**V2. How do values of different kinds order, and where does null sort?**
- *Documents:* the documents give no cross-kind order. LLP 0007, from
  Snapback 1, put nulls after present values. That LLP does not govern
  Snapback 4. The ticket cited in V1 mentions in passing that String and Id
  have adjacent tags.
- *Model:* null < bool < int < text < id < bytes. Ascending scans therefore
  put null first.
- *Reason:* in a checked program, only null and one other kind share an
  indexed column. This point only matters for `first N by .nullableCol`.
  The harness should generate nullable order columns to settle it.
- *Engine (observed):* agrees. 1,459 compared pages ordered `by .maybe` or
  `by .maybe, .label` (a nullable int, mixed null and present values,
  `first` and `last`) returned the same rows in the same order: null sorts
  first ascending and last descending.

**V3. How do text and bytes order? (confirmed)**
- *Model:* text compares by code point, with no normalization. `e` followed
  by U+0301 sorts before `é`, and U+E000 sorts before U+10000. Bytes compare
  lexicographically, and a prefix sorts first.
- *Source:* corpus cases `edge-codepoint-order` and `edge-bytes-index-order`.
- *Engine (observed):* agrees for text: every page ordered by a label drawn
  from `''`, `a`, U+E000, U+10000, U+1F600, `é` and `e` U+0301 matched.

**V4. Do arrays and rows have an order?**
- *Documents:* the documents speak of "one total order over values". No core
  form orders composites: `sort` and `group` take a column, and index keys
  are scalar.
- *Model:* composites have no order. The total-order theorems cover every
  scalar and every key (a list of scalars).
- *Reason:* nothing in the fragment needs a composite order. Adding one later
  is mechanical.

**V5. Does null equal null?**
- *Documents:* expressions treat null as equal to null. The idiom
  `(status = null or .status = status)` depends on it. A null in a unique key
  argument "returns no row" (indexes card).
- *Model:* the model follows both. In expressions, `=` is structural. A null
  component in a point key, rule probe or unique-clash key never matches.
- *Open:* do pins in a `where` (`.col = x` with `x` null) follow expression
  equality, so that they match null rows, or key equality, so that they match
  nothing? The model matches null rows.
- *Engine (observed):* matches null rows too. 1,233 compared reads with
  `.maybe = null` or `.maybe = n` (`n` null in about half) agreed on data.
  The binder keeps `.col = null` as a residual filter rather than an index
  pin (the model pins it); that difference shows only in `next` (C2).

## Expressions

**E1. What happens on an ordered comparison with null or mixed kinds?**
- *Documents:* LLP 1011 B1 says "Ordered comparison on an optional still
  refuses until narrowed". That is a compile-time refusal.
- *Model:* the model returns `E_MODEL_TYPE`, a refusal no checked program
  should reach. The harness must count it as a model or emitter defect.

**E2. Is integer division truncating or Euclidean? (confirmed)**
- *Model:* `/` and `%` are Euclidean, so the remainder is never negative:
  −7 / 2 = −4 and −7 % 2 = 1. A zero divisor refuses `E_DIV_ZERO`.
- *Source:* the language card says `%` gives "the same Euclidean parts as
  divmod".

**E3. Is concatenation bounded?**
- *Model:* `text + text` and `list + list` are unbounded. The heap meter is
  out of scope.

**E4. What is a field of a null base? (confirmed)**
- *Documents:* `why E_FIELD`: "Ordinary Quarry field access propagates a
  null base as null"; `why E_QUARRY_UNSUPPORTED`: "Ordinary field access
  propagates null: `row.body` is null when `row` is null".
- *Model:* `e.col` on a null `e` is null (`Eval.lean`, the `.field` arm;
  example `field-of-null`). `.dot` and every other non-row base still refuse
  `E_MODEL_TYPE`.
- *History:* the model first refused `E_MODEL_TYPE` here. The widened
  generator (lane GW, 2026-10-08) found it: its blocks read
  `(items[key].score ?? 0)`, and 2,221 of 2,552 Lean disagreements in seeds
  0–19,999 came from it, under twelve `…~E_MODEL_TYPE` signatures. The
  document decided it and the model was fixed the same day; the shrunk cases
  stay as regressions (`tests/lean.rs`, `RESOLVED`). The rerun found no new
  defect behind it: the cases it had masked added to C2 and W4.
- *Engine (observed):* propagates null, as documented.

## Rules

**R1. Does an `exists t[..]` probe inside a rule see rows that `t`'s own read
rule hides?**
- *Documents:* the reads card says "rule probes keep exact-key semantics".
  The rules card, on write-rule hops, says "Every target must be live and
  readable". At query level, the reads card says "`exists` stops at a
  visible match".
- *Model:* inside a rule, a probe is an exact-key existence test over all
  rows of `t`, without `t`'s read rule. Query-level `exists` sees only
  visible rows (`existsRead_eq`).
- *Reason:* membership tables are self-referential. For example,
  `members: read <- exists members[.roomId, viewer]`. A probe filtered by
  its own table's read rule has no well-founded meaning there. Write-rule
  probes are the case most likely to differ from the engine.
- *Engine (observed):* agrees. In 3,379 compared cases, `items`' read,
  insert, update or delete rule probed `access` (`exists access[.bucket,
  viewer]`) while `access` was `read <- deny`; the engine's probes found the
  hidden rows exactly as the model's do, on reads and on writes.

**R2. Which image does an unnamed `update <- R` judge? (confirmed: decided by documents; engine fixed)**
- *Documents:* the rules card and `why NOT_FOUND` say "the update rule
  judges old and next"; LLP 3000.007 §8 item 7(a) has the update rule decide
  "as Postgres applies an `UPDATE` policy", whose `USING` also judges the new
  row when no `WITH CHECK` is given; `guide from-sql` maps RLS `USING` /
  `WITH CHECK` to `update <-`. Since 2026-10-08 the rules card and LLP
  3000.007 §8 item 7(a) also say it outright: an unnamed `update <- R` must
  hold for the row before and the row after the write.
- *Model:* the emitter expands `update <- R` to `R[old] and R[next]`.
- *Reason:* this is the reading that cannot grant more than either other
  reading, and the documents above choose it.
- *Engine (observed, 60,000-case run):* disagreed; the engine judged the next
  image only. Signatures `lean--kind--committed~NOT_FOUND` (69) and
  `lean--kind--committed~E_RULE` (8). Under `update <- .owner = viewer`
  without `immutable owner`, `alice` could `upsert` or `update` `bob`'s row
  with `owner: viewer` and take it over, even a row she could not read.
  Named rules (`update (old, next) <- old.owner = viewer`, `… next.owner =
  viewer`, and both) agreed in all 374 compared writes.
- *Engine (2026-10-08, after the fix):* agrees. The engine judges an unnamed
  update rule as `R[old] and R[next]` (`snapback4-core/src/schema/
  update_images.rs`, applied in `check_rule`, so the server's SQLite and
  Postgres stores and the device's prediction all judge both images). A rule
  that reads only `id` and immutable columns is judged once, since both
  images agree there. Both shrunk cases replay as agreeing and stay as
  regressions; a 20,000-case `run-lean` (seed 0) shows no
  `lean--kind--committed~*` signature. This was a security defect.

**R3. How does `!=` treat a null column?**
- *Model:* `.col != 'x'` is true when `col` is null, because equality is
  structural. A term that is undefined (a missing image) makes both `=` and
  `!=` false.
- *Documents:* the documents are silent on `!=` with null.

**R4. Which parts of the rule language are outside the fragment?**
- `created t[..]`, parent hops (`.message.conversation`), `read through`,
  service grants, `written by` field authority and three-valued `unknown`
  for hidden hop targets are not modelled.

## Reads, completeness and cursors

**M1. What does the meter count in this model?**
- *Model:* the meter is out of scope (§5.2). The model keeps one abstract
  ceiling: the number of visible candidates a request may examine, shared
  by all its reads.
- *Oracle:* the engine runs at default ceilings and the model unbounded;
  no compared case was cut. Cut behaviour is not yet compared.
  - Hidden candidates are free. The bounds card says "Hidden candidates do
    not consume the caller's remaining allowance".
  - Point reads are free.
  - The 8,192 physical walk bound for hidden candidates is not modelled. In
    the engine, exhausting it fails closed with `E_RULE`.
- *Consequence:* the model's cut positions are not the engine's. Compare
  cuts through their properties (a cut is reported, and continuation reaches
  the uncut answer: `cut_continuation`), never by position.

**C1. What is in a cursor?**
- *Model:* `next` is the key tuple of the row it follows, as a JSON array:
  the order columns, then `id`. The engine's cursor is opaque base64url.
- *Consequence:* the harness compares `next` for presence only, and checks
  continuation by feeding each side its own cursor.
- *Engine (observed):* 5,109 reads were followed page by page on both sides
  to their end; every page agreed on data and `complete`.
- A model cursor whose arity is wrong refuses `E_INPUT`. The corpus case
  `opaque-cursor-wrong-order-refused` may use another code.

**C2. Does a page that fills exactly carry `next`?**
- *Documents:* the reads card says "A terminal full page need not carry
  `next`".
- *Model:* a filled page carries `next` only if another visible candidate
  follows. The lookahead is uncharged and ignores the filter. A page that
  fills on the last candidate has `next: null`.
- *Open:* does the engine's lookahead apply the filter?
- *Engine (observed): disagrees on some pages.* Signatures
  `lean--next--next~no-next` (799) and
  `lean--continuation-next--next~no-next` (445). On a uniform page with no
  residual conjunct the engine's `next` matches the model's lookahead (all
  9,859 such pages, with 5,109 reads followed to their end on both sides' own
  cursors). On a **non-uniform** page (1,150 of 1,162 disagreed) and on a page
  with a **residual filter** (94 of 1,784 uniform pages with one disagreed) (`.score >= 0`, `.label != ''`, a disjunction, or
  `.col = null`, which the binder keeps as a filter), a page that fills
  carries `next` even when no candidate follows; that cursor returns an empty
  page. Data and `complete` agree. The card permits both behaviours; no
  document says a terminal full page must omit `next`. Open.

**C9. Does a page without `after` carry `next`? (confirmed)**
- *Documents:* LLP 3000.027 §1: "A cursorless top-N answer has no `next`; a
  cursor page may be complete with `next`." The `N_NO_CURSOR` card: "a
  returned page without a cursor cannot continue … Filling `first N` or
  `last N` is complete without `next`."
- *Model:* a page expression with no `after` clause returns `next: null`
  (`Eval.lean`, the `.page` arm; example `page-cursorless-filled`). The page
  walk and its theorems are unchanged.
- *History:* the model first carried `next` on a cursorless filled page.
  The Lean oracle found the difference (`lean--next--no-next~next`, 108 in
  60,000), the documents above decided it, and the model was fixed on
  2026-10-08. The shrunk case is kept as a regression.

**C3. Does a cut page with nothing examined carry `next`?**
- *Model:* no. A cut before any row was examined has `next: null`.

**C4. Where does a non-uniform page position its cursor?**
- *Documents:* LLP 3000.007 §5.6 says a cut page positions after the last
  rule-visible examined row and never after a hidden one.
- *Model:* hidden rows are never examined in the model, so every `next`
  follows a visible row (`pageRead_visible`). The model ignores the engine's
  "a cut inside a hidden run ends on an empty capped page" detail.

**C5. Is a count or exists complete under a non-uniform rule?**
- *Documents:* the bounds card says "Schema-capped query `count` and `sum`
  with non-uniform read rules keep their bounded page execution and coverage
  contract". It does not say whether such a total reports `complete`.
- *Model:* a count or exists that is not cut is complete, uniform rule or
  not. It counts exactly the visible matches (`countRead_eq`).
- *Engine (observed, 2026-10-11, LLP 3000.036 §15.12):* a query's search
  `exists t where …` over a rule its pins do not decide answers `true` with
  `complete: false` when a visible row matches, and is unavailable (no data,
  `complete` false) when none does; it never answers `false` there. The guide
  reads card says an undecided scan has no answer. Model follow-up: mark such
  an `exists` incomplete and throw `.unavailable` on no visible match (not run:
  the lane had no elan). `lean::generate` does not emit a search `exists` yet.

**C6. How do several reads combine into one answer's `complete`?**
- *Model:* `complete` is the conjunction over every read in the request.
  The reads card says "A cut on a nested page still makes the answer
  incomplete".

**C7. What does a cut count or exists return?**
- *Model:* in a query, the whole answer is unavailable: no data, `complete`
  false, no `next`. The client observation is `loading`. In a mutation, the
  cut refuses `E_BOUND`.
- *Source:* the bounds card: "never a partial count", "a mutation aborts
  with `E_BOUND`".

**C8. When is a page uniform?**
- *Model:* a page is uniform exactly when every row column its table's read
  rule reads is pinned by an equality in the predicate. A non-uniform page
  is never complete.
- *Source:* the bounds card and `N_NEVER_COMPLETE`.
- *Engine (observed):* agrees on `complete` for all 1,343 compared
  non-uniform pages. A `count` or `sum` whose read rule its pins do not decide
  is refused at check (`E_QUARRY_BOUND`), so C5 cannot arise for an unpaged
  total.

## Writes

**W1. In what order does an insert run its checks?**
- *Model:* the insert rule runs first (`E_RULE`). Then collisions are
  checked: `id` first, then each declared unique key in order. A hidden clash
  refuses `E_RULE`. A visible clash refuses `E_CONSTRAINT` or the key's
  `else CODE`, or returns null under `if absent`.
- *Consequence:* an `if absent` insert that its rule denies refuses `E_RULE`
  even when it would clash visibly.
- *Documents:* each outcome is documented. Their precedence is not.
- *Engine (observed):* agrees on all 1,790 compared inserts (insert rule
  allow, deny, owner or witness; the inserted id clashing with a visible or
  hidden row about half the time).

**W2. What does an insert return when its writer cannot read the new row?**
- *Documents:* the documents say results are read-rule gets for update and
  upsert (`why E_CONFLICT`). A sequence insert by a writer who cannot read
  the new row refuses `E_RULE` (writes card).
- *Model:* the result is the row if the writer can read it after the write,
  and null otherwise, with no refusal.

**W3. In what order does an update run its checks?**
- *Model:*
  1. patch validation (`E_INPUT`);
  2. the update rule: `E_RULE` on a readable target, `NOT_FOUND` on an
     unreadable one;
  3. the `if` condition: `NOT_FOUND` on an unreadable target, `E_CONFLICT`
     on a readable one;
  4. secondary unique clashes.
- *Documents:* each outcome is documented. Their precedence when several
  fail is not.
- *Engine (observed):* agrees on every compared `update` (1,788) and on every
  `upsert` (1,745) except the 77 R2 cases, over readable and unreadable targets
  (`E_RULE` against `NOT_FOUND`), missing targets and unique-key clashes. What does the insert arm of an absent upsert refuse?**
- *Documents:* an incomplete image and insert-rule denial are both
  `NOT_FOUND`.
- *Model:* a clash with a hidden row is also `NOT_FOUND`. A clash with a
  visible row is `E_CONSTRAINT` or the key's code. The documents are silent
  on both clash cases.
- *Engine (observed):* agrees on the absent-target upserts generated (a
  missing key; the generator's unique `tag` value never clashes, so the clash
  cases are not yet exercised).
- *Engine (observed, widened generator, seeds 0–19,999, 2026-10-08):* block
  and prelude writes now put a seeded row's `tag`. On a clash with a row the
  viewer **cannot** read, the engine refuses `E_RULE` ("a unique key ...
  contains a row you cannot read") where the model refuses `NOT_FOUND`
  (`lean--prelude-code--E_RULE~NOT_FOUND`, 24 cases, and
  `lean--code--E_RULE~NOT_FOUND`, 3, in the rerun after the R2 and E4 fixes;
  `issues/20261008-quarry-difftest-widened-shapes-under-open-r2-and-w4.md`).
  No other clash disagreement appeared once E4 was fixed. Open.

**W5. Where do new ids come from?**
- *Model:* an insert needs an explicit `id`. The emitter or harness supplies
  minted ids, from the corpus's `new_ids` or the generator's `id: key`.

**W6. Which write constraints are not modelled?**
- Immutable columns, caps, `after insert`, field authority, sequences,
  defaults other than null for an omitted nullable column, text bounds and
  formats, and assets.
- A missing required column on insert refuses `E_INPUT`. The binder
  refuses it statically.

**W7. Can a write admitted by its rule change a row the writer cannot
read? (confirmed)**
- *Model:* yes, for both update and delete. The update case is in the rules
  card. For delete, the card says "NOT_FOUND for … an unreadable refused
  target", which implies an admitted delete of an unreadable row succeeds.
- *Engine (observed):* agrees (per-effect rules with `read <- .owner =
  viewer` and `update`/`delete <- allow`).

**W8. Which store does a write rule see?**
- *Model:* the store immediately before that write, including the
  mutation's earlier writes. `after insert` is out of scope.

## Placement

**P1. What happens when a query writes?**
- *Model:* the query refuses `E_QUARRY_PLACEMENT` when it runs. The binder
  refuses it at compile time. Either way, no query changes a store
  (`query_writes_nothing`).
