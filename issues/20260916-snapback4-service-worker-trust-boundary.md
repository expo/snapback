# Snapback 4: Distinguish service principals from trusted worker credentials

Status: Open
Priority: P2
Observed: 2026-09-16
Baseline: `a0d48a4e6b660e2bfca3de3ef3470ef7787f3d15`

## Evidence and adjudication

Grok findings 1–2 correctly trace any service token claiming named actions/effects and provider verification tickets, then executing under the admitted caller/declared route principal. This is not presently a bypass of a per-seat worker ACL: the supported supervised worker is intentionally service:worker for all handlers, route tests require that shape, and any service also has /auth/session and /auth/revoke account-administration authority. Sol independently identified the same boundary as a design question.

The unsafe ambiguity is treating a named service seat as an isolated credential for a partially trusted integration. Row rules constrain direct data-plane calls under that principal, but worker/admin endpoints carry broader trust. Binding only route verification to the route's seat would break the supported runtime and leave action claims and account minting unchanged.

## Acceptance

Document the current deployment-wide trust of service tokens next to token provisioning and server handlers. Decide whether partially trusted integrations are supported. If so, introduce separately scoped worker, verification, identity-administration and data-plane capabilities; enforce them on claim, cancellation, session mint/revoke and settlement with revocation tests. Preserve caller authority on delegated handler queries/mutations. Do not imply capability separation exists before implementing it.

The immediate documentation clarification can land; the capability redesign remains open in LLP 3000.009's dated review section.

## Partial repair — 2026-09-16

`packages/snapback4/SERVER.md` now states the deployment-wide trust next to
worker provisioning and service tokens. LLP 3000.009 §16 records the alternatives.
The ticket remains open for the product decision and capability separation;
no isolated-integration guarantee is claimed.
