# Snapback 4: what calibration #18's builder still built by hand (feedback for the next cards)

**Status:** Open — P2, guide and product follow-ups
**Date:** 2026-09-23
**Source:** calibration #18 (`snapback4@0.3.0`), in
`benchmarks/runs/2026-09-23-snapback4-clique-astra-0.3.0/`. The builder
adopted all three 0.3 forms from the cards alone. What follows is what it
still hand-built or got wrong.

## Product and guide gaps

1. **A global feed of posts and reposts.** The builder "initially guessed an
   unsupported cross-table merge" and fell back to an application-written
   `events` table, filled by `createPost` and `setRepost` (`social.q:150`).
   That duplicates the timeline's own event stream, and it is the one
   application-owned projection left. Either let an app read the declared
   timeline's events for a global, newest-first page, or document the
   supported global-feed form in the feeds card.
2. **The Trending filter for removed posts.** The builder omitted
   `and not .removed`, although the feeds card now says it. The declared
   timeline example could show the full Trending query beside Following, so
   the filter is copied rather than remembered.
3. **One count, two declarations.** The app declares both `posts.score:
   count likes by postId` and `maintain likeCounts: count likes by postId`,
   using the maintain for the card's display count. The maintains card could
   say that a maintained column serves both ranking and display.
4. **Nested replies need a modeling example.** The builder stored a reply id
   in `postId: posts`. `doctor` reported null attribution captures, and the
   builder added `replyTarget: replies ?` plus a four-row backfill. A card
   example of replies to replies, with the reference each count follows,
   would prevent this.
5. **Typed references choose an index.** A typed reference selected a
   parent-index scan where the builder meant an id lookup. The diagnostic
   helped, but the diary calls it the hardest part of M8. Worth a sentence
   in the reads card.
6. **The services card still names OIDC.** A four-line pointer lists ten
   `E_OIDC_*` codes, although the content moved to `SERVER.md` (the L2
   mechanism criterion).

## Levels to watch

These are one reading each; no causal claim.
- **background_work fell from 94 to 89:** a digest computation that could
  park at job bounds.
- **scale_and_limits fell from 92 to 90:** builder diagnostics only, not the
  independent probe matrix.
- **data_modeling is flat at 87:** the scorer still charges restrictive
  program shapes and unfamiliar compiler vocabulary. That is the Quarry
  learning cost the program did not target.
