# Guide gap: sessions cannot compose with bounded streamed actions

**Status:** Resolved
**Area:** Local target, Sessions auth, Streamed actions, Capability admission
**Found by:** LLP 0102 Research Room/Snapback deep-round arm
**Date:** 2026-07-29
**Governing:** LLP 0058, LLP 0076, LLP 0096, LLP 0102

## Problem

At frozen source commit `5f31cb6174daaefa04a1e05242acbbc22c725040`,
a generated sessions artifact requiring `bounded_response_stream_v1` is
refused before listener readiness with `SNAPBACK_CAPABILITY_UNSUPPORTED`, even
when `SNAPBACK_OUTBOUND_ACTIONS=1` is present during generation and runtime.

The exact binary passes the canonical dev-auth streamed-action witness 8/8.
The generated capability manifest also declares outbound actions and
`bounded_response_stream_v1`. Source inspection localized the mismatch:
sessions cold-start preflight evaluates `CapabilityManifest::local_v0_declared`
instead of the process-live target facts used by ordinary loading and
inspection.

The Guide teaches sessions and bounded streamed actions independently without
an executable composition witness or a warning that the combination is
inadmissible. Research Room consequently failed before seed, authenticated
progress, collaborator observation, cancellation, settlement, cron, or
performance could run.

## Required product outcome

- Sessions candidate preflight, ordinary publication, generated manifests, and
  served inspection evaluate the same process-live target capability facts.
- The fix preserves complete-pair startup, auth-mode transition fencing, and
  refusal of a narrow-carrier hot-publication workaround.
- A failure caused by a genuinely absent process capability still refuses
  before bind with a precise diagnostic.

## Guide resolution

- Add a CI-verified sessions-plus-streamed-actions example.
- Show the egress grant on both generation and runtime commands.
- Until the product fix lands, register the composition as an explicit GAP
  rather than presenting the two surfaces as jointly usable.

## Evidence

- `demos/backend-bakeoff/arms/research-room/snapback/receipts/sessions-stream-admission-defect.v1.json`
- `demos/backend-bakeoff/arms/research-room/snapback/receipts/acceptance-failure.v1.json`
- `demos/backend-bakeoff/arms/research-room/snapback/receipts/diary-entry-draft.md`

## Acceptance

- a fresh generated sessions app cold-starts with a bounded streamed Action;
- two genuine sessions observe authoritative intermediate progress;
- cancellation prevents a late durable patch;
- known failure, success, ambiguity, timeout, and cancellation remain distinct;
- the same artifact/capability pair is reported by generated output,
  cold-start preflight, publication, and `/_snapback/api/inspect`; and
- the opposite egress-disabled case still fails closed before bind.

## Resolution

Resolved 2026-07-29 by `894ddaf99`. Sessions complete-pair preflight now
constructs the same exact process-live target manifest as ordinary loading and
served inspection, including the runtime egress predicate. A two-child
regression proves that the enabled process admits the streamed artifact while
the disabled twin refuses it before bind without installing effects.

The isolated Research Room confirmation then exercised the frozen application
end to end: 13 PASS, the same two files/semantic-search GAPs, zero FAIL, and no
Stop-class defect. Two genuine sessions observed authoritative progress;
cancellation fenced a late write; all five settlement outcomes remained
distinct; cron/config and cleanup passed. The external copy disclosed its
separate membership-cardinality and inspection-client adaptations.
