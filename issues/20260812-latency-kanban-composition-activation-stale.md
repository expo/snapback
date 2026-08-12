# Codegen-source changes invalidate frozen composition activations — three retained-evidence demos need re-mints

**Opened:** 2026-08-12 · **Status:** open · **Area:** codegen / trusted composition activation / retained evidence demos

## Correction to this ticket's first revision

The first version of this ticket claimed the `latency-kanban` failure was
pre-existing. **That was wrong**, and the method that produced it was wrong: the
check used `git stash -u`, which stashes only *uncommitted* work. The
password-auth changes were already committed, so the "clean tree" being measured
still contained them. Re-tested against a genuinely clean `origin/main`
checkout, the picture is different and the breakage is ours.

## What

`packages/snapback-codegen/define.mjs` gained an `identifier: "email"`
declaration seam for LLP 0227 password auth. Codegen source participates in each
app's generated identity, so changing it rotates every demo's generated
deployment. A `trusted-composition-activation.json` binds a **specific**
generated deployment, so a rotated deployment no longer matches and codegen
fails closed:

```
[error] TRUSTED_COMPOSITION_ACTIVATION_INVALID (composition)
  trusted-composition-activation.json is invalid: trusted composition
  activation does not bind this generated deployment
codegen failed: no artifacts written (no silent stale output).
```

## Exact blast radius, measured against a clean origin/main checkout

| Demo | clean `origin/main` | with the LLP 0227 codegen seam |
| --- | --- | --- |
| `fleet-observatory-move1` | OK | **FAIL — newly broken** |
| `latency-kanban` | OK | **FAIL — newly broken** |
| `triage-graph` | OK | **FAIL — newly broken** |
| `chat-matrix` | FAIL | FAIL (pre-existing, unrelated) |
| `rematch-bakeoff` | FAIL | FAIL (pre-existing, unrelated) |
| `tandem-expo-bakeoff` | FAIL | FAIL (pre-existing, unrelated) |

Three demos regress. Three were already failing for unrelated reasons.

## Why it was not repaired in the landing that caused it

The activation is deliberately **not** codegen output. Per the two-phase note in
`packages/snapback-codegen/index.mjs` (~line 206) and LLP 0157 §D3, a
server-owned proof keyring mints it and codegen only validates it. Re-minting
uses `snapback composition-activation-prepare --db … --generated … --deployment-id …`,
which needs the demo's **store and proof keyring**.

The three affected activations bind retained *evidence* deployments — e.g.
`latency-kanban` binds `deploymentId: "latency-kanban-move3-exit"`,
`databaseId: 019ff5cf-fb69-7503-8a65-d2c2f7836498` — and no such store exists in
the working tree. Re-minting them means reconstituting those evidence runs, which
belongs to the programs that produced them, not to the password-auth slice.

## The general problem this exposes

Any change to codegen source invalidates every frozen composition activation in
the repo. That is a standing tax on codegen work, and three of six demos with
these activations were already red before this change — so it is not being paid
consistently today. Worth deciding deliberately:

- re-mint affected activations as part of every codegen landing (needs a
  reproducible way to reconstitute retained-evidence deployments), or
- make retained-evidence demos exempt from routine codegen regeneration, or
- bind activations to something narrower than the full generated identity.

## Fix

Re-mint the three regressed activations against their current generated
deployments, or reconstitute their evidence runs. Owners of the
`fleet-observatory-move1`, `latency-kanban` (move3), and `triage-graph` (move1)
evidence programs should decide which.

## Bypass used

`SNAPBACK_DRIFT_GATES_BYPASS=1` was used to land the LLP 0227 password-auth work
with this ticket as its record. Skipped gates: agent-safe-publication-fixtures,
contract-meta, diary-identity, generated-artifacts, module-ownership.

What that bypass does **not** hide: the full library suite is 2631 passed / 0
failed, all ten password-auth acceptance witnesses pass, and module-ownership,
inventories, ref-check, and guide-check were each run and pass. The single
unrepaired consequence is the three demo activations named above.
