# LLP 0249: Trusted package-capable actions

**Type:** RFC
**Status:** Accepted
**Systems:** Actions, Runtime, Security, Packaging, Deployment, Secrets,
Developer experience, Diagnostics, Operations, Testing
**Author:** Charlie Cheever / Codex
**Date:** 2026-08-12
**Revised:** 2026-08-12 (post-acceptance metadata addendum: repaired the
Related line — LLP 0046 was a mis-citation; the effect/attempt/receipt owners
this RFC's "existing idempotency, attempt, receipt, timeout, and
ambiguous-outcome semantics" refers to are LLP 0076 (streamed-action attempt
custody) and LLP 0070 (durable background work); LLP 0216 added as the
untrusted-code launch analysis. No design change). 2026-08-12 (author acceptance: Charlie Cheever accepted this RFC at
the exact revision bound by the final GPT-5.6 Sol round-3 READY artifacts,
SHA-256 `e9acd77bb2b7b2ef6636fb5e491a456e63b53fb52c168c727ea0ec3155315ab8`; see
`llp/reviews/0245-0249-single-family-super-refine.md`). 2026-08-12 (round-2 revision: made isolation attestation
authoritative/non-replayable; replaced egress denylisting with positive
versioned admission). 2026-08-12 (round-1 revision: froze a separate external-entry
TypeScript/package profile, made qualified OS isolation and a closed Node power
table activation requirements, and specified brokered SSRF-safe egress and LLP
0036 secret custody). 2026-08-12 (entered an author-invoked, single-family GPT-5.6 Sol
xhigh refinement loop; initial Draft came from Clique crypto/broker evidence
and kept the portable handler profile unchanged)
**Related:** LLP 0009, LLP 0010, LLP 0036, LLP 0041, LLP 0060,
LLP 0061, LLP 0070, LLP 0076, LLP 0099, LLP 0108, LLP 0123, LLP 0143,
LLP 0198, LLP 0216, LLP 0224, LLP 0227, LLP 0236, LLP 0237, LLP 0241

## Summary

Snapback should decide explicitly whether applications may declare an isolated,
package-capable action runtime for integrations that cannot reasonably execute
inside the portable deterministic handler profile. This RFC proposes a
target-specific `isolated-node-action-v1` profile with a lockfile-closed package
graph, process isolation, explicit capabilities, generated deployment custody,
and truthful non-portability.

The profile is for external effects and host-grade computation—SDKs, native
crypto/KDFs, image processing, and vendor clients—not for queries or
transactions. It never makes Node or npm packages available to LLP 0237
handlers.

## Motivation

Kimi's standards-correct JavaScript scrypt took roughly 8–11 seconds in the
embedded engine versus 90–180 ms in a native Node broker. LLP 0227 owns password
auth, but SDK, crypto, media, and package-only integrations recur. Requiring an
app-owned sidecar preserves the boundary while duplicating process, generation,
secret, log, deployment, and restart custody; Snapback should productize that
boundary or explicitly accept the deficit.

## Constraints

- Queries, live queries, mutations, policy, and transactional jobs stay
  portable/declarative; isolated actions cannot join a database transaction.
- Package install/runtime is Snapback custody, never ambient checkout resolution;
  every host power is explicit and least-privileged.
- External effects remain non-rollbackable and require existing idempotency,
  attempt, receipt, timeout, and ambiguous-outcome semantics.
- Local support cannot imply hosted support; target capability and deployment
  facts are generated and activation-gated.

## Decision

### D1. An explicit action-only runtime profile

An action opts in visibly:

```ts
export const deliver = defineAction({
  runtime: isolatedNode({
    packages: ["@vendor/sdk"],
    network: [{ protocol: "https", host: "api.vendor.example", port: 443 }],
    secrets: ["vendor-api-key"],
    nodeBuiltins: ["crypto.compute"],
  }),
  args: { /* frozen contract */ },
  result: results.value(/* frozen contract */),
  effects: ["vendor-delivery"],
  handler: isolatedNodeEntry("./actions/deliver.ts", { export: "default" }),
});
```

No inference selects this action-only profile; refs, inspect, guide, capability,
and deployment receipts label it `isolated`, `effectful`, and target-specific.
`isolatedNodeEntry` is a literal root-relative exception owned only by
`isolated-node-action-source-v1`: its module exports exactly one default async
`(ctx, args) => result`, while contracts/capabilities stay inline. It supersedes
LLP 0237's inline rule only here and does not reuse LLP 0246 unchanged.

Snapback compiles explicit-extension `.ts`/`.mts`/`.js`/`.mjs` app edges under
the action root: no CommonJS, URL/git/workspace/package-path edges, aliases, dynamic
import, decorators, JSX, plugins, or custom transforms. Bounds are 64 app files,
depth 16, 512 KiB app source; 256 locked package instances, package depth 32,
64 MiB unpacked, and 32 MiB final bundle. Bare ESM edges must resolve within the
declared locked closure. `isolated-node-action-source-profile.v1.json` freezes
TypeScript, ESM resolver/conditions, syntax-erasing options, bundler, and source
maps without absolute paths.

The checker types `ctx`, args, and return assignability from the inline frozen
declarations; runtime result validation remains authoritative.

Semantic identity binds entry/export, normalized graphs, contracts,
capabilities, and profile; executable identity adds tool/runtime builds,
options, package/target integrity, OS/architecture, and bytes. Source-map/
resolution/transform failure preserves the predecessor.

### D2. The dependency closure is frozen at build time

The build verifies one supported manifest/lockfile and exact integrities into a
content-addressed bundle. Only declared direct packages and locked ESM closure
enter. Scripts, workspace/path/git/URL dependencies, dynamic load, native
addons, CommonJS, and post-install downloads refuse. LLP 0241 bundle identity
binds the closure.

### D3. Isolation is the authority boundary

The worker has a read-only bundle, bounded host-private attempt scratch,
declared network/secret grants, enforced CPU/memory/wall/output/concurrency
limits, zero subprocesses, redacted logs, and generation/attempt/idempotency on
host calls. It has no repository, database, driver, or admin credential;
durable writes use declared post-effect mutation/command seams. Runtime non-
exposure, not source scanning, enforces this closed Node table:

| Surface | `isolated-node-action-v1` exposure |
| --- | --- |
| ES data APIs, URL/text/abort | no host authority |
| Buffer, `buffer`/`util`/`events`/`string_decoder`/`path` | in-memory facades |
| Date/timers; `node:crypto` | `clock`; `crypto.compute`, plus `entropy` for randomness |
| HTTP | brokered `fetch` under exact `network` grant |
| process/env/require/module/vm/Wasm/inspector/addons | absent |
| fs/net/tls/dns/http(s)/dgram/child/workers/cluster/OS control | absent |

These are the only globals/builtins supplied to direct or transitive code;
other imports or reflective requests refuse. New powers require a reviewed
facade/grant and qualification.

`IsolationProfileV1` is a live per-worker attestation, never static
qualification. The executing runtime's server-owned target registry pins
target/profile, attester trust root, worker/runtime build, OS/container policy,
broker/address-classifier/deny-fact/probe-corpus digests, expiry ceiling, and
revocation generation. Only the target's privileged launcher—never app, bundle,
or worker—signs after construction/probes; self-signed receipts refuse.

Each launch, the server issues a one-use challenge over its private launcher
channel. The receipt binds those facts plus the probe-result digest,
generation/bundle/executable ids, startup/launch nonces, kernel/container
instance, authenticated worker-channel identity, issuance/expiry, and
revocation generation.
The server verifies, atomically consumes the challenge, and binds the receipt
to that live session. Replay, mismatch, expiry, or revocation makes readiness
false, stops admissions, and tears down the worker. Probes prove absent
repository/database mounts, ambient environment, process/IPC/socket paths and
enforce killable limits; a same-UID unsandboxed child is nonconforming.

V1 network grants are exact HTTPS `{protocol, host, port}` tuples with canonical
ASCII hosts; wildcards, userinfo, IP literals, and app overrides refuse. For
every resolution/connect, registry-pinned `globally-routable-unicast-v1`
canonicalizes every IPv4/IPv6 answer, including mapped/translated equivalents.
Unknown/noncanonical/scoped forms, any non-global-unicast answer, or a target-
owned versioned metadata/control-plane/reserved deny match refuses.
The broker pins one admitted address, binds TLS SNI/certificate identity, and
reauthorizes/resolves at most five redirects. With no raw socket/DNS/HTTP/proxy/
custom-agent surface, packages cannot bypass it; qualification covers address
equivalence, rebinding, redirects, target denies, TLS, and local sockets.

LLP 0036 governs secrets: opaque handles, host-side use, or deliberate greppable
`handle.expose()` for SDK strings. Each attempt snapshots its staged-value
redactor before package code; logs, errors, receipts, and diagnostics stay
redacted after rotation. There is no value read-back/hash, and a legitimate
holder's deliberate exfiltration remains an explicit residual.

### D4. One first-party broker lifecycle

`snapback dev` owns build/start/health/reload/teardown as an LLP 0241 custodian.
Server `OperationalReadinessV1` binds source profile, bundle, Node runtime, and
the verified live receipt/session; an unqualified target refuses activation.
No app gateway owns refs, generation, health, or restart. Doctor/logs/inspect
expose the worker cut, grants, readiness, failure, and next steps.

### D5. Effects and failures stay truthful

Every attempt has idempotency/effect class, deadline, and receipt. Timeout or
worker/connection loss after effect admission is ambiguous unless the declared
provider seam proves otherwise; only existing pinned-generation effect policy
may retry. Result validation gates success but cannot undo an effect. The
public client uses LLP 0247's common typed diagnostic access when accepted.

### D6. Portable alternatives remain first in the guide

Diagnostics prefer, in order, a Snapback portable host operation, a portable
`ctx.fetch` action, then this isolated profile. Password KDF remains LLP 0227
platform custody.

## Compatibility and migration

App-owned brokers remain supported. Migration may scaffold declarations and
deployment metadata but cannot move secrets or assert idempotency. Portable
actions keep their identity/runtime, and no target advertises this distinct
boundary without its qualification.

## Rollout

1. Run a build/sandbox spike against three representative packages: pure JS
   vendor SDK, native-crypto use through Node built-ins, and a package with an
   install/native-addon requirement that must refuse.
2. Freeze source/dependency, capability, isolation, egress, receipt, and
   diagnostic schemas.
3. Implement local worker custody behind an experimental capability with no
   hosted claim.
4. Integrate generation reload, secrets, logs, timeouts, and cleanup.
5. Qualify one hosted target or explicitly retain a local-only maturity label.
6. Rerun an SDK integration and compute-heavy control against an app-owned
   broker; measure authoring time, cold start, latency, memory, bundle size,
   source-map fidelity, recovery, and dependency provenance/vulnerability output.

## Acceptance

- A locked pure-JS package action runs without repository/database/admin access
  and only reaches declared network/secrets.
- The external `.ts` entry, ESM package edges, emitted source maps, and
  semantic/executable identities pass exact resolver/transform goldens.
- An undeclared package, dynamic load, install script, native addon, destination,
  secret, filesystem path, or subprocess refuses before activation with
  remediation.
- Adversarial same-UID, environment, process/IPC, raw-socket, replayed-receipt,
  DNS-rebinding, classifier-equivalence, non-global/target-denied address,
  redirect, TLS-identity, and local-socket probes fail under the bound receipt.
- Secret coercion/log/error vectors redact against the attempt snapshot; only
  deliberate `expose()` releases plaintext and no receipt hashes a value.
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

- This substantial security/operations surface must stay action-only and gated;
  lockfile integrity, no scripts, immutable bundles, and provenance do not end
  package supply-chain risk.
- Local-only support can surprise and host operations may be cheaper. Generated
  maturity plus portable-first guidance keep both costs visible.

## Open questions

1. Should v1 use a local Node worker only, or require one qualified hosted
   target before any public package surface ships?
2. Do packages with WASM assets fit v1's immutable bundle, or wait for a
   separately bounded asset-loading rule?
3. If the build/operate brief shows first-party broker custody still cannot
   approach Convex's operations score, should LLP 0198 choose hosted
   productization rather than ship a local-only escape hatch?

## Status

Accepted. This RFC records the explicit product/security decision to admit an
isolated, package-capable, action-only runtime profile under the custody rules
above; it never changes the portable handler profile. Accepted by the author on
2026-08-12 at the revision bound by the final single-family GPT-5.6 Sol READY
review.
