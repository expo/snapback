# QJ round 3 — editable keys and complete highlight observations

2026-10-07 · eb1000 · `sb4-intent/qj-quote-jump` · commit only, no push.

The seven composer navigation keys preserve the active jump, and delayed nested
quote expansion still brings the original's own text back into view. Browser
timing now checks both distant and visible targets and observes all highlight
intervals through the actual end of settling. The real implementation passes
with a 2.3-second driver delay and 6× CPU throttling; all eight disposable
negative controls fail on their intended assertions.

Read both round-2 reviews and Astra's detailed evidence, keyboard matrix and
distant-only short-highlight mutation. This report records implementation and
test results, not a new independent review verdict.

## Merge and ownership

Fetched `origin/main` at `b14888f7632bf5fe60b61a640dd23e732797974e` and merged it
without rebasing. Merge commit **`2f340e13c15985da3941682190ace0f498c02d69`** has
parents `0898d499dff1680d500d2b2e0f6f74caa0a75878` and that main commit, with the
requested co-author trailer. `merge-proof.json` verifies that every line of
both parents' JOURNALs remains in order in the merged journal.

Resolved the screen-lifetime helper by retaining QJ's `QuotedMessage` and
`useJumpToMessage` fixture copies and removing OA's deleted `useOnlineArm`.
The merged Conversation uses `useOnline()` and passes that owned arm to
`useTyping`, alongside QJ's history/reply UI. The README retains both recipes.
The real-layout witness now uses `createApp`/`AppProvider` in both tiers; it also
requires an actual `setTyping` dispatch while editing the draft before jumping.
OA's 32 owned-arm tests, existing social typing scenarios and screen-lifetime
tests pass together with the quote cases.

## Changes and regression evidence

The web document capture listener excludes textarea, input, select,
contenteditable (including descendants), and editable ARIA roles: textbox,
searchbox, combobox, spinbutton and slider. It still observes body-targeted
scrolling keys and does not prevent default editing. Native drag/touch handling
is unchanged. No jump, settle or highlight timing constant changed.

Seven trusted Chromium keyboard cases exercise PageUp, PageDown, ArrowUp,
ArrowDown, Space, Home and End in the real multiline composer. Each verifies
that the highlight and scroll owner survive, the list does not move from the
key, and the draft only changes when Space is entered. Releasing a held nested
quote then expands the target beyond 600 pixels; its own text must be inside the
list viewport. Eight additional cases cover the other editable elements/roles,
including inherited editable descendants. Removing the guard makes all fifteen
cases fail with `editing must not cancel`. Existing body/list-key, wheel and
drag cancellation cases still pass.

The hook exposes its existing request lifetime as `settling`; the target body
has a portable `nativeID` of `jump-settling-<id>` or `jump-settled-<id>`. The test
records actual highlight color transitions using in-page `performance.now()`
until the highlight is off **and the owner has finished settling**. A five-second
observation guard records an incomplete/endless result as failure. It no longer
publishes an immutable sample at 2.5 seconds while settling is still active.
Both the 30-intervening-message and already-visible cases require actual on-time
of **1,700–2,300 ms**, a first-on/final-off span of at most **2,300 ms**, and settled,
unhighlighted completion. Initial layout invalidations count as off intervals.
Arrival/completion must each occur within **2,000 ms**; blocked-scroll failure
remains bounded to **3,900–4,500 ms**. All elapsed assertions use browser time.

Driver waits remain state-based and generous (`hangBudget()` = 122 seconds;
the expanded whole fixture has a 420-second hang guard). Timing cases honor the
2.3-second driver delay. Editable-key cases deliberately interact during the
active jump, then release layout; they do not insert that pause before editing.

`run-controls.py` mutates only generated disposable apps and checks unchanged
assertions, with a 2.3-second driver delay in every control invocation:

| Mutation | Required rejection, observed in this round |
| --- | --- |
| `timeout-8s` | Four-second failure deadline exceeded |
| `highlight-100ms` | Actual highlight too short |
| `astra-both` | Both deadline and duration assertions fail |
| `arrival-8s` | Actual viewport arrival exceeds two seconds |
| `list-only-keys` | Body-key cancellation allows an unwanted correction |
| `short-far-highlight` | Distant-only highlight: **105.7 / 184.5 ms** online/replica; visible cases still pass |
| `late-highlight` | Restart after 2.8 seconds: online on-time **2,943 ms**, span **3,998.9 ms**; both tiers reject |
| `editable-keys-cancel` | All seven composer keys and eight other editable targets wrongly cancel |

Every control exits 1 for the expected assertion; `negative-results.json` and
the full `negative-*.log.gz` retain the results. These intentional reds prove
the oracle and are separate from the passing real-implementation qualification.

## Qualification

| Check | Result | Evidence |
| --- | --- | --- |
| Social starter/browser/quote, OA owned arm, plain/React read presentation, matchRead, React screen lifetimes | **146/146**, zero skips/failures | `affected.log.gz` |
| Additional ordinary quote run | **38/38** | `quote-run2.log.gz` |
| Quote run with 2.3-second driver delay | **38/38** | `quote-driver-delay.log.gz` |
| Same delay plus 6× Chromium CPU throttle | **38/38** | `quote-cpu6.log.gz` |
| Compiled guide | **113/113** | `guide.log.gz` |
| Client build and typecheck; workspace build | passed | `client-build.log.gz`, `client-typecheck.log.gz`, `build-final.log.gz` |
| Docs budgets and first-screen executable test | passed; README **300/300** | `docs-budget.log.gz` |
| Generated mutation controls | **8/8 rejected as intended** | `negative-results.json` |
| Wasm rebuild and four generated artifacts | byte-identical to round-0 baseline | `wasm-build.log.gz`, `wasm-unchanged.txt` |
| Reference audit | one inherited unrelated error; no unchecked references | `ref-check.log.gz`, `ref-check-baseline.json` |

There are four final positive quote runs, counting the affected batch. The early
38/38 `quote-initial.log.gz` predates the final settle-marker refresh and editable
fixture stabilization, so it is retained as development evidence only. Under
6× CPU throttle plus driver delay, the distant target completed in **102.3 ms
online / 101.1 ms replica**, with **1,879.0 / 1,867.4 ms** of actual highlight;
the observer remained active for **4,078.3 / 4,066.7 ms**. Both targets were at
192–256 pixels inside the 192–752-pixel viewport. These are fixture observations,
not promises for every device or network.

The reference audit reports 531 LLP documents / 10,512 references and one broken
anchor in `snapback4-difftest/src/lib.rs:3` targeting LLP 3000.035 §5.1. The checker,
referring source and target document are all byte-identical to fetched main;
`ref-check-baseline.json` records their hashes. No QJ reference failed. This
unrelated inherited documentation issue remains unchanged.

Commands ran from `snapback4/`, with `taskset -c 48-71`. Rust build/guide/docs/wasm
commands used `LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT`, disabled
dev/test debuginfo and incremental compilation, and eight Cargo build jobs.
The affected Node invocation selected these unchanged file entry points:

```sh
node --test packages/snapback4/test/{social-starter,social-browser,social-quote-jump-browser,app-online-arm,read-presentation,read-presentation-react,read-match,screen-lifetimes-react}.test.mjs
QJ_DRIVER_DELAY_MS=2300 QJ_CPU_RATE=6 node --test packages/snapback4/test/social-quote-jump-browser.test.mjs
python3 reports/20261007-qj-quote-jump/round3/run-controls.py
bun run --cwd packages/snapback4 typecheck
```

Updated guide social, the installed README and LLP 3000.028 §8. The social guide
renders 828 lines, with no separate ceiling; the eight reference-card budgets
remain unchanged. The full suite was not rerun in this review round; the root
report preserves the round-0 full-suite qualification separately.

The shared React Native APIs and native query paths typecheck/test, but **native
UI scrolling, layout and gestures remain unverified** on this Linux host. The
synthetic `onScrollBeginDrag` case checks cancellation logic, not native input.
Wasm stays **2,135,164 B raw / 645,264 B canonical gzip**, under the unchanged
645,564 B cap; device SHA-256 is
`a4c6b4a8a7e76d81df9f424899f474863ce23cf232c0e4162861cc1333a3ec83`.
All work stayed in this eb1000 worktree, using **15.31 GB** before log compression,
below 30 GB. No other worktree/process was changed. Nothing was pushed or published.
