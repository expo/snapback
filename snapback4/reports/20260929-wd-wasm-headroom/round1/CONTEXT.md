# WD round 1 context

Scope: restore duplicate-key allocation selection in ObjectFields; audit the
22 production small_map call sites; measure the correction and qualify it.

Governing LLPs: [LLP 3000](../../../../llp/3000-snapback4.explainer.md)
(the Snapback 4 root, in current), LLP 2000.000 §6 (deterministic heap meters),
LLP 3000.002#proposed-device-representation-and-codec-redesign (measured diet;
neither current nor foundation). The bounds guide's Allocation and completeness
section describes the existing heap cut. No authoring surface changes.

Active constraints: LLP 3000#4-fence-numbering-routing; LLP 2000.000#6-flip-1-certify-authorization-statically-meter-resources-at-runtime;
LLP 3000.002#proposed-device-representation-and-codec-redesign. Retain the meter,
formats, errors, size-first profile and 593,719 B cap. Merge origin/main first,
preserve both sides, run affected tests, the whole guide and test.sh once;
append one journal entry, commit with the requested trailer, no push/publication.

Rationale: equality/serialization omit String capacity but heap metering charges
it. Restore the old bulk constructor exactly instead of changing heap policy.
The small_map helper remains insertion-based only at audited sites where keys
are unique or the retained equal-key allocation is unobservable to consumers.

Risks: wasm size increases; old byte-only regressions do not detect meters.
Use both capacity orders and exact query outcome/charge assertions. This is a
native in-memory counterexample; no serialized web-input reproduction is claimed.

Likely doc updates: the existing diet LLP, round1 report and one journal entry.
Hand-off: none. llp-orient was read from the neighboring SR checkout because the
local vendor/llp skill symlink is uninitialized. No skill files were changed.
