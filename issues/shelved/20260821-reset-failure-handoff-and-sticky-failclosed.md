# Seventh handoff deadlock, and fail-closed is process-sticky

**Status:** Open
**Filed:** 2026-08-21
**Found by:** grok-4.6 review of `lane/roompanic` (`a2da42ce7..7204a4f55`)
**Related:** `issues/closed/20260821-capability-link-mint-revoke-deadlock.md`

## Issue 1 — seventh deadlock, adjacent to the sixth

`crates/snapback-server/src/server.rs:23821`. On the sessions
`finish_stream_reset` FAILURE path after a known commit, `.await?` on
`clear_installed_auth_invalidation` drops the `CommittedResetHandoff` **still
closed**.

A classified postcommit failure is supposed to call
`release_after_fail_closed()` so waiters observe
`SNAPBACK_AUTH_PROJECTION_UNAVAILABLE`. `20118bd1d` added that release **after**
the `?`, so an error on the clear skips it and waiters park forever — the exact
defect `20118bd1d` was written to fix, one error path over.

Repair: do not `?` after taking the token. Clear best-effort, always
`fail_global_closed`, always `release_after_fail_closed`, then return the
classified error. Needs a regression that makes
`clear_installed_auth_invalidation` fail and asserts a subsequent
`with_snapback` / authorization write returns in **bounded** time.

## Issue 2 — fail-closed is process-sticky, and blocks its own recovery

A poisoned Ready latch (`fail_closed` sticky `failure`) makes coordinated reset
return `RolledBack` at staging
(`crates/snapback-server/src/server.rs:1133`,
`crates/snapback-server/src/server/writer_gate.rs:271`). Replacement is also
blocked, because the dependency is deliberately retained.

So recovery from a poisoned latch requires a process restart. As the reviewer
put it: the panic at least got a restart. This is the round-2 over-refusal
pattern applied to recovery rather than to writes.

Marked a suggestion rather than a defect because the spec chose latch poison
over panic deliberately. But one of two things should happen: either document
restart as the only recovery, or let RESET — not ordinary writes — proceed
through a poisoned Ready participant under the closed-handoff protocol.

## Note on the "caller still receives Ok" question

Both reviewers confirm the originating write returns `Ok` even when
authorization finalization fails. Codex called this HIGH and worse than the
panic. Grok agrees on the fact but adds decisive context: **the swallow is
required.** `run_after_local_batch` drops finalizers if an ordinary effect
panics, so a panicking callback would prevent the latch from poisoning at all.
The code carries a comment saying exactly that.

Grok also verifies nothing on the path treats the ticket as settled: the
dependency is retained, `durable_authorization` does not advance, the latch
poisons, and subsequent reservation/bind see the typed error.

So this is a genuine design question, not a clear defect: is "the write commits,
the store latches fail-closed, all later authorization work refuses" acceptable,
given the caller cannot be told synchronously because finalization is deferred
past Local by construction? A fix that makes the caller fail must not break the
finalizer's ability to run — otherwise it removes the poisoning that makes the
current behaviour safe.
