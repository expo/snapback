# Asset upload/delivery DX papercuts: client-arm signed issuance, default variant, mapping diagnostic, one-call upload helper, delivery recipes (LLP 0208 G11)

**Status:** Open — implementation landing (design ruled by LLP 0210, super-refine converged 2026-08-09)
**Progress (2026-08-09):** D4 codegen admit+teach landed `802d08cb2`;
D1/D3 client surface (`assets.signedUrl`, issued-URL controller,
`assets.upload`, typed retry eligibility) landed `402dfacd2` with the
`asset-upload-dx` metrology rollover; D2 server (optional variant →
`primary`, typed `SNAPBACK_ASSET_REQUEST_INVALID`/`SNAPBACK_ASSET_VARIANT_UNKNOWN`,
authorization-precedes-enumeration) landed `e8e67c0e9`. Remaining:
`useSnapbackAssetUrl` React projection (in flight) and the guide
work (item 5). D5(b) grant ops are author-gated on LLP 0210 acceptance
(companion G4 ticket).
**Severity:** P2 (every media app hits these immediately; all have workarounds discovered by probing)
**Systems:** Assets, Headless client, React/Expo, Server, Diagnostics, Guide
**Date:** 2026-08-09
**Related:** LLP 0044 (asset pipeline — §Delivery profiles, §Client upload
surface), LLP 0180 (asset-bearing commands — §Declaration), LLP 0208 (pilot
evidence, G11), LLP 0061 (guide pipeline)

## Problem

The LLP 0201 P2 pilot (Clique, snapback lane) found the upload happy path
excellent ("three lines; trusted finalization + variants just happened") but
the delivery/edge surface cost most of an afternoon of probing. B5 scored
62/100 with these concrete causes:

### 1. Signed-URL issuance has no client-arm method

`POST /assets/records/{id}/signed-url` is documented in
`guide/backend/assets.md`, but no SDK method performs issuance:
`packages/snapback-client/assets.mjs` has `deliveryUrl()` (pure URL
construction) and nothing that calls the issuance route. The pilot
hand-rolled a fetch with the bearer + `x-snapback-auth-client-protocol: 1`
header — discovered by probing — then hand-built a 30-second URL cache on
top (`clique/src/lib/data.ts`).

This is an **implementation gap against the accepted design**: LLP 0044
§`private-signed` states "The generated client refreshes it before expiry,"
and §Client upload surface promises React helpers with "automatic refresh of
bounded signed delivery URLs before expiry." Neither exists.

### 2. Empty issuance body 422s instead of defaulting the variant

`AssetSignedUrlIssueRequestV1` (src/assets.rs:1140) declares
`variant: String` with no serde default, so `{}` dies as an axum
deserialization 422 with no `SNAPBACK_*` diagnostic. The pilot had to guess
`{"variant":"primary"}` (video) / `{"variant":"chat"}` (images). An invalid
variant should also return a typed refusal naming the intent's declared
variants.

### 3. `SNAPBACK_COMMAND_ASSET_MAPPING_INCOMPATIBLE` doesn't name the fix

A non-optional command asset child demands a required `v.assetRef` mutation
arg, which fights the common "one mutation accepts image-or-video" shape.
LLP 0180 §Declaration already admits `optional: true` children — the pilot's
dev log shows the refusal names the rule ("must map to a required
v.assetRef(...) mutation argument") but not the escape; the builder found
`optional: true` + handler validation on their own. Secondarily: consider
whether a *required* child feeding an *optional* mutation arg should be
admitted (the command guarantees presence), or document why not.

### 4. No one-call upload helper that accepts what pickers give you

`assets.start()` wants a `File`; Expo pickers hand you a URI. The pilot's
`uploadPicked()` (fetch URI → blob → `new File` → `start` → await
`task.done` → status check) is boilerplate every app rewrites, and the
terminal-state check is genuinely confusing — the pilot's code checks
`status !== 'ready' && status !== 'finalized'` then re-checks
`failed`/`rejected` because `task.done`'s settle contract isn't crisp at the
call site.

### 5. Guide gaps (LLP 0061 §5)

Learned by probing rather than reading: the issuance body shape and required
variant; the protocol-offer header on issuance; the optional-children rule;
signed-URL TTL/caching guidance. Additionally the pilot's **per-recipient
grant rows / transfer-at-open** view-once pattern (~80 lines, survived every
hostile probe: 403 before open, 200 during, 403 after close) deserves a
recipe — it is non-obvious precisely because `ctx.assets.attach` is
owner-only. (The design-shaped grant-primitive question is the companion
ticket `20260809-asset-recipient-grant-authority-g4.md`.)

## Done when

- The asset client exposes signed-URL issuance (e.g.
  `assets.signedUrl(assetId, { variant?, widthPx?, ttlMs? })`) working under
  both AuthCoordinator and external-bearer custody, and the React arm
  exposes a TTL-refresh-aware projection (hook or renderer prop) per LLP
  0044's existing promise.
- Issuance with no `variant` defaults to `primary`; an unknown variant
  returns a typed `SNAPBACK_ASSET_*` refusal naming the declared variants;
  a malformed body never surfaces as a bare framework 422.
- `SNAPBACK_COMMAND_ASSET_MAPPING_INCOMPATIBLE` names the
  `optional: true` child escape in its message/details; the
  required-child→optional-arg pairing is either admitted or its refusal
  explains why.
- A one-call helper (e.g. `assets.upload(uploadRef, fileOrPickerAsset) →
  Promise<assetId>`) accepts File/Blob/`{uri, mimeType, fileName}`,
  resolves on ready, rejects on any non-ready terminal state; `task.done`'s
  contract is documented at the call site.
- `guide/backend/assets.md` (or a recipe page) covers: issuance body +
  headers by custody mode, variant selection, TTL/refresh guidance, the
  optional-children pattern, and the view-once grant-rows recipe.
- Each fix lands with its own scoped evidence per LLP 0189; guide snippets
  pass `node scripts/check-guide.mjs`.
