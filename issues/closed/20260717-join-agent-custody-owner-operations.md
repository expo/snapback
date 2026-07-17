# Join every Agent custody owner operation before release

**Status:** Closed
**Severity:** P1
**Systems:** Agent auth, Durable custody, Filesystem storage, Memory storage
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-17
**Related:** LLP 0055 §Grant-backed live and queued replay; LLP 0059 §Cross-context ownership
**Marker:** structured-concurrency, custody, locking, durability

An ownership callback can start `owner.withPartition(...)` without awaiting its
promise and then return. Both reference adapters release the outer partition
immediately, while the independently owned child partition keeps running. For
the universal custody gate this means another owner can acquire the gate while
work started beneath the predecessor gate is still live. The same missed-await
shape can race release with filesystem read/replace/remove/retire/scan work.

This is a structured-ownership violation, not merely caller misuse: the
storage adapter is the component that knows which asynchronous work was
started through its owner and when releasing the physical lock becomes safe.

**Done when:**

- Every owner-started asynchronous operation is registered before it can
  yield, including nested partition ownership and all direct owner methods.
- Returning or throwing from the callback closes the owner to new starts,
  joins every registered operation, and only then releases its memory or
  filesystem ownership.
- A hung unawaited child keeps the outer universal gate locked; a later gate
  owner cannot enter early.
- Existing operation non-overlap and post-retirement terminal behavior remain
  deterministic. Retirement blocks later starts but its own registered task
  is joined before release.
- Memory and real-filesystem regressions force missed awaits and prove release
  ordering, rejection settlement without an unhandled event, callback-error
  precedence, and fresh ownership after settlement.

## Resolution

Both reference adapters now register the exact Promise for every owner-started
operation before it can yield. Callback completion closes new starts, joins the
registered set, and releases only afterward. Rejections are observed
immediately without changing the public Promise contract; callback and
physical-release failures retain their prior precedence. Retirement remains
terminal within its ownership interval.

Verified 2026-07-17 with:

- `node demos/_kit/tests/agent-authority-custody.mjs` (includes the real
  filesystem custody suite)
- `./ref-check --verbose`
