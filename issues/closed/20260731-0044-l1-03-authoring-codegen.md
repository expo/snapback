# 0044 L1-03: authoring surface and codegen

**Status:** RESOLVED. **Authority:** LLP 0007 dated amendment (spellings);
LLP 0044 §Generated upload intents, §Typed references.

packages/snapback-codegen: add defineAssetUpload({args, auth, reads,
accept:{mediaTypes,maxBytes}, delivery:{kind}, access:{read}, image?,
authorize}) with schema-validated authorizer output; v.assetRef(
options?: {upload?: string}) with v.optional/v.array({maxItems})
placements; defineTable(...).assetSharing(spec) on the closed union
public-read | owner(field) | membership(id, roles?). Generation rules:
location-bearing media types require an explicit location policy
(omission refuses at generation); strip requires the image-finalization
fact (refuses on lifecycle-only targets); one intent = one file task.
Codegen emits the assetUploadReference into generated api + validates
against the committed schema; the via-references deployment warning
lists non-sharing-declared tables reachable by the intent's fields.

Done when: fixture apps generate, refusal cases have structured
diagnostics, and generated references round-trip the schema gate.

## Resolution (2026-07-31)

Executed on branch 0044-lifecycle-v1: commit a468e69e. Evidence rows in
tests/acceptance/asset-lifecycle-v1-evidence.md; suites green at each
landing (asset lib, route_policy_v1, artifact_schemas_v0,
name_keying_guard, capability_v0, check-guide where touched).
