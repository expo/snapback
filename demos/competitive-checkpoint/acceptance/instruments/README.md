# Candidate checkpoint instruments

These files implement two LLP 0075 timed-run prerequisites:

- deterministic median, nearest-rank p95, and seeded bootstrap reporting; and
- a closed event ledger that derives elapsed time, command, agent-usage,
  failure, retry, skip, intervention, and cleanup metrics.

They are deliberately marked `candidate-unratified-blocks-timed-runs`.
Executable code does not amend an accepted protocol. Before any timed sample,
a dated LLP 0075 amendment must ratify the exact
`instrument-lock.candidate.v0.json` digest and replace the corresponding
`unpinned-blocks-timed-runs` entries in `protocol.v0.json`.

Run:

```sh
node demos/competitive-checkpoint/acceptance/instruments/instruments.test.mjs
```

`gate-matrix.candidate.v0.json` is a separate unratified candidate for the
complete machine gate matrix requested by review. It makes every required
arm/gate decision explicit, treats missing entries as failures, admits
provider-native mechanisms only under a recorded equivalence rule, and
forbids `not-applicable` unless a gate explicitly allows it. Its evaluator and
fixed-vector test do not make the matrix authoritative; a dated amendment must
ratify its eventual lock digest.

`run-capsule.v0.mjs` is the candidate verifier for the remaining external lock.
It validates exact protocol bytes and protocol identity; the neutral prompt;
both complete scaffold trees; normative artifact bytes; immutable machine
image; a byte-bound hardware/network policy; exact public-npm package versions
and canonical SHA-512 SRI for every path in each arm's exact npm v3 lockfile
closure; provider/region/plan/topology/host choices;
one byte-bound provisioning plan per arm (including Snapback's
`snapback.remote-drill-plan.v1`); byte-bound credential preconditions and
health checks; one byte-bound agent
configuration and assistance policy; and complete per-arm documentation
corpora. Tree verification rejects undeclared files, symlinked path components,
and multiply-linked files rather than trusting a caller-supplied manifest.
Candidate capsules may be verified, but timed-run authorization fails until
the named protocol amendment exact-matches the capsule content digest,
ratifier, and date and explicitly authorizes timed runs.

`scoring.v0.mjs` mechanically applies every first-hour conjunction and absolute
zero floor, validates complete per-arm confidence decisions against a
capsule-bound anchor set, and applies Stop → Reprioritize → Continue
precedence. It deliberately contains no anchor prose: the required independent,
pre-evidence anchor author must provide and ratify those criteria.
