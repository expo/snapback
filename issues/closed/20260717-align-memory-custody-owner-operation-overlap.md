# Align memory custody owner operation overlap with durable storage

**Status:** Closed
**Severity:** P1
**Systems:** Agent auth, Durable custody, Memory storage, Filesystem storage
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-17
**Related:** LLP 0055 §Grant-backed live and queued replay
**Marker:** custody, locking, cas, conformance

The filesystem custody adapter refuses overlapping operations started through
one partition owner, preventing two asynchronous compare-and-swap operations
from reading the same predecessor. The memory reference adapter lacks that
guard. Its direct operations happen to settle synchronously today, but a
nested or future asynchronous operation can overlap another owner operation,
so tests and native/headless users do not exercise the production adapter's
linear owner contract.

**Done when:**

- The memory owner admits at most one operation at a time and returns the same
  stable `SNAPBACK_AUTH_CUSTODY_OPERATION_OVERLAP` diagnostic as filesystem.
- An unawaited overlap refusal is observed immediately and emits no
  `unhandledRejection`.
- The registered predecessor operation remains joined before ownership is
  released, and a fresh later owner can proceed.
- The focused memory and filesystem custody suites pass.

## Resolution

The memory adapter now admits one owner operation at a time, observes every
early overlap refusal immediately, and retains the accepted operation in the
ownership scope's mandatory join. Its diagnostic and lifecycle now match the
filesystem adapter. Deterministic tests cover competing CAS operations, an
unawaited refusal while a nested operation is live, and fresh ownership after
the predecessor settles.

Verified 2026-07-17 with `node demos/_kit/tests/agent-authority-custody.mjs`.
