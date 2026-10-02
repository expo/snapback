# BG round 8 orientation (llp-orient)

Scope: maintenance type admission in core, Quarry lowering/helper identities,
compiler/native generators and existing guide/examples. Read the round-7 report
first at 723fe3f962. Supplied reviews: Grok READY; Astra NOT READY with one P2,
captured rows erased by resets skipped by break/continue. No new review claimed.

Governing LLPs: LLP 3000 (Snapback 4 fenced root, current), LLP 2000.000
(design brief, current), LLP 3000.015#3 (maintenance admission, current).
Read Snapback 4 AGENTS, NOT-DOING, journal tail, rules/RULES, the maintains card
and in-scope @refs. Foundation has no Snapback 4-specific kernel; current holds
the governing specification. Its existing #3 refs remain applicable.

Active constraints: LLP 3000.015#3 keeps status as returned data and defaults
all inspecting builtins to refusal on maintenance types. The round-8 operator
ruling replaces flow-sensitive tracking with every-assignment, whole-scope
inference, including all helper calls/returns. LLP 3000#7 and the fence preserve
existing ceilings; no runtime count/deadline/resource/window design change.

Rationale/risk: four precision gaps now motivate conservative typing. Inlined
helper instances must share compiler-only lexical identities; raw IR must remain
independently checked. Compiler scalar point reads internally reused a row slot
for the count and must use separate slots under this rule. Ordinary null flow
narrowing is outside this property's scope. Preserve all earlier compiler cases,
803 native cases, builtin census and allowed returned-data/scalar forms.

Updates: LLP 3000.015#3, maintains card, round-8 report and evidence, one dated
journal append. Run affected checks, guide, work/wasm and scripts/test.sh once on
final source. Commit with the requested Astra trailer; no push/publication.
Hand-off: none.


Full-suite integration follow-up: read LLP 3000.023#11 and the E_QUERY_HELD
card before changing backend.ts's static held-count recognizer. The compiler
slot split exposed an exact-shape dependency: preserve the narrowly proven
unconditional literal-key online-only Count case and every exclusion. Existing
one-shot/review tests reproduce eight failures before the correction. The first
full run is preserved, with all source hashes unchanged; the corrected final
source receives its own full run. This additional run is required by an owned
integration regression and is explicitly reported, not hidden or called baseline.
