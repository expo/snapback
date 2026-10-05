# Round 4 context and affected audit

Scope: the native instrument's refusal polling and image detector, regression
and artifact controls, native contract, LLP 0201.000 and the NI qualification report.

Governing LLPs: [LLP 0201.000 §§4–7](../../../../llp/0201.000-cross-lane-native-app-protocol.rfc.md#4-generic-driver-and-the-eight-steps)
(current) requires visible refusal, retained evidence and gated admission;
[LLP 0189](../../../../llp/0189-verification-cadence-and-claim-gating.decision.md)
(foundation) scopes verification; [LLP 3000 §4](../../../../llp/3000-snapback4.explainer.md#4-fence-numbering-routing)
(current) preserves the Snapback 4 fence. No engine or authoring surface changes.

The new Round 4 section supersedes only Round 3's original-size detector and
retry behavior. The native contract and README now describe the implemented
scale range, refinement, correlation threshold and terminal disclosure failure.
The prior round sections and original packet identities remain historical records.
The two code annotations resolve to the new governing section. No new LLP is needed.

Qualification compares all archived cold captures and reruns every artifact
control. Diagnostic copies explicitly bind their original source and the new
verifier; they are not new live executions. The user requires a live mini rerun
only if the detector changes an archived verdict. No such change was observed.
Only the unchanged Swift journal tests need the mini's compiler; no simulator
was used this round. The native runner/reference/helper hashes are inherited
from Round 3, whose source continuity is separately recorded.

The remaining limits are bounded scale/aspect matching, no arbitrary rotation
or heavy occlusion, and the existing requirement for full video review.
Phase 2 and scored admission stay disabled. Hand-off: none.
