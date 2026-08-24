# Specify signed discovery for shared-host development

**Status:** Open
**Impact:** 2
**Urgency:** 2
**Ease:** 2
**Confidence:** 5
**Systems:** Client integration, Local server lifecycle, Auth, Code generation
**Date:** 2026-08-24
**Governing:** LLP 0301 §9; LLP 0302 §6; LLP 0300 P1

## Problem

URL-first development deliberately treats the configured loopback URL as the
backend-authenticity boundary. Identity discovery detects wrong-app and
wrong-generation mix-ups, but an identity fact visible to the client does not
authenticate a listener that can echo it. Shared or multi-user development
hosts need an opt-in stronger posture without weakening the shipped single-user
URL path or the supervised path.

## Required future Spec

Specify a store-minted dev-identity key that signs the identity fact, plus an
out-of-band client trust input and fail-closed client behavior when signed
discovery is configured. The future Spec must solve LLP 0301 §9's constraints
verbatim: **public-key carriage (a fingerprint alone verifies nothing), replay
by a replacement listener (freshness/transport binding), and rotation.** It
must also respect the codegen boundary: codegen runs without the store and
cannot bake a store-key fingerprint into generated application facts.

The work may add an optional `identitySignature` field without changing the
current unsigned identity fact's meaning. It must define key custody, trust
bootstrap, rotation/rollback, freshness and transport binding, client
configuration, diagnostics, compatibility, and release-artifact exclusion.

## Acceptance

- A reviewed Spec resolves all three named constraints and the codegen/store
  separation before implementation freezes a wire or storage shape.
- A configured client refuses unsigned, stale/replayed, wrongly signed, and
  rotated-without-trust-update facts before signup, login, or credentialed
  traffic.
- Unconfigured single-user URL-first clients and supervised clients preserve
  their implemented behavior.
