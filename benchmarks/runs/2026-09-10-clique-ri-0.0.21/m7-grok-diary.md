# M7 diary — grok-clique-snapback2 / grok-4.6 / snapback2@0.0.21

## What I built

Group polls as a real message type and a backfilled visible-message count, on a fresh starter-state owner, after exporting a pre-M7 snapshot through the Snapback 2 headless client.

Polls are optional columns on `messages` (question ≤200, four optional option id/label slots) plus a `pollVotes` table keyed by `(messageId, principal)`. Votes are idempotent set-state intents: `insert intents { mutationId, principal } if absent` returns the existing vote on retry, and a new mutation id updates the same unique row. Live tallies come from `maintain pollTallies: count pollVotes by messageId, optionId`, read through `api.messages.pollFor`. Offline votes mark `aria-busy` / `data-pending` immediately and flush through a token-only aux client once the browser is online again — the same pattern this lane already used for offline text.

The count is `maintain visibleMessageCounts: count messages by conversationId, tombstone`, read as `visibleMessageCounts[conversationId, false]` from `groups.get` and shown on both DM and group settings as `sm-chatsettings-messagecount`. Polls increment it. Tombstones (delete-for-everyone and expiry purge) leave the group.

The schema change was an additive successor: nine optional columns, `pollVotes`, `pollTallies`, `visibleMessageCounts`. The owner applied it in place. `backfilledMaintains: 2`. Starter messages, media records, receipts, and reactions compared equal to `m7/pre-snapshot/` after the install.

## What felt easy

Snapback 2's successor story is the part that actually matched the brochure. `snapback2 check` compiled the new columns and maintains on the first try. `dev` installed generation `366192ba` without a destructive plan. The successor report named every added column, the new unique indexes, and the two backfilled maintains. I did not write a mapping job. I did not dump SQL. Existing `sm0001`–`sm0015` rows kept their ids, bodies, timestamps, and null poll slots.

Idempotent votes were equally easy because this codebase already had the pattern on reactions and follows. Copying `insert intents if absent` into `setPollVote` made the suite's retry case pass on the first run.

The M6 field-manifest snapshot was just login-as-each-persona and page `groups.mine` / `messages.thread` / `reactionsFor` / `receiptSet`. Alice and Bob saw 15 messages across two conversations; Dave/Frank/Grace/Henry saw none. That matched the starter invariant.

## What fought me

The data environment, not the language. A leftover owner was already on :52400. `reset --empty` cleared rows including `appConfig`, so the next seed died with `CONFIG` on `cfg() !`. Reset-with-seed restored the singleton and the starter logs replayed. That was an agent-error, not a platform gap.

Choreography was the other fight. A probe poll and an auto-created `m7-starter-poll` both used fixture option ids `m7-option-a` / `m7-option-b`. Playwright's `sm-poll-total` is page-global and strict, so two polls failed live tallies. Offline votes then failed to settle because `useMutation` against a Playwright-offline context does not reliably admit the outbox; this lane already knew that (IndexedDB hang, aux-client workaround). I hid duplicate option-id polls in the thread and flushed pending votes through `createClient({ url, token })` on `online`. The next choreography run was green in one shot.

## What a migration on this backend is like

Compared to Prisma or Django, Snapback 2's additive successor is closer to "the running owner notices the files and installs a new generation" than to a checked-in SQL plan. Optional columns on a populated table just appear as null. A new `maintain` is rebuilt over existing rows (`backfilledMaintains: 2`) — that is the B8 signal, and it is real, not a comment. You do not get a WHERE on `count`; grammar refuses `where` and tells you to rewrite with an index. Grouping `by conversationId, tombstone` and reading the `false` group is the way to exclude tombstones. There is no checked narrowing here because nothing was removed.

Compared to Convex, you do not rewrite documents in a `internalMutation` walk. Compared to Postgres, you do not hold a lock while a `COUNT(*)` backfill runs; the engine replaces the projected maintain ids. Compared to the previous Clique backends I have used, the honest part is the refusal: empty reset drops `appConfig`, a missing `cfg()` is `CONFIG`, and a destructive drop would have produced a JSON plan I would have had to `--apply-migration`. This change never needed that. The pre-M7 schema already had `maintain messageCounts: count messages by conversationId` (all messages, including tombstones). I left it in place and added the visible grouping so the forced-migration field is not a lie.

The client side of the migration is still Expo web vs a native-shaped SDK: live joins and offline mutations are the same workarounds as M5/M6. The schema successor itself was the least dramatic part of the morning.
