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

---

## Round 2 — 2026-08-06, commit 96fd0ad1c

**Family:** fable
**Provider/runtime:** Anthropic / Claude (Fable 5), Claude Code agent session
**Date:** 2026-08-06
**Redacted:** no
**Method:** fresh clean-context session; read-only worktree pinned at
`96fd0ad1c` (`fix(forks): close derived-fork review blockers`). Declared
**delta round**: I read both families' round-1 artifacts under `llp/reviews/`
and remained blind to the other family's round-2 work. I read the whole fix
diff, then attacked the resulting code: `src/storage/write_authority.rs`,
`src/storage.rs`, `src/instance_fork.rs`, `src/cli.rs`, `src/server.rs`,
`src/operation_ledger.rs`, `src/proof_checkpoint.rs`, and
`tests/instance_fork_cli_v1.rs`, plus LLP 0158/0165 and the guide page. Tests
read for non-vacuity, not executed (`vendor/ibex` uninitialized, no
`target/`). Every finding cites file:line at this commit. The two High
findings below were reached by construction from the code, not by running it;
each names the exact statement, the exact deny arm, and the test gap that
hides it.

### Overall verdict

**NOT READY for publication of the narrow local `operating.instance-forks`
claim** — a change from my round-1 "READY, contingent on governance". All four
round-1 blockers are genuinely closed (three of them elegantly), and the
governance gate I flagged is now clearer, not worse. But the fix slice
introduces two regressions in the *armed* fork class — precisely the class the
publication is about — and neither is covered by the new tests, because every
end-to-end renewal and maintenance test in the corpus runs against an
**unarmed** fork. One of them can leave a fork unmanageable by every lifecycle
verb including `recover`. Both are ordinary bugs with small fixes; this is a
"fix two things and re-run" NOT READY, not a design reversal.

### Disposition of the round-1 blockers

**B1 — cross-app lifecycle selection via a shared `--fork-root`: CLOSED.**
The binding is a three-carrier construction and I could not defeat it inside
the CLI. The caller's identity is loaded from its *own* root
(`.snapback/instance-fork-app-identity.v1.json`) and refuses unless the file
names its own canonical path, so copying another root's identity file in does
not help (`src/instance_fork.rs:207-241`). Selection then requires the
registry row's `appRoot` to equal that canonical root **and** the row's
`lineage.appId` to equal the caller's app id
(`validate_registry_app_binding`, `:2521-2548`), and separately requires the
fork-local `fork-app-binding-receipt.json` to agree with the registry
(`:2659-2671`) and with the caller (`managed_target`, `:2721-2750`). All eight
verbs bind: create (`src/cli.rs:3397`), list (`:3732`), inspect (`:3807`),
diff (`:3887`), drop (`:3921`), renew (`:3951`), reap (`:3982`), recover
(`:4013`). Legacy rows without `appRoot` fail closed with
`SNAPBACK_FORK_APP_BINDING_REQUIRED` rather than acting as a wildcard
(`:2525-2530`), and `list` no longer takes its `appId` from an arbitrary first
entry (`src/cli.rs:3772`).

The evidence is non-vacuous at both levels: the module matrix builds two app
roots with the *same* logical app id sharing one fork root and asserts
mismatch on `managed_target`/`renew`/`drop`/`recover_bound` in both directions,
then flips one row to `appRoot: None` and asserts the legacy refusal
(`src/instance_fork.rs:6499-6584`); the executable matrix does the same
against live forks across list, inspect, `inspect --format
admin-token-path`, diff, renew, drop, recover, cross-credential mutation over
HTTP, and per-fork data separation (`tests/instance_fork_cli_v1.rs:547-700`).
That last one matters: the credential-projection leg is what turns this from a
listing-hygiene fix into an authority fix.

*Residual (Low):* the binding receipt's digest is unkeyed SHA-256 computed
from its own fields (`src/instance_fork.rs:1104-1122, 1279-1288`), so it is
tamper-*evident* against accident, not tamper-proof against a same-user
process that rewrites the fork directory. That is exactly the boundary
LLP 0158 §threat-model and the new 0165 paragraph state, and it is the
boundary the round-1 blocker actually named ("an accidental cross-selection
hazard within the cooperating local threat model"), so I call this closed
rather than partially closed.

**B2 — armed-authorizer bypasses: CLOSED, with the class name honestly
narrowed** from `authorizer-backed-app-rows-v1` to
`registered-connection-defensive-app-rows-v1`
(`src/instance_fork.rs:3958-3964`). Details and my attack attempts are in the
companion Scope-1 artifact; the security-relevant summary is: allow-list
authorizer with `_ => Deny` (`src/storage/write_authority.rs:803-809`),
verified `SQLITE_DBCONFIG_DEFENSIVE` on every armed writable connection
(`:349-351, 396-399, 813-821`), journal/version tables promoted to a
token-gated class (`:664-667, 711-721`), covered-table writes restricted to
the four envelope adapters plus rolled-back `DryRun` (`:176-189, 306-311`),
and one factory for second writable connections
(`src/storage.rs:10709-10769`) proven not to inherit a primary token
(`src/storage.rs:27373-27461`).

**B3 — receipt identity: CLOSED.** Both surfaces are v3 with `(base, head]`
stream-qualified boundaries, `attribution: "absent-v1"`, and a
JCS/domain-separated digest with a golden-vector + per-field tamper test
(`src/instance_fork.rs:904-931, 994-1014, 1124-1159, 6738-6846`). The word
"attributed" is gone from the derived surface, including the CLI summary field
(`src/cli.rs:3819`).

**B4 — racy admission and unbounded diff work: CLOSED.** `admit_creation`
takes a root-wide `flock` and the caller holds it from observation through
registry intent and the authoritative rename
(`src/instance_fork.rs:3198-3240`; `src/cli.rs:3408-3441`). The race test is
real: a `Barrier` releases two threads into `admit_creation` +
`publish_managed_bound_with_base` at both the count and total-byte boundary,
and asserts exactly one success, the refusal's `resource`, and one registry
entry (`src/instance_fork.rs:6586-6666`). Net-diff work is metered per row
during streaming with journal/scan/byte/output limits and a WAL-byte seed
(`:3573-3643, 3715, 3747-3752, 3829-3844, 3884-3897`), proven on unchanged,
revert-heavy, and byte-heavy inputs (`:6978-7090`). Raw-WAL header/frame
checksum validation is new and tested (`:4460-4524, 7445+`).

*Residual (Low):* only the `--net` path is byte-bounded. The default journal
receipt still bounds a `COUNT(*)` before materializing and has no byte budget
(`src/instance_fork.rs:3374-3431`), while the guide now claims both surfaces
meter bytes "during streaming".

### New findings in the fix slice

1. **High (publication blocker) — `fork renew` fails on an armed fork and
   leaves it unmanageable.** `apply_renewal` now opens a *registered* writer
   on the live fork database (`src/instance_fork.rs:3024-3027`) and then calls
   `sync_sqlite_set`, whose first statement is `PRAGMA wal_checkpoint(FULL);`
   (`:1351-1357`). On an armed fork that connection reconstructs the durable
   coverage manifest, verifies defensive mode, and installs the new policy
   (`src/storage.rs:10731-10768`) — under which `wal_checkpoint` is not in
   either read-only pragma allow-list and carries a `pragma_value`, so it
   **denies** (`src/storage/write_authority.rs:763-802`). Arming is durable
   and reconstructable by design (`src/operation_ledger.rs:1262-1281` →
   `activate_mutation_coverage_in`; proven for a second connection by the
   fix's own test at `src/storage.rs:27373-27461`), so any fork created
   through the complete-pair carrier path (`src/cli.rs:3446-3450, 3543-3546`)
   is affected.

   The failure is not clean. `renew_managed_with_cut` writes the staging
   sentinel and the renewal intent first (`src/instance_fork.rs:2983-2997`),
   and inside `apply_renewal` the lineage `UPDATE _snapback_meta …`
   autocommits *before* the denied checkpoint (`:3029-3032`). The result is a
   fork whose database lineage carries the new expiry while its mint receipt
   and registry row carry the old one — which `managed_target_evidence`
   rejects with `SNAPBACK_FORK_EVIDENCE_MISMATCH` (`:2649-2658`), so
   `inspect`, `diff`, `drop`, and `renew` all refuse, and `reap` cannot clear
   it. `fork recover` is the documented repair and it re-enters the same
   `apply_renewal` from the durable intent (`:4636-4667`), so it fails
   identically. The quarantine sentinel also remains, so a restart of that
   fork refuses. The operator's only remaining move is manual `rm -rf`.

   *Why the corpus misses it:* the one executable renewal success test builds
   its app root as an empty directory
   (`tests/instance_fork_cli_v1.rs:1976-1986`), so no
   `snapback/generated` pair exists, no startup carrier is written, and the
   fork is never armed (`src/cli.rs:3446-3450`). The armed end-to-end test
   (`tests/instance_fork_cli_v1.rs:213-400`) never renews, and the same-appId
   matrix renews only *across* roots, where the binding check refuses before
   `apply_renewal` is reached (`tests/instance_fork_cli_v1.rs:612-628`).

   *Resolves:* admit the non-mutating maintenance pragmas (`wal_checkpoint`,
   `shrink_memory`) on armed connections, or checkpoint through a path that
   is not statement-prepared, or drop the checkpoint from the lifecycle
   writer and rely on the existing `sync_sqlite_files` fsyncs. Whatever the
   choice, add a renew (and a `recover`-after-interrupted-renew) test against
   a fork created with the todo app root, and consider making the lineage
   update + checkpoint one failure-atomic step so a mid-renewal error cannot
   desynchronize the three carriers.

2. **Medium — journal retention pruning is denied on every armed fork.**
   `LocalDatabase::prune_change_journal` runs
   `DELETE FROM _snapback_changes WHERE …` on the primary connection with no
   writer token (`src/storage.rs:3213-3277`, delete at `:3272-3275`). Under
   the new integrity-table arm that requires `permits_app_write()`, which is
   false with no active writer (`src/storage/write_authority.rs:711-721,
   306-311`), so it denies. The server's maintenance sweep calls it every
   ordinary tick (`src/server.rs:17074-17085`) and the maintenance worker is
   spawned unconditionally at fork boot, unlike cron/jobs/assets which are
   explicitly idled (`src/cli.rs:7953` vs `:7920-7952`). Effect: an armed
   fork records a `MaintenanceOperation::JournalPrune` error on every sweep
   and its change journal grows without bound for the fork's whole lifetime;
   a busy long-lived fork can then hit the diff journal-row bound and lose
   `fork diff` too. Second-order: because the floor can never advance, the
   retention-gap downgrade to `journal-enumerated-v1` becomes unreachable in
   production, so that honest-labeling path is no longer exercised by
   anything but hand-built fixtures.

   The same shape probably reaches protected-record erasure, which deletes an
   application row and rewrites the journal with no token
   (`src/proof_checkpoint.rs:2789-2850`); no lane in
   `LocalWriterLaneV1` is entered for it anywhere in production. I did not
   confirm the route is reachable on a fork, so I record it as an instance to
   check while fixing, not as a separate finding.

   *Resolves:* give the prune (and any other production `_snapback_changes`/
   `_snapback_version` writer) a system lane that `permits_app_write`
   recognizes, or exempt those two tables from the token requirement when the
   statement originates from a named system writer. Add one test that runs a
   maintenance sweep against an armed fork and asserts the journal actually
   shrinks.

3. **Low — the registered-writer factory is fail-open on reconstruction
   failure.** `open_registered_system_writer_v1` sets whatever manifest
   `active_coverage_manifest` returns; if that is `None` on a database that is
   in fact armed, `install()` early-returns without an authorizer and the
   system-lane token still issues, producing an unrestricted writable
   connection (`src/storage.rs:10731-10768`;
   `src/storage/write_authority.rs:338-352`). Reading the *schema* manifest
   fails closed (empty `covered_tables` plus the armed generic deny arm), but
   the manifest branch does not. *Resolves:* refuse when the fork coverage
   carrier is present but no manifest reconstructs. The same asymmetry exists
   in `refresh_writer_authority_manifest` (`src/storage.rs:2455-2462`) and is
   older than this commit.

4. **Low — `arm_manifest` runs `PRAGMA shrink_memory` after publishing the
   manifest** (`src/storage/write_authority.rs:403-419`). On a first arm the
   authorizer is not yet installed so it succeeds; on any connection where the
   authorizer is already installed (re-arm), the pragma denies and activation
   fails through `cache_release?`. Reorder the shrink before `set_manifest`,
   or allow it.

5. **Low — legacy forks become permanently unreapable while still counting
   against admission.** `reap` deliberately skips entries that answer
   `APP_BINDING_REQUIRED`/`APP_BINDING_MISMATCH`
   (`src/cli.rs:3088-3099`), and the guide tells operators to "inspect and
   migrate/recreate it out of band"
   (`guide/operating/instance-forks.md`, diagnostics table). But
   `enforce_creation_limits` measures `directory_tree_bytes(fork_root)` over
   the *whole* root (`src/instance_fork.rs:3178-3190`), so an upgrade with
   live pre-binding forks leaves bytes that no command will reclaim yet that
   count toward `--max-total-bytes`. *Resolves:* document the manual removal
   path explicitly, or give `reap` an opt-in `--unbound` sweep that requires
   the operator to name the ids.

6. **Low — one app root can only ever fork one logical app.**
   `ensure_expected_app` pins `(canonical root, appId)` on first `fork create`
   and refuses any later create whose parent database carries a different app
   id (`src/instance_fork.rs:151-202`). That is the right default, but nothing
   documents how to re-point a worktree; the guide's mismatch row only covers
   fork entries, not the app-root identity file.

7. **Low (perf, note only) — every denied egress attempt now opens a
   connection and runs three reconstruction queries.**
   `DerivedForkRuntime::deny` goes through the registered factory
   (`src/instance_fork.rs:2011-2027` → `src/storage.rs:10731-10768`), which is
   strictly more work per denial than the previous raw open. Correctness is
   unaffected (the marker table is `_snapback_*`, admitted by the system arm);
   a handler looping on `ctx.fetch` just pays more.

### Round-1 concerns, re-checked

- Round-1 #1 (tamper-evident, not tamper-proof) and #2 (authorizer catch-all)
  are both **addressed** — #2 in code, #1 by narrowing the class name and
  adding the explicit boundary paragraph (`llp/0165-…spec.md:405-417`) and the
  guide's closing paragraph. My round-1 open question 1 (a second writable
  connection anywhere) is now answered and enforced by construction for the
  three known sites.
- Round-1 #3 (unmetered runtime byte growth) is **documented** rather than
  fixed, which is the right call for a finite-TTL surface: the guide now says
  admission is an estimate and points at filesystem/container quotas.
- Round-1 #4 (lingering cleanup-lock files on reap's non-drop paths) is
  **deliberately retained** with a new comment explaining why unlinking a lock
  with queued waiters is worse (`src/cli.rs:3073-3076`). I accept that; it is
  a better answer than the one I suggested.

### Recommended next step

Keep `operating.instance-forks` at target `none`. Fix finding N1 and N2, land
the two tests that would have caught them (renew + `recover` against an armed
complete-pair fork; one maintenance sweep against an armed fork asserting the
journal shrinks), and re-run the executable fork suites on both supported
platforms. The three governing Specs are ready in my companion review, so once
those two regressions close and the LLP 0185 Phase 6 item-0 acceptance gate is
satisfied, this surface is publishable: B1–B4 are closed on their merits, and
the honest-labeling discipline in this slice is stronger than what it replaced.
