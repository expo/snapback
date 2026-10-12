---
title: Inspect hosted control
id: deploying.hosted-control
order: 3
audience: agent-first
capabilities: [deploy.target-control]
authorities: [llp/0111-fly-completion-and-hosted-ephemeral.plan.md, packages/snapback-cli/hosted-control.mjs, packages/snapback-cli/index.mjs, issues/shelved/20260728-hosted-lifecycle-carrier-and-custody-gap.md]
examples: []
status: current
targets: [all]
maturity: partial
authoring-profiles: []
reviewed: 2026-08-08
reviewed-authorities-digest: sha256:6cb04e0ad71393216ec57d648a10ccc352a99e73955a5684e96ae8700caeef99
---

# Inspect hosted control

The packaged `snapback hosted` surface is present, but its provider-mutating
lifecycle is intentionally disabled. Planning and bounded reads work against
the retained control-plane contracts; lifecycle commands publish the exact
future vocabulary while refusing every effect before credentials or provider
I/O.

## Use the available read surface

The closed command registry begins with three non-lifecycle entries:

- `snapback hosted plan [--target <id>]` renders the package-owned driver,
  schema identities, availability, required evidence, and complete command
  inventory.
- `snapback hosted inspect --target <id>` reads bounded authenticated target
  inspection through the existing control plane.
- `snapback hosted logs --target <id>` reads bounded retained logs and supports
  the documented time, limit, and cursor bounds.

`snapback hosted operator-request` is the separate signed, certificate-pinned
supervisor transport command. Its existence does not enable lifecycle effects:
the lifecycle gate returns before transport submission.

## Read the complete lifecycle registry

`snapback hosted lifecycle --help` lists all 17 closed verbs. They are:

1. `acquire-lease`
2. `renew-lease`
3. `upload-immutable-release`
4. `provision-inactive`
5. `compatibility-preflight`
6. `create-verified-backup`
7. `stage-release`
8. `activate-generation`
9. `verify-served-path`
10. `rollback`
11. `fence-external-effects`
12. `restore-backup-inactive`
13. `verify-restored-components`
14. `verify-restored-application`
15. `activate-restored-generation`
16. `reconcile-effect`
17. `release-lease`

Unknown verbs fail as `SNAPBACK_HOSTED_LIFECYCLE_VERB_UNKNOWN`; a valid verb
with a valid V2 request returns the structured
`snapback.hosted-lifecycle-refusal.v1` envelope with
`SNAPBACK_HOSTED_LIFECYCLE_CARRIER_INCOMPLETE`. Its `recommendedNext` uses the
catalog refusal shape—`owner`, `ticketOrDesignPointer`, and `note`—and points
to the [hosted lifecycle carrier and custody GAP](repo:issues/shelved/20260728-hosted-lifecycle-carrier-and-custody-gap.md).

## Understand what must land before enablement

The blocker is not merely a missing executor. The current V2 carrier cannot
express the operation-specific authority and recovery facts required for safe
effects, and `releaseLease` is not an exception. Enablement requires all of:

- a separately reviewed closed per-operation carrier;
- Rust-owned schemas with exhaustive registry and unknown-field tests;
- supervisor-only opaque lease custody bound to expiry, provider version,
  supervisor generation, and control head;
- bootstrap, purpose-key custody, public mTLS listener, and wrong-role proofs;
  and
- a packed live Fly/Tigris journey covering reservation, interruption,
  recovery, head CAS, and zero premature capability advertisement.

Until the tracking ticket meets those criteria, availability stays `disabled`
for every lifecycle entry.

## Anti-patterns

- **Do not infer a listed lifecycle verb is usable.** Registry membership
  preserves vocabulary; `availability: disabled` is authoritative.
- **Do not special-case `release-lease`.** It shares the same carrier and
  opaque-custody blocker as the other 16 operations.
- **Do not supply provider credentials directly to the CLI.** Fly and Tigris
  authority belongs behind the supervisor/adapter boundary.
- **Do not call `hosted plan` a deployment plan.** It describes the closed
  hosted command surface; it performs no provider mutation.
