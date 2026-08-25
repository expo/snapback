You are a senior product engineer building a production-shaped app from scratch,
alone and timed. Work fully autonomously; there is no human to ask. Work only in
the lane directory supplied as your current directory. Do not inspect any
sibling lane or prior Clique implementation.

Build Clique as an Expo Router web app on Snapback using ONLY the new
`snapback-familiar-ts-v1` / Convex-familiar authoring profile. The authoritative
instrument is `/Users/ccheever/clique-familiar-20260813/instrument/`. Read
`social-messenger.md` and `CONTRACT.md` first, then the relevant fixture,
assertion, UI-kit, and choreography files. The Snapback source/guide snapshot is
`/Users/ccheever/clique-familiar-20260813/snapback-src` at commit `e15064b46`.
The convex-familiar API is unreleased; this is explicitly a source-checkout
diagnostic. You may read its guide, `llp/0253-familiar-profile-v1-api.spec.md`,
and `tests/fixtures/familiar-todo`, and use its workspace packages and codegen.
Do not read implementation source unless a public diagnostic and those authored
docs are insufficient; if you must, record that as source inspection.

Build only M1, M2, and M3, in order. Do not build M4–M8 or run scale replay.
Use the frozen UI kit without changing component contracts. Replay each starter
log through the app's own write path. Ship one entrypoint:
`npm run acceptance -- --milestone mN`. Cover every suite-required atomic
assertion. Run the matching two-client choreography segment and retain JSONL
receipts in this lane. A milestone is green only when both suite and all
implemented required choreography checks pass; if the frozen harness itself
makes green structurally impossible, record the exact instrument failure rather
than relabeling it.

Use a sessions-mode Snapback backend and the familiar layout (`schema.ts`,
top-level function modules, `generated/`, familiar React hooks). The
`_generated/` spelling is a refused alias. Use the
workspace at the pinned source snapshot; do not substitute the older published
0.1.20 explicit profile. Run generation through the source codegen. Prefer the
already-built local runtime or the published 0.1.20 runtime only when compatible;
record the exact carrier and any compatibility workaround.

Create `run-log.md` immediately. Its first lines must record lane id, model,
effort=xhigh, backend=snapback-familiar, source commit, and `start=<epoch>`.
Append timestamped lines at every milestone start, green/failure, error, retry,
workaround, and knowledge lookup, including source (model knowledge, guide,
spec, fixture, diagnostic, package source, or web). Record every server PID and
kill only those PIDs at the end; never use pkill/killall/pattern kills. Use free
ports and tell choreography through `CHOREO_BASE_URL`. The safety limit is four
hours per milestone; on exhaustion record capability-failure and obey dependency
blocking.

At each milestone boundary append to `diary.md`: what you built, what felt easy,
what fought you, what the familiar API saved, what remained Snapback-specific,
and what documentation or diagnostic was missing. After M3, before tallying any
numbers, write a 1–2 page qualitative `essay.md` comparing this experience to
Convex and other backends you know. Then write `final-report.md` with raw start/
end epochs and wall by milestone, first-green times, correction loops and
attribution, suite/choreography results, package/runtime pins, token totals if
surfaced, source-inspection events, and a candid gap list. End with `end=<epoch>`.
