# Snapback 4: a reference column accepts an id that names no row

**Status:** Open
**Priority:** P3
**Date:** 2026-09-13
**Systems:** `snapback4/crates/snapback4-core/src/engine/write.rs`, `validate.rs`; the guide's `types` card; the README
**Author:** Claude Fable 5.1 (LLP 3000.004)

At 0.1.14, `snapback4 run vote '{"postId":"null","direction":1}' --as alice`
against LLP 3000.004 §5's sketch (`votes.postId: posts`, `upsert
votes[postId, viewer] { direction }`) returned `state: sent` and stored
`{"postId":"null","principal":"dev:alice","direction":1}`; no `posts` row
with that id exists. The id came from a shell variable that read `null`,
which is how it will arrive from any client with a bug.

Nothing in the README, the `types` card or `snapback4 why E_INPUT` says
whether a reference column is checked against the referenced table on
write. Either is a defensible posture — Snapback 2 may already have ruled
— but it has to be written down, and if references are unchecked the
`writes` card should say so and the sketch's `require exists prompts[promptId]`
is the pattern every reference-taking mutation needs. If they should be
checked, it is one point read per reference column per write, metered.

Decide, document, and test once.
