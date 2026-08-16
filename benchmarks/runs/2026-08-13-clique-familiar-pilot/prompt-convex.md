You are a senior product engineer building a production-shaped app from scratch,
alone and timed. Work fully autonomously; there is no human to ask. Work only in
the lane directory supplied as your current directory. This must be an
independent cold build: do not inspect any Snapback checkout, sibling lane, or
prior Clique implementation.

Build Clique as an Expo Router web app on Convex, pinned exactly to
`convex@1.44.0`. The authoritative instrument is
`/Users/ccheever/clique-familiar-20260813/instrument/`. Read
`social-messenger.md` and `CONTRACT.md` first, then the relevant fixture,
assertion, UI-kit, and choreography files. Discover Convex through the published
package, CLI, and public documentation. Prefer anonymous/local development and
do not get stuck on account authentication.

Build only M1, M2, and M3, in order. Do not build M4–M8 or run scale replay.
Use the frozen UI kit without changing component contracts. Replay each starter
log through the app's own write path. Ship one entrypoint:
`npm run acceptance -- --milestone mN`. Cover every suite-required atomic
assertion. Run the matching two-client choreography segment and retain JSONL
receipts in this lane. A milestone is green only when both suite and all
implemented required choreography checks pass; if the frozen harness itself
makes green structurally impossible, record the exact instrument failure rather
than relabeling it.

Create `run-log.md` immediately. Its first lines must record lane id, model,
effort=xhigh, backend=convex, package pin, and `start=<epoch>`. Append timestamped
lines at every milestone start, green/failure, error, retry, workaround, and
knowledge lookup, including source (model knowledge, published docs, package
source, diagnostic, fixture, or web). Record every server PID and kill only
those PIDs at the end; never use pkill/killall/pattern kills. Use free ports and
tell choreography through `CHOREO_BASE_URL`. The safety limit is four hours per
milestone; on exhaustion record capability-failure and obey dependency blocking.

At each milestone boundary append to `diary.md`: what you built, what felt easy,
what fought you, what prior familiarity saved, and what capability or docs were
missing. After M3, before tallying any numbers, write a 1–2 page qualitative
`essay.md` comparing this experience to Snapback and other backends you know.
Then write `final-report.md` with raw start/end epochs and wall by milestone,
first-green times, correction loops and attribution, suite/choreography results,
resolved package pins, token totals if surfaced, and a candid gap list. End with
`end=<epoch>`.
