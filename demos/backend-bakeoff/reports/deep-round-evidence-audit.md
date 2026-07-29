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
