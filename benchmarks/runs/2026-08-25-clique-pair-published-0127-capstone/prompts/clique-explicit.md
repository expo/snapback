You are a senior product engineer building a production-shaped app from scratch,
alone and timed. Work fully autonomously; there is no human to ask. Work only in
the lane directory supplied as your current directory. Do not inspect any
sibling lane, any Snapback or Exact repository checkout, or any prior Clique or
Coterie implementation.

Build Clique as an Expo Router web app on Snapback using the DEFAULT EXPLICIT
authoring profile. The authoritative instrument is
/home/ccheever/capstone-0127-20260825/instrument (read-only). Read
social-messenger.md and CONTRACT.md first, then the relevant fixture,
assertion, UI-kit, and choreography files.

Backend pin: published Snapback 0.1.27 from the public npm registry. Scaffold
with `npm create snapback-app@0.1.27` (or `npx @expo/snapback-cli@0.1.27 new`)
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

Build M1 through M6 in dependency order, then M8, in one continuous session.
Do not build M7 in that session: after M8 and the separately clocked scale
replay, M7 runs in a fresh session against a fresh backend instance seeded with
the starter log, not the scale database. Execution order is M1, M2, M3, M4, M5,
M6, M8, then fresh-session M7. Respect the milestone status vocabulary and
dependency/termination rules in the brief. Use the frozen UI kit without
changing component contracts. Replay each committed starter-log segment through
the app's own write path. Ship one entrypoint:
`npm run acceptance -- --milestone mN`. Cover every suite-required atomic
assertion in the instrument's assertions.json for M1–M8 and ship the coverage
manifest mapping each assertion to a test. Run the matching two-client
choreography segment from the instrument's choreography harness and retain its
JSONL receipts in this lane. A milestone is green only when both the suite and
all implemented required choreography checks pass; if the frozen harness itself
makes green structurally impossible, record the exact instrument failure rather
than relabeling it. M6/M8 native-artifact assertions are separately recorded
evidence and do not gate web authoring green; record Linux's lack of an iOS
Simulator as the instrument's simulator contract directs, and record the
outcome honestly.

M6 additionally requires the push-seam payload and log, the documented
custom-client API and green headless demo, and a scale-replay adapter passing the
fixture pack's sample-50.log conformance check. After the continuous session,
run the full derived scale log on its separately recorded clock against a fresh
backend seeded with the starter log, following the brief's replay contract and
retaining settlement/checkpoint/reconciliation evidence. Generate the derived
log in writable lane space from the read-only instrument fixture pack and verify
it against scale-log.sha256. Do not fabricate completion; record the exact
settled prefix and failure if replay does not complete.

Before the continuous session ends, export the pre-M7 starter-state snapshot
through the M6 custom-client API over the pinned field manifest, using each
persona's token, and assemble a self-contained M7 handoff with the current app
and backend source, package lock, schema/functions, fixture personas, coverage
manifest, prior acceptance/choreography receipts, and exact run instructions.
The fresh M7 session must add group polls with live, changeable, idempotent and
offline-queued votes plus the backfilled/maintained conversation message count;
it must prove snapshot intactness, prior-green regression status, and the
instrument's standalone M7 choreography segment.

Create run-log.md immediately. Its first lines must record lane id {{LANE_ID}},
model {{MODEL}}, effort=xhigh, backend=snapback-explicit-0.1.27, and
start=<epoch>. Append timestamped lines at every milestone start, green or
failure, error, retry, workaround, correction loop (each with an attribution:
snapback-defect, agent-error, environment, or ambiguous, plus an evidence
pointer), and knowledge lookup. Record every server PID you start and kill only
those PIDs at the end; never use pkill/killall/pattern kills. Use only ports
{{PORT_BASE}}–{{PORT_MAX}} during the continuous session and scale replay, and
only 48600–48659 during fresh-session M7; pass the app origin to choreography
through `CHOREO_BASE_URL`. The safety limit is four hours per milestone; on
exhaustion record capability-failure and obey dependency blocking.

At each milestone boundary append to diary.md: what you built, what felt easy,
what fought you, what the explicit profile saved or cost, and what
documentation or diagnostic was missing. After M8 or continuous-session
termination, before tallying any numbers, write a 1–2 page qualitative essay.md
comparing this experience to backends you know (Convex, Supabase, Firebase,
hand-rolled Postgres+Express). Then write final-report.md with raw start/end
epochs and wall by milestone, first-green times, correction loops and
attribution, suite/choreography results, scale disposition, package/runtime
pins, source-inspection events, and a candid gap list. In the fresh M7 session,
write its own dated diary entry and qualitative essay before tallying numbers,
then record M7 wall/first-green, migration intactness, suite/choreography,
correction loops, B8, and its holistic score in the M7 final report. End each
session report with end=<epoch>.
