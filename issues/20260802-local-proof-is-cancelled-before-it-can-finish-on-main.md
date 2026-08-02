# local-proof is cancelled before it can finish on main, so the lane has no signal

**Status:** Open
**Impact:** 5
**Urgency:** 4
**Ease:** 3
**Confidence:** 5
**Severity:** P1
**Systems:** CI
**Author:** Claude (Fable 5), directed by Philippe Loulidi
**Date:** 2026-08-02
**Related:** LLP 0010, issues/20260802-verify-local-proof-stops-at-the-first-failure.md

The last 40 `local-proof` runs on `main`: **20 failure, 19 cancelled, 1 still
running. No successes.** The last successful run on main was
2026-07-28T22:59Z (`4a615b07`).

The cancellations are structural, not incidental. `local-proof.yml` sets

```yaml
concurrency:
  group: local-proof-${{ github.ref }}
  cancel-in-progress: true
```

with the rationale, written when CI ran on GitHub-hosted minutes: "Agents push
to main in bursts; only the newest commit's proof matters, so cancel
superseded runs instead of paying for each."

Measured against how main actually moves (last 30 commits): the **median gap
between commits on main is 0.1 minutes**, and 26 of 29 gaps are under 10
minutes. A full proof takes longer than that. So every run is superseded and
cancelled before it can reach a verdict, and the lane has produced no
information for days.

This is the mechanism behind the whole 2026-08-02 cleanup. Individual defects
(unregistered tests, missing declarations, publication files left out of the
tarball, stale carriers) were not missed because anyone ignored a red lane —
they were missed because **the lane never finished at all**. The one commit
this ticket was written alongside (`4794db37`) had its own local-proof
cancelled within minutes by the next landing.

## Why the original rationale no longer holds

The cancel was a cost optimization for GitHub-hosted minutes. Those lanes now
run on self-hosted `expo-large`, where a superseded run costs queue capacity
rather than dollars, so the trade the comment describes has changed.

## Options

1. **Don't cancel on main, keep cancelling on PRs.**
   `cancel-in-progress: ${{ github.event_name == 'pull_request' }}`. Superseded
   PR runs still die; main runs finish. Caveat: with a shared concurrency group
   and commits every few minutes, main runs then queue serially and the queue
   grows faster than it drains during a burst.
2. **Run the proof on a schedule against latest main** (say every 30 minutes)
   instead of per-push, and keep the per-push run for pull requests only. One
   verdict per window, bounded cost, no queue growth. Loses per-commit
   attribution — a failure names a window, not a commit — but a window is
   infinitely more than the current zero.
3. **Split the lane.** Keep the fast JS gates per-push with cancellation (they
   finish inside a burst gap), and move the slow Rust half to option 2's
   cadence. Most of what this cleanup found was in the fast half, so this
   recovers per-commit attribution for the defects that actually occur.

Option 3 looks best to me, with option 2 as the simpler first step if the
split is more work than it is worth right now.

Exit: `local-proof` produces a completed verdict on main regularly enough that
a landing which breaks it is identified while it is still the newest landing.
