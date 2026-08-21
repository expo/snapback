# Unguarded durable writes: ordinary-caller reachable on expected-retirement paths

**Status:** Open — REACHABLE by ordinary callers; escalated 2026-08-21
**Filed:** 2026-08-21
**Found by:** sink-first audit in `lane/fenceproof` (`d291f4b89`)
**Governing:** LLP 0058 gate algorithm

## What was found

`AdmissionEffectGuard` holds the admission mutex across a durable commit so that
durable generation and admission epoch are checked **atomically at commit**. That
is what stops a write from landing after its admission epoch was retired.

An audit starting from durable write SINKS — 144 explicit commit occurrences
across 115 functions, 62 bare-connection write expressions, 181 shared-helper
call sites — found **18 durable operations that are downstream of a live
admitted authority or admission lease but have NO guard live at their durable
cut.**

## Why it was invisible until now

Every previous audit started from the ~152 EXISTING `effect_guard` acquisitions
and classified them. **That direction cannot discover an unguarded write.** It
can only tell you about guards that already exist. The earlier coverage document
nonetheless described itself as a "complete durable-write inventory"; it was
complete over guards, not over durable writes.

Inverting the search — enumerate commits, then ask which have a guard — is what
surfaced this set.

## The 18

Grouped by subsystem; each is individually assessed in
`issues/20260821-complete-admission-effect-guard-commit-proof-coverage.md`.

- **Ask spend** — reservation (server drops `PreparedAuthority` before the budget
  reservation commits) and settlement (finalizes the same admitted API effect
  after provider work without reacquiring the fence).
- **Assets** — upload-attempt creation, cancellation, TUS patch/ingest state,
  explicit delete, and signed-URL issuance / strict-delivery receipts. Several
  accept `PreparedAuthority` and then commit without guarding it. A retired epoch
  must not accept late durable upload progress.
- **Jobs** — initial one-off claim: `claim_due_jobs` obtains `first_admission`
  before the durable claim but never turns it into an effect guard.
- **Watches** — evaluation begin (implicit-autocommit write before any guard),
  dead-state transition, decision/enqueue, retry/failure record, firing
  settlement, webhook reservation, webhook attempt settlement, and
  invalidation-driven scheduling. This is the largest cluster: the watch
  evaluation and webhook delivery path is admitted work whose durable results
  commit outside any fence.

## Severity

Each is a durable effect that can land for an authority whose admission epoch
was retired between validation and commit — precisely the window LLP 0058's
fence exists to close, and precisely the property five recent deadlock fixes
worked to preserve elsewhere.

Reachability has NOT been demonstrated per operation. The finding is structural:
the guard is absent where the argument for requiring it is the same as for the
paths that have it. Treat "is it exploitable" as the next question, not as a
reason to defer.

## Next

1. Assess each of the 18 for actual reachability, hardest first — the watch
   cluster is the largest and most autonomous.
2. Add the fence engine-side, following the pattern established for
   capability-link mint/revoke/consume/settle and the push sites. Do NOT add it
   at the transport: that caused three separate re-entrant-mutex deadlocks.
3. Prove each with a removal mutation, per
   `issues/closed/20260821-admission-fences-unproven-by-mutation.md`.


## Reachability settled — 2026-08-21

The original filing marked reachability as NOT demonstrated. It now is, and the
answer is worse than structural.

**Reachable by an ordinary caller: YES.** Ask reservation and settlement, all
owner-driven asset writes, and both stream writes can race an ordinary
`/auth/logout`. Service-principal variants can race ordinary grant revocation by
the owning user. Webhook transport and attempt settlement can race the ordinary
watch-delete or suspend endpoint. No operator action or induced race is needed.

**Reachable where retirement is EXPECTED: YES.** The strongest cases are Ask,
assets and streams during logout; service credential and grant retirement; and
webhook delivery during deliberate watch cancellation. These are normal security
and lifecycle actions whose entire purpose is to stop precisely the effect that
can still land.

Put plainly: logout does not reliably stop in-flight quota consumption, asset
writes, or stream transcript retention, and watch cancellation does not reliably
stop webhook delivery settlement.

### What actually lands, by severity

1. **Ask spend reservation/settlement, asset-attempt creation, TUS progress** —
   move or consume quota and durable storage capacity. TUS additionally accepts
   bytes and progress under a stale caller identity.
2. **Stream transcript and attempt upsert** — transcript settlement can retain
   up to 256 KiB of final content plus token counts after retirement. Later
   reads still require the same initiator identity, which bounds exposure but
   does not prevent retention.
3. **Signed/strict receipts** — a false receipt lands, but URLs and bytes are
   NOT delivered after retirement because final HTTP publication rechecks the
   leaf. Public issuance writes nothing. Bounded.
4. **Job claim and remaining watch bookkeeping** — claim leases, dirty flags,
   retry/failure/dead/settlement records. These do not move money, expose data,
   or grant authority; later ordinary job staging rejects a retired epoch and
   cancellation makes matching watch settlement a no-op. Lower priority, and
   most require GLOBAL mode retirement (a ~30s operator transition) rather than
   an ordinary caller-controlled retirement.

### Count correction

18 is a FLOOR. A nineteenth was found after filing: an admitted vector-query
write via `settle_vector_query_failure` → `quarantine_generation_for_schema_on`
→ implicit-autocommit `conn.execute`
(`crates/snapback-kernel/src/vector/sqlite.rs:567`), reached from
`crates/snapback-engine/src/local/engine.rs:30515` with the admitted
`PreparedInvocation` live. The sink census is not complete for
implicit-autocommit and bare-connection writes; that enumeration is in progress.

### Priority

The logout and revocation cases come first. They are ordinary-caller reachable,
need no race beyond normal concurrency, and defeat a control users are
explicitly told to rely on.


## Census extended and bounded — 2026-08-21

A systematic sweep of NON-`tx.commit()` durable writes extends the set from 19
to **22 operation families** (23 sinks; coverage-gap persistence writes both
SQLite and, when fork evidence exists, a synced sidecar).

Three new families:

1. **Derived-fork egress-denial marker** — `LocalIbexActionHost` holds a
   `PreparedAuthority` and records the denial at `deny_derived_fork_host_op`,
   opening its own registered writer and autocommitting
   (`crates/snapback-kernel/src/storage/connections.rs:467`), **then validates
   admission afterwards** (`engine.rs:4277`). The request is always refused, so
   severity is bounded — it updates a capped attempt count and first/last
   timestamps — but the write genuinely precedes validation.
2. **Registered-writer coverage-gap persistence.**
3. **Post-reset cron-state persistence.**

### Completeness boundary — stated, not claimed

This census is now **source-complete for**: production SQLite logical
mutations, raw SQL commits, write-capable PRAGMAs, SQLite backup destinations,
bare-`Connection` helpers, and internally opened SQLite writers visible in the
reviewed source. It remains a source census, not compiler-enforced effect
analysis; dynamically generated or macro-hidden SQL is an acknowledged
INFERRED boundary.

It is **NOT complete for the broader non-SQL durability class.** Systematically
unexamined: filesystem and secure-file publication, removal and rename;
asset-store local and S3 operations; and external-provider effects. Concrete
examples already visible:

- `AssetStore::wipe_all` at reset time, **outside** the reset transaction guard
  (`crates/snapback-engine/src/local/engine.rs:8645`) — a destructive operation
  worth assessing on its own merits
- owner-only secure-file writes and fsyncs
  (`crates/snapback-kernel/src/secure_file.rs:291`)
- the asset store's durable mutation interface
  (`crates/snapback-kernel/src/assets_store.rs:48,94,110`)

That class needs its own sweep. Until then, 22 is the SQLite-side total and the
overall total is unknown — which is the honest statement, and better than the
two earlier versions of this census that claimed completeness they did not have.
