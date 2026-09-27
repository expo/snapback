# Lane FX round 2 — deterministic useNow expiry

2026-09-27. Branch `sb4-intent/fx-flakes-2`, based on `f39598de7`.
The required first fetch/merge returned `Already up to date.` Read both
previous prompts, reports and journal entries. No product change, push,
publication, version bump, dependency change or shared tool installation.

## Cause and deterministic counterexample

**This is a test clock-control error, not a demonstrated product expiry race.**
The fixture sets Bob's deadline to `client.now() + 120000`, increases its
mock server offset by 120000, samples a new clock revision, and assumes Bob
has expired. But `client.now()` incorporates the measured request midpoint.
A revision starts a new sample window. If its request is faster, losing the
previous positive midpoint bias can leave issued time *before* Bob's deadline.
The still-live row should remain visible.

The replacement test runs the real `createClient`, `ServerClock`, `useNow`
and published `useExpiringRows` recipe in Chromium/React StrictMode. Only
the wall source, transport and timer delivery are controlled. A request
advances the injected wall by 40 ms before stamping its response; it does
not sleep. Every subsequent request has zero injected latency. The complete
schedule is independent of CPU load:

| Point | Controlled value |
| --- | --- |
| Initial send / stamp / receipt wall time | 1000 / 1040 / 1040 |
| Server offset | 90000000 |
| Initial estimated offset | 90000020, from `serverNow - (sent + received) / 2` |
| Wall after Alice's exact expiry checks | 1540 |
| Bob's deadline from `client.now() + 120000` | 90121560 |
| Issued time after the old `offset += 120000` revision | 90121540: **20 ms before expiry** |
| Issued time after a further controlled 20 ms correction | 90121560: **exactly expiry** |

Applying the old immediate empty-DOM assertion at the first revision fails
**5/5**, with the original `clock advance repaints without another row
answer: "bob"` signature. The normal test first verifies the still-live
row and its 20 ms timer, then samples exactly the deadline and requires an
empty DOM without another row answer or parent render. It also drives the
normal timer to exact expiry with no new answer. Both pass on unchanged
product code. This reproduces the invalid assumption deterministically;
the historical logs did not capture their precise RTTs, so this is not a
claim to reconstruct those runs' exact scheduling history.

## Changes, file by file

Paths below are relative to `snapback4/`, except the ticket.

| File | Change |
| --- | --- |
| `packages/snapback4/test/helpers/react-harness.mjs` | Import the existing ServerClock and replace only the useNow fixture's live clock/waits with a controlled clock, response latency and actual hook timer callbacks. Preserve replacement, expiry, correction, rollback and cleanup assertions; add exact-time, timer identity and row-answer-count assertions. Restore timers/client in finally. |
| `packages/snapback4/test/react.test.mjs` | Add the test-only Vite alias for the existing `src/clock.ts`. |
| `../issues/closed/20260927-snapback4-react-usenow-deadline-flaky.md` | Move the open ticket here, preserve its observations, and append the cause, resolution and deterministic/loaded evidence. Adjust its historical report link for the new directory. |
| `reports/20260927-fx-flakes/ROUND2.md` | This report and KG integration handoff. |
| `reports/20260927-fx-flakes/round2-qualification.json` | All run statuses, counts, log hashes, controlled schedule and unchanged wasm measurement. |
| `JOURNAL.md` | One dated append; previous entries remain verbatim. |

The changed source files are 1,427 and 241 lines. No new gate, test file,
diagnostic, LLP design decision or public form is introduced. The existing
render form remains exercised directly from the published recipe:

```jsx
const now = useNow(deadline);
return rows.filter(row => row.expiresAt === null || row.expiresAt > now);
```

The test's Typing component renders `useExpiringRows(rows)`, which calls the
above hook and filter. No product source needs an annotation or doc change.

## What the assertions prove

- Replacing Alice's 200 ms lifetime with 500 ms cancels the *actual* old
  timer, leaves her visible at the old deadline and one millisecond before
  the new deadline, and hides her at exactly the new deadline. No further
  row answer is supplied.
- The injected midpoint bias is exactly 20 ms. A forward correction ending
  before Bob's deadline leaves him visible with one timer for the remaining
  20 ms. A correction to equality hides him and cancels that timer, with no
  new row answer and without delivering a timer to mask a missing clock notice.
- A 120000 ms backward correction keeps issued time monotonic, retains Carol,
  and schedules exactly 240000 ms to her deadline. Unmount removes that timer.
- Removing only `tick(n => n + 1)` from the deadline timer callback fails
  **5/5** at `the published hook owns the replacement deadline render: "alice"`.
- Removing only the same tick from the `onClock` callback, leaving rescheduling
  intact, fails **5/5** at `clock advance repaints without another row answer: "bob"`.

Each negative run has exactly the intended child failure and its enclosing
React parent failure: 46 passed, 2 failed, 0 skipped. Both product mutations
were temporary and restored byte-for-byte. Built product output was not
mutated. The negative controls prove both DOM assertions remain meaningful.

## Reproduction and qualification

From `snapback4/`, after the frozen install and package build:

```sh
export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
python3 reports/20260927-fx-flakes/repeat.py round2-react packages/snapback4/test/react.test.mjs . 20
CARGO_BUILD_JOBS=8 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 CARGO_INCREMENTAL=0 cargo test -p snapback4-lang --test guide
```

To reproduce the old false failure once **without a load driver**, retain
the controlled latency/timers and put the old assertion immediately after
the two-minute jump. This restores the exact harness on exit:

```sh
python3 - <<'PY'
from pathlib import Path
import subprocess
p = Path('packages/snapback4/test/helpers/react-harness.mjs')
before = p.read_bytes()
s = before.decode()
start = s.index('      equal(client.now(), bobDeadline - 20,')
end = s.index('      equal(host.textContent, "", "clock advance repaints without another row answer");')
try:
    p.write_text(s[:start] + s[end:])
    result = subprocess.run(['node', '--test', 'packages/snapback4/test/react.test.mjs'])
    assert result.returncode == 1
finally:
    p.write_bytes(before)
PY
```

This no-load command was also executed: the expected child and parent fail
(46 passed, 2 failed), with the same Bob signature. The restored harness hash
matches the 20-run qualification. Its log is
`target/lane-fx-evidence/round2-old-assumption-unloaded.log`.

The two callback mutations above can likewise be applied individually to
`src/react.tsx`; the browser imports that source, so no build is needed.
The executed three-control driver and logs are in
`target/lane-fx-evidence/round2-controls.py` and `round2-*.log`. All 15 negative
runs used the existing repeat driver; their deterministic cause is the
injected schedule, not load. The committed qualification records every
per-run status and digest.

Final **complete React file: 20/20**, **48/48 tests each**, zero skipped or
cancelled. Five Node/Chromium processes at a time share cores 0–7 with eight
CPU workers, using the unmodified round-1 driver. Recorded final host load was 23.14 / 16.78 / 16.98. No rerun substituted for
a red result. The full guide then passed **86/86**, zero ignored, 2.60 s test
execution. An earlier guide pass and the 48/48 smoke also passed. Frozen Bun
install and package build passed. Tools: Node 24.13.1, Bun 1.3.14, Rust 1.97.0.
`ref-check --verbose` passed: 517 LLP docs, 9,618 references, zero errors
and zero unchecked. `git diff --check` passed. No final test failure is
lane-owned, baseline or environmental. A first
control-driver launch used the repository root, so its log redirection failed
before running tests or applying mutations; it was launched from `snapback4/`
after that setup error.

`scripts/test.sh` was **not run**, as instructed for test-only changes.
There is no round-2 full-suite summary or failure list. The historical round-0
result remains `== 0 failure(s) in 1436 s`, exit 0; it is not round-2 evidence.

The unchanged wasm is **1,981,512 B raw / 572,053 B gzip** (`gzip -9 -c`),
SHA-256 `5436a3d17dc29dbee2148bbad942ddea866526e48f9d159e96be5a6c18fe1969`.
Device-code delta **0 B**, unchanged budget 572,841 B, headroom 788 B.

## KG integration handoff

Read KG's current report and compared
`sb4-intent/kg-kept-through-authority` at
`a5a6d534f1b89c4b2ac7f6e158ae54f64f2bed10`. Its useNow implementation is
byte-identical to ours. **Every product line touched in KG's named areas: none.**

| Product file under `packages/snapback4/src/` | Changed lines |
| --- | --- |
| `read-expiry.ts` | None |
| `read-episode.ts` (present on KG) | None |
| `observe-watch.ts` | None |
| `app-client.ts` | None |
| `react.tsx` | None; both mutation controls restored |
| `react-pages.ts` (present on KG) | None |
| `react-pending-writes.ts` | None |

The only code to carry through integration is the clock import at
`test/helpers/react-harness.mjs:13`, the useNow case at lines **375–472**,
and the Vite alias at `test/react.test.mjs:88`. Preserve KG's changes to
other observation/page cases and FX rounds 0–1's pending-peer extraction and
journal tests when reconciling the shared harness. No expiry/episode/facade
runtime patch must be ported, and this round does not qualify KG's full branch.

No scoped open problem or design deviation remains. No timeout was increased,
assertion weakened or unrelated flake repaired. The unavailable llp-orient
skill remains a broken checkout link, absent from the searched local skill
paths; orientation used the binding fence, governing LLPs, current reads/clock
guide text, client clock reference and earlier lane evidence directly.
