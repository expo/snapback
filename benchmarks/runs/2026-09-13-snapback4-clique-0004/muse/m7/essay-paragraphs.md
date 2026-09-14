# M7 closing-essay paragraphs

Day-2 evolution turned out to be two different problems wearing one
milestone number. The first — group polls — was a straight feature build,
and the backend made it nearly pleasant: new tables, two mutations, two
queries, and the engine backfilled every aggregate over the existing rows
while classifying the change Additive in the adoption log. The decision
that carried the most weight was also the smallest: implement a poll as
an ordinary text message plus side rows, rather than as a new message
kind. It deleted an entire category of work — counting, search, expiry,
tombstones, receipts, and push previews all inherited correct behavior
on day one, because a poll simply is a message with voting attached. The
backfilled field, the second problem, was the one that forced a real
migration: the schema already carried a count, but it counted the wrong
thing, and correcting raw totals to visible-only messages took a ledger
table, a maintain, and a subtraction in two queries. Nothing about that
was large; everything about it had to be exact.

The work that actually consumed the session was not the feature but the
proof. An offline vote has to look pending within seconds on a device
whose link layer has not yet noticed the outage, then settle exactly
once on reconnect — and the device's local projection, which applies
queued writes instantly, kept eating my handmade pending flags. Twice I
built a plausible mechanism and watched the harness falsify it in under
two seconds; the passing version reads the device's own unconfirmed-row
flag instead of tracking confirmation myself. That is the session's
sharpest lesson about this backend family: the local-first tier already
knows what it has not yet confirmed, and any client-side mirror of that
knowledge is a bug waiting for a race. The rest of the proof burden was
environmental but no less real — test residue that overflowed a search
page, overlapping runs that poisoned each other's evidence, a bundler
cache that served yesterday's port, an export command that ate the web
bundle. Each left a scar in the run log and a guard in the procedure.

What remains is a lane that does something the pre-M7 artifact could
not: a group can ask itself a question, change its mind, lose its
connection mid-thought, and still converge — with the conversation count
in settings telling the truth about what is actually still there. The
pre-existing messages, media, receipts, and reactions survived the
schema generation bump byte-for-byte against the pre-M7 snapshot, all
previously green suites still pass on the migrated backend, and the
two-client choreography watched tallies move live and an offline vote
reconcile. Day-2 work, done the way day-2 work should be done: the old
data intact, the new behavior proven by someone else's harness, and the
whole story written down before the numbers.
