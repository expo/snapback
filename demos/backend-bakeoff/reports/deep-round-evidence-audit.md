# LLP 0102 deep-round evidence audit

**Owner:** Primary coordinator
**Snapback product/source freeze:**
`5f31cb6174daaefa04a1e05242acbbc22c725040`
**Protocol freeze aggregate:**
`ab95cd3099b7dde29810046ba495884e3bc641a3bdfb811ab828db10c6b7f72a`

This is the coordinator's serialized audit log. Worker self-checks are useful
inputs but do not substitute for this review. Scores, adjudications, and final
synthesis remain coordinator-owned.

## Linear / Snapback

- Capsule verifier: PASS.
- Frozen identities: exact product/source commit and aggregate match.
- Results: 10 PASS, 4 GAP, 0 FAIL.
- Evidence confidence: 14/16 after coordinator classification; protected
  offline/reconnect is the only missing dimension.
- Referenced evidence: every path resolves.
- Authority/conflict/transport/settlement: direct native-session,
  stale-read-set, polling-disabled second-client stream, and authoritative
  readback evidence.
- Target/cleanup: fresh local target identity, database hash, exact runtime,
  reservation sidecar, and persona-carrier negative probes.
- Secret audit: no runtime bearer or private credential retained; bearer-shaped
  references occur only in source code and generated capability metadata.
- Adjudication: complete. Search, protected offline editing, reviewed
  migrations, and hosted operations remain honest product/profile gaps.

## Linear / Firebase

- Capsule verifier: PASS.
- Frozen identities: exact product/source commit and aggregate match.
- Results: 12 PASS, 1 GAP, 1 unavailable remote dependency.
- Evidence confidence: 16/16.
- Referenced evidence: every scenario and cleanup path resolves.
- Authority/conflict/transport/settlement: direct Auth-emulator principals,
  Security Rules denials, callable transactional revision CAS, second-client
  server snapshot, and pending-write/readback evidence.
- Offline: direct cold page in the isolated persistent browser profile,
  transport disabled before query, 50 retained rows, queued optimistic edit,
  unchanged pre-reconnect authority, and settled post-reconnect authority.
- Migration: 500-row `BulkWriter` backfill, before/after counts, committed
  compound index, and indexed query proof.
- Target/cleanup: all assigned ports `4321/4521/4522/5321/8321/9321/9421`
  and provider-issued ports `9150/9299/9499` independently observed closed;
  exact process groups absent.
- Secret audit: committed email/password and API-key-shaped values are explicit
  fake emulator fixtures, not external credentials; no hosted credential or
  session secret is retained in evidence.
- Adjudication: complete. Native full-text search is a product GAP. Hosted
  deployment is credential-unavailable and is not scored as a Firebase product
  failure.

## Linear / Supabase

- Capsule verifier: PASS.
- Frozen identities: exact product/source commit and aggregate match.
- Results: 12 PASS, 2 GAP, 0 FAIL.
- Evidence confidence: 14/16 under the arm's disclosed indirect
  offline/reproducibility boundaries.
- Referenced evidence: every repo-relative path resolves.
- Authority/conflict/search/migration: direct Supabase Auth + PostgreSQL RLS,
  row-locked RPC/activity ordering, generated weighted `tsvector` + GIN, and
  separate additive SQL evolution evidence.
- Transport: direct second-client Postgres Changes evidence retained together
  with the first cold `SUBSCRIBED`-then-missed-write attempt. Seven measured
  issue-update deliveries passed; coordinator accepts the pass and preserves
  the readiness reliability negative.
- Offline: direct negative proof that bare `supabase-js` retained no cold rows
  and queued no edit. This remains a product GAP.
- Target/cleanup: exact Compose/CLI project has zero matching containers,
  volumes, or networks; Vite `4322` and target ports `56431–56440` were
  independently observed closed.
- Secret audit: no generated local key, hosted token, password, or other
  credential appears in the committed capsule/receipts.
- Adjudication: complete. Hosted operations remain an environment/profile GAP
  and are not extrapolated from the local target.

## Linear / Convex

- Capsule verifier: PASS.
- Frozen identities: exact product/source commit and aggregate match.
- Results: 12 PASS, 1 GAP, 1 unavailable remote dependency.
- Evidence confidence: 14/16; persistent offline/reconnect is the only missing
  dimension.
- Referenced evidence: every scenario and confidence path resolves.
- Authority/conflict/search/transport: direct custom-JWT principals and
  negative authority probes, transactional revision CAS, native search-index
  results, and second-client reactive WebSocket delivery.
- Performance: the coordinator rejected cached `ConvexClient` read timings,
  recreated the target, and accepted only the clean `ConvexHttpClient`
  list/detail samples. Two warmups and seven recorded samples are retained.
- Migration: direct 501-document backfill and indexed read proof. It is
  correctly described as an application-authored optional-field rollout, not
  a first-class provider migration facility.
- Target/cleanup: all exact namespace rows are zero; ports `3323/3324/4323`,
  `.convex`, `.arm-runtime`, `.env.local`, private signing material, and public
  persona carriers were independently observed absent. The final database hash
  was retained before exact target removal.
- Secret audit: generated local admin/instance secrets existed only inside the
  ignored runtime target and were deleted with it; none appears in committed
  source, capsule, or receipts.
- Integrity correction: the coordinator found and fixed a stale hard-coded
  Mallory hash in the capsule generator, then regenerated and reverified the
  capsule against the direct seed receipt.
- Adjudication: complete. Persistent offline capability is a product GAP.
  Hosted deployment is credential-unavailable and is not scored as a Convex
  product failure.

## Linear / SpacetimeDB

- Capsule verifier: PASS.
- Frozen identities: exact product/source commit and aggregate match.
- Results: 11 PASS, 2 GAP, 1 unavailable remote dependency.
- Evidence confidence: coordinator-adjusted to 14/16. Offline/reconnect is
  partial, and cleanup isolation is indirect because the final database
  negative probe failed on CLI syntax.
- Referenced evidence: every capsule path resolves.
- Authority/conflict/transport: direct hashed principals, caller-dependent
  views and negative private access, two-client revision CAS, authoritative
  convergence, and native second-client WebSocket row callbacks.
- Pagination: deterministic but requires an identity-scoped durable
  `page_result` table and reducer because parameterized views are unavailable.
- Search/offline: explicit product GAPs. Warm disconnected memory is not
  credited as persistent cold state, and a pending disconnected reducer call
  is not credited as queued mutation.
- Migration: direct V1→V2 plan and schema/count receipts prove a defaulted
  indexed field added to all 500 issues without data deletion.
- Target/cleanup: the exact-identity delete exited successfully, validated
  processes stopped, ports `3320/4320` closed, runtime/credential state was
  removed, and unrelated baseline state was preserved. The raw post-delete
  `describe` exited on invalid argument ordering, so its claimed direct
  database-absence proof is rejected and retained in a coordinator
  adjudication.
- Secret audit: committed evidence contains hashes rather than raw actor
  identities or runtime JWTs; the exact ignored credential root was removed.
- Adjudication: complete with cleanup-confidence correction. Hosted Maincloud
  is credential-unavailable and is not extrapolated from standalone local
  evidence.

## Linear / Appwrite

- Capsule verifier: PASS.
- Frozen identities: exact product/source commit and aggregate match.
- Results: 12 PASS, 1 GAP, 1 unavailable remote dependency.
- Evidence confidence: 16/16. The offline dimension has direct negative
  browser evidence plus authoritative reconnect, even though the capability
  itself is a GAP.
- Referenced evidence: every capsule path resolves.
- Authority/conflict/search/transport: native Auth sessions and Team roles,
  two independent native transactions yielding one commit plus one typed 409,
  `Query.search` over a full-text index, and direct second-browser Realtime
  payloads.
- Offline: warm React memory, zero cold rows, rejected unqueued write, and
  50-row unique authoritative reconnect are separated explicitly.
- Migration: direct asynchronous attribute creation, 500-row backfill,
  compound-index readiness, and indexed read proof; correctly not described as
  one atomic migration.
- Target/cleanup: empty baseline and exact target hash; ports
  `4324/8091/8491/20081` closed; 29 exact containers, 12 volumes, two networks,
  installer, and all worktree-local runtime/CLI/browser paths absent.
- Secret audit: credentials were generated only into ignored arm runtime state
  and were removed; committed source constructs random credentials but contains
  no value.
- Dependency/operations negative: the official stack's 29-container footprint,
  installer-stream failure, and 16 npm audit findings remain retained evidence.
- Adjudication: complete. TablesDB persistent offline/cache is a product GAP.
  Hosted Appwrite Cloud is credential-unavailable and is not inferred from the
  self-hosted target.

## Linear / InstantDB

- Capsule verifier: PASS after coordinator format correction.
- Frozen identities: exact product/source commit and aggregate match.
- Results: 12 PASS, 2 GAP, 0 FAIL.
- Evidence confidence: 16/16.
- Referenced evidence: every capsule path resolves.
- Capsule correction: the worker-delivered file used a non-frozen
  `offline-reconnect` transport label and omitted six command intervals. The
  generator now uses `local-optimistic` and explicitly labeled coarse bounds
  from retained milestones. Raw receipts, outcomes, and confidence scores are
  unchanged.
- Authority/conflict/transport: three native guest principals with direct
  positive/negative permissions, barrier-dispatched LWW transactions with one
  converged whole-record winner, and direct second-client WebSocket query
  delivery.
- Offline: a newly launched Chrome process loaded 50 InstantDB IndexedDB rows
  with provider HTTP/WebSocket disabled, showed a queued optimistic edit, then
  reconciled and restored it against independent authority. The receipt does
  not overclaim queue survival after terminating that browser process.
- Search: explicit product GAP; `$like`/`$ilike` are not relabeled as
  full-text search.
- Migration: base/evolved schema pushes, indexed optional field, backfill, and
  preserved counts are directly retained.
- Target/cleanup: one fresh hosted temporary target identity; all product
  entities and `$users` reduced to zero, Bob's old token invalidated, and raw
  local credentials removed. The app itself cannot be deleted with its scoped
  token; schema/permissions persist only until documented provider-managed
  expiry after more than 24 hours.
- Secret audit: committed source reads ignored runtime credentials but retains
  no value; provision and push receipts are redacted.
- Adjudication: complete. Native search and hosted logs/rollback/immediate
  target deletion remain explicit gaps rather than inferred capabilities.

## Partiful / Supabase

- Capsule verifier: PASS.
- Frozen identities: exact product/source commit and aggregate match.
- Results: 14 PASS, 1 unavailable remote dependency.
- Evidence confidence: 14/16. Protected connected-client invalidation is
  direct but the frozen app has no persistent-offline scenario; cleanup lacks
  a separately timestamped empty pre-provision baseline.
- Referenced evidence: every capsule, receipt, and confidence path resolves.
- Public/private authority: direct anonymous preview field boundary, denied
  table/private-event access, six native Auth personas, RLS host/cohost/guest
  distinctions, and outsider negatives.
- Contention: two authenticated RSVP RPCs raced against one locked event row;
  exactly one committed and authoritative seats remained one.
- Transport/revocation: cold `SUBSCRIBED` misses are retained. The corrected
  policy transition, ten wall posts, two RSVP transitions, and post-revocation
  negative delivery are direct Postgres Changes evidence.
- Assets/scheduling: private Storage upload/download hash/outsider
  denial/deletion are direct. A real five-second `pg_cron` job ran one due
  reminder and remained deduplicated through a second interval.
- Effects: one Edge Function called a separate deterministic provider Edge
  Function over HTTP using server-only configuration. Known-success retry and
  ambiguous-after-accept reconciliation each retained one provider delivery
  and explicit attempt states.
- Target/cleanup: exact project containers/volumes/network and
  `4330/57431–57440` are absent; runtime/XDG state is removed; every
  pre-existing unrelated container is preserved. The missing timestamped empty
  baseline is disclosed and scored indirectly.
- Secret/dependency audit: no generated local key or user token appears in
  committed evidence; automatic Edge credentials remain server-side. npm audit
  reports zero findings.
- Adjudication: complete. Hosted deployment/config/logs/rollback/effect
  delivery are credential-unavailable and are not inferred from local
  evidence.
