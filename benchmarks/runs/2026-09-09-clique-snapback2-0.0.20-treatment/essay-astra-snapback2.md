# Building Clique with Snapback 2

I finished the web authoring milestones with a stronger appreciation for the
idea behind Snapback and a more cautious view of the integration work required
to turn that idea into a dependable cross-platform product. This was a cold
build against the published 0.0.20 package. I did not inspect another backend
lane or a Snapback source checkout. The comparisons below come from general
knowledge of other architectures, not measurements of this run's competitors.
The scale replay has its own evidence and clock; this essay precedes the final
quantitative tally.

The central advantage was that the data model, authorization model, live query
model, and offline model were parts of one system. A message was not merely a
row plus a subscription callback. Its reads, mutations, delivery history,
retention, and device behavior had to be described in terms the system could
reason about. That is an ambitious bargain. When it worked, a small declaration
carried more responsibility than an ordinary database schema would. When it did
not, the failure was often about the shape of the declaration rather than a
missing line of JavaScript.

Quarry changed how I approached the backend. Instead of starting with a bag of
TypeScript functions and gradually adding indexes, I had to make access paths
and bounds explicit. I could express ownership and membership beside the data,
then use those constraints in message, group, and media operations. The compiler
made several poor assumptions visible early. This helped with the trust
boundary: hiding a button never counted as authorization, and the final group
membership operations explicitly reject direct-message conversations even if a
custom client calls them.

The cost was a new language in a timed build. Familiar ideas such as a reverse
index, an optional timestamp, or an array of small objects did not always map to
the syntax I guessed. Several correction loops were plainly mine. I selected an
ambiguous index, tried an unsupported object-array expression, or failed to
import an effect. The diagnostics generally gave a direction, but the
orientation was not free. With Convex I would expect to spend more of that time
inside familiar TypeScript. With Supabase I would expect SQL inspection and
ad-hoc aggregation to feel more direct. Neither comparison implies that those
approaches would automatically deliver the same offline guarantees.

The query certification also influenced product design. The canonical custom
history API ended up deliberately small because a larger joined response was
too expensive for the declared offline envelope. Receipt queries became a
separate composition at the API wrapper. Following feeds and global chat search
use explicit membership bounds, which are documented rather than disguised as
unlimited behavior. Those choices make the cost model visible, but they mean a
product engineer must understand more than the desired JSON response. The shape
of a query affects its transport, local reconstruction, and certification.

Media was where that coupling was most valuable and most demanding. Ordinary
images, video, view-once images, tombstones, and expired messages are different
capabilities, not interchangeable URLs. I built the web client around those
distinctions and verified the user-visible behavior with actual fixtures. The
native path exposed mistakes that web success had hidden: a cached file hook was
not a fetch operation, an asset helper expected a resolved URL rather than an
asset record, and Hermes did not provide the convenience timeout API I had used.
These were integration errors, not evidence that the underlying media model was
impossible. Still, the experience argues for a more complete, very small native
recipe showing download, durable cache, revocation, and cold reopening together.

Offline support reduced the amount of infrastructure I had to invent. A durable
outbox, retained query data, and reconnect semantics were available rather than
being a separate subsystem I would build on top of Postgres and a REST API.
However, they did not eliminate application state design. Pending bubbles needed
stable identities; navigation could not erase a queued intent; an authentication
restore could not make the app temporarily show a sign-in form or zero counters;
and a partial result could not overwrite a previously complete message with
missing fields. The strongest lesson was that an offline-capable backend does
not make every loading-state decision correct by default.

That differs from the work I would anticipate with Supabase. I would have a
well-understood relational store, transactions, policies, and storage, but I
would also need to choose and integrate a local database, conflict rules, an
outbox protocol, subscription reconciliation, and media cache policy. With
Convex, reactive queries and transactional application functions would simplify
many online screens, while the exact durable cold-offline contract would still
need careful product-specific treatment. A custom Postgres service offers the
most control over these mechanics and the least preassembled guarantee. Snapback
moves the boundary toward a unified system; in exchange, the engineer must learn
and respect its particular notions of completeness, retention, and replay.

The scheduled features were a good fit. Maintained Insights counters avoided
loading a user's corpus to count it in the browser. Trending had a bounded rank
index and server retirement of old entries. Digests used period keys, resumable
work, and a real idempotent provider seam. An isolated server-clock test could
close every client, restart the owner, and still observe the scheduled payload.
That is more convincing than calling the digest function from a test and saying
scheduling works. The implementation is not without cost: the digest message
phase scans the corpus in bounded chunks. Bounded work makes recovery manageable;
it does not make the total scan disappear.

The UI and test instrument were substantial parts of the work. The frozen kit
needed its native accessibility values mirrored into web ARIA, and the delivered
choreography directory had a missing schema-helper import. I used a narrowly
scoped loader rather than replacing assertions. Those issues are different from
backend defects and deserve separate attribution. Likewise, the gateway was
small, but an incorrect SSE cleanup path could make the whole application look
unstable. Production-shaped work includes these edges; a backend-only demo would
have missed them.

The native result limits my conclusion. Both required simulator attempts were
made with signed Release Hermes builds and retained artifacts, but neither full
native proof passed. Warm native screens and some cold history are visible;
they are not a substitute for a complete ordinary-media, offline queue, relaunch,
ordered flush, and read-receipt sequence. System password UI, Metro temporary
cache contention, hit-testing, and owner restart behavior complicated diagnosis.
I eventually changed the connectivity test from suspending the database process
to cutting sockets at a lane-owned proxy. The final fixture still did not render
reliably enough to claim success. I would not ship native parity on the strength
of this run's web results.

My overall assessment is therefore specific. Snapback reduced the amount of
separate synchronization and aggregate infrastructure I authored, and its
constraints helped make authorization and bounded reads concrete. It added
language-learning cost and required unusually careful treatment of partial,
retained, and predicted data in the client. The published surfaces were enough
to build the web journey, but not enough for me to complete a reliable native
proof in these attempts. I would choose the next engineering work by that
boundary: preserve the working web contracts, isolate the native state machine
in a minimal reproducible app, and use the scale receipts to decide which access
paths need redesign. A green milestone is useful evidence of the specified web
journey, not a blanket claim about production readiness or every device.

The completed replay sharpened that last distinction. The data reached the full
fixture envelope, the named and sampled invariants verified, and the measured
backend read and celebrity-write growth comparisons held. The browser's cold
sync and busy-group send/render did not meet their deadlines. A fresh-storage
repeat still showed the syncing state and substantial heap growth. That is a
concrete boundary to the friction reduction I experienced: concise, viable
backend declarations did not by themselves produce a viable full-corpus device
sync. I would treat that failure as the next engineering investigation rather
than generalizing the backend timings into a claim of whole-app readiness.
