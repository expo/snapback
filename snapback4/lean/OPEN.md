# Open points in the Lean model of Quarry's core

This file lists each place where the documents are silent or ambiguous. For
each point it gives the question, what the documents say, the model's choice
and the reason for it. The model was written from the language card, the
guide cards (reads, rules, bounds, writes, types, indexes, refusals and the
`why` pages), LLP 3000.007, LLP 3000.003, LLP 3000.035 and the conformance
corpus's value cases. The interpreter, binder, `value.rs` and `key.rs` were
not read (LLP 3000.035 §5.2).

**The engine's behaviour is not stated here.** Nobody has consulted it.
When the emitter and harness lane finds a disagreement on one of these
points, record the engine's behaviour and the ruling against the point.
The ruling decides whether the gap is a Rust defect, a model defect or an
open language question for Charlie.

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

**V3. How do text and bytes order? (confirmed)**
- *Model:* text compares by code point, with no normalization. `e` followed
  by U+0301 sorts before `é`, and U+E000 sorts before U+10000. Bytes compare
  lexicographically, and a prefix sorts first.
- *Source:* corpus cases `edge-codepoint-order` and `edge-bytes-index-order`.

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

**R2. Which image does an unnamed `update <- R` judge?**
- *Documents:* the documents say "the update rule judges old and next". The
  examples name both images only in the `update (old, next)` form.
- *Model:* the emitter expands `update <- R` to `R[old] and R[next]`.
- *Reason:* this is the reading that cannot grant more than either other
  reading. If the engine judges only one image, that difference is a ruling
  to make, not a bug to fix.

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
- A model cursor whose arity is wrong refuses `E_INPUT`. The corpus case
  `opaque-cursor-wrong-order-refused` may use another code.

**C2. Does a page that fills exactly carry `next`?**
- *Documents:* the reads card says "A terminal full page need not carry
  `next`".
- *Model:* a filled page carries `next` only if another visible candidate
  follows. The lookahead is uncharged and ignores the filter. A page that
  fills on the last candidate has `next: null`.
- *Open:* does the engine's lookahead apply the filter?

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

## Writes

**W1. In what order does an insert run its checks?**
- *Model:* the insert rule runs first (`E_RULE`). Then collisions are
  checked: `id` first, then each declared unique key in order. A hidden clash
  refuses `E_RULE`. A visible clash refuses `E_CONSTRAINT` or the key's
  `else CODE`, or returns null under `if absent`.
- *Consequence:* an `if absent` insert that its rule denies refuses `E_RULE`
  even when it would clash visibly.
- *Documents:* each outcome is documented. Their precedence is not.

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

**W4. What does the insert arm of an absent upsert refuse?**
- *Documents:* an incomplete image and insert-rule denial are both
  `NOT_FOUND`.
- *Model:* a clash with a hidden row is also `NOT_FOUND`. A clash with a
  visible row is `E_CONSTRAINT` or the key's code. The documents are silent
  on both clash cases.

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

**W8. Which store does a write rule see?**
- *Model:* the store immediately before that write, including the
  mutation's earlier writes. `after insert` is out of scope.

## Placement

**P1. What happens when a query writes?**
- *Model:* the query refuses `E_QUARRY_PLACEMENT` when it runs. The binder
  refuses it at compile time. Either way, no query changes a store
  (`query_writes_nothing`).
