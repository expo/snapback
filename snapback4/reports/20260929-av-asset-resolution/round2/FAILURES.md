# Round 2 failure ledger

Every unsuccessful test execution is retained. Ours includes defects introduced
by our round-1 patch and deliberate mutations. Parent test failures repeat their
named child's cause; they are not separate defects.

| Evidence | Failure | Classification and disposition |
| --- | --- | --- |
| before.log.gz | a real HTTP video progressing for over five seconds completes in one transfer | Ours, expected red against round 1: abort after five seconds despite continuous bytes. Fixed with progress-sensitive reading. |
| before.log.gz | body progress extends the thirty-second inactivity deadline; an actual stall still recovers | Ours, expected red against round 1: sixth-second progress still observes aborted request. Fixed; progressing stream lasts 36 virtual seconds, real stall still recovers. |
| before.log.gz | a stalled 503 error body preserves Retry-After 60 | Ours, expected red against round 1: two requests before the minimum. Fixed by capturing the absolute deadline at headers. |
| before.log.gz | a stalled 503 error body preserves Retry-After Thu, 01 Jan 1970 00:02:40 GMT | Ours, same defect with HTTP-date guidance; fixed. |
| before.log.gz | credential rotation preserves an asset admission refusal and its recovery deadline | Ours, expected red against round 1: old and new bearers both requested immediately. Fixed by returning the same rate-limit outcome. |
| affected-first.log.gz | useAsset preserves real admission cooldown through focus and reconnect (plus its parent) | Ours, initial test harness read the loading state before the real transport promise settled. Await that promise inside React act; all 56 React tests pass. No product timing change. |
| mutant-cooldown.log.gz | useAsset preserves real admission cooldown through focus and reconnect (plus its parent) | Ours, deliberate guard-removal control: focus before Retry-After sends request 2. Source restored byte-for-byte; original hook already passed and the full suite uses it. |

A preliminary documentation replacement used a snapback4-prefixed path while
already inside snapback4; FileNotFoundError, no edit. Corrected from repository
root immediately. The suite command followed that error and ran once; it was
not restarted. Final whole-guide validation includes the completed text.

Additional review controls and corrections:

| Evidence | Failure | Classification and disposition |
| --- | --- | --- |
| grok-local-before.log.gz | process, under queued local avatars survive credential rotation without invalidating retained handles | Ours, expected red: all 34 queued requests return synthetic E_AUTH. Fixed before current credential/retention checks. |
| grok-local-before.log.gz | wasm, same parent | Ours, fixture setup: Node cannot fetch the default file: wasm URL. Supply canonical wasm bytes as the existing Node device tests do. |
| grok-local-before-2.log.gz | process and wasm, same parent | Ours, expected red on both real devices after fixing wasm setup: 0/34 ready. Both now reach 34/34 with only the refreshed bearer and the retained handle stays usable. |
| grok-hook-before.log.gz | useAsset preserves real admission cooldown through focus and reconnect | Ours, expected red: no timer exists for the early recovery event. Fixed by scheduling one deferred recovery. |
| grok-hook-before.log.gz | useAsset remembers recovery while busy and cancels delayed recovery on unmount | Ours, expected red: busy event is lost, leaving one call. Fixed; final test is named useAsset remembers one recovery event while busy without looping. The unmount assertion is in the cooldown test. |
| rotation-backoff-before.log.gz | rotation during admission backoff returns the existing refusal instead of resetting custody | Ours, expected red: after the pause, synthetic E_AUTH replaces the already-received E_RATE_LIMIT. Preserve the previous refusal/deadline. |
| mutant-bare-status.log.gz | bare HTTP 408, 429, 500, 502, 503 and 504 retries ordinary bytes without a refusal envelope (six tests) | Ours, deliberate removal of both transient status lists in an isolated built package. All six fail with a one-call nonretryable E_HTTP_RESPONSE; unmutated tests pass. |

The final hook mutation was repeated in an isolated source tree, leaving the
running full suite's sources untouched. Its first setup run
(mutant-cooldown-setup.log.gz) failed to locate the guide recipe through a relative
path: ours, corrected to the original absolute inputs. The corrected
mutant-cooldown-final.log.gz has 55 passes and two failures (the same cooldown
child and its parent), specifically early focus requesting twice. That is an
expected detecting red, ours. The final unmutated React run passes 57/57.

Full-suite exact summary: `== 1 failure(s) in 1324 s`, stage `client tests`.
It exited 1 and had exactly one failed test:

- **Ours:** `web: concurrent public asset retries vary beyond Retry-After`,
  `overload.test.mjs:478`, 2,290.553036 ms within its unchanged 15,000-ms limit.
  The assertion observed three distinct recorded waits, expected four. The
  fixture recorded only delays >=1,000 ms and expected exactly
  1,000/1,062.5/1,125/1,187.5 ms. An absolute deadline captured at headers
  subtracts body-decoding elapsed time, so even a one-ms decode can correctly
  schedule 999 ms remaining before the minimum, which its filter discards.
  Both exact-jitter fixtures now hold Date.now fixed while decoding, explicitly
  measuring zero body time. All original timer/count/jitter assertions and
  timeouts remain. Separate asset regressions test elapsed-body timing and
  deadline preservation. The complete overload file passes 109/109 in overload-final.log.gz;
  elapsed-body-final.log.gz additionally passes the 500-ms body / 500-ms
  remaining minimum case.

No full-suite failure is classified baseline or environmental.
The suite ran once. No green full-suite result after the correction is claimed.
