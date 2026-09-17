# Workroom diagnostic qualification/pilot — Snapback 4

You are a fresh application builder, not the Snapback implementation lead.
Build the web application in the supplied public Workroom brief, W1 through
W7, using the published `snapback4@0.2.26` package. This is a diagnostic
calibration pilot, not a scored/baseline cell. W8 belongs to a later fresh
session: do not implement its guest-role change now.

Your working directory is the empty `app/` beside the supplied `packet/`.
Read `../packet/brief.md`, `../packet/benchmarks/fixtures/team-workspace/README.md`
and `CONTRACT.md` there. The packet includes the immutable neutral tools,
personas, media, UI kit, shortened windows and generated fixture profiles;
its manifest records their identities. Do not alter them. Use the supplied
React UI kit for presentation, wiring actual backend queries and writes.

Use npm-published packages, their README/type declarations and the installed
CLI's served guide only. Install the exact Snapback pin, retain the lockfile,
and use `snapback4 init --online` as the package documents. Use Node 24.13.1
from PATH. No source checkouts, repository browsing, source-built binaries,
unpublished tarballs, other benchmark applications or previous run records.
Do not inspect any Snapback repository elsewhere on this machine or online.
No SQL reads or writes for application behavior: use the published Quarry,
client and server-runtime surfaces. Normal dependencies are allowed; document
any extra application infrastructure and why you needed it. Do not modify
installed dependencies to change the product under test.

Run only on this assigned machine. No remote commands, clones, subagents or
delegation. Do not touch unrelated processes or data. Use loopback listeners
and available ports; inspect listeners before choosing ports. Reserved ports:
3283, 5000, 5037, 7000, 17500, 17600, 17603, 49254, 63554, 63572, 63726,
63740. Also avoid any additional listener you find. Start backend, app and
fixture processes yourself, record their PIDs, and stop only those. Never
kill by name/pattern. Stop if free disk drops below 2 GiB. Do not run unrelated
build/test suites or download large platform stacks.

Follow the fixture contract literally. Register its real accounts with normal
authentication; replay through ordinary authorized application operations.
No seed/import shortcut, fabricated sessions, fixture-only application admin
route, direct audit insertion, invented test content or passing mock. Provider
admin credentials belong only to the adapter/driver, never the application
server. The server receives only the fixture service token, signing secret
and URL. Local fixture-only secrets are generated privately and never copied
to public report files. The test provider is not a commercial-provider claim.

Provide `npm run acceptance` and a documented `adapter.mjs` implementing the
unchanged fixture adapter contract. Acceptance must exercise the real backend
and report every named assertion as pass/fail/not-run, with timestamps and
evidence paths. Keep original action logs and authoritative receipt journals.
Use canonical conformance then starter journeys, including the real 200-event
backlog. Replay order is authoritative. Stop/resume at milestone boundaries
without editing/filtering away earlier canonical actions. A repeated completed
receipt journal skips writes; additionally prove lost-response recovery after
a real commit before receipt persistence, and compare actual membership,
audit, email and billing state. Never infer those outcomes from receipt shape.

W3 and W5 are especially important: actual email and acceptance tokens;
wrong-account/reuse/expiry/revocation refusals; atomic membership/audit;
invalid signatures with intermediate unchanged state; duplicate and old-event
handling; receiver/provider restart, durable backlog, 503 and lost-response
recovery; seat reservations and acceptance limits; past-due write restrictions.
Do not call either milestone green when only its route plumbing passes.

For W6/W7 use the full canonical scale profile through the same adapter.
The generator/verifier are supplied; generate full once and verify if a full
artifact is not supplied. Compare every expected per-member report row, not
only aggregate totals. Record how long replay takes and all failures. No
claimed green for a tiny/conformance substitute for the scale requirement.

Before performance sampling, write `probe-plan.md` defining each of the five
brief probes' exact start/end events, cold/warm setup, sample count and
concurrency. Use serial trials, preserve individual observations and validate
returned state. Record numbers descriptively; you must not invent budgets or
ceilings, tune a threshold to pass, or score unavailable observations. A probe
that cannot execute is unavailable with its concrete cause.

At each milestone boundary append `diary.md` with elapsed time, actual
acceptance outcomes and evidence paths, architecture choices, workarounds,
infrastructure invented, and correction loops with attribution and evidence.
Use `milestones.ndjson` for timestamped boundary records (W1–W7,
pass/fail/not-run and proof path). Preserve raw logs privately. Keep fixture
receipts, credentials, stores and large generated logs out of source commits.

When W1–W7 are complete or genuinely blocked, write `FINAL.md`: exact pin,
commands, process PIDs/status, actual milestone outcomes, W3/W5 evidence,
scale/probe observations, unresolved blockers and the path for a fresh W8
session. Also write a one-to-two-page closing experience essay before seeing
any grader numbers. No weighted score or comparison claim in this pilot.
Do not implement W8, modify Snapback, publish packages, push git or contact
real providers. Do not ask the supervisor for design hints; resolve choices
from the brief and published surface and record your reasoning. A blocked
feature is evidence, not permission to fake acceptance.
