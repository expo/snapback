# Security review payload renders host-minted upload IDs in plain id fields

Status: Open
Date: 2026-10-27
Updated: 2026-10-28
Scope: Snapback4 security replay presentation; no demonstrated verdict drift.

SEC11L's strict 800-schema comparison flags wave23
008-snapback-arborist-removal-quotes, N_ARGUMENT_GRANT, for expanded witness
row/old/supportingRows/generatedIds/summary fields. The same mismatch occurs
between two runs of the unchanged SEC11 production binary. Decision ID and
product witness ID are identical; SEC11's classifier has no new result.

openQuote copies minted image argument `.id`s into the ordinary optional
siteSurveys.buildingsPhoto/linesPhoto/treePhoto `id` columns. The expanded
question renders those raw identities, while the witness identity intentionally
uses nominal graph identity. Compiler asset-column typing cannot justify
normalizing ordinary id fields. SEC11L therefore retains the strict literal
comparison failure and does not claim full payload byte identity.

Follow-up: define a deterministic presentation/origin-evidence boundary for
these uploaded-ID references, preserving opaque values, callers, equality
edges, rows, histories and actual decision/FIX identities. Do not merely scrub
ULID-shaped strings or replace the full-payload proof with witness-ID equality.

Evidence: snapback4/reports/sec11-latency/ and LLP 3000.036.004.000.000.
Raw captures remain under ~/sb4-loop/reports/sec11l.

Integration 29 reran the strict sequential/unoptimized comparison on 78 schemas
(50 wave30 plus calibrated later-wave lanes and this known ordinary-ID control).
Final optimized binary SHA-256
`70280c4533a44a0b099b1fdc3431223cdfbdd57df15479c14f34913c08d71a62`;
external sequential control
`594c8d976ab8f333200b79a6161e85ce5b64b4995fc51e1734f36f62cdde2bcc`.
There are zero decision-ID, witness-ID, tier or verdict mismatches. The only
strict raw payload mismatch is again wave23-008: 29 scalar/summary differences
flow from host-minted upload identities in expanded supporting data. The strict
comparator retains exit 1; no field was normalized and no allowance was added.

A fresh cold pair using the exact same final optimized executable on both sides
reproduces the raw mismatch, again with identical decision/witness IDs and
verdicts. This is the previously documented presentation boundary, not evidence
of drift caused by scheduling/batching/cache changes. Literal full-payload
qualification remains unestablished. The existing follow-up above remains Open.
This external comparison is separate from the selected Rust/client assertions
and publication's packed consumer chain; neither failed receipt is relabeled.

Evidence: `snapback4/reports/integration29/sequential-comparison-summary.json`,
`payload-repeat-summary.json`, `payload-repeat-provenance.json` and
`sequential-payload-difference.json` in the same directory. Private full payloads
and copied executables remain under `~/sb4-loop/reports/integration29/`.
## LAT1 full-report identity evidence

The stronger 940-schema LAT1 comparison retains the full raw security reports as
well as expanded questions. It finds 30 literal command-pair differences across
18 schemas: five pairs in this existing copied-ID witness, and 25 pairs limited
to typed image/file metadata IDs in raw counterexamples. Two independent fresh
executions of the unchanged sequential control reproduce the permitted drift in
every affected schema. No verdict, gate, question/witness ID, caller, other value
or history/order difference remains. Source-bound graph audits preserve aliases,
all other metadata, valid ULID form and the logical ID timestamp; they do not
scrub arbitrary strings. The literal comparator and its nonzero result remain.

Exact source scopes, capture/tool hashes and independent review provenance are
in `snapback4/reports/lat1/identity-{summary,provenance}.json`; raw captures and
historical audit tools remain under `~/sb4-loop/reports/lat1/`. This verifies the
LAT1 exception boundary and does not implement deterministic presentation. The
ticket stays open for that separate follow-up.

## Integration 30 full-corpus evidence

The merged 0.4.46 full 1,020-schema/6120-pair comparison has 6,091 literal matches
and 29 nonce-only pairs across 17 schemas. Raw comparison still exits1. Two fresh
unchanged-control executions independently reproduce the drift in every affected
schema; source/fixture/binary/tool/capture hashes bind the complete census.
There are zero unexplained differences or changed decision/witness IDs, verdicts,
gates, tiers, callers or non-upload payload values.

The copied-ID case has exactly the same 29differing paths already retained by
Integration 29. SEC11b also renders those six openQuote image.id origins in the
supporting initial rows of fixed child-evidence witness
`6d0fc50b02b03f14d78eebd7fa8dccace04f176ab870f42ddf7110f5b8482c99`.
The old LAT1 checker is preserved unchanged; a source-hash-bound adapter covers
that one additional fixed witness alongside the original fixed argument-grant
witness. Sixteen negative controls reject altered callers, decision/witness IDs,
tiers, ordinary IDs, row/history ordering, alias loss, logical timestamps, opaque
values and unrelated verdicts. The original nine controls also pass. Historical
review approval is not claimed for new captures or the adapter.

[Complete qualification](../snapback4/reports/integration30/identity-summary.json)
and [verbatim tools/provenance](../snapback4/reports/integration30/metrology/README.md)
retain the literal mismatch and narrowly scoped exception boundary. This does
not implement deterministic upload-ID presentation; the ticket remains Open.
