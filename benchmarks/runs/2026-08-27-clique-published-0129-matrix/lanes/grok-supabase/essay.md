# Using Supabase to build Clique

This lane was a cold web-only build of Clique on hosted Supabase with `@supabase/supabase-js` pinned at 2.112.4. There was no local stack: Docker was missing on the host, so every DDL statement, auth call, storage object, and Realtime channel went to a shared hosted project namespaced `clq29_grok_`. That posture — a real multi-tenant Postgres with Auth, Storage, and Realtime as products — is the thing to compare with Snapback and Convex, not a toy.

## What the database was good at

Clique is a relational app whether a backend wants it to be or not: unique handles, one DM per pair, membership-at-send-time receipts, edit windows against server time, prefix search, insights totals that must not be paged on the client. Postgres let me *declare* those facts. A unique index on handle is the product rule. A unique `dm_pair` column is the product rule. `now()` in a `SECURITY DEFINER` function is the product rule for shortened edit windows. I did not have to invent a document shape and then apologize for it.

That is the contrast with Convex as I have used it: Convex will store Clique, but uniqueness and “the server’s clock is the only clock” are application-level rituals. You write mutations carefully and hope two clients do not race. Snapback, in the other direction, wants a typed function surface and a local authoritative store; the model is real, but it is not SQL, and the instinct when something is a constraint is to encode it in a function rather than in a catalog.

The follow graph as a table, feeds as queries, trending as `GROUP BY` over a 24-hour window — those were the hours that felt like building a product instead of fighting a platform. Insights as a single aggregate RPC, not a client fold over pages, is the kind of thing Postgres makes structurally hard to get wrong.

## Where the products around Postgres fought

Auth itself was the pleasant surprise. Email and password, sessions, logout that revokes refresh tokens: M1’s suite went green because the built-in path is the right path. The brief’s B2 story is exactly this. I did not hand-roll a KDF.

Then Storage happened. Uploading a fixture PNG as the signed-in user, with a policy `FOR INSERT TO public WITH CHECK (true)` on `storage.objects`, still returned “new row violates row-level security policy.” The same JWT could call RPCs and `getUser`. A service-role upload of the same bytes succeeded. There is no useful diagnostic in that error: not the role, not the policy name, not the `bucket_id` that was actually inserted. I ended up with a lane-local media proxy on port 48301 that verifies the user JWT and writes with the secret key. That is a hosted-Supabase Storage failure, not a Clique failure. Snapback’s blob story, for all its ceremony, does not usually require a second HTTP server to store a PNG. Convex file storage has its own awkwardness, but the client that can mutation can usually also upload.

Realtime was in between. `postgres_changes` on posts and follows is the advertised path and it mostly worked once replica identity was `FULL` and tables were in the publication. Typing used broadcast channels namespaced `clq29_grok_typing:`. Ephemeral state still needed a client timer. Convex’s live queries would have made the feed subscription the default, not an add-on; Snapback’s subscriptions are similar. Supabase Realtime is a good product that is not the default way you read data.

Scheduled work is not a product. M8’s digest is a Node process on a 15-second tick calling `clq29_grok_run_digest`. Convex has scheduled functions. Snapback has whatever you put in the binary. Hosted Supabase has `pg_cron` on some plans and nothing you can see from the JS client. I ran a worker and namespaced the log table. That is plumbing.

Offline is not a product at all. M6/M8 queued writes are AsyncStorage and a flush loop. Snapback is built around this. Convex is honest that the client is a cache of a server. Supabase docs will talk about local persistence for Auth and then stop. Building Clique’s offline queue by hand was expected; discovering that Storage and PostgREST also would not carry the user JWT the way the Auth API did was not.

## Hosted vs local

Snapback as I know it is a local binary and a file. Convex is a cloud with a good local emulator. This lane was cloud-only because Docker was absent. That single fact colored the whole run: Management API 429s while applying DDL, Auth signup rate limits that killed the scale replay after a perfect 87-action starter seed, a Storage RLS story I could not reproduce locally. The 167,157-action envelope started, applied a handful of scale `register`s, and died with “Request rate limit reached.” That is an operations failure of a hosted Auth product under a load the brief explicitly requires.

A local Supabase (or a local Postgres plus GoTrue) would have changed B9 and B11. It would not have changed B1: the model still fits.

## What I would still pick it for

If the job is “Clique’s data model on a SQL database with password auth,” I would still start here. Unique handles, DM dedupe, membership, windowed edits, and server-side insights are one afternoon of SQL. The JS client is small. PostgREST is enough of an API that `API.md` can tell a third-party developer the truth.

If the job is “Clique the live two-client app with media, offline, and 1,000 real signups,” I would not pick hosted Supabase as the only process. I would want a local stack, or a gateway I own in front of Storage, or an Auth path that can ingest a thousand password hashes without a rate limit that is invisible until it is fatal.

Snapback would have made offline and two-client sync the default and made SQL constraints the missing piece. Convex would have made live queries the default and made uniqueness and scheduled digests a better story than Storage RLS. Supabase made the relational model the default and made everything around the database a set of products you integrate, each with its own JWT, policy language, and rate limit. That is the experience of this run.
