# Diary 0062: Instance-fork worktree/agent/parallel workflows (LLP 0185 Phase 2b)

**Date:** 2026-08-05
**Author:** Claude (Phase 2b execution over the todo demo)
**Related:** LLP 0158, LLP 0185, `demos/_kit/instance-fork.mjs`,
`demos/todo/tests/acceptance/fork-parallel-dispositions.mjs`

## What was built and how it felt

Phase 2b turned the single-consumer fork harness into three owned
workflows: fork-per-worktree (`startWorktreeFork`), fork-per-agent
(`startAgentFork`), and a parallel-suite integration where three lanes
share one prepared parent concurrently. Ownership is a small non-secret
JSON record in the fork directory; discovery and cleanup bind to the exact
recorded identity and drop through the registry-bound CLI.

Building on the Phase 3 substrate was notably calm. The whole parallel
lane suite — three concurrent `fork create` invocations racing against one
cold parent, concurrent drops, an orphan sweep, and a quarantine repair —
passed on the first complete run. That is not luck: Phase 3's cleanup
lock, stale-registry completion, and OS-assigned ports had already
eaten the failure modes this suite would otherwise have found. The
contrast with the 2026-08-03 dogfood run (which hit a drop/reap teardown
race on its first two-fork outing) is the clearest before/after evidence
the Phase 3 work produced.

## Friction worth recording

- **Canonical-path mismatch (macOS).** The CLI reports canonicalized paths
  (`/private/var/...`) while `mkdtemp` hands out `/var/...`. Binding the
  ownership record to the fork directory needed an explicit
  `realpathSync` on the harness side. Anything that compares harness paths
  against CLI-reported paths will hit this; the kit now normalizes.
- **Stale-binary identity mismatch.** Running the suite against a binary
  built three commits earlier produced a loud `stamp-mismatch` warning
  rather than silent wrongness — good honesty, and the rebuild-first
  discipline stands.
- **`ensureApp` cost is exactly what forking amortizes.** Seeding the
  parent once (schema + functions + seed + one mutation) takes noticeably
  longer than the three forks that reuse it combined. The
  fork-instead-of-reseed thesis holds up in wall-clock terms even at
  todo-demo scale.

## Comparison

Against the reseed-per-lane pattern this replaces: parallel lanes over one
prepared parent are both faster and more realistic (lanes see genuine
parent rows, not per-lane synthetic seeds), and the per-lane diff receipt
("exactly my write") is a review artifact reseeding never had. Against
Convex/Supabase-style shared-dev-instance workflows: the isolation is
stronger by construction — each lane's writes are invisible to the others
and to the parent, proven per run rather than assumed.

## Honest limits

The Phase 2b exit criterion asks for *repeated* real-consumer use; this
diary records the first routine run plus its CI registration in
`scripts/verify-local-proof` (`fork-parallel-dispositions`), which is what
makes the use repeat from here. LLP 0185 OQ3 (whether worktree and
agent ownership should unify onto one binding) stays open — building both
made the dual binding feel right so far: worktree identity is the natural
key for humans-at-a-checkout, owner/run for fleets, and both share one
record schema and sweep path underneath.
