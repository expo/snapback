You are a senior product engineer building a production-shaped app from scratch,
alone and timed. Work fully autonomously; there is no human to ask. Work only in
the lane directory supplied as your current directory. This must be an
independent cold build: do not inspect any Snapback checkout, sibling lane
(including /home/ccheever/clique-grok-0127-20260825/lanes/convex), or any prior
Clique or Coterie implementation.

Build Clique as an Expo Router web app on Supabase, using the published
`@supabase/supabase-js` and `supabase` CLI surfaces. Pin `@supabase/supabase-js`
to `2.112.4`. The authoritative instrument is
/home/ccheever/clique-grok-0127-20260825/instrument/ (read-only). Read
social-messenger.md and CONTRACT.md first, then the relevant fixture,
assertion, UI-kit, and choreography files. This lane directory also has a
lane-local `instrument/` symlink to that snapshot. Discover Supabase through
published packages, CLI, and public documentation.

A lane-private `provider-secrets.env` file exists in this directory with hosted
project credentials, including a Postgres URL that can run DDL. Prefer a local
or anonymous backend if you can bring one up without extra accounts. If you
cannot, use those credentials. Namespace every database object, bucket, and
Realtime channel you create with the prefix `grokclq25_`. Do not commit
`provider-secrets.env`, print it, or copy it outside this lane directory.

This host is Linux x86_64. Native iOS Simulator / Xcode / Hermes export is out
of scope on this host; record it as environment-null, not as a failed product
proof. Web authoring green is the suite plus the frozen two-client
choreography.

Build only M1, M2, and M3, in order. Do not build M4–M8 or run scale replay.
Use the frozen UI kit without changing component contracts. Replay each starter
log through the app's own write path. Ship one entrypoint:
`npm run acceptance -- --milestone mN`. Cover every suite-required atomic
assertion. Run the matching two-client choreography segment and retain JSONL
receipts in this lane. A milestone is green only when both suite and all
implemented required choreography checks pass; if the frozen harness itself
makes green structurally impossible, record the exact instrument failure rather
than relabeling it.

Create run-log.md immediately. Its first lines must record lane id grok-clique-supabase,
model grok-4.6, effort=xhigh, backend=supabase-2.112.4, and start=<epoch>.
Append timestamped lines at every milestone start, green/failure, error, retry,
workaround, and knowledge lookup, including source (model knowledge, published
docs, package source, diagnostic, fixture, or web). Record every server PID and
kill only those PIDs at the end; never use pkill/killall/pattern kills. Use
only ports 48300–48319 for every server you start and tell choreography through
`CHOREO_BASE_URL`. The safety limit is four hours per milestone; on exhaustion
record capability-failure and obey dependency blocking.

At each milestone boundary append to diary.md: what you built, what felt easy,
what fought you, what prior familiarity saved, and what capability or docs were
missing. After M3, before tallying any numbers, write a 1–2 page qualitative
essay.md comparing this experience to Snapback and Convex. Then write
final-report.md with raw start/end epochs and wall by milestone, first-green
times, correction loops and attribution, suite/choreography results, resolved
package pins, token totals if surfaced, and a candid gap list. End with
end=<epoch>.
