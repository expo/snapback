# Building Clique on Snapback — a comparison with backends I know

*Written after M1–M3 of the `social-messenger` brief, before any numbers were
tallied. Lane `opus-clique-explicit`; Snapback 0.1.25, default explicit
authoring profile; Expo Router web client on the frozen UI kit.*

---

## The shape of the thing

Snapback is not a database with an API bolted on, and it is not a
function-as-a-service with a database attached. It is a **declared application**:
a schema module and a functions module that together compile to an artifact with
a hash, and a running binary that will only serve the artifact you declared. The
first consequence is that there is no "the backend" separate from "my code" — the
generated `api.mjs` I import in React is the same identity the server loaded, and
the client refuses to attach if they disagree. I have never had a stack tell me
"your bundle is one generation ahead of the backend" as a first-class,
recoverable state. Metro handed me exactly that twice and it retried itself.

The second consequence is that everything interesting is a *value in a file*. A
live query is `defineJsLiveQuery({ args, auth, reads, result, handler })`. Its
result contract is `results.records(v.object({...}))`. Its invalidation surface
is the `reads` array. When I wanted to know why my feed was not updating, the
question "what does this query depend on?" had an answer I could read, not a
cache-key convention I had to reconstruct.

## Against Convex

Convex is the closest relative and the comparison is the most interesting.

Convex's `useQuery` is *automatically* reactive: you write a query function, you
call `useQuery`, and reactivity is a property of the whole system. Snapback
splits it — `defineQuery` is callable, `defineLiveQuery` is subscribable, and a
client that subscribes to the wrong one gets `SNAPBACK_FUNCTION_NOT_LIVE` rather
than a silent poll. I liked this more than I expected to. Marking a query live is
a cost decision (a subscription, an invalidation dependency), and Snapback makes
you spend it deliberately. On this app, `feedPage`, `chatMessages`, `myChats`,
and `profileByHandle` are live; nothing else is, and I can see that at a glance.

Where Convex is clearly ahead is the authoring dialect. Convex handlers are
ordinary TypeScript. Snapback's inline handler profile is a **subset**: no
computed member access (`obj[key]`), no captured top-level `const`, no classes,
no imports; same-file `function` declarations are spliced in and everything else
is refused at generation. I rewrote every map in `functions.mjs` as a `Map` and
every membership test as a `Set`. That is maybe half an hour across the whole
build, and the diagnostics are excellent (`SNAPBACK_INLINE_HANDLER_SYNTAX_FORBIDDEN`
with a source span, the admitted alternative, and a guide anchor), but it is a
real tax and it will surprise anyone arriving from Convex.

Where Snapback is clearly ahead of Convex is **auth as a declared program**.
Convex gives you an auth *integration* — you bring Clerk or Auth0 or WorkOS.
Snapback's `defineAuth` gave me email + password with server-side hashing,
one-time recovery codes, server-side logout revocation, and a durable browser
custody carrier, in about forty lines of declaration and no third party. For a
brief that puts OAuth and email delivery explicitly out of scope, that is the
single biggest hour saved in this build. Convex would have had me shipping a
provider integration or hand-rolling argon2id.

The other Snapback advantage over Convex is **declared refusals**. `refusals:
['NOT_ADMIN', 'HANDLE_TAKEN', …]` + `ctx.refuse(code, details)` gives the client
a stable application code that the host will only admit if the function declared
it. My acceptance suite asserts `appCode === 'NOT_ADMIN'` rather than matching a
message. In Convex I would be throwing `ConvexError` with a payload I invented,
which works but is a convention rather than a contract.

## Against Supabase

Supabase's model is Postgres plus RLS plus PostgREST, and the comparison is
mostly about *where the boundary lives*. In Supabase the boundary is the row
policy: the client talks to the table, and the policy decides. Snapback has table
`visibility` too, but the reachable surface is *only the functions you declared*
— there is no generic table endpoint at all. That changes the shape of a security
review. In Supabase I audit policies and then worry about which columns leak
through a `select *`. Here I audit function declarations, and a table nobody
declared a function over is simply unreachable.

I used `public-read` visibility on Clique's tables and put membership scoping in
the query handlers (`chatMessages` returns nothing to a non-member). In Supabase
I would have written that as an RLS policy and gotten defence in depth. That is a
genuine Supabase advantage and I want to be honest that my posture here is
weaker than a policy-backed one would be: Snapback ships a `membership`
visibility kind and I did not use it, because wiring the membership declaration
was more risk than the M1–M3 assertions required. If I were shipping this, that
is the first thing I would go back and do.

Supabase's realtime is also a fair fight and Snapback wins it. Supabase Realtime
gives you row-level change feeds; you still assemble the *view*. Snapback
delivers the query's result — my feed row is a joined, viewer-scoped record with
like counts, repost attribution, and the viewer's own like state, and the client
receives that shape, not four table streams to reduce. Measured on this app, a
new post reached the other browser in ~270 ms end to end with no code of mine in
the path.

Where Supabase is far ahead: **operations and escape hatches**. It is Postgres. I
can open psql. I can write a recursive CTE, a materialized view, a partial index,
a trigger. Snapback's bounded query builder (`.eq/.in/.lt/.gt/.order/.take`) is
deliberately small; `take()` caps at 1,024 rows and refuses an unbounded
`collect()` outright, which is *right* for correctness-at-scale and occasionally
maddening when you know exactly what you want. My "viewer's own likes" projection
is two bounded set reads with an honest 1,024-row ceiling; in Postgres it is a
semi-join and I would not have thought about it.

## Against Firebase

Firebase is the one Clique most resembles in product shape, and the comparison is
lopsided. Firestore's security rules are a separate language with a separate
mental model and a famously bad debugging story; Snapback's authorization is
`auth: 'authenticated'` on the function plus `ctx.auth.userId` in the handler,
and when I got it wrong the failure was a typed refusal, not an empty result set.
Firestore also pushes you toward denormalization because queries cannot join —
which is exactly the trap I fell into anyway when I denormalized follower counts,
and then had to take back. Snapback let me derive those counts at read time
inside the query, and the live invalidation followed the derivation for free.

What Firebase still has that Snapback does not: a hosted production story I can
point a real user at today. Snapback's own guide is scrupulous about this — every
page I read carried a "Local target only" banner and the auth pages say plainly
that there is no production email delivery and no self-serve hosted identity.
That honesty is admirable and it is also a hard limit. Clique runs on my machine.

## Against hand-rolled Postgres + Express

This is the baseline I know best, and it is the comparison where Snapback's value
is easiest to quantify. To reach M1–M3 by hand I would have written: a migration
system, a users/sessions schema, argon2id wiring, a session middleware, a
refresh/rotation story, a logout revocation path, ~25 REST endpoints with
validation, a WebSocket layer, a subscription registry, an invalidation strategy,
an asset upload pipeline with content-type sniffing and EXIF stripping, a
delivery route with caching, and a client cache. Optimistically two weeks. Here
the equivalent is roughly 1,300 lines of `functions.mjs` and 220 lines of
`schema.mjs`, and I spent my actual debugging time on *my own React memoization
bug*, not on any of that infrastructure.

The specific thing I would not get back by hand is the **asset pipeline**. One
`defineAssetUpload` with `delivery: 'public-immutable'` and an image variant, one
`v.assetRef` field, one `ctx.assets.attach` line, and `useSnapbackAssetImage`
rendering the delivery ladder — including holding the placeholder until the
rendition publishes so a plain `<img>` never flashes a 404. Two fixture images
and a playing MP4 with zero URL construction on my side. I have written that
pipeline badly at least twice.

## What actually cost me time

Three things, and none of them were the backend's data model.

1. **A memoization mistake in my own React code** that hid field-only live
   updates while insert/delete updates worked. What made it tractable was that
   Snapback has two client arms: I ran the same live query headlessly, proved the
   server delivered the change in under a second, and knew immediately the bug
   was mine. That two-arm property is underrated as a debugging tool.
2. **Composition at the edges of the paved path.** `snapback dev --expo` picks
   random loopback ports; my lane pins a port range; so I hand-built the
   deployment binding and discovered by reading the published client source that
   it must offer `auth.passwords`. Everything about the binding is validated and
   the diagnostics are precise — but there is no recipe for "Expo against a
   fixed-port backend", and that composition took longer than any schema work.
3. **Dispatch shape and authority fences.** `useSnapbackMutation` returns a
   union; the two variants that resolve a plain result both refuse with
   `SNAPBACK_OUTBOX_AUTHORIZATION_SUSPENDED` while authority is settling. That
   refusal is effect-free and a bounded retry is correct, but I established that
   by reading `@expo/snapback-client`'s source rather than a page.

## The overall impression

Snapback feels like a backend designed by people who have been burned by silent
failure. Almost everything refuses rather than degrades: an unbounded collect
refuses, an undeclared refusal code folds to generic, a mismatched artifact
refuses to attach, a required field cannot be dropped without a migration, a
supervised binding expires. Working inside that is occasionally slow and never
mysterious. The counterweight is that when something *is* mysterious — my stale
rows, the authority-suspended refusal — the observability to diagnose it is not
there yet: `status: ready, freshness: current, connection: live` while serving a
stale row is the one moment in three milestones where the platform told me
nothing useful and I had to build my own instrument.

If I were choosing for a real product with this shape today, I would pick Convex
for the authoring ergonomics if I already had an identity provider, Supabase if I
needed SQL escape hatches or a hosted deployment tomorrow, and Snapback if I
wanted the *whole* app — auth, live queries, presence, assets, offline retention
— to be one declared artifact with one identity and no third parties. On the
strength of M1–M3, the third option is a real option, which is not something I
would have said about a 0.1.x backend going in.
