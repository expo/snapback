# Review: derived-fork implementation & security (LLP 0185 Phase 6 item 4), commit 7c2a27e0e

**Family:** fable
**Provider/runtime:** Anthropic / Claude (Fable 5), Claude Code agent session
**Date:** 2026-08-06
**Redacted:** no
**Method:** fresh clean-context session; read-only worktree pinned at
`7c2a27e0e`; mutually blind (the codex worktree and any 2026-08-06
`llp/reviews/` artifact were not read). Adversarial review of the landed
derived-fork surface by reading `src/instance_fork.rs`,
`src/storage/write_authority.rs`, `src/storage/auth_invalidation.rs`,
`src/storage.rs`, `src/cli.rs`, `src/server.rs`, `src/local.rs`, and
`tests/instance_fork_cli_v1.rs`, plus the row-13 bench receipts and the guide
page. Tests were read for non-vacuity, not executed: this worktree has no
bootstrapped Ibex runtime (`vendor/ibex` uninitialized, no `target/`), and the
brief permits reading with rigor. Every finding cites file:line at this commit.

---

## Overall verdict

**READY for publication of the narrow local `operating.instance-forks` claim
as a source/guide capability-index row — contingent on the LLP 0185 Phase 6
item-0 governance gate, which is not the code's to satisfy and is not yet met.**

The derived-fork isolation, credential scrubbing, egress quarantine (including
the Hermes host-op legs), asset custody, TTL/renewal, resource admission,
cleanup concurrency, and fail-closed posture of every new surface are
implemented carefully and their critical properties have non-vacuous tests. I
found no isolation escape, no credential-survival path, no egress leak, and no
way the landed changes regress the parent (non-fork) product path. The
security concerns below are all in-process hardening (a diff receipt that is
tamper-*evident* rather than tamper-*proof*) that do not falsify the narrow,
honestly-scoped claim — which advertises the diff as "a review aid, not a
complete audit and not production migration admission" (guide
`operating/instance-forks.md`).

**Publication caveat (governance, not code):** LLP 0185 Phase 6 item 0
requires LLPs 0158/0163/0164/0165 to have completed their own acceptance loop
and every applicable LLP 0162 row (incl. row 13) to be green or rescoped.
0163/0164/0165 are all still **Draft**, and my companion Scope-1 review marks
**0164 NOT READY** until a dated revision records the `snapback.fork-net-diff.v2`
receipt it owns. So the flip of the capability row from target `none` to `local`
should wait on those owners' acceptance and the small 0164 doc fix, even though
the implementation itself is ready.

---

## Strengths (verified)

- **Isolation, same-appId boundary (0158 OQ9).** Forks are explicitly
  non-promotable (`promotable: false`, `src/instance_fork.rs:1102`), keep the
  parent's `appId` while minting a new instance, and refuse nesting at two
  gates (`SNAPBACK_FORK_NESTED_REFUSED`, `src/instance_fork.rs:1087-1091,
  3318-3323`). Boot refuses a database that presents as both a derived
  deployment and an in-app branch (`src/storage.rs:1889-1895`). Parent/fork
  cross-selection and mutation are refused over live HTTP in both directions
  (`tests/instance_fork_cli_v1.rs:980-1024`), and a parent write after the
  fork point never appears in the fork (`:954-963`).

- **Credential/authority scrubbing is a closed inventory, fail-closed.**
  `audit_connection` refuses (`SNAPBACK_FORK_CUSTODY_UNCLASSIFIED`) on any
  `_snapback_*`/`_auth_*` table with no custody rule
  (`src/instance_fork.rs:650-687`), so a newly-added parent table cannot be
  silently copied; a `Refuse`-class occupied table refuses the whole cut. The
  parent-credential corpus proves sessions, agent credentials, and **live and
  already-revoked** grants are all absent post-fork, and that the parent's
  resume token, search cursor, and asset signed-URL token all fail to verify
  under the rotated fork keyring, with authorization-stream and data-version
  stream both rotated (`src/instance_fork.rs:4269-4460`). Replacement sidecars
  mint into a collision-checked empty namespace
  (`SNAPBACK_FORK_SIDECAR_COLLISION`, `:1119-1128`) and boot re-validates each
  (`validate_minted_sidecars`, `:1491-1568`). LLP 0163 protected-detail
  ciphertext table and its keyring sidecar are `Scrub`/re-minted
  (`:218-221`, `:1148`). The startup path also blanks any inherited
  `admin_token` from the process environment before minting the fork-local one
  (`src/cli.rs:7343-7372`).

- **Egress quarantine, including the Hermes VM legs.** Twelve closed families
  (`src/instance_fork.rs:1573-1602`); each `deny()` writes exactly one bounded,
  payload-free marker (family + counts only, no URL/body/token) and returns
  `SNAPBACK_FORK_EGRESS_DENIED` (`:1658-1684`). Every family has one row and
  one attempt in the corpus (`:4553-4591`). The host-op vocabulary classifier
  `for_derived_host_op` is the VM boundary: `db.*`, `sequence.allocate`,
  `assets.attach`, `runtime.*`, and the local action-metadata ops return
  `None` (allowed); every network/push/stream/jobs/cron op and **any
  unclassified future op** deny (`:1623-1650`) — the fail-closed future-family
  rule. The gate is wired at the runtime host-op dispatch
  (`src/local.rs:3846`, `src/server.rs:1406-1408`) and at real maintenance
  routes: telemetry export refuses before the export read
  (`src/instance_fork.rs:4593-4638`), push-receipt maintenance refuses before
  provider I/O (`:4640-4705`), and cron tick / jobs drain / asset provider
  deny (`src/local.rs:7718, 19874, 19952, 20007`). Autonomous cron, jobs, and
  asset workers are additionally idled at fork boot (`src/cli.rs:7864-7900`),
  so quarantine does not rely on a single choke point.

- **Asset custody independence, both directions, GC and reap exactness.** The
  live-server asset test is genuinely bidirectional and non-vacuous
  (`tests/instance_fork_cli_v1.rs:1057-1364`): copied blobs live under a
  fork-private root with identical bytes but a different path; the parent's
  pre-cut signed URL 403s on the fork (witnessing signing-key rotation, not an
  absent record); a fork-only upload never lands in the parent tree; fork
  delete+GC reclaims only fork-private bytes while parent bytes stay served,
  and the reverse; `fork drop` and `fork reap` each remove the complete tree
  (carrier + upload) without touching the parent. Same-cut copy is
  digest-and-length verified per blob and refuses a torn cut
  (`copy_fork_private_assets`, `src/instance_fork.rs:3429-3527`); non-`local-fs`
  stores and unknown digest algorithms fail closed
  (`ASSET_CUT_UNSUPPORTED_CODE`).

- **TTL / expiry / renewal.** Expiry is boot authority: `inspect_boot_at`
  refuses an expired fork with `SNAPBACK_FORK_SERVER_EXPIRED`
  (`src/instance_fork.rs:1274-1285`) and `LocalDatabase::open` calls it
  (`src/storage.rs:1887`), so a stale reaper is not required for safety; diff
  deliberately uses `inspect_published_evidence` instead so an expired fork
  stays inspectable/removable (`:2695-2703`). Renewal strictly moves expiry
  later, never shortens/clears/resurrects, is bounded by the max lifetime, and
  recovers to one consistent expiry via a sentinel+intent crash matrix
  (`:2368-2422`, tests `:5204-5353`). Lineage with a finite expiry `<=`
  creation refuses as invalid (`:1445-1455`).

- **Resource-limit refusals.** `enforce_creation_limits` refuses fork-count,
  per-fork-byte, and total-byte bounds **before** any staging I/O with observed
  usage in the diagnostic (`src/instance_fork.rs:2596-2652`); diff-work is
  bounded and refuses deterministically (`:2737-2747, 3114-3124`).

- **Cleanup locking / concurrency.** Destructive lifecycle actions hold a
  per-fork `flock` (Unix) whose critical section spans re-bind → stop → drop,
  so a losing actor observes clean absence, not a torn teardown
  (`lock_cleanup`/`drop_managed_locked`, `src/instance_fork.rs:2239-2303`;
  reap holds it across the whole verb, `src/cli.rs:3054-3092`). Concurrent
  drops settle idempotently (`NotFound` is not an error, `:2290-2294`; test
  `:5121-5164`). `managed_target` re-binds every path as a real, non-symlink,
  exact direct child before acting (`:2083-2226`) — path validation blocks
  registry corruption from widening a deletion.

- **Fail-closed new surfaces.** Coverage receipt requires two agreeing durable
  carriers and full field/stream/manifest/activation-time re-verification
  (`verified_fork_app_row_coverage`, `src/instance_fork.rs:2812-2892`); net
  diff downgrades rather than upgrades on retention gap, unarmed, or late arm
  (`:3134-3191`) and refuses `SNAPBACK_FORK_DIFF_ORACLE_MISMATCH` on an
  unexplained net change or a journal/head post-image disagreement
  (`:3075-3089, 3155-3167`); the cold-start carrier stops the child and returns
  `SNAPBACK_FORK_WRITER_COVERAGE_INVALID` if complete startup returns without
  coverage evidence (`src/cli.rs:3574-3592`), and refuses malformed generated
  manifests before spawn (`:3417-3474`). The publication state machine is a
  staging-sentinel/rename/fsync sequence with a full crash-cut matrix and
  registry-independent `recover` (`:3301-3421, 3570+`; test
  `:6004+`).

- **No parent (non-fork) regression.** `WriterAuthorityV1::install` returns
  early when no manifest is armed (`src/storage/write_authority.rs:311-323`),
  so an ordinary parent open installs no SQLite authorizer and pays no
  read-path cost — the new machinery is inert unless armed. Arming is gated
  behind the `--derived-fork-arm-writer-coverage` flag that only `fork create`
  passes (`src/cli.rs:3509-3514, 7479-7491`), and the fork uses distinct lane
  names (`src/operation_ledger.rs:1262-1281`) that cannot satisfy the
  storage-wide predicate (`src/storage.rs:2489-2515`), so nothing here changes
  the parent's default-arming policy. The `malloc_zone_pressure_relief` call is
  macOS-only and fires only at the rare activation cut
  (`write_authority.rs:570-586`).

---

## Concerns (severity · cite · resolution)

1. **Medium — the armed net-diff receipt is tamper-evident, not tamper-proof,
   against an in-process writer that also forges the journal.** The SQLite
   authorizer only covers *schema (app) tables* (`covered_tables` from
   `schema.tables`, `src/storage/write_authority.rs:338-346`), so the journal
   (`_snapback_changes`), version head (`_snapback_version`), meta coverage
   carrier, and coverage tables are *not* authorizer-protected; and the two
   coverage receipts plus the base receipt are unkeyed SHA-256 self-digests
   (`fork_app_row_coverage_digest`, `src/instance_fork.rs:909-937`;
   `file_sha256`, `:3559-3566`). A writer that bypasses the token but *also*
   inserts a matching `_snapback_changes` post-image and bumps
   `_snapback_version` — via out-of-token in-process SQL to those uncovered
   `_snapback_*` tables, or a second connection — would satisfy the oracle
   cross-check and yield an `authorizer-backed-app-rows-v1` receipt. The
   *normative* spelling (0165 §derived-fork record) is honest because it scopes
   itself to writes "made by the process-owned SQLite connection ... admitted
   only under the generated writer token" plus oracle agreement, and the tested
   bypasses (uncoordinated out-of-band update, unjournaled insert, tampered
   base, single-carrier tamper — `src/instance_fork.rs:5781-5869, 5929-5987`)
   all refuse. But this is a trusted-in-process property, not a
   defense-against-forgery property. *Resolves:* acceptable for the narrow
   claim as scoped; before any stronger claim, cover
   `_snapback_changes`/`_snapback_version` with an authorizer rule admitting
   them only inside a token/system writer, and/or authenticate the receipts
   under the fork's minted keyring (HMAC) so forgery requires key custody. File
   as an `issues/` hardening ticket.

2. **Low — authorizer catch-all admits evasive in-process DDL/PRAGMA.** The
   authorizer's default arm is `Authorization::Allow`
   (`src/storage/write_authority.rs:663`), and the schema-change match lists
   only the nine non-temp DDL actions (`:648-656`). On the armed process-owned
   connection, `PRAGMA writable_schema=ON` + direct `sqlite_master` UPDATE
   (`sqlite_master` is not in `covered_tables`), `ATTACH`, or
   `CREATE TEMP TABLE items` / a temp trigger writing an uncovered `_snapback_*`
   table are not denied by name. All require deliberately evasive in-process
   SQL (the same trust domain that could call the C API directly), and an
   unqualified write to a same-named attached/temp table is still denied by the
   covered-name check, so this does not falsify the claim. *Resolves:* when
   armed, deny `Pragma { writable_schema }`, deny DML on `sqlite_master`, and
   extend the DDL match to the `*Temp*` variants; one focused negative per
   shape. Same hardening ticket as #1.

3. **Low — runtime byte growth of a live fork is unmetered; only TTL bounds
   it.** `enforce_creation_limits` is an admission-time estimate from the
   source database set plus the parent asset tree
   (`src/instance_fork.rs:2614-2646`, and it self-documents as an estimate);
   after creation, a fork's own writes and uploads can grow without a
   per-fork runtime byte cap — expiry/reap is the only backstop. Acceptable for
   a finite-TTL dev surface. *Resolves:* note the runtime-growth boundary in
   the guide, or add a periodic per-fork byte check if forks gain longer TTLs.

4. **Low — reap/list leave the advisory cleanup-lock file on the non-drop
   paths.** In `reap_managed_forks`, the `continue` (not-expired) and
   `return Err` branches drop the `ForkCleanupLock` (releasing the flock) but
   do not call `dispose()`, so the `<fork_id>.cleanup-lock` file lingers under
   the registry directory (`src/cli.rs:3068-3086`). It is advisory bookkeeping;
   a later actor re-locks the same inode correctly. *Resolves:* dispose on
   every branch, or sweep stale lock files during list/reap. Cosmetic.

---

## Suggestions

- Consider a third `writerCoverage.coverageWindow` spelling for the
  retention-gap case: today it stays
  `"fork-point-to-observed-head-verified"` while completeness downgrades
  (`src/instance_fork.rs:5768-5777`), which is defensible (the window fact is
  about manifest verification) but reads as stronger than the class.
- Pin JCS for `fork_app_row_coverage_digest` as the promotion domain does, to
  remove a future serde map-ordering hazard.

## Open questions

1. Does any production path open a second *writable* connection to a serving
   fork database beyond the egress-marker writer
   (`DerivedForkRuntime::deny`, `src/instance_fork.rs:1660`, which touches only
   the egress table)? I found none; confirming it would let the claim assert a
   whole-process, not one-connection, scope.
2. Row-13: the dual-platform bench receipts (macOS-aarch64, linux-x86_64) are
   dated, name commit `4444767cc`, and sit well under the author-ratified
   bounds (e.g. cold create median 163ms/80ms vs. 2000ms bound; net diff 50ms/
   73ms vs. 750ms). They were recorded at `4444767cc`, one commit before the
   reviewed `7c2a27e0e` — is a re-run bound to the exact published commit
   required, or is the fork-lifecycle surface unchanged between the two
   (it appears to be: `7c2a27e0e` is a test-only row-13 evidence commit)?

## Recommended next step

Publication of the code is READY, but hold the capability-row flip on the LLP
0185 Phase 6 item-0 governance gate: land the small dated 0164 revision
(record `snapback.fork-net-diff.v2`), let 0163/0164/0165 reach their own
acceptance, and confirm the LLP 0162 author's row-13 rescope is transcribed
(it is, in 0162 v0.40). File one `issues/` hardening ticket for concerns #1/#2
(authorizer coverage of `_snapback_*` write tables + PRAGMA/sqlite_master/
ATTACH/TEMP denial, and/or keyed coverage receipts) so a future stronger claim
than "review aid" has a home. No blocking code change is required for the
narrow claim as scoped.
