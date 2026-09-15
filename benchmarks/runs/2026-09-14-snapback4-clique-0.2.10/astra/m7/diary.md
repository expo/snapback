# M7 — engineering diary

## What I built

I picked up the lane through its own API documentation, code, acceptance suites, run log, and final report. I started a separate backend with the inherited schema and replayed the starter segments through the existing auth/upload/mutation path. Before editing the application, I exported each starter persona's conversation history over the documented API, including the M6 message fields and a hash manifest.

The new poll is an ordinary message with a question, immutable options, and one durable vote row per person. The existing local client supplies mutation IDs and the offline outbox. Setting a different option updates that row; repeating a choice cannot toggle it away, and replaying an old acknowledged intent cannot undo a newer vote. The frozen poll widgets made composing and displaying this much easier than building another set of controls. I also handled poll tombstones so their option labels leave the synced partition.

There was no conversation-message count structure in the inherited schema. The existing message clock was an ordering mechanism, not a counter. I added and backfilled a message contribution column, then exposed `conversation.messageCount` from a persisted maintained sum. This is an API field backed by an aggregate, not a second manually synchronized column on the conversation row. Text, media, and polls contribute equally; tombstones contribute nothing; the engine's expiry sweep removes expired contributions. Settings displays the field.

## What felt easy

The inherited custom-client API was useful documentation. I could seed, snapshot, compare, and write server-boundary tests without reaching into a database implementation. The initial nullable-column backfill and required-column adoption were understandable once I followed the existing lane's recorded migration lesson. The SDK's durable queue and the frozen UI's explicit selected/pending semantics made the browser proofs direct. Reusing explicit insert/update branches for votes also avoided a prediction issue already documented in the inherited artifact.

## What fought me

I initially wrote rules and loops the Quarry compiler would not accept. Row dereferences are not rule terms, an optional integer cannot feed a sum maintain, and mutation scans over expiring tables are prohibited. For poll deletion, even a short list-driven delete loop did not satisfy the structural proof; explicit bounded point deletes did. These were mostly my mistakes in choosing language constructs. The diagnostics were useful, but the correction path involved more schema-shaped reasoning than the product behavior suggested.

The substantial backend problem came later. A compound poll-tally maintain generated an identity accepted during ordinary writes but rejected during an unrelated schema adoption. The old schema reopened the same store. I reproduced this with a tiny Quarry project and the public CLI, then removed the redundant derived tally cache and counted the retained vote rows through bounded indexes. Adoption succeeded and the API comparison showed that the message state and media hashes survived. I kept the reproduction and failed attempts rather than treating the eventual green result as evidence that migration had been uneventful.

I also caused avoidable verification work. I let dependent shell commands continue after a migration failure, and a late historical PID entry confused the inherited restart helper's last-entry selection. That made the digest regression try to signal an already-exited process. I corrected the ledger and reran the full command without changing assertions. The shell's Node shim also disagreed with the environment document; final verification explicitly used the declared toolchain. Visual review caught a duplicated poll question, which I fixed and checked with another choreography run and native export.

## How this migration compares

In PostgreSQL or SQLite, adding a nullable contribution column, populating it, and enforcing its type would be familiar explicit migration work. I would have fewer surprises around an engine-generated aggregate identity, but I would also be responsible for more of the reactive and offline machinery. Here the same Quarry definitions supply storage, access rules, replication, expiry, and local prediction. That saved application plumbing, while making the compiler's structural restrictions and schema-adoption behavior part of everyday product engineering.

My conclusion is mixed but concrete: the product extension shipped with real preservation and interaction evidence, and the starter-state migration was manageable. I would still want stronger adoption preflight around engine-generated identities before relying on this path for larger production migrations. The maintained count also follows the documented expiry-sweep delay; this run does not establish instantaneous aggregate expiry or native simulator behavior.
