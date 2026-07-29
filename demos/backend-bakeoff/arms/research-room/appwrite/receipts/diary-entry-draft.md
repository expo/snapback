## 2026-07-29 — Appwrite, deep round, pass with one GAP

### Environment

- Appwrite 1.9.6 official self-hosted container stack; Appwrite web client 26.2.0, Node server SDK 27.1.0, CLI 23.2.0.
- Fresh local namespace `llp0102-research-appwrite-w1`; API 8093, secondary gateway 8493, installer 20083, Vite 4346.
- Frozen Snapback product source `5f31cb6174daaefa04a1e05242acbbc22c725040`; coordinator base `0dc4b3ff6257edc2ee0fea869fca5142531d0ce5`.
- Timed start `2026-07-29T10:33:35Z`; no extension. Hosted Appwrite Cloud was an explicit credential-unavailable GAP, not a product failure.
- Assistance: current official Appwrite database, Storage, Realtime, Functions, scheduling, and variable documentation; the existing Partiful/Appwrite arm only for isolated installer/CLI/cleanup conventions.

### Milestones

- First local read: 658,837 ms.
- First authoritative mutation: 659,196 ms.
- First verified realtime transition: 660,776 ms.
- Local acceptance through scenario 13: 746,218 ms.
- Hosted URL: GAP, credential unavailable.
- Final acceptance: after performance and exact cleanup.

### What felt good

- Appwrite covered almost the whole Research Room shape inside one product. Native Auth, Teams, row permissions, full-text indexes, Storage, Realtime, Functions, scheduled executions, and secret variables all participated in executable evidence.
- `createTable` accepted columns and indexes together, so the complete server schema stayed legible in one provisioning script. Full-text search was especially ordinary: one index plus `Query.search` returned the two expected authorized sources.
- Storage's file-level permissions made the source lifecycle crisp. Alice uploaded, Bob downloaded identical bytes, Mallory was refused, Bob could not delete Alice's object, and Alice's delete produced a clean negative probe.
- Realtime was direct and fast. Bob's independent session saw four separately committed progress rows over a WebSocket before the terminal answer; recorded delivery median was 10.435 ms.
- Function variables marked secret were actually opaque on read. The function could observe canary presence, while the management API did not return the value. That is exactly the evidence shape this app needs.
- The scheduled-execution record was inspectable and connected naturally to the durable refresh row.
- Error messages were generally specific. The unsupported runtime response named the bad runtime and version; permission errors listed the roles Alice could legitimately grant.

### What felt bad or frustrating

- The official web installer dropped its event stream after the stack had already become healthy. A health probe and idempotent recovery were needed to distinguish success from failure and recover the generated Compose files.
- The freshly installed Appwrite 1.9.6 stack advertised only Node 16, PHP 8.0, Ruby 3.0, and Python 3.9 runtimes. The first `node-22` deployment failed, and Node 16 lacked built-in `fetch`, forcing the worker to use low-level `http`/`https`.
- Deleting and immediately recreating a Function under the same ID left variable identifiers conflicting but not readable under the recreated Function. A fresh Function namespace (`research-worker-v2`) was the reliable recovery.
- The Realtime web SDK assumed a browser `window` for heartbeat state. The actual browser path worked, but a Node acceptance client needed an explicit browser-global shim. This was harness friction, not a product transport failure.
- The local stack was operationally heavy for one small app: 29 running Compose containers and 12 volumes before runtime execution containers, plus 267,801,039 bytes of installed JavaScript dependencies.
- `npm audit` reported 16 dependency findings in the pinned SDK/CLI application graph: 3 low, 6 moderate, and 7 high. No breaking automatic upgrade was applied.
- One-off scheduled execution accepts minute-precision future times, so deterministic acceptance paid a long wall-clock wait for a small operation.
- Actor permission grants initially surprised me: Alice could not grant a direct read permission to Bob merely because both were known users. Expressing shared access through their Team was required. The security rule is defensible, but the first error happened well after the data model was written.

### Modeling and correctness

- The relational shape was straightforward as explicit tables: rooms, memberships, sources, questions, answers, progress, refresh runs, and outcome fixtures.
- Unique indexes gave clean idempotency fences for question keys, answer lineage, and progress sequence.
- Cancellation was application-authored Function logic over durable rows. It worked: after confirmation, a late Function probe left both terminal state and progress count unchanged.
- This arm did not exercise Appwrite's transaction API because the Research Room facts did not require a contended multi-row invariant. Transaction/conflict confidence should therefore remain below direct.
- Semantic retrieval is a real GAP. Appwrite stored the 32-dimensional vectors but offered no ordinary native vector index or nearest-neighbor query path in the tested version. No scan fallback was used.

### Realtime, offline, and auth

- Alice, Bob, and Mallory were independent native Auth principals. Alice and Bob shared a native Team; Mallory did not.
- Row security and file security produced both positive member behavior and direct outsider refusal.
- Bob's four progress callbacks were native Appwrite Realtime WebSocket delivery, not polling or local animation.
- Reconnect was measured with fresh Bob Realtime clients through the first authoritative callback: median 386.78 ms, p95-nearest-rank 390.943 ms.
- The deep Research Room fixture did not claim a durable offline mutation queue. Offline/reconnect confidence is therefore indirect despite the measured reconnect path.

### Deployment and operations

- Project, web platform, scoped server key, Auth users, Team, database, tables, indexes, bucket, Function, deployments, variables, and schedule all had first-party APIs.
- Function deployment was quick once the correct locally advertised runtime was used.
- The breadth comes with substantial local operational surface: Traefik, core API, Realtime, workers, schedulers, MongoDB, Redis, executor, browser, embedding service, and console.
- Cleanup is exact-target-bound to the Compose project label, installer label, recorded Vite PID, four ports, and ignored arm-local paths.

### Documentation and diagnostics

- Current official docs clearly explained TablesDB transactions, row permissions, Storage permissions, Realtime authorization, Function execution modes, schedules, and secret variables.
- The runtime mismatch was discoverable through the target's runtime inventory and a precise error, but the default installed runtime list was surprising relative to a current product release.
- The installer disconnect was ambiguous without a separate health check.
- The Function-variable delete/recreate conflict was the least self-explanatory lifecycle behavior; `409` followed by `404` required a namespace change rather than an obvious wait/retry instruction.

### Glue and workaround inventory

- Idempotent official-installer recovery around a dropped event stream.
- Console/CLI organization, project, platform, and scoped-key bootstrap.
- Eight-table schema/seed/permission harness and deterministic file fixtures.
- Application-authored Function state machine for four progress commits, cancellation fencing, retry, and external refresh.
- Node 16 `http`/`https` request helper because the advertised runtime lacked built-in `fetch`.
- Node acceptance shim for the browser-oriented Realtime heartbeat.
- Deterministic evidence, benchmark, browser integration, inventory, and exact cleanup harnesses.

### Outcome

- Before cleanup: 13 PASS, 1 GAP, 0 FAIL, cleanup pending.
- The only product GAP is semantic vector retrieval.
- No Stop-class defect occurred.
- Native-path evidence passed for Auth/authority, files, full-text search, four-step streamed progress, citations, second-client Realtime, cancellation, retry, five effect outcomes, scheduled refresh, secret opacity, and performance.

### Would I choose it?

- Conditional yes for a collaborative research product that values a broad self-hostable platform and can tolerate the operational footprint. The integrated Storage/Auth/Realtime/Functions story is compelling.
- I would hesitate if semantic retrieval must be native, if local operational simplicity matters, or if the installed Function runtime inventory and dependency-health posture cannot be tightened.
- Confidence: high for the tested local product facts; low for hosted operations because no Cloud credential was available.

### Lessons for Snapback

- Match the outcome of Appwrite's coherent resource breadth: data, identity, files, realtime delivery, scheduled work, execution inspection, and opaque secrets should feel like one product.
- Preserve Snapback's opportunity to be radically lighter locally. Appwrite's 29-container stack is comprehensive but costly in cognitive and machine surface.
- Make authoritative multi-step progress and cancellation an explicit first-class pattern with direct diagnostics; Appwrite required an application-authored Function state machine even though its primitives were adequate.
- Full-text search is table stakes and should be as ordinary as one declared index plus one query operator.
- Match the end result of truly opaque secrets: runtime presence can be proven without management APIs, logs, or receipts revealing the value.
- Prefer a current, predictable execution runtime matrix and idempotent deployment lifecycle. The `node-22` refusal and variable ghosting were avoidable platform friction.
- A native semantic retrieval path remains a meaningful completeness differentiator for AI-shaped applications.
