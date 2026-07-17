# Pin filesystem custody to a directory capability

**Status:** Open
**Severity:** P2
**Systems:** Agent auth, Filesystem custody, Node, POSIX
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-16
**Related:** LLP 0055 §Grant-backed live and queued replay, LLP 0059 §Cross-context ownership
**Marker:** security, durability, hardening

The Node filesystem adapter now validates owner/mode/ACL/link count, rejects
untrusted lexical symlinks and ancestor authority, pins the canonical directory
device/inode across every operation, bounds record I/O, and rechecks around
rename plus directory fsync. Node's path-based `fs/promises` API still cannot
hold one directory descriptor from validation through `openat`/`renameat`/
`unlinkat`. A malicious same-uid process with precise pathname ABA timing may
therefore be able to split the validated directory, SQLite lock inode, and
later record pathname. Same-uid malicious mutation is outside the adapter's
current claim, but a native capability path can remove that residual.

A process killed after creating a private temporary record but before rename can
also leave a bearer-free `0600` orphan. This is not an authority leak, but the
capability migration should make cleanup bounded and unambiguous instead of
letting crash debris accumulate.

**Done when:**

- Custody opens and retains one directory capability after owner/mode/ACL and
  device/inode validation.
- Lock, record, temporary-file, rename, fsync, and cleanup operations are
  relative to that capability (`openat2`/`renameat`/`unlinkat` or an equivalent
  audited native helper), without resolving the configured pathname again.
- The SQLite lock is proven to live under the same pinned directory capability
  as the record being compared and replaced.
- Startup or under-lock maintenance removes only validated orphan files from
  the adapter's exact temporary namespace, with bounded count/bytes diagnostics.
- Fault tests exercise directory-name ABA before lock, before/after temp-file
  creation, before rename, and during failed cleanup, proving no split-brain
  commit and no leaked temporary custody record.
