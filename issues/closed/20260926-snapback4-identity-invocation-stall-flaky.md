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

## Resolution (2026-09-27, lane FK)

This was a test race. An action status can cancel an invocation before any
particular provider request, private-core query or session mint starts.
The old fixture cancelled on its first 100 ms status poll, while the test
asserted it had already entered the selected stall. Body cases also marked
entry at fetch dispatch, so they could pass without consuming the body.

The fixture now makes the status poll arrive first on every run, then gates
its cancellation response on actual entry into the selected fetch or body
consumer. It yields one timer turn between status arrival and entry. The
same cancellation, aborted signal, no-mint/no-verification, and no-late-core
assertions remain. Body entry is now proved at consumption, including clones.
No identity runtime or authorization code changed.

Proof on expo-build-1000, starting from `9473e0a34`:

- Removing only the entry wait from the cancellation hook and selecting the
  private-core cases fails **5/5**, `false !== true` at the entry assertion.
- The complete fixed test passes **20/20**, five test processes at a time,
  sharing cores 0–7 with eight CPU workers. All ten provider/private-core/mint
  fetch and body scenarios execute in every run (200 scenarios total).
- Evidence: `snapback4/target/lane-fk-evidence/identity-old-core-*.log`,
  `identity-fixed-*.log`, their JSON summaries and `repeat.py`. The control
  is `identity-early-core-status.test.mjs`; repeat with
  `python3 target/lane-fk-evidence/repeat.py identity-fixed packages/snapback4/test/identity.test.mjs 'invocation lifetime releases' 20`
  from `snapback4/`, with the pinned Node on PATH.

The full-suite result is recorded in this lane's dated JOURNAL entry and
final report; this resolution claims the affected loaded proof above.
