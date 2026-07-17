# Bound or compact the Agent terminal-witness ledger

**Status:** Closed
**Severity:** P1
**Systems:** Agent auth, Durable custody, Filesystem storage, Operations
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-16
**Reopened:** 2026-07-17 (twice; latest reopening found post-retire owner reuse)
**Previously Closed:** 2026-07-17
**Closed:** 2026-07-17
**Related:** LLP 0055 §Grant-backed live and queued replay
**Marker:** durability, storage-growth, operations, crash-recovery

The fixed v2 bucket ledger bounded JSON records, but the first compaction
implementation removed only a migrated witness's `.json` record. Its SQLite
advisory-lock carrier remained forever, so tuple churn still created unbounded
physical files.

The first retirement fix still left the owner session usable after unlinking
its lock carrier. A callback could call `replace()` after `retire()` and
recreate an active JSON record with no discoverable lock. Killing the helper
after the lock unlink also exposed SQLite's live rollback-journal sidecar,
which the crash proof did not count. This reopens the ticket: retirement must
cleanly close SQLite before unlink, consume the owner/session, and prove that
no later operation can resurrect a lockless record.

## Resolution

Partition owners expose a distinct, consuming `retire(expectedRevision)`
operation with exact null-or-positive CAS semantics. Once filesystem retirement
is dispatched, the parent owner is terminal even if the helper refuses or a
physical boundary fails. Once physical retirement starts, the helper session is
also terminal. Read, replace, remove, scan, nested ownership, and repeated
retirement all reject with `SNAPBACK_AUTH_CUSTODY_LOCK_LOST`; only release is
allowed. The memory adapter mirrors successful and empty retirement, while CAS
refusal before retirement remains retryable.

Under the universal custody gate, the helper cleanly rolls back and closes
SQLite while the stable lock pathname still exists. That removes its rollback
journal before the helper unlinks and fsyncs the exact lock, then unlinks and
fsyncs the validated JSON record. A pre-close helper crash may leave the one
deterministic journal, but fresh SQLite ownership recovers and removes it.
Every post-close crash boundary is journal-free. Higher-level replay re-reads
the exact witness and chooses `retire(null)` for an already missing record or
the current positive revision for a present record; a positive expected
revision never acts as an idempotent wildcard.

The `legacyCut` cleanup seal is written only after all identified witnesses are
retired. A crash before the seal repeats migration; a post-cut candidate uses
its exact deterministic v1 ID and also retires an empty lock carrier, so misses
cannot regrow files.

Every conforming v1/v2 fence takes the same universal gate before a witness
partition. A cross-process proof holds that gate as an old writer, verifies v2
cannot enter retirement, then releases it and recovers. Direct adapter calls
that bypass the gate are explicitly outside the protocol.

Conforming v2 storage has fixed names for one gate, primary, root, at most 64
buckets, one 64-KiB temporary sidecar per partition, and one deterministic
SQLite rollback-journal name per live or recovering lock. LLP 0055 separately
accounts for opaque preexisting v1/corrupt residue that cannot be attributed
from its one-way filename hash.

## Verification

- Real helper crashes before/after SQLite close, after lock unlink, after the
  lock-directory fsync, and after JSON unlink all recover without resurrection.
  Every recovered state leaves no record, lock, or rollback journal.
- Memory and real-filesystem tests prove retirement consumes the current owner,
  every prohibited post-retire operation rejects deterministically, a missing
  record plus positive expected revision fails exact CAS, and a fresh owner is
  usable.
- The v1/v2 universal-gate exclusion test proves no conforming old writer can
  own the retired tuple lock concurrently.
- `node demos/_kit/tests/agent-authority-custody.mjs`
- `node demos/_kit/tests/agent-authority-filesystem.mjs`
- `node packages/snapback-contract/agent-authority-contract.test.mjs`
- `./ref-check --verbose`
- `git diff --check`
