# Bounded-program IR and value model

This is the S1 hand-lowered kernel for LLP 0329.014.000, not a proposed
surface syntax. JSON is the canonical interchange encoding. Rust enums use
Serde's externally tagged form, object keys are serialized in sorted order,
and schema/program hashes are SHA-256 over that canonical JSON.

## Values

`Value` is exactly `null | bool | int | string | id | row | array | map`.
`int` is an i53 (`-(2^53-1)..=2^53-1`); arithmetic and maintained aggregates
refuse overflow. `string` and `id` are UTF-8 and compare lexicographically by
Unicode codepoint (UTF-8 byte order has the same scalar ordering). Rows and
maps use sorted string keys. Arrays retain order. Sort is stable and accepts a
literal list of ascending/descending row keys. There are no floats, dates,
undefined values, symbols, prototypes, locale operations, or implicit scalar
coercions.

Pure builtins are `len`, `slice`, `concat`, `min`, `max`, `divmod`, stable
`sort`, mention-token extraction, and deterministic share allocation. The
last uses sorted recipient ids as its tie key; the first `amount mod n`
recipients receive one additional unit. Division is Euclidean for non-negative
money values. Every builtin charges a static and runtime step cost.

## Program IR

`Program { name, kind, args, readTimeGranularityMs?, body }` has kind `query`
or `mutation`; argument lists carry declared maxima. The statement nodes are:

```text
const, let, assign, push, if, for, require,
insert, update, upsert, delete, return, break, continue
```

The expression nodes are:

```text
literal, variable, modeled-input, field, array, object,
binary, unary, builtin, get, exists, scan
```

`for` domains are `page(scan)`, literal `range`, `argList(max)`, a bounded
derived array, or `recurse(depth, fanout, visited-set)`. Helpers have no IR
node: lowering inlines them before checking. `get`, `getUnique`, and maintained
aggregate reads share the generic `get` node. All indexed reads use a `Read`
descriptor with table, index, key/prefix expressions, a stable site id, and
key provenance (`arg | viewer | const | shape | computed`). `scan` additionally
has literal/arg-bounded `take`, order, cursors, and a range on the first column
after its prefix. Writes are generic table operations; no node names a product
operation.

Modeled inputs are `viewer` in both kinds; `now` and queued `newId` values in
mutations; and bucketed `readTime` only when declared. Ambient time and ids do
not exist in the evaluator.

## Schema IR

A schema is tables with typed columns, composite/unique indexes, one rule per
effect (`read`, `insert`, `update`, `delete`), constraints, and maintained
aggregates. Rule predicates are algebraic equality/ordering/boolean forms plus
shape-keyed `exists`; rule-input visibility is explicit so hidden dependencies
produce scoped verdicts. Constraints are `unique`, `cap`, `appendOnly`, and
`immutable`. `interval.contains` and `exclusion` are intentionally skipped in
S1.

`maintain.count` and `maintain.sum` name a source table, grouping columns,
target table, optional value column, and optional declared `readable` rule.
The interpreter applies `+` on insert, `-` from the delete preimage, and
`-old/+new` on group moves in the same SQLite transaction. The target key is
the canonical group tuple. Overflow refuses the transaction.

## Certificate and traces

The checker emits hashes/version pins, read sites, write sites, constraint and
maintenance costs, maxima for examined entries/index entries/rule probes/
steps/heap/output/closure, result completeness, and per-transition prediction
sites. Sequential costs add; exclusive branches take their maximum; a loop
multiplies its body by its declared bound; recursion uses
`1 + fanout + ... + fanout^depth`. A scan reserves `take + 2` entries so its
authoritative trace can include row N+1 and the key of N+2. Refusals identify
the multiplication expression. A count/sum directly over a non-public scan is
conservatively `E_STRUCTURAL_COUNT`; a maintained aggregate with declared
`readable` is admitted and emits a disclosure.

Execution produces an authoritative trace containing all examined rows,
ranges, absences, and rule inputs, and a client receipt containing only
viewer-readable rows/ranges/absences plus halo data and scoped hidden-input
verdicts bound to `(ruleHash, pinnedInputsDigest, principal, authEpoch)`.
Runtime assertions enforce `receipt ⊆ trace ⊆ certificate`.
