# Clique on Snapback 4 — what the work felt like

This lane was a cold build of Clique (social + messenger) on the published Snapback 4 surface: `snapback4@0.2.10`, `snapback4-expo@0.2.3`, Quarry in `snapback/*.q`, Expo Router on web plus an iOS Hermes export. I did not open a Snapback source tree or another Clique lane. What follows is the comparison that run actually produced, not a reconstruction from an older generation.

## Where the backend reduced friction

The unit of backend work is one language. Tables, read/write rules, `sync` audiences, `expire at`, `image`/`video` columns, `maintain` counts, merge feeds, `matching` search, jobs, and `use identity` live in the same file. That is a different shape than Convex (TypeScript functions plus a looser document model) or Supabase (Postgres + RLS + Auth + Storage + a second client). Clique’s product rules — unique handles, follow caps, DM pair reuse, group admin gates, edit/delete windows, disappearing TTLs, view-once — compiled as schema instead of as a second policy layer.

`snapback4 check` is the tightest feedback loop in the stack. A structural fan-out, a missing horizon, a write that could not see another principal’s row: each came back with a rewrite hint and a guide card. That is closer to a typechecker than to Postgres “then you find out at request time.” Convex’s `npx convex dev` is similarly tight for functions; it does not encode sync audiences or asset placement as language. Supabase’s friction at this step is split across SQL, policies, and the dashboard.

Identity was cheap. `use identity` plus `signup`/`login` from `snapback4/auth` and `keepSession` was enough for M1. No JWT wiring, no `auth.users` trigger to copy into `profiles`. Handle uniqueness was a `unique byHandle` on the same table.

Assets were cheap when they worked. `client.upload(file)` then `{ id }` in a mutation is less than standing up Storage buckets and signed URLs. The published README’s JPEG/PNG/WebP/MP4 sniff matched the brief. Video duration is a fact on the receipt, so `require duration <= 60000` is a schema line, not a ffmpeg sidecar.

Live queries on public, *synced* tables were the good path. Once likes and reposts had `sync public last 2000 by byTime`, `likesOf` became a device query with a `likes by byPost` horizon, and Alice’s like count moved. Timeline inserts already live-updated the global feed. That is the Convex-shaped “subscribe to the query” experience, except the subscription is derived from the schema rather than from `useQuery` plus an index you remember to add.

The scale replay was a backend-shaped win. A second `--fresh` instance on 49342, the M6 adapter, 167k actions, named O5 checks for u0500/u0005/u0900/u0901: pass in 453s. I did not write a custom fan-out service.

## Where it added friction

The web client I shipped is `createClient` (online HTTP + `/changes`), not the wasm local replica. That was a reliability choice after the wasm URL resolved to HTML and Playwright against IndexedDB was the worse of two live paths. The cost is real: device queries without a replica either go to the server with incomplete horizons or they do not live-update. `likeCounts` is `online only`; putting it in `globalFeed` made the whole feed a server query whose horizon listed timeline/posts/profiles and *not* likes. Bob’s like never moved Alice’s card until likes themselves were synced.

`dailyActivity` with `read <- .principal = viewer` made `setLike` fail when Bob incremented Alice’s daily tally: the lookup returned null, the insert collided with a row he could not read. The diagnostic told me to `upsert` under an `update` rule. The fix was to make the tally public. Convex would have been an internal mutation with no row-level read; Supabase would have been a security-definer function. Snapback made the visibility of the increment a schema problem, which is honest, and easy to get wrong.

Sync is not optional if you want live UI on the online client. Unsycned public tables still query, but `likesOf` compiled as `runs: server, horizon: none`. The README says `useQuery` re-renders when a sync or prediction touches the query’s tables. No sync, no tick. I had to discover that from generated `api.ts` comments, not from a “this query will not live-update” banner.

The host environment fought the published binary: ad-hoc-signed `darwin-arm64` stalled at `_dyld_start` when stdio was inherited. That is not a Snapback language issue, but it is a published-package issue on this Mac. Convex and Supabase would have been `npx convex dev` / `supabase start` with less Gatekeeper drama (Supabase wants Docker, which this overlay forbids).

Playwright against React Native Web was the long fight, and it is only partly the backend. Controlled TextInputs swallow `fill`; nested `Pressable`s steal clicks; `View testID` is not always a `data-testid` article; a thread with 29 bubbles each polling `receiptsOf` starved `mutate` so `sendMessage` never left the browser. Convex’s generated React client against DOM would have failed in some of the same ways. The backend-shaped part is that device queries plus an online-only web client invite a poll storm as a workaround, and the poll storm then breaks writes.

Offline is a product of the local replica. `createClient` has nothing to queue. M6’s “send two messages offline, flush in order, pending receipts” cannot green on the web path I chose. `snapback4-expo` is the native arm and is pinned; I did not drive a simulator. That is a fork Convex also has (Convex is online-first unless you add your own outbox) and Supabase has (realtime is online; offline is your problem). Snapback *has* a local replica; I did not keep the web app on it.

## How the shape of the work changed

On Convex I would have spent M2 on indexes and `ctx.db.query` plus a scheduled fan-out, and M3 on a messages table with `withIndex`. The product logic would have been TypeScript I already speak. Live queries would have been the default. I would have written more imperative code and less “is this a horizon site.”

On Supabase I would have spent M1 on Auth and RLS, M2 on SQL views or a following-feed table, M3 on Realtime subscriptions and Storage. The brief’s server-enforced expiry would have been a cron or a `pg_cron` job, not `expire at .expiresAt`. Search would have been `pg_trgm` or an external index. The work would have been more systems and less one-file product.

On an earlier Snapback generation I would have expected more of the same language with worse diagnostics. 0.2.10’s `check` notes (`N_WIDE_MERGE`, `N_NO_HORIZON`, `N_NEVER_COMPLETE`, `E_STRUCTURAL_FANOUT`) are the product. They changed the work from “guess why the replica is empty” to “the compiler named the site.” They did not name “this query will not live-update on `createClient` because the table is unsynced.” That gap still cost a correction loop.

The work this backend *is* good at: encoding Clique’s rules so the suite — Node `createClient` against mutations and queries — goes green without a second policy runtime. M1 through M8 acceptance all passed. The scale replay passed named O5. The work it is weaker at, in this published pin, is the Expo-web + Playwright bar when the client is not the local replica: live likes needed an extra `sync`; live DMs needed a native `<article>` and a native `<textarea>` and a cease-fire on per-bubble polling; offline never existed on the web path.

I would choose Snapback 4 again for a product whose hard part is authorization and sync, and whose clients can stay on the replica. I would not choose the online `createClient` web path again for a two-browser choreography bar without first proving every query’s horizon in `api.ts`. Convex would have been faster to a live like tick on web. Supabase would have been slower to a correct follow-feed. This pin is in the middle: the schema is the product, and the client arm you pick decides whether the schema’s liveness actually shows up on screen.
