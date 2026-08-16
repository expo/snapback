# Tiny-data transaction handles collapse terminal dispositions into refusal

**Status:** Open
**Impact:** 4
**Urgency:** 3
**Ease:** 4
**Confidence:** 5
**Systems:** Tiny data surface, Client SDK, Offline mutation custody
**Date:** 2026-08-15
**Governing:** LLP 0255 S7.3-S7.4
**Related:** `packages/snapback-client/data-client.mjs:237-250`,
`packages/snapback-client/data-client.mjs:284-322`
**Found while:** Whole-codebase correctness review (2026-08-15)

## Problem

The canonical mutation store exposes distinct terminal dispositions:
`failed`, `stranded`, `quarantined`, and `resultGone`. LLP 0255 likewise makes
those distinct values of `DataTransactionStateV1.dispatch`; once custody was
accepted, S7.4 explicitly says they are not retroactive admission refusals.

The tiny-data projection loses that distinction in two places:

```js
if (disposition.status === 'refused' || disposition.status === 'failed') {
  return { ...previous, custody: 'not-offered', dispatch: 'refused', settlement: 'refused' };
}
```

and `observe()` sends both `failed` and `refused` through `refuseFrom()`, which
publishes `dispatch: "refused"`. A queued transaction that later fails therefore
reports a refusal instead of `custody: "accepted", dispatch: "failed"`.
Recovery handles have the same loss. Separately, `resultGone` falls through the
generic arm, leaving `settlement: "pending"` instead of the specified
`"result-gone"`.

This is not presentation-only: applications use these axes to decide whether
retrying is safe. Flattening an accepted failure into a pre-custody refusal can
invite a new-intent retry after the platform already owned the original intent.

## Desired outcome

Project every canonical terminal disposition into its matching dispatch value.
Preserve known accepted custody. Project `resultGone` onto the result-gone
settlement arm. If a recovered canonical record does not currently expose
enough custody history to populate the independent axis truthfully, extend the
canonical status projection instead of guessing.

## Acceptance

- A `queued -> failed` record remains `custody: "accepted"` and reports
  `dispatch: "failed"`, never `refused`.
- Recovered `failed`, `stranded`, `quarantined`, and `resultGone` records retain
  their exact dispatch spellings.
- `resultGone` reports `settlement: "result-gone"`.
- A genuine pre-custody refusal still reports `custody: "not-offered"`,
  `dispatch: "refused"`, and resolves the refusal settlement arm.

