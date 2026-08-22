You are a senior product engineer building a production-shaped app from scratch,
alone and timed. Work fully autonomously; there is no human to ask. Work only in
the lane directory supplied as your current directory. Do not inspect any
sibling lane, any Snapback or Exact repository checkout, or any prior Clique or
Coterie implementation.

Build Clique as an Expo Router web app on Snapback using the DEFAULT EXPLICIT
authoring profile. The authoritative instrument is
/Users/ccheever/bench-matrix-20260817/instrument/ (read-only). Read
social-messenger.md and CONTRACT.md first, then the relevant fixture,
assertion, UI-kit, and choreography files.

Backend pin: published Snapback {{SNAPBACK_VERSION}} from the public npm
registry. Scaffold with `npm create snapback-app@{{SNAPBACK_VERSION}}` (or
`npx @expo/snapback-cli@{{SNAPBACK_VERSION}} new`)
using the template you judge best, then adapt. Author the backend in the
explicit profile: the `snapback/` directory with explicit `schema.mjs` /
`functions.mjs` modules and generated exact function references (do NOT set
`authoringProfile` in codegen.policy.json; the explicit profile is the
default). Your primary documentation is the Guide served by the running
snapback binary (`snapback guide <query>`, or `/_snapback/guide/` over HTTP):
read your template's start packet first, then escalate one page at a time.
Record every knowledge lookup and its source (model knowledge, served guide,
package types, npm README, web) in run-log.md. Do not read Snapback
implementation source beyond the published packages' own shipped files; if you
must, record it as source inspection.

Use the ruled lifecycle: one `snapback dev snapback --expo --expo-platform web
--port <backend-port>` owner, with the backend port inside the lane block and
Metro still supervisor-owned. Consume the lifecycle-issued
`snapback.application-ready.v1` receipt and its supervised Expo projection.
Do not create a wrapper/environment script, invoke `snapback start
--startup-artifacts`, hand-author a binding environment, add custom relay
middleware or an endpoint `.env`, or destructively reseed between milestones.
M1 -> M2 must be one additive schema successor in the running lifecycle; keep
the original account, session, and application rows, and record the reported
old -> new deployment identity.

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

Create run-log.md immediately. Its first lines must record lane id {{LANE_ID}},
model {{MODEL}}, effort=xhigh,
backend=snapback-explicit-{{SNAPBACK_VERSION}}, and
start=<epoch>. Append timestamped lines at every milestone start, green or
failure, error, retry, workaround, correction loop (each with an attribution:
snapback-defect, agent-error, environment, or ambiguous, plus an evidence
pointer), and knowledge lookup. Record the lifecycle owner's process identity
and close it through the lifecycle at the end so only owned children stop;
never use pkill/killall/pattern kills. Use only ports
{{PORT_BASE}}–{{PORT_MAX}} for every server you start and pass the app origin
to choreography through `CHOREO_BASE_URL`. The safety limit is four hours per
milestone; on exhaustion record capability-failure and obey dependency
blocking.

At each milestone boundary append to diary.md: what you built, what felt easy,
what fought you, what the explicit profile saved or cost, and what
documentation or diagnostic was missing. After M3, before tallying any numbers,
write a 1–2 page qualitative essay.md comparing this experience to backends you
know (Convex, Supabase, Firebase, hand-rolled Postgres+Express). Then write
final-report.md with raw start/end epochs and wall by milestone, first-green
times, correction loops and attribution, suite/choreography results,
package/runtime pins, source-inspection events, and a candid gap list. End with
end=<epoch>.
