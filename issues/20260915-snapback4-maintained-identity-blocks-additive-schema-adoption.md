# Snapback 4: an accepted maintained identity blocks additive schema adoption

Status: Open
Priority: P2
Date: 2026-09-15 UTC
Systems: snapback4-core, maintained aggregates, schema activation
Evidence status: independently reproduced on unmodified published 0.2.10; current-main runtime unverified

## Trigger and outcome

Legal grouped text values can create a maintained row whose engine-generated
identity exceeds the ordinary identity budget. The mutation succeeds and the
existing schema can read its source rows. Adding an unrelated index then
refuses to open the store with:

```text
cannot open the store: E_INPUT: identity exceeds 144 canonical tagged UTF-8 bytes
```

The 0.2.10 Clique Astra M7 builder first encountered this while evolving its
poll schema. Its 129-byte raw maintained ID is 150 bytes when wrapped and
escaped as a canonical `Id`. It recovered the prior schema and replaced the
derived tally with bounded counts over retained votes. The original failed
adoption and recovery remain benchmark evidence.

A separate public-CLI reproduction used three fresh external stores, no server
ports, and the unmodified 0.2.10 platform binary (SHA-256
`af4e26be10419df9428bf6be0c7513de07d227e33f77cdb464c4d93dc2a0767d`).

| Raw generated ID bytes | Canonical tagged ID bytes | Initial check, insert, read | Added-index read | Restored-schema read |
| ---: | ---: | --- | --- | --- |
| 123 | 144 | All exit 0 | Exit 0 | Exit 0; identical source rows |
| 124 | 145 | All exit 0 | Exit 2, E_INPUT | Exit 0; identical source rows |
| 138 | 159 | All exit 0 | Exit 2, E_INPUT | Exit 0; identical source rows |

These controls establish an activation consistency defect, not data loss or
an oversized application-supplied identity. Restoration is demonstrated only
for these synthetic cases; it is not a general rollback guarantee.

## Reproduction

The [retained command receipts](../benchmarks/runs/2026-09-14-snapback4-clique-0.2.10/audits/ASTRA-M7-AGGREGATE-ID-AUDIT.repro.json)
contain exact argv, both schemas, stdout/stderr, exits and row comparisons.
The [evidence audit](../benchmarks/runs/2026-09-14-snapback4-clique-0.2.10/audits/ASTRA-M7-AGGREGATE-ID-AUDIT.md)
also relates the boundary to the original M7 observation.

The minimal schema has `votes` with three `text 1..50` columns
(`conversationKey`, `messageKey`, `optionKey`), public reads/inserts/sync, and
`maintain tallies: count votes by conversationKey, messageKey, optionKey`.
An `add` mutation inserts those fields; `all` returns the first ten votes by
`byId`. Insert nine `c` characters, 36 `m` characters and 36 `o` characters
through `run add … --as alice --json`. Initial `check` and `run all` succeed.
Add only `by byOption: optionKey, id` to `votes`; the next `run all` refuses
store opening. Restore the exact prior schema and that read succeeds. Eight
`c` characters is the adjacent passing control. No credentials are needed.

## Likely mechanism and prospective verification

`schema::maintained_id` serializes the canonical group vector.
`engine/write.rs::apply_aggregate` wraps it in `Value::Id` and writes the
maintained row without the ordinary identity validation. After a schema
change, `store/activation.rs` rebuilds maintains and validates every row,
including the generated ID, through `validate_identities`. Nested JSON quotes
are escaped again in the tagged identity, explaining the exact 144/145 boundary.
The audited current source retains this mechanism; it was not built or run
for this ticket.

Reconcile maintained-ID construction and activation validation consistently.
The existing canonical spelling is conformance-sensitive, and identities
participate in storage, partition and cursor behavior: this ticket does not
choose a new encoding, raise the public budget, or authorize a broad exemption.
Qualification should cover the adjacent boundary, longer legal grouped text,
ordinary identity refusal, a harmless additive schema change, preserved source
and aggregate data, and atomic refusal/recovery. Search current main again
before implementing; other Snapback 4 sessions are landing concurrently.

This was discovered while carrying
[LLP 3000.007 §10.3](../llp/3000.007-relaxed-quarry-and-explicit-residency.rfc.md#10.3)
through fresh M7. It does not establish a need for SQL or change an author ruling.
