# DECISION: pin the pre-timed-run amendments

**Status:** Open (author decisions; blocks the first timed run)
**Impact:** 5
**Urgency:** 5
**Ease:** 5
**Confidence:** 5
**Score reviewed:** 2026-07-26
**Score rationale:** The ticket evidence for “DECISION: pin the pre-timed-run amendments” shows the issue reaches a security, correctness, release, or core product boundary; the defect is blocking or unsafe on a live path now, while the ticket identifies a narrow, verified change or decision, with a direct reproduction or current implementation proof.
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

**Progress (2026-07-30, protocol amendment v0.9 — author decisions by
Charlie Cheever, in-session):** six of the eight pins are closed. Pinned by
decision: assistance policy (one identical Claude Code + `claude-fable-5` +
default-tools agent across arms; per-arm vendor docs by digest), frontend
hosting boundary (one shared Cloudflare Pages host for both arms;
provisioning untimed, deploy timed), application auth (idiomatic
first-party per arm — Snapback built-in email-code, Convex Auth;
provisioning untimed, wiring timed), and the comparator local leg (cloud
development deployment primary; account-free local beta an optional
preregistered sensitivity arm only). Ratified at content digests:
statistics implementation, metric definitions, machine gate matrix (all
candidate tests passing 2026-07-30). **Still blocking timed runs:** the
rubric scoring anchors (draft for author sign-off, preregistered before any
evidence reveal, non-author-family scorer) and the run capsule — which
carries the two credential preconditions that do not yet exist (a Convex
account and the shared Cloudflare Pages token, to live in the usual
git-ignored machine-local custody, never the repo).

**Progress (2026-07-24):** executable, content-addressed candidates now exist
for the statistics implementation, metric event/aggregation definitions,
complete machine gate matrix, run-capsule verifier, and mechanical scoring
engine; their tests pass. They remain candidates, not ratified amendments. No
run capsule exists yet, and the scoring engine intentionally supplies no
confidence anchors. Assistance, frontend hosting, application auth, Convex
local-leg topology, provider/region/plan, credentials, and rubric/scorer
choices still require author input. Timed runs remain blocked.

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
- **Metric definitions:** exact timer events, wrapper/command policy,
  token/tool-call accounting, aggregation rules, and expected-refusal taxonomy.
- **Application auth:** identity provider, two-principal fixture, credential
  provisioning, and timed-vs-excluded setup boundary for each arm.
- **Comparator local leg:** cloud development, account-free local, or a pinned
  sensitivity arm.
- **Run capsule:** the content-addressed neutral prompt bytes, both scaffold tree
  digests, harness/analysis digests, machine image, hardware/network policy,
  exact package integrities, provider/region/plan, and credential preconditions.
