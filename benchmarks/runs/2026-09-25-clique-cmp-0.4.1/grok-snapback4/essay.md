# Closing essay — Clique on Snapback 4

This run was a cold build of Clique (accounts, feeds, WhatsApp-shaped messaging, media, search, insights, offline, scale replay) against the published `snapback4@0.4.1` pin, using only the package README, `guide` cards, generated types, and `why` codes. I am comparing the experience to Convex and Supabase as I know them from other work, not from anything in this machine’s sibling lanes.

## Where the backend reduced friction

Password identity plus a unique handle constraint was the first hour of M1, and it mapped almost one-to-one onto what Convex’s auth + a unique index would have been, with less ceremony than rolling bcrypt and JWT on Postgres. `HANDLE_TAKEN` as a named refusal, not a generic 23505, is the kind of error I wish PostgREST surfaced by default.

The data model is the other place Snapback 4 earned its keep. `likeCount: count likes`, `unique postId, principal` on likes, `expire at .expiresAt` on messages, `once` on view-once assets, and `sync to memberships[.conversationId]` are declarations I would have encoded as triggers, cron, and RLS on Supabase, or as a pile of `useQuery` plus a cleanup mutation on Convex. The feeds card (`following` as activity where the actor is me or someone I follow) compiled on the first `check`. Insights totals as `count likes by .postId.authorId` is the same idea as a Convex aggregate, except the engine owns the fan-out.

Offline is the third. The replica is not a cache I configured; queued writes and `--replay` holding schedules are productized. M6’s choreography (flush in order) and M8’s dual-offline convergence passed without me writing a queue. On Convex I would have been online-only or inventing an IndexedDB outbox. On Supabase I would have been arguing with the service worker.

Scale replay is not something I have as a first-class tool in either alternative. A 167k-action log against a fresh `--replay` instance, with checkpoints that bound prefix hashes, is closer to a ledger than to “run the seed script again.” When it finished, `snapback4 sql` counts matched the invariant manifest exactly. That is a kind of confidence Convex’s dashboard and `psql` do not give me about a synthetic history.

## Where it added friction

Live *ephemeral* state fought harder than live *rows*. Typing is a 4.5s `expire at` upsert, which is the documented recipe, and a node client can set it and read it back. Getting Playwright’s `pressSequentially` to drive a controlled React Native Web `TextInput` *and* have the peer’s `useQuery(typingNow)` paint `sm-convo-typing` inside two seconds was a different problem. Convex’s presence would have been a similar table; the extra cost here was RN-web observability, not the backend. I still spent more of M3 on that 2s/5s window than on `openDM`.

Receipts were worse, and that one *is* backend-shaped. Membership watermarks (`deliveredOrdinal` / `readOrdinal`) plus `connected[p]` plus a `chatFocus` heartbeat is three mechanisms where I would have had one Convex query: “who has this ordinal?” The starter group includes Erin, who is not a live choreography peer; aggregate “delivered” then either never advances (if you count her) or jumps to read (if you ignore her and Bob is focusing). `guide presence` explains `connected[p]`; it does not explain “open chat ⇒ peer observes read,” and `membersOf` did not always invalidate when a peer’s watermark moved. I ended up polling `memberPresence` from the client, which is the sort of workaround I associate with “the subscription key is wrong,” not with a finished recipe.

Membership itself is declared cleanly (`addMember` / `promoteMember` / `removeMember`, cap 50). The choreography’s handle-level semantics (`dave:member`) sit on kit rows whose ids are principals. Mapping principal→handle through `directory` and `profileByHandle` should have been enough; in the two-client harness it was not, and a newly added member’s replica could show a composer before the next live send appeared. Convex would have had the same UI-kit problem. The backend-shaped part was “joining the sync set does not always mean the next insert is in `usePage(thread)` before the 25s timeout.”

Assets were mostly fine (`client.upload` then `{ id }` on the row, same shape as Convex file storage). RN-web `<img src={blob}>` never counted as loaded for Playwright; a 1×1 PNG poster for video and a real DOM `<input type=file>` prepended to `document.body` were client hacks, not storage hacks. `once` consuming on fetch did what the card said.

## How the shape of the work changed

On Supabase I would have spent M1 on RLS policies and M2 on indexes. Here those hours went into Quarry views and then into making the frozen kit’s test IDs observable on RN-web (`aria-valuetext` / `data-value`, because `accessibilityValue` does not survive). The backend moved the “hard” part later: not “can I express a unique like?” but “can a second browser’s replica notice a watermark, a presence bit, and a typing row in the windows the harness measures?”

Convex would have felt closer for live queries. `usePage` / `useQuery` is that shape. The difference is Snapback 4 also owns expiry, once-assets, replay, and the follow-graph fan-out, so I did not write those jobs — and then I did not fully control when a peer’s replica caught up, which is the other side of “the engine owns it.”

I would take this backend again for a product whose source of truth is a sync set with expiry and set-state intents. I would not yet take it, without more receipt recipes, for a product whose acceptance bar is Playwright watching `aria-valuetext` on a second client two seconds after a keystroke.

The honest leftover is M3’s two-client choreography: dm-live stayed green; typing, delivered watermarks, and live delivery into a just-added member’s replica did not. The API suite for that milestone passed. That split — engine-level operations green, peer-observable UI not — is the comparison I would remember.
