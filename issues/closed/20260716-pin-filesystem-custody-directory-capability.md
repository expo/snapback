# Pin filesystem custody to a directory capability

**Status:** Closed
**Severity:** P2
**Systems:** Agent auth, Filesystem custody, Node, POSIX
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-16
**Closed:** 2026-07-17
**Related:** LLP 0055 §Grant-backed live and queued replay, LLP 0059 §Cross-context ownership
**Marker:** security, durability, hardening

The Node filesystem adapter validated owner/mode/ACL/link count, rejected
untrusted lexical symlinks and ancestor authority, pinned the canonical
directory device/inode across each pathname operation, bounded record I/O, and
rechecked around rename plus directory fsync. Node's path-based `fs/promises`
API could not retain one directory descriptor from validation through every
operation, leaving a precise same-uid directory-name ABA residual. A killed
writer could also leave bearer-free `0600` temporary debris.

**Done when:**

- Custody opens and retains one directory capability after owner/mode/ACL and
  device/inode validation.
- Lock, record, temporary-file, rename, fsync, and cleanup operations are
  relative to that capability (`openat2`/`renameat`/`unlinkat` or an equivalent
  audited helper), without resolving the configured pathname again.
- The SQLite lock is proven to live under the same pinned directory capability
  as the record being compared and replaced.
- Startup or under-lock maintenance removes only validated orphan files from
  the adapter's exact temporary namespace, with bounded count/bytes diagnostics.
- Fault tests exercise directory-name ABA before lock, before/after temp-file
  creation, before rename, and during failed cleanup, proving no split-brain
  commit and no leaked temporary custody record.

## Resolution

Closed 2026-07-17. `agent-authority-filesystem.mjs` now retains one dedicated
helper per validated custody directory. The helper compares the expected
device/inode/owner, changes into that exact inode once, and uses only derived
single-component names thereafter. Its POSIX CWD is a kernel-held directory
capability (`AT_FDCWD` semantics), so its relative SQLite `BEGIN IMMEDIATE`,
record reads, temporary creation, atomic rename, unlink, and directory fsync
cannot be redirected by replacing the configured pathname. The helper is both
lock owner and sole file actor; helper death removes both the lock and possible
stale writer, permanently closing that process's capability until restart.

Retained directory capabilities are bounded to 32 per process and never
idle-evicted. Under each primary or terminal-witness partition lock, cleanup
scans at most 4,096 entries and removes only strictly validated files from that
record's `<record>.<pid>.<128-bit-hex>.tmp` namespace, capped at 128 files and
8 MiB. Typed diagnostics cover directory-capability exhaustion, orphan-budget
exhaustion, and partial cleanup; `maintenanceSnapshot()` exposes the last
successful bounded receipt.

Verified with:

- `node demos/_kit/tests/agent-authority-filesystem.mjs`
- `node demos/_kit/tests/agent-authority-custody.mjs`
- `node scripts/check-guide.mjs`
- `./ref-check --verbose`

The fault suite covers directory ABA before lock, before and after temp create,
and before rename; helper-only SIGKILL plus fresh-process recovery; crash-orphan
cleanup; injected unlink failure and retry; the 129-file refusal boundary; and
the same cleanup contract for a terminal-witness partition.
