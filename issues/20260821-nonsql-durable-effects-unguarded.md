# Non-SQL durable effects: irreversible and external effects land unguarded

**Status:** Open
**Filed:** 2026-08-21
**Companion to:** `issues/20260821-unguarded-durable-writes-admission-fence.md` (22 SQLite-side families)

## Why this is worse than the SQLite set

The SQLite census covers effects a later refusal can at least contradict. These
cannot be rolled back by anything:

**Irreversible destruction — unguarded:**

- reset wipe (`crates/snapback-engine/src/local/engine.rs:6611`)
- owner-driven asset deletion and cleanup
  (`crates/snapback-services/src/assets.rs:874`, `engine.rs:12571`, `:13779`)

Protected-checkpoint deletion IS guarded; these two are not.

**External, non-rollbackable effects:**

- S3 PUT and DELETE (`crates/snapback-services/src/assets_s3.rs:666,783`)
- arbitrary mutating fetch (`crates/snapback-server/src/server.rs:1737`)
- Expo push (`crates/snapback-services/src/push.rs:72`)
- webhook delivery (`crates/snapback-services/src/webhooks.rs:135`)
- ask-provider submission (`crates/snapback-engine/src/ask.rs:318`)

Once the provider accepts, no local refusal undoes it.

**Persistent but not ordinarily external:** TUS staging bytes, canonical local
staging, auth/RQS keyrings, the fork-coverage sidecar, and diagnostic traces.
Later admission refusal does not roll these back either.

## The durable cut differs per subsystem

Unlike SQLite, where the cut is `tx.commit()`, here it is an fsync, a rename, an
S3 PUT acknowledgement, or a provider returning 2xx. Any fence must be live at
THAT point, not at some earlier local transaction.

Note the opt-in JSONL traces flush outside admission guards with no fsync, so
their crash durability is unconfirmed either way.

## Completeness boundary

Covers production source-visible non-SQL sinks in the current Rust workspace
reachable from `AdmissionLease`, `PreparedAuthority`, `PreparedInvocation`, or
`AdmittedJobClaim`: the complete `AssetStore` mutation interface and its
local/S3 implementations; direct owner-only file writes, renames, removals and
fsyncs on admitted chains; the operation-detail and fork-coverage sidecars;
admitted diagnostic appenders; and the direct production HTTP provider lanes for
fetch, push, webhook, ask, and S3.

**Examined and excluded** because they carry no app-admission carrier: scheduled
asset GC, startup creation of resume/completeness keyrings, and administrative
metadata/backup/fork/replication operations, whose host-operation contract
requires `prepared_authority: None`.

## Priority

The reset wipe and owner-driven asset deletion come first: they are
irreversible, and reset is precisely when authority is in transition. The
external provider lanes come next — for those, "fence it" may not be achievable
in the same sense, and the honest question is whether the effect can be
*withheld* until authority is confirmed rather than fenced at the moment it
becomes irreversible.
