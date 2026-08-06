# `main` has been red for 433 commits: agent-safe leaf-set allowance drifts with every landing

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** Testing, Packaging, Storage
**Date:** 2026-08-06
**Related:** `issues/20260803-first-npm-latest-promotion.md` (its precondition 1
is currently unmeetable), `issues/20260803-wave3-program.md` (its close needs a
green named commit), LLP 0162/0164 (agent-safe publication)

## Summary

`tests/agent_safe_publication_checker_v1.mjs` → "P-vs-C generated allowance is
the exact qualification-C leaf set" asserts an exact leaf count against a
hardcoded expected value of **224**. The actual count grows every time a
landing adds a file the checker counts, and nothing updates the constant. The
gate has been failing continuously since **`8f217183f ci(app-cli): qualify
Linux app-bound executable`** (2026-08-04 17:26), which added four files and
took the count to 226.

`main` has taken **433 commits** since it went red, and the drift is widening:

| Commit | actual | expected | Result |
| --- | --- | --- | --- |
| `8caf77857` (before) | 224 | 224 | pass |
| `8f217183f` (first bad) | 226 | 224 | **fail** |
| `e32f35eb3` | 226 | 224 | **fail** |
| `6e158169b` | 226 | 224 | **fail** |
| current `main` (`cbddb192d`+) | 230 | 224 | **fail** |

This suite runs inside `scripts/verify-local-proof`
(`[snapback-verify] FAIL agent-safe-publication-fixtures`), so the local proof
is red at every commit in that range.

## Why this is urgent

**It blocks the npm capstone's stated precondition.** `issues/20260803-first-npm-latest-promotion.md`
precondition 1 requires "a green local-proof run on the promotion's
`candidateSourceSha`". The 2026-08-06 Lane D preflight names
`candidateSourceSha e32f35eb3`, which fails this gate (226 vs 224). The 0.1.9
promotion cannot honestly claim precondition 1 as written until this is fixed
or explicitly re-scoped.

**It blocks the wave 3 close.** The close now requires a green *named commit*
(2026-08-06 amendment). No commit in the last two days can be that commit
while this gate fails.

**It degrades silently.** Because the expected value is a bare integer rather
than a derived set, every unrelated landing widens the gap, and the failure
message (`230 !== 224`) says nothing about *which* leaves are unexpected. The
longer it runs, the more expensive the eventual reconciliation.

## What to fix

1. Reconcile the expected leaf set against current `main` — and record whether
   every one of the 6 added leaves is legitimately allowed, or whether some
   are drift the checker was built to catch. **Do not simply bump 224 to 230**;
   the point of an exact-set assertion is that additions get reviewed. That
   review is the actual work here.
2. Make the assertion name its diff. Comparing sets and reporting the
   symmetric difference (which leaves are unexpected/missing) instead of
   comparing counts would have made this self-diagnosing and would likely have
   caught it on the first landing.
3. Decide whether this gate belongs in the fast-moving landing path at all
   given AGENTS.md's "main moves fast" guidance — an exact-set gate that any
   landing can invalidate needs either an owner who reconciles it per landing
   or a derivation that doesn't require one.

## Note on discovery

Found while proving a wave-3 closing candidate SHA. Worth noting that the
proof run that surfaced it was itself nearly lost to a reporting bug: piping
`scripts/verify-local-proof` into `tail` swallows its exit code, so the run
printed a success-shaped tail while a suite had failed. Capture the exit code
from the command itself, not from the pipeline.

## Resolution (2026-08-06) — reconciled in `6783f7ab8`

The six added paths were reviewed and are all legitimate: two
content-addressed `app.binding.<sha256>.mjs` / `app.descriptor.<sha256>.json`
leaves each under the Contention Calendar `FULLY_COMMITTED_ROOTS` entry, the
comparator fixture root, and the push-seam fixture root. All three roots are
registered in `scripts/generated-artifact-policy.mjs`, and fully-committed
roots admit their frozen regular-blob leaves
(`scripts/check-agent-safe-publication.mjs`). No paths were removed.

The count assertion is replaced by an explicit reviewed set that asserts the
symmetric difference and reports sorted `unexpected` / `missing` paths.
Verified it still bites: dropping one reviewed entry makes the suite fail and
name that path, rather than passing.

**Correction to the table above.** `8caf77857` was the last commit where the
suite *passed*, but it did not assert 224 — it computed and asserted 177. The
expected constant was itself revised over time; the reviewed 224-leaf baseline
is `34ddc125d`. The "red since `8f217183f`" finding is unaffected: that is
where the tree's actual count diverged from whatever constant the tree carried
at that commit.

## Follow-up — the reviewed set is structurally fragile

This resolution restores the gate but does not make it durable. The reviewed
set now enumerates **content-addressed filenames**. Those hashes change
whenever the underlying app content changes, so the next regeneration of the
Contention Calendar, comparator, or push-seam apps will red this gate again —
reporting one `unexpected` (new hash) and one `missing` (old hash) — even
though nothing about the *policy* changed. That is expected churn, not drift
worth reviewing, and it will read as a false alarm.

Under AGENTS.md's "main moves fast" guidance this is a bad shape: an
exact-enumeration gate that any regeneration invalidates needs either a
per-landing owner or a derivation that does not require one.

Proposed durable fix: match content-addressed leaves under registered roots by
pattern (`app.binding.<64hex>.mjs`, `app.descriptor.<64hex>.json`) and
enumerate only the non-content-addressed leaves. The gate then still catches a
genuinely new *kind* of path — which is what it exists for — without churning
on every regeneration. Left unimplemented here deliberately: it widens what
the gate accepts, so it wants its own review rather than riding along with an
unblocking fix.
