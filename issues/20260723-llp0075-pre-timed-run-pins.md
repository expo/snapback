# DECISION: pin the pre-timed-run amendments (assistance, statistics, rubric, frontend, run capsule)

**Status:** Open (author decisions; blocks the first timed run)
**Severity:** P1
**Systems:** Competitive evaluation, Testing, Deployment
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-23
**Related:** LLP 0075 open questions + demos/competitive-checkpoint/acceptance/protocol.v0.json (unpinned-blocks-timed-runs entries), LLP 0063 (change control), issues/20260723-llp0075-comparison-fairness.md, issues/20260723-llp0075-checkpoint-program.md
**Marker:** llp-0075, competitive-checkpoint, decision, blocking

Every input `protocol.v0.json` marks `unpinned-blocks-timed-runs` must be pinned
in a dated, digest-refreshed amendment before the first timed two-arm sample —
these are the anti-gaming fail-closed gates. Each is an author decision; they
land together as one versioned amendment. Fairness inputs come from
`20260723-llp0075-comparison-fairness.md`.

**Resolved when** each is pinned:

- **Assistance policy:** one identical agent model/tool configuration across
  arms, and the pinned per-arm documentation corpus (the comparator's
  training-data presence vs Snapback's shipped guide is the material asymmetry).
- **Statistics implementation:** exact estimator, bootstrap target, resample
  count, seed, and invalid-sample replacement rule, content-addressed; note that
  the point-estimate median decides and the CI is informational.
- **Rubric scoring anchors:** per-dimension, per-arm 0/1/2 anchors (including what
  counts as direct reproducible evidence for comparator dashboard/CLI artifacts),
  preregistered before any evidence reveal; a non-author family scores with a
  retained transcript.
- **Frontend hosting boundary:** each arm's frontend host, credentials, and
  timed-vs-excluded provisioning boundary for the timed hosted "live URL" path.
- **Run capsule:** the content-addressed neutral prompt bytes, both scaffold tree
  digests, harness/analysis digests, machine image, hardware/network policy,
  exact package integrities, provider/region/plan, and credential preconditions.
