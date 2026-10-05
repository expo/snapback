# NI context pack — llp-orient

Scope: versioned benchmark native instrument, independent reference application,
qualification artifacts and this report. No engine, SDK or published witness
implementation change. Existing calibration packets remain immutable.

Governing LLPs: LLP 0201 D3/D6/D7 (Accepted benchmark plan),
LLP 0201.000 §§2–7 (Accepted 2026-10-05, in current), LLP 0281 W3/W5/W7
(observation/identity/attribution), LLP 3000.030 §§5/6/8 (current, actual Release
app and process/build custody, SDK smoke limits), LLP 3000 §7 (current,
Snapback 4 fence and append-only journal). Foundation LLP 0189 governs scoped
verification; no exact-main battery is required for this local work.

Constraints: [LLP 0201.000 §6](../../../llp/0201.000-cross-lane-native-app-protocol.rfc.md#6-builder-prompt-and-series-break)
requires a separate instrument version and series; [§5](../../../llp/0201.000-cross-lane-native-app-protocol.rfc.md#5-artifact-and-grader-contract)
requires validated native artifacts and honest unmeasured status;
[§7](../../../llp/0201.000-cross-lane-native-app-protocol.rfc.md#7-cost-alternatives-and-acceptance-of-the-instrument)
requires negative controls and a separate two-app/two-backend pilot before scores.
The user's Phase-1 instruction commissions the implementation, qualification,
manifest/scripts and plan; Phase 2 is planning only. No delegation requested.

Rationale: native tree exposure, actual image pixels and server truth address
NP2's demonstrated gaps; Hermes export and SDK lifecycle smoke do not establish
application behavior. The existing `simulator.md` sequence remains the base.

Risks: native container accessibility, XCTest timing, process wrappers,
image-event false positives, artifact completeness and correlated reference/
driver defects. The independent builders of Phase 2 are essential; the reference
is deliberately a diagnostic test app, not a platform result.

Updates: versioned contract/prompt/grader/helper/driver/schema/manifest; accepted
RFC implementation/series-break record; append-only JOURNAL; full Phase-1 report
and unrun Phase-2 plan. Hand-off: llp-maintain affected-scope audit.
