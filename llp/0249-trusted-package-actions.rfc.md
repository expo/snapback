# LLP 0249: Trusted package-capable actions

**Type:** RFC
**Status:** Review
**Systems:** Actions, Runtime, Security, Packaging, Deployment, Secrets,
Developer experience, Diagnostics, Operations, Testing
**Author:** Charlie Cheever / Codex
**Date:** 2026-08-12
**Revised:** 2026-08-12 (entered an author-invoked, single-family GPT-5.6 Sol
xhigh refinement loop; initial Draft came from Clique crypto/broker evidence
and kept the portable handler profile unchanged)
**Related:** LLP 0009, LLP 0010, LLP 0036, LLP 0041, LLP 0046, LLP 0060,
LLP 0061, LLP 0099, LLP 0108, LLP 0123, LLP 0143, LLP 0198, LLP 0224,
LLP 0227, LLP 0236, LLP 0237, LLP 0241

## Summary

Snapback should decide explicitly whether applications may declare a trusted,
package-capable action runtime for integrations that cannot reasonably execute
inside the portable deterministic handler profile. This Draft proposes a
target-specific `trusted-node-action-v1` profile with a lockfile-closed package
graph, process isolation, explicit capabilities, generated deployment custody,
and truthful non-portability.

The profile is for external effects and host-grade computation—SDKs, native
crypto/KDFs, image processing, and vendor clients—not for queries or
transactions. It never makes Node or npm packages available to LLP 0237
handlers.

## Motivation

In the Kimi Clique run, a standards-correct pure-JavaScript scrypt executed in
roughly 8–11 seconds inside the embedded handler engine, while a native Node
broker completed in roughly 90–180 milliseconds. Password auth has a dedicated
owner in LLP 0227, but the general pattern recurs for SDKs, cryptography, media,
and package-only integrations.

Today the sanctioned answer is an application-owned trusted broker/sidecar.
That preserves the runtime boundary but charges every app for process custody,
session/generation coordination, secrets, logs, deployment, and restart. Convex
offers a conspicuous Node action escape hatch. Snapback should either
productize its broker boundary or explicitly accept that ecosystem deficit.

## Constraints

- Queries, live queries, mutations, authorization policy, and transactional
  jobs remain on portable/declarative profiles. Trusted actions cannot join a
  database transaction.
- Package installation and runtime are build-time/runtime custody, never ambient
  resolution from the developer's checkout.
- Every filesystem, network, secret, subprocess, clock, entropy, and native
  capability is explicit and least-privileged.
- External effects remain non-rollbackable and require existing idempotency,
  attempt, receipt, timeout, and ambiguous-outcome semantics.
- Local support cannot imply hosted support; target capability and deployment
  facts are generated and activation-gated.

## Decision

### D1. An explicit action-only runtime profile

An action opts in visibly:

```ts
export const deliver = defineAction({
  runtime: trustedNode({
    packages: ["@vendor/sdk"],
    network: ["api.vendor.example:443"],
    secrets: ["vendor-api-key"],
  }),
  args: { /* frozen contract */ },
  result: results.value(/* frozen contract */),
  effects: ["vendor-delivery"],
  handler: "./actions/deliver.ts",
});
```

No inference selects this profile. The generated ref, inspect output, guide,
capability manifest, and deployment receipt label it `trusted`, `effectful`, and
target-specific. It is unavailable to query/mutation/live/policy declarations.

### D2. The dependency closure is frozen at build time

The build reads one supported package manifest and lockfile, verifies exact
integrities, rejects lifecycle/install scripts unless a future reviewed
capability admits them, and constructs a content-addressed runtime bundle or
image. Only declared direct packages and their locked transitive closure enter.
Workspace/path/git/URL dependencies, undeclared dynamic require/import, native
addons, and post-install downloads refuse in v1.

The semantic identity binds declared package names/capabilities and action
contracts. Executable/bundle identity binds the complete dependency closure,
Node runtime build, OS/architecture, transform, and final bytes under LLP 0241.

### D3. Isolation is the authority boundary

Each deployment runs actions in a Snapback-owned worker/process with:

- no repository or database-file access;
- a read-only content-addressed bundle;
- a per-attempt scratch directory with byte/time cleanup bounds;
- declared network destinations only;
- secret handles for declared grants only;
- CPU, memory, wall-time, output, concurrency, and subprocess ceilings;
- structured stdout/stderr redaction and diagnostic capture; and
- generation/attempt/idempotency identity on every host call.

Direct database drivers and Snapback admin credentials are absent. Durable
writes occur only through declared post-effect mutation/command seams with
ordinary authority and settlement rules.

V1 rejects native addons and arbitrary subprocesses. A later profile may admit
them only with platform-specific build provenance and a stronger sandbox.

### D4. One first-party broker lifecycle

Local `snapback dev` builds, starts, health-checks, reloads, and tears down the
worker as a required LLP 0241 generation custodian. Hosted deployment must
produce an equivalent qualified worker target before activation; otherwise
codegen/deploy refuses `trusted-node-action-v1` for that target.

The application does not hand-write a gateway that imports generated refs,
tracks their generation, invents health endpoints, or restarts on artifact
change. `snapback doctor`, logs, and inspect expose worker generation, package
closure, declared capabilities, readiness, last failure, and bounded next
steps without revealing secrets.

### D5. Effects and failures stay truthful

Every attempt has a generated idempotency/effect class, deadline, and receipt.
Timeout, worker loss, or connection loss after effect admission is ambiguous
unless the declared provider/idempotency seam proves otherwise. Automatic retry
is permitted only under the existing action/effect policy and pinned generation;
package runtime does not make retry safe.

Result-contract validation occurs before a successful result releases, but a
validation failure cannot roll back an external effect. The public client uses
LLP 0247's common typed diagnostic access when accepted.

### D6. Portable alternatives remain first in the guide

Generated diagnostics suggest, in order:

1. a Snapback-owned portable host operation when one exists;
2. an ordinary portable action using `ctx.fetch` where sufficient; and
3. the trusted package profile when the dependency genuinely requires it.

Password KDF should still use the first-class auth mechanism from LLP 0227;
this profile is not a substitute for platform-owned password custody.

## Compatibility and migration

Existing app-owned brokers remain supported external architecture. A migration
command may scaffold a trusted action declaration and deployment manifest but
cannot automatically move secrets or assert idempotency. Portable actions keep
their current identity and runtime.

Because this adds a materially different security and deployment boundary, no
target advertises support by default. Capability maturity and publication
follow the existing target qualification process.

## Rollout

1. Run a build/sandbox spike against three representative packages: pure JS
   vendor SDK, native-crypto use through Node built-ins, and a package with an
   install/native-addon requirement that must refuse.
2. Freeze dependency, capability, isolation, receipt, and diagnostic schemas.
3. Implement local worker custody behind an experimental capability with no
   hosted claim.
4. Integrate generation reload, secrets, logs, timeouts, and cleanup.
5. Qualify one hosted target or explicitly retain a local-only maturity label.
6. Rerun an SDK integration and compute-heavy control against an app-owned
   broker; measure authoring time, startup, latency, memory, and recovery.

## Acceptance

- A locked pure-JS package action runs without repository/database/admin access
  and only reaches declared network/secrets.
- An undeclared package, dynamic load, install script, native addon, destination,
  secret, filesystem path, or subprocess refuses before activation with exact
  remediation.
- Package/Node/bundle changes rotate executable identity and reload through the
  same generation boundary; in-flight attempts remain pinned.
- Worker crash, timeout, ambiguous post-effect loss, and invalid result each
  produce truthful, distinct receipts and never license unsafe retry.
- `snapback dev` owns startup/health/reload/teardown with no application-written
  gateway; doctor and logs identify the worker failure domain.
- A target without the qualified worker capability refuses at generation or
  deployment, never silently runs the action in a different profile.
- Portable handlers still reject every package and Node import in the LLP 0237
  corpus.

## Risks

- This is a substantial security and operations surface. The first slice must
  stay action-only, isolated, and capability-gated.
- Package supply-chain risk is larger than Snapback's authored graph. Lockfile
  integrity, no scripts, immutable bundles, and provenance are minimum controls,
  not a complete answer.
- A local-only profile could worsen deployment surprise. Target support is an
  authoring-time generated fact, and published examples must name maturity.
- It may duplicate platform-owned host operations inefficiently. Guide ordering
  and diagnostics keep narrow portable capabilities preferred.

## Open questions

1. Should v1 use a local Node worker only, or require one qualified hosted
   target before any public package surface ships?
2. Are Node built-ins admitted individually through capabilities, or is the
   first profile pure-package plus network/secrets only?
3. Which sandbox is authoritative per target, and what evidence is required to
   claim filesystem/network isolation?
4. Do packages with WASM assets fit v1's immutable bundle, or wait for a
   separately bounded asset-loading rule?
5. If the build/operate brief shows first-party broker custody still cannot
   approach Convex's operations score, should LLP 0198 choose hosted
   productization rather than ship a local-only escape hatch?

## Status

Draft. This RFC deliberately forces a product/security decision. It does not
authorize Node or packages until reviewed and accepted, and it never changes
the portable handler profile.
