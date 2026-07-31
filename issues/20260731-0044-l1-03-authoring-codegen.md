# 0044 L1-03: authoring surface and codegen

**Status:** OPEN. **Authority:** LLP 0007 dated amendment (spellings);
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
