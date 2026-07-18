# Refresh the Cloudflare guide after proof hardening

**Status:** Closed
**Severity:** P2
**Systems:** Guide, Cloudflare target, Acceptance testing
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-17
**Related:** LLP 0040; LLP 0061
**Marker:** guide, freshness, cloudflare, proof

The final Cloudflare protocol-proof hardening revised LLP 0040 after the
Cloudflare deployment guide's last intentional review. The guide checker
correctly warned that an authority had changed, even though the user-facing
deployment procedure and target capability posture were unchanged.

**Done when:**

- The Cloudflare guide is intentionally re-reviewed against the updated LLP
  and proof implementation.
- Its review identity is pinned to the exact authority commit.
- Generated guide projections are refreshed and the guide check reports no
  freshness warning.

## Resolution

The page remains accurate: the local command still runs the manifest-owned
21-check Cloudflare gate, and the new `Expect: 100-continue` detail changes
only how one oversized-body regression proves the existing bounded parser.
The review metadata now pins commit
`069843fa72278a049e490233c68744a28c7fad70`; both generated guide projections
were regenerated from the reviewed corpus.
