# Snapback 4: the identity invocation-stall test is flaky under load

- **Opened:** 2026-09-26, during the 0.4.4 integration.
- **Severity:** Low: a test race, not a product defect found so far. It
  reddens a full `scripts/test.sh` run intermittently.
- **Area:** `snapback4/packages/snapback4/test/identity.test.mjs`, the test
  "invocation lifetime releases provider and private-core fetch and body
  stalls without late identity effects".

## What happens

`identity.test.mjs:904` asserts `entered.value === true` after
`s.invoke("beginOidc", …, { cancelOnStatus: true, coreFetch })` returns: the
invocation must have issued `/q/identity.byInvocation` before it was
cancelled. Under a loaded parallel suite the invocation can be cancelled on
its status before it reaches that fetch, so `entered` is still false:
`AssertionError: false !== true`.

Seen in the full suites of lane O round 1 (`lane-o2.r1.log`) and lane AD's
integration merge (`lane-ad.r3m.log`, 2026-09-26), on eb1000. It passed in
the other full runs of the day, and alone.

## Fix direction

Wait for the core fetch to be entered before the status that cancels the
invocation is delivered, or assert the weaker property the test needs (no
late identity effect after cancellation) when the fetch was never entered.
Prove it under load, for example 20 runs with the host busy.
