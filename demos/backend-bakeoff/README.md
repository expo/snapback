# Seven-backend, five-app bakeoff

This directory is the machine-readable execution surface for
[LLP 0102](../../llp/0102-seven-backend-five-app-bakeoff.plan.md).

Stage 0 freezes product prompts, neutral React shells, acceptance IDs,
provider profiles, environment and assistance policy, workload shapes,
execution order, scoring, and artifact digests before any timed
provider-specific command. Provider implementations will live under
`arms/<app>/<provider>/`; receipts live beside the arm that produced them.

Run:

```sh
npm test
```

`verify-stage0.mjs` distinguishes:

- **protocol validity** — the comparison is internally frozen and consistent;
- **execution readiness** — required local tools and named credential
  capabilities are available without exposing values.

A valid protocol with failed readiness is not authorization to start a timed
arm. It is an actionable preflight report.

`npm run capsule:verify -- <capsule>` validates a run capsule against the
frozen `protocol/run-capsule.v1.schema.json` first (strict draft 2020-12
semantics, root `additionalProperties: false`, integrity-checked against
`protocol/freeze.v2.json`), then applies the semantic non-vacuity and evidence
checks, then requires every declared evidence, cleanup, and baseline path to be
either empty or resolve to a retained file under the arm directory or the
repository root — a prose sentinel in a path field fails. Accepting a new
capsule field requires a dated protocol version amendment (a new frozen schema
plus a verifier update and re-freeze), never an ad-hoc relaxation of the
verifier.

`npm run preflight:credentials` probes existing CLI sessions while discarding
all raw provider output. It prints only capability statuses and booleans; it
never prints or persists account emails, tokens, project ids, or mailbox
values.

The React shell deliberately contains no backend interface. Each arm copies
the frozen shell and integrates its provider idiomatically. If an arm needs a
gateway, poller, or normalization layer, that code stays visible in the arm
and counts as glue.
