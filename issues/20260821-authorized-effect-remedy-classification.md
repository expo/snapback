# Authorized-effect remedy classification (22 SQLite families + non-SQL)

Status: Open
Created: 2026-08-21
Related: LLP 0283 F-1, issues/20260821-unguarded-durable-writes-admission-fence.md,
issues/20260821-nonsql-durable-effects-unguarded.md,
issues/closed/20260821-authorized-effect-fence-design.md

## Why this exists

The "22 unguarded durable-write families" census counted *sites*, not *remedies*.
It therefore implied ~19 split-phase fences of remaining work. That figure is
wrong, and planning against it would have overbuilt.

There are two distinct remedies:

- **Mode guard** (`PreparedAuthority::effect_guard`) — fences global
  mode-epoch retirement. Already exists and is correct where mode retirement is
  the only thing that can invalidate the caller mid-flight.
- **Split-phase reservation** — reserves the session/service publication
  outside `LocalSnapback` and retains it through durable commit. Needed only
  where a *live caller authority* (session logout/expiry, scoped-service
  grant/credential retirement) can retire mid-flight.

A site needs split-phase only if a live caller authority can retire mid-flight.
Most cannot: job, watch and webhook contexts reconstruct credential-free
execution authority and carry no session publication at all.

## Result

Of the 22 SQLite families: **8 both, 12 mode-only, 2 neither.**
Of the **19 still unguarded**: **7 need split-phase, 10 need only the existing
mode guard, 2 should not be fenced.**

Of the **14 landed fences**: **9 have a live-authority branch and need
migration; 5 are correctly mode-only.**

### Needs split-phase (7 unguarded families)
Assets: attempt creation, cancellation, TUS state, explicit delete,
signed/strict-delivery receipts (5). Streams: caller-backed attempt
start/progress, content-bearing transcript settlement (2).

### Needs mode guard only (10)
Initial one-off job claim; seven watch-job families (evaluation begin, dead
transition, decision/enqueue, retry/failure, firing settlement/retry, webhook
reservation, webhook settlement); derived-fork egress-denial marker;
registered-writer coverage-gap persistence on admitted paths.

### Needs neither (2)
Invalidation-driven watch scheduling (explicitly an internal consequence of an
already-durable mutation, and documented as needing to advance even if the
caller's lease ends immediately after COMMIT); post-reset cron-state
persistence (post-commit diagnostic continuation).

### Landed fences needing migration (9)
Capability mint, capability revoke, push reservation / batch claim /
transmitting marker (live-authority `Immediate` branch only), client-mutation
acknowledgement (session branch; the service branch already revalidates),
watch creation, agent-invitation mint, Ask spend reservation.

Correctly mode-only, no migration: capability consume, capability settlement,
push settlement, OAuth dynamic registration, Ask spend settlement, and the
vector-quarantine fence.

## Non-SQL: mostly not a fencing problem

For irreversible and external effects the remedy is **withholding**, not
fencing — fencing the moment of irreversibility is too late. Withhold until a
caller-backed durable transition is authoritatively accepted; after that the
durable record (planned publication, tombstone, condemnation, claimed job) is
the authority and no second live-session check belongs at the physical cut.

Withhold: owner asset deletion, S3 PUT, S3 DELETE, mutating fetch, Expo push,
webhook delivery, Ask-provider submission, TUS staging bytes, canonical local
staging/blob publication.
Neither: reset wipe, auth keyring publication, RQS resume keyring, diagnostic
JSONL traces.

## Open semantic rulings (not accidental exemptions)

These are classified `INFERRED` — control flow is source-verified but the
semantic ownership is not explicitly decided or regression-proven. They should
be ruled on deliberately:

1. **Terminal accounting.** Ask settlement, push settlement and capability-use
   settlement are classified mode-only because they truthfully settle an
   already-caused outcome; suppressing them after logout would make handoff
   truth ambiguous. This is a ruling, not an exemption.
2. **Stream terminal semantics.** Content-bearing transcript publication is
   caller-authorized; attempt terminalization/recovery bookkeeping is
   host-owned. A blanket treatment of the family gets one side wrong.
3. **External initiation** needs an explicit authority-to-send withholding
   rule. Webhook is distinct: its authority is watch/job state, not a session.
4. **Asset non-SQL cuts** need the lifecycle point that discharges withholding
   stated explicitly.

## Provenance

Source-grounded classification produced by a read-only codex analysis against
`origin/main` at `1ab419ea1`. Full report with per-site file:line citations
appended below.

---

The remaining SQLite work is materially smaller than “19 split-phase fences”:

- Of the 22-family census: **8 need both**, **12 need mode only**, **2 need neither**.
- Of the **19 still unguarded**, only **7 need split-phase**, **10 need the existing mode guard only**, and **2 should not be fenced**.
- A migration round is still needed for the landed sites, but only **9 of the 14 named landed fences** have a live-authority branch. The other five are correctly mode-only. The vector fence is also correctly mode-only.

`INFERRED` below means the carrier/control flow is source-verified, but the semantic ownership of the effect is not explicitly decided or regression-proven.

The baseline distinction is source-clear: `PreparedAuthority` carries session/service publications, but `effect_guard` delegates only to the admission lease ([invocation.rs:1195](crates/snapback-sync/src/auth/invocation.rs:1195), [invocation.rs:1608](crates/snapback-sync/src/auth/invocation.rs:1608)); that guard locks only the mode controller through the effect ([admission.rs:947](crates/snapback-auth/src/auth/admission.rs:947)).

## The 22 SQLite-side families

| Operation | What can retire its authority mid-flight | Remedy | Confidence |
|---|---|---:|---|
| Ask spend reservation | Ordinary session logout/expiry; scoped-service retirement too. This is a direct Ask route carrying `PreparedAuthority`, not the ordinary mutation path that revalidates service authority ([server.rs:25234](crates/snapback-server/src/server.rs:25234), [engine.rs:5817](crates/snapback-engine/src/local/engine.rs:5817)). | **Both** | High |
| Ask spend settlement | Global mode retirement. After provider work, the authoritative facts are the durable spend reservation and actual provider outcome; logout should not erase or strand that accounting ([server.rs:25287](crates/snapback-server/src/server.rs:25287), [engine.rs:5846](crates/snapback-engine/src/local/engine.rs:5846)). | **Mode** | Medium — **INFERRED** |
| Asset upload-attempt creation | Session logout/expiry and service grant/credential retirement. The direct endpoint passes `PreparedAuthority`; asset callers include session and service principals, and the commit follows without ordinary-mutation service revalidation ([asset_routes.rs:84](crates/snapback-server/src/server/asset_routes.rs:84), [engine.rs:11526](crates/snapback-engine/src/local/engine.rs:11526), [engine.rs:11725](crates/snapback-engine/src/local/engine.rs:11725)). | **Both** | High |
| Asset cancellation | Session/service retirement before the terminal transition; physical cleanup becomes cancellation-owned after that transition ([asset_routes.rs:121](crates/snapback-server/src/server/asset_routes.rs:121), [engine.rs:12705](crates/snapback-engine/src/local/engine.rs:12705)). | **Both** | High |
| Asset TUS patch/ingest state | Session/service retirement can occur between preflight, unlocked byte append, and the acknowledgement CAS ([asset_routes.rs:269](crates/snapback-server/src/server/asset_routes.rs:269), [asset_routes.rs:291](crates/snapback-server/src/server/asset_routes.rs:291), [asset_routes.rs:309](crates/snapback-server/src/server/asset_routes.rs:309)). | **Both** | High |
| Asset explicit delete | Session/service retirement before the tombstone transaction. After that transition, store cleanup is lifecycle-owned ([asset_routes.rs:598](crates/snapback-server/src/server/asset_routes.rs:598), [engine.rs:13925](crates/snapback-engine/src/local/engine.rs:13925)). | **Both** | High |
| Signed-URL issuance / strict-delivery receipts | Session/service retirement can invalidate the caller before the receipt/issuance commit. Later response publication checking does not make a false durable receipt acceptable ([asset_routes.rs:337](crates/snapback-server/src/server/asset_routes.rs:337), [asset_routes.rs:485](crates/snapback-server/src/server/asset_routes.rs:485), [engine.rs:13794](crates/snapback-engine/src/local/engine.rs:13794)). | **Both** | High |
| Initial one-off job claim | Only global mode retirement. It creates a fresh `AdmissionLease`; there is no session publication attached to the claim ([engine.rs:1745](crates/snapback-engine/src/local/engine.rs:1745), [engine.rs:22574](crates/snapback-engine/src/local/engine.rs:22574)). | **Mode** | High |
| Watch evaluation begin | Only global mode retirement. Watch execution explicitly reconstructs credential-free authority and validates current watch/job state ([engine.rs:22992](crates/snapback-engine/src/local/engine.rs:22992), [engine.rs:23018](crates/snapback-engine/src/local/engine.rs:23018), [watches.rs:667](crates/snapback-kernel/src/storage/watches.rs:667)). | **Mode** | High |
| Watch dead-state transition | Only the job’s global mode lease. Principal/grant death is the reason for this terminal write, not an authority that should suppress it ([engine.rs:23045](crates/snapback-engine/src/local/engine.rs:23045)); grant revocation atomically marks matching watches dead and clears pending state ([watches.rs:1211](crates/snapback-kernel/src/storage/watches.rs:1211)). | **Mode** | High |
| Watch evaluation decision/enqueue | Global mode only. Cancellation/grant revocation is handled through current `status` and `pending_job_id` checks in the same transaction ([watches.rs:687](crates/snapback-kernel/src/storage/watches.rs:687), [watches.rs:725](crates/snapback-kernel/src/storage/watches.rs:725)). | **Mode** | High |
| Watch retry/failure | Global mode only. This is job-result bookkeeping under the claimed job, with no retained session. | **Mode** | High |
| Watch firing settlement/retry | Global mode only. Its authority is the claimed firing/job and freshly revalidated watch owner/grant; cancellation is represented by current-row/CAS state. | **Mode** | High |
| Watch webhook reservation | Global mode only. The authority is the active watch, pending firing, revalidated owner/anchor and claimed job—not the session that originally created the watch. | **Mode** | High |
| Watch webhook-attempt settlement | Global mode only. The webhook attempt is a truthful provider outcome; cancellation cannot undo a request already sent, and watch firing settlement observes current state ([server.rs:3443](crates/snapback-server/src/server.rs:3443)). | **Mode** | Medium — **INFERRED** |
| Invalidation-driven watch scheduling | Nothing in the admission hierarchy. It is explicitly an internal consequence of an already-durable mutation and “must advance even if the caller’s admission lease ends immediately after COMMIT” ([engine.rs:16659](crates/snapback-engine/src/local/engine.rs:16659)). Local serialization still orders reset/replacement. | **Neither** | High |
| Stream-attempt upsert | Mixed. Required start/progress writes from an ordinary detached action retain its original session/service `PreparedAuthority`, but `lock_live` checks only abandonment, generation and deadline ([server.rs:744](crates/snapback-server/src/server.rs:744), [server.rs:1046](crates/snapback-server/src/server.rs:1046), [server.rs:1188](crates/snapback-server/src/server.rs:1188)). Trusted terminal/recovery flushes are explicitly host-owned after abandonment ([server.rs:1069](crates/snapback-server/src/server.rs:1069)). | **Both** for caller-backed start/progress; mode/neither for trusted terminal/recovery | Medium — **INFERRED** |
| Stream-transcript settlement | Content-bearing settlement retains the caller’s result and initiator after detached execution, so session/service retirement remains relevant ([server.rs:912](crates/snapback-server/src/server.rs:912), [server.rs:943](crates/snapback-server/src/server.rs:943)). Pure terminal bookkeeping without retained content is mode-only. | **Both** for content-bearing settlement | Medium — **INFERRED** |
| Vector-query failure quarantine | Only global mode retirement. Both callers now correctly hold the mode guard across registered-writer opening and quarantine ([engine.rs:30776](crates/snapback-engine/src/local/engine.rs:30776), [engine.rs:35246](crates/snapback-engine/src/local/engine.rs:35246)). | **Mode** | High |
| Derived-fork egress-denial marker | Global mode/generation can retire the app context. Session logout should not suppress a bounded security record for a refused egress attempt; the marker currently precedes admission validation ([engine.rs:4288](crates/snapback-engine/src/local/engine.rs:4288), [engine.rs:4307](crates/snapback-engine/src/local/engine.rs:4307), [connections.rs:460](crates/snapback-kernel/src/storage/connections.rs:460)). | **Mode** | Medium — **INFERRED** |
| Registered-writer coverage-gap persistence | For admitted vector/derived callers, only global mode/generation. The effect is store-integrity evidence, not caller-owned session data. Operator/lifecycle writer openings have no app admission authority ([connections.rs:36](crates/snapback-kernel/src/storage/connections.rs:36), [connections.rs:172](crates/snapback-kernel/src/storage/connections.rs:172), [connections.rs:377](crates/snapback-kernel/src/storage/connections.rs:377)). | **Mode** for admitted callers; neither for operator callers | Medium — **INFERRED** |
| Post-reset cron-state persistence | Nothing. The reset is already committed, the managed handoff remains closed, and cron persistence is explicitly diagnostic-only post-commit continuation ([server.rs:23905](crates/snapback-server/src/server.rs:23905), [engine.rs:8893](crates/snapback-engine/src/local/engine.rs:8893)). | **Neither** | High |

## The landed fences

A migration round is required, but not for all 14 named sites.

| Landed site | Actual authority | Correct remedy |
|---|---|---:|
| Capability-link mint | Exact management session ([engine.rs:5203](crates/snapback-engine/src/local/engine.rs:5203)). Logout/expiry can retire it. | **Both — migrate** |
| Capability-link revoke | Exact management session ([engine.rs:5284](crates/snapback-engine/src/local/engine.rs:5284)). | **Both — migrate** |
| Capability-link consume | The public capability-link bearer is the credential; the route installs no caller session authority ([server.rs:10746](crates/snapback-server/src/server.rs:10746)). Revocation and consumption serialize through current link state. | **Mode — correct** |
| Capability-link settlement | The consumed-use record is the authority for truthful outcome settlement; later link revocation should not erase the outcome. | **Mode — correct**, **INFERRED** |
| Push reservation | Immediate calls retain session/service authority; System/Deferred calls do not ([server.rs:2099](crates/snapback-server/src/server.rs:2099)). | **Both for Immediate; mode for System/Deferred — migrate live-authority branch** |
| Push batch claim | Same mixed action authority; claim occurs before the external-effect authority check ([server.rs:2136](crates/snapback-server/src/server.rs:2136)). | **Both for Immediate; mode for System/Deferred — migrate live-authority branch** |
| Push transmitting marker | Immediate session authority can retire before the transmitting cut; current code explicitly checks service authority but has no session equivalent ([server.rs:2144](crates/snapback-server/src/server.rs:2144)). | **Both for Immediate; mode for System/Deferred — migrate live-authority branch** |
| Push settlement | Authority is the transmitting claim plus provider outcome; suppressing settlement after logout would make handoff truth ambiguous ([server.rs:2159](crates/snapback-server/src/server.rs:2159), [engine.rs:6073](crates/snapback-engine/src/local/engine.rs:6073)). | **Mode — correct**, **INFERRED** |
| OAuth dynamic registration | Pre-auth route admission only; `Authorization` is expressly rejected ([oauth.rs:157](crates/snapback-server/src/server/oauth.rs:157), [oauth.rs:166](crates/snapback-server/src/server/oauth.rs:166)). | **Mode — correct** |
| Client-mutation acknowledgement | Session branch can logout. The service branch already performs exact service revalidation under the app lock before the guarded commits ([engine.rs:10559](crates/snapback-engine/src/local/engine.rs:10559)). | **Both for session; current service revalidation remains sufficient — migrate** |
| Watch creation | Session or scoped integration management authority ([engine.rs:22650](crates/snapback-engine/src/local/engine.rs:22650)); this direct path does not enter the ordinary mutation revalidation seam. | **Both — migrate** |
| Agent-invitation mint | Exact inviter session plus step-up proof ([server.rs:14790](crates/snapback-server/src/server.rs:14790), [server.rs:14833](crates/snapback-server/src/server.rs:14833)). | **Both — migrate** |
| Ask spend reservation | Live session/service request authority. | **Both — migrate** |
| Ask spend settlement | Durable reservation/provider-result accounting. | **Mode — correct**, **INFERRED** |

Therefore:

- **9 of 14** landed sites have a split-phase branch and need migration.
- **5 of 14** are correctly mode-only.
- Of the original twelve before Ask, **8 have a split branch**; Ask reservation is the ninth.
- The already-landed vector quarantine fence is also correctly mode-only.

## Detached and job contexts

- **Initial job claims:** fresh `AdmissionLease`, no session publication.
- **Watch evaluation/reaction/webhook work:** no originating session survives. Watch management deliberately reconstructs credential-free execution authority ([invocation.rs:1426](crates/snapback-sync/src/auth/invocation.rs:1426)); user watches revalidate the principal, and integration watches revalidate the durable anchor/grant.
- **Webhook transport:** authority is `{active watch, matching pending firing/job, active owner or integration anchor, current functions}`. The revalidation occurs before delivery, but the send follows after releasing `LocalSnapback` ([server.rs:3443](crates/snapback-server/src/server.rs:3443)). There is no session publication to reserve.
- **Detached ordinary actions:** unlike watch jobs, these retain the original `PreparedAuthority` ([server.rs:756](crates/snapback-server/src/server.rs:756), [server.rs:770](crates/snapback-server/src/server.rs:770)). Streams, immediate push, and fetch can therefore remain session-backed.
- **System/deferred push:** authority is System plus the durable push/deferred grant, not a session.
- **Invalidation scheduling:** authority is the already-committed mutation consequence.
- **Post-reset work:** authority is the committed reset plus the still-closed reset handoff.

## Non-SQL effects

| Effect | Actual authority and retirement | Remedy | Confidence |
|---|---|---:|---|
| Reset wipe | After the reset transaction commits, the files are unreferenced by construction and the wipe is reset-owned best-effort continuation ([engine.rs:8728](crates/snapback-engine/src/local/engine.rs:8728), [engine.rs:8740](crates/snapback-engine/src/local/engine.rs:8740)). No session exists; a later mode change should not suppress cleanup. | **Neither** | High |
| Owner asset deletion/cleanup | Before the tombstone/cancel transition, session/service authority can retire. After that durable transition, the delete is lifecycle-owned ([engine.rs:13935](crates/snapback-engine/src/local/engine.rs:13935), [engine.rs:13938](crates/snapback-engine/src/local/engine.rs:13938)). | **Withhold** until the deletion transition is authoritatively committed; no second live-session fence at physical deletion | High |
| S3 PUT | The irreversible PUT follows a durable `planned` publication record ([engine.rs:13224](crates/snapback-engine/src/local/engine.rs:13224), [engine.rs:13248](crates/snapback-engine/src/local/engine.rs:13248)); the provider cut is the actual PUT acknowledgement ([assets_s3.rs:666](crates/snapback-services/src/assets_s3.rs:666)). | **Withhold** until the caller-backed plan is authoritatively accepted; afterward the durable plan is the authority | High |
| S3 DELETE | Reviewed production deletes follow cancellation, tombstone, condemned-publication or GC state; scheduled GC has no app admission carrier ([engine.rs:13519](crates/snapback-engine/src/local/engine.rs:13519), [engine.rs:13648](crates/snapback-engine/src/local/engine.rs:13648), [assets_s3.rs:783](crates/snapback-services/src/assets_s3.rs:783)). | **Withhold**, currently discharged by durable lifecycle state; no session reservation at DELETE | High |
| Arbitrary mutating fetch | Ordinary detached actions retain session/service authority; job/System actions do not. The irreversible cut is `call`/`send_string` ([server.rs:2035](crates/snapback-server/src/server.rs:2035), [server.rs:2041](crates/snapback-server/src/server.rs:2041)). | **Withhold** | High |
| Expo push | Immediate action authority may be session/service; System/Deferred uses durable system/grant authority. Provider acceptance is external and non-rollbackable ([server.rs:2151](crates/snapback-server/src/server.rs:2151), [push.rs:72](crates/snapback-services/src/push.rs:72)). | **Withhold** | High |
| Webhook delivery | No session. Authority is the current active watch, claimed job/firing and revalidated owner/anchor. Revalidation and the actual HTTP send are separated ([server.rs:3443](crates/snapback-server/src/server.rs:3443), [webhooks.rs:114](crates/snapback-services/src/webhooks.rs:114)). | **Withhold** | High |
| Ask-provider submission | Live session/service authority plus the spend reservation. Each provider call is an irreversible external cut ([server.rs:24803](crates/snapback-server/src/server.rs:24803), [ask.rs:318](crates/snapback-engine/src/ask.rs:318)). | **Withhold** | High |
| TUS staging bytes | Live caller authority plus the exact attempt/offset ticket. Append and sync occur after preflight but outside `LocalSnapback` ([asset_routes.rs:291](crates/snapback-server/src/server/asset_routes.rs:291)). | **Withhold** | High |
| Canonical local staging/blob publication | Caller-backed Phase A creates a durable planned publication; the filesystem put then runs without the database lock ([assets.rs:626](crates/snapback-services/src/assets.rs:626), [assets.rs:629](crates/snapback-services/src/assets.rs:629)). | **Withhold** until the plan is authoritatively accepted | High |
| Auth keyring publication | Global auth infrastructure, not caller/session-owned. It has its own mutex and atomic rename/parent-sync protocol ([keyring.rs:90](crates/snapback-kernel/src/auth/keyring.rs:90), [keyring.rs:626](crates/snapback-kernel/src/auth/keyring.rs:626)). Session logout must not suppress rotation. | **Neither** | High |
| RQS resume keyring | Internal availability-only sidecar; key loss merely refuses old resume tokens ([rqs.rs:920](crates/snapback-sync/src/rqs.rs:920), [rqs.rs:1265](crates/snapback-sync/src/rqs.rs:1265)). | **Neither** | High |
| Fork-coverage sidecar | Admitted vector/derived writer opening is mode/generation-bound; operator lifecycle openings have no caller authority. The sidecar is durable integrity evidence ([connections.rs:36](crates/snapback-kernel/src/storage/connections.rs:36), [connections.rs:73](crates/snapback-kernel/src/storage/connections.rs:73)). | **Mode** for admitted opening; neither for operator opening | Medium — **INFERRED** |
| Diagnostic JSONL traces | Observability derived from attempted/completed work, not an authorized application effect. The writers flush without fsync ([spike_trace.rs:57](crates/snapback-sync/src/spike_trace.rs:57), [spike_trace.rs:73](crates/snapback-sync/src/spike_trace.rs:73)); crash durability is expressly unconfirmed ([non-SQL issue:40](issues/20260821-nonsql-durable-effects-unguarded.md:40)). | **Neither** | Low — **INFERRED** |

## Sequencing lists

### Needs split-phase

1. **Existing migration:** capability mint, capability revoke, push reservation/claim/transmitting on live-authority branches, client acknowledgement, watch creation, invitation mint, Ask reservation — **9 landed sites/branches**.
2. **Remaining assets:** attempt creation, cancellation, TUS state, explicit delete, signed/strict receipt family — **5 families**.
3. **Remaining streams:** caller-backed stream-attempt start/progress and content-bearing transcript settlement — **2 families**.

That is **7 of the 19 currently unguarded families**, not 19.

### Needs mode guard only

1. Initial one-off job claim.
2. Seven watch-job families: evaluation begin, dead transition, decision/enqueue, retry/failure, firing settlement/retry, webhook reservation, webhook settlement.
3. Derived-fork egress marker.
4. Registered-writer coverage-gap persistence on admitted paths.
5. Already correct: vector quarantine, OAuth dynamic registration, capability consume/settle, push settlement, Ask settlement.

### Needs neither

1. Invalidation-driven watch scheduling.
2. Post-reset cron-state persistence.

### Needs a design answer rather than another SQLite fence

1. External initiation: mutating fetch, Expo, webhook and each Ask-provider submission need an authority-to-send withholding rule. Webhook is distinct because its authority is watch/job state, not a session.
2. Asset non-SQL cuts: TUS append, canonical/S3 PUT, and physical deletion need the lifecycle point that discharges withholding stated explicitly. Existing planned/tombstone/condemnation states appear to provide that authority once their caller-backed transition is properly fenced.
3. Stream terminal semantics: content-bearing transcript publication is caller-authorized; attempt terminalization/recovery bookkeeping is host-owned. A blanket treatment of the family would get one side wrong.
4. Terminal accounting semantics: the mode-only classification for Ask, push and capability-use settlement is **INFERRED** from their role as truthful settlement of an already-caused outcome and should be treated as a deliberate semantic ruling, not as an accidental exemption.

No files were modified.