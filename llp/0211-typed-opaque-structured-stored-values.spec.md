# LLP 0211: Typed opaque structured stored values

**Type:** Spec
**Status:** Draft
**Systems:** Schema, Application data API, Storage, Code generation, Client SDK
**Author:** Charlie Cheever / Claude (Fable 5)
**Date:** 2026-08-09
**Related:** LLP 0115 (CV-4b commission this slice is carved from), LLP 0004
(application data API; portability rules), LLP 0007 (storage portability),
LLP 0081 (migrations), LLP 0131 (unified argument grammar — the validator
vocabulary reused here), LLP 0044 (the 2026-07-31 bounded-array withdrawal
this Spec must not silently re-litigate), LLP 0110 (bounded children — the
ruled paved path for multi-asset), LLP 0191 (§5 schema-fidelity quick-win
sequencing — the carve-out precedent), LLP 0208 (G8 pilot evidence),
LLP 0117 (CV-4 analysis layer), LLP 0134 (capability maturity), Diary 0073

## Summary

A narrow stored-field slice of LLP 0115 CV-4b: schema-declared **plain-data
structured values** — objects, arrays, and unions built from the LLP 0131
recursive validator vocabulary — admitted at stored-field positions,
validated fail-closed at write through the same machinery CV-4a landed at
the arguments boundary, stored as one **RFC 8785 canonical-JSON `TEXT`
column**, and projected as exact generated types. The interior of a
structured value is **opaque to the query surface by design**: element
indexing, `arrayContains`/containment, structured matchers, ordering,
filtering, and search over interiors all continue to refuse fail-closed
exactly as today, now with teaching diagnostics. Asset references are
excluded from structured values entirely.

This is the second application of the carve-out pattern the
union-of-string-literals slice established on 2026-08-08 (LLP 0004/0007
dated amendments, per LLP 0191 §5): identify the slice that pays none of
CV-4b's four named costs — no new index semantics, no matcher vocabulary,
no representation decision for *indexable* structure, trivial migration —
and ship it without waiting for the owner Spec. The commissioned CV-4b Spec
(representation choice for indexable structure, element indexing,
containment, live-matcher semantics) **remains commissioned and unchanged**,
demand-gated on element-query evidence that no benchmark run has yet
produced.

## Motivation

The Clique P2 pilot (LLP 0201/0208, Diary 0073) is the richest builder
evidence to date, and its schema score (B1 72 vs Convex 85 / Supabase 88)
names the gap directly. Two of its instances are this Spec's demand:

- the quoted-reply **stored preview** object went through the `v.json()`
  escape hatch — untyped, unvalidated at write, loud degraded-contract
  diagnostics;
- the M7 evolution session stored **poll options** the same way.

Equally load-bearing is what the pilot did *not* need: across a full
messenger — feeds, group messaging, media, search, offline, a 166k-action
replay — **no surface queried the interior of a stored structure**. The
arrays in play were small bounded lists atomically replaced and never
filtered by element; the preview is opaque at read. The expensive parts of
CV-4b's commission (element indexes, containment, structured matchers) have
zero observed demand; the cheap part (typed, validated, canonical storage)
is where the boilerplate and the `v.json()` escapes were paid.

The machinery is already on main. CV-4a landed the full recursive
vocabulary with server-side ingress validation and RFC 6901 pointer
diagnostics at the args boundary (LLP 0131); CV-10 pinned RFC 8785 number
spelling at the storage/search canonical-bytes boundary; codegen already
projects exact recursive types for the same vocabulary at args and result
positions. This Spec extends that landed grammar to one new position rather
than designing a new one.

## Prior rulings this Spec binds itself to

1. **The 2026-07-31 bounded-array withdrawal (LLP 0044, author decision).**
   `v.array(v.assetRef(...))` is withdrawn; multi-asset relationships take
   the LLP 0110 bounded-children child-row path (validated by Party Wall),
   and `issues/20260809-multi-image-authoring-revisit-g8.md` bars treating
   a revisit as a default. This Spec **preserves that ruling**: asset
   references are refused inside structured values (see Design), so
   Clique's `img1..img4` splay is *not* solved here — its ruled answer is
   bounded-children steering (the open G8 ticket's ask 1), and any
   bounded-array-of-assets revisit remains a separate author ruling
   request against LLP 0044. There is also a genuine technical reason the
   exclusion is right independent of the ruling: the asset authority
   machinery (attach, grants, lifecycle, sharing scans) needs references
   addressable as rows, which opaque interiors would defeat.

   The withdrawal's recorded rationale, however, is phrased wider than its
   subject: "the portable field vocabulary ships no array table fields."
   Whether that clause binds plain-data values or only the asset-reference
   vocabulary that was the decision's subject is **open question 1** — an
   explicit author gate on this Spec's acceptance, per the G8 ticket's
   "new ruling request, not a default" bar.

2. **The literal-union carve-out (2026-08-08, LLP 0004/0007).** Stored
   unions of string literals have a landed representation (`TEXT` with a
   central fail-closed domain check, `FieldType::Enum`). This Spec does not
   re-represent them: a union of string literals **at top level** stays on
   the Enum path; unions appearing **inside** a structured value ride the
   canonical-JSON encoding like every other interior node. The boundary is
   the field's outermost node.

## Design

### Declaration

Stored-field positions admit the LLP 0131 recursive vocabulary —
`v.object(...)`, `v.array(...)`, `v.union(...)`, `v.optional(...)`, and the
scalar leaves — with these refusals, each fail-closed at schema compile
with a named diagnostic:

- `v.assetRef(...)` at any depth (prior ruling; authority machinery);
- `v.id(...)` / relation references at any depth in v1 (referential
  integrity and cascade semantics are the commissioned Spec's problem;
  admitting untracked row references inside opaque values would create
  dangling-reference states nothing owns);
- a bare structured node that is exactly a top-level union of string
  literals (routes to the landed Enum path instead, see above).

Spelling is the existing vocabulary — no second grammar, exactly as the
literal-union carve-out promised. LLP 0115 CV-4b's note that 0127 move 1's
one-grammar question stays unadjudicated continues to hold: this Spec
consumes the grammar; it does not extend it.

### Representation and write path

One `TEXT` column per structured field, holding **RFC 8785 canonical
bytes**. Deliberately `TEXT` on every target — not SQLite JSONB, not
Postgres `jsonb` — because binary/normalized JSON representations do not
preserve byte identity, and canonical bytes are the digest carrier the
evidence system already trusts (CV-10's number-spelling pin applies
verbatim). `v.optional` absence stores SQL `NULL`.

The write path is a central fail-closed check, sharing the CV-4a validator
core: validate the incoming value against the declared shape (RFC 6901
pointer diagnostics on refusal, same as `validate_function_args`),
canonicalize, enforce bounds, store. Non-canonical bytes are never stored;
a value that fails validation writes nothing (no partial write, matching
the CV-4a exit's property).

Bounds, fail-closed at write (proposed; open question 3): 32 KiB canonical
bytes per value, depth 16, 1,024 elements per array — the depth and count
ceilings matching the existing contract bounds and the portable collect
cap. Oversized values refuse with a named code; they do not truncate.

### Read path, types, and egress

Reads parse the canonical bytes and deliver the plain value; documents
crossing the API boundary carry the structure natively (LLP 0004's
"plain objects with schema fields" contract, now nested). Codegen projects
the exact declared type into generated document types, handler context
types, and client types — the same projection the args/result lanes
already do. The degraded-contract diagnostics that fire on `v.json()`
today do not fire on a declared structured field: that is the point.

### Query surface: opaque, with teaching refusals

In v1 a structured column admits **no predicates at all** — no equality,
no ordering, no `arrayContains`, no index declarations, no search-index
membership, no live-matcher inspection. Live queries treat the value as
part of the row: whole-row invalidation and whole-value replacement,
riding the existing delivery machinery unchanged. Each refusal names the
capability boundary and points at the CV-4b GAP row rather than emitting a
generic validator error. (Byte-equality on canonical bytes would be cheap
and well-defined; it is deliberately deferred to open question 2 rather
than shipped by default, because equality-on-structure invites
containment-shaped expectations the v1 surface refuses.)

### Migrations and forward compatibility (LLP 0081)

`FieldType::Structured` is additive. Adding a structured field is an
ordinary additive migration; the conservative applier admits no narrowing
between structured and any other field type in v1 (evolve by new field
plus backfill, the existing posture). Two forward paths are recorded so
this slice provably forecloses neither of the commissioned Spec's
candidate answers:

- if the Spec later picks **declared indexable projections** over a
  document representation, stored canonical bytes are already the
  document — projections materialize from them mechanically;
- if it picks **child-table expansion** for indexable arrays, canonical
  bytes parse and re-emit into rows mechanically, with the schema
  generation rotating as any representation change does.

Opaque-today data therefore upgrades by parse/re-emit under either future,
which is the answer to the re-representation-trap objection: the trap
would exist only if v1 stored non-canonical or lossy bytes, and it stores
neither.

### Capability and maturity

The slice ships as an experimental capability fact
(`structured_stored_value_v1` proposed) on the LLP 0113 qualification
route, per LLP 0115 decision 3's maturity ruling (0113 is the default for
new profiles). Support stays false until the acceptance corpus below is
green; the capability index GAP row for CV-4b narrows rather than closes —
indexable structure remains an honest GAP.

## Acceptance evidence (exit)

1. Clique's two plain-data instances expressed natively: the quoted-reply
   preview and the poll-options shapes declared without `v.json()`, typed
   end to end, with a seeded handler/type mismatch failing at typecheck
   (the CV-17 pattern applied to stored positions).
2. Fail-closed vectors: `v.assetRef` interior refusal; `v.id` interior
   refusal; over-ceiling value refusal (bytes, depth, count) with pointer
   diagnostics; a non-validating write provably writes nothing.
3. Canonical-bytes stability: the CV-10 insert/seed fixture class extended
   to structured fields — integral-Real spelling agrees between in-memory
   and reloaded values; digests stable across write/reload/patch.
4. Query-surface refusals: index declaration, filter, order, search
   membership, and matcher use against a structured column each refuse
   with the named teaching code on both the SQLite target and the schema
   compiler.
5. Guide: the schema page and capability index updated in the same landing
   (LLP 0061) — the GAP row rewritten to steer "typed structured value,
   interior not queryable" here and "queryable interior" to the
   commissioned Spec.

## Non-goals

- Element indexing, containment (`arrayContains`), structured matchers,
  ordering, or search over interiors — the commissioned CV-4b Spec owns
  these, demand-gated (LLP 0115's row is unchanged by this Spec).
- The representation decision for *indexable* structure (column-per-scalar
  vs document-plus-projections vs child tables) — explicitly not decided
  here; §Migrations shows this slice forecloses none of the candidates.
- Asset references in structured values, and any revisit of the
  2026-07-31 bounded-array withdrawal (LLP 0044's ruling stands; the G8
  ticket's steering ask proceeds independently).
- Unique-index-on-optional-field semantics — Clique's other B1 complaint;
  belongs to the LLP 0004/0131 owners (the G8 register notes its ticket is
  still unfiled).
- Relational/join expressiveness (the `feedEntries` read-model complaint)
  — CV-8 / LLP 0080/0110/0120 territory.

## Open questions

1. **Withdrawal scope (author gate).** Does the 2026-07-31 LLP 0044
   ruling's "the portable field vocabulary ships no array table fields"
   bind plain-data structured values, or only the asset-reference
   vocabulary that was the decision's subject? This Spec assumes the
   latter and cannot be accepted without the author ruling it so (and, if
   ruled so, LLP 0044 gains a dated clarification note).
2. **Byte-equality predicate.** Admit `eq` on canonical bytes in v1, or
   ship with no predicates at all (the current text)? Lean: no predicates;
   add equality only with a demand instance.
3. **Ceilings.** 32 KiB / depth 16 / 1,024 elements are proposals; the
   byte ceiling in particular should be checked against the live-delivery
   envelope before freezing, since structured values ride whole-value
   replacement.
4. **Nested optionality semantics.** `v.optional` at interior positions:
   absent-vs-null distinction must be pinned (RFC 8785 has no `undefined`;
   proposal: interior optionality means the key is omitted when absent,
   and `v.union([..., v.null()])` spells explicit null).
5. **Capability id and naming.** `structured_stored_value_v1` vs folding
   under a future `stored_fields_v2` family — naming should follow LLP
   0134's registry conventions at implementation time.
