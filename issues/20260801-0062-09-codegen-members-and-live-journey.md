# 0062-09: codegen emits envelope members; the live-binary served journey

**Status:** OPEN. **Authority:** LLP 0062 §5 (server-composes ruling,
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
