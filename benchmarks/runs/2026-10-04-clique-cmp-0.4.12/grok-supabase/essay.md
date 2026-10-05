# Essay — Clique on hosted Supabase

This is written before tallying wall clocks or scores.

I came in treating Supabase as “Postgres you can reach from a JS client, plus Auth, Storage, and Realtime,” which is also how the public docs sell it. That description is accurate and incomplete. Building Clique on it felt like building a production BFF that happens to use a managed Postgres and a managed password hasher, not like sitting inside a cohesive application runtime.

## Where it reduced friction

Auth for M1 was the one place the platform clearly paid rent. Email + password, sessions, logout that can revoke refresh tokens, and a documented KDF I did not have to name in application code. The grader-facing password story is “we used the provider path,” and that path exists. Snapback and Convex both have auth stories too; Supabase’s is the most boring in a good way if you already believe in JWTs.

The data model is SQL. Handle uniqueness, one DM per pair, membership-at-send, “last write wins by arrival” — these are constraints and `now()`, not merge functions. After years of document stores and CRDT-shaped pitches, it is a relief to write `UNIQUE (handle)` and mean it. Convex would express the same rules in validators and indexes; Snapback would express them in its schema language. Postgres is the oldest of those tools and, for this app’s invariants, the most direct.

Storage is similarly direct for the happy path: bytes in a bucket, path on a row. The brief’s revocation rules (view-once, tombstone, expiry) do not fall out of a public URL, so I served media through the API with the service role. That is extra code, but it is extra *obvious* code. I never wondered whether a signed URL cache was still serving a deleted object; I asked `authorizeMedia` and then streamed.

The action-log replay adapter was also a good fit. “Drive the app’s own mutation path” is easy when that path is a Node module the HTTP server and the seed script both import. I did not have to speak a second protocol to load `starter-m*.log` or `sample-50.log`.

## Where it added friction

The split brain is the whole experience. Auth lives in `auth.users`. Application identity lives in `clq916g_profiles`. Realtime lives in a publication you `ALTER` by SQL because there is no CLI on this host. Storage policies are a third namespace. The client is supabase-js *and* a homegrown HTTP API because RLS for edit windows, digest emission, and push-on-no-device is more ceremony than a store function. I spent M1 time on “create the auth user, then the profile, and if the handle collides delete nothing because createUser already succeeded.” Convex would have been one mutation. Snapback would have been one command with a session already in scope.

Realtime was the promise I under-used and still paid for. Typing and live messages are the brief’s reason to care about a backend. Supabase has broadcast and postgres_changes. Without a local stack I was nervous about channel auth, replica identity, and whether the hosted project even had Realtime enabled on new tables. I shipped a typing table plus 200ms poll and a 700ms message poll. It is the “60” shape on the rubric: live data is doable, ephemeral state becomes a durable workaround. When choreography asked for 2s typing appearance, the poll-plus-token-race missed the window. That is not Postgres being slow; it is me substituting HTTP for a presence primitive I did not fully trust from the public docs at the point of need.

Offline is entirely on me. There is no official offline cache or mutation queue in supabase-js 2.112.4 that matches this brief. localStorage plus a JSON queue is the honest implementation. Snapback’s whole product is that queue. Convex is honest that the client is online-shaped. Supabase docs talk about “offline” mostly as Auth session persistence. The brief’s M6/M8 offline depth therefore measures how much application code I was willing to write, not a platform feature I configured.

The hosted pooler is an operational footgun. Acceptance, the API, and a debug `createRuntime()` each opened a `pg.Pool`. Session-mode max clients is small. `EMAXCONNSESSION` showed up in M8 insights tests while choreography was also live. That is a mature platform with sharp tenancy limits, not a missing feature, but it changed the shape of the work: I started treating connections as a scarce lock.

Expo web on this Linux host added a second boss fight that is not Supabase’s fault and still ate M3. Dual React from the vendored UI kit’s lockfile, Hermes private-field bytecode failures, `accessibilityValue` not mapping to `aria-valuetext`, nested `settings` routes that rendered the parent conversation instead. Two-client choreography is how this brief decides green. I got M1 and M2 through that harness. M3’s conversation surface — the actual WhatsApp-shaped product — never stayed green under Playwright even after a native `<input>` could send in a debug script. That gap is a mix of RN-web, the kit’s hook usage, and my routing. It is not a Postgres bug. It is what happens when the backend is ready and the client harness is the exam.

## How the work changed shape

On Convex I would have spent the morning on schema and queries and the afternoon on a few scheduled functions for digest. Offline would still be mine. Auth would be whatever the Convex template is this year. The live part would have been subscriptions, which this brief would have rewarded.

On Snapback I would have spent the morning on the runtime and the schema language and then hoped the live query and queue were the product. Media authorization and view-once would still have been policy work.

On Supabase I spent the morning on Auth+DDL+a BFF, the afternoon on SQL that I trust, and the night on Playwright vs Expo. The backend reduced friction for *invariants* and added friction for *session-shaped application*. Clique is a session-shaped application that happens to have a very regular schema. That mismatch is the story of this lane.

I would still pick Postgres for the follow graph, the unique DM, and the digest key. I would not pick “poll a typing table” twice. If I started over I would put typing and message delivery on Realtime broadcast from minute one, keep SQL for durable truth, and treat supabase-js as the client for Auth/Realtime/Storage only — with one process holding the Postgres pool. That is the production-shaped app this platform actually wants, and it is more assembly than I expected from a “backend” in a bakeoff against systems that try to be the whole runtime.
