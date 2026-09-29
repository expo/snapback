# WD context pack

Scope: device wasm size; internal map construction and the existing build script.
The Snapback 4 fence applies. No Snapback 1/2 inventory or Ibex gates apply.

Governing documents: LLP 3000 (root, current); LLP 2000.000 (design brief);
LLP 3000.002#proposed-device-representation-and-codec-redesign (diet rationale,
not a new accepted codec); LLP 3000.007 (current; preserved continuation,
coverage, publication and prediction semantics at the touched call sites).
Read the sync guide and the current device/codec source before editing.
The final reference audit also checks LLP 3000.007 §§5.6, 18.1–18.2,
19.2 and 20.5; LLP 3000.001 Repair B and component composition; and the
LLP 3000.014/3000.015/3000.028 authority and coverage rules attached to
the changed constructors. Their deciding fields, iteration order, output
keys, coverage values and publication boundaries are preserved.

Constraints: LLP 3000#7-decisions-during-execution keeps one interpreter;
LLP 3000.002#proposed-device-representation-and-codec-redesign requires measured
artifacts and real acquisition evidence. Preserve the serde definition,
canonical order, persisted bytes, errors, device work and checks. The user's
fixed 593,719 B cap and 12,000 B recovery target override historical budget-raise
language. Keep opt-level=z. Do not push or publish.

Rationale: the existing typed reader/writer family and reachability checks already
pass; bulk B-tree construction still instantiates sorting per type and iterator.
Keep B-trees and their ordering; use insertion for bounded field/plan maps.
Large row/index stores are not changed. Binaryen folding overlaps HV's existing
pass; source savings and codegen savings must be stated separately.

Risks: small-map construction can change CPU cost, compiler output depends on
source locations and toolchain, and raw symbol counts are not compressed costs.
Qualification therefore compares real builds and paired acquisition. No new
format or authoring surface needs a guide change. Update the existing diet LLP,
report, and append-only journal. Hand-off: none.
