# QJ round 1 — settle quote layout and make the browser oracle durable

2026-10-07 · eb1000 · `sb4-intent/qj-quote-jump` · commit only, no push.
Round-0 parent: `25a61c415ba993f2a2e438a4681348ff0bf8080f`.

## Review findings addressed

Read `~/sb4-intent/reviews/qj-r0.grok.md` (READY),
`qj-r0.astra.md` (NOT READY), and
`qj-r0.astra.evidence/REVIEW.md`, including both reproduction sources.
Astra demonstrated that a delayed nested quote left the original's own text
at 988–1,004 px below the list's 752 px bottom, and that a 2.3-second pause in
the test driver missed a successful 139.5 ms jump after its highlight expired.
The changes address both findings; this report makes no new external-review claim.

`useJumpToMessage` retains scroll ownership for at most **four seconds after
arrival**, in addition to the existing four-second search limit. Row, inner
content, viewport and list content-size events invalidate measured visibility.
A bounded retry also covers native asynchronous measurement and index recovery.
Current mounted views are measured with `measureInWindow`; `scrollToOffset`
corrects their current position. Ordinary bubbles must fit fully. If a nested
quote makes a bubble taller than the viewport, its own message text and controls
are the measurement target instead of the entire quote. Oversized own text fills
the viewport. Visibility starts the original **1.8-second highlight**; expansion
can clear and restore it within that interval, without restarting its deadline.
The settled completion ID persists after the highlight and settle period.

Native touch/drag and web pointer/wheel/scrolling keys synchronously revoke
ownership. An in-flight measurement checks that same owner before scrolling;
subsequent layout changes cannot resume correction. Expiry ends correction or
shows a clear failure if the target could not be kept visible. Current read-state
and revalidation guards still apply during settling. Current views, IDs and
positions are UI state; bodies and history cursors remain owned by `usePage`.
The composer/draft, history query/schema, receipt rules and pinned test dependency
are unchanged this round.

The browser oracle is armed **before** the click. It latches the completion ID,
actual viewport rectangle, computed highlight color and browser-local elapsed
time with MutationObserver/requestAnimationFrame. Later assertions poll the
persistent `jump-completed-<id>` native ID and current geometry. Highlight expiry
therefore cannot erase evidence while Playwright is descheduled. Hang guards are
122 seconds per wait and 300 seconds for the complete fixture; the four-second
product assertion is still measured in the browser. This is state observation,
not a widened highlight interval or a removed viewport assertion.

## Regression evidence and qualification

The installed starter runs with real `react-native-web@0.21.2`, generated
operations, HTTP and the online/wasm replica clients. The original 30-message,
visible, absent, draft identity, beyond-horizon, reply, unmeasured-index and
blocked-scroll/retry cases remain. Five online cases hold a real nested-quote
point read until after successful arrival:

- A nested quote within the original expands above its own text.
- A separate row above the original expands. A narrower viewport ensures this
  expansion actually needs a correction; CSS scroll anchoring is disabled in
  the fixture. The assertion checks geometry, not the choice of scroll method.
- Wheel, scrolling-key and native drag-callback controls revoke ownership before
  that expansion. They require the original to end outside the viewport, no
  additional scroll commands (including queued measurements), and no highlight.

The held-read cases run online because the replica may already know the quoted
row locally; an HTTP delay would not reliably delay its quote. The baseline jump
cases run on both clients. In the final affected run, expansion corrections
completed **16.4 ms** (nested) and **66.1 ms** (row above) after expansion was
observed. Both ended with the original's own content at **432–480 px** inside
**160–752 px**. Each issued an additional offset correction. These are observed
measurements on this host, not a latency guarantee for other devices.

The first 30-message case always pauses only the Node driver for **2,300 ms**
after clicking. A dedicated run also sets `QJ_DRIVER_DELAY_MS=2300`, applying
Astra's driver-delay reproduction to every asserted jump. The browser continues
running, and both latched arrival/highlight and later current geometry must pass.

| Check | Result | Evidence |
| --- | --- | --- |
| Starter, social browser, quote browser, read presentation (plain + React), matchRead, screen lifetime React | **98/98 passed**, no skips | `affected.log.gz` |
| Two additional quote-browser repetitions | **22/22 passed each** | `quote-run2.log.gz`, `quote-run3.log.gz` |
| Every asserted jump with a 2.3-second driver pause | **22/22 passed** | `quote-driver-delay.log.gz` |
| Compiled guide | **113/113 passed** | `guide.log.gz` |
| Docs budget + first-screen test | **passed** | `docs-budget.log.gz` |
| Client TypeScript | **passed** | `client-typecheck.log.gz` |
| LLP reference audit | **530 docs, 10,455 refs; zero errors/unchecked** | `ref-check.log.gz` |
| All four generated wasm artifacts | **baseline hashes unchanged** | `wasm-unchanged.txt` |

These are four complete runs of the final quote-browser fixture (one inside the
98-test batch), each with 22 passes and zero failures/skips. In the dedicated
driver-delay run, the far jump arrived and highlighted in **14.4 ms online** and
**18.1 ms with the replica**, with later current-geometry assertions passing
after the driver resumed. The highlight duration remained 1.8 seconds.

Commands ran from `snapback4/`, with `taskset -c 48-71` for bounded local CPU use.
The affected Node command named `social-starter`, `social-browser`,
`social-quote-jump-browser`, `read-presentation`, `read-presentation-react`,
`read-match` and `screen-lifetimes-react` under `packages/snapback4/test/`.
Repetitions used `node --test packages/snapback4/test/social-quote-jump-browser.test.mjs`;
the final repetition prefixed `QJ_DRIVER_DELAY_MS=2300`.
Rust build/guide/docs checks used
`LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT`,
`CARGO_PROFILE_DEV_DEBUG=0`, `CARGO_PROFILE_TEST_DEBUG=0`,
`CARGO_INCREMENTAL=0` and `CARGO_BUILD_JOBS=8`. Client validation used
`bun run --cwd packages/snapback4 typecheck`.

The full suite was **not rerun in round 1**; this round ran the requested affected
checks. The [round-0 report](../REPORT.md) retains that earlier full-suite result.
No wasm source or binding changed: device SHA-256 remains
`a4c6b4a8a7e76d81df9f424899f474863ce23cf232c0e4162861cc1333a3ec83`,
2,135,164 B raw / 645,264 B canonical GNU gzip. The unchanged cap is 645,564 B.
Final checkout disk use is **15.24 GB (14.19 GiB)**, below 30 GB.

Native portability is **typechecked, not UI-qualified**: the installed template
compiles against React Native using shared measurement/FlatList APIs, and the
browser harness invokes its actual `onScrollBeginDrag` binding to check
cancellation. There was no iOS/Android simulator, device, native gesture or native
layout execution on this Linux host. Native-process and wasm query/receipt tests
in the starter suite exercise history semantics, not native UI scrolling.

## Documentation, scope and development results

Updated the installed README, compiled `guide social`, and governing LLP
3000.028 §8. The social card renders 801 lines; it has no separate line ceiling.
The eight budgeted reference cards and their limits are unchanged. Docs budget
passes at 300/300 README lines with its executable first-screen witness.

The first development run's separate-row fixture stayed visible without another
scroll command and failed an unnecessary command-count assertion. The final
fixture checks geometry, disables browser scroll anchoring, and narrows that
case to force displacement. The first broader run counted the newly introduced
inner content view as another bubble because both test IDs used `message-`.
The new inner view now uses `jump-body-`, preserving the existing bubble-count
oracle and all its assertions. Both failed logs are retained separately; neither
is qualification evidence. No read-state, ownership, schema or engine oracle was
relaxed.

All work and processes launched by this lane stayed in this worktree on eb1000.
No other worktree or process was changed. Nothing was pushed or published.
