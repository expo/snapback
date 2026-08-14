# Publication clock

No clock is active in this Phase 4 implementation worktree. The qualified
publication ceremony creates `publication-receipt.v1.json` with schema
`snapback.tiny-data-publication-clock.v1`, the exact publication identity and
closure digest, canonical UTC `publishedAt`, `stopAt = publishedAt + 90 days`,
and an initially empty `amendments` array. A later amendment is accepted only
when it names Charlie Cheever, a commit, a reason, eligible configuration
versions, and a later stop, and was recorded before the then-active stop.
