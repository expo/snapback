# Building Clique with Snapback 4

I built this app through the published Snapback 4 package, its README, its guide,
its diagnostics, and its generated API. I did not inspect a Snapback checkout,
an earlier Clique implementation, or another lane. This essay describes that
experience before the closing numerical tally. The comparisons to other backends
are architectural judgments based on existing knowledge, not results from a
parallel implementation or a current product survey.

## Where the backend removed work

The strongest part of the experience was the relationship between a server rule
and a device projection. A message was not separately modeled as a database row,
a websocket payload, an optimistic JavaScript object, and a cache record. Quarry
described its columns, authorization, indexes, sync audience, and expiry. The
React and replica arms then exposed those decisions through the same typed read
and write contracts. That made a fairly demanding messaging brief feel like one
application instead of several loosely coordinated applications.

Media showed this advantage particularly clearly. Uploading a photo still needed
ordinary product work: choosing a file, previewing it, displaying loading state,
and handling an error. But the difficult lifecycle was shared infrastructure.
Asset references carried type and size constraints. Replacing or clearing a
reference participated in revocation. A once-only image had a distinct schema
meaning rather than a boolean that merely hid a button. I could verify the
second fetch was refused and that a synced deletion removed ordinary cached
media from offline access. Those are much stronger properties than a screenshot
of a disabled control.

The same applies to disappearing messages. A client timer would have been easy
to write and wrong for this brief. The engine's expiry mechanism continued with
all clients closed, filtered server reads, and delivered removal to returning
devices. Search used the same message data and therefore inherited those lifecycle
changes. I still had to test the boundaries, but I did not have to invent a
separate cleanup service and a second cache-invalidation protocol.

Compared with the Convex model I know, this moved more responsibility into the
schema and runtime. Convex's transactional functions and reactive reads provide
a natural foundation for a connected social app. The extra work I would expect
for this particular brief is a durable offline queue, restart-safe optimistic
state, media retention, and reconciliation with server refusals. Snapback gave
those concerns a common vocabulary. That does not make the UI automatic: file
pickers, receipt displays, routing, and retry behavior remained application work.
It means the hard state transitions had a shared owner.

Compared with Supabase, the reduction was most visible at the device boundary.
Postgres offers familiar relational tools, constraints, transactions, indexes,
and row-level access policies. I would be comfortable expressing most server
invariants there. The larger design task would be deciding how those rows become
an offline replica, which changes should be delivered, what historical access
means after leaving a group, and when local assets should be purged. A storage
bucket plus an access policy is not by itself that complete lifecycle. Here,
Quarry's sync and retention declarations made the question explicit early.

## Where the work became less familiar

Quarry also concentrated the learning cost. My normal instinct is to write a
small guard, run a transaction, and reason about the server result. In a replicated
program, the guard's *local knowledge requirements* matter too. Near the end of
the build I added an apparently sensible duplicate-message check. It read whether
a message ID already existed. That was correct on the server, but the device
held only a horizon of message history. Absence in that projection was not proof
of global absence. Pending messages stopped appearing offline.

The published `why` diagnostic identified the relevant horizon read. The fix was
a per-user, fully synced identity ledger, separate from message history. That let
the device know whether it had already submitted an ID without pretending its
message cache was complete. The resulting design was better: stable retries and
durable optimistic insertion now had a precise common basis. But getting there
required understanding the compiler's model of knowledge, not merely checking
that a function typechecked. This is the most distinctive friction I encountered.

An ordinary server-only function system would not surprise me in that particular
way. It would leave more client machinery for me to write, where the same bug
might instead appear as an incorrect optimistic update. Snapback moved the issue
into a place that could explain it. I found that trade worthwhile, but the
explanation needs to be part of the everyday authoring workflow. “Predicts:
eligible” alone is not enough; the per-read coverage conditions are essential.

The limits on queries also changed design decisions. An explicit examination
budget is useful because it refuses to hide a growing scan behind a happy small
fixture. The first broad-follow feed implementation produced correct answers
but failed the intended relative-performance check. A second strategy scans the
global event index for broad, dense follow sets while preserving a lane merge
for smaller sets. It works well for the committed envelope. The compiler still
warns that sparse matches can exhaust the scan budget. That warning remains a
real limitation, not something erased by passing a fixture.

In Postgres I would expect to inspect an execution plan and tune indexes or a
materialized delivery model. In Convex I would similarly inspect query work and
choose between reading multiple author ranges and writing a feed projection.
Snapback did not eliminate that data-modeling decision. Its bounded execution
and diagnostic notes made the cost visible sooner. I deliberately did not claim
that one measured workload establishes an unlimited social-feed architecture.

## Reporting and scheduled work

Insights was a good fit for maintained aggregates. The server returned six totals
and seven explicit day buckets; the client did not page the corpus to count it.
Trending needed a different choice. A periodically rebuilt ranking would have
introduced freshness lag that the brief did not allow. I used an expiring ranked
projection whose score changes with likes, while original posts remain durable.
The ranking could therefore be read immediately and drop out-of-window candidates
without waiting for a client or a ranking refresh schedule.

The digest used real scheduled Quarry jobs and a small logging worker. The worker
was a provider seam, not a second backend containing authorization or counting
logic. Jobs accumulated only eligible unread activity, computed the remaining
period totals, and emitted with durable period identity. Closing clients and
restarting the backend were useful tests here: both remove the temptation to
mistake a browser-triggered calculation for scheduled work.

This is an area where I would find SQL and a scheduler familiar, and where Convex's
server-function style would also feel natural. Snapback's advantage was that the
same transaction and rule vocabulary extended to scheduled chunks and effects.
Its cost was another bounded-programming surface to learn. The guide was useful
and concrete; I occasionally guessed a keyword incorrectly, but the CLI directed
me to the relevant card.

## What I would carry forward

There were also problems that should not be charged to the backend. I made
incorrect JSX replacements, supplied an empty string for an optional URL, and
initially shaped navigation differently from the frozen choreography's
assumptions. The copied harness was missing an imported helper and expected its
original directory layout. I repaired that packaging locally without changing
its browser assertions. Those incidents consumed real effort, but combining them
with database defects would make the comparison less informative.

One provider-policy gap remains explicit. The built-in authentication service
uses a byte-length password minimum, while the brief asks for a character-count
minimum. The UI now applies the requested character rule, but a direct SDK signup
can still use fewer Unicode characters if their UTF-8 encoding meets the provider
minimum. I verified that behavior rather than assuming it from an older version.
That distinction belongs in the final gap list even though the frozen signup
success checks pass.

I cannot make a defensible release-by-release claim about earlier Snapback
versions from this cold build. I did not install them or read their source. The
comparison I can support is that this published generation offers an unusually
coherent contract across schema, rules, device projections, assets, expiry,
aggregates, and jobs. Whether a particular capability was absent, less mature,
or differently spelled in an earlier release is not established by this run.

I would choose this approach most confidently when offline behavior is a core
product requirement and the team is willing to learn the projection model. I
would be more cautious when the workload demands many unbounded exploratory
queries or when a managed auth policy must expose a specific override. The
experience did not remove engineering judgment. It shifted substantial work
from synchronizing independent subsystems to proving that one declared model has
the coverage, bounds, and lifecycle the product needs. For Clique, that was the
most valuable change in the shape of the work.

The closing UI audit also mattered: starter-sized member lists concealed a paging
limit, so I added server prefix search and paging to the group-member picker.
That was ordinary application engineering, independent of the backend's ability
to store and authorize the full fixture. Passing a starter screen is not a
substitute for checking how a person reaches the same operation at scale.
