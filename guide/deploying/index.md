---
title: Deployment posture
id: deploying.index
order: 0
audience: agent-first
capabilities: [deploy.release-build, deploy.target-control, deploy.cloudflare]
authorities: [llp/0002-canonical-local-target.decision.md, llp/0040-cloudflare-narrow-proof.rfc.md, llp/0072-trusted-single-tenant-control-plane.rfc.md, llp/0111-fly-completion-and-hosted-ephemeral.plan.md, llp/0202-agentic-surface-audit-20260808.research.md, packages/snapback-cli/index.mjs, packages/snapback-cli/deployment-control.mjs, packages/snapback-cli/hosted-control.mjs, cloudflare/deploy.sh, issues/20260726-0072-fly-adapter-remaining-surface.md, issues/20260728-hosted-lifecycle-carrier-and-custody-gap.md]
examples: []
status: current
targets: [all]
maturity: partial
reviewed: 2026-08-08
reviewed-authorities-digest: sha256:b8d0b1c8db2169ff78afea78417374268e681164c440744c62ec88c7122a1297
---

# Deployment posture

**Snapback does not currently offer an end-to-end path that deploys an
arbitrary user application to any hosted target.** The local target runs an
app for development and testing, the Fly control plane stops behind evidence
and lifecycle gates, and the Cloudflare workflow deploys only two checked-in
proof apps. Treat those as three different boundaries, not partial steps of one
working product journey.

## Check where each path stops

| Target or surface | What works now | Exact stopping point | Tracking ticket |
| --- | --- | --- | --- |
| Local | `snapback dev` runs the canonical local dev/test target. `snapback deploy build` can create and verify a target-neutral immutable release closure. | Every release built by that command has `activationEligible: false` and blocking `gaps`; the command does not upload, provision, activate, or host it. Local is not a hosting adapter. | The selected first complete hosted path, rather than a local-hosting adapter, is tracked by [the Fly adapter remaining-surface ticket](repo:issues/20260726-0072-fly-adapter-remaining-surface.md). |
| Fly.io | Exact target registration, observation/doctoring, content-addressed planning, and the target-neutral lifecycle engine exist. Some Fly observation, backup primitive, supervisor, and custody evidence has also been retained. | Ordinary `deploy plan` output remains blocked, and `deploy apply` cannot obtain the zero-GAP adapter qualification and prepared release backed by the complete remote product journey. Upload, provision, activation, served inspection, migration, rollback, restore activation, and the final packed receipt remain open. | [Fly adapter remaining surface](repo:issues/20260726-0072-fly-adapter-remaining-surface.md). |
| Cloudflare | `cloudflare/deploy.sh` can build, deploy, activate, health-probe, and emit an exact-version receipt for the checked-in `notes` or `all-aboard` proof from a Snapback source checkout. | `SNAPBACK_CF_APP` is a closed `notes | all-aboard` selector. The script is not wired to `snapback deploy build`, does not consume an arbitrary generated application, and is explicitly not a general Cloudflare hosting product. | The current product path to arbitrary app deployment is the [Fly adapter remaining-surface ticket](repo:issues/20260726-0072-fly-adapter-remaining-surface.md); the Cloudflare profile remains deliberately narrow under LLP 0040. |
| Hosted lifecycle CLI | `snapback hosted plan`, `inspect`, and `logs` expose package-owned planning/read surfaces and the package publishes the exact lifecycle vocabulary. | Every one of the 17 `snapback hosted lifecycle` verbs returns `SNAPBACK_HOSTED_LIFECYCLE_CARRIER_INCOMPLETE` before credential resolution or provider I/O. | [Hosted lifecycle carrier and custody GAP](repo:issues/20260728-hosted-lifecycle-carrier-and-custody-gap.md). |

The Fly tracker appears for both the local and Cloudflare rows deliberately:
the project selected Fly as the first complete hosted product journey. There
is no separate commitment to turn the local target into a host or generalize
the Cloudflare proof before that work.

## Choose the honest path today

- For development and acceptance, use the local authoring loop; do not call it
  a deployment.
- To exercise the retained release and planning contracts, follow [immutable
  releases and deploy plans](./releases.md) and expect the documented GAP
  refusals.
- To redeploy one of the two repository proofs, follow [the Cloudflare proof](./cloudflare.md).
- To inspect the disabled hosted command surface, read [hosted control](./hosted-control.md).
- If the task requires an arbitrary user app at a public hosted origin, stop
  and report the relevant open ticket instead of assembling a private path
  around the gates.

## Anti-patterns

- **Do not describe `deploy build` as deployment.** It produces no provider
  effect or traffic activation.
- **Do not treat a deterministic lifecycle-harness receipt as remote
  evidence.** Its explicit GAP is the point of the harness.
- **Do not substitute `cloudflare/deploy.sh` for a general app adapter.** Its
  two proof apps and source-checkout inputs are closed.
- **Do not bypass a hosted lifecycle refusal with direct Fly or Tigris
  credentials.** The missing carrier and custody closure is an authority
  boundary, not a CLI inconvenience.
