# Familiar Snapback after Clique M1–M3

This lane built Clique on published Snapback 0.1.29 using only the Familiar TypeScript profile: `schema.ts`, top-level `query`/`mutation` modules, generated `api`/`server`, and `useQuery`/`useMutation` from `@expo/snapback-react/familiar`. After three milestones the comparison that keeps coming back is not “is this Convex?” but “how much of Convex’s daily texture survived contact with Snapback’s contracts?”

## What felt like Convex

The authoring loop is the part I already know how to do. A table gets `defineTable`, a unique index, and a handler that `query().withIndex().take().collect()`s. Mutations `insert`/`patch`/`delete` and `ctx.refuse` with an app code. The React tree is `useQuery(api.feeds.page, args)` and `useMutation(api.posts.createPost)`. Live feed delivery in M2 — Alice posts, Bob’s Global tab shows the card without a refresh — was the Convex moment: the subscription is the product. M3’s DM list, once `chatKey` was actually populated, did the same thing. I did not write IR, SQL, or a sync engine. Familiar is a real TypeScript surface, not a thin rename of `schema.mjs`.

Sessions-mode auth is more ceremony than Convex’s `auth` object, but after the password `defineAuth` program existed, `signUpWithPassword` / `signInWithPassword` behaved like a hosted Auth API. Additive schema successors in the running `snapback dev --expo` lifecycle kept the original account rows. That is closer to Convex’s “push a new function, keep the data” than to PocketBase’s file-and-recreate reflex.

## What was not Convex

Every optional field is a small trial. `v.union([v.null(), v.string()])` is opaque structured JSON and cannot be indexed. `v.optional(v.string())` indexes, but document *results* still demand `null` for `requiredField` on `dmPair` / `quoteKey` / `avatar`. Convex treats missing and null as the same in most app code. Snapback’s result contract does not. Returning `v.doc("chats")` from `createGroup` failed until we stopped returning documents and returned `{ chatKey }` instead. That is a Snapback-specific tax I paid twice (M1 avatars, M3 chats).

Assets are not Convex file storage. `ctx.assets.attach` is mandatory; a raw id is `SNAPBACK_ASSET_REF_UNVERIFIED`. Uploads go through generated intents. That is stricter than `ctx.storage.getUrl`, and the Guide did not lead with it.

The lifecycle is also not `npx convex dev`. One owner process, `snapback.application-ready.v1`, supervised Metro, a Unix control socket for `reload-metro`, no `.env`, no wrapper. It worked. It is also a different product: you consume a receipt rather than picking a URL. When codegen lagged a schema edit, the UI called mutations that did not exist yet. Convex’s push is usually the same process that serves the client.

Ephemeral presence — the thing Snapback should win on — I barely used. The typing recipe wants a `.membership()` table and `allow.members()`. That is a lot of Snapback-specific authority surface for a 2s/5s indicator. I stored typing rows and deleted them on idle. That is the Convex-shaped cop-out, and it passed the typing choreography. Receipts, which *should* have been “the other client’s live query is the delivery event,” never closed: Playwright’s offline toggle and our InboxAck did not add up to `delivered` on Alice’s ticks. Convex would still need a delivery table; Snapback did not give me a first-class “this principal fetched this query” hook I could trust in the time I had.

## The Expo client is the other backend

Half of M2’s pain was Expo Router `Stack` leaving hidden `sm-feed-item` nodes so Playwright’s `.first()` timed out on a real card. RN-web does not map `accessibilityValue={{ text }}` to `aria-valuetext`. The frozen kit assumes the native accessibility object. We shimmed the vendored copy. None of that is Snapback’s fault, but Familiar’s React story is Expo, so it is part of the experience of *this* backend in this brief.

## Net

I like the Familiar handlers. I would write another social app on them. I do not like the optional-field/result-contract trap, the asset-attach surprise, or the distance between “live query” and “the other device has received the message.” Compared with Convex I moved faster on feed math and slower on anything that had to be null, indexed, and returned. Compared with a SQL backend I was grateful not to think about realtime. The profile saved me from explicit `functions.mjs`; it did not save me from Snapback’s document contracts. That split — Convex-like verbs, Snapback-specific receipts — is the whole story of M1 through M3.
