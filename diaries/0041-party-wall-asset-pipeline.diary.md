# Diary 0041 — Party Wall: first real consumer of the asset pipeline

**Demo:** `demos/party-wall` — a party-photos wall exercising the full LLP
0044 surface (strip uploads, variants, via-references membership sharing,
public covers, signed URLs, deletion, reference GC, seed fixtures).
**Agent:** Claude (Fable 5), the session that built the pipeline — maximally
biased toward it, which makes the frictions below more credible, not less.
**Date:** 2026-07-31 (entry 1, mid-build; finalized at landing)

## Findings so far (recorded as hit, before the outcome smooths them over)

1. **You cannot live-query a table that contains a `v.assetRef` field.**
   `defineLiveQuery` over my `posts` table failed codegen with
   `SNAPBACK_HANDLER_RESULT_CONTRACT_INVALID: unsupported result validator
   {"AssetRef":…}` — the live-query result contract has no AssetRef leaf.
   This is the single biggest surprise: the flagship feed shape ("a wall of
   posts with photos") cannot be expressed as authored. Workaround: split
   tables — the live-queried `posts` row carries a plain-string display
   copy of the asset id, and the typed reference + sharing declaration live
   in a side `photoShares` table the wall never queries. It works, and the
   sharing model is unharmed, but no app developer would guess this; in
   Convex the file-id field is just a string in the document and the feed
   query returns it without ceremony. Filed as a guide-gap/defect ticket —
   the result-contract vocabulary should admit AssetRef (serialize as the
   id string) or the guide must teach the split-table pattern prominently.

2. **"My events" — a membership-gated live query over the resource table
   itself — is not expressible.** `membershipResource.rowField('_id')`
   refuses (system fields are not addressable). Shindig hit the same wall
   and denormalized an invites table; I dropped the query. Known pattern
   for membership veterans, invisible to newcomers.

3. **Sessions mode versus the operator lane.** Host-op impersonation
   (`userId`) is refused wholesale in sessions mode
   (`SNAPBACK_AUTH_BODY_AUTH_UNSUPPORTED`), so the W2f seed-fixture flow —
   which ingests through `asset.ensureSeedFixture` under a user — cannot
   run against the sessions server the rest of the demo needs. The
   conformance suite quietly worked around the same split with two
   servers; a demo author discovers it by 400s. (Resolution below: the
   fixture leg runs on a dev-mode sibling server, honestly labeled.)

4. **`clientStoreId` must be a "canonical opaque id"** — my
   `store-ada@example.com` spelling poisoned live-query establishment with
   `SNAPBACK_AUTH_INVALIDATION_CORRUPT` several checks downstream of where
   the id was chosen. The diagnostic is precise but fires far from the
   mistake; the constructor should validate.

5. **Signed URLs are per-intent, not per-request.** Obvious in 0044
   retrospect (delivery policy follows the asset), but the product shape
   "mint a share link for this existing wall photo" is inexpressible — the
   wall photo is `private-strict` forever. The demo adds a separate
   `private-signed` intent to show the mechanism; a real product would
   want a copy-to-new-profile flow. Worth a capability-index note.

## What Just Worked (so far)

- The upload task: `assets.start({upload, file})` → `ready` with required
  variants, end-to-end verified, in one await. Genuinely nicer than the
  Convex three-step (generateUploadUrl → POST → storageId in mutation).
- `ctx.assets.attach` in a handler reads exactly like the guide snippet,
  and the forged-string refusal means nobody can quietly skip it.
- Codegen refusals were mostly excellent teachers: the mandatory location
  policy refusal names the missing field; the sharing-declaration warning
  lists uncovered tables.
- GPS stripping needed zero demo code. The privacy story is free.

*(Entry continues at landing with the suite outcome, the React arm, and
the comparisons.)*
