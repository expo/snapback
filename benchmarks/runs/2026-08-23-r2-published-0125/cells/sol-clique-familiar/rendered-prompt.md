You are a senior product engineer building a production-shaped app from scratch,
alone and timed. Work fully autonomously; there is no human to ask. Work only in
the lane directory supplied as your current directory. Do not inspect any
sibling lane, any Snapback or Exact repository checkout, or any prior Clique or
Coterie implementation.

Build Clique as an Expo Router web app on Snapback using ONLY the FAMILIAR
TypeScript authoring profile (`snapback-familiar-ts-v1`). The authoritative
instrument is /Users/ccheever/bench-matrix-20260823-r2/instrument/ (read-only).
Read social-messenger.md and CONTRACT.md first, then the relevant fixture,
assertion, UI-kit, and choreography files.

Backend pin: published Snapback 0.1.25 from the public npm registry. Use a
sessions-mode Snapback backend with the familiar layout: `schema.ts`, top-level
function modules with `query`/`mutation`/`action` constructors, `_generated/`
produced by the published codegen, and the familiar React hooks. Opt in
explicitly by setting `"authoringProfile": "snapback-familiar-ts-v1"` in
`snapback/codegen.policy.json`. Do not fall back to the explicit
`schema.mjs`/`functions.mjs` profile. Your primary documentation is the Guide
served by the running snapback binary (`snapback guide <query>`, or
`/_snapback/guide/` over HTTP): read the "Familiar TypeScript profile" page and
your template's start packet first, then escalate one page at a time. Record
every knowledge lookup and its source (model knowledge, served guide, package
types, npm README, web) in run-log.md. Do not read Snapback implementation
source beyond the published packages' own shipped files; if you must, record it
as source inspection.

Build only M1, M2, and M3, in order. Do not build M4–M8 or run scale replay.
Use the frozen UI kit without changing component contracts. Replay each starter
log through the app's own write path. Ship one entrypoint:
`npm run acceptance -- --milestone mN`. Cover every suite-required atomic
assertion in the instrument's assertions.json for M1–M3. Run the matching
two-client choreography segment from the instrument's choreography harness and
retain its JSONL receipts in this lane. A milestone is green only when both the
suite and all implemented required choreography checks pass; if the frozen
harness itself makes green structurally impossible, record the exact instrument
failure rather than relabeling it.

Create run-log.md immediately. Its first lines must record lane id sol-clique-familiar,
model gpt-5.6-sol, effort=xhigh, backend=snapback-familiar-0.1.25, and
start=<epoch>. Append timestamped lines at every milestone start, green or
failure, error, retry, workaround, correction loop (each with an attribution:
snapback-defect, agent-error, environment, or ambiguous, plus an evidence
pointer), and knowledge lookup. Record every server PID you start and kill only
those PIDs at the end; never use pkill/killall/pattern kills. Use only ports
42020–42039 for every server you start and pass the app origin
to choreography through `CHOREO_BASE_URL`. The safety limit is four hours per
milestone; on exhaustion record capability-failure and obey dependency
blocking.

At each milestone boundary append to diary.md: what you built, what felt easy,
what fought you, what the familiar profile saved and what remained
Snapback-specific, and what documentation or diagnostic was missing. After M3,
before tallying any numbers, write a 1–2 page qualitative essay.md comparing
this experience to Convex and other backends you know. Then write
final-report.md with raw start/end epochs and wall by milestone, first-green
times, correction loops and attribution, suite/choreography results,
package/runtime pins, source-inspection events, and a candid gap list. End with
end=<epoch>.

## Observation-controller handoff (instrument 0.3.3-m8)

The external lane controller owns the authoring clock and is already running.
For each milestone, run the suite and choreography with their required typed
observation outputs, then make this your final command for that milestone:

  node "/Users/ccheever/bench-matrix-20260823-r2/runner/benchmarks/tools/social-messenger/metering/r2-cell-signal.mjs" --root "/Users/ccheever/bench-matrix-20260823-r2/cells/sol-clique-familiar" --milestone M1 \
    --status green --terminal-reason green \
    --suite-status suite-status.json \
    --suite-observations receipts/m1-suite.observations.jsonl \
    --choreography-receipt receipts/m1-choreography.jsonl \
    --choreography-observations receipts/m1-choreography.jsonl.observations.jsonl

Replace M1/m1 for M2 and M3. The signal validates paths and blocks until the
controller opens the next milestone, preserving one continuous native harness
session while preventing observation windows from overlapping. For a terminal
failure, use status aborted/terminal-reason abort, or capability-failure with
terminal-reason wall-cap or token-cap, and retain every sidecar that exists.
Never hand-author aggregate metering or record fields; the controller derives
them from the native stream, typed observations, receipts, and these terminal
signals. Finish diary.md, essay.md, and final-report.md before sending M3;
the M3 signal is the last authoring action before the native harness exits.
