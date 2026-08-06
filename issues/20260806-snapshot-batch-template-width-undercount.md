# Snapshot-batch cursor budget template under-counts boolean and integer worst cases

**Status:** Open
**Opened:** 2026-08-06
**Related:** LLP 0157 §D8 (family template widths, pinned by the v0.11
`snapshot-batch.v2` amendment); LLP 0135 §2.4; Claude round-3 review finding
C2 (`llp/reviews/0157-composition-algebra-and-completeness.claude.md`)

LLP 0157 v0.11 pins the cursor-budget template widths to the digit for the
whole `sbsb1`/`sbsb2` family: string = `maxEncodedBytes` x 6 escape
expansion + 2 quotes; id order field and root `_id` = 256 unescaped bytes +
2 quotes; JavaScript-safe integer = 17 characters (`-9007199254740991`);
boolean = 5 (`false`).

The shipped v1 template in `src/local.rs` (`snapshot_batch_max_boundary`,
~:27113-27142) under-counts two of these by one character each:

- boolean worst case uses `Value::Bool(true)` (4 chars) instead of `false`
  (5);
- integer worst case uses the positive `9007199254740991` (16 chars)
  instead of the negative `-9007199254740991` (17).

A composite whose computed worst case lands at exactly the 6,099-byte
budget with a boolean or integer order field can therefore mint a plaintext
one byte over the admitted template at runtime — the "invariant failure"
path §D8 promises is unreachable.

A second reconciliation (Claude round-4 finding M2): the shipped template
substitutes a hard `"x".repeat(256)` for `FieldType::Id` order fields, but a
`v.id()` order value is application data with no length or grammar bound
(`src/args_contract.rs` validates nonempty only), so the 256 template is
not a sound ceiling — an oversized or quote-heavy id value can blow the
6,099-byte budget at mint time on a later page. LLP 0157 §D8 (as revised)
now requires an id-typed order field to carry the same schema-level,
write-enforced `maxEncodedBytes` bound a string order field requires,
counted at the same 6x escape expansion; only the framework-minted
root-`_id` tie-break keeps the declaration-free 256-byte template.

Fix: reconcile `snapshot_batch_max_boundary` to the pinned widths (`false`,
`-9007199254740991`; require the declared bound for `FieldType::Id` order
fields instead of the hard 256; keep the string 6x expansion and the
256-byte `rowId` as shipped), and extend the budget regression to sit
exactly at the 6,099/6,100 boundary with boolean, integer, and bounded-id
order fields. This must land with (or before) the `sbsb2` implementation so
v1 and v2 share one template, and before the frozen `sbsb2` parity vectors
are generated.
