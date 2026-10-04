# Convex 1.45.0 as a Clique backend

This lane built Clique as an Expo Router app on **Convex 1.45.0**, discovered from the published package, CLI, and public docs, in anonymous local mode. The comparison below is against the backends I already know — Snapback 4’s hosted-sync shape, Postgres/Supabase, and generic “mutations over HTTP” stacks — not against any other Clique cell on this machine.

## Where Convex reduced friction

The first hour of Clique is a live two-client problem: Alice edits a profile, Bob’s screen has to move. Convex’s default is a reactive query. I wrote `profiles.getByHandle` and `messages.texts` as ordinary TypeScript functions, subscribed from `useQuery`, and the second browser updated without a websocket protocol, a channel name, or a “don’t forget to invalidate.” That is the product-shaped win. Snapback 4 aims at the same feeling (the client is a live projection of server truth) but the onboarding is a product: login, project, wrapper, published guide. Convex anonymous mode was closer to “run a binary on two ports.” `CONVEX_AGENT_MODE=anonymous` plus the hidden `--local-cloud-port` / `--local-site-port` flags bound 55501/55502 without an account. That is a genuine reduction in ceremony for a timed solo build.

File storage is similarly small. `generateUploadUrl` → POST bytes → `storage.getUrl` is three calls and no bucket policy. Photos, avatars, chat backgrounds, and view-once media all sat on that loop. On Supabase I would have created a bucket, RLS policies, and a signed-URL path before the first PNG landed. Convex’s storage is not a CDN, and `getUrl` can return null, but for the fixture pack it was enough.

The schema is TypeScript in the repo. Indexes are declared next to the table. I did not leave the process to write SQL, run a migration CLI, and then write a second copy of the types. For Clique’s word-prefix search that mattered: `messageWords` / `personWords` with a `by_word_created` range is a page of code, not a GIN index I have to remember to ANALYZE.

Scheduled work is first-class. M8’s digest is `crons.interval("digest-emit", { minutes: 1 }, internal.digest.emitDue)`. There is no “check on read and hope a client is open.” Snapback 4 has always been stronger at *client* sync than at *server* clocks; Supabase would have been a `pg_cron` extension or an external worker. Convex’s cron is the least surprising of the three for “emit one digest per user per period with no connected client.”

A second anonymous instance for the scale replay was a directory, a sqlite file, and two more ports (55503/55504). I did not provision a second hosted project. That is closer to “copy a data directory” than to “create a Supabase project and wait for DNS.”

## Where Convex added friction

Password auth is not a product. bcryptjs cost 10 inside a mutation is allowed by the brief and was the entire auth system. Sessions are a table. That is fine, but it is not “Supabase Auth in twenty minutes,” and it is not Snapback’s identity story either. Every subsequent verb (follow, send, like) threads a `token` argument because there is no first-class session in the query layer unless I put it there.

Optional validators reject `null`. They accept `undefined`. The client’s TypeScript is happy to pass `mediaStorageId: null`, the mutation never runs, and the UI looks idle. I burned a correction loop on that. A SQL backend would have stored NULL. A more opinionated client SDK might have stripped it. Convex’s argument validator is exact, which is a feature until you have been trained by JSON APIs that treat null and missing as the same.

Queries do not tick. Typing indicators, disappearing messages, and presence all need a *time* to pass. Convex will re-run a query when a document changes, not when `Date.now()` crosses a threshold. I hid typing with a 4s client timer, filtered `expired` on read, and for choreography I waited the real 180-second 24h TTL because the harness fail-closes on optional implemented checks. Snapback 4’s live queries similarly are data-driven; Supabase Realtime is also data-driven. The difference is I expected a “cron the query” escape hatch and did not get one. The digest cron is for writes, not for re-rendering `expiresAt <= now()`.

Anonymous local mode has one default deployment name (`anonymous-agent`). A second instance is not `convex dev --clone`. Copying `config.json` including the first instance’s admin key produced `BadAdminKey`. The working move was a separate project directory and a generated secret. That is discoverable from package source, not from the README’s happy path.

The mutation path is the scale path. 167k settled action-log verbs, including ~1,000 bcrypt signups and hundreds of media uploads, is a long HTTP loop against a single local backend. There is no COPY, no bulk insert, no “disable indexes for load.” The brief requires that. Convex does not offer a tempting cheat, which is good for the instrument and slow for the clock. On Postgres I would have been tempted (and forbidden) to COPY. Here the temptation does not exist; the cost is wall time.

Expo + Convex is two processes, two ports, two watchers. Metro served a stale bundle with two `sm-chatsettings-background-preview` nodes until `expo start --clear`. That is not Convex’s bug, but it is the shape of this stack: the backend hot-reloads functions in ~300ms; the web client lies about having rebuilt. Snapback 4’s published client would have failed in different ways. Supabase + Vite would have been a single-page HMR story I trust more than RN-web.

## How the work changed shape

I spent less time on “how does Bob find out” and more time on “what is the document.” Receipts, presence, and unread counts are *aggregations I wrote*, not primitives. Convex gave me the subscription; WhatsApp semantics were still a table of `receipts` rows and a function `aggregateReceipt`. That is the same work I would do on Supabase with a view, except the view would not push. I maintained `dailyStats` and `likesReceived` on write because an Insights query that paged the corpus would fail the scale envelope. Write-time counters are not a Convex idea — they are what you do when the query budget is real.

The custom-client API was a ConvexHttpClient and `anyApi`. There is no generated REST surface. That made the replay adapter short and also made every verb a mutation name I had to keep stable. Snapback 4 would have pushed me toward its published function surface; Supabase toward PostgREST. Convex’s surface is the `convex/` folder.

End to end, Convex reduced the *live UI* tax and the *storage* tax, added a *validator and clock* tax, and turned scale into an honest mutation firehose. I would pick it again for a two-client messenger. I would not pick it because I wanted SQL, or because I wanted auth, or because I wanted the 100k-message load to be a restore from backup.
