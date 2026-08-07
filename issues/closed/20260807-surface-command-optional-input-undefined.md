# Surface-bound commands materialize omitted optional inputs as undefined and get refused

**Status:** Closed
**Impact:** 3
**Urgency:** 3
**Ease:** 3
**Confidence:** 5
**Systems:** Codegen, Client commands, Surfaces
**Date:** 2026-08-07
**Related:** Diary 0066 (three-lane measurement, 0.1.12)

A surface-bound command with an omitted optional input composes
`{ replyToId: undefined }`; the canonical-value gate refuses the
`undefined` (ambiguous outcome). Both measurement lanes hit it; both
worked around by splitting into two commands / direct `useSnapbackCommand`.
This is the optional-arg contradiction class one layer up: the binding
should omit absent optionals (the `argOpt` semantics landed 2026-08-06),
and if a binding shape cannot satisfy the gate, generation should refuse
with a remediation (LLP 0178 V1 pattern) rather than composing a caller
that fails at runtime.

## Resolution

Closed 2026-08-07. Surface binding composition now preserves omission
lineage for optional inputs at both top-level targets and bounded scope-record
fields, while explicit `undefined` remains refused by the canonical client
value gate. Existing React command and mutation tests cover omitted, present,
and explicit-`undefined` calls; generated app types and the guide document the
same contract. No new generation refusal was needed because codegen derives
each surface input's optionality from its target validator, so every admitted
optional binding can express omission.
