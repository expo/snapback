## 2026-07-29 — Convex, deep round untimed extension, stopped with 14/15 passes

### Environment
- Convex client/CLI `1.42.3`; fresh anonymous local beta deployment on the Minisforum x86_64 Linux worker.
- Exact coordinator base `0dc4b3ff6257edc2ee0fea869fca5142531d0ce5`; frozen repaired Snapback source remains `5f31cb6174daaefa04a1e05242acbbc22c725040`.
- Namespace `llp0102-research-convex-w2`; backend/site/Vite ports `3345`/`3346`/`4345`; all target and CLI state was worktree-local.
- Timed work began at `2026-07-29T10:25:06Z` and froze before scenario work when the Stop defect was diagnosed. All product scenarios are an untimed continuation.
- Assistance: inspected pinned Convex CLI/client source after current documentation and the pinned CLI disagreed about anonymous local provisioning and hidden fixed-port flags; recorded prior-arm knowledge of native local acting identities and independently verified it in pinned source. No human intervention.
- Local-only evidence. No isolated hosted credential was available, so hosted identity, deployment, region, production auth, operations, and cost remain unproven.

### Milestones
- Anonymous provisioning first succeeded only with a fresh non-interactive `convex dev --once`; the seemingly more explicit `deployment create local --select` required login.
- The first deterministic extension run reached all 14 pre-cleanup scenarios; adjudication correctly changed the secrets scenario from pass to fail because the platform control secret contradicted the broader product fact, leaving 13/14 pre-cleanup passes.
- Final result: 14/15 passes including deterministic cleanup, with `RESEARCH-13-SECRETS` fail/Stop.

### What felt good
- Convex's integrated shape fit this app unusually well. One schema declared ordinary, full-text, and vector indexes; the native action/query split handled semantic retrieval without an external vector database.
- Scheduled mutations made four separately committed progress updates easy, and Bob's second `ConvexClient` observed each through native WebSocket push without authoring a subscription server.
- Native upload URLs, storage IDs, delivery URLs, and deletion covered the 64 KiB fixture with little glue.
- Generated APIs caught schema/function mistakes quickly. Once the local target was alive, deploy feedback was fast and direct.
- Queries and mutations naturally expressed room membership checks. The headless local acting-identity path made Alice/Bob/Mallory attribution reproducible without an inbox.

### What felt bad or frustrating
- The local CLI path had avoidable churn. `--local` was rejected as deprecated, `deployment select local` could not select a nonexistent target, and `deployment create local --select` demanded login even though the agent-mode documentation says anonymous local work needs none. The least explicit command, `convex dev --once`, was the one that worked.
- Fixed local ports still existed only as hidden flags, so preserving isolation required source inspection.
- The Stop-class problem is serious: the official local backend puts a generated control secret in process argv and binds backend and site listeners to `0.0.0.0`. The application canary stayed server-side, but the broader secrets claim still fails.
- Vector search can run only in an action, so authorization and document hydration required an action → internal query → vector search → internal query composition. It worked, but the split is conceptual overhead.
- The anonymous development identities are excellent for acceptance but are not proof of the production Convex Auth email flow. Hosted production behavior remains a confidence gap.

### Modeling and correctness
- Tables modeled rooms, memberships, sources, questions, durable progress, answers, attempts, rejected late attempts, scheduled refresh runs, and realtime signals.
- The room-filtered full-text and vector indexes made authoritative retrieval direct. A compound room/dedupe index made retry settle on one question and one answer while retaining both attempt records.
- Each scheduled progress step rechecked the question state transactionally. Cancellation set the terminal state first; scheduled and explicitly injected late attempts could record rejection but could not patch progress or answers.
- Complete, failed, cancelled, timed-out, and ambiguous outcomes remained distinct durable values.

### Realtime, offline, and auth
- Realtime attribution is direct native Convex WebSocket push. Bob observed Alice's four scheduler-authored progress transitions, including terminal completion.
- Mallory's query, action, and subscription paths all refused protected data. This is direct local development-identity evidence, not production-auth evidence.
- Reconnect samples established a fresh native client's authoritative initial view. Research Room has no frozen offline-retention requirement, and this arm makes no offline claim.

### Deployment and operations
- Local anonymous setup was lightweight after the CLI path was discovered. The beta backend persists under `.convex` and exists only while `convex dev` runs.
- The Vite shell built repeatedly and ran on its isolated port. Local provider billed cost is zero; this is not hosted cost evidence.
- Cleanup deleted application records and storage through Convex first, removed the canary from the selected target, then stopped exact process trees and removed only the arm-local target/config paths.

### Documentation and diagnostics
- The full-text, vector-search, storage, scheduler, and agent-mode pages were enough to implement the ordinary product paths.
- Local deployment command guidance was internally inconsistent for a new anonymous project, and the isolation-critical port controls were absent from help.
- Diagnostics must never recommend full process-argv capture while the backend carries a secret there. PID, executable, owner, bind address, and redacted flag names were sufficient after containment.

### Glue and workaround inventory
- One TypeScript acceptance harness reads worktree-local Convex admin configuration solely to exercise the CLI's native development acting identities. It is never bundled into the client.
- One deterministic Convex HTTP action supplies the scheduled external-fetch fixture.
- One build-sampling script and one exact-value scan script produce protocol evidence.
- No generic backend abstraction, poller, external search engine, external vector database, custom file service, or custom realtime server was added.

### Outcome
- Pass: seed, files, outsider denial, keyword search, semantic retrieval, four-step progress, citations, collaborator push, cancellation, retry, distinct outcomes, scheduled refresh, performance evidence, and cleanup.
- Fail/Stop: secrets, because Convex local `1.42.3` places its independent control secret in process argv. The application canary path itself passed and exact-value scans found no value in source, client bundles, evidence, logs, or browser state.
- Hosted acceptance is unavailable and explicitly unclaimed.

### Would I choose it?
- No for this app on the tested local version while the Stop defect exists. If Convex removes the control secret from argv and defaults local listeners to loopback, the rest of this arm would make it a strong choice: the integrated realtime, storage, scheduler, full-text search, and vector search path is unusually complete and concise.

### Lessons for Snapback
- Match the outcome of declaring transactional full-text and vector retrieval beside ordinary schema, with generated client feedback and no separate service ceremony.
- Match the experience of scheduler-authored durable progress becoming realtime automatically for every authorized subscriber.
- Provide a first-class deterministic development-identity API for Alice/Bob/Mallory acceptance without weakening production authority.
- Keep secrets out of argv by construction, bind local services to loopback by default, and make fixed-port isolation controls documented and ordinary.
- Preserve Snapback's stronger settlement and cancellation vocabulary while making the common action/query composition as compact as Convex's best paths.
