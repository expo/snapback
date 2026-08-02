# LLP 0154 minimal observability review — Codex family

## Round 2 — 2026-08-02

**Reviewer family:** OpenAI Codex
**Provider / runtime:** `codex-cli` 0.146.0, `codex exec`, model
`gpt-5.6-sol`, `model_reasoning_effort=xhigh`, sandbox `read-only`
**Date:** 2026-08-02
**Redacted:** no (repository-local content sent to OpenAI per the author's
explicit request for a Codex design-partner review)
**Method:** fresh non-author `codex exec` context, read-only sandbox over
the working tree; mutually blind — instructed not to read any
`llp/reviews/` artifact concerning LLP 0154; the review states "I did not
inspect any LLP 0154 review artifact." SHA-pinned target and instruction
capsule. Design-partner framing per author directive.
**Instruction capsule SHA-256:** `cfbd3eea5fba77befaac97e07455aba915b8f14c25cef6a7f5fa1ec74aca799e`
**Target:** `llp/0154-minimal-observability.rfc.md` (648 lines, Draft, v0.3)
**Target SHA-256:** `2578344420fd8a13b4dcb395667e27da8a0b0a49adbad3d2205acf1206f23f72`
**Repo revision at review start:** `main` `4f7890eb` (target file untracked)
**Status:** completed
**Verdict:** NOT READY

### Verbatim review (round 2)

1. **Overall assessment**

v0.3 is a substantial improvement: removing network SQL, separating loss-tolerant telemetry from bill-grade metering, moving maintenance off cron, deferring identity-dependent analytics, and making hosted variance explicit are all sound moves. The local substrate and MCP corrections largely verify against the repository. However, the central “one envelope, three projections” contract remains temporally and taxonomically incomplete; sensitive-read/deletion rules are not closed; generation fencing conflicts with the SQL hatch; and rollup correctness is underspecified. These are architectural issues, not editorial cleanup, so the RFC is not yet a sound basis to enter Review. Verdict: NOT READY

2. **Strengths**

- The three-phase cut is disciplined. Phase 1 focuses on operational observability, Phase 2 isolates hosted-arm variance, and Phase 3 correctly defers typed product analytics and identity policy (`llp/0154-minimal-observability.rfc.md:56`, `llp/0154-minimal-observability.rfc.md:506`).

- The sibling-database decision fits the local storage substrate. App storage has one owned connection and a separate WAL reader pool (`src/storage.rs:802`), while telemetry is explicitly kept off that writer, journal, matcher, backup, and logical-byte paths (`llp/0154-minimal-observability.rfc.md:223`).

- Replacing cron maintenance is well founded. Cron state is persisted in `_snapback_meta` (`src/storage.rs:2676`, `src/storage.rs:2700`), and LLP 0028 defines durable scheduler/run-ledger state rather than generic internal maintenance (`llp/0028-cron-scheduled-execution.rfc.md:287`). Event-armed flush maintenance therefore preserves the intended separation better (`llp/0154-minimal-observability.rfc.md:369`).

- The network SQL endpoint should remain deleted. The local-only direction is consistent with LLP 0017’s explicit-local-escape-hatch posture (`llp/0017-admin-console-inspection-surface.rfc.md:84`) and avoids making arbitrary SQL a cross-arm contract (`llp/0154-minimal-observability.rfc.md:426`).

- The MCP correction is accurate. `src/guide_mcp.rs` advertises resources rather than tools (`src/guide_mcp.rs:178`, `src/guide_mcp.rs:312`), while the control MCP calls the host-ops surface (`packages/snapback-cli/mcp-control.mjs:444`) in accordance with LLP 0024’s one-core/thin-projections rule (`llp/0024-agent-operating-surface.spec.md:103`).

- Reclassifying telemetry as sensitive identity-derived application data is correct. Diagnostics can contain source paths, handler text, and arguments (`src/diagnostic.rs:31`), and LLP 0031 explicitly includes subjects, handler errors, source, arguments, and correlation data in `SensitiveApplicationData` (`llp/0031-server-route-taxonomy.spec.md:181`).

- Fixed-bucket histograms are the right correction to scalar percentiles, and deferring distinct-user metrics until identity semantics exist is sound (`llp/0154-minimal-observability.rfc.md:466`).

- The guide deliverable catches a real corpus gap: the capability index promises explicit GAP rows for uncovered capabilities (`guide/capabilities.md:20`), while the RFC correctly notes that observability currently has none (`llp/0154-minimal-observability.rfc.md:578`).

3. **Concerns**

1. **BLOCKING — The shared observation envelope is not yet a valid metering projection.**

   **Evidence:** D2 describes one envelope with an admission timestamp and terminal outcome (`llp/0154-minimal-observability.rfc.md:263`). LLP 0104, however, requires an idempotent `eventId`, schema version, both occurrence and observation times, ownership interval, durable environment identity, metric, quantity, receipt/cursor, and correction linkage (`llp/0104-expo-hosted-metering-and-commercial-contract.spec.md:62`). It also binds attribution and budget reservation at admission (`llp/0104-expo-hosted-metering-and-commercial-contract.spec.md:67`), before terminal status and duration exist. Moreover, D2 promises a “versioned operation-class table below,” but the table only lists telemetry kinds/seams (`llp/0154-minimal-observability.rfc.md:300`); the persisted schema has no classification version or application/system disposition (`llp/0154-minimal-observability.rfc.md:282`). LLP 0104’s actual versioned classification distinguishes logical calls, batches, live subscriptions, frames, and control operations (`llp/0104-expo-hosted-metering-and-commercial-contract.spec.md:181`). Emitting both `http_request` and `function_run` also creates a double-counting risk unless a projection map selects exactly one billable observation.

   **Resolution:** Replace “one emitted envelope” with a versioned observation lifecycle: an admission record carrying stable observation identity, exact `operation-class` version, ownership/budget attribution and correlation; then a terminal record or completion patch carrying outcome, duration, and diagnostic. Add an exhaustive projection table declaring, per operation class and phase, whether it feeds telemetry, structured logs, metering, or multiple sinks—and exactly which record is billable. Close OQ1 before Review.

2. **MATERIAL — C5’s reclassification is correct, but its authority and deletion consequences are not carried through.**

   **Evidence:** Phase 1 persists subjects and potentially operator-only diagnostic details (`llp/0154-minimal-observability.rfc.md:276`, `llp/0154-minimal-observability.rfc.md:331`), yet Tier-1 routes are described only as “admin-gated” (`llp/0154-minimal-observability.rfc.md:397`). LLP 0031 requires raw/open identity-derived responses to use `AdminSecretRead`, not an ordinary admin or persisted console credential (`llp/0031-server-route-taxonomy.spec.md:181`, `llp/0031-server-route-taxonomy.spec.md:199`); existing raw inspect and table routes implement exactly that split (`src/admin.rs:1957`, `src/admin.rs:1974`). Phase 1 collects subjects, but subject deletion is deferred to Phase 3 (`llp/0154-minimal-observability.rfc.md:545`). Finally, HLL-class sketches are proposed alongside subject deletion (`llp/0154-minimal-observability.rfc.md:484`), without explaining how historical contributions are removed or rebuilt.

   **Resolution:** Make `/stats` a closed `OperatorMetadata` projection with no subject, details, or handler-controlled text. Require scoped, budgeted `AdminSecretRead` leases and `no-store` for `/events` and export. Either omit `subject` from Phase 1 or define Phase-1 erasure/rotation semantics and add the necessary index. Replace the asserted HLL solution with a Phase-3 decision gate requiring a deletion-compatible aggregate strategy. Define diagnostic details through an allowlist/redactor, not merely a byte cap.

3. **MATERIAL — Generation fencing lacks a durable protocol and contradicts the SQL hatch.**

   **Evidence:** D1 says old-generation rows become invisible to every query surface immediately (`llp/0154-minimal-observability.rfc.md:250`), while D3 gives only an in-memory “clear then rotate” sequence (`llp/0154-minimal-observability.rfc.md:362`). It does not identify the durable current-generation authority or specify crash/restart and commit-uncertainty behavior across the two databases. The existing reset path already rotates an authorization-stream incarnation in the app transaction (`src/storage.rs:930`) and emits the committed successor witness (`src/storage.rs:2467`), followed by an exact publication fence (`src/server.rs:17335`). That is a natural authority to reuse or explicitly supersede. Separately, the direct SQL hatch can select old-generation base rows, contradicting “every query surface” (`llp/0154-minimal-observability.rfc.md:434`).

   **Resolution:** Normatively bind telemetry generation to a named existing database/stream incarnation or introduce an equally explicit authority. Specify admission capture, reset commit, lost-ack recovery, restart reconciliation, query selection, and restore translation in a crash matrix. Either expose only a current-generation view through the hatch, physically purge predecessors before reopening it, or narrow the invisibility claim and document the local-operator exception.

4. **MATERIAL — Rollup maintenance is not yet lossless, idempotent, or bounded.**

   **Evidence:** D4 text orders retention deletion and old-generation deletion before rollup updates (`llp/0154-minimal-observability.rfc.md:369`), but defines no rollup high-watermark, idempotency key, or transaction coupling. An app can therefore go idle after its final events and resume after raw retention; the stated order can delete the only inputs before aggregation. D7’s schema contains aggregates but no maintenance state (`llp/0154-minimal-observability.rfc.md:471`). Its claim that rows are bounded by the operation-class table is also too strong: `name` includes app-defined route/function/job names (`llp/0154-minimal-observability.rfc.md:288`), which can accumulate across deployments while rollups are retained indefinitely (`llp/0154-minimal-observability.rfc.md:468`). Finally, histogram-derived percentiles are approximate, contradicting “locally everything is exact” in the variance envelope (`llp/0154-minimal-observability.rfc.md:411`, `llp/0154-minimal-observability.rfc.md:478`).

   **Resolution:** Add transactional rollup state with a durable high-watermark, process unrolled rows before retention, delete only rows covered by that watermark, and define how stats combine finalized rollups with the unrolled tail without double counting. Put explicit retention/cardinality budgets on rollups or define a compaction policy. Make exactness field-specific: counts may be exact while histogram percentiles carry bucket/error metadata.

5. **MATERIAL — The hosted Tier-1 query locus is internally inconsistent.**

   **Evidence:** D5 makes app-server routes under `/_snapback/api/telemetry/*` the canonical contract (`llp/0154-minimal-observability.rfc.md:397`). The Cloudflare design keeps the Analytics Engine query credential in the control plane and explicitly out of the app runtime (`llp/0154-minimal-observability.rfc.md:514`). LLP 0072 likewise assigns hosted logs, metrics, and gated inspection to the control plane and keeps its credentials out of the application plane (`llp/0072-trusted-single-tenant-control-plane.rfc.md:155`). The RFC does not define who answers the app-server route on Cloudflare or how the console reaches the control-plane-owned data. A variance envelope can describe approximation, but cannot manufacture deterministic cursor pagination or an events listing if the backend cannot provide them.

   **Resolution:** Define a transport-neutral telemetry query operation/schema as the contract. Locally, project it onto the admin routes; hosted, project it through the target adapter/control plane; MCP and CLI consume the same operation. Add capability outcomes such as `exact`, `approximate`, `bounded-window`, and `unsupported` per query, rather than requiring every backend to simulate every route.

6. **MINOR — `boot` lifecycle events contradict the strongest idle wording.**

   **Evidence:** C2 says no traffic means no events or writes (`llp/0154-minimal-observability.rfc.md:179`), D1 says the file stays absent until the first event (`llp/0154-minimal-observability.rfc.md:247`), but D2 includes boot as a lifecycle event (`llp/0154-minimal-observability.rfc.md:310`). The existing idle evidence measures a 120-second window after startup and provisioning, not zero startup writes (`llp/0035-local-target-benchmarks.research.md:277`).

   **Resolution:** Either arm the boot marker only when the first traffic event arrives, or weaken the claim to “no periodic writes after startup” and add separate startup-write evidence.

7. **MINOR — The SQL authorizer precedent is described inaccurately.**

   **Evidence:** D5 calls for a deny-by-default authorizer and says Ibex installs “exactly this authorizer” (`llp/0154-minimal-observability.rfc.md:434`). The Ibex authorizer is allow-by-default except for `ATTACH`, `DETACH`, and `load_extension` (`vendor/ibex/src/host/abi.rs:3075`); its isolated-I/O variant denies only selected pragmas before delegating to that allow-default policy (`vendor/ibex/src/host/abi.rs:3091`). Snapback’s rusqlite dependency currently lacks `hooks` (`Cargo.toml:33`), while Ibex enables it (`vendor/ibex/Cargo.toml:59`).

   **Resolution:** Say this is a new, stricter policy inspired by the Ibex precedent. Enumerate allowed authorizer actions, reject statement tails, deny all pragmas/attachment/extensions, and enforce both result-row and VM-step/time budgets. Add adversarial tests beyond the existing three Ibex refusal cases (`vendor/ibex/src/host/abi.rs:10831`).

4. **Design proposals**

- **[strong] Make the observation primitive a two-stage span, not a single terminal envelope.** Use an immutable admission event plus a terminal completion linked by one observation ID. Metering consumes admission; telemetry can join admission and completion; hosted logs can emit either or both under their own redaction and loss contract.

- **[strong] Make typed telemetry operations—not HTTP routes—the cross-target contract.** Treat local routes, control-plane adapter calls, CLI, MCP, and console as projections. This resolves the Cloudflare credential-locus conflict and matches LLP 0024’s existing architectural pattern.

- **[strong] Keep Phase 1 subject-free by default.** Operational debugging needs correlation, route/function identity, diagnostic code, release, generation, and timing; it usually does not need a durable user subject. Add subject-bearing analytics only with Phase 3’s identity, deletion, and retention policy.

- **[strong] Define rollups as a small state machine.** Persist `lastRolledEventId`, update buckets and the watermark atomically, retain an unrolled tail, and run retention only behind the watermark. Publish per-field variance rather than one response-wide exactness bit.

- **[moderate] Add a hard resource safety envelope independent of commercial entitlements.** Local configuration may remain operator-free, but `max_days`, telemetry bytes, rollup rows, operation-name cardinality, and query work should still have validated bounds to preserve C3.

- **[moderate] Either capture authored logs or rename the “Logs” page to “Events.”** The runtime already has a `runtime.log` host call (`src/runtime.rs:1895`), while the Phase-1 taxonomy contains no app-log event. If app logs remain excluded, the UI should not imply they are present.

- **[exploratory] Separate operational events from product events at the type level.** A `SystemObservationV1` and later `DeclaredProductEventV1` can share identity/correlation primitives without forcing lifecycle, request, analytics-property, and billing semantics into one oversized union.

5. **Open questions**

- **OQ1 — Envelope field set:** Must be resolved before Review. Ratify not just field names, but admission-versus-terminal timing, stable event identity, operation-class version, batch/retry rules, and the exact projection matrix.

- **OQ2 — Phase-3 identity policy:** Defer product analytics, but choose privacy-conservative semantics: no automatic retroactive anonymous-to-authenticated linking. Permit explicit app declaration later, with deletion applying to the complete link set. Until then, authenticated and anonymous identities remain separate.

- **OQ3 — Hosted retention ceilings:** Commercial entitlements can remain an LLP 0104 decision, but this RFC should still define non-commercial safety bounds for every arm. “Operator-free” should mean no plan gate, not unbounded storage.

- **OQ4 — Cloudflare rollup persistence:** Start with an honestly bounded Analytics Engine window rather than adding Durable Object rollups immediately. Add DO rollups only if the Phase-2 capability target requires longer-window Health parity and after the query-locus contract is settled.

- **OQ5 — Lifecycle seam inventory:** Close for Phase 1 with a small allowlist: process start/ready, release activation, migration success/failure, reset/restore generation boundary, detected unclean predecessor, and graceful shutdown. Keep config and secret rotation in control-plane audit unless only a non-sensitive version/digest marker is emitted.

- **Additional question — `ctx.track` settlement:** Decide whether events requested during a mutation are released only after successful commit. LLP 0110’s durable activity pattern commits activity and source effects together (`llp/0110-bounded-children-and-activity-patterns.spec.md:548`); telemetry remains best-effort, but should not silently count rolled-back product actions unless that semantic is explicit.

I did not inspect any LLP 0154 review artifact. I also did not independently verify the dated external vendor or Cloudflare Analytics Engine claims in the landscape section; this review used only repository evidence.

6. **Recommended next step.**

Revise to v0.4 while remaining Draft. First close OQ1 with the two-stage observation contract and exhaustive projection table; then pin route sensitivity/deletion rules, generation recovery, transactional rollup maintenance, and the target-neutral hosted query seam. Correct the idle and authorizer wording and run one focused cross-family re-review over those changes. The sandbox was read-only, so I did not create the required `llp/reviews/0154-…codex.md` artifact or change the RFC’s status.

## Round 1 — 2026-08-02

**Reviewer family:** OpenAI Codex
**Provider / runtime:** `codex-cli` 0.146.0, `codex exec`, model
`gpt-5.6-sol`, `model_reasoning_effort=xhigh`, sandbox `read-only`
**Date:** 2026-08-02
**Redacted:** no (repository-local content sent to OpenAI per the author's
explicit request for a Codex design-partner review)
**Method:** fresh non-author `codex exec` context, read-only sandbox over
the working tree; mutually blind — instructed not to read any
`llp/reviews/` artifact concerning LLP 0154, and verified after the fact
not to have done so (zero mentions of that path in its 12,539-line
transcript, which matters because the Fable round-1 artifact was already on
disk during part of this run). SHA-pinned target and instruction capsule.
Design-partner framing per author directive: reviewer explicitly invited
to propose significant design changes.
**Instruction capsule SHA-256:** `776514aa0897947ba44a88d74cb0ffc6723e00b1b782e7cb112e74bee95307d3`
**Target:** `llp/0154-minimal-observability.rfc.md` (489 lines, Draft, v0.2)
**Target SHA-256:** `a6fc5deec321f1ea8847b0f450d9402686845c053e275a3f75e040134117cfca`
**Repo revision at review start:** `main` `4f7890eb` (target file untracked)
**Status:** completed
**Verdict:** NOT READY

## Verbatim review

## 1. Overall assessment

LLP 0154 has the right product instinct: recent operational visibility should be built in, agent-queryable, bounded, and isolated from the application write lane. I verified the target hash and read the full document plus the named repository authorities and source seams. The local sibling-store direction is credible, but the RFC is not yet a sound implementation basis: its SQL escape hatch lacks a sufficient security boundary; its privacy classification is incorrect; its metering/log compatibility claim is not borne out by the schemas; its rollups cannot compute several promised metrics; and reset, hosted, route-authority, and MCP semantics remain unresolved. I did not independently revalidate the external landscape and pricing claims, and this verdict does not depend on them.

Verdict: NOT READY

## 2. Strengths

- The scope boundary is unusually clear. Fixed operational views with short raw retention fit Snapback’s explicit exclusion of write firehoses and heavy OLAP (`llp/0154-minimal-observability.rfc.md:47-57`; `llp/0000-snapback.explainer.md:689-718`).

- The sibling-database decision is directionally correct. Snapback’s app database has a dedicated write connection and WAL reader pool (`src/storage.rs:802-809`, `src/storage.rs:1652-1663`, `src/storage.rs:7892-7939`), so isolating telemetry avoids app-writer lock contention, journal semantics, live-query matching, and backup pollution.

- The event-driven idle requirement is well grounded. The RFC preserves “no traffic, no writes” (`llp/0154-minimal-observability.rfc.md:141-146`), matching the measured local result of unchanged database/WAL files and no measurable CPU over 120 seconds (`llp/0035-local-target-benchmarks.research.md:277-306`) and the qualified Cloudflare observed-zero evidence (`llp/0000-snapback.explainer.md:584-614`).

- Bounded queues, explicit shedding, and visible drop counters are the correct failure posture (`llp/0154-minimal-observability.rfc.md:236-252`). That is consistent with the existing realtime rule that bounded loss must remain observable (`llp/0013-ephemeral-realtime-state.rfc.md:470-504`).

- “Agents first, dashboards as a client” is exactly aligned with the project. LLP 0010 requires stable machine-readable feedback (`llp/0010-agent-dx-and-acceptance.spec.md:38-47`, `llp/0010-agent-dx-and-acceptance.spec.md:64-81`), while LLP 0017 already makes the web console one consumer of a headless contract (`llp/0017-admin-console-inspection-surface.rfc.md:11-24`).

- Several substrate claims are verified: `Cargo.toml` has no direct `tracing` or `log` dependency (`Cargo.toml:15-47`), and `src/server.rs` has exactly two `eprintln!` calls (`src/server.rs:3848`, `src/server.rs:20420`). Cron already has a strong terminal seam carrying job identity, outcome, duration, and diagnostic (`src/cron.rs:894-944`).

- The capability-index debt is real. Its policy requires explicit GAP rows for uncovered capabilities (`guide/capabilities.md:20-29`), and the current capability table contains no observability row (`guide/capabilities.md:31-99`).

## 3. Concerns

1. **BLOCKING — The read-only SQL endpoint is not safely isolated as specified.**
   D5 asserts that `PRAGMA query_only = ON` means the connection “can only ever see” telemetry tables (`llp/0154-minimal-observability.rfc.md:296-308`). That does not define an SQL authorization boundary: it names no denial of `ATTACH`, `DETACH`, extension loading, unsafe pragmas, multiple statements, or non-telemetry objects. The repository’s own Ibex SQLite boundary separately installs an authorizer specifically to deny attach/detach and `load_extension` (`vendor/ibex/src/host/abi.rs:3075-3088`) and tests those refusals (`vendor/ibex/src/host/abi.rs:10831-10866`).
   **Resolution:** Remove network-exposed arbitrary SQL from v1, or specify a deny-by-default SQLite authorizer, fixed-table allowlist, single read statement, read-only open flags, disabled extensions, memory-only temp state, step/time/row/byte limits, and `AdminSecretRead` authorization. Do not expose a Cloudflare-native arbitrary dialect as the same contract.

2. **BLOCKING — “Telemetry is not customer data” is the wrong classification.**
   C5 says telemetry is not customer data (`llp/0154-minimal-observability.rfc.md:157-160`), yet the proposed store contains auth subjects, diagnostic details, URLs, user agents, referrers, optional IPs, device identifiers, and app-defined properties (`llp/0154-minimal-observability.rfc.md:198-234`, `llp/0154-minimal-observability.rfc.md:339-351`). The code explicitly warns that diagnostic messages/details can contain source paths, handler text, and arguments (`src/diagnostic.rs:31-33`). LLP 0031 classifies subjects and handler-controlled content as sensitive application/identity-derived data and requires stronger controls for raw reads (`llp/0031-server-route-taxonomy.spec.md:181-206`, `llp/0031-server-route-taxonomy.spec.md:339-343`). LLP 0072 also forbids arbitrary objects, credentials, raw bodies, and private payloads from default logs (`llp/0072-trusted-single-tenant-control-plane.rfc.md:719-735`).
   **Resolution:** Rename C5 to “telemetry is out-of-band application/identity-derived data”; define field-level safe projections, URL/query/referrer scrubbing, diagnostic redaction, file permissions, subject hashing/rotation, deletion semantics, and route sensitivity. Raw events and SQL should require scoped secret-read authority and row/byte budgets.

3. **MATERIAL — C4’s claimed compatibility with LLP 0104 is not real yet, and LLP 0072 already owns overlapping log semantics.**
   LLP 0154’s row has `id`, `ts_ms`, `kind`, `name`, status, duration, subject, code, and details (`llp/0154-minimal-observability.rfc.md:193-212`). LLP 0104 requires globally unique idempotent IDs, schema version, occurred/observed times, stable app/environment identity, ownership interval, release/deployment identity, request/job correlation, metric quantity, source receipt, correction relationships, deduplication, and completeness watermarks (`llp/0104-expo-hosted-metering-and-commercial-contract.spec.md:62-93`). It also explicitly separates sampled observability from billable totals and says Analytics Engine is not billing authority (`llp/0104-expo-hosted-metering-and-commercial-contract.spec.md:463-484`). Meanwhile LLP 0072 already requires structured application logs with deployment identities, correlations, event versions, redaction, source sequence, and delivery/drop counters (`llp/0072-trusted-single-tenant-control-plane.rfc.md:719-735`), contrary to LLP 0154’s characterization of hosted logs as merely supervisor logs (`llp/0154-minimal-observability.rfc.md:388-393`).
   **Resolution:** Share a typed admitted-operation classification and correlation envelope, not a loss-tolerant storage contract. Project it independently to telemetry, bill-grade metering, and structured hosted logging, each with its own delivery guarantees.

4. **MATERIAL — The proposed rollups cannot produce the Usage contract.**
   D5 promises DAU/WAU/MAU and weekly retention (`llp/0154-minimal-observability.rfc.md:319-321`), but D7 retains only one daily distinct-subject scalar (`llp/0154-minimal-observability.rfc.md:365-379`). Daily cardinalities cannot be combined into exact weekly/monthly unions or cohort intersections. Raw events cannot fill the gap because Usage “never scans raw events” and raw retention is seven days (`llp/0154-minimal-observability.rfc.md:361-377`). The phase boundary is also muddy: Usage ships in the main deliverable while `track()` is Phase 2.
   **Resolution:** Either drop WAU/MAU/retention and the Usage page from v1, or add a mathematically sufficient representation—mergeable sketches for unions and an explicit cohort representation for retention—with accuracy and privacy semantics. Use mergeable latency histograms if percentiles must aggregate across buckets.

5. **MATERIAL — Reset, restore, buffering, and cleanup lack one lifecycle model.**
   D1 says deleting the file is always safe and `app/reset` wipes it (`llp/0154-minimal-observability.rfc.md:184-191`), but a buffered producer can recreate the file with pre-reset events, and sibling-file deletion cannot be atomic with the app database reset. The current reset path is deliberately one carefully fenced durable transition (`src/server.rs:17116-17140`, `src/server.rs:17202-17310`). Restore behavior is not addressed at all. D4 also calls cleanup an LLP 0028 cron while requiring traffic-only activation (`llp/0154-minimal-observability.rfc.md:254-260`); LLP 0028’s declared policies are `always` or explicit live-demand gating, with scheduler state in the app database (`llp/0028-cron-scheduled-execution.rfc.md:265-310`).
   **Resolution:** Generation-bind every event to the app/database incarnation; fence and clear the buffer during reset/restore; query only the current generation; clean old generations opportunistically. Run cleanup and rollups inside the event-armed telemetry writer rather than through the application cron ledger.

6. **MATERIAL — The Phase-2 `track()` route violates the active route taxonomy and leaves identity/audit semantics unresolved.**
   An ordinary client is told to post to `/_snapback/api/telemetry/track` (`llp/0154-minimal-observability.rfc.md:339-347`), but LLP 0031 requires app-client operations at the root and reserves `/_snapback/api/*` for admin-gated system APIs (`llp/0031-server-route-taxonomy.spec.md:90-125`); the implementation enforces the same invariant (`src/server.rs:7118-7152`). Anonymous device activity also does not automatically merge with the later authenticated subject, so the claim that identity complexity “collapses” is incomplete. Finally, lossy `track()` must not be confused with LLP 0110’s atomic durable activity rows (`llp/0110-bounded-children-and-activity-patterns.spec.md:359-375`, `llp/0110-bounded-children-and-activity-patterns.spec.md:548-578`).
   **Resolution:** Give tracking a root app-data route or registered app-data operation with connection/session authority; explicitly declare it non-audit and best-effort; define anonymous-to-auth behavior; and preferably require source-declared event names/property schemas.

7. **MATERIAL — Cloudflare does not yet implement the supposedly stable Tier-1 contract.**
   Locally, Usage reads indefinitely retained rollup tables; D8 replaces the store with Analytics Engine and merely says the same routes query its SQL API (`llp/0154-minimal-observability.rfc.md:275-308`, `llp/0154-minimal-observability.rfc.md:388-400`). No equivalent rollup persistence, exactness, sampling/freshness marker, pagination contract, or reset incarnation is defined. OQ3 also proposes proxying an account-scoped token without resolving its custody (`llp/0154-minimal-observability.rfc.md:468-471`), while LLP 0072 sharply separates control-plane credentials from application-plane surfaces (`llp/0072-trusted-single-tenant-control-plane.rfc.md:155-174`).
   **Resolution:** Mark Cloudflare partial until a stable Tier-1 response contract is proven. Responses need exact/approximate, sampling, freshness, retention, and truncation facts. Keep account-scoped query authority in a control-plane gateway or another narrowly scoped binding, not an ordinary app-runtime secret.

8. **MATERIAL — The “query contract” is not specified deeply enough, and it names the wrong MCP seam.**
   D5 promises stable documented schemas but does not pin DTOs, ordering, cursor/filter binding, default windows, maximum work, partial-result behavior, freshness, drop counts, or error envelopes (`llp/0154-minimal-observability.rfc.md:267-308`). It also cites `src/guide_mcp.rs` as a tool surface, but that server intentionally exposes only read-only resources and rejects `tools/list` (`src/guide_mcp.rs:1-8`, `src/guide_mcp.rs:308-321`). The actual control MCP projects served operations one-to-one over host-ops (`packages/snapback-cli/mcp-control.mjs:1-8`, `packages/snapback-cli/mcp-control.mjs:444-479`).
   **Resolution:** Pin the Tier-1 request/response JSON Schemas and resource bounds in this RFC. Decide whether telemetry becomes LLP 0024 host operations—which fits the existing MCP—or whether the control MCP deliberately gains a second transport contract.

9. **MATERIAL — The capacity argument contains incorrect arithmetic and no target-scale proof.**
   One million requests/day is about 11.6 requests/second, not “~12 batched inserts/second” (`llp/0154-minimal-observability.rfc.md:381-384`). With 256 rows per batch it is about 0.045 full batches/second before accounting for multiple events per request. Conversely, the “three seconds after the most recent record” debounce can delay a continuous 1 event/second stream until 256 events accumulate—over four minutes. The RFC also gives no row-size, disk-footprint, retention-delete, percentile-query, or application-I/O interference measurement. The root LLP explicitly treats target scale as unproven until an acceptance workload and degradation behavior exist (`llp/0000-snapback.explainer.md:758-770`).
   **Resolution:** Correct the model and add a benchmark gate covering event amplification, sustained/burst traffic, file size, flush latency, cleanup/checkpoint stalls, query latency, drop behavior, and impact on app request latency. Flush after a maximum age from the first buffered event, not inactivity after the latest event.

10. **MINOR — C1 overstates current app-database behavior.**
    Not every internal commit bumps `_snapback_version`, journals `_snapback_changes`, and invokes live matching; for example, asset-system transactions commit directly (`src/storage.rs:1726-1743`), while ordinary mutation versioning is conditional on actual changed rows (`src/storage.rs:4075-4103`). The separate-file conclusion remains good, but its argument should be “same SQLite writer/file and a new infrastructure exception,” not “every commit necessarily journals and fans out.”

## 4. Design proposals

1. **Strong — Split the product into three phases.**
   Phase 1 should be the observability kernel: safe system events, recent local/container store, event-armed retention, Health and Events/Logs, Tier-1 JSON, CLI, and MCP. Phase 2 should add a proven hosted backend. Phase 3 should add declared product analytics, identity policy, Usage, and retention. Remove Usage and arbitrary SQL from Phase 1.

2. **Strong — Introduce one typed observation envelope with three projections.**
   Capture stable environment/release/incarnation identity, operation classification, admission and observation times, request/job correlation, outcome, duration, safe diagnostic identity, and optional subject. Project it to:

   - loss-tolerant local observability;
   - reliable, deduplicated metering;
   - structured hosted logs/export.

   This shares seams and semantics without pretending all three have the same reliability contract.

3. **Strong — Make app events declared, generated, and typed.**
   Prefer `defineTelemetry({ events: ... })` plus generated event references over arbitrary `track(name, props)`. A declared vocabulary makes cardinality genuinely bounded, enables field-level privacy review, gives agents exact types, and avoids `_other` silently swallowing unreviewed event names.

4. **Strong — Delete the remote SQL hatch from the paved path.**
   Tier-1 JSON plus NDJSON export answers the agent-first requirement safely. If local experts still need SQL, offer an explicitly local/offline CLI command that opens the telemetry file read-only with the repository’s hardened SQLite authorizer. Do not make native dialect divergence a public cross-arm contract.

5. **Strong — Simplify v1 aggregates.**
   Maintain mergeable counter and latency-histogram buckets. Ship request volume, errors, latency percentiles, jobs, connections, and drops. Defer distinct-user metrics until their identity, erasure, anonymous-linking, and aggregation algebra are specified.

6. **Moderate — Make lifecycle correctness generation-based rather than deletion-based.**
   Stamp every event with the current app/database incarnation. Reset and restore rotate the generation and clear the in-memory queue before new admissions; old generations become invisible immediately and are deleted opportunistically. This avoids pretending two SQLite files can reset atomically.

7. **Moderate — Make target variance explicit in Tier 1.**
   Every response should report store backend, exactness, sampling, freshness, raw-retention boundary, dropped count, and truncation. Cloudflare can then honestly remain partial without changing the stable data shape.

## 5. Open questions

- **OQ1 — Buffer policy:** Reserve capacity for failures and terminal job/connection outcomes; shed successful high-volume request events first. Prefer dropping oldest low-priority events so recent debugging survives. Count drops by kind, priority, and reason.

- **OQ2 — Track limits:** Do not ratify arbitrary numeric defaults yet. Require declared event schemas, per-event byte ceilings, per-connection and per-instance budgets, and a benchmark-derived target capability. Telemetry admission must not become billing authority.

- **OQ3 — Cloudflare query auth:** Keep the account-scoped credential in a control-plane telemetry gateway or narrowly scoped provider binding. Do not place a broad account token behind an app-serving route.

- **OQ4 — Retention ceiling:** Keep seven days as the default, but publish a target-specific hard ceiling. Hosted pricing may choose entitlements within that ceiling; commercial tiering should not define the storage safety bound.

- **OQ5 — Sessions:** Defer sessions and the weekly-retention tile. DAU plus operation counts are enough for the first operational slice; sessionization belongs with the later declared product-events phase.

- **OQ6 — Meter ordering:** Land the shared operation classification/envelope first. Metering and telemetry sinks can then land independently or together, but loss-tolerant telemetry must never supply billable totals.

- **OQ7 — SQL dialect:** Do not expose native dialect divergence. Keep arbitrary SQL local-only, or omit it entirely; Tier 1 should be the cross-arm contract.

- **Additional:** Which route classes count as application usage? Health probes, console polling, telemetry queries, static assets, and internal maintenance should be excluded explicitly through the versioned operation-class table.

- **Additional:** What is the subject deletion/rotation contract, and what happens when an anonymous device later authenticates? That decision is required before DAU/WAU/MAU claims.

## 6. Recommended next step

Revise the RFC to v0.3 while it remains Draft. The revision should:

1. replace C4/D2 with the shared-envelope-plus-independent-sinks model;
2. remove or fully sandbox Tier-3 SQL;
3. correct the data classification and route authorization;
4. narrow Phase 1 to Health and Events/Logs;
5. define generation-bound reset/restore and event-armed maintenance;
6. pin Tier-1 JSON Schemas and the hosted capability semantics; and
7. add a target-scale benchmark/acceptance matrix.

Then run a focused round-2 review over security, rollup algebra, and cross-arm semantics before moving to Review. Because this environment was read-only, I did not write the LLP 0005 review artifact; the review coordinator should preserve this response with Codex provenance if it is counted in the loop.
