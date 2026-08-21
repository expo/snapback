# Unguarded durable writes: ordinary-caller reachable on expected-retirement paths

**Status:** Open — REACHABLE by ordinary callers; escalated 2026-08-21
**Filed:** 2026-08-21
**Found by:** sink-first audit in `lane/fenceproof` (`d291f4b89`)
**Governing:** LLP 0058 gate algorithm

## What was found

`AdmissionEffectGuard` holds the admission mutex across a durable commit so that
durable generation and admission epoch are checked **atomically at commit**. That
is what stops a write from landing after its admission epoch was retired.

The first audit starting from durable write SINKS — 144 explicit commit
occurrences across 115 functions, 62 bare-connection write-expression
candidates, 181 shared-helper call sites — reported **18 durable operations
that are downstream of a live admitted authority or admission lease but have
NO guard live at their durable cut.** Attempt 5 proved that number was only a
floor. Following every non-transaction receiver into its admitted callers
found a nineteenth operation: vector-query failure quarantine.

## Why it was invisible until now

Every previous audit started from the ~152 EXISTING `effect_guard` acquisitions
and classified them. **That direction cannot discover an unguarded write.** It
can only tell you about guards that already exist. The earlier coverage document
nonetheless described itself as a "complete durable-write inventory"; it was
complete over guards, not over durable writes.

Inverting the search — enumerate commits, then ask which have a guard — is what
surfaced this set.

## The 19 found

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
- **Streams** — stream-attempt upsert and transcript settlement are direct
  implicit-autocommit writes produced by an admitted action/stream invocation.
- **Vector queries** — `invoke_query_prepared_generation_with_facts` and the
  write-lane query path settle an opaque query failure through a registered
  vector writer. Writer-coverage failure can durably call
  `operation_ledger::break_operation_coverage_continuity`; successful opening
  reaches `vector::sqlite::quarantine_generation_for_schema_on` and its
  implicit-autocommit generation update. This is distinct from the operator
  vector-rebuild lane.

The vector-query operation is fixed on `lane/fenceproof`: both engine
settlement callers now hold the prepared invocation's exact admission guard
across registered-writer opening and quarantine. It has moved to Set 2 of the
coverage document pending its own removal-mutation proof. The other **18 remain
unfixed** and are still the active scope of this issue.

## Severity

Each is a durable effect that can land for an authority whose admission epoch
was retired between validation and commit — precisely the window LLP 0058's
fence exists to close, and precisely the property five recent deadlock fixes
worked to preserve elsewhere.

Reachability is demonstrated for the ordinary-caller families below. The
remaining job/watch cases are bounded or require global retirement, but still
violate the structural fence requirement recorded in the coverage document.

## Reachability settled — 2026-08-21

**Reachable by an ordinary caller: YES.** Ask reservation and settlement, all
owner-driven asset writes, and both stream writes can race an ordinary
`/auth/logout`. Service-principal variants can race ordinary grant revocation by
the owning user. Webhook transport and attempt settlement can race the ordinary
watch-delete or suspend endpoint. No operator action or induced race is needed.

**Reachable where retirement is expected: YES.** The strongest cases are Ask,
assets, and streams during logout; service credential and grant retirement; and
webhook delivery during deliberate watch cancellation. These are normal
security and lifecycle actions whose purpose is to stop precisely the effect
that can still land.

Put plainly: logout does not reliably stop in-flight quota consumption, asset
writes, or stream transcript retention, and watch cancellation does not
reliably stop webhook delivery settlement.

### What actually lands, by severity

1. **Ask spend reservation/settlement, asset-attempt creation, TUS progress** —
   move or consume quota and durable storage capacity. TUS additionally accepts
   bytes and progress under a stale caller identity.
2. **Stream transcript and attempt upsert** — transcript settlement can retain
   up to 256 KiB of final content plus token counts after retirement. Later
   reads still require the same initiator identity, which bounds exposure but
   does not prevent retention.
3. **Signed/strict receipts** — a false receipt lands, but URLs and bytes are
   not delivered after retirement because final HTTP publication rechecks the
   leaf. Public issuance writes nothing. Bounded.
4. **Job claim and remaining watch bookkeeping** — claim leases, dirty flags,
   retry/failure/dead/settlement records. These do not move money, expose data,
   or grant authority; later ordinary job staging rejects a retired epoch and
   cancellation makes matching watch settlement a no-op. Lower priority, and
   most require global mode retirement (a roughly 30-second operator
   transition) rather than ordinary caller-controlled retirement.

### Priority

The logout and revocation cases come first. They are ordinary-caller reachable,
need no race beyond normal concurrency, and defeat a control users are
explicitly told to rely on.

## Next

1. Assess each of the remaining 18 for actual reachability, hardest first — the watch
   cluster is the largest and most autonomous.
2. Add the fence engine-side, following the pattern established for
   capability-link mint/revoke/consume/settle and the push sites. Do NOT add it
   at the transport: that caused three separate re-entrant-mutex deadlocks.
3. Prove each with a removal mutation, per
   `issues/closed/20260821-admission-fences-unproven-by-mutation.md`.
