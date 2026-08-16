<!-- @ref LLP 0187#t4--build-the-out-of-repo-funnel-before-it-is-tested-for-real — published packages must route readers to checkout-independent documentation. -->
<!-- @ref LLP 0061#4-distribution-and-discovery — package links use the build-bound served Guide and MCP projection. -->

# `@expo/snapback-hosted-supervisor`

`@expo/snapback-hosted-supervisor` is fail-closed operator infrastructure for
Snapback's single-instance container/VM hosted work. It contains the
single-writer supervisor state machine, operator authority and signed-response
boundaries, Fly/Tigris provider execution, durable external mirror and anchor
handling, hosted-edge admission, installation bootstrap, and legacy-target
onboarding tools.

Application authors should not install this package. It is not a hosted
Snapback client, deployment SDK, or production-readiness claim. Start with
`@expo/snapback-cli` and its release/target workflow; adapter and control-plane
authors should consume this package only as part of that reviewed operator
system.

The source has real package, protocol, restart-recovery, credential-custody,
and provider evidence. The complete packed hosted product journey has not
passed, lifecycle operations remain disabled at the service boundary, and the
bootstrap/onboarding receipts set `capabilityAdvertised: false`. Do not turn
the package's presence into a hosted capability claim.

## Start at the release boundary

Build and inspect a target-neutral release with the public CLI before choosing
or implementing any hosted adapter:

```sh
npm install --global @expo/snapback-cli
snapback deploy build snapback \
  --target-profile local-dev-sqlite-ibex \
  --json
```

That command deliberately reports blocking hosted and supply-chain gaps; it
does not upload, provision, or activate an application.

For supervisor development only, the bootstrap binary's `plan` command is the
read-only first step:

```sh
npx --package @expo/snapback-hosted-supervisor \
  snapback-hosted-supervisor-bootstrap plan
```

Review the emitted effects, credentials, tariffs, nonclaims, and confirmation
digest. Do not run `apply` from a generic README: it performs real provider
changes and belongs inside the controlled operator workflow.

## Documentation outside a checkout

A running Snapback server serves the Guide compiled into that exact build.
These links use the first default development port; use the origin printed by
`snapback dev` or `snapback start` if yours differs.

- Read [release and target control](http://127.0.0.1:4287/_snapback/guide/deploying/releases.md)
  for the supported plan/apply boundaries and current hosted gaps.
- Read [target authentication honesty](http://127.0.0.1:4287/_snapback/guide/auth/targets.md)
  before making any hosted-auth claim.
- Read first: [the start packets](http://127.0.0.1:4287/_snapback/guide/start/index.md)
  — the budgeted per-template first read (LLP 0259).
- Look up (do not linear-read) the [capability index](http://127.0.0.1:4287/_snapback/guide/capabilities.md)
  for the current deployment and hosted maturity facts.
- Run `snapback guide` or `snapback guide <query>` to browse or search the
  embedded Guide.
- Run `snapback mcp` for the same build-bound corpus as read-only MCP
  resources, starting at `snapback-guide://manifest`.
