# Prompt deltas from the R2 frozen Clique prompts

Sources:

- `benchmarks/runs/2026-08-23-r2-published-0125/prompts/clique-explicit.md`
- `benchmarks/runs/2026-08-23-r2-published-0125/prompts/clique-familiar.md`

Targets:

- `clique-explicit.md`
- `clique-familiar.md`

Only the charter's three delta classes are present. Text not listed below is
byte-for-byte unchanged from the corresponding R2 prompt. In particular,
`effort=xhigh` remains in the frozen prompt text even though the launch config
authoritatively runs `high`; changing that text would be a fourth delta.

## Delta 1 — published spelling 0.1.25 → 0.1.27

### Explicit prompt

1. Old → new:

   `Backend pin: published Snapback 0.1.25 from the public npm registry.`
   →
   `Backend pin: published Snapback 0.1.27 from the public npm registry.`

2. Old → new:

   ``npm create snapback-app@0.1.25``
   →
   ``npm create snapback-app@0.1.27``

3. Old → new:

   ``npx @expo/snapback-cli@0.1.25 new``
   →
   ``npx @expo/snapback-cli@0.1.27 new``

4. Old → new:

   `backend=snapback-explicit-0.1.25`
   →
   `backend=snapback-explicit-0.1.27`

### Familiar prompt

1. Old → new:

   `Backend pin: published Snapback 0.1.25 from the public npm registry.`
   →
   `Backend pin: published Snapback 0.1.27 from the public npm registry.`

2. Old → new:

   `backend=snapback-familiar-0.1.25`
   →
   `backend=snapback-familiar-0.1.27`

## Delta 2 — M1–M3 calibration limit → full LLP 0201 D1 journey

The reduced-run limit occurred in the build/proof paragraph, the port paragraph,
and the closing-diary/report paragraph. Every affected passage is below.

### Both prompts — build/proof passage

Old:

> Build only M1, M2, and M3, in order. Do not build M4–M8 or run scale replay.
> Use the frozen UI kit without changing component contracts. Replay each starter
> log through the app's own write path. Ship one entrypoint:
> `npm run acceptance -- --milestone mN`. Cover every suite-required atomic
> assertion in the instrument's assertions.json for M1–M3. Run the matching
> two-client choreography segment from the instrument's choreography harness and
> retain its JSONL receipts in this lane. A milestone is green only when both the
> suite and all implemented required choreography checks pass; if the frozen
> harness itself makes green structurally impossible, record the exact instrument
> failure rather than relabeling it.

New:

> Build M1 through M6 in dependency order, then M8, in one continuous session.
> Do not build M7 in that session: after M8 and the separately clocked scale
> replay, M7 runs in a fresh session against a fresh backend instance seeded with
> the starter log, not the scale database. Execution order is M1, M2, M3, M4, M5,
> M6, M8, then fresh-session M7. Respect the milestone status vocabulary and
> dependency/termination rules in the brief. Use the frozen UI kit without
> changing component contracts. Replay each committed starter-log segment through
> the app's own write path. Ship one entrypoint:
> `npm run acceptance -- --milestone mN`. Cover every suite-required atomic
> assertion in the instrument's assertions.json for M1–M8 and ship the coverage
> manifest mapping each assertion to a test. Run the matching two-client
> choreography segment from the instrument's choreography harness and retain its
> JSONL receipts in this lane. A milestone is green only when both the suite and
> all implemented required choreography checks pass; if the frozen harness itself
> makes green structurally impossible, record the exact instrument failure rather
> than relabeling it. M6/M8 native-artifact assertions are separately recorded
> evidence and do not gate web authoring green; record Linux's lack of an iOS
> Simulator as the instrument's simulator contract directs, and record the
> outcome honestly.
>
> M6 additionally requires the push-seam payload and log, the documented
> custom-client API and green headless demo, and a scale-replay adapter passing the
> fixture pack's sample-50.log conformance check. After the continuous session,
> run the full derived scale log on its separately recorded clock against a fresh
> backend seeded with the starter log, following the brief's replay contract and
> retaining settlement/checkpoint/reconciliation evidence. Generate the derived
> log in writable lane space from the read-only instrument fixture pack and verify
> it against scale-log.sha256. Do not fabricate completion; record the exact
> settled prefix and failure if replay does not complete.
>
> Before the continuous session ends, export the pre-M7 starter-state snapshot
> through the M6 custom-client API over the pinned field manifest, using each
> persona's token, and assemble a self-contained M7 handoff with the current app
> and backend source, package lock, schema/functions, fixture personas, coverage
> manifest, prior acceptance/choreography receipts, and exact run instructions.
> The fresh M7 session must add group polls with live, changeable, idempotent and
> offline-queued votes plus the backfilled/maintained conversation message count;
> it must prove snapshot intactness, prior-green regression status, and the
> instrument's standalone M7 choreography segment.

### Explicit prompt — port passage

Old:

> Use only ports {{PORT_BASE}}–{{PORT_MAX}} for every server you start and pass
> the app origin to choreography through `CHOREO_BASE_URL`.

New:

> Use only ports {{PORT_BASE}}–{{PORT_MAX}} during the continuous session and
> scale replay, and only 48600–48659 during fresh-session M7; pass the app origin
> to choreography through `CHOREO_BASE_URL`.

### Familiar prompt — port passage

Old:

> Use only ports {{PORT_BASE}}–{{PORT_MAX}} for every server you start and pass
> the app origin to choreography through `CHOREO_BASE_URL`.

New:

> Use only ports {{PORT_BASE}}–{{PORT_MAX}} during the continuous session and
> scale replay, and only 48660–48719 during fresh-session M7; pass the app origin
> to choreography through `CHOREO_BASE_URL`.

### Explicit prompt — closing diary/report passage

Old:

> At each milestone boundary append to diary.md: what you built, what felt easy,
> what fought you, what the explicit profile saved or cost, and what
> documentation or diagnostic was missing. After M3, before tallying any numbers,
> write a 1–2 page qualitative essay.md comparing this experience to backends you
> know (Convex, Supabase, Firebase, hand-rolled Postgres+Express). Then write
> final-report.md with raw start/end epochs and wall by milestone, first-green
> times, correction loops and attribution, suite/choreography results,
> package/runtime pins, source-inspection events, and a candid gap list. End with
> end=<epoch>.

New:

> At each milestone boundary append to diary.md: what you built, what felt easy,
> what fought you, what the explicit profile saved or cost, and what
> documentation or diagnostic was missing. After M8 or continuous-session
> termination, before tallying any numbers, write a 1–2 page qualitative essay.md
> comparing this experience to backends you know (Convex, Supabase, Firebase,
> hand-rolled Postgres+Express). Then write final-report.md with raw start/end
> epochs and wall by milestone, first-green times, correction loops and
> attribution, suite/choreography results, scale disposition, package/runtime
> pins, source-inspection events, and a candid gap list. In the fresh M7 session,
> write its own dated diary entry and qualitative essay before tallying numbers,
> then record M7 wall/first-green, migration intactness, suite/choreography,
> correction loops, B8, and its holistic score in the M7 final report. End each
> session report with end=<epoch>.

### Familiar prompt — closing diary/report passage

Old:

> At each milestone boundary append to diary.md: what you built, what felt easy,
> what fought you, what the familiar profile saved and what remained
> Snapback-specific, and what documentation or diagnostic was missing. After M3,
> before tallying any numbers, write a 1–2 page qualitative essay.md comparing
> this experience to Convex and other backends you know. Then write
> final-report.md with raw start/end epochs and wall by milestone, first-green
> times, correction loops and attribution, suite/choreography results,
> package/runtime pins, source-inspection events, and a candid gap list. End with
> end=<epoch>.

New:

> At each milestone boundary append to diary.md: what you built, what felt easy,
> what fought you, what the familiar profile saved and what remained
> Snapback-specific, and what documentation or diagnostic was missing. After M8
> or continuous-session termination, before tallying any numbers, write a 1–2
> page qualitative essay.md comparing this experience to Convex and other
> backends you know. Then write final-report.md with raw start/end epochs and wall
> by milestone, first-green times, correction loops and attribution,
> suite/choreography results, scale disposition, package/runtime pins,
> source-inspection events, and a candid gap list. In the fresh M7 session, write
> its own dated diary entry and qualitative essay before tallying numbers, then
> record M7 wall/first-green, migration intactness, suite/choreography, correction
> loops, B8, and its holistic score in the M7 final report. End each session
> report with end=<epoch>.

## Delta 3 — instrument root → immutable capstone path

### Explicit prompt

Old → new:

`/Users/ccheever/bench-matrix-20260823-r2/instrument-resume-20260824/`
→
`/home/ccheever/capstone-0127-20260825/instrument`

### Familiar prompt

Old → new:

`/Users/ccheever/bench-matrix-20260823-r2/instrument-resume-20260824/`
→
`/home/ccheever/capstone-0127-20260825/instrument`
