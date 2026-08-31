# snapback2: the compiler infers `provenance` and `site`, but LLP 0329.017 C4 shows they are authored facts

**Status:** Resolved (awaiting orchestrator landing)
**Systems:** snapback2, compiler, certificate
**Severity:** P2
**Author:** Claude Fable 5, directed by Charlie Cheever
**Date:** 2026-08-30
**Related:** LLP 1002 (open decision 0), LLP 0329.017 C4, LLP 0329.009 G2, `snapback2/packages/compiler/src/lower/`

LLP 0329.017 C4 found three S1 programs that are syntactically identical (`return scan <table>.<index> [<theOnlyArg>]`) and disagree on `provenance` (`Arg` vs `Computed`), and that corpus `site` labels (`board.columns`, `inbox.memberships`) do not follow from program or binding names. Snapback 2's TypeScript compiler (lane B0) infers both. Inference of an authored fact is a silent-wrongness surface of the kind LLP 0329.009 G2 already found once: a refactor of a helper name moves a site id, and a wrong provenance changes the certificate's prefix template without any refusal.

Ruling to implement (LLP 1002 §Open decisions, item 0): either make both explicit annotations in the authored surface (`scan(messages.byConvTime, [conversationId], { take: 50, site: 'thread.page' })`, provenance derived from a declared key origin), or keep inference but refuse with `E_PROVENANCE_AMBIGUOUS` whenever the compiler cannot decide from a single unambiguous rule, and pin `site` to `<module>.<export>.<ordinal>` so it never depends on helper names. Either way, the 17 S1 corpus certificates must stay identical (re-author the fixture if the surface changes).

**Claimed:** 2026-08-30 ~15:15 PT by session snapback-8a [f8c2a2] — implementation in flight on branches `s2/t2-provenance` / `s2/t2-bytes` (worktrees `~/projects/snapback-s2v`, `~/projects/snapback-s2y`), based on wave-1 integration `d6b2eca4e`. Wave-2 dispatch of the 0830 burn should SKIP these two tickets to avoid duplicate lanes.

**Resolution (2026-08-30):** Implemented the keep-inference ruling in commits
`417e664f4` (`Fix compiler provenance and site identity`) and `a66dd0891`
(`Count writes in compiler site ordinals`). Provenance now has
the closed rules recorded in LLP 1002 §2 and refuses unknown or mutable key
origins with `E_PROVENANCE_AMBIGUOUS` plus a compiling direct-origin rewrite.
Read sites are `<module>.<export>.<ordinal>` using the export's read/write source
order and are invariant under helper rename, extraction/inlining, and formatting.
The 17 S1 programs retained every
provenance value; the regenerated corpus changed only site identity and its
derived certificate projections/hashes. The orchestrator retains custody of
moving this ticket to `issues/closed/` at landing.
