# Security review payload renders host-minted upload IDs in plain id fields

Status: Open
Date: 2026-10-27
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
