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

## Findings, continued (the suite and the browser found more)

6. **Seeded resources under a protected membership need their holder
   seeded too.** The versioned-seed install refused my seeded event with
   `SNAPBACK_MEMBERSHIP_ACTIVATION_UNPROTECTED_RESOURCE` until the seed
   also carried the host's `eventMembers` row. The protection is *right*
   (no orphaned resources), and seeding roster rows turned out to be
   admitted — but nothing taught me that; I expected the raw-write refusal
   handlers get. One guide sentence would have saved the round trip.
   Related: the seed-version evidence ledger (`SNAPBACK_SEED_VERSION_
   REUSED` when I edited seed bytes under one version) was a pleasant
   surprise — 0109's discipline catching exactly the mistake I made.

7. **Sessions mode gates every request behind the auth-client protocol
   header — including "public" URLs.** `public-immutable` covers and
   `private-signed` bearer links both 400 without
   `x-snapback-auth-client-protocol: 1`. That breaks the pasteability that
   is these profiles' whole story: no plain `<img src>` from another
   origin, no CDN pull, no share-link-in-an-email. The suite sends the
   header to prove the lanes; the product gap is filed. Similarly, there
   is no browser-safe sessions sign-in for demos — Party Wall's web arm
   reads the dev mailbox with the admin token in a Vite env var, which is
   fine for a trusted-local demo and unacceptable as the story.

8. **The asset client couldn't bundle for the browser.** First real
   `vite build` of any demo over the headless client:
   `"createHash" is not exported` — the per-chunk checksums used
   `node:crypto`. Fixed in this landing (incremental FIPS 180-4 fallback,
   cross-checked against node:crypto by the package test), but it says
   something that five waves of Node-side tests never opened a bundler.
   Demos are the integration test Node suites cannot be.

## What Just Worked (final)

Everything in the mid-build list held, plus: the whole
grant/revoke/never-member matrix passed on the first run that reached it —
the sharing model needed zero debugging, ever, across the entire build;
the referenced-delete refusal and cascade behaved exactly as specified on
first contact; the ThumbHash placeholder arrived server-side with no demo
code; and the dev-sibling trick (regenerate the same app with dev auth)
took ten lines because codegen is a callable library.

## Compared honestly

Against Convex (the 0116–0127 baseline): Snapback's upload ergonomics are
better (one task vs. generateUploadUrl choreography), and nothing in
Convex approaches the sharing model — file ACLs there are handler
convention. But Convex would never have hit findings 1 or 8: its file ids
are plain strings in documents (feeds just work) and its client always ran
in browsers. Snapback's stricter model bought real privacy and real
authorization; the price is that the common shapes (a feed with photos, a
pasteable public URL) currently need workarounds a Convex developer would
never meet. Supabase Storage sits in between: RLS-adjacent policies exist
but live in a second system with its own policy language; Snapback's
one-declaration sharing is genuinely nicer *when the tables cooperate*.

## Verdict

The pipeline's core is excellent and the demo proves it end to end on a
real server. The remaining distance to "feels effortless" is concentrated
in four places: AssetRef in live-query result contracts (finding 1), the
sessions header on public/signed lanes (finding 7), a browser sign-in
story (finding 7), and the guide teaching the membership/seed patterns
(findings 2, 6). Tickets filed for each; none is structural.

