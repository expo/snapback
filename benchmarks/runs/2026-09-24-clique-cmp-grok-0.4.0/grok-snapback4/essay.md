# Clique on Snapback 4 — closing essay

This lane was a cold build of Clique, the social-messenger brief, on **Snapback 4.0.4** (`snapback4@0.4.0` / `snapback4-expo@0.4.0`) with Quarry as the schema language and an Expo Router client. I came in with Convex and Supabase as the backends I actually know how to ship on, plus the usual Postgres + custom Realtime muscle memory. The question this essay answers is not “which product is better” but **how the work changed shape**.

## Where Snapback reduced friction

The password walkthrough in the published README is unusually complete: Argon2 sessions, `format handle`, unique indexes with named refusals (`HANDLE_TAKEN`), `client.upload` then a placement mutation, `createApp` + `AppProvider`. M1 did not require assembling Auth + RLS + a storage bucket + a profile table and then wiring three clients to agree. Handle uniqueness is a schema fact, not a race you paper over with a retry.

Reactive reads are closer to Convex than to Supabase. `useQuery` / `usePage` / `useMutation` under `AppProvider` meant Following/Global feeds, typing, receipts, and insights updated without a second “subscribe” API. That is the Convex-shaped gift: the client is a cache of authorized rows, not a REST consumer you keep consistent by hand.

Assets as typed columns (`image`, `image once`, `video`) changed media work. View-once is not “delete the URL in the client.” It is a column that the engine refuses after the first authorized read. Disappearing messages, before I had to strip `expire at` for scale, were `expire at .expiresAt` plus shortened TTLs in the schema — no cron you forget to run. The digest is a real `schedule … every 2m` job that emits through the same effect seam as chat push. That combination (typed assets, expiry, jobs, effects) is the part I would miss first if I went back to “bucket URL + Edge function + pg_cron.”

Offline writes on the web device were the largest surprise. M6’s choreography — two messages while Playwright is offline, both `pending`, then flush in order to `read` — passed on the first try. Predicted mutations (`predicts: eligible`) plus a durable outbox are a product feature, not a weekend of IndexedDB. Convex is honestly online-first; Supabase Realtime does not queue mutations for you. Here the local replica is the point.

The custom-client story is also smaller than either alternative. `API.md` is “here is `createClient` and these generated operations,” not a second REST surface. The demo script is a page of Node. A grader following only that file can list conversations, page history, send, and observe. That is closer to “use the same protocol as the app” than to “here is our REST and also our RPC and also our Realtime channel names.”

## Where Snapback added friction

Quarry is a new language with a compiler that is willing to say no. That is good until the no is `E_BOUND: examined rows reached the ceiling 8192` at message 8,193 of a 10,000-message group, and the explanation (`why chat.sendMessage`) is that `expire at` makes the unique `(conversationId, ordinal)` insert skip expired rows until the meter cuts. I did not learn that from the README. I learned it at action ~22,725 of `scale.log`. Removing `expire at` (keeping the `expiresAt` column for the client) unblocked 167k actions; that is a **platform gap**, not an adapter typo. Postgres would have taken the 10kth insert. Convex would have taken it too, then surprised you later on query cost.

Page size is a footgun the brief makes expensive. `chatDeliveries first 50 by .id` hid new delivery acks after fifty rows; M3 choreography failed `delivered` until a per-message query existed. Convex’s `take(50)` has the same shape, but you are less likely to put receipts on a global conversation scan. Snapback’s notes (`N_NO_HORIZON`, `N_NEVER_COMPLETE`) are excellent once you read them; they do not stop you shipping the wrong page to Playwright.

The Expo arm on Linux is a second product. There is no npm binary for this OS; the harness’s `SNAPBACK4_BIN` is the only way `npx snapback4` runs. `snapback4 init` refuses a non-empty directory. Generated `server.ts` wants Node types. Expo `--non-interactive` disables HMR, so every UI fix is a process restart. RN-web does not honor `accessibilityValue.text` for Playwright; the kit had to grow `data-value` / `aria-valuetext` / `aria-pressed` by hand. None of that is Quarry. All of it ate M2–M5 wall clock.

Upload admission (`POST /assets` → 429 `E_RATE_LIMIT`) showed up in M5’s background-image check while two browsers were already fetching avatars and chat media. `why E_RATE_LIMIT` points at the personas/assets cards. Retrying in `useUploadBlob` fixed it. Supabase Storage would have 429’d me too; Convex file upload is a different bottleneck. The friction was not unique. The discoverability was.

Choreography copied from the instrument is not a self-contained package: it imports `../metering` and `../../lib/json-schema.mjs`. That is an instrument skip, not a Snapback defect, but it is work that does not exist on a Convex or Supabase tutorial path.

## How the shape of the work changed

On Convex I would have spent M1–M3 on schema-plus-functions that look like TypeScript, then M6 inventing an outbox. On Supabase I would have spent M1 on Auth and RLS, M2 on storage policies, M3 on a receipts table and a flood of `postgres_changes` channels, M6 on service-role push and a custom offline layer, M8 on a cron dashboard.

On Snapback the scarce resource was **getting the Quarry page, sync, and expiry declarations right**, then **making RN-web observable to a frozen Playwright harness**. Business logic in mutations is short. The long loops were: semantic values, file inputs, delivery acknowledgements after `setOffline`, and one scale bound that does not exist in Postgres.

I did not miss Convex’s `ctx.db.query` ergonomics as much as I expected; generated `api.ts` plus hooks is close. I missed Postgres when the meter refused a perfectly ordinary 10,000th group message. I missed neither product’s hosting story: this run is a local `dev` binary and a worker that logs effects to a JSONL file, which is exactly what the brief’s push seam asks for.

If I had to name one sentence: Snapback made the **authorized local replica** the default, which collapsed offline, multi-device, and live updates into schema — and then charged that gift back at scale with a hard examined-row ceiling on expiring unique indexes.

I would use it again for a WhatsApp-shaped client where devices hold the chat. I would not pick it, today, for a 10k-message group that also needs server-side `expire at` on the same table, unless the bound is lifted or the unique ordinal lookup stops walking expired rows.
