# Clique on Snapback 4 — compared with Convex and Supabase

This lane built Clique, a WhatsApp-shaped messenger with a public follow graph, as a Quarry schema (`snapback/*.q`) plus an Expo Router client on `snapback4@0.4.7`. The comparison below is from this cold session, not from a prior Clique port.

## Where Snapback reduced friction

**Identity and uniqueness landed in the schema.** `use identity password` plus `unique handle else HANDLE_TAKEN` replaced a Supabase Auth + profiles table + unique index migration, and replaced Convex's "auth then `users` document" two-step. Sign up, session tokens, and handle conflict were a compiler-checked program, not a dashboard.

**Feeds are a language feature.** `view activity` unioned posts and reposts; `view following` filtered by the follow table. Convex would be an index plus a query function; Supabase would be a view or a join you keep in sync with RLS. Here the Following tab is the view. Unfollow projection is "the view no longer contains those rows," not a fan-out delete.

**Receipts and expiry are bound to the engine.** `reports delivery of messages by .conversation, .ordinal`, `retain delivered-history`, `expire at .expiresAt`, and `image once` are the kinds of rules teams usually encode as triggers, crons, or client conventions. The receipts card in the published guide is close enough to Clique that the suite for sent/delivered/read and view-once denial passed without a custom worker.

**One process in dev.** `snapback4 dev --port 56400 --bind 127.0.0.1 --no-watch` is the backend. No Docker, no `supabase start`, no Convex deployment hop for the first write. Generated `api.ts` appears from `snapback4 check`. The custom-client demo is the same `createClient` the React tree uses.

**Push is an effect, not a vendor.** `effect notify` plus a `server.mts` function that appends JSONL is the M6 seam. Convex actions and Supabase webhooks would both work; neither is a one-file loopback log with the payload shape in the mutation.

## Where Snapback added friction

**The client is the product, and RN-web is not in the guide.** Choreography reads `aria-valuetext` / `data-value`. React Native Web does not map `accessibilityValue` there. Playwright `fill` does not always drive a controlled `TextInput`. `setInputFiles` does not always fire React `onChange`. Those are not Snapback defects, but they dominated wall clock after the schema was green — the same class of pain as shipping a Convex app through Expo web, except the benchmark treats them as the lane's problem.

**Loading is a loaded gun.** `useQuery` returning `{ loading: true }` on a refetch unmounted `EnsureProfile` and with it Expo Router's `Slot`, which reset `/conversation/bob` to `/`. Convex `useQuery` undefined-while-loading has the same trap; Snapback's generated hooks make it easy to write `if ("loading" in profile) return null` at the root. The guide says not to unmount the signed-in tree. I still did, then spent hours watching Playwright time out on `sm-convo-input`.

**Prediction and online-only tables shape the UI.** Likes, follows, reactions, and typing are `online only`. Send can predict; those toggles cannot. Offline M6 therefore needs pending glyphs and an intent journal, not "the mutation returns the new like count." Convex optimistic updates are an application pattern you choose. Snapback tells you, at `check`, which mutations never predict. That is honest and it forces more local state than a naive Convex port.

**Group receipts are exact.** The aggregate is membership at send time. The starter group includes Erin. Choreography opens Alice, Bob, and Carol. Erin never fetches, so the ticks stay `sent`. A SQL backend would let you cheat with a query that only counts "active" members. Here the function is the spec. Removing Erin after seed made the check possible; leaving her in is more faithful to the fixture and makes the check structurally fail.

**Scale replay is a second clock.** `--fresh --replay` on port 56402 is the right isolation. 167k actions with media uploads is still a long sequential HTTP loop. Convex import and `pg_dump` are not nicer at this size, but they are well-trodden. Snapback's adapter is the app's own mutate path, which is the point of the benchmark and also why wall time is dominated by round-trips.

## How the work changed shape

On Convex I would have spent M1–M2 on schema in `schema.ts`, indexes, and a handful of query/mutation functions, then fought the same Expo Router and RN-web issues. On Supabase I would have spent that time on RLS policies, storage buckets, and a realtime publication. Snapback moved that time into Quarry: views, `sync to members`, `held` search, jobs, effects. The schema file is the backend. There is no second "API layer" except `API.md` teaching `createClient`.

What did not move: the UI kit, Playwright, Expo web, and the always-on chrome (feed tabs + chat rail) stealing testIDs. Those would have been identical on any backend. Snapback did not make Clique's product surface smaller. It made the server-shaped part of Clique a single compiled program, and it made mistakes in that program loud (`HANDLE_TAKEN`, `N_NEVER_COMPLETE`, `E_QUERY_HELD`, `N_EPHEMERAL_SERVER`). The remaining failure mode in this lane was not "the mutation is wrong." It was "the web tree unmounted" and "the accessibility tree does not match the frozen harness."

I would choose Snapback again for a product whose invariants are receipts, expiry, and membership — the engine is the feature. I would not choose it to save time on an Expo web choreography harness. That time is paid in the client, on every backend.
