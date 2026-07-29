# Research Room / Firebase diary-entry draft

**Arm:** Research Room / Firebase

**Profile:** fresh local project on the official Firebase Local Emulator Suite

**Frozen client / CLI:** Firebase Web SDK 12.16.0 / firebase-tools 15.24.0

**Outcome:** 15 PASS, 0 GAP, 0 FAIL, 0 Stop

**Target cleanup:** complete

## Build experience

Firebase was very strong for this application shape. The Local Emulator Suite
made Auth, Firestore, Functions, Storage, Hosting, Pub/Sub, Eventarc, Tasks,
rules evaluation, and a useful UI available under one project identity. Once
the processes were running, the client-side path felt cohesive: email/password
Auth tokens flowed into Firestore and Storage rules, callable Functions received
validated auth context, and Firestore listeners gave Bob real server-backed
progress while Alice's Function was still running.

The surprise of the arm was local vector search. The Firebase Admin SDK's
ordinary `findNearest` path accepted the frozen 32-dimensional vectors in the
Firestore emulator and returned the deterministic nearest source. I had
expected to record a local GAP because the documented surface is server-SDK
only and production requires an index. The result is genuinely useful local
evidence, but it should not be mistaken for proof that production index
creation and deployment are equally frictionless.

The combination of transactions and durable documents worked well for the hard
effect semantics. Cancellation marked the question terminal in a transaction;
the still-running worker checked that state before every patch and again before
the answer transaction. An explicitly injected late patch was rejected after
confirmed cancellation. The same deterministic identity gave retry
idempotency with one question, one answer, and one effect-attempt ledger.
Complete, failed, cancelled, timed-out, and ambiguous outcomes remained easy to
inspect in Firestore.

Storage authorization was also credible. Cloud Storage rules consulted the
Firestore room membership record, enforced owner metadata and object size/type,
and denied Mallory. Alice uploaded and deleted; Bob downloaded the exact bytes.
The cost is application-level two-resource consistency: the Storage object and
Firestore source record are separate writes, so the UI needs compensation if
one side fails.

## What felt good

- One project and one CLI started the full local application backend.
- Auth context reached database rules, object rules, and callable Functions
  without application-authored token plumbing.
- Firestore snapshot listeners produced clean, low-latency authoritative
  progress for the second member.
- The emulator evaluated both Firestore and Storage authorization policies.
- Transactions made cancellation guards and retry deduplication direct and
  inspectable.
- Native vector search passed the deterministic local fixture.
- Emulator export covered Firestore, Auth, and Storage together and produced a
  compact pre-cleanup artifact.
- The emulator hub provided machine-readable service and port identity.

## What was frustrating or surprising

- The installed dependency tree was about 337 MB for this arm, before the
  Firebase CLI's own cached emulator tooling. Both root and Functions trees
  retained audit findings from pinned dependencies.
- The Functions project declared `nodejs22`, while the emulator silently used
  the host's Node 24 after a warning. That weakens runtime-parity confidence.
- An unauthenticated local project works, but startup warns about failed Admin
  SDK config discovery and services that would hit production if accidentally
  called. The warnings are broad enough to create anxiety even when every
  used service is explicitly emulated.
- Scheduled Functions were the roughest path. The emulator created a topic
  named `firebase-schedule-scheduledRefresh`, unlike the documented hosted
  region-suffixed convention. Publishing to that accepted local topic did not
  invoke the handler. The Functions emulator's generated background endpoint,
  `scheduledRefresh-0`, did invoke the actual `onSchedule` definition. Both
  failed attempts are retained; the final product fact passes locally, but
  the testing route was not discoverable from the schedule documentation.
- Rules are authorization, not filters. Query structure must be designed
  alongside policy and indexes; a seemingly natural client query can fail even
  when every returned row would be authorized.
- Local secret handling still required application-owned process environment
  setup, exact canary scans, and explicit runtime-file retirement.
- Cleanup crossed Firestore, Storage, Auth, emulator processes, a scheduled
  trigger, browser state, CLI/XDG state, Java temp state, and diagnostic logs.
  A headless Chrome screenshot process also lingered after writing the image
  and had to be terminated exactly.
- Vite watched the worktree-local browser profile and reacted to Chrome
  extension files. Isolating state under the worktree was correct, but the dev
  server needed an explicit watch exclusion that was not obvious initially.

## Snapback lessons

Snapback should match the outcome of Firebase's cohesive local suite: one
command, one target identity, one inspectable service manifest, deterministic
test principals, policy-aware local files, auth-aware server functions, native
push, scheduler test controls, integrated export, and exact cleanup.

The best differentiation opportunity is to make hard settlement semantics more
coherent than Firebase's collection of application-authored documents and
transactions. A first-class durable action/effect state machine could make
complete, failed, cancelled, timed-out, ambiguous, retry, and late-write
prevention inspectable without every app inventing its own question, progress,
answer, and attempt ledgers.

Snapback can also be materially simpler operationally. A single exact cleanup
command should retire application data, principals, objects, schedules,
secrets, browser/session carriers, and local processes with a machine-readable
receipt. Diagnostics should distinguish "this service is intentionally not
emulated" from "this call can reach production" and show the exact corrective
action.

For research applications specifically, Firebase's ordinary local vector path
raises the capability bar. Snapback does not need to copy Firestore's index
mechanism, but semantic retrieval should have a deterministic local story,
authoritative source identity, an explicit production deployment path, and
diagnostics that never invite a client-side fake to masquerade as native
retrieval.
