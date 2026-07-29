# Research Room / Firebase evidence audit

## Outcome

- Expected scenarios: 15
- Final scenarios: 15
- PASS: 15
- GAP: 0
- FAIL: 0
- pending: 0
- Stop-class defects: 0
- Capsule verifier: recorded in the post-window verification receipt

## Authority and negative-path evidence

Alice and Bob used separate native Firebase Authentication emulator principals;
Mallory used a third outsider principal. Firestore and Storage client calls
were evaluated by the checked-in rules. Mallory was denied a source document,
keyword query, question subscription, and file delivery before protected
payload delivery. Bob independently downloaded Alice's exact object and
received Alice's four durable progress writes through a native Firestore
listener.

The cancellation scenario confirmed terminal cancellation, awaited the
in-flight callable's cancelled settlement, injected a late patch, and then
proved unchanged progress count plus no answer record. No Stop-class condition
was observed.

## Provider-path attribution

- Auth: Firebase Authentication emulator email/password principals
- Database: Cloud Firestore emulator plus Security Rules
- Realtime: native Firestore Web SDK snapshot listeners
- Files: Cloud Storage for Firebase emulator plus Storage Security Rules
- Functions: Firebase callable Functions with validated Auth context
- Semantic retrieval: Firebase Admin SDK Firestore `findNearest` with cosine
  distance and 32-dimensional vectors
- Scheduling: actual `firebase-functions/v2/scheduler` `onSchedule` definition
  invoked through the Functions emulator's generated background endpoint
- External refresh source: Firebase Hosting emulator deterministic JSON
- Export: official `firebase emulators:export`

No provider-neutral gateway, poller, client animation, or client-side vector
fallback is counted as capability.

## Retained failures

Three non-product failures remain inspectable:

1. Vite 8 was initially outside the pinned React plugin's peer range; Vite
   7.3.6 resolved it without relaxed dependency rules.
2. The first schedule publisher assumed the hosted region suffix in the local
   topic name.
3. Publishing to the corrected emulator topic was accepted but did not invoke
   the scheduled handler within ten seconds. The exact generated Functions
   background endpoint did invoke the actual handler and produced the durable
   run.

The headless screenshot command also lingered after producing its image. Exact
PID termination and the empty post-termination process set are in cleanup
evidence.

## Performance evidence

Every frozen path has two warmups and seven successful recorded samples, raw
values, median, and nearest-rank p95. The target is a small local emulator
workload and makes no hosted, production-scale, or billed-cost claim.

## Target, export, and cleanup

The fresh local project identity hash agrees across preflight, hub inventory,
seed, export, capsule, and cleanup receipts. Before cleanup the target contained
two rooms, twenty source objects, and three Auth principals. After exact
cleanup all three counts were zero, deleted Alice could not sign in, all
assigned ports were closed, no arm-owned process remained, and worktree-local
secret/export/browser/Firebase/Java state plus diagnostics were removed. The
unrelated baseline was empty and stayed empty.

## Evidence-confidence limits

Hosted Firebase access was unavailable. This lowers hosted deployment,
production runtime parity, hosted secret/config, plan/region, real billing, and
production scheduler confidence; it is target-access evidence, not a product
failure. The emulator used host Node 24 while the deployable Functions project
declares Node 22. Firestore vector search passed locally, but hosted index
creation was not exercised.

## Official references

- <https://firebase.google.com/docs/emulator-suite>
- <https://firebase.google.com/docs/emulator-suite/connect_firestore>
- <https://firebase.google.com/docs/emulator-suite/connect_storage>
- <https://firebase.google.com/docs/firestore/security/get-started>
- <https://firebase.google.com/docs/firestore/vector-search>
- <https://firebase.google.com/docs/functions/callable>
- <https://firebase.google.com/docs/functions/local-emulator>
- <https://firebase.google.com/docs/functions/schedule-functions>
- <https://firebase.google.com/docs/storage/security>
