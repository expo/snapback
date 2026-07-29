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

`npm run preflight:credentials` probes existing CLI sessions while discarding
all raw provider output. It prints only capability statuses and booleans; it
never prints or persists account emails, tokens, project ids, or mailbox
values.

The React shell deliberately contains no backend interface. Each arm copies
the frozen shell and integrates its provider idiomatically. If an arm needs a
gateway, poller, or normalization layer, that code stays visible in the arm
and counts as glue.
