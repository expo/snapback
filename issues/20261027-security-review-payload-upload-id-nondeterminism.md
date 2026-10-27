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
