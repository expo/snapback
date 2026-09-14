# M7 diary — Day-2 evolution

## What I built

Group polls as a real message type, plus a backfilled visible-message count on every conversation.

Polls live on `messages` as optional columns (`question`, `optionA`–`optionD`) so the change is additive: existing rows stay intact with nulls. Votes are a new `pollVotes` table, one row per (message, user), updated in place. `setPollVote` is set-state, not a flip: it writes an option key and relies on Snapback’s client-minted mutation id so a retry cannot invert a later change. Tallies are live because votes sync to members, the same way reactions already did. Offline votes go through `useMutation`, so they queue, predict, show `aria-busy` / `data-pending`, and settle on reconnect.

The count is `maintain visibleMessageCounts: count messages by conversationId, tombstoned`. Chat settings and `conversationOf` read the `false` bucket (currently visible). Expired rows drop when the engine sweeps them; tombstones move to the other bucket. Polls are rows in `messages`, so they count.

The Weekend Plans choreography poll is seeded after the suite (`sm-m7-weekend-poll`, options mapped to `m7-option-a` / `m7-option-b`) so the two-client harness has something to click without the suite voting on it first.

## What felt easy

Snapback already had the hard parts of M7 sitting in the platform: mutation ids, local-first outbox, predicted rows with `pending`, and maintains that recompute from source rows. Once `check` accepted the schema, restarting `dev` on the same `.snapback4/store.sqlite` backfilled both starter chats (DM 6, Weekend Plans 9) without a hand-written job. Duplicate vote intents came back `replayed: true` with the same seq. The inherited local client meant the offline vote choreography was wiring, not a new queue.

## What fought me

The inherited web conversation is not the kit’s `MessageBubble` list. Playwright sees a `position:fixed` HTML overlay (`WebConvoSurface`). Polls had to be injected there with the contract’s `aria-valuetext` / `aria-selected` / `aria-busy` attributes, or M7 choreography would never see `sm-poll-option`. That is a lane wart, not a Snapback wart.

The first choreography process used Homebrew Node 25 against a setup-identity pin of Volta Node 24.18.0 and died at startup with a setup refusal. That was PATH, not product. Re-running with the pinned binary was enough.

I also had to be strict about sequence: wipe the leftover store, seed starter only, export the M6-field snapshot, *then* edit Quarry. Editing first would have made the “migration” fictional.

## What a migration on this backend is like

Compared with Postgres + a migrator (Rails, Django, Prisma): there is no numbered SQL file and no `DEFAULT` dance. You change `schema.q`, `snapback4 check` classifies the program, and `dev` re-adopts the store. Additive optional columns and a new table just appear; a new `maintain` is filled from existing source rows. You do not get a preview of the rewrite as SQL, and you do not write a down migration. Destructive changes are a deploy flag, not a carefully ordered `ALTER`.

Compared with Firebase / a schemaless document store: the compiler is the adult in the room. You cannot “just add a field in the client.” Existing documents do not silently acquire a new required column; optional columns stay null and the types file updates.

Compared with Convex-style push: the closest cousin. The unit of evolution is a compiled generation, devices re-derive their partition, and queued writes that no longer fit fail typed. The maintain-as-backfill is nicer than a one-shot Convex mutation walking every chat, and worse if you wanted a custom count (for example excluding tombstones by a predicate the engine does not index). Grouping by `tombstoned` was the idiom that made the backfill honest without a job.

The pre-M7 schema did **not** already carry a conversation message-count column or a `count messages by` maintain. Likes, follows, and insights maintains were already there. M7 is the first time conversations got a count structure.
