# Snapback 4: a reference column accepts an id that names no row

**Status:** Closed
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

## Resolution — 2026-09-13

References remain typed IDs without implicit target lookups or delete cascades.
The types and writes cards, E_INPUT explanation, package README and
[LLP 3000 §7](../../llp/3000-snapback4.explainer.md#7-decisions-during-execution)
now state the policy. Mutations requiring a visible target use an explicit,
metered `require exists t[id] else CODE`; absent and hidden rows both refuse.
The Interview sketch guards writePost, vote, comment, markSeen and setAffinity.

The authored regression in
[frontend_regressions.rs](../../snapback4/crates/snapback4-lang/tests/frontend_regressions.rs)
checks the string `"null"` versus JSON null, unchecked insert/update/upsert,
absent/hidden refusals without row changes, a visible target with one additional
examined row, and target deletion without cascade. It passes in the complete
suite (125 Rust tests, 94 client tests and 9 fixture tests). The revised
Interview sketch also compiles: 12 tables, 10 operations, zero notes.
Implementation: `fd1d9d91f9e96390bbe80c32e9438d93bdd16bdd`; independent read-only
review reported no material findings. This closes an undocumented semantic
choice; it does not introduce automatic foreign keys.
