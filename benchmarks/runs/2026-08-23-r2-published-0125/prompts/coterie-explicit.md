You are a senior product engineer building a production-shaped app from scratch,
alone and timed. Work fully autonomously; there is no human to ask. Work only in
the lane directory supplied as your current directory. Do not inspect any
sibling lane, any Snapback or Exact repository checkout beyond what this prompt
names, or any prior Clique or Coterie implementation.

Build Coterie, the Exact/Contract sibling of the Clique social messenger, as an
Exact web application backed by Snapback using the DEFAULT EXPLICIT authoring
profile. The authoritative instrument is
/Users/ccheever/bench-matrix-20260823-r2/instrument/ (read-only). Read
social-messenger.md and CONTRACT.md first, then the relevant fixture,
assertion, and choreography files. Port the frozen presentation contract to
Contract components — no React, React Native, or Expo in the client — while
preserving the `sm-*` semantic identifiers, observable screen vocabulary, and
design tokens from CONTRACT.md so the frozen two-client choreography can drive
your app through `CHOREO_BASE_URL`. The RN UI kit in the instrument is the
visual/structural reference; do not import its components.

Framework: the Exact checkout is
/Users/ccheever/bench-matrix-20260817/exact-pinned (read-only, dependencies
already installed; it has no npm release). Consume it by symlinking its
packages into your app's node_modules after install (the proven pattern is an
`exact.links.json` naming `@exact/*` package paths inside that checkout plus a
postinstall script that creates directory symlinks; linked packages resolve
their own deps through the checkout's node_modules). Its authoring
documentation is the `@exact/guide` package and the packages' own README/type
files. Use the Exact devtools scripts from the checkout (route-registry
generation, provider binding generation, the vite CLI, the exact web server)
rather than reinventing them.

Backend boundary: Contract views import only binding functions generated from
one ProviderNativeDeclaration, configured at boot with a conforming
ContractDataProvider. All persistence, auth, live delivery, and mutation
authority live behind that seam. The REQUIRED green for every milestone is
against a real Snapback backend: published Snapback 0.1.25 from the public npm
registry, authored in the explicit profile (`snapback/` directory with explicit
`schema.mjs`/`functions.mjs` and generated exact function references; do NOT
set `authoringProfile` in codegen.policy.json). A deterministic in-memory
provider is optional scaffolding, not the deliverable. Snapback documentation
is the Guide served by the running snapback binary (`snapback guide <query>` or
`/_snapback/guide/` over HTTP); record every knowledge lookup and its source in
run-log.md, and record any implementation-source reading as source inspection.

Build only M1, M2, and M3, in order. Do not build M4–M8 or run scale replay.
Replay each starter log through the app's own write path. Ship one entrypoint:
`npm run acceptance -- --milestone mN` (bun-backed is fine). Cover every
suite-required atomic assertion in the instrument's assertions.json for M1–M3.
Run the matching two-client choreography segment from the instrument's
choreography harness and retain its JSONL receipts in this lane. A milestone is
green only when both the suite and all implemented required choreography checks
pass; if the frozen harness itself makes green structurally impossible, record
the exact instrument failure rather than relabeling it.

Create run-log.md immediately. Its first lines must record lane id {{LANE_ID}},
model {{MODEL}}, effort=xhigh, backend=snapback-explicit-0.1.25,
client=exact-contract, and start=<epoch>. Append timestamped lines at every
milestone start, green or failure, error, retry, workaround, correction loop
(each with an attribution: snapback-defect, exact-defect, agent-error,
environment, or ambiguous, plus an evidence pointer), and knowledge lookup.
Record every server PID you start and kill only those PIDs at the end; never
use pkill/killall/pattern kills. Use only ports {{PORT_BASE}}–{{PORT_MAX}} for
every server you start. The safety limit is four hours per milestone; on
exhaustion record capability-failure and obey dependency blocking.

At each milestone boundary append to diary.md: what you built, what felt easy,
what fought you, keeping Exact/Contract observations separate from Snapback
observations, and what documentation or diagnostic was missing. After M3,
before tallying any numbers, write a 1–2 page qualitative essay.md comparing
this experience to React-family stacks and backends you know. Then write
final-report.md with raw start/end epochs and wall by milestone, first-green
times, correction loops and attribution, suite/choreography results,
package/runtime pins, source-inspection events, and a candid gap list. End with
end=<epoch>.
