# snapback2: the compiler infers `provenance` and `site`, but LLP 0329.017 C4 shows they are authored facts

**Status:** Open
**Systems:** snapback2, compiler, certificate
**Severity:** P2
**Author:** Claude Fable 5, directed by Charlie Cheever
**Date:** 2026-08-30
**Related:** LLP 1002 (open decision 0), LLP 0329.017 C4, LLP 0329.009 G2, `snapback2/packages/compiler/src/lower/`

LLP 0329.017 C4 found three S1 programs that are syntactically identical (`return scan <table>.<index> [<theOnlyArg>]`) and disagree on `provenance` (`Arg` vs `Computed`), and that corpus `site` labels (`board.columns`, `inbox.memberships`) do not follow from program or binding names. Snapback 2's TypeScript compiler (lane B0) infers both. Inference of an authored fact is a silent-wrongness surface of the kind LLP 0329.009 G2 already found once: a refactor of a helper name moves a site id, and a wrong provenance changes the certificate's prefix template without any refusal.

Ruling to implement (LLP 1002 §Open decisions, item 0): either make both explicit annotations in the authored surface (`scan(messages.byConvTime, [conversationId], { take: 50, site: 'thread.page' })`, provenance derived from a declared key origin), or keep inference but refuse with `E_PROVENANCE_AMBIGUOUS` whenever the compiler cannot decide from a single unambiguous rule, and pin `site` to `<module>.<export>.<ordinal>` so it never depends on helper names. Either way, the 17 S1 corpus certificates must stay identical (re-author the fixture if the surface changes).
