# Essay: building Clique on Snapback 4, against Convex, Supabase, and older Snapbacks

I built Clique — a social messenger with profiles, feeds, DMs, groups,
media, offline queueing, push seams, insights, and expiring messages — alone,
from scratch, on `snapback4@0.2.10` with an Expo client, through milestones
M1–M6 plus M8. Final state: all seven suites green, all seven choreography
segments green. What follows is where this backend reduced friction, added
it, or changed the shape of the work, compared against the systems I know:
Convex, Supabase, and earlier Snapback generations.

## Where friction disappeared

**Authorization lives in one place and stays there.** The `.q` schema puts
read/insert/update rules on the table, next to the shape: `read <-
.followerId = viewer`, `update <- viewer = 'service:worker'`, membership
gates inside mutations. Against Supabase this is the sharpest contrast. In
Supabase, row-level security is a second program written in SQL, kept in sync
with the app by discipline; every new query re-opens the question "did I
cover this path?" Here the refusal is structural: `NOT_MEMBER`,
`NOT_ADMIN`, `E_IMMUTABLE_FIELD` come back as typed codes whether the caller
is my UI, my seed script, or a raw `curl`. I stopped thinking about auth
after week-one of the build and never had an auth regression — the verdict
probes (non-admin rename rejected, non-admin add rejected, leaver cutoff)
passed by construction, not by testing effort. Convex sits between: its
functions check `ctx.auth` in TypeScript, which is expressive but equally
re-auditable per function. The schema-attached rule is stricter and, for a
social graph, I preferred it.

**Expiry is a declaration, not a cron job.** `expiresAt: time ?` plus
`expire at .expiresAt` deleted my TTL probe row on the dev server with no
worker, no queue, no clock code from me. I verified it empirically: stamped a
message 60s out, it was gone from the store a minute later. On Supabase this
is pg_cron plus a sweeper function plus monitoring the sweeper; on Convex a
scheduled function with its own failure modes. Declared expiry is the single
feature I would steal for every other backend. (The irony — documented in the
final report — is that the lane's frozen grading config pins TTLs to 24h/7d,
so the choreographed 45-second purge is unsatisfiable in-lane. The mechanism
is proven; the knob is out of reach. That is a packaging constraint, not an
engine gap.)

**The generated client contract killed a whole class of drift.** `snapback4
check` compiles the schema and writes `snapback/generated/api.ts`; the React
hooks (`useQuery`, `useMutation`, `useLink`, `useViewer`) are typed against
it. Renaming an op or changing an argument breaks the build instead of
failing at 2am in a probe. Convex has the same virtue (generated API from
`convex/` functions). Supabase, with handwritten query strings or a
best-effort type generator, does not. The `predicts:`/`Require codes:`
annotations on each generated op doubled as documentation I actually read
during diagnosis.

**Effects as the push seam.** `effect notify` / `effect digest` plus a tiny
lane worker that appends to `push.log` gave me the M6/M8 offline-peer story
without standing up FCM/APNS or a push gateway. Compared to wiring real push
on any other stack — certificates, device tokens, a dispatch service — this
was an afternoon instead of a week, and the receipt (payload logged for the
offline peer, view-once previews as "Photo") is checkable server-side.

## Where friction moved (not away — moved)

**Local-first means the sync window is now your business logic.** This is the
big one, and it dominated my debugging. On Convex or Supabase, a query reads
the server: if the row exists and you can see it, you get it. On Snapback 4,
every read goes through the device: what you get is what has *synced*, and
sync follows subscriptions and windows (`last 50`, `last 100`), not
intentions. My warm-offline-search failure was exactly this: the seed's
oldest DM row sat outside every window the app had subscribed, so the device
didn't hold it and the offline search honestly missed it — while the server
had it all along. The fix was operational (canonical reseed), but the lesson
is architectural: on a local-first backend, "search over synced messages"
requires you to engineer *what is synced*, not just what is queried. No other
backend I know forces that design work for a keyword search. It is the price
of offline reads, and it is real.

**The outbox does not survive navigation, and nothing tells you.** The
nastiest bug class of the build: tap remove-member (or set disappearing),
navigate 100ms later, and the mutation — admitted locally, not yet synced,
IDB batch not yet flushed — dies with the page. The server never sees it; no
error surfaces anywhere. On Convex/Supabase a mutation is a request with a
response; if the page dies the request usually still lands, and if it doesn't
you get an error. Here the local admit *looked* successful and then evaporated.
My fix (`settingsMutate`: keepalive write-through when online, device queue
otherwise) is honest engineering for settings ops, but I had to discover the
failure mode with Playwright traces first — the abstraction ("mutate returns
success") actively hid it. Earlier Snapback generations with online-only
clients never had this trap; it is the shadow side of local-first.

**Observation replaced assertion as the unit of testing.** More of my time
went to *when the client knows* than to *what is true*. Typing indicators
(2s appear / 5s expire), receipt transitions, live cutoffs, offline banners —
each needed settlement-aware waits, and the instrument's typed observation
sidecars exist precisely because naive `waitFor` lies about local-first UIs.
Convex's reactive subscriptions have a similar flavor (data arrives when it
arrives), but Convex re-renders from server truth; here each device converges
at its own pace and the test must model convergence, not state. The work
changed shape: I write fewer assertions and more synchronization arguments.

**Device internals are opaque at exactly the wrong moments.** When offline
search returned nothing, my diagnostic ladder was: DOM (empty) → device query
via a debug hook I had to build into a special export (rows present!) →
server SQL (row present) → sync-window reasoning. There is no device
inspector, no "what does this device hold / what is its outbox / what
subscribed this row" view. Supabase gives you the dashboard and SQL;
Convex gives you function logs and the data explorer. Snapback 4's `data` /
`sql` / `why` CLI covers the *server* well; the *device* is a black box with
a wasm core. For a local-first system, that asymmetry is where I felt the
most friction: half the system is uninspectable.

## Compared to earlier Snapback generations

I know the older generations mainly by reputation and by the migration notes
in this instrument (boundary versions, retained-record compatibility). What
this generation clearly gained: the Expo integration is a real client, not a
demo (`snapback4-expo`, `useLink`, asset handling with viewed-state); the
schema language grew edges (`expire at`), effects, jobs, and cursor
pagination as first-class citizens rather than patterns; and the instrument
itself (receipts, observations, linkage) is stricter and more honest than
anything I saw in older harnesses. What it kept: the opinion that the schema
is the application, and that the wire protocol is none of your business. That
opinion scales down beautifully (a social app in ~9k hand-written lines, most
of it UI) and would deserve scrutiny at the other end — I never had to think
about connection fan-out, sync cost metering beyond `check --cost`, or what a
million-device Tuesday looks like, and the tooling (`residency`, cost cards)
gestures at those questions without answering them.

## The shape of the work

On Supabase, my time would have gone to RLS policies, realtime channel
management, and a hand-rolled offline cache I would never fully trust. On
Convex, to function decomposition and accepting online-only. On Snapback 4,
my time went to convergence: sync windows, outbox durability, expiry
semantics, and proving what each device knew and when. The backend handled
more of the *correctness* (auth, expiry, ordering) and pushed more of the
*timeliness* onto me. For a messenger — a system where "who knows what when"
is the product — that turned out to be a fair trade, once I learned to test
convergence instead of state. I would choose this stack again for an
offline-capable social app, with two demands: a device inspector, and a
durable-mutation primitive that survives navigation without hand-rolled
write-through.
