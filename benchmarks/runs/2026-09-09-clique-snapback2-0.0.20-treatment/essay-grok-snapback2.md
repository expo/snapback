# Clique on Snapback 2 — closing essay

This lane built Clique against the published `snapback2@0.0.20` package only:
Quarry for the owner (`snapback/*.q`), TypeScript for seeds, tests, and the
notify effect, Expo Router for web plus an iOS Hermes export. I came in with
Convex and Supabase as the comparison set in my head, plus generic Postgres
and Firebase from earlier product work. Snapback 2 is none of those, and the
shape of the work changed immediately.

## Where it reduced friction

Password identity is a one-liner (`use identity`) and a generated
`client.auth.signup/login/logout`. That is closer to Convex than to Supabase:
there is no KDF to pick, no `auth.users` join, no JWT custom claims table.
Live queries are the default. Following feeds, like counts, and chat threads
are subscriptions unless you opt out. For a two-client messenger that is the
right default; I did not spend M2 inventing a poller.

The data model is declared, not migrated. Tables, unique indexes, `maintain`
counts, `merge` lanes, `wordPrefixes` search, `image once`, and `channel … ttl
5s` are grammar. Receipts became two pending tables plus count maintains
instead of a hand-rolled per-member state machine. View-once is a column
flag, not an object-storage policy I had to remember in three places. The
published chat template was a usable skeleton: DMs, groups, deliveries,
effects. I extended it rather than inventing a protocol.

Seeds and the custom client speak the same `createClient` / `api.*` surface.
`API.md` is honest: there is no REST, and a third-party script does not need
one if it can follow the generated operations. That is a smaller story than
Supabase’s “here is PostgREST, here is Realtime, here is Storage, here is
GoTrue.”

## Where it added friction

Quarry’s cost model is the product. A thread query that joined full `image`
columns plus profiles plus quoted messages exceeded a 4 MiB
maintained-address ceiling (`E_BOUND`). The repair is to project scalars and
fetch media in a second query. Convex would have shrugged and sent the
documents; Postgres would have selected `bytea` and regretted it later.
Snapback 2 fails closed at `check`, which is good for production and slow for
a timed build.

Write rules and unique indexes interact. Sending a DM could not *read* the
recipient’s `unreadCounts` row (`read <- .principal = viewer`), so the sender
always inserted, then hit `E_CONSTRAINT` on a row that already existed. That
class of bug is the Snapback analogue of RLS: the diagnostic is accurate, the
fix is a broader read rule, and you only discover it at runtime against a
populated store. Convex mutations running as the user would have seen the
row; SQL with a `SECURITY DEFINER` function would have hidden the same
mistake behind a trigger.

Fan-out is priced. `for` over `follows.byFollowed` is refused
(`E_STRUCTURAL_FANOUT`) unless the table is `cap 50 by followed`. The
following feed already merges 50 lanes. The brief’s celebrity (900
followers) and u0500 (500 follows) cannot be expressed as a write-time
fan-out without that cap, which would then refuse the scale log. Digest
`newPostsInFollowing` therefore does not bump per follower on insert. That
is a platform gap, not an authoring miss.

Schedule-target mutations are not client-callable (`E_OPERATOR_REQUIRED`).
`dropTrending` exists for the 24 h expiry timer; the suite needed a second
mutation (`hideTrending`) to assert absence. Convex actions and Supabase
RPCs do not disappear from the client because a cron job also calls them.

The Expo web arm fought Playwright harder than the owner did. RN `TextInput`
`testID`s are real nodes, but controlled state lags `fill`. Profile edit
needed seed-once plus reading nested DOM values. The feed composer needed
native `<textarea>`/`<input>` and `aria-valuetext` patched onto the frozen
kit because `accessibilityValue` does not become the attribute the harness
reads. Metro `hot=false` in this environment turned every UI fix into an
Expo restart. None of that is Snapback 2’s owner; it is the published Expo
client arm plus a frozen two-client harness that will not infer semantics
from glyphs.

## How the work changed shape

On Convex I would have spent M1–M3 on schema functions, indexes, and
`ctx.db.patch`, then M6 on an HTTP action and a component that calls
`usePaginatedQuery`. On Supabase I would have spent the same miles on SQL
migrations, RLS policies, and a Realtime channel per conversation. On
Snapback 2 the miles moved to: naming indexes so `first 50 by X` is legal,
keeping query closures under the byte ceiling, making write rules true for
the *other* principal in a mutation, and teaching the web DOM to speak the
contract’s accessible values.

The owner/dev-url dance replaces `npx convex dev` and `supabase start`.
There is one owner per project directory, a control secret, `snapback2
check` as the typechecker, and `dev --status` for the installed generation.
When a successor refuses, the previous generation keeps serving. That is
calmer than a broken migration on a shared Postgres, and more ceremony than
Convex’s push.

I would use this backend again for a live, permissioned, media-bearing app
whose queries fit the merge/maintain/channel grammar. I would not use it yet
for an uncapped follow graph or a SQL-shaped report without a dedicated
read-model table. The product is opinionated in the way Convex is
opinionated, with a stricter runtime bill.

Tokens for this lane are null/advisory (Grok). The qualitative comparison
stands without them.
