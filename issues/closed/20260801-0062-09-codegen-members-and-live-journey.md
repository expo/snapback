# 0062-09: codegen emits envelope members; the live-binary served journey

**Status:** CLOSED. **Authority:** LLP 0062 §5 (server-composes ruling,
2026-08-01); tickets 01/02's closures; LLP 0012 §Dated registration:
provision envelope members (2026-08-01).

Two halves complete the served story end to end:

1. **Codegen emits the members carrier.** Nothing produces
   `ApiEnvelopeMembersV1` yet, so every real provisioning activates
   envelope-absent. Codegen owns the members (the operations map — one
   args schema per stable function id — the `appBindings` declaration,
   and their member digests per the frozen domains) and should emit them
   beside the existing artifacts; the managed ensure flow attaches them
   to the provision request. The digests must match the Rust authority's
   domains byte-for-byte (the cross-language anchor in
   `envelope.test.mjs` / `api_envelope.rs` is the fidelity gate).
2. **The live-binary zero-local-files journey.** With members emitted, a
   packaged engine against a real sessions target discovers, fetches,
   verifies, and calls through the served envelope with zero local
   artifact files (ticket 02's original done-when, at full fidelity),
   plus the 0062-03 settlement goldens that wanted the same real-server
   harness (deploy-mid-call refetch, deploy-mid-watch resync,
   removed-function recovery, kill-between-dispatch-and-ACK replay).

Also riding here: flipping `appCliTarget` true once 0062-05 mints the
eligibility capability id, so discovery advertises what the engine can
already consume.

---

**RESOLVED 2026-08-01.** Both halves landed in commit `8a6731df`.

*Codegen member emission:* `packages/snapback-codegen/api-envelope-members.mjs`
builds `{operations, declarations, memberDigests}` from the function manifest
and the already-rendered operation schemas — operations keyed by stable id,
`appBindings` carrying kind-specific callable signatures (LiveQuery →
`AsyncIterable<unknown>`, everything else → `Promise<unknown>`), digests over
JCS-canonical schema bytes and the raw declaration text. Emitted as
`generated/api-envelope.members.json` and listed in the artifact index; the
managed provision path (`packages/snapback-cli`) attaches it and
`SnapbackClient.ensureApp` carries it on the provision intent only.
`api-envelope-members.test.mjs` is the **third leg of the cross-language
anchor**: the member digests are pinned verbatim against the same anchor the
Rust authority and the engine already pin, so a canonicalization or domain
drift in any of the three breaks that side's suite.

*Live-binary journey:* `tests/acceptance/app-cli-served-journey.mjs` with the
minimal sessions fixture `tests/acceptance/fixtures/app-cli-journey/`.
16/16 against a real spawned binary: codegen emits → cold sessions boot is
honestly envelope-absent (and the engine refuses in identity terms, exit-7
class, not "unavailable") → managed provision composes → discovery names the
envelope and carries the active tuple → content-addressed fetch verifies
client-side → composed members round-trip byte-equal to codegen's → a tampered
byte refuses → the engine drives the served surface with zero local artifact
files, carrying the five-key generation → offline introspection serves from the
verified cache → redeploy recomposes, rotates the envelope identity, and the
engine follows → sessions bearer custody still works.

Closure verification on `origin/main`: `8a6731df` is an ancestor of main;
`packages/snapback-codegen/api-envelope-members.mjs` is present and the
registered `tests/acceptance/app-cli-served-journey.mjs` remains the 16/16
live-binary evidence.

*Defect found and fixed by the journey:* the `/app-api/*` routes are
credential-free by construction, but the sessions-mode protocol-offer gate
refused them, so an engine could never discover a sessions app — the same
class the pasteable delivery lanes hit (a bare public artifact route cannot
negotiate a protocol it has not yet learned exists). `src/server.rs` gains
`bare_public_artifact_route`, the same structural-properties-AND-closed-path-set
predicate shape as `pasteable_delivery_route`, so no future public route
inherits the exemption by shape alone.

*Not done here:* the 0062-03 settlement goldens. The harness they wanted now
exists (this journey), and the four cases are unchanged — see that ticket.
