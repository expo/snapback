# LLP 0249 egress-admission-v1: per-destination grants and classifier authority

**Status:** Open
**Severity:** P1
**Systems:** Actions, runtime egress, isolation broker, schemas
**Date:** 2026-08-12
**Related:** LLP 0249 D3; `archive/spike-isolated-node-action/schemas-draft/egress-admission.v1.json`; `archive/spike-isolated-node-action/schemas-draft/globally-routable-unicast-v1.vectors.json`

## Problem

Actions currently have only the process-wide `outbound_actions_enabled`
boolean (`src/runtime.rs:4744-4760`). That switch cannot represent LLP 0249's
per-action, per-destination authority. The webhook SSRF checks in
`src/webhooks.rs:95-140` are useful precedent, but their classifier is
unversioned and unreachable from actions.

The spike admitted exactly one brokered request —
`GET https://api.github.com/user`, returned locally as
`broker-stub:no-network` — and drafted `egress-admission.v1` plus 13
`globally-routable-unicast-v1` vectors. That demonstrates the declaration and
receipt shape only; it does not implement destination enforcement.

## Required design

- Define exact scheme/host/port grants, request-method and redirect behavior,
  DNS answer-set binding, rebinding handling, and mixed-answer refusal.
- Make `globally-routable-unicast-v1` a versioned, digest-bound fact table for
  canonical IPv4/IPv6, mapped/translated/scoped forms, metadata, reserved
  ranges, and resolver results.
- Bind the classifier and grant to live isolation attestation and every action
  attempt receipt; refuse if either identity changes.
- Reconcile or replace the webhook classifier so two security authorities do
  not drift independently.

## Completion

An accepted schema/design and adversarial tests show that an isolated action
can reach only its declared destinations, including after redirects and DNS
changes, and that an unclassified or mixed address set fails closed with a
stable remediation-bearing diagnostic.
