# Refresh Cloudflare identities after harness hardening

**Status:** Closed
**Severity:** P1
**Systems:** Cloudflare target, Handler runtime, Generated artifacts, CI
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-17
**Related:** LLP 0009 §Harness control-plane boundary; LLP 0040 §Persistent deployment identity
**Marker:** cloudflare, deployment-identity, harness, generated-artifact, proof

The Hermes rejection fix changed the shared `ctx-bootstrap.js` handler harness.
That file is also a transitive input to both Cloudflare handler bundles, so the
committed deployment identities no longer described the exact Worker bytes.
The canonical proof correctly stopped in its compatibility gate and named both
generated identity files as stale.

**Done when:**

- Both Cloudflare app identities are regenerated from the current transitive
  bundle/config graph.
- Only their bundle and inputs hashes change; schema identity remains stable.
- The deployment-identity check and the complete local Cloudflare suite pass.

## Resolution

`cloudflare/scripts/generate-deployment-identity.mjs` regenerated the Notes and
All Aboard identities. Their schema hashes and enumerated input sets remained
unchanged; only `bundleHash` and `inputsHash` advanced for the hardened shared
harness bytes. The manifest-owned Cloudflare proof then passed all 21 checks,
including compatibility and deployment-identity validation.
