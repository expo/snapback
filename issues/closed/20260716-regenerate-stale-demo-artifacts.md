# Regenerate and review stale committed demo artifacts

**Status:** Closed
**Severity:** P1
**Systems:** Codegen, Generated artifacts, Demos, CI
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-16
**Related:** LLP 0032 P3, LLP 0034
**Marker:** build-integrity

At `origin/main` commit `43314b7`, `scripts/verify-local-proof` fails in
`scripts/check-generated-artifacts`. Regenerating the committed demos changes
hashes in 34 files across Todo, Todo v2, All Aboard, the egress probe, Cursors,
Graffiti, and Card Game. The check reports that the committed generated
artifacts are stale and stops the canonical proof before its remaining gates.

This is not just cosmetic generated churn: the committed artifacts are the
runtime and acceptance boundary for schemas, functions, Contract data, and
remote-service publication. The regeneration diff needs semantic inspection
before it is committed.

**Done when:**

- Run `scripts/check-generated-artifacts` from a clean checkout and review the
  resulting schema, function, capability, and input-hash changes.
- Commit the intended regenerated output together with any source correction
  needed to explain unexpected drift.
- A second clean regeneration produces no diff.
- `scripts/verify-local-proof` proceeds past the generated-artifact gate.

## Resolution

Regenerated all 34 stale demo artifacts and reviewed their normalized JSON
diffs: every change is confined to bundle/input/schema identity hashes, with no
schema, function, capability, or operation semantic drift. The dependent All
Aboard Cloudflare deployment identity was regenerated too. A post-commit
regeneration is clean.
The required-surface production build also refreshed the Cursors Contract web
bundle against those regenerated inputs; its new content-addressed assets are
committed with the artifact update.

Follow-up on 2026-07-16: the subsequent public RBAC authoring change updated
the Cursors generated manifests again. The required-surface build produced a
new content-addressed JavaScript bundle and source map; commit `728c754`
records that output. The pinned canonical proof rebuilds this surface as a
required gate, so a clean proof also establishes that the checked-in bundle is
stable against the final RBAC inputs.

Follow-up on 2026-07-17: the opaque connection-grant identity and self-terminal
logout fixes subsequently changed the shared demo client and Contract runtime
bundled by Cursors. The required-surface gate regenerated the stale
`index-Cvlbg3PO` assets as the content-addressed `index-Br3fTKkW` bundle and
source map. The replacement is committed with this ticket update; a second
required-surface build reproduced identical JavaScript, source-map, and HTML
SHA-256 digests.

Follow-up on 2026-07-17: the final canonical proof also caught the dependent
Cloudflare deployment identities after later changes to
`packages/snapback-harness/ctx-bootstrap.js`, plus the regenerated All Aboard
functions and schema manifests. The earlier identity refresh had already
captured the `coordinator.js` and `gateway.js` changes. Regenerating both
committed identity files changed only their schema, bundle, and input hashes;
only the All Aboard schema manifest changed a schema hash. Their format and
enumerated input sets remain unchanged. The Cloudflare compatibility suite is
the freshness backstop for these derived identities.
