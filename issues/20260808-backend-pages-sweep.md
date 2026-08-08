# Backend pages sweep: sequences-publication contradiction, stored-enum absorption, small holes and links

**Opened:** 2026-08-08 · **Severity:** P3 (documentation, batched)

One editing pass over guide/backend/ closes all of these:

1. **Cross-page contradiction (the one real correctness item):**
   trusted-runtime-values.md:55-56 says scoped sequences are "not yet a
   published capability", but `sequence_allocation_v1` published
   (experimental, contributor-source local target) on 2026-08-04
   (eb3f78a64; sequences.md:80-83;
   schemas/capability.manifest.local-dev-sqlite-ibex.json:259). Reword to
   "experimental, contributor-local-only publication; not a hosted/public-
   package capability".
2. **Stored enums not absorbed:** mutations.md:50-54's flagship
   `createIncident` example hand-rolls a severity domain guard that
   `v.union([v.literal(...)])` stored fields now enforce at every writer
   (`SNAPBACK_FIELD_ENUM_VALUE_INVALID`, shipped 286d7fb0a 2026-08-08,
   indexed as backend.stored-enums, taught only in
   your-first-backend.md:84-101). Add a prose note + cross-link on
   mutations.md and queries.md (the sourced snippet itself is CI-pinned).
3. **`searchLiveLimits`:** text-search.md:104-111 never mentions
   `defineTable(...).searchLiveLimits({ maxLiveSubscriptionsPerTable })`
   (1..128, default 128; define.mjs:1051-1066).
4. **Push state vocabularies:** expo-push.md:96 (`failed-config`, a
   batch-attempt state, src/push.rs:894) vs :231-237 (`expo-error-config`,
   a message state, src/push.rs:929) — the page never distinguishes the two
   vocabularies.
5. **Vector filter pedagogy:** vector-search.md:82-87's sourced example
   filters `category` (a string field) with `value: true` — admitted by the
   contract (define.mjs:1593) but matches nothing; add a prose note on
   admitted filter-value types.
6. **Links:** snapshot-batches.md:139, 211-213 requires storage-enforced
   `maxEncodedBytes` order declarations but never links the only place the
   syntax is taught (sequences.md:69-76 — itself an odd home for a general
   declarative-order option, define.mjs:1940-1960); queries.md:220-221
   names `defineOwnedKeysetPages` without linking standard-patterns.md.

(The larger backend holes have their own tickets: declarative plan
vocabulary, table history, migrate surface, ctx addenda on
issues/20260808-ctx-db-verbs-undocumented.md.)

Found by the 2026-08-08 comprehensive docs review (backend slice).
