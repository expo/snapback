# LLP 0047: Hosted execution limits

**Type:** RFC
**Status:** Draft
**Systems:** Runtime, Security, Deployment, Auth, API, Testing
**Author:** Charlie Cheever / Codex
**Date:** 2026-07-07
**Revised:** 2026-07-07 (later same day: first open question answered — the
local V8 isolate service and the Cloudflare proof are one artifact, LLP 0048's
workerd-hosted runner, where this profile's kill/limit acceptance executes
first; DK-5 re-decided in LLP 0009. Earlier same day: cross-family review
revisions, ratified by Charlie — see
`reviews/0047-hosted-execution-limits.claude.md`: shipped action watchdog
acknowledged, action-kill semantics deferred to 0028, DK-5 trigger noted;
initial same day)
**Related:** LLP 0000, LLP 0003, LLP 0004, LLP 0009, LLP 0010, LLP 0011, LLP 0014, LLP 0018, LLP 0028, LLP 0036, LLP 0038, LLP 0040, LLP 0048

## Summary

This RFC defines the runtime/resource boundary Snapback must enforce before it
claims hosted or untrusted code execution. It does not change the local trusted
Ibex target's honest capability report. It sets the minimum bar for a target
that runs code for other people.

The first hosted-capable runtime profile must enforce:

- wall-clock timeout for queries, mutations, and actions;
- CPU or instruction budget where the engine supports it;
- memory/result-size limits;
- no ambient filesystem/process/network powers;
- host-mediated database and secret access only;
- per-app/per-invocation isolation;
- structured diagnostics for every kill or denied capability.

## Motivation

The local target is intentionally trusted-local. That is acceptable because the
capability manifest says query/mutation wall-clock timeout and CPU budget are
missing. One piece of enforcement has already shipped locally and is prior art
for this profile: the action watchdog (`action_wall_clock_timeout: Enforced`,
default 30 s, ENG-23324 — see LLP 0009's DK-5 note and LLP 0028 §Execution).
What remains missing is query/mutation preemption and everything isolation:
none of it is acceptable to leave missing for hosted multi-tenant Snapback,
where one app's busy loop, memory blowup, or stray network call can become
another user's outage or data leak.

[LLP 0009](./0009-code-execution-security.rfc.md) owns the security model. This
RFC selects the first enforceable hosted profile that can graduate
`hosted_untrusted_code` from capability gap to supported feature. Starting this
work fires DK-5's second revisit trigger ("hosted or untrusted execution work
begins anywhere") for the deferred V8 conformance twin — the same trigger
[LLP 0040](./0040-cloudflare-narrow-proof.rfc.md) fires from the target side.

## Design

### Runtime profile

Hosted/untrusted execution uses a killable runtime. The expected first profile
is V8-based, either through Cloudflare Workers or a local V8/isolate service.

Warm pooling is not part of the first hosted profile unless the pool can prove
the same isolation and limit guarantees as fresh invocation. Fresh-per-invocation
is the default.

### Limits

The profile enforces:

- query wall-clock timeout;
- mutation wall-clock timeout;
- action wall-clock timeout;
- CPU/instruction budget where available;
- maximum response size;
- maximum rows read/written per invocation;
- maximum host-call count;
- maximum memory or heap size where available.

If a limit cannot be enforced on a target, the target must not claim hosted
untrusted execution.

These are all invocation-scoped. Per-app aggregate fairness — concurrency
ceilings and queue depth, so one tenant's request volume cannot starve
another's — is a real hosted requirement but belongs to the hosted product
design, not this profile; it is named here so its absence is a known gap
rather than silence.

### Host powers

App code receives no ambient access to:

- filesystem;
- process/env;
- raw sockets;
- arbitrary network fetch;
- timers that outlive invocation;
- direct database handles;
- raw secret values.

Every power is exposed as a host-mediated API with a manifest-declared
capability and a diagnostic path.

### Failure behavior

Limit violation fails closed:

- no mutation writes commit after a killed invocation. For killed *actions*,
  semantics defer to LLP 0028's contract: actions are not transactions, so
  mutations an action already committed via `ctx.runMutation` before the kill
  stand — the kill prevents further work, it does not roll back durable
  commits;
- host calls from stale continuations are rejected;
- the invocation receives or records a stable `SNAPBACK_*` diagnostic;
- the runtime instance is burned if isolation is uncertain.

### Capability manifest

The target profile reports each resource limit as `Enforced`, `Advisory`, or
`Missing`. Hosted/untrusted support requires the relevant limits to be
`Enforced`.

## Non-goals

- Claiming the local Ibex target can enforce CPU limits.
- Designing a full hosted product, billing, or tenant lifecycle.
- Approving warm pooled hosted execution.
- Supporting arbitrary npm/native dependencies in hosted handlers.
- Replacing Cloudflare's own isolate limits when running on Cloudflare.

## Acceptance

- A busy-loop query is killed with no committed writes and a stable diagnostic.
- A mutation killed after buffering writes commits nothing.
- An oversized result fails with a structured diagnostic.
- A forbidden ambient capability, such as raw fetch without grant, fails at the
  host boundary.
- A stale continuation cannot perform a host call after invocation completion.
- The capability manifest marks hosted runtime limits as enforced before
  `hosted_untrusted_code` is removed from gaps.

## Open Questions

- Is Cloudflare the first hosted execution proof, or should Snapback build a
  local V8 isolate service first for deterministic tests? — **Answered
  2026-07-07: both, as one artifact.**
  [LLP 0048](./0048-v8-conformance-twin.rfc.md)'s workerd-hosted runner is
  the local deterministic testbed — the busy-loop kill, wall-clock
  enforcement, and computed limit fields land there first — and
  [LLP 0040](./0040-cloudflare-narrow-proof.rfc.md) deploys the same
  harness. This profile's acceptance list gets its first execution on the
  0048 leg.
- What exact CPU/instruction budget can be enforced portably?
- Should result-size and host-call limits be app-configurable or target fixed?

## Status

Draft. This RFC is the security gate for hosted/untrusted execution claims.
