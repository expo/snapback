VERDICT: READY

The Get-classification change matches the stated contract: a missing unique-key point under literal `Allow` may stay covered when `CoverageIndex.drained` already holds that complete key, without minting `hasAbsence` / `authorityAbsence` or touching the pooled-object fallback.

### Product fix
In `ClientStore.uncoveredSites` (`snapback2/packages/evaluator/src/store.ts`), a traced point miss is no longer automatically `partial` when all of these hold: `rules.read === 'Allow'`, the index is unique, lookup is empty, and `facts.drained(...)` is true for the prepared full key. That is the right site: `Runner.get` records absences for misses, while owner delivery keeps group exhaustion on the range and only primary `byId` negatives (`offline.rs`). `hasAbsence` / Exists / cap `authorityAbsence` stay on the old facts. Restricted rules, non-unique indexes, truncated/`Limit` pages, bounds, eviction, wrong prefix/index/rule, and receipt removal still go `partial`, as in `test-maintained-address.ts`.

The composite `{ row, count }` cannot use the cached object fallback (`offline.ts` `cachedAnswerOnly` requires no pooled values). Making the twin rerun `fresh` is what lets a pooled row and a proved zero reconstruct together instead of mixing an old complete object with later images.

### Diagnostic
`bound-schema.ts` still refuses `<`/`<=`/`>`/`>=` in rules. Mutation insert/update/delete keep “move … into a mutation require”; read and channel paths (channel bind has no `effect`, so they take the non-write arm) tell the author to keep authorization and not treat `require` as an equivalent rewrite. Tests in `quarry-diagnostic-checks.ts` lock both arms. No grammar or transport change.

### Qualification (as reported, not re-run)
Evaluator corpus, the new contrast block, and the real-owner zero/positive composite (receipt replay, rename, cold reopen, queued removal) are the right controls for this boundary. Gzip 89898 (+55) is inside the 90000 ceiling.

### Optional nonblocking
- Literal `'Allow'` does not include Public IR (`public` / `read <- public`). Uniformly readable Public unique Gets still need a delivered absence; byId public misses already get that. Aligning with `evaluateRule`’s Allow/Public cases would only matter for secondary unique keys on Public tables.
- `uncoveredSites` re-prepares a prefix instead of calling existing `hasCompleteRange`; behavior should match for ordinary scalars.
- New real-owner test does not save/restore `SNAPBACK_URL` (the earlier count test does).
- Working gzip target 80000 remains unmet; that is allocation status, not a new hole in this delta.
