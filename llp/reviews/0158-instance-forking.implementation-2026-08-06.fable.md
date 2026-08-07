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

---

## Round 3 — 2026-08-06, commit cdc0fe03e

**Family:** fable
**Provider/runtime:** Anthropic / Claude (Fable 5), Claude Code agent session
**Date:** 2026-08-06
**Redacted:** no
**Method:** fresh clean-context session; read-only worktree pinned at
`cdc0fe03e`. Declared **delta round**: I read both families' round-1 and
round-2 artifacts under `llp/reviews/` and remained blind to the other
family's round-3 work (I did not open the codex review worktree). I read the
three new slices as diffs — `5d1f6aab9` (bind managed mints before launch),
`73af11d4e` (close derived-fork round-two findings), `0ee1fadc1` (prevent
concurrent create hangs) — and then attacked the resulting code:
`src/cli.rs`, `src/instance_fork.rs`, `src/storage.rs`,
`src/storage/write_authority.rs`, `src/operation_ledger.rs`,
`src/proof_checkpoint.rs`, `src/server.rs`, and
`tests/instance_fork_cli_v1.rs`, plus LLP 0158/0165 and the guide page. Tests
were read for non-vacuity, not executed (`vendor/ibex` uninitialized, no
`target/`). Every finding cites file:line at this commit. Where I reached a
conclusion by construction rather than execution I say so.

### Overall verdict

**READY for publication of the narrow local `operating.instance-forks` claim
as a source/guide capability-index row — contingent, as in round 1, on the
LLP 0185 Phase 6 item-0 governance gate, which is not the code's to satisfy.**
This reverses my round-2 NOT READY. Both of my round-2 regressions are closed
at the root cause, each with the specific test I said would have caught it;
the codex round-2 blocker is closed within the class 0165 states, and I could
not rebuild it or three variants of it. The three new slices did not introduce
a MATERIAL defect that I could find. Everything below is Low.

**This is a clean delta round.** I want to be plain about that rather than
inflate the residue: I went looking hardest at the two things the brief
flagged — whether the close-on-exec sweep can close something the detached
server needs, and whether the renewal compensation can leave the three expiry
carriers disagreeing — and the answer to both is no, for reasons I set out
below rather than by assertion.

### Disposition of the round-2 findings

**N1 — `fork renew` fails and wedges an armed fork: CLOSED at the root cause.**
`permits_maintenance_pragma` now admits exactly two non-mutating pragmas:
`shrink_memory` unconditionally, and `wal_checkpoint(FULL)` only while the
active writer holds the `BranchRegistry` lane
(`src/storage/write_authority.rs:344-350`, wired into the pragma arm at
`:850-851`). `RegisteredSystemWriterPurposeV1::DerivedForkLifecycle` maps to
exactly that lane (`src/storage.rs:11087-11097`), and the renewal writer is
now a named function that checkpoints *before* opening the lineage transaction
(`write_renewal_database_lineage`, `src/instance_fork.rs:3137-3170`) — so the
half-committed shape from round 2 (lineage `UPDATE` autocommitted, then the
checkpoint denied) is structurally impossible. The scoping is tight: an
ordinary app-write token cannot checkpoint, and the two admitted pragmas
cannot mutate content.

The two tests I asked for both exist and are non-vacuous. The live renewal
acceptance now builds its app root with `copy_todo_app_root` and *asserts* the
fork is armed before renewing — `assert_eq!(created["data"]["writerCoverageReceipt"]["schemaVersion"], "snapback.fork-app-row-coverage.v1", "renewal acceptance must exercise an armed complete-pair fork")`
(`tests/instance_fork_cli_v1.rs:2207-2233`), which is the precise gap that hid
the bug. And `executable_fork_recover_completes_interrupted_renewal_on_an_armed_fork`
(`:2341-2450`) injects a crash cut after the armed database update, asserts the
sentinel, runs `fork recover` through the executable, and then proves the fork
still verifies its coverage receipt *and* still emits
`registered-connection-defensive-app-rows-v1` on `--net`. That last assertion
is the one that matters: it proves recovery did not silently degrade the class.

**N2 — journal retention pruning denied on every armed fork: CLOSED.** A
dedicated `JournalMaintenance` lane was added to `LocalWriterLaneV1`
(`src/storage/write_authority.rs:50, 78, 108, 143, 227`), declared
`retention-only-delete-never-originates-application-dml`, and
`prune_change_journal` enters it before its transaction
(`src/storage.rs:3202-3204`). The authorizer gives that lane exactly one new
authority — `DELETE` on `_snapback_changes`, and nothing else
(`write_authority.rs:755-765`); the lane cannot write app rows or
`_snapback_version`. `armed_derived_fork_maintenance_sweep_prunes_the_change_journal`
(`src/instance_fork.rs:7903-7938`) commits three buffered writes on an armed
fork, prunes, and asserts `deleted > 0`, `after == before - deleted`, and that
the monotonic retention floor advanced — not a smoke test.

*Follow-through on the instance I flagged for checking while fixing:* see R3-5.

**N3 — registered-writer factory fail-open on reconstruction failure: CLOSED,
and inverted.** `registered_writer_coverage_manifest`
(`src/storage.rs:10878-11061`) is now the single reconstruction path for both
`open_registered_system_writer_v1` (`:11084`) and
`refresh_writer_authority_manifest` (`:2424-2429`), and a database that carries
fork coverage evidence but cannot reconstruct a matching manifest/continuity
cut does not get an unarmed writer — it gets a durable, irreversible gap record
and an `Err` (`break_registered_writer_coverage`, `:10821-10876`).

**N4 — `arm_manifest` runs `PRAGMA shrink_memory` after publishing the
manifest: CLOSED** by admitting the pragma unconditionally
(`write_authority.rs:344-346`), which is the right shape: it releases cache
memory and cannot change content.

**N5 (legacy forks unreapable while counting against admission), N6 (one app
root pins one logical app), N7 (every denied egress opens a registered
connection): NOT addressed.** Unchanged and still Low. N7 is now marginally
worse in cost — the factory does the full receipt/stream/manifest/continuity
reconstruction per denial (`src/storage.rs:10878-11061`) — but still
note-only; a handler looping on denied egress pays more, and nothing is
incorrect.

### The close-on-exec change — can it close something the server needs?

**No.** I checked this four ways rather than by inspection of the sweep alone.

1. **Ordering.** `configure_detached_child` registers a `pre_exec` closure
   (`src/cli.rs:3406-3434`). Rust's `do_exec` performs the stdio `dup2` into
   fds 0/1/2 *before* running `pre_exec` closures, so the child's own stdin,
   stdout, and stderr are already installed below the sweep floor of 3 when the
   loop runs. The duplicate originals at fd ≥ 3 are exactly what should be
   marked.
2. **Neither call site passes a descriptor.** `fork create` passes the database,
   ready file, and startup-artifact carrier as argv paths and its two runner
   disables as env, with stdout/stderr redirected into a log `File`
   (`src/cli.rs:3596-3624`); `restart_start_result` uses `Stdio::null()` for all
   three and argv for everything else (`src/cli.rs:6982-6997`). There is no
   `SNAPBACK_*_FD`, no `LISTEN_FDS`, and no socket-activation convention —
   I grepped `from_raw_fd`/`FromRawFd` across `src/` and every hit is a
   same-process `File`/lock reconstruction, never a startup-time inheritance.
3. **No lock is needed by the child.** The root-wide admission lock is
   explicitly `drop(admission)`-ed after publication and well before the launch
   (`src/cli.rs:3511-3513`), so the child never sees it; and even if it did,
   `flock` is per open-file-description, so the child marking it close-on-exec
   cannot release the parent's hold.
4. **The negative test plants a real descriptor.** `detached_fork_server_closes_unrelated_inherited_descriptors_on_exec`
   (`tests/instance_fork_cli_v1.rs:1894-1981`) dups a pipe writer to fd 198 in
   the `fork create` child, runs the real executable, and after the CLI exits
   asserts a non-blocking read on the reader reaches EOF — i.e. no surviving
   process holds the writer. Because fd 198 is above every ordinary
   descriptor, this also proves the ceiling scan reaches high descriptors.

The diagnosis itself checks out: Rust's `anon_pipe` has no `pipe2` on Darwin
and applies `FIOCLEX` after `pipe()`, so a concurrent `Command::output()` can
leak a capture writer into a sibling fork. That is precisely the descriptor
class this sweep catches, and such a descriptor is always present at CLI start
(it crossed the CLI's own exec), so it is always inside the scan.

One residual, R3-4 below, concerns descriptors that appear *after* the scan.

### The renewal compensation path — can it still leave carriers disagreeing?

**Not that I could construct.** I walked every cut point.

- Forward order inside `apply_renewal` is database lineage → mint receipt →
  registry row → renew receipt → intent removal → sentinel removal
  (`src/instance_fork.rs:3053-3110`). The rollback bytes for all three carriers
  are captured *before* the first mutation (`:3005-3051`), from state that
  `managed_target` has just validated, so the compensation never has to
  reconstruct from a torn read.
- On any non-crash-cut failure, `rollback_renewal` (`:3172-3230`) re-creates the
  sentinel *first*, restores database lineage, mint receipt, registry, and
  renew receipt to the previous cut, and only then removes the intent and the
  sentinel. So a rollback that fails partway always leaves sentinel **and**
  intent, which is exactly the state `recover` forward-completes
  (`:4998-5031`) — the three carriers converge on the intent's single lineage.
- A rollback that fails only at the last step (sentinel removal) leaves
  sentinel-without-intent, which `recover` handles by the evidence path:
  `inspect_evidence` succeeds, the registry is reconciled, the sentinel clears
  (`:5036-5048`). I specifically looked for a sentinel-without-intent branch
  that would treat a published destination as reapable staging, and there is
  none — the `remove_dir_all` branch is gated on the `.<name>.staging-<uuid>`
  prefix plus a parseable UUID (`:5063-5088`).
- A failure *before* `apply_renewal` mutates anything (e.g. the mint receipt
  read) returns without compensation, leaving sentinel + intent and all three
  carriers already agreeing at the previous cut. That is quarantined but
  consistent, and `inspect_published_evidence` names the exact repair —
  `SNAPBACK_FORK_PUBLICATION_PARTIAL` … "run `snapback fork recover` for the
  exact destination" (`:1818-1826`).
- The checkpoint cannot fail the renewal on a busy live fork:
  `PRAGMA wal_checkpoint(FULL)` returns a row with a busy flag rather than an
  error, `execute_batch` discards it, and the connection carries a 5s busy
  timeout anyway (`src/storage.rs:11079`). I looked for this because the live
  renewal acceptance runs against a serving fork.

The one shape that still ends in "incomplete-recover-required" is a rollback
whose own `write_renewal_database_lineage` cannot open a registered writer —
but that only happens when coverage continuity is genuinely broken, where the
product answer is "recreate the fork", and the fork remains removable because
`recover`/`drop` do not need that writer to clear a sentinel.

### The mint-binding slice

`ExpectedForkAppV1`'s fields are now private with accessors
(`src/instance_fork.rs:96-108`), so no caller outside the module can synthesise
an identity from free-form strings; the only constructors are
`ensure_expected_app` (`:169`) and `load_expected_app` (`:222`), and the latter
still refuses a receipt that does not name its own canonical path. The two
unbound `publish_managed*` entry points are gone; the single remaining managed
publish and `managed_target` both re-validate the presented identity against
the on-disk app-root receipt before acting
(`validate_expected_app`, `:261-272`, called at `:2265` and `:2699`). The
regression it repairs is real and now has a fixture:
`library_minted_never_launched_fork_diffs_only_for_its_owning_app_root`
(`tests/instance_fork_cli_v1.rs:768-860`) asserts the binding exists *before*
any launch, asserts the fixture never publishes readiness, and then proves the
diff is refused from a foreign app root. Legacy rows without a binding still
fail closed with `SNAPBACK_FORK_APP_BINDING_REQUIRED` rather than acting as a
wildcard — unchanged from round 2, and the LLP diagnostic table now states the
never-launched case is explicitly not in that class
(`llp/0158-…rfc.md:1465`). I found no forgery path that does not require
writing the app-root identity file, which is the acknowledged local boundary.

### New findings in the round-3 slices (all Low)

1. **R3-3 (Low) — the bounded admission blocks a tokio worker and has no
   fairness.** `admit_creation_with_timeout` polls `LOCK_EX|LOCK_NB` with
   `std::thread::park_timeout` (`src/instance_fork.rs:3374-3401`), and
   `fork create` calls it directly from the async fn (`src/cli.rs:3480-3485`)
   while its immediate neighbour wraps publication in `startup_blocking`
   (`:3501`). Three consequences: a worker thread can block for the full 30s;
   `park_timeout` returns immediately if anything holds an unpark token for
   that thread, degrading the 10ms poll to a spin (correct, just hot); and the
   poll loop has no queue, so under sustained contention acquisition order is
   arbitrary and a given creator can lose repeatedly until its deadline. The
   30s budget is also a constant that does not scale with concurrency — N
   creators each holding the lock through staging and publication of a large
   source database will start refusing at roughly N × staging > 30s, and the
   corpus only races tiny databases (`src/instance_fork.rs:7112-7160` uses a
   zero deadline; `tests/instance_fork_cli_v1.rs:1987` races three small ones).
   This is strictly better than round 2's unbounded blocking flock and it
   refuses with a typed, correctly gateway-timeout-mapped code
   (`src/server.rs:26401, 41756`). *Resolves:* run admission under
   `startup_blocking`, and consider making the deadline scale with observed
   source bytes or naming it as a flag.
   *Release on every path is correct:* the timeout branch never acquired the
   lock, and on any later `?` the `File` drops and closes, releasing the flock
   — the test asserts a clean second acquisition after the holder drops
   (`src/instance_fork.rs:7143-7155`).
2. **R3-4 (Low) — the descriptor ceiling is computed before the fork, not
   inside it.** `detached_child_descriptor_ceiling()` runs in the parent at
   `Command`-configuration time (`src/cli.rs:3384-3404, 3409`), so a descriptor
   another thread of the *CLI* allocates above the observed maximum between the
   scan and the fork escapes the sweep; likewise a descriptor numbered above
   65 536 when neither `/proc/self/fd` nor `/dev/fd` can be read. Neither
   affects the shape the fix targets — a caller-inherited descriptor is present
   from the CLI's own exec and is therefore always in the scan — and doing the
   `readdir` inside `pre_exec` would be worse (it allocates, which is unsafe
   after `fork` in a threaded process), so I regard the tradeoff as correct.
   Worth one comment saying why the scan is in the parent, so a future reader
   does not "fix" it into the closure.
3. **R3-5 (Low, carry-over confirmed) — protected-record erasure still has no
   writer lane, but is dormant.** In round 2 I flagged
   `proof_checkpoint::erase_protected_record` as probably the same shape as N2
   and said I had not confirmed reachability. I confirmed it now: the path runs
   on the primary connection with no `writer_authority.enter(...)` anywhere
   (`src/storage.rs:3390-3397`; `src/proof_checkpoint.rs:2750-2756`, canonical
   row delete at `:2793-2799`), so on an armed fork the covered-table `DELETE`
   would be denied by the authorizer with a raw SQLite error rather than a
   typed diagnostic. It is *not* currently reachable: `LocalRuntime::erase_protected_record`
   (`src/local.rs:4102-4107`) has no production caller — every other call site
   in the tree is a test. So this is a latent lane gap that will bite the day
   the route is wired, not a live defect. *Resolves:* give it a lane in the
   same sweep that added `JournalMaintenance`, or add a test that the route
   refuses with a typed code on an armed fork.
4. **R3-6 (Low) — a pre-continuity-carrier fork database cannot be renewed.**
   `open_registered_system_writer_v1` opens a bare connection and never runs
   `create_infra` (`src/storage.rs:11073-11079`), and
   `operation_coverage_continuity` uses `.optional()?`
   (`src/operation_ledger.rs:420-441`), which converts only
   `QueryReturnedNoRows` — a missing
   `_snapback_operation_coverage_continuity_v1` table propagates as a raw
   SQLite error. A fork minted by a binary older than `73af11d4e` has a
   data-version stream and a coverage table but no continuity table, so a cold
   `fork renew` (which reaches the factory through
   `write_renewal_database_lineage` without ever opening a `LocalDatabase`)
   fails, its rollback fails identically, and the fork is left sentinel-quarantined
   — the round-2 N1 wedge shape, re-armed for the upgrade window only. It is
   self-limiting (forks expire, and this surface is unreleased at target
   `none`), and the fix is one line: treat a missing continuity table as
   `None` (or run the additive infra migration in the factory).
   *I reached this by construction, not by running an old binary.*

### Round-1 concerns, re-checked

- Round-1 #1 (tamper-evident, not tamper-proof) is now *narrower* rather than
  merely renamed: the continuity carrier removes the in-class re-earn route,
  and 0165's boundary paragraph still names raw-file forgery as outside the
  class (`llp/0165-…spec.md:442-447`). My Scope-1 R3-1 is the only precision
  nit left on that text.
- Round-1 #2 (authorizer catch-all), #3 (unmetered runtime growth), #4
  (lingering cleanup-lock files) are unchanged from round 2 — implemented,
  documented, and deliberately retained respectively.

### Suggestions (non-blocking)

- `lock_cleanup` still takes a blocking `LOCK_EX` with no deadline
  (`src/instance_fork.rs:2747`), so `drop`/`reap`/`renew` can still sleep
  without bound behind a wedged peer even though create no longer can. The
  fix's own `@ref` comment reasons about "every later lifecycle request"
  (`:3376-3378`), so the asymmetry looks unintentional; giving the cleanup lock
  the same monotonic deadline (with its own code) would finish the thought.
- The registered-writer factory is still a convention rather than a type
  boundary — `Connection::open` remains callable — and this round's guarantees
  lean harder on it than round 2's did. A test that greps for writable opens
  outside the factory would make 0165's "every additional process-owned
  writable connection joins the same authority seam" executable.

### Recommended next step

Flip `operating.instance-forks` to target `local` once the LLP 0185 Phase 6
item-0 gate is satisfied — i.e. once 0163/0164/0165 complete their own
acceptance (my companion Scope-1 review marks all three READY at this commit)
and the LLP 0162 row-13 rescope stands with receipts rebound to a post-fix
commit, which `cdc0fe03e` does. Before or alongside the flip, run the
executable fork suites on both supported platforms at the exact published
commit — my verdict rests on reading, and the three slices touch process
spawning, SQLite authority, and crash recovery, which are the three areas
where reading is least sufficient. File one `issues/` ticket carrying R3-3
through R3-6 plus the two suggestions; none of them blocks the narrow claim as
scoped.

## Round 4 — 2026-08-06, re-qualification delta 0ee1fadc1..0b8b0ff71

**Family:** fable
**Provider/runtime:** Anthropic / Claude (Fable 5), Claude Code agent session
**Date:** 2026-08-06
**Redacted:** no
**Method:** fresh clean-context session; read-only worktree pinned at
`0b8b0ff71`, blind to the codex family's round-4 work (I did not open their
worktree). Declared **bounded delta round**: I read rounds 1-3 of both
families under `llp/reviews/`, then read only the in-scope diff
`0ee1fadc1..0b8b0ff71 -- Cargo.toml Cargo.lock build.rs .gitmodules src
packages/snapback-codegen packages/snapback-contract tests
scripts/check-agent-safe-publication.mjs scripts/generated-artifact-policy.mjs`
and the files it lands in. I did not re-review the fork implementation from
scratch. I imported `implementationDigestAt` from the checker itself and ran
it read-only (git-only, no build) at both commits to check the digest
arithmetic; nothing was built or committed (`vendor/ibex` uninitialized, no
`target/`). Every cite is file:line at `0b8b0ff71`.

### Do the rounds 1-3 verdicts carry forward?

**On the fork implementation: yes, unchanged.** The delta does not touch a
single line of derived-fork behavior. `src/fork_promotion.rs`,
`src/branches.rs`, `src/storage/write_authority.rs`, `src/operation_ledger.rs`
and `src/cli.rs` — the files the write authority, the registered-connection
completeness class, the continuity carrier and the diff receipts actually live
in — are **not in the delta at all** (`git diff --name-only
0ee1fadc1..0b8b0ff71 -- src` lists 13 paths; none of those five is among them).

I read `src/storage.rs` line by line as instructed. Its entire delta is
clippy-shaped and provably behavior-preserving:

- `captured_effect_intents` gains `#[cfg(test)]` (`src/storage.rs:2164`). Its
  only caller is `src/local.rs:58720`, inside `mod tests` which opens at
  `src/local.rs:30958`. The production readers of captured intents go through
  `crate::fork_promotion::captured_effect_intents` directly
  (`src/fork_promotion.rs:2147,3651,4963`), which is untouched. No production
  path loses a reader.
- Two `LocalDatabase` pass-throughs are deleted —
  `foreclose_branch_operation_admission` and
  `retain_committed_branch_mutation`. Both were dead wrappers: at
  `0b8b0ff71` the only remaining references are the free functions
  `src/fork_promotion.rs:2378,2463` and their callers. Admission foreclosure
  and committed-mutation retention are unchanged.
- Two `if a { if let Some(x) = f()? {} }` bodies collapse to `if a && let
  Some(x) = f()?` (`src/storage.rs:5443-5450`, `:6782-6789`). Let-chains
  short-circuit identically, so `strict_current_data_version_stream` is still
  only evaluated when `enforce_canonical_promotion_reservation` holds, and the
  `?` propagates the same. `enforce_canonical_mutation_admission_in` is called
  under exactly the same conditions.
- Two `#[allow(clippy::too_many_arguments, reason = …)]` attributes on
  `commit_buffered_writes_for_lane` and
  `apply_buffered_writes_with_lifecycle_gated`. Attributes only.

Nothing in that list touches the completeness class's foundations. The rest
of the Rust delta is the same shape: `.truncate(false)` made explicit on the
fork admission lock (`src/instance_fork.rs:3365` — a no-op, `truncate` already
defaults to `false`, and the accompanying comment is accurate: no caller
writes through that handle), a `&`-borrow fix in an
`instance_fork.rs` test, `#[cfg(test)]` on the *convenience* wrapper
`create_operator_in_app_branch` (`src/local.rs:6616`) whose production
counterpart `create_operator_in_app_branch_with_policy` remains live and is
still what `src/host_ops.rs:1557` calls, `reason =` strings on three existing
`too_many_arguments` allows, and refreshed contributor-chain hashes in
`src/manifest.rs` (I recomputed both: `src/storage.rs` is
`975d8201…` and `src/local.rs` is `a9878184…`, matching
`src/manifest.rs:10639,10645,10707,10846,10851` exactly).

The one substantive `src/server.rs` change is a *strengthening*:
`SNAPBACK_FORK_WRITER_COVERAGE_GAP` is added to the server-invariant 500 class
(`src/server.rs:42058`). The code itself already existed at
`src/instance_fork.rs:43` and I discussed it in round 3; this only closes the
"missing from the reviewed HTTP table" ticket. Five
`SNAPBACK_PACKAGED_STORE_QUALIFICATION_*` entries are added to the
never-emitted-by-HTTP diagnostic registry — packaging, not forks.

So: **isolation, credential scrubbing, egress quarantine, asset custody,
TTL/renewal, resource admission, the registered-connection completeness class
and the diff receipts are all byte-identical to the tree I marked READY in
round 3.** My round-3 implementation verdict carries forward on the code.

**On the publication act: no.** The narrowing itself, plus what landed
alongside it inside the digest's own scope, has a blocking defect.

### R4-1 (BLOCKING, Scope 2) — the delta re-creates the source-digest cycle the design explicitly breaks, making an honest re-qualification unsatisfiable

`build.rs:295-300` and `src/agent_safe_publication.rs:283-286` both state the
governing invariant in as many words: *"the receipt is outside the qualified
implementation tree, breaking the source-digest cycle while its hash is still
bound by the carrier."* The anchor, carrier and receipt are excluded from
`implementationDigestAt` (via `PUBLICATION_CYCLE_ALLOWLIST`,
`scripts/check-agent-safe-publication.mjs:51-82`, applied at `:524` and
`:590`) precisely so that a qualification cycle can rewrite them without
changing the digest it is recording.

This delta puts three cycle-dependent values *back inside* the digest, as
literals in `src/agent_safe_publication.rs` — a file that is in `src/` and
therefore in the digest:

- `:488-490` — `derived_receipt.qualified_source_commit ==
  "0ee1fadc136e837f430556374a5842ac82069004"`
- `:491-494` — `derived_receipt.implementation_tree_sha256 ==
  "sha256:2cad36279fbb319c4b828026c1fc0c2ed2d8ac38bffc14bd2ba39b3849eedf33"`
- `:517-520` — `derived_receipt.evidence.last().unwrap().sha256 ==
  "sha256:e349b0698a5b42fff14d05a23ab4571b3adabed897b6827915389562ec8fd228"`
  (the `authorAcceptance` binding — I confirmed that is the last locator,
  `src/agent_safe_publication.rs:62` + the receipt's own evidence list, and
  that the digest is today's
  `tests/acceptance/fixtures/instance-forks/author-acceptance.2026-08-06.v1.json`)

Before the delta these were structural: zeroed commit, empty component list,
`sha256:0…0` bindings. The per-binding loop still uses the structural form
(`is_nonzero_sha256`, `:515`); only these three were converted to exact
values.

I ran the checker's own digest function at both commits:

    implementationDigestAt(0ee1fadc1) = sha256:2cad3627…9eedf33
    implementationDigestAt(0b8b0ff71) = sha256:332db79e5974b23bbe74d9180335624f5e0941b563858e81f584515ee5c9480e

So the receipt at HEAD names `2cad3627…`, the tree at HEAD digests to
`332db79e…`, and the new assertion at
`scripts/check-agent-safe-publication.mjs:1491-1496` correctly refuses. That
is the re-qualification this round exists to authorize. But re-qualification
at `0b8b0ff71` (C = P) requires:

1. the receipt to carry `implementationTreeSha256 = 332db79e…` (it is
   allowlisted, so writing it does not move the digest — good), **and**
2. `src/agent_safe_publication.rs:492` to carry the same literal, so the unit
   test `embedded_anchors_are_valid_and_storage_may_publish_independently`
   passes.

(2) changes a file inside the digest, so the digest is no longer `332db79e…`,
so (1) must be rewritten, so (2) must be rewritten. Satisfying it means
finding `L` such that `L = sha256(tree containing L)`. The same argument
applies to `qualified_source_commit` (the tree at C would have to contain C's
own commit hash) and to the `authorAcceptance` digest (the author acceptance
records the qualified commit and tree, so re-signing it changes its sha256,
which is pinned inside the digest). **There is no C at which an honest
derived-fork receipt satisfies this tree.**

There is exactly one satisfying assignment, and it is the dishonest one:
author the receipt so that `implementationTreeSha256` names the *publication*
tree rather than the *qualified* tree, with C strictly before P. The checker
would accept it — see R4-2 — and the receipt would then assert that a tree
nobody benchmarked, reviewed or accepted is the qualified implementation.
A gate whose only satisfying solution is a false receipt is worse than no
gate.

The fix is small and does not weaken anything: revert those three assertions
to the structural form the rest of the test already uses (`is_source_commit`,
`is_sha256`/`is_nonzero_sha256`, non-empty components), or move the
exact-value pinning into a `PUBLICATION_CYCLE_ALLOWLIST` fixture. The exact
values belong in the checker, which reads the allowlisted files at P and is
outside the digest — it already does this correctly at
`scripts/check-agent-safe-publication.mjs:1456-1474`.

### R4-2 (MATERIAL, Scope 2) — the narrowing dropped the C-side digest assertion, so the surviving assertion can be self-satisfying

The old rule asserted a three-way equality (pre-delta `runChecker`):
`carrier.implementationTreeSha256 == implementationDigestAt(C) ==
implementationDigestWorkingTree()`. The new rule asserts
`implementationDigestAt(P) == receipt.implementationTreeSha256`
(`scripts/check-agent-safe-publication.mjs:1491-1496`) and then
`digestAt(P) == workingTree` (`:1497-1501`). The `== digestAt(C)` conjunct is
gone, and nothing else restores it: `implementationDigestAt(root, C)` is still
computed at `:1402`/`:1415`, but it is only compared to the *author
acceptance* fixture (`:1358`), never to the receipt or carrier.

The residual guarantee therefore holds **only if the receipt is honest about
C**. If it is, `digestAt(P) == receipt.tree == digestAt(C)` and no in-scope
byte can drift — which is what the narrowing advertises, and what its three
new fixture tests demonstrate (`tests/agent_safe_publication_checker_v1.mjs`
`:824`, `:844`, `:867` — unrelated `demos/`+`llp/` churn permitted, in-scope
byte change refused with the path named, `vendor/ibex` gitlink change
refused). If the receipt instead names P's tree, the assertion compares a
value to itself and *every* in-scope path may drift silently between C and P
while the benches, both review artifacts and the author acceptance still
describe C.

I want to be precise about what is and is not verified here. The rest of the
chain is intact and I checked it: anchor → carrier by sha256 (`:1448`),
carrier → receipt by sha256 and field-by-field (`:1456-1462`), every evidence
binding re-hashed from P's bytes (`:1469-1474`), so the reviews, benches and
author acceptance cannot drift between C and P. `vendor/ibex` is genuinely in
scope — the gitlink is folded into the digest at `:535-536`, and
`checkedOutImplementationGitlink` (which also refuses a dirty root or a dirty
submodule) is still reached through `implementationDigestWorkingTree`
`:584-585`, so dropping its standalone call from `runChecker` lost nothing.
The publication allowlist genuinely cannot smuggle implementation files
through any more: `allowedPublicationChange` is no longer consulted for
in-scope paths at all, and the only `src/`- or `tests/`-rooted paths excluded
from the digest are the `PUBLICATION_CYCLE_ALLOWLIST` carriers/receipts/
fixtures, each of which is separately pinned — the store carriers by the
`SHA256` constants embedded in `src/manifest.rs:10231,10237` (in the digest),
and the fork receipt by `carrier.qualificationReceiptSha256`.

So R4-2 is one missing conjunct, not a structural failure. Add
`|| receipt.implementationTreeSha256 !== implementationDigestAt(root, result.commit)`
to `runChecker` (or fold it into `assertQualifiedImplementationDigestAtPublication`
as an assertion on `qualificationCommit`) and the narrowing becomes exactly
what it claims to be. Without it, R4-1's only escape hatch stays open.

### R4-3 (MINOR, Scope 2) — the review-verdict oracle moved from exact-field equality to substring matching, and would accept "NOT READY"

`reviewFamily` and the two new verdict readers now slice to the last
`## Round N` heading (`:1264-1268`) — correct, and it means this round-4
section is what the oracle will read. But the verdict test itself was
loosened from `markdownField(text, 'Verdict') === 'READY'` to:

- `finalSpecReviewVerdictsAreReady` (`:1308-1316`): a table row matching
  `^\| LLP 0163 \|[^\n]*\bREADY\b[^\n]*\|$`. My own round-3 row is
  `| LLP 0165 | READY (fable) / NOT READY (codex) | **READY** — …`
  (`llp/reviews/0163-0165-derived-fork-implementation-2026-08-06.fable.md:535`)
  — a row containing the literal text `NOT READY` that this regex accepts.
  That is not hypothetical; it is the artifact the oracle is being fitted to.
- `finalReviewVerdictIsReady` (`:1298-1306`): `String.includes` on two prose
  phrases beginning ``**READY for publication of the narrow local
  `operating.instance-forks``.

Both fallback branches exist to accept the real artifacts' prose, and neither
is exercised by the fixture tests — `publishedDerivedFixture` now emits
`**Verdict:** READY` for *every* review (`tests/agent_safe_publication_checker_v1.mjs:396`),
so only the exact-equality branch is covered. The branches that will actually
run against the real reviews are untested and substring-shaped. Anchoring the
row match on the verdict cell (e.g. `\| \*\*?READY\*\*? [^|]*\|$`) and adding
a negative fixture that emits `NOT READY` in the same shapes would make the
oracle mean what it says.

### Everything else in the delta is inert to this surface

`tests/instance_fork_bench_v1.rs` is rustfmt-only (no bound, no measurement,
no assertion changed — I diffed the `checks` array element by element).
`tests/drift_prone_gates_v0.mjs`, `tests/local_proof_selection_v0.mjs`,
`packages/snapback-codegen/app-descriptor.test.mjs` and the browser-IR
coverage files are unrelated proof-lane infrastructure. The populated
`src/local-agent-safe-derived-deployment-fork-publication.carrier.json`
candidate facts are correct and correctly narrow — `derivedDeployment` is
`denyAll` / `notPromotable` / `currentHead` / `hostMediated`, every other axis
including `inApp` is `Missing` — and the anchor is still `withheld`, so no
authority is minted at this commit. The store/relation/sequence carrier
refreshes are allowlisted and their `src/manifest.rs` pins match the files on
disk.

### Verdict for the re-qualified tree

**Scope 2 (implementation/security, narrow local `operating.instance-forks`):
NOT READY at `0b8b0ff71`.**

To be unambiguous about what that does and does not say: the *fork
implementation* keeps my round-3 READY without qualification — the delta is
provably inert to it, and I would re-issue that verdict against these bytes
today. What is not ready is the *publication act at this commit*. R4-1 makes
an honest re-qualification at `0b8b0ff71` unsatisfiable, and R4-2 leaves open
the one dishonest assignment that would satisfy it. Both are small, local
fixes in `src/agent_safe_publication.rs` and `runChecker`; neither requires
re-opening the fork surface, and neither costs a review round beyond
confirming the two edits. With R4-1 and R4-2 fixed, and the receipt/carrier/
benches/author-acceptance re-stamped at the new C, I would expect to sign the
re-qualified tree READY on a re-read of those two files alone.

### Recommended next step

Fix R4-1 (structural assertions, or move the exact literals into an
allowlisted fixture) and R4-2 (restore the C-side conjunct) in one commit,
then re-qualify at that commit. R4-3 can ride the same commit or a ticket.
The round-1/2/3 fork findings and suggestions are unchanged and none of them
blocks.

## Round 5 — 2026-08-06, oracle-defect closure at b08e835f1

**Family:** fable
**Provider/runtime:** Anthropic / Claude (Fable 5), Claude Code agent session
**Date:** 2026-08-06
**Redacted:** no
**Method:** fresh clean-context session; read-only worktree pinned at
`b08e835f1`. Declared **delta round**, bounded to the publication oracle: I did
not re-review the fork implementation surface, which round 4 found inert. I read
the committed rounds 1–3 of both families under `llp/reviews/` and remained
blind to the codex family's round-5 work (I did not open its worktree). Round 4
is not committed anywhere in this worktree, so for the round-4 defect statement
I worked from my brief plus the v0.42 `Revised` entry in
`llp/0162-agent-safe-storage-profile.rfc.md`. I read all four files of
`b08e835f1` in full, then executed against it: `node --test
tests/agent_safe_publication_checker_v1.mjs` (36 pass, 0 fail, 22.1 s);
`implementationDigestAt` at five commits through the module's own export; and a
23-case adversarial harness built by lifting
`scripts/check-agent-safe-publication.mjs:1271-1400` verbatim into a scratch
module. Cargo was not run — `vendor/ibex` is uninitialized here (gitlink
`4c34c831a` absent), which is also why `implementationDigestWorkingTree` refuses
in this worktree. This same section is appended to both of my dated fork
artifacts; the findings are identical.

### Summary

Two of the three round-4 oracle defects are genuinely closed, and I could not
reopen either. The verdict parser is not closed: I reproduced the round-4 attack
— quoting the needle inside a blocking review — against the new parser, and
found two further ways to make a blocking round parse as approving. Separately I
found that the derived-fork review chain binds no commit and no implementation
digest, and that the shipped evidence already exhibits that mismatch. Scope 2
stays blocked. Scope 1 is unchanged and clear.

### Defect 1 (receipt rotation) — CLOSED

`assertQualifiedImplementationDigestAtPublication` now recomputes the digest
from committed bytes at both ends and requires `digest(C) ==
receipt.implementationTreeSha256 == digest(P)`
(`scripts/check-agent-safe-publication.mjs:544-570`), and the gate moved out of
`runChecker` into `validatePublicationRecord:1568-1573`, so every caller —
including the tests that drive the record path directly — now gets it. Three
attempts to reopen it:

- **Rotate the receipt to P.** Refused. Their new test covers exactly this and I
  re-ran it (`C-to-P custody refuses a receipt rotated to P that does not match
  C`), along with the converse.
- **Widen `PUBLICATION_CYCLE_ALLOWLIST` at P so the drifted path stops
  counting.** Cannot work, and pleasingly so: the allowlist lives in
  `scripts/check-agent-safe-publication.mjs`, which is itself inside
  `IMPLEMENTATION_ROOTS` and is not allowlisted, so any edit to it moves
  `digest(P)` away from `digest(C)` and the three-way equality fails first. The
  allowlist is self-protecting. That is currently an accident of the roots list
  rather than a stated invariant, and it is worth writing down in LLP 0162 so a
  later refactor does not silently give it away.
- **Introduce a new in-scope file only at P.** Moves `digest(P)`; refused.

Byte custody is sound. What the three-way equality does *not* do is pin *which*
ancestor is allowed to be C — any digest-equal ancestor satisfies it — and that
is where R5-5 bites.

### Defect 3 (self-referential digest cycle) — CLOSED, and a receipt can now honestly name its own C

Verified concretely rather than from the changelog:

- `git grep` for the qualification commit and for the four digest literals,
  restricted to the exact `IMPLEMENTATION_ROOTS` path list, returns hits only in
  `src/local-agent-safe-derived-deployment-fork-publication.carrier.json`,
  `tests/acceptance/receipts/agent-safe-derived-deployment-fork-publication.2026-08-04.v1.json`,
  `tests/acceptance/fixtures/instance-forks/author-acceptance.2026-08-06.v1.json`,
  and the two dated lifecycle benches — every one of which is in
  `PUBLICATION_CYCLE_ALLOWLIST`. No cycle-dependent literal survives in a
  digested path. The Rust mirror's remaining assertions
  (`src/agent_safe_publication.rs:486-530`) are shape-only: schema version,
  capability, source-commit shape, non-zero digests, exact target and negative
  profiles, component list, ordered evidence kinds and paths.
- `implementationDigestAt(root, 0ee1fadc136e837f430556374a5842ac82069004)`
  returns `sha256:2cad36279fbb319c4b828026c1fc0c2ed2d8ac38bffc14bd2ba39b3849eedf33`
  — exactly the receipt's `implementationTreeSha256`. The receipt exists in the
  tree at C and does not participate in its own digest, so the arithmetic is now
  satisfiable in the obvious honest order: mint C, compute `digest(C)`, then
  write the receipt, carrier, anchor, author acceptance and bench records — all
  allowlisted — at any descendant P. Their new test (`receipt, carrier, and
  anchor publication updates do not move the implementation digest`) is the right
  test and it passes.
- One consequence worth stating in LLP 0162: the two family reviews are also
  outside the digest (nothing under `llp/` is in `IMPLEMENTATION_ROOTS`), so
  appending a review round does not move the digest — but it *does* break the
  receipt's `evidence[].sha256` binding for that path. A re-qualification must
  therefore mint the receipt *after* the reviews land, in that order. Appending
  this very section invalidates the current receipt's `specReviewFable` and
  `implementationReviewFable` digests; that is correct behaviour, not a defect.

So the answer to the round-4 question is yes: a receipt can now honestly name the
commit that qualified it.

### Defect 2 (verdict parser) — NOT CLOSED

I lifted `scripts/check-agent-safe-publication.mjs:1271-1400` verbatim into a
scratch module and ran 23 cases. The narrowing is real: a `NOT READY` in the
authoritative cell or statement is refused; a stale `Round 3` column is refused
because verdict-column resolution fails; a needle quoted *after* the verdict
statement is refused — which is the case their new test covers. But the class is
not closed. Fence contents below are indented by two spaces so that this artifact
does not trip the parser it is describing; the real exploits have them at column
zero.

**R5-1 (High) — the round-4 attack still works when the quotation comes first.**
`finalReviewVerdictIsReady` takes the verdict section's first bold run and tests
only an *anchored prefix* of it. The remainder of that bold run, and everything
after it, is unconstrained. Both of these parse as approving:

```
  ### Scope 2 verdict

  **READY for publication of the narrow local `operating.instance-forks`
  surface was the round-3 verdict; I withdraw it and return NOT READY.**
```

```
  ### Scope 2 verdict

  **READY for publication of the narrow local `operating.instance-forks`
  surface** is what round 3 said. I now block it: NOT READY.
```

Opening a delta round by quoting the previous round's verdict and then
withdrawing it is an ordinary review idiom — it is close to how my own round-3
section opens. This is the round-4 defect relocated, not removed. Closure is
cheap: require the authoritative bold run to *end* at the statement (anchor the
tail, not just the head), and refuse the section outright if the token
`NOT READY` appears anywhere inside it.

**R5-2 (High) — in Scope 1 the *first* `Document` table wins, so a quoted
historical table overrides the current one.** `finalSpecReviewVerdictsAreReady`
scans the section for the first table whose header cell 0 is `Document` and
`return`s on it; it never checks that the table is unique or current. A round-5
section that reproduces a prior round's table above its own is read from the
reproduction:

```
  ### Scope 1 re-verdict

  For reference, my round-3 table said:

  | Document | Fork-relevant verdict | Round-3 assessment |
  | --- | --- | --- |
  | LLP 0163 | **READY** | … |
  | LLP 0164 | **READY** | … |
  | LLP 0165 | **READY** | … |

  At round 5 I now find:

  | Document | Round 5 | Notes |
  | --- | --- | --- |
  | LLP 0163 | **NOT READY** | blocked |
  | LLP 0164 | **NOT READY** | blocked |
  | LLP 0165 | **NOT READY** | blocked |
```

That parses as approving. It is not a contrived shape: the codex family's
committed round-3 section uses precisely the header `| Document |
Fork-relevant verdict | Round-3 assessment |`
(`llp/reviews/0163-0165-derived-fork-implementation-2026-08-06.codex.md:196`),
so quoting it verbatim is the natural thing for a later delta round to do. Note
the asymmetry that makes this specifically dangerous: a stale `Round N` header
column *is* refused, because column resolution against the current round number
fails; but the `Fork-relevant verdict` header carries no round binding at all, so
a historical table in that shape is indistinguishable from a current one.
Closure: require exactly one `Document` table in the section, or require every
`Document` table in it to agree.

**R5-3 (High) — any line shaped like a round heading, later in the round,
re-anchors the authoritative window.** `finalReviewRound` slices from the *last*
line matching `^## Round [0-9]+`, wherever it occurs and whatever follows it, and
markdown fences are not excluded. A subsection titled `## Round 3 comparison`
inside round 5 therefore discards everything above it — including the actual
current verdict — and makes whatever is quoted below it authoritative. I
confirmed both halves: with a blocking current verdict above such a heading and a
quoted round-3 verdict below it, both `finalReviewVerdictIsReady` and
`finalSpecReviewVerdictsAreReady` return true, and `finalReviewRoundNumber`
returns 3 rather than 5, so the `Round N` column fallback also resolves to the
wrong round. This falsifies LLP 0162 v0.42's "Only the last `## Round N` section
is current": it is the last matching *line*, which is not the same thing.
Closure: validate the round-heading sequence (strictly increasing, each followed
by a provenance block) instead of taking the last match, and ignore fenced
regions.

**R5-4 (Medium) — duplicate document rows resolve last-wins.** `verdicts.set`
overwrites, so a table carrying `| LLP 0163 | **NOT READY** |` and later
`| LLP 0163 | **READY** |` reads as approving. A repeated summary row at the foot
of a table is enough to do it. Closure: refuse duplicate document rows.

**R5-6 (Low) — several honest verdict shapes fail closed, silently.** A Scope 2
verdict written as a list item, as a blockquote, as `***READY …***`, or preceded
by any non-whitespace character; a Scope 1 table with bolded document cells
(`| **LLP 0163** | … |`); and a cell reading `**READY**, with caveats` are all
read as not-READY. The direction is safe, but the reviewer gets no diagnostic and
the required shape is documented only as prose in an RFC they may never open.
Whoever fixes R5-1 through R5-4 should make the parser say *why* it refused, and
the shape contract should live where reviewers will actually meet it.

### New findings outside the three round-4 defects

**R5-5 (High; pre-existing, not introduced by `b08e835f1`, and not raised in
rounds 1–3) — the derived-fork review chain binds no commit and no
implementation digest, and the shipped evidence already shows the mismatch.**
The storage chain's `validateReview` requires `Reviewed commit === C` and
`Implementation tree SHA-256 === digest(C)`
(`scripts/check-agent-safe-publication.mjs:1109-1120`). The fork chain's
`validateDerivedForkReview` (`:1402-1420`) requires only a recognizable family, a
`Date` of `2026-08-06`, and a final-round verdict — it is never even passed the
commit. Nothing in the oracle asserts that the two independent reviews it binds
are reviews *of the qualified tree*. Concretely, at this commit:

- the receipt qualifies `C = 0ee1fadc136e837f430556374a5842ac82069004`, whose
  `implementationDigestAt` is `sha256:2cad36279fbb…eedf33`;
- all four bound fork reviews are headed `commit cdc0fe03e`, whose
  `implementationDigestAt` is `sha256:3aec87741a27…0798f`;
- `git diff --name-status 0ee1fadc1 cdc0fe03e` restricted to
  `IMPLEMENTATION_ROOTS` shows `src/instance_fork.rs`, `src/storage.rs`,
  `src/proof_checkpoint.rs`, `src/server.rs`, `src/local.rs`, `src/manifest.rs`
  and `src/storage/migration_executor.rs` among the modified paths, via
  `d2bd5fbbd` ("fix(proof): green the seven remaining keep-going reds — all real
  defects").

So the reviews the receipt binds read a later, more-fixed fork implementation
than the tree the receipt qualifies, and the oracle cannot see it. Today the
consequence is masked — the anchor is withheld and the C-to-P gate already
refuses at HEAD — but this is precisely the custody hole the three-way equality
was meant to close, displaced from bytes to evidence: the equality pins the tree
at C and at P without pinning which ancestor is named C or what the reviewers
actually read. Closure is one conjunct each: pass the commit and the digest into
`validateDerivedForkReview` and require the review to name them, as the storage
chain already does.

**R5-7 (Low) — LLP 0162 v0.42 overstates the code in two places.** "`NOT READY`,
quoted READY prose elsewhere, and READY text in historical rounds or non-current
table columns never satisfy either gate" is falsified by R5-1 and R5-2; "Only the
last `## Round N` section is current" is falsified by R5-3. Since that paragraph
is the specification a future reviewer will trust, I would raise the parser to
the prose rather than weaken the prose to the parser.

### Regression check on the fixes themselves

No new defect in what `b08e835f1` changed, and nothing weakened:

- `validateAuthorAcceptance` and `validateDerivedForkAuthorAcceptance` each
  gained `value.implementationTreeSha256 === receipt.implementationTreeSha256`
  (`:1148`, `:1443`) — strictly additional conjuncts on an existing chain.
- The candidate-facts check is genuinely de-self-referenced: `exactCandidate` is
  reconstructed from code inside the digest scope and hashed once, then required
  of the carrier *and* the receipt (`:1536-1548`), replacing the previously
  self-consistent `sha256(JSON.stringify(carrier.candidateFacts))`.
- Moving the ancestry and digest gates from `runChecker` into
  `validatePublicationRecord` only widens their reach; `runChecker` still runs the
  local-store transform check and the clean-working-tree comparison, now against
  the digest the record path returns.
- The Rust mirror lost only qualification-specific literals. The structural
  assertions it gained are a fair trade and cannot re-enter the digest cycle,
  because every value they check is either a constant or a shape.
- `node --test tests/agent_safe_publication_checker_v1.mjs` — 36 pass, 0 fail.

### Scope 1 re-verdict

| Document | Fork-relevant verdict | Round-5 assessment |
| --- | --- | --- |
| LLP 0163 | **READY** | Unchanged from round 3 and from round 4. `b08e835f1` does not touch operation identity or the commit envelope, and the fork's `attribution: "absent-v1"` boundary is untouched. |
| LLP 0164 | **READY** | Unchanged from round 3 and from round 4. Untouched by this commit; the delegated base-to-head diff surface is unaffected. |
| LLP 0165 | **READY** | Unchanged from round 3 and from round 4. Untouched by this commit; the round-3 continuity closure still holds. |

These are review verdicts on the fork-relevant surfaces of the three Specs, not
edits to their Status headers. Every finding above is in the publication oracle,
which is LLP 0162's surface, not these documents'.

### Scope 2 verdict

**NOT READY for publication of the narrow local `operating.instance-forks`
capability at `b08e835f1`.** Two of the three round-4 oracle defects are closed
and I could not reopen either. The verdict parser is not: R5-1 reproduces the
round-4 attack against the new parser, R5-2 and R5-3 add two further ways for a
blocking round to be read as approving, and R5-5 shows the fork review chain
binding reviews of a tree that is not the qualified one. The gate whose entire
purpose is to prove that two independent families said the surface was ready can
still be satisfied by a review that says the opposite, so a publication it
permits would not mean what it claims. This is a defect in the oracle, not in the
fork implementation, which round 4 found inert and which I did not re-review.

### Verification actually performed

- Read `b08e835f1` in full across `scripts/check-agent-safe-publication.mjs`,
  `src/agent_safe_publication.rs`, `tests/agent_safe_publication_checker_v1.mjs`
  and `llp/0162-agent-safe-storage-profile.rfc.md`, then read the resulting
  checker directly.
- `node --test tests/agent_safe_publication_checker_v1.mjs` — 36 pass, 0 fail.
- `implementationDigestAt` via the module export at `0ee1fadc1`
  (`sha256:2cad3627…`), `cdc0fe03e` (`sha256:3aec8774…`), `96fd0ad1c`
  (`sha256:93e0bc67…`), `0b8b0ff71` (`sha256:332db79e…`) and `b08e835f1`
  (`sha256:0ef65e5b…`), confirming both that the receipt is honest at C and that
  HEAD has drifted in scope.
- 23 adversarial cases against the lifted parser
  (`scripts/check-agent-safe-publication.mjs:1271-1400`), covering quote-first
  and quote-after needles, duplicate and historical tables, stale round columns,
  bulleted, blockquoted, escaped and bold-italic verdicts, non-breaking space and
  trailing-whitespace headings, h4 nesting, unpadded pipes, duplicate rows, and
  round-heading re-anchoring inside and outside fences.
- `git grep` for the qualification commit and all four digest literals restricted
  to `IMPLEMENTATION_ROOTS`, and `git diff --name-status 0ee1fadc1 cdc0fe03e`
  over the same paths.
- Not done: cargo build or test (`vendor/ibex` uninitialized), the working-tree
  digest comparison (same cause), and any re-review of the fork implementation
  surface.

### Recommended next step

Fix R5-1 through R5-4 in the parser and R5-5 in `validateDerivedForkReview` —
five bounded changes, each with a test that fails first — reconcile LLP 0162's
verdict-authority paragraph with the code (R5-7), and add a diagnostic for R5-6.
Then re-verdict Scope 2 against the resulting commit. The receipt will have to be
re-minted after that work in any case, because this section changes the bytes of
two artifacts the current receipt binds.

## Round 6 — 2026-08-06, qualification commit bdc682964

**Family:** fable
**Provider/runtime:** Anthropic / Claude (Opus 5, Fable family), Claude Code
agent session
**Date:** 2026-08-06
**Redacted:** no
**Method:** fresh clean-context session; read-only worktree pinned at
`bdc682964`. I read the committed rounds 1–5 of both families under
`llp/reviews/` and stayed blind to the codex family's round-6 work — I did not
open `/Users/ccheever/projects/snapback-review-codex`. I read
`scripts/check-agent-safe-publication.mjs`, `src/agent_safe_publication.rs` and
`tests/agent_safe_publication_checker_v1.mjs` at `bdc682964` in full, then
attacked the checker as a module rather than trusting its self-tests: a 28-case
adversarial harness that builds throwaway published-fork fixtures in `/tmp` and
runs the real `validatePublicationRecord` against them, plus a full
honest-publication dry run that builds a publication commit P on top of C in a
throwaway `--shared` clone. Cargo was not run: `vendor/ibex` is uninitialized in
this worktree (gitlink `4c34c831a`, empty directory), which is also why
`implementationDigestWorkingTree` refuses here. This same section is appended to
both of my dated fork artifacts; the findings are identical.

### Summary

Commit `bdc682964` moves review authority out of Markdown and into four
`*.verdicts.v1.json` histories, and that move is real: I confirmed by
construction that the prose body is never consulted for authority, and 24 of my
28 attacks were blocked, including every round-4/round-5 prose technique, round
renumbering, prose detachment, family spoofing and ancestry substitution. The
two round-4 defects that round 5 called closed stay closed, and I verified the
digest cycle on the real tree rather than on a fixture: an honest publication P
built on top of C changes fourteen files and leaves
`implementationDigestAt(C) == implementationDigestAt(P) ==
receipt.implementationTreeSha256`, and the checker accepts it.

The gate is nonetheless not closed. The new contract is parsed with
`JSON.parse`, which resolves duplicate member names last-wins, and nothing
downstream can see that a duplicate was there — `exactKeys` runs on the parsed
object, after the collapse. So the defect class rounds 4 and 5 blocked on
("conflicting duplicates, last wins") survives verbatim; it has only changed
notation. In its strongest form the whole visible history of a verdict file can
read `NOT_READY` at every round while the checker reads an appended second
`"verdicts"` member and publishes. That falsifies the premise the contract rests
on — that a small typed JSON record is read the same way by the machine and by
the human auditing it.

Two further facts block an honest publication at this commit independently of
that: every piece of fork qualification evidence in the tree still names
`0ee1fadc1`, not C; and the prose/JSON split has already produced a live
divergence in the checked-in artifacts.

### R6-1 — Duplicate JSON member names defeat the structured verdict gate (Blocking)

`validateDerivedForkReview` reads the contract through `readEvidenceJson`
(`scripts/check-agent-safe-publication.mjs:1298`, `:647-653`), i.e. `JSON.parse`.
V8 resolves a repeated member name to the last occurrence and `Object.keys`
reports it once, so the `exactKeys` guards at `:1299`, `:1308-1311`, `:1339-1341`
and `:1348` are all structurally blind to it. Three working forms, each verified
end to end against the real `validatePublicationRecord` on a published fixture:

- **A1** — duplicate `"status"` inside the authoritative verdict object:
  `{"kind":"derivedForkPublication","status":"NOT_READY","status":"READY"}`
  parses to `READY` and the chain publishes.
- **A2** — duplicate `"verdict"` member on the authoritative entry: the blocking
  verdict object stays in the file, a second `"verdict"` member follows, chain
  publishes.
- **A4** — duplicate `"verdicts"` member at the top level. The visible array is
  a complete history in which *every* round, including the authoritative one,
  reads `NOT_READY`; a second `"verdicts"` member holding the approving history
  is appended after it. `exactKeys(value, ['schemaVersion','verdicts'])` at
  `:1299` passes, the contract validates, `state: published`.

A4 is the round-5 "conflicting duplicate tables" finding with braces instead of
pipes. It is worse than its Markdown ancestor in one respect: a Markdown table
is prose and the contract now says prose is not authority, so a reader knows to
distrust it; the JSON file *is* the authority, so a reader has no reason to
distrust what it plainly says. `jq`, `git show` and human review of the file all
report the blocking history.

This is cheap to close, and the fix should not be another key-by-key guard —
that is how this class has been re-lost four times. Require the file to be its
own canonical form: read the bytes, and refuse unless
`JSON.stringify(parsed, null, 2) + '\n'` equals them. That rejects duplicate
members, hidden members, and any unparsed residue in one comparison, needs no
vocabulary, and cannot be defeated by a construct nobody has thought of yet,
because anything that survives the round trip is by definition what the checker
read. All four checked-in verdict files already satisfy it (verified).

### R6-2 — The prose body is genuinely never consulted, and the detachment is already live (Material)

Confirmed positively, not by reading: attack D3 built a fixture whose four
review artifacts say `NOT READY` in every section, with the approving JSON
untouched, and the chain published. `validateDerivedForkReview` reads the prose
bytes only at `:1292-1297` to hash them; no other call site touches them. The
round-4/5 prose techniques are therefore dead by construction, which is the
right shape for the fix.

The cost is that nothing ties the prose to the verdict except a digest, and that
cost is not hypothetical here. All four checked-in artifacts contain sections for
rounds 1, 2, 3 and 5 and no round 4 — round 5's own method note records that
"Round 4 is not committed anywhere in this worktree" — while all four
`*.verdicts.v1.json` histories assert a round-4 entry with a typed verdict at
`0b8b0ff71`. Four verdicts of record currently have no prose anywhere in the
artifact they are bound to. The digest binding cannot detect this, because it
binds the file, not the claim.

The cheap repair keeps prose out of the authority path: require the prose to
*contain* the literal heading for the authoritative round and the authoritative
`reviewedCommit`, as a presence check. That is not verdict interpretation — it
cannot be steered by quoting a needle — and it makes a round-6 JSON entry
impossible without a round-6 prose section naming the commit.

### R6-3 — At C, every piece of fork qualification evidence names `0ee1fadc1` (Material)

`validatePublishedDerivedForkEvidenceSemantics` requires both platform benches
to carry `environment.commit === C` (`:1418-1421` via `:1220-1226`) and the
author acceptance to carry `qualifiedSourceCommit === C` (`:1386-1391`). In the
tree at `bdc682964`:

- `tests/acceptance/instance-fork-lifecycle-bench.2026-08-06.macos-aarch64.v1.json`
  and `…linux-x86_64.v1.json` both record
  `"commit": "0ee1fadc136e837f430556374a5842ac82069004"`;
- `tests/acceptance/fixtures/instance-forks/author-acceptance.2026-08-06.v1.json`
  records the same commit and `sha256:2cad3627…`;
- `tests/acceptance/receipts/agent-safe-derived-deployment-fork-publication.2026-08-04.v1.json`
  records the same pair.

`implementationDigestAt` at `0ee1fadc1` is `sha256:2cad3627…` — so the receipt is
internally honest for `0ee1fadc1`, exactly as round 5 found — but at `bdc682964`
it is `sha256:e6353dc2…`. Meanwhile rounds 4 and 5 of both families are bound to
`0b8b0ff71` and `b08e835f1`, which are descendants of `0ee1fadc1`, so the
contract's own monotonicity rule (`:1320-1322`, `:1329-1335`) forbids rewinding
C to `0ee1fadc1`. The consequence is concrete: **no honest publication can name
`bdc682964` until both platform lifecycle benches are re-run at `bdc682964` and
the author re-accepts at `bdc682964`.** Everything here fails closed, so this is
a precondition rather than a hole — but it means the frozen commit is not
currently a publishable commit, and a round-6 READY on Scope 2 would not by
itself unblock anything.

I verified that this precondition is *satisfiable* rather than circular. Dry run:
throwaway `--shared` clone at C; re-point both benches at C; append an honest
round-6 entry to all four verdict histories and a round-6 heading to all four
prose artifacts; regenerate author acceptance, receipt, carrier and anchor;
commit as P. Result: fourteen files change between C and P,
`implementationDigestAt(C) == implementationDigestAt(P) == sha256:e6353dc2…`,
and `validatePublicationRecord` returns `state: published`. The self-referential
cycle round 4 found is closed on the real tree, not only in the fixture suite.

### R6-4 — The verdict histories are not append-only (Minor)

Every entry must carry `reviewArtifactSha256 === sha256(current prose bytes)`
(`:1312-1314`), so appending round N forces rewriting the digest field of rounds
1..N-1. The per-entry digest therefore records nothing historical — it is N
copies of one value — and any later edit to an early prose section silently
re-binds the entire history. I had to rewrite all five prior entries in each of
my two files to append round 6; that is the contract working as written, not a
violation. If the field is meant to pin what each round actually reviewed, it
has to be the digest of that round's prose slice, or the file has to record one
digest at the top; as it stands it is a mandatory-rewrite field that a reviewer
can only get wrong.

### R6-5 — The same defect class is unfixed on the storage path (Minor, adjacent)

`validateReview` (`:1117-1143`) still gates `agent_safe_storage_v1` on prose,
through `markdownField` (`:1111-1115`), which returns the **first** match of
`^\*\*Label:\*\*`. An appended later round that revises `**Verdict:**` to
`NOT_READY` is shadowed by the round-1 `READY` line — verified. That is the
round-5 "lower-numbered rounds appended last" defect, alive thirty lines above
the code that fixed it for forks, in a workflow that demonstrably appends rounds.
It does not block the fork publication (different capability, `withheld`, and
both `llp/reviews/0162-…-2026-08-04.{fable,codex}.md` artifacts it names are
absent from the tree, so that chain fails closed on the missing file first). It
should not survive the next storage publication attempt.

### R6-6 — What I could not break

For the record, so the next round does not re-spend the budget: schema evasion
by unknown top-level or verdict fields, `__proto__` inside the verdict,
`verdicts` as an object, empty `verdicts`, `round` as a string, 0-based rounds,
duplicated or spliced or reordered rounds, a lower-numbered round appended last,
`"READY "` with trailing space, a spec-shaped verdict in the publication slot and
vice versa, a stale digest on any single entry, a verdict pointed at the other
family's prose artifact, both files claiming one family, a family change
mid-history, `"Fable"` with a capital F, an authoritative commit on a sibling
branch, a historical commit on a sibling branch, a nonexistent 40-hex commit, and
uppercase hex for C. All blocked, each with a specific diagnostic. One case
published that I am not counting as a defeat: deleting the blocking rounds from
the tail of a history and flipping the remaining last round to `READY`. Nothing
in the contract makes a history append-only, so that works — but it is outright
deletion of the reviewer's record, indistinguishable from writing `READY`
outright, and no oracle without an external signature can prevent it. R6-1 is a
different animal: there the reviewer's blocking record is still fully present in
the file.

### Scope 1 verdict — LLP 0163 / 0164 / 0165 conformance

**READY at `bdc682964` for all three Specs**, carried forward from rounds 1–5 on
a verified-inert delta rather than re-derived. What I verified rather than
assumed:

- `src/instance_fork.rs` and `src/fork_promotion.rs` are byte-identical from
  `cdc0fe03e` (the round-3 commit) through `bdc682964` — `git diff` over both
  paths is empty.
- The fork suites `tests/instance_fork_cli_v1.rs`,
  `tests/instance_fork_disk_pressure_v1.rs` and
  `tests/instance_fork_vm_egress_v1.rs` are likewise byte-identical over that
  span. `tests/instance_fork_bench_v1.rs` is the only fork file that moved
  (+54/-19) and the diff is entirely `rustfmt` reflow — argument wrapping and a
  tuple-per-line rewrite of the bounds `checks` array, no bound, metric or
  assertion changed.
- The claim that the rest of the delta is publication machinery needs one
  correction: `cdc0fe03e..bdc682964` is not only publication machinery, because a
  merge of `origin/main` sits inside it, touching `src/manifest.rs` (three
  `src/storage.rs` digest constants and two carrier digests rebound) and
  `src/server.rs` (packaged-store diagnostics added; the two fork app-binding
  codes moved out of the "never a caller 4xx" list). Both codes are still present
  at C (`src/server.rs:26319`, `:26340`, `:41017`, `:41452`) and
  `src/instance_fork.rs` is untouched, so fork behaviour is unchanged; and both
  changes predate `b08e835f1`, so rounds 4 and 5 reviewed them. From
  `b08e835f1` to C the only `src/` change is `src/agent_safe_publication.rs`.
- `node tests/agent_safe_publication_checker_v1.mjs` — 50 pass, 0 fail, 41.2 s.
- `node scripts/check-agent-safe-publication.mjs` — both records `withheld`.

I did not re-derive spec conformance from the Specs, and I could not execute the
Rust fork suites in this worktree. This verdict is a delta verdict on an
unchanged surface; if the surface changes, it does not carry.

### Scope 2 verdict — derived-fork publication

**NOT READY for publication of the narrow local `operating.instance-forks`
capability at `bdc682964`.** The structured contract is a real improvement and it
kills the entire Markdown attack surface, but it is parsed by a duplicate-tolerant
parser, so the specific defect this round exists to close — a verdict file whose
plain content is blocking and whose effect is approving — still works (R6-1),
now in the artifact that carries authority rather than in the decoration beside
it. Independently, nothing in the tree can honestly name C yet (R6-3). I would
expect one canonical-form check to close R6-1 for good, and a bench re-run plus a
fresh author acceptance at the publication commit to clear R6-3.

### Verification actually performed

- Read `scripts/check-agent-safe-publication.mjs` (1581 lines),
  `src/agent_safe_publication.rs` (673 lines) and
  `tests/agent_safe_publication_checker_v1.mjs` at `bdc682964` in full.
- 28-case adversarial harness driving the real `validatePublicationRecord`
  against throwaway published fixtures (`/tmp`, `git init` per case): 24 blocked,
  A1/A2/A4 published as described in R6-1, C3 published as described in R6-6.
- Honest-publication dry run in a throwaway `--shared` clone: P on top of C,
  digest equality confirmed, `validatePublicationRecord` returns `published`.
- `implementationDigestAt` through the module export at `bdc682964`
  (`sha256:e6353dc2…`), `b08e835f1` (`sha256:0ef65e5b…`), `cdc0fe03e`
  (`sha256:3aec8774…`) and `0ee1fadc1` (`sha256:2cad3627…`).
- `git merge-base --is-ancestor` for all six commits named by the four verdict
  histories, the bounds-ratification record and the receipt.
- `git diff` over `IMPLEMENTATION_ROOTS` for `cdc0fe03e..bdc682964` and
  `b08e835f1..bdc682964`, and over the fork sources and suites specifically.
- `node tests/agent_safe_publication_checker_v1.mjs` (50/50) and
  `node scripts/check-agent-safe-publication.mjs`.
- Not done: `cargo build`/`cargo test` and the Rust fork suites (`vendor/ibex`
  uninitialized; bootstrapping would dirty the frozen tree), the working-tree
  digest comparison (same cause), and any de-novo derivation of spec conformance.

### Recommended next step

Close R6-1 with a canonical-form check on the four verdict files — one function,
one test that fails first on each of A1, A2 and A4. Add R6-2's presence check for
the authoritative round heading and commit, and backfill or retract the four
round-4 entries that have no prose. Then re-run both platform lifecycle benches
at the publication commit and take a fresh author acceptance there (R6-3), and
re-verdict Scope 2 against that commit. R6-5 can wait for the storage
publication attempt, but should not survive it.

## Round 7 — 2026-08-06, qualification commit 2a5a6291a

**Family:** fable
**Provider/runtime:** Anthropic / Claude (Fable 5), Claude Code agent session
**Date:** 2026-08-06
**Redacted:** no
**Method:** fresh clean-context session; read-only worktree pinned at
`2a5a6291a`, blind to the codex family's round-7 work (I did not open its
worktree). Declared **delta round**, bounded to the publication machinery, plus
an explicit re-verification of the standing claim that the fork surface has been
inert since rounds 1-3 rather than an assumption of it. I read the committed
rounds 1-5 of both families under `llp/reviews/`; no round-6 prose section and
no round-6 verdict entry exists anywhere in this tree, so for the round-6
defect statement I worked from my brief and the v0.44/v0.45 `Revised` entries in
`llp/0162-agent-safe-storage-profile.rfc.md` (see F7-2). I read
`scripts/check-agent-safe-publication.mjs`, `build.rs`,
`src/agent_safe_publication.rs`, `tests/agent_safe_publication_checker_v1.mjs`,
and the v0.45 amendment to LLP 0162 in full at `2a5a6291a`. Executed: the
shipped checker; its self-test suite (60 pass, 0 fail, 45.7 s); and a six-case
adversarial harness that constructs a *real* publication P on top of the *real*
qualification C in a throwaway `git clone --shared --no-checkout` and drives the
shipped `validatePublicationRecord` against it, so every result below is the
shipped oracle's own verdict on a real tree, not a lifted copy. Cargo was not
run — `vendor/ibex` is uninitialized here — so `implementationDigestWorkingTree`
and the Rust mirror were reviewed by reading rather than execution. This same
section is appended to both of my dated fork artifacts; the findings are
identical. Every cite is file:line at `2a5a6291a`.

### Summary

Publication is satisfiable again, and I verified that by construction rather
than by argument: an honest v2 publication naming `2a5a6291a` validates
end-to-end through the shipped oracle. The round-5 state in which no commit
admitted an honest receipt is genuinely closed. Four of the five round-6
closures hold under attack. The fifth does not. The canonical-bytes rule that
closed the duplicate-JSON-member defect was applied to exactly one of the
chain's eight JSON artifacts, and the artifact it was not applied to is the
named-author acceptance — the object that, as of v0.45, carries the accepted
round counts and head digests on which the entire new history-chain guarantee
rests. Using one duplicate member in that file I published a tree whose fable
Scope-2 verdict history had been deleted and restarted at round 1: exactly the
defect round 6 closed, reopened one artifact over, through the fix that closed
it. Separately, the four verdict histories at C are still `v1` five-entry
records with no round 6 recorded anywhere, so the "complete history" contract
fails its first real use. Scope 2 stays blocked. Scope 1 is unchanged and clear.

### Satisfiability — CONFIRMED (the round-5 unsatisfiable state is closed)

I did not assume this. I cloned the repository at C into a throwaway shared
clone, built an honest publication P on top of it — v2 receipt, v2 carrier,
published anchor, benches renamed to C, four v2 chained histories, a v2
named-author acceptance binding all four `(roundCount, headEntrySha256)` pairs —
and ran the shipped `validatePublicationRecord`:

```
C = 2a5a6291a137ca3df41cfc826017e4de324b65a5
v2 implementation digest = sha256:017bbd2675f31b68f0fd959b555588a1b6ccaf5ea4d89f68f2dc7d1ea86177a6
in-scope drift C..P = []
RESULT: ACCEPTED -> {"state":"published","commit":"2a5a6291a...","implementationDigest":"sha256:017bbd26..."}
```

The arithmetic closes because every artifact that must name C is either outside
`IMPLEMENTATION_ROOTS` (`llp/reviews/**`, both prose artifacts and both verdict
sidecars) or inside `PUBLICATION_CYCLE_ALLOWLIST` (both benches, the bounds
ratification, the author acceptance, the receipt, the carrier, the anchor:
`scripts/check-agent-safe-publication.mjs:61-92`). `implementationDigestAt(C)`
is stable at `sha256:017bbd26…` and does not move when any of them is written.
The v1 digest the shipped receipt still names — `sha256:2cad3627…`, minted at
`0ee1fadc1` under the v1 algorithm — is correctly stale and refuses with a
version-specific diagnostic (`:595-602`, `:697-708`).

### The five round-6 closures, item by item

**1. Duplicate JSON members — CLOSED for the four verdict sidecars, REOPENED one
artifact over. See F7-1.** `readCanonicalEvidenceJson` (`:741-753`) requires
`text === JSON.stringify(parsed, null, 2) + '\n'` before any shape or value
check, which is the right shape of rule: it refuses duplicate members, key
reordering, `\r\n`, alternate escapes, and every other non-round-tripping form
in one predicate, and it refuses *before* interpretation rather than after. I
reproduced the round-6 attack against it and it refused:

```
A1 duplicate JSON member in fable Scope-2 verdict history
RESULT: REFUSED -> ... verdict contract is not canonical JSON
```

But `readCanonicalEvidenceJson` has exactly one call site — `:1404`, the verdict
sidecar. Every other JSON artifact in the chain still goes through
`readEvidenceJson` (`:733-739`), which is a bare `JSON.parse`: the two benches
(`:1553-1554`), the bounds ratification (`:1370`), the storage corpus and both
performance records (`:1078`, `:1171`, `:1177`), the storage author acceptance
(`:1251`), and — the one that matters — the derived-fork named-author acceptance
(`:1502`). The receipt, carrier, and anchor are likewise plain `JSON.parse`
(`:1630-1632`).

**2. Storage-path first-match verdict parsing — CLOSED.** `markdownField`
(`:1211-1219`) collects all matches and returns `undefined` unless there is
exactly one, and every caller compares against a required literal, so a missing
or duplicated declared field fails closed rather than resolving to the first
occurrence. This path is reachable only for `agent_safe_storage_v1`, whose
anchor remains `withheld`; it cannot be reached by the fork record at all
(`:1608-1616`). I could not construct a shadowing case.

**3. Non-append-only `reviewArtifactSha256` — DOCUMENTED, and the documentation
is accurate.** The code says what it is (`:1420-1421`) and LLP 0162 v0.45 says
it too. I accept the disposition; see F7-3 for the consequence it now carries
that it did not carry before v0.45.

**4. History deletion / renumbering — CLOSED *conditionally*, and the condition
is the artifact F7-1 leaves unprotected.** The per-entry chain is real: entry
digests are `sha256(JSON.stringify(entry, null, 2) + '\n')` (`:1465`), rounds
must satisfy `entry.round === index + 1` (`:1431`), and `previousEntrySha256`
must match the predecessor (`:1433`). Two attacks against it refused:

```
A2 delete-and-restart fable Scope-2 history at round 1
RESULT: REFUSED -> ... implementationReviewFableVerdicts history does not match
                       the named-author accepted complete history
A3 non-contiguous round number (round 7 appended as the sixth entry)
RESULT: REFUSED -> ... rounds are missing, duplicated, or non-monotonic
```

A3 refuses on contiguity alone. A2 — the attack that matters — refuses only
because of `reviewHistoryHeads` in the named-author acceptance (`:1526-1536`):
the restarted history is internally perfectly valid, correctly chained, and
names C. The chain by itself proves nothing, because appending
prose rotates `reviewArtifactSha256` in every entry and therefore rehashes the
whole chain — an actor rewriting history is already rewriting every entry. All
of the strength is in the accepted `(roundCount, headEntrySha256)` pair. That
pair lives in the one artifact F7-1 shows is not canonicalized. A5 below
composes the two.

**5. Mode/type-aware implementation digest v2 — CLOSED, and it is sound.**
`updateTreeDigest` (`:525-536`) frames each leaf as
`mode \0 type \0 path \0 u64be(len) \0? bytes`; git modes and object types
contain no NUL, git paths contain no NUL, paths are unique and sorted, and the
content is length-prefixed, so the framing is injective and prefix-free — two
distinct trees cannot collide by re-partitioning the digest input. The version
string is hashed first (`:588`). `implementationEntriesAt` (`:565-582`) requires
`vendor/ibex` to be present as exactly one `160000 commit` entry and hashes the
gitlink oid as its content (`:561`). `build.rs:387-484` mirrors the same
algorithm from `git ls-tree -r HEAD` with the same v2 label, the same cycle-path
exclusion (`build.rs:516-548`), and the same gitlink typing, and refuses rather
than guessing on any entry it cannot parse (`build.rs:493-514`). The Rust
publication mirror now requires `snapback.local-agent-safe-publication.v2`,
`snapback.agent-safe-publication-receipt.v2`, and an explicit
`snapback:agent-safe-implementation-tree:v2` on both carrier and receipt
(`src/agent_safe_publication.rs:369-386`). The shipped suite covers the
executable-bit-only change, the file-to-symlink type swap, the gitlink change,
and the explicit v1 refusal, and all four pass. I could not find a mode or type
mutation the v2 framing misses.

### F7-1 (High) — the duplicate-member fix is one artifact wide, and the artifact it misses is the named-author acceptance

The derived-fork named-author acceptance is read with `readEvidenceJson` at
`:1502`, so `JSON.parse` last-wins semantics apply. I built an otherwise
completely honest publication at C whose acceptance file begins:

```json
{
  "schemaVersion": "snapback.derived-fork-author-acceptance.v2",
  "capabilityId": "agent_safe_derived_deployment_fork_v1",
  "accepted": false,
  "accepted": true,
  ...
```

```
A4 duplicate JSON member in named-author acceptance
RESULT: ACCEPTED -> {"state":"published", ...}
```

The single artifact whose entire purpose is to record that a named human
accepted this capability reads `"accepted": false` on its face, in the committed
tree, in the diff a reviewer would look at, and the capability publishes. This
is the round-6 defect with one file substituted.

It is not the interesting half of the finding. Since v0.45 this same
non-canonicalized object is the anchor of the history-chain guarantee, so the
same primitive reopens closure 4 outright. A5 restarts the fable Scope-2 history
at round 1 — deleting rounds 1-5 and every recorded `NOT_READY` — and hides the
restart behind a duplicate `reviewHistoryHeads` member:

```
tests/acceptance/fixtures/instance-forks/author-acceptance.2026-08-06.v1.json
  line 27  "reviewHistoryHeads": {          <- visible; roundCount 6, head sha256:876f1032...
  line 45  "reviewHistoryHeads": {          <- parsed;  roundCount 1, head sha256:618fa4e9...
```

```
A5 restart fable Scope-2 history + duplicate reviewHistoryHeads
RESULT: ACCEPTED -> {"state":"published", ...}
```

The published tree's authoritative fable Scope-2 history is one entry, round 1,
`previousEntrySha256: null`, `READY`. Everything a human inspects — the visible
`reviewHistoryHeads`, the prose artifact with its five rounds and its two
recorded `NOT_READY` verdicts — says a six-round history was accepted. This is
outside the stated non-claim: the non-claim covers an actor who *fabricates*
both the reviewer history and the acceptance, and here the acceptance is not
fabricated in any way a reader can see. A fabrication that survives reading is a
different and worse thing than one that does not.

The fix is one line of reuse: route every publication-chain JSON artifact
through `readCanonicalEvidenceJson`, starting with the two author-acceptance
files, the receipt, the carrier, and the anchor. The predicate already exists
and is already correct; it is simply not applied. The class does not close
artifact by artifact — it closes when the codebase can no longer read a
publication-chain JSON file non-canonically. I would state that as the invariant
in LLP 0162 rather than enumerating which files are covered today.

### F7-2 (High) — round 6 is not in the record, the histories are still v1, and an honest round-7 entry cannot be recorded

At `2a5a6291a` all four verdict histories are still
`"schemaVersion": "snapback.review-verdicts.v1"`, five entries each, rounds 1-5,
no `previousEntrySha256` field. `grep -c '"round"'` returns 5 for all four; the
string `previousEntrySha256` does not occur in any of them. No `## Round 6`
heading exists in any of the four prose artifacts. Commit `59f18a9a0`, whose
message is "Close round-6 publication review findings", changes those four
sidecars only by rotating `reviewArtifactSha256` to bind the restored round-4
prose; it adds no round-6 entry. So the round-6 verdicts described to me — both
families, Scope 1 `READY`, Scope 2 `NOT_READY` — exist nowhere in the record
that v0.45 declares authoritative, while three commits of remediation cite them.

This is not bookkeeping. The v2 contract's headline property is that the history
is complete and that deletion is detectable, and the corpus it governs is
already missing a round at the moment the contract ships. The contiguity rule
then makes the loss self-perpetuating: with five entries present, the next
appended entry must be `round: 6`. A3 above is exactly this case and the oracle
refuses it. So at this commit an honest round-7 reviewer has three choices, and
all three are bad:

1. record `round: 6` — which writes a false round number into the authoritative
   record and silently absorbs the missing round, i.e. performs by hand the
   deletion the v2 chain was built to prevent;
2. record `round: 7` — truthful, and the oracle refuses the history with
   "rounds are missing, duplicated, or non-monotonic", which is a correct
   statement about the corpus;
3. fabricate a round-6 entry for a review I did not perform.

**I chose (2).** My round-7 entries in
`llp/reviews/0158-instance-forking.implementation-2026-08-06.fable.verdicts.v1.json`
and
`llp/reviews/0163-0165-derived-fork-implementation-2026-08-06.fable.verdicts.v1.json`
carry `"round": 7`. I migrated those two files to
`"schemaVersion": "snapback.review-verdicts.v2"` and added the
`previousEntrySha256` chain over the five preserved entries — no recorded
verdict was altered, added, or removed — and I updated `reviewArtifactSha256` in
every entry to the digest of the appended prose, as the current-state binding
requires. I did not touch the codex family's two sidecars. The resulting
histories therefore fail closed with an accurate diagnostic, which is the
correct behavior for a corpus that has lost a round, and which costs nothing
here because my Scope 2 verdict is `NOT_READY` in any case.

Whoever reconciles this must decide, on the record, what happened to round 6:
recover the two families' round-6 verdicts and insert them, or state in LLP 0162
and in the gate issue that round 6 was conducted and its verdicts were not
recorded, and start a fresh v2 history whose round 1 says so. Renumbering my
round to 6 is the one option that must not be taken silently.

### F7-3 (Medium, advisory) — the chain's strength is entirely in the accepted head, and that should be said plainly

`reviewArtifactSha256` is a current-state binding, so appending or restoring
prose rewrites it in every entry and rehashes the entire chain (`:1422-1424`,
`:1465`). The chain therefore has no append-only property of its own: any actor
who can rewrite one entry can rewrite all of them and re-chain, and the file
will validate. Its only real anchor is the `(roundCount, headEntrySha256)` pair
the named author accepted. LLP 0162 v0.45 says the mechanism is "logically
ordered but not physically append-only", which is true but reads as a caveat;
what it now implies is stronger and load-bearing — **the acceptance artifact is
the sole root of trust for review history, so its integrity requirements must be
at least as strict as the sidecars' are.** Today they are strictly weaker
(F7-1). Nothing else needs to change for this finding alone; it should be
written down so a future reader does not mistake the chain for the guarantee.

### Confirmations, stated as such

- **The prose body is genuinely never consulted for authority.**
  `validateDerivedForkReview` reads the prose only to hash it (`:1398-1411`);
  the bytes are never parsed, matched, or searched. The seven historical
  Markdown bypasses are structurally unreachable for the fork record, and the
  shipped suite still exercises four of them as regressions.
- **Family and locator spoofing are closed by construction.** The four
  `(reviewIndex, verdictIndex, expectedKind)` triples are hard-coded
  (`:1562-1585`) and the resulting families are then asserted literally
  (`:1586-1595`), so the `family` field cannot move a verdict to the wrong
  artifact and a same-family pair refuses.
- **Fail-closed on missing/malformed input.** Missing prose, missing sidecar,
  truncated JSON, unknown or absent fields, non-40-hex commits, a final entry
  that does not name C, and non-ancestral reviewed commits all refuse; I
  re-ran the shipped cases and added no counterexample.
- **The allowlist is still self-protecting.** `PUBLICATION_CYCLE_ALLOWLIST` and
  `IMPLEMENTATION_ROOTS` both live in the checker, which is itself an
  implementation root and is not allowlisted, so widening the allowlist at P
  moves `digest(P)` and fails the three-way equality first. My round-5 note
  that this is an accident of the roots list rather than a stated invariant
  still stands; v0.45 did not write it down.

### The fork implementation surface at this commit — verified, not assumed

`git diff --name-status cdc0fe03e..2a5a6291a` over `IMPLEMENTATION_ROOTS` plus
`vendor/ibex` (`cdc0fe03e` is the rounds 1-3 convergence commit; it is an
ancestor of C, and `0ee1fadc1` is an ancestor of it) touches no fork
implementation file. `src/instance_fork.rs`, `src/fork_promotion.rs`,
`src/branches.rs`, `src/storage/write_authority.rs` and `src/operation_ledger.rs`
are unchanged; the most recent commit touching any of them, `d2bd5fbbd`, is an
ancestor of `cdc0fe03e`. The `src` delta is three files: `agent_safe_publication.rs`
(the publication mirror, reviewed above), `manifest.rs` (unrelated
relation-activity / sequence-allocation / local-store digest literals), and
`server.rs` (diagnostic vocabulary — five packaged-store codes added, and
`SNAPBACK_FORK_APP_BINDING_REQUIRED` / `_MISMATCH` moved out of the
never-a-caller-4xx list at `src/server.rs:42046` while remaining defined at
`src/instance_fork.rs:44-45` and classified at `src/server.rs:26319,26340`).
That last change is fork-adjacent, landed in `1048d97d6`, which is inside the
`0ee1fadc1..0b8b0ff71` range round 4 reviewed; it is a diagnostic
classification and does not touch any of the four published facts
(`egress: denyAll`, `promotion: notPromotable`, `base: currentHead`,
`isolation: hostMediated`). `vendor/ibex` is unchanged. The rounds 1-3
conclusions carry forward on the merits.

### Scope 1 verdict

**READY for LLP 0163, LLP 0164, and LLP 0165 at `2a5a6291a`.** The conformance
surface those three Specs govern is byte-identical to the tree that converged
dual-family `READY` at `cdc0fe03e`, and I verified that rather than inheriting
it. Nothing in the v0.45 publication work touches it.

### Scope 2 verdict

**NOT READY for publication of the narrow local `operating.instance-forks`
capability at `2a5a6291a`.** F7-1 lets a duplicate JSON member in the
named-author acceptance publish a capability whose acceptance record visibly
reads `"accepted": false`, and — composed with a history restart — publish a
tree whose accepted six-round review history has been replaced by a single
fabricated `READY` round while every human-readable surface still shows six.
That is the round-6 defect and the round-6 history-deletion defect, both live,
reached through the artifact the round-6 fix did not cover. F7-2 additionally
means the record this gate exists to protect has already lost a round and cannot
currently accept an honest one. The fork implementation is not implicated in
either; it remains inert and sound.

### Verification actually performed

- Read at `2a5a6291a`, in full: `scripts/check-agent-safe-publication.mjs`
  (1726 lines), `build.rs` publication region, `src/agent_safe_publication.rs`,
  `tests/agent_safe_publication_checker_v1.mjs`, the v0.45 amendment to
  `llp/0162-agent-safe-storage-profile.rfc.md`, and
  `issues/20260806-derived-fork-publication-author-gate.md`.
- `node scripts/check-agent-safe-publication.mjs` — both records `withheld`.
- `node tests/agent_safe_publication_checker_v1.mjs` — 60 pass, 0 fail, 45.7 s.
- `implementationDigestAt` at C through the module's own export:
  `sha256:017bbd2675f31b68f0fd959b555588a1b6ccaf5ea4d89f68f2dc7d1ea86177a6`.
- Six end-to-end cases against the shipped `validatePublicationRecord`, each a
  real publication commit built on the real C in a throwaway shared clone:
  honest baseline (ACCEPTED), A1 duplicate sidecar member (REFUSED), A2 history
  restart (REFUSED), A3 non-contiguous round (REFUSED), A4 duplicate
  `"accepted"` member in the author acceptance (**ACCEPTED**), A5 history
  restart hidden behind a duplicate `reviewHistoryHeads` member (**ACCEPTED**).
- `git diff --name-status` and `git log` over `IMPLEMENTATION_ROOTS` for
  `cdc0fe03e..2a5a6291a` and `b08e835f1..2a5a6291a`; ancestry checks on all
  reviewed commits; `git log -- ` on the five fork implementation files.
- Round/schema census of all four verdict sidecars and all four prose artifacts.
- Not done: cargo build or test, `implementationDigestWorkingTree` execution,
  and the Rust mirror's runtime behavior (`vendor/ibex` uninitialized); no
  re-review of the fork implementation internals beyond the delta check above.

### Recommended next step

Route every publication-chain JSON artifact through `readCanonicalEvidenceJson`
— author acceptances first, then receipt, carrier, anchor, benches and storage
evidence — and state the invariant in LLP 0162 as "no publication-chain JSON is
ever read non-canonically" rather than as a list of covered files, with a test
that fails first for the author acceptance. Then decide and record what happened
to round 6, and reconcile the four sidecars to v2 accordingly. Both are bounded.
Neither touches the fork implementation, which has now been READY for five
consecutive rounds.
## Round 8 — 2026-08-06, qualification commit 0e778b9a8

**Family:** fable
**Provider/runtime:** Anthropic / Claude (Opus 5, Fable family), Claude Code
agent session
**Date:** 2026-08-06
**Redacted:** no
**Method:** fresh clean-context session; read-only worktree pinned at
`0e778b9a8`. I read the committed rounds 1–6 of both families under
`llp/reviews/` and stayed blind to the codex family's round-8 work — I did not
open `/Users/ccheever/projects/snapback-review-codex` and did not read
`codex-review-r8-stream.log`. I read `scripts/check-agent-safe-publication.mjs`
(1749 lines), `src/agent_safe_publication.rs` (684 lines), the publication half
of `build.rs`, and `tests/agent_safe_publication_checker_v1.mjs` at `0e778b9a8`
in full. I then attacked the shipped module rather than trusting its self-tests:
a 27-case harness that builds throwaway published-fork fixtures and runs the
real `validatePublicationRecord` against them, plus a full honest-publication
dry run that builds a publication commit P on top of C in a throwaway `--shared`
clone. For the two record-integrity questions I worked from primary sources —
the round-6 reviewer's own session transcript and the codex round-6 session
stream log — not from the committed text. Cargo was not run: `vendor/ibex` is
uninitialized here (gitlink `4c34c831a`, empty directory), which is also why
`implementationDigestWorkingTree` refuses in this worktree. This same section is
appended to both of my dated fork artifacts; the findings are identical.

### Summary

The F7-1 fix is real and, as far as I can break it, complete. Every
publication-chain JSON object now passes through one canonical reader
(`:741-757`), the A4 and A5 publications my family demonstrated in round 7 both
refuse at that boundary, and I could not find a chain read that bypasses it. All
27 of my attacks landed where they should.

The gate is nonetheless not closed, for three reasons that are all about the
record and the evidence rather than the parser:

1. **Round 7 is missing from all four artifacts** — the same defect as F7-2, one
   round later, and this time the tree's own design record cites the round it
   omits. The contiguity rule then makes an honest round-8 entry invalid, which
   is exactly what my appended entry is.
2. **The round-6 restoration is not verbatim in the two Fable artifacts.** It
   restores the reviewer's superseded draft; the correction that reviewer made
   before appending — which stated plainly that one attack published — is gone,
   replaced by wording that says the attack is "defeated independently".
3. **Three of the thirteen bound fork evidence artifacts are not canonical JSON
   at C**, so the new reader refuses them. One of the three is outside
   `PUBLICATION_CYCLE_ALLOWLIST` and inside the implementation-digest scope, so
   repairing it rotates the digest and unmakes C. No publication can name this
   commit. The self-tests do not see this because the fixtures re-serialize the
   real evidence canonically before using it.

### F8-1 — Round 7 exists in the design record and nowhere in the review record (Blocking)

All four `*.verdicts.v1.json` histories end at round 6 (`bdc682964`), and all
four prose artifacts end at `## Round 6`. There is no round-7 section and no
round-7 entry anywhere in the tree. But `llp/0162-agent-safe-storage-profile.rfc.md:8`
(v0.46, added by this very commit) says: "round-7 Fable found canonical JSON
enforcement applied only to verdict sidecars…", and the same paragraph closes
with "Both anchors remain withheld pending fresh **round-7** verdicts". The tree
therefore simultaneously credits a round-7 review for the defect this commit
fixes and denies that any round 7 happened.

It did happen, for both families, and the artifacts survive outside the
repository:

- `…/scratchpad/round7-section.md` (22 361 bytes, written 2026-08-06 23:50) is
  the Fable round-7 section, headed `## Round 7 — 2026-08-06, qualification
  commit 2a5a6291a`, recording **Scope 1 READY** and **Scope 2 NOT READY**;
- `…/scratchpad/codex-review-r7-final.md` records the codex round-7 result —
  "Scope 1 is `READY`; Scope 2 is `NOT_READY`" — and notes that codex wrote its
  sidecars as rounds `[1,2,3,4,5,7]` precisely so the gap would fail closed.

Neither family's round-7 append was landed. `git log bdc682964..0e778b9a8`
contains three commits; the only review-artifact change in them is this commit's
round-6 restoration. The loss is not recorded anywhere: the gate issue
`issues/20260806-derived-fork-publication-author-gate.md:257-266` records the
round-4 repair and says nothing about rounds 6 or 7.

The consequence is mechanical. `validateDerivedForkReview` requires
`entry.round === index + 1` (`scripts/check-agent-safe-publication.mjs:1441-1443`).
My round-8 entry is the seventh entry in a history whose last recorded round is
6, so the history now reads `[1,2,3,4,5,6,8]` and refuses with "rounds are
missing, duplicated, or non-monotonic". I verified the refusal by construction
before writing it (attack G2, below): appending a round 8 to a contiguous 1..6
history in a published fixture refuses. I am recording it anyway, with the
number this round actually has. Renumbering it to 7 would be a false statement
about which review produced these findings, and it would bury a second lost
round in the same file that already lost one.

The repair is to restore both families' round-7 sections and entries from the
surviving artifacts, exactly as round 6 was restored — and this time to record
the loss in the gate issue.

### F8-2 — The round-6 Fable restoration is not verbatim (Blocking)

The claim under test is the brief's and the RFC's: round-6 prose was "restored
verbatim… nothing reconstructed or paraphrased". For the codex pair it holds.
For the Fable pair it does not.

The Fable round-6 reviewer ran as a subagent whose transcript is
`~/.claude/projects/-Users-ccheever-projects-snapback/77cb79d3-…/subagents/agent-a1fb2c13d8caa32fa.jsonl`.
Three consecutive tool calls settle it:

- record 127, `2026-08-07T05:37:48.586Z` — `Write` of the round-6 section to the
  scratchpad staging file. Its `R6-6` paragraph reads "Truncating the blocking
  tail of a history and declaring an earlier commit as C also publishes, but
  that is outright forgery of the reviewer's record… and it is defeated
  independently by R6-3's digest binding."
- record 132, `2026-08-07T05:38:08.223Z` — `Edit` of that same file, replacing
  that paragraph with: "One case published that I am not counting as a defeat:
  deleting the blocking rounds from the tail of a history and flipping the
  remaining last round to `READY`. Nothing in the contract makes a history
  append-only, so that works — but it is outright deletion of the reviewer's
  record… and no oracle without an external signature can prevent it."
- record 135, `2026-08-07T05:38:14.460Z` — a `Bash` call that reads that file
  and appends it to both Fable artifacts. It ran *after* the edit, so what the
  round-6 reviewer actually appended was the corrected text.

The text committed at `0e778b9a8` is the pre-correction draft. I diffed the
committed section against the reviewer's staging file: they differ in exactly
one paragraph, the one above (`git show 0e778b9a8` vs
`…/scratchpad/round6-section.md`; 16 375 vs 16 593 bytes).

This is not a formatting difference. The reviewer's final text says an attack
*published* and that no oracle without an external signature can stop it; the
committed text says the same attack is "defeated independently by R6-3's digest
binding" — a defence that reviewer explicitly declined to claim. The record now
understates a working attack, in a document whose entire purpose is to be the
record. Every other line of the Fable round-6 section is byte-identical to the
reviewer's write, and no verdict value was touched.

For the codex pair I checked the opposite direction and found nothing wrong: all
29 distinctive lines of the committed codex round-6 section appear verbatim in
`…/scratchpad/codex-review-r6-stream.log`, and the only near-miss variants in
that log belong to earlier rounds' text being read back.

### F8-3 — Three bound fork evidence artifacts are not canonical at C, and one of them cannot be fixed at C (Blocking)

I built an honest publication P on top of C in a throwaway `--shared` clone:
re-pointed both platform benches at C, appended rounds 7 and 8 to all four
histories, regenerated the author acceptance, receipt, carrier and anchor, and
committed. `implementationDigestAt(C) == implementationDigestAt(P) ==
sha256:b77879fa08cb71a943b7f17aecdd03b290da7bd429e68426859161faab09a725`, so the
cycle break still works. The checker then refused:

```
agent-safe-publication: fork bounds ratification is not canonical JSON
```

Checking all nineteen JSON artifacts in both chains on disk at C, three fail the
canonical form and they are all fork bench receipts:

- `tests/acceptance/instance-fork-lifecycle-bench.2026-08-06.macos-aarch64.v1.json`
- `tests/acceptance/instance-fork-lifecycle-bench.2026-08-06.linux-x86_64.v1.json`
- `tests/acceptance/instance-fork-lifecycle-bench.2026-08-06.v1.json` (the
  author's bounds-ratification record, evidence #3 of 13)

Two causes, both in every file: the ratified bounds are serialized as
`"createColdSmallParentMs": 2000.0` where `JSON.stringify` writes `2000`, and
there is no final newline. The producer is Rust —
`tests/instance_fork_bench_v1.rs:403-431` builds the receipt with `f64` bound
constants and prints `serde_json::to_string_pretty` — so **re-running the
benches cannot produce canonical bytes either**. The canonical rule as written
is unsatisfiable by any `serde_json` producer that emits a whole-valued float.

The two platform benches are in `PUBLICATION_CYCLE_ALLOWLIST`, so rewriting them
does not disturb the digest. The bounds-ratification record is not
(`PUBLICATION_CYCLE_ALLOWLIST.has(…2026-08-06.v1.json) === false`, verified
through the module export) and it lives under `tests/`, inside
`IMPLEMENTATION_ROOTS`. Canonicalizing it therefore rotates
`implementationDigestAt` and C stops being the commit the receipt, the reviews
and the acceptance name. So: **no publication can honestly name `0e778b9a8`**,
and the fix has to land as a new qualification commit C′ with fresh benches and
a fresh round from each family. That is the same shape round 5 found and round 6
cleared; the F7-1 fix reintroduced it by tightening a rule without checking the
evidence the rule now governs.

Why no test caught it: `publishedDerivedFixture` reads each real bench with
`JSON.parse` and re-serializes it canonically before writing the fixture
(`tests/agent_safe_publication_checker_v1.mjs:529-533`), so the suite never
observes the committed bytes. A cheap permanent guard is a test that asserts
every path in `DERIVED_FORK_EVIDENCE` and `STORAGE_EVIDENCE` ending in `.json`
equals its canonical form on disk.

### F8-4 — The committed self-test pins the histories, so recording a round unmakes C (Material)

`tests/agent_safe_publication_checker_v1.mjs:746-770` hardcodes
`assert.deepEqual(value.verdicts.map(({ round }) => round), [1, 2, 3, 4, 5, 6])`
and `qualificationCommit = 'bdc68296…'` against the *live* repository artifacts.
Any honest new round breaks it — after appending my round 8 the suite drops from
64/64 to 63/64, and the one failure is that test (verified). Repairing the test edits
`tests/`, which is inside `IMPLEMENTATION_ROOTS`, which rotates the
implementation digest, which invalidates C.

This is the same trap codex reported in round 7, when the test pinned v1/rounds
1–5; the fix re-pinned it to v2/rounds 1–6 rather than removing the coupling. As
long as the assertion names specific round numbers and a specific commit, the
act of recording a review invalidates the qualification the review is about. The
test should assert the *properties* it cares about — v2 schema, contiguity from
1, head naming whatever the sidecars name, distinct families — not the literal
history at one instant.

### What I could not break

27 cases against the real `validatePublicationRecord`, each on a complete
published fixture. Three published, all expected; 24 refused.

- **A4 rerun** — author acceptance whose visible `"accepted"` is `false` with a
  later duplicate `true`: refused, "derived-fork author acceptance is not
  canonical JSON". This is the exact publication my family demonstrated in
  round 7.
- **A5 rerun** — one family's history replaced by a single fabricated `READY`
  round, with the acceptance's visible `reviewHistoryHeads` still showing a
  multi-round history and a duplicate member carrying the matching heads:
  refused at the same boundary.
- **Duplicate top-level member in every artifact kind** — anchor, carrier,
  receipt, author acceptance, both platform benches, the bounds ratification,
  and all four verdict sidecars: eleven separate cases, all refused before any
  shape or value check.
- **Duplicate member nested inside the authoritative verdict object**
  (`"status": "NOT_READY", "status": "READY"`): refused.
- **Byte-level non-canonical forms** — minified acceptance, CRLF sidecar,
  carrier without a final newline, receipt with an extra one, 4-space-indented
  anchor, `"accepted"` as an escaped key, UTF-8 BOM, trailing `//` comment
  after a bench: all eight refused.
- **History shape** — a `[1,2,4]` gap and an appended round 8 after a contiguous
  1..6 history: both refused on contiguity.
- Expected to publish, and did: the honest fixture, and (S1) a fixture whose
  four prose bodies read `NOT READY` in every section while the JSON says
  `READY`. The prose body is genuinely never consulted; round 6 established
  this and it still holds.
- Expected to publish, and did: (A5c) a fabricated single-round history whose
  heads the author acceptance also names. That is the stated residual — an actor
  who forges both the reviewer histories and the named-author acceptance is
  outside the guarantee — and I did not widen it.

I looked for a chain read that bypasses the canonical boundary and found none.
Every JSON read reachable from `runChecker` goes through
`parseCanonicalPublicationJson`/`readCanonicalPublicationJson`
(`:741-757`, anchors/carriers/receipts at `:1653-1655`, storage evidence at
`:1083`/`:1178`/`:1184`/`:1258`, benches at `:1377`/`:1564-1573`, verdict
sidecars at `:1415`, the derived acceptance at `:1513`, the local-store
transform at `:403`/`:413`/`:417`/`:434`). The two bare `JSON.parse` calls that
remain (`:236`, `:319`) decode `artifacts.json` review manifests inside
`generatedPublicationPathsAt`/`OnDisk`, which `runChecker` never calls; they feed
`scripts/update-agent-safe-publication-leaf-set.mjs` and the inventory test.
They are not publication authority, but they are the last place a future author
could add one, and the invariant comment at `:737-740` would read as broken to
anyone who grep-checks it.

Two adjacent surfaces I checked and am not counting as findings:

- The Rust reader (`src/agent_safe_publication.rs:307-397`) does not enforce
  canonical bytes, but all three structs are `deny_unknown_fields` and serde's
  derive rejects duplicate fields, the carrier's facts are reconstructed in Rust
  and compared exactly, and `derived_fork_publication_verified_for_distribution`
  returns `false` unconditionally (`:255-263`). Nothing it accepts is wider than
  what the checker accepts.
- The storage path still takes its verdict from prose via `markdownField`
  (`:1218-1226`, `:1228-1254`). Duplicate declared fields now fail closed, as
  round 7 reports, but a single verdict line inside a fenced quotation would
  still be read as authority. `agent_safe_storage_v1` is withheld and both
  `llp/reviews/0162-…-2026-08-04.{fable,codex}.md` artifacts are absent from the
  tree, so that chain fails closed on the missing file first. Unchanged since
  R6-5; it should not survive the next storage publication attempt.

### Scope 1 verdict — LLP 0163 / 0164 / 0165 conformance

**READY at `0e778b9a8` for all three Specs**, carried forward from rounds 1–3 on
a delta I verified rather than assumed:

- `src/instance_fork.rs` and `src/fork_promotion.rs` are byte-identical from
  `cdc0fe03e` (the round-3 dual-family READY commit) through C — `git diff` over
  both paths is empty.
- `tests/instance_fork_cli_v1.rs`, `tests/instance_fork_disk_pressure_v1.rs` and
  `tests/instance_fork_vm_egress_v1.rs` are byte-identical over the same span.
  `tests/instance_fork_bench_v1.rs` is the only fork file that moved
  (+54/−19) and I read the whole diff: it is `rustfmt` reflow — argument
  wrapping and a tuple-per-line rewrite of the bounds `checks` array. No bound,
  metric or assertion changed.
- The `vendor/ibex` gitlink is `4c34c831a` at `cdc0fe03e`, `bdc682964` and C.
- From `b08e835f1` to C the only in-scope `src/` changes are `build.rs`,
  `src/agent_safe_publication.rs` and publication JSON; from `bdc682964` to C
  the in-scope delta is the checker, its suite, `build.rs`,
  `src/agent_safe_publication.rs` and publication records. Nothing touches fork
  behaviour.

I did not re-derive spec conformance from the Specs and could not execute the
Rust fork suites here. This is a delta verdict on an unchanged surface; if the
surface changes it does not carry.

### Scope 2 verdict — derived-fork publication

**NOT READY for publication of the narrow local `operating.instance-forks`
capability at `0e778b9a8`.** The canonicalization fix does what it claims and
the parser surface is, as far as I can attack it, closed. But the record this
gate exists to protect lost a second round (F8-1) and mis-restored part of a
third (F8-2), and the evidence the new rule governs does not satisfy it, in a
way that cannot be repaired at this commit (F8-3). A `READY` here would certify
a publication that the shipped checker itself refuses.

### Verification actually performed

- Read `scripts/check-agent-safe-publication.mjs` (1749 lines),
  `src/agent_safe_publication.rs` (684 lines),
  `tests/agent_safe_publication_checker_v1.mjs` and the publication half of
  `build.rs` at `0e778b9a8` in full.
- 27-case adversarial harness driving the real `validatePublicationRecord`
  against throwaway published fixtures: 24 refused, 3 published as expected.
- Honest-publication dry run in a throwaway `--shared` clone: P on top of C,
  three-way digest equality confirmed at
  `sha256:b77879fa08cb…`, checker refused on the bounds-ratification canonical
  form.
- Canonical-form audit of all nineteen publication-chain JSON artifacts on disk
  at C: sixteen canonical, three fork bench receipts not.
- `implementationDigestAt` through the module export at `0ee1fadc1`
  (`sha256:03eb0bb6…`), `cdc0fe03e` (`sha256:291c1c39…`), `b08e835f1`
  (`sha256:f493b354…`), `bdc682964` (`sha256:0bb5803e…`), `2a5a6291a`
  (`sha256:017bbd26…`) and C (`sha256:b77879fa…`). The `2a5a6291a` value matches
  the digest codex independently reported in round 7.
- Verdict-value audit: every entry of all four sidecars compared across
  `bdc682964`, `59f18a9a0` and `0e778b9a8`. No family, round, reviewed commit or
  verdict value was altered or renumbered; round 6 was appended with the values
  the round-6 reviewers themselves recorded (the Fable pair confirmed against
  that session's own sidecar-writing command, record 138).
- Primary-source comparison of all four restored round-6 sections
  (F8-2 above).
- `git diff` over the fork sources and suites for `cdc0fe03e..C` and over
  `IMPLEMENTATION_ROOTS` for `bdc682964..C` and `b08e835f1..C`.
- `node scripts/check-agent-safe-publication.mjs` — both records `withheld`.
- `node --test tests/agent_safe_publication_checker_v1.mjs` — 64/64 before my
  append, 63/64 after it, the single failure being the pinned-history test
  (F8-4).
- Not done: `cargo build`/`cargo test` and the Rust fork suites (`vendor/ibex`
  uninitialized; bootstrapping would dirty the frozen tree), the working-tree
  digest comparison (same cause), and any de-novo derivation of spec
  conformance.

### Recommended next step

None of this needs a new parser. In order: restore both families' round-7
sections and entries from the surviving artifacts and record the loss in the
gate issue; restore the Fable round-6 paragraph the reviewer actually wrote;
change `tests/instance_fork_bench_v1.rs` to emit canonical bytes (integer bounds
and a final newline), re-run both platform benches and re-emit the
bounds-ratification record; decouple the self-test from the literal history; add
an on-disk canonical-form assertion for every bound JSON artifact. Those edits
land inside `IMPLEMENTATION_ROOTS`, so the result is a new qualification commit
C′ that needs a fresh round from each family before anything can publish.

## Round 9 — 2026-08-07, qualification commit 42f699749

**Family:** fable
**Provider/runtime:** Anthropic / Claude (Opus 5, Fable family), Claude Code
agent session
**Date:** 2026-08-07
**Redacted:** no
**Method:** fresh clean-context session; read-only worktree pinned at
`42f699749`, clean (`git status --porcelain --untracked-files=all` empty). I
read the committed rounds 1–8 of both families under `llp/reviews/` and stayed
blind to the codex family's round-9 work: I did not open
`/Users/ccheever/projects/snapback-review-codex` and did not read
`codex-review-r9-stream.log`. I read
`scripts/check-agent-safe-publication.mjs` (1754 lines) in full, the whole
`0e778b9a8..42f699749` diff of `tests/agent_safe_publication_checker_v1.mjs`,
`tests/instance_fork_bench_v1.rs`, `build.rs` and `src/server.rs`, LLP 0162
v0.47, and `issues/20260806-derived-fork-publication-author-gate.md`. For the
two record-integrity questions I worked from primary sources — the round-6
Fable reviewer's own session transcript
(`subagents/agent-a1fb2c13d8caa32fa.jsonl`) and the round-8 reviewer's
(`agent-accf0913c2eac647a.jsonl`) — not from the committed text or from anyone's
summary of it. I then attacked the shipped module: a 38-case battery driving the
real `validatePublicationRecord` against a real published publication P built on
top of the real C, plus three end-to-end satisfiability constructions. Cargo was
not run: `vendor/ibex` is uninitialized here (gitlink `4c34c831a`, empty
directory), which is also why `implementationDigestWorkingTree` cannot run in
this worktree. This same section is appended to both of my dated fork artifacts;
the findings are identical.

### Summary

All four of my family's round-8 blockers are closed, and I verified each against
primary sources rather than against the claim. The record is honest: the Fable
round-6 paragraph in the tree is now byte-identical to the text that reviewer
actually appended, which I reconstructed independently from its session
transcript; rounds 7 and 8 are present and are the reviewers' own final text; no
verdict was altered, invented or renumbered in any restoration.

Publication is satisfiable at this C by construction, not by argument: an honest
publication P naming `42f699749` validates end-to-end through the shipped
oracle, with `implementationDigestAt(C) == implementationDigestAt(P) ==
sha256:d32763a4…`. Removing the live-record coupling did not open anything I
could find, and the evidence that left the implementation digest did not become
swappable — it is still pinned through the author-acceptance → receipt → carrier
→ anchor digest chain, and the substance of the "author-ratified bounds" never
left the digest at all, because the bound *values* are constants in
`scripts/check-agent-safe-publication.mjs`, which is itself an
`IMPLEMENTATION_ROOTS` leaf.

I have two Material findings, neither blocking, and one suggestion. The gate
holds and the surface is sound; I record Scope 1 `READY` and Scope 2 `READY`.

### Round-8 blockers — verified closed

**F8-1 (round 7 exists in the design record and nowhere in the review record) —
closed.** All four prose artifacts now carry `## Round 1` … `## Round 8`
contiguously, and all four `*.verdicts.v1.json` sidecars carry v2 rounds 1–8. I
audited every entry of all four sidecars across every commit that has ever
touched them (`bdc682964`, `59f18a9a0`, `0e778b9a8`, `485efe922`, C): no
`family`, `round`, `reviewedCommit`, or verdict value was ever changed, and no
round was renumbered — rounds were only ever appended. The round-7 values in the
tree (Scope 1 `READY`×3, Scope 2 `NOT_READY`) are exactly the values the
round-7 Fable reviewer's own sidecar-writing command recorded, which I read from
its transcript (record 166), and the codex round-7 values match
`codex-review-r7-final.md`'s own first line. `validateDerivedForkReview` accepts
all four histories at C as valid 8-round chains with the right families.

**F8-2 (the round-6 Fable restoration is not verbatim) — closed, and I checked
it the hard way.** A "restoration" is the one act that can quietly launder a
record, so I did not compare the tree against the staging file the fixer used. I
replayed the round-6 reviewer's own tool calls from its transcript: record 127
is the `Write` of the section (16 466 bytes), record 132 is the `Edit` that
replaces the R6-6 paragraph, record 135 is the `Bash` append that ran *after* the
edit. I applied the edit to the write payload myself and hashed the result:

```
reconstructed round-6 final   sha256:1e058670584ebfe04bb8ba5eb44c85e1ee36d378f05418aad9c2c417bf5a8f0f
0158-…fable.md  §Round 6      sha256:1e058670584ebfe04bb8ba5eb44c85e1ee36d378f05418aad9c2c417bf5a8f0f
0163-0165-…fable.md §Round 6  sha256:1e058670584ebfe04bb8ba5eb44c85e1ee36d378f05418aad9c2c417bf5a8f0f
```

Byte-identical in both artifacts. The paragraph in the tree is the reviewer's
final wording — "One case published that I am not counting as a defeat… no
oracle without an external signature can prevent it" — not the retracted draft
("defeated independently by R6-3's digest binding") and not an invention. The
edit's `old_string` occurs exactly once in the write payload, so there is no
ambiguity about which paragraph moved.

I also checked the round-7 and round-8 sections against their preserved staging
files. Round 7 is byte-identical. Round 8 differs from
`scratchpad/round8-section.md` in four places (26-case → 27-case, "Two
published" → "Three published", 62/64 → 63/64) — and those differences are the
round-8 reviewer's *own* later corrections, applied directly to the two Fable
artifacts by that session at 07:48:01 and 07:48:40 (transcript records 214 and
225), after it had written the staging copy at 07:45:27. The tree carries the
later, more accurate text. Nothing was inserted by a third party.

**F8-3 (three bound fork evidence artifacts are not canonical at C) — closed.**
All nineteen publication-chain JSON artifacts on disk at C equal
`JSON.stringify(parsed, null, 2) + "\n"`; none fails. The producer was fixed at
the source: `tests/instance_fork_bench_v1.rs` now normalizes integral `f64`
values to integers and appends the final newline before writing
(`normalize_integral_json_numbers` / `canonical_receipt_json`, `:71-104`,
called at `:482`), with its own regression test
(`emitted_receipt_json_is_checker_canonical`, `:105-122`). I read that code but
could not execute it here; the check that actually gates publication is on the
committed bytes, and those are canonical.

**F8-4 (the committed self-test pins the histories, so recording a round unmakes
C) — closed.** The assertion that hard-coded `[1,2,3,4,5,6]` and `bdc68296…`
against the live sidecars is gone. Its replacement builds a synthetic history of
configurable length and asserts only that advancing the length still publishes
(`tests/agent_safe_publication_checker_v1.mjs:813-818`; the synthetic bench
builder is at `:471`). The whole
fixture builder is now synthetic: reviews, verdict histories, both platform
benches, the bounds record, the acceptance, receipt, carrier and anchor are
generated, so no test reads a live `llp/reviews/*` artifact. I verified the
property that matters by doing the thing that used to break it: after appending
this round 9 to both Fable sidecars and both prose artifacts, `node --test
tests/agent_safe_publication_checker_v1.mjs` is still 66/66 and
`implementationDigestAt(C)` is unchanged. The loop is genuinely broken.

Coverage was not traded away to get there. `tests` has 474 leaves at C, exactly
as at `0e778b9a8`, and exactly one of them left the implementation digest in this
change: `tests/acceptance/instance-fork-lifecycle-bench.2026-08-06.v1.json`. A
new test asserts that an ordinary new file under `tests/` still rotates the
digest (`tests/agent_safe_publication_checker_v1.mjs:1630`).
`tests/acceptance/asset-lifecycle-v1-evidence.md` was deliberately left inside
the digest, and my E10 attack confirms replacing it refuses.

### Did the evidence become swappable when it left the digest? No

This was the question I most wanted to answer, and the answer is no, for three
independent reasons that I checked by attack rather than by reading:

1. **The bytes are still pinned by the receipt chain.** Rewriting the
   bounds-ratification record alone refuses (`evidence bytes drifted`);
   rewriting it and re-signing the receipt refuses (carrier/receipt binding);
   rewriting it and re-signing receipt + carrier + anchor still refuses, because
   the named-author acceptance independently binds the same digest. Only a
   coordinated forgery that also rewrites Charlie's acceptance publishes, and
   that is the explicitly stated non-claim, unchanged since round 6.
2. **The substance of the ratification never left the digest.** What the file
   asserts about author-ratified bounds is compared against
   `DERIVED_FORK_RATIFIED_BOUNDS`, a frozen constant in
   `scripts/check-agent-safe-publication.mjs:1300-1310` — and that script is an
   `IMPLEMENTATION_ROOTS` leaf. Widening `ratifiedBounds` in the JSON refuses
   even with the whole chain re-signed, and so does a measurement that exceeds a
   bound. The JSON contributes a measurement, not an authority.
3. **Its ancestry claim is still checked.** A bounds record naming a commit that
   is not an ancestor of C refuses, with the full chain re-signed.

The two platform benches behave the same way, plus the stronger constraint that
each must name C exactly and the pair must cover two distinct `os/arch` values —
duplicating one platform as the other refuses, and re-pointing the macOS bench
off C refuses.

`build.rs`'s mirror of `PUBLICATION_CYCLE_ALLOWLIST` is byte-for-byte the same
29 paths as the JS set at C, so the Rust-side digest and the checker agree about
what left the digest.

### Satisfiability at this exact C, by construction

I built a real publication P on top of C in a throwaway `--shared` clone:
re-minted both platform receipts at C, appended a round 9 to all four histories,
regenerated the author acceptance, receipt, carrier and published anchor, and
committed. Three runs, differing only in the round-9 entries:

| Construction | Result |
| --- | --- |
| rounds 1–8 only, no round 9 | REFUSED — `authoritative verdict does not name qualification C` |
| round 9 present, Scope 2 `NOT_READY` | REFUSED — `authoritative verdict is not READY` |
| round 9 present, all four `READY` | **published** |

In all three, `implementationDigestAt(C) == implementationDigestAt(P) ==
sha256:d32763a4caf9cd3dc2bea7a603cfdfbef54f991645c9387079bc7b50b1af337a`. The
cycle break works in production, not just in the fixtures. The codex round-9
entries in those throwaway clones are synthetic stand-ins — I have no access to
that family's round-9 work and am not asserting anything about it.

So the gate is satisfiable and it is gated on exactly the thing it should be
gated on. One qualification to the "only remaining objection is the fresh
verdicts" framing, which is R9-1 below: a second P-time step is also outstanding.

### R9-1 — The platform receipts at C bind `17366d2a4`, not C (Material, not blocking)

Both `tests/acceptance/instance-fork-lifecycle-bench.2026-08-06.{macos-aarch64,linux-x86_64}.v1.json`
carry `environment.commit = 17366d2a489bbd4af58333b5c513b45454a1c937` at C, and
`validateDerivedForkLifecycleBenchArtifact` requires exact equality with
`carrier.qualifiedSourceCommit`. So a publication naming `42f699749` refuses
until both receipts are re-minted at `42f699749` — I confirmed that by omitting
the re-mint from my construction. This is not concealed: LLP 0162 v0.47 and
`issues/20260806-derived-fork-publication-author-gate.md` both list "fresh
canonical macOS/aarch64 and Linux/x86_64 lifecycle receipts bound to C" as
required next evidence. It is not blocking either, because it is now repairable
at P: the receipts are publication-cycle evidence, so re-minting them does not
rotate the implementation digest. That is precisely the property round 8 found
missing. I record it only because "the only remaining objection is the missing
fresh verdicts" understates the remaining work by one step.

The adjacent observation is worth stating plainly: because these receipts are
now P-mutable and their tie to C is a self-declared string, the checker cannot
distinguish a genuine re-run at C from an editor changing the commit field. The
implementation tree is byte-identical between `17366d2a4` and C, so a re-point
would even be *true* here — but the oracle is not what makes it true. Re-running
the benches is a discipline the record has to carry, and the gate issue does
carry it.

### R9-2 — Historical prose is still unprotected by the chain (Material, not blocking)

Every entry's `reviewArtifactSha256` is the digest of the prose file *as it is
now*, and the code says so deliberately (`:1436-1437`). The consequence is that
the history chain cannot attest what round N's prose said when round N was
recorded. I confirmed the consequence: a publication in which the entire Fable
implementation prose artifact is replaced by "All rounds were READY", with the
sidecar re-chained and the acceptance re-signed, still publishes.

That is defensible — prose is explicitly non-authoritative and every round since
6 has verified it — but note what it means in context. The failure this repair
had to fix (F8-2) was exactly a historical-prose rewrite, and no oracle detected
it; two humans-with-transcripts did. Nothing in this commit changes that. A
cheap improvement is a second per-entry field, e.g.
`reviewArtifactSha256AtRound`, frozen when the round is recorded, so a rewrite
of an earlier round's body becomes mechanically visible instead of depending on
someone still having the transcript. I am not blocking on it: the verdicts are
the authority, they are chained, and they are intact.

### Suggestion — make the build.rs mirror test two-directional

`tests/agent_safe_publication_checker_v1.mjs:1797-1815` asserts every JS cycle
exclusion appears in `build.rs`, but not the converse. The lists are identical at
C (29 = 29, I diffed them), and a divergence would fail closed anyway — the Rust
runtime compares the carrier against its own build-time digest
(`src/agent_safe_publication.rs:291`, `:377`) — so this is hygiene, not a defect.

### What I could not break

38 cases against the real `validatePublicationRecord`, each on a complete,
genuinely published P built on the real C: 33 refused, 5 published, all five
expected.

- **A4 rerun** — author acceptance whose visible `"accepted"` is `false` with a
  later duplicate `true`: refused, "derived-fork author acceptance is not
  canonical JSON". This is the exact publication my family demonstrated in
  round 7.
- **A5 rerun** — the Fable Scope-2 history replaced by a single fabricated
  `READY` round, hidden behind a duplicate `reviewHistoryHeads` member showing a
  nine-round history: refused at the same boundary.
- **Duplicate top-level member** in the carrier, the receipt, the anchor, the
  bounds ratification, the macOS bench and a verdict sidecar: six more cases, all
  refused.
- **Non-canonical byte forms** on the newly-excluded bounds record — no trailing
  newline, four-space indent, minified, CRLF, UTF-8 BOM, trailing `//` comment —
  all six refused with the whole chain re-signed around them.
- **Evidence swapping** — bounds record rewritten with zero, one or three layers
  of the chain re-signed (three cases); measurement over the ratified bound;
  `ratifiedBounds` widened; non-ancestor ratification commit; one platform bench
  duplicated as the other; macOS bench re-pointed off C; the digest-covered
  asset-lifecycle evidence replaced: all refused. A measurement swap also has to
  stay internally consistent — my first attempt refused because the checker
  cross-checks `sequentialCreateMedianMs` against
  `createColdSmallParent.medianMs` and `concurrentCreate3WallMs` against three
  times the ratified create bound (`:1370-1378`), even with the whole chain
  re-signed.
- **History shape** — a renumbered tail, a broken predecessor digest mid-chain, a
  family flipped mid-chain, a Fable sidecar declaring `codex` throughout, an
  acceptance head lagging its sidecar by one round, and an authoritative verdict
  naming an ancestor instead of C: all refused.
- **Receipt/carrier identity** — implementation digest rotated, candidate facts
  widened to `promotable`, maturity upgraded to `stable`, a negative target
  profile dropped: all refused.
- Expected to publish, and did: the honest control; the stated residual (a full
  coordinated forgery including Charlie's acceptance); the round-6 tail-deletion
  residual (truncate to `[1..4]`, append a `READY` round 5 at C, re-chain,
  re-accept) — unchanged since round 6, and the round-6 reviewer's own final
  wording on it still stands: no oracle without an external signature can prevent
  it; and the prose-authority control (all four prose bodies reading `NOT
  READY` while the JSON says `READY`).

I re-checked the canonical boundary for a bypass and found none: every JSON read
reachable from `runChecker` goes through `parseCanonicalPublicationJson` /
`readCanonicalPublicationJson` (`:746-762`). The two bare `JSON.parse` calls that
remain (`:241`, `:324`) decode `artifacts.json` review manifests inside
`generatedPublicationPathsAt`/`OnDisk`, which `runChecker` never calls — unchanged
since round 8, and unchanged in my assessment of it.

### Scope 1 verdict — LLP 0163 / 0164 / 0165 conformance

**READY at `42f699749` for all three Specs**, carried forward on a delta I
verified rather than assumed:

- `src/instance_fork.rs`, `src/fork_promotion.rs`,
  `tests/instance_fork_cli_v1.rs`, `tests/instance_fork_disk_pressure_v1.rs` and
  `tests/instance_fork_vm_egress_v1.rs` are byte-identical from `cdc0fe03e` (the
  round-3 dual-family READY commit) through C — `git diff` over all five paths is
  empty.
- `tests/instance_fork_bench_v1.rs` is the only fork file that moved. Its delta
  since `0e778b9a8` is entirely the canonical-JSON emitter and its unit test; no
  bound, metric, workload or assertion changed.
- The three Specs and `llp/0158-instance-forking.rfc.md` are unchanged from
  `bdc682964` through C.
- The only `src/` change from `0e778b9a8` to C is `src/server.rs`, and it is the
  `/llms.txt` link ordering — nothing fork-related.
- The `vendor/ibex` gitlink is `4c34c831a` at `cdc0fe03e`, `bdc682964`,
  `0e778b9a8`, `485efe922`, `17366d2a4` and C.

I did not re-derive spec conformance from the Specs and could not execute the
Rust fork suites here. This is a delta verdict on an unchanged surface; if the
surface changes it does not carry.

### Scope 2 verdict — derived-fork publication

**READY for publication of the narrow local `operating.instance-forks`
capability at `42f699749`**, subject to the P-time steps the checker itself
enforces.

The three things that kept every previous round from READY are gone. The record
is honest and I verified it against primary sources rather than against the
claim. The self-invalidation loop is genuinely broken — recording this round did
not move the implementation digest and did not turn the suite red. The evidence
that left the digest did not become swappable, and the ratified bounds that
matter never left it. And publication is satisfiable at this exact commit by
construction, with the shipped oracle publishing an honest P and refusing the
same P when the fresh verdicts are absent or blocking.

What remains is the publication ceremony, and the oracle enforces all of it: the
codex family's own round-9 verdicts naming C; both platform lifecycle receipts
re-minted at C (R9-1); and Charlie's new v2 acceptance of the resulting four
history heads, the exact evidence digests and the implementation digest. None of
those is mine to supply, and a `READY` here does not supply them — I confirmed
that a publication missing any of them refuses.

I am not carrying forward R9-2 as a blocker, but I would not want it to be
forgotten: this record was repaired by people holding transcripts, not by the
gate.

### Verification actually performed

- Read `scripts/check-agent-safe-publication.mjs` (1754 lines) at C in full;
  read the complete `0e778b9a8..42f699749` diffs of
  `tests/agent_safe_publication_checker_v1.mjs`,
  `tests/instance_fork_bench_v1.rs`, `build.rs` and `src/server.rs`; read LLP
  0162 v0.47's `Revised` header and the gate issue's two provenance sections.
- Primary-source reconstruction of the Fable round-6 final text from
  `subagents/agent-a1fb2c13d8caa32fa.jsonl` records 127/132/135, hashed against
  both committed sections (`sha256:1e058670…`, exact match).
- Primary-source reconciliation of the round-7 and round-8 sections against
  `scratchpad/round7-section.md` and `round8-section.md`, and of the four round-8
  deltas against transcript records 214 and 225 of
  `subagents/agent-accf0913c2eac647a.jsonl`.
- Verdict-value audit of all four sidecars at `bdc682964`, `59f18a9a0`,
  `0e778b9a8`, `485efe922` and C: no value, family, commit or round number ever
  altered or renumbered; the round-7 Fable values matched against that session's
  own sidecar-writing command (transcript record 166) and the codex round-7/8
  values against `codex-review-r7-final.md` / `codex-review-r8-final.md`.
- `validateDerivedForkReview` through the module export on all four live
  histories: four valid 8-round v2 chains, correct families, Scope 1 ready,
  Scope 2 not.
- Canonical-form audit of all nineteen publication-chain JSON artifacts on disk
  at C: nineteen canonical, zero exceptions.
- `implementationDigestAt` through the module export at `0e778b9a8`
  (`sha256:a3240e83…`), `485efe922`, `17366d2a4`, `96b1ff7d9` and C (all four
  `sha256:d32763a4…`), confirming the evidence commit did not rotate the digest.
- `tests/` leaf census at `0e778b9a8` and C (474 = 474) and exact diff of the
  digest-excluded set: one path added, none removed.
- `build.rs` ↔ `PUBLICATION_CYCLE_ALLOWLIST` set comparison: 29 = 29, no
  divergence in either direction.
- Three end-to-end publication constructions on real clones of C (no round 9 /
  round 9 `NOT_READY` / round 9 `READY`), with the digest equality checked in
  each.
- 38-case adversarial battery driving the real `validatePublicationRecord`
  against a real published P: 33 refused, 5 published as expected.
- `node scripts/check-agent-safe-publication.mjs` — both records `withheld`.
- `node --test tests/agent_safe_publication_checker_v1.mjs` — 66/66 before this
  append and 66/66 after it, with `implementationDigestAt(C)` unchanged.
- `git diff` over the fork sources, the fork suites and the three Specs for
  `cdc0fe03e..C` and `bdc682964..C`, and over `IMPLEMENTATION_ROOTS` for
  `0e778b9a8..C`.
- Not done: `cargo build` / `cargo test` and the Rust fork and bench suites
  (`vendor/ibex` uninitialized; bootstrapping would dirty the frozen tree), the
  working-tree digest comparison (same cause), execution of the new canonical
  bench emitter, and any de-novo derivation of spec conformance.

### Recommended next step

Nothing here needs a code change before publication. In order: collect the codex
family's round-9 verdicts at this exact C; re-run both platform lifecycle benches
at C and commit the canonical receipts (R9-1); take Charlie's new v2 acceptance
of the four history heads, the thirteen evidence digests and
`sha256:d32763a4…`; then build P and let the checker decide. After publication,
consider the per-round prose digest (R9-2) and the two-directional mirror
assertion.

## Round 10 — 2026-08-07, qualification commit fac516e9a

**Family:** fable
**Provider/runtime:** Anthropic / Claude (Opus 5, Fable family), Claude Code
agent session
**Date:** 2026-08-07
**Redacted:** no
**Method:** fresh clean-context session; read-only worktree pinned at
`fac516e9a`, clean (`git status --porcelain --untracked-files=all` empty). This
is a bounded delta round: I was asked to verify `42f699749..fac516e9a` and, if
it is genuinely inert, re-issue round 9's verdicts against the new qualification
commit — not to re-run the round-9 attack corpus. I did verify the delta rather
than accept that it is inert. I read the committed rounds 1–8 of both families
under `llp/reviews/` and stayed blind to the codex family's round-10 work: I did
not open `/Users/ccheever/projects/snapback-review-codex`. Cargo was not run —
`vendor/ibex` is uninitialized here (gitlink `4c34c831a`, empty directory),
which is also why `implementationDigestWorkingTree` refuses in this worktree.
This same section is appended to both of my dated fork artifacts; the findings
are identical.

### Summary

The delta is inert to both the derived-fork surface and the publication chain's
guarantees, and I verified that rather than taking it on trust. I carry round
9's conclusions forward: **Scope 1 `READY`, Scope 2 `READY` at `fac516e9a`.**

The structural spot-checks the brief asked for turned up one thing that is not
cosmetic, and it is the reason this section is longer than a carry-forward needs
to be: **round 9 does not exist in this repository.** All four verdict histories
at C run `1 … 8` and stop; all four prose artifacts run `## Round 1 … ## Round
8` and stop. The round-9 review happened — `issues/20260807-review-prose-history-
not-frozen.md`, landed at `534d1993b` inside this very delta, attributes itself
to "the Fable round-9 review" — but its artifacts were never committed. I record
this as **R10-1**. It does not change either verdict, and it fails closed, but a
`"round": 10` entry appended to a history that ends at 8 cannot validate, so it
must be resolved before P is built.

### The delta, verified

Over `IMPLEMENTATION_ROOTS` plus the `vendor/ibex` gitlink, `42f699749..fac516e9a`
is **one file**:

```
M  tests/fixtures/client-bundle-metrology/current.v1.json   (20 +, 20 -)
```

confirmed two ways — by `git diff --name-status` restricted to the ten
`IMPLEMENTATION_ROOTS` entries plus `vendor/ibex`, and independently through the
checker's own
`qualifiedImplementationChangesBetween(root, '42f699749', 'fac516e9a')`, which
returns exactly that single `M`.

All twenty changed lines are the same substitution: `lockfileSha256`
`b417f685c10348…` → `ad8a98cbad6584…`, once in the top-level `inputs` block and
once in each of the nineteen baseline entries. I checked that these are the two
lockfile digests and not free-floating values:
`sha256(git show 42f699749:bun.lock)` is `b417f685c10348238e63e527c3b54fcc8695c5a1115f1b11c07243de525e107e`
and `sha256(git show fac516e9a:bun.lock)` is
`ad8a98cbad65849cc8e496a471b0c1ddb7bbf7a6292dd4cceb27a77339ab480d`. So the file
is a mechanical re-pin of a staleness input, exactly as described.

Nothing else in the fixture moved: no `profilesSha256`, no `behaviorCommands`,
no `workloadVersion`, and no measured byte count or threshold. I checked the
premise behind that too, because a re-pin that carries stale measurements
forward would be a real defect even if it is not mine to judge: the `bun.lock`
delta over the same range is twelve added lines and nothing else — the new
`packages/create-snapback-app` workspace entry and its `workspace:*` link to
`@expo/snapback-cli`. No third-party resolution changed, so the client-bundle
measurements could not have moved, and carrying them forward under the new
lockfile digest is honest. Had that not been true it would have been a
client-bundle-metrology defect, not a fork defect; I did not re-measure any
bundle.

The `vendor/ibex` gitlink is `4c34c831aa087d6783b0d68f281cdb374ed7fc89` at both
commits — the same value round 9 recorded at `cdc0fe03e`, `bdc682964`,
`0e778b9a8`, `485efe922` and `17366d2a4`.

### Is it inert to the derived-fork surface? Yes

`git diff 42f699749..fac516e9a` is empty over all of `src/`, over
`llp/0158-instance-forking.rfc.md` and Specs `0163`/`0164`/`0165`, over
`schemas/`, and over both `guide/capabilities.md` and
`guide/operating/instance-forks.md`. The fork sources and suites
(`src/instance_fork.rs`, `src/fork_promotion.rs`, `tests/instance_fork_*.rs`)
are therefore byte-identical to the tree round 9 read, which was itself
byte-identical back to the round-3 dual-family READY commit `cdc0fe03e` for the
five files round 9 enumerated. The changed fixture is client-bundle metrology;
it is consumed by `scripts/client-bundle-metrology.mjs` and
`tests/drift_prone_gates_v0.mjs`, and neither the fork code nor any fork test
nor the publication checker reads it (`grep -n metrology` over
`scripts/check-agent-safe-publication.mjs` and
`tests/agent_safe_publication_checker_v1.mjs` is empty).

### Is it inert to the chain's guarantees? Yes — it moves one value, by design

`scripts/check-agent-safe-publication.mjs`,
`scripts/generated-artifact-policy.mjs`, `tests/agent_safe_publication_checker_v1.mjs`
and `build.rs` are untouched across the delta, so no bound, allowlist, root set
or rule changed. What the delta does change is the value the whole chain is
parameterised by:

```
implementationDigestAt(42f699749) = sha256:d32763a4caf9cd3dc2bea7a603cfdfbef54f991645c9387079bc7b50b1af337a
implementationDigestAt(fac516e9a) = sha256:d49f0353b3d41943f8dbe7ed4560027671c40d6e069dc0af90a6cd12823cc6ea
```

The first value is the one round 9 recorded at its C, which is a useful
cross-check that I am computing the same thing the previous round did. The
second is why C had to move at all, and it is the correct behaviour: a
regenerated fixture inside `IMPLEMENTATION_ROOTS` rotated the digest, the C→P
equality check refused, and the publication was abandoned rather than forced.
That is the gate doing its job, not a defect.

`node --test tests/agent_safe_publication_checker_v1.mjs` at C: **66/66 pass**
(round 8 saw 64, round 9's fixes added two). The self-invalidation loop round 8
found is still broken — recording this round does not turn the suite red,
because nothing under `llp/reviews/` is inside `IMPLEMENTATION_ROOTS`.

### Structural spot-checks at C

**Anchors and the guide row are withheld.**
`src/local-agent-safe-derived-deployment-fork-publication.anchor.json` is
`"state": "withheld"` with `"carrierSha256": null`; the storage anchor is
likewise withheld with a zeroed carrier. The
`guide/capabilities.md` row for `operating.instance-forks` is unchanged and
still says the derived capability "remains unsupported and this source evidence
is not a claim", with the public tuple `Missing` and a `GAP` disposition. The
restoration the brief describes is real in the tree, not just asserted.

**Evidence receipts still bind the old commits — expected in flight.** At C the
fork carrier, receipt and author acceptance all name `qualifiedSourceCommit`
`0ee1fadc1…` with `implementationTreeSha256 sha256:2cad3627…`, and both platform
lifecycle benches name `17366d2a4…`. Per the brief these are being re-minted at
C in parallel, so I record them as in-flight rather than as findings; every one
of these paths is in `PUBLICATION_CYCLE_ALLOWLIST`, so re-minting them between C
and P is permitted and is checked. Round 9's R9-1 (platform receipts binding
`17366d2a4`, not C) is therefore still open and still the orchestrator's to
close.

**Satisfiability is intact.** I did not rebuild round 9's construction, because
nothing it depends on changed: every binding in the chain is parameterised by
the qualification commit and the implementation digest rather than by a literal,
and the only literals — the ratified bounds — live in
`scripts/check-agent-safe-publication.mjs`, which the delta does not touch. I
did re-establish the one thing that could have quietly broken: the storage
record is withheld at C, so `validatePublicationRecord` returns early for it and
never reaches `validateAcceptanceCorpus`; a P that publishes only the fork
record therefore does not need a storage acceptance corpus re-minted at C. And
`runChecker`'s working-tree equality check will hold at P by construction,
because C→P may only touch allowlisted and generated paths, none of which are
`IMPLEMENTATION_ROOTS` leaves.

Two things I could not evaluate here and am not claiming: the Rust fork suites
and the working-tree digest (`vendor/ibex` uninitialized), and `check-guide.mjs`,
which fails in this worktree for provably environmental reasons — no
`node_modules` (`ajv` missing for the control catalog) and three gitignored
demo-generated snippet sources absent. None of those is bound by the derived-fork
evidence contract: `validatePublishedDerivedForkEvidenceSemantics` never reads
`correctness.guide`.

**Histories are internally sound but end one round early.** Running the shipped
`validateDerivedForkReview` at C against all four histories with
`qualificationCommit = fac516e9a`, every one fails with exactly one message —
`authoritative verdict does not name qualification C` — and nothing else. That
is the expected and desired state before this round: it means the prose
bindings, the `previousEntrySha256` chains, the family constancy, the reviewed-
commit ancestry and the round contiguity all pass, and only the head needs to
name the new C. Which brings me to the one real finding.

### R10-1 — Round 9 is absent from every history at C (Material; mechanically blocking at P)

All four `*.verdicts.v1.json` histories at C contain exactly eight entries,
`round` 1–8, head `reviewedCommit` `0e778b9a8`. All four prose artifacts end at
`## Round 8`. There is no round 9 anywhere: I searched all 382 refs in this
repository and all 400 distinct commits reachable from every reflog, and no
version of any of the four sidecars has ever had more than eight entries. The
`llp/reviews/` copies in the primary worktree are older still (six rounds).

Round 9 nevertheless happened. `issues/20260807-review-prose-history-not-frozen.md`
— added by `534d1993b`, *inside this delta* — opens with "Found as R9-2 by the
Fable round-9 review of the derived-fork publication chain", and the deferral
note in it reasons explicitly about the fix rotating the qualification digest.
The design record knows about a round the review record does not contain. That
is precisely the shape of F8-1 (round 7 present in the design record and absent
from the review record), which cost this loop two rounds to repair, and it is
the shape R9-2 warns about: the prose half of the record is the weak link, and
it was repaired last time by people holding transcripts rather than by the gate.

The mechanical consequence is immediate. `validateDerivedForkReview` requires
`entry.round === index + 1`:

```js
requireEvidence(Number.isSafeInteger(entry.round)
  && entry.round === index + 1,
`${verdictPath} rounds are missing, duplicated, or non-monotonic`);
```

so the `"round": 10` entry I was instructed to append — and which I have
appended, because renumbering it to 9 would silently erase a round that
happened, which is the failure mode this loop just filed a ticket about — sits
at index 8 and refuses. I confirmed this against the shipped checker after
writing it; the exact message is quoted in "Verification actually performed"
below. **This is a fail-closed refusal, not a hole:** no false claim can reach
the world through it. But P cannot be built until it is resolved.

The resolution is not mine to apply and I have not invented one. The fable
round-9 record survives outside git, in the orchestrator's session scratchpad as
`round9-section.md` (390 lines, dated 2026-08-07, naming qualification commit
`42f699749`, recording Scope 1 `READY` and Scope 2 `READY`), and a round-9
sidecar exists there too. The correct repair is to splice the genuine round-9
prose section and round-9 verdict entries into all four artifacts ahead of round
10 — for the codex family as well as mine, since its histories have the same gap
— which yields ten contiguous entries with the head naming C. That re-chains my
entry's `previousEntrySha256` onto round 9's digest and re-stamps every entry's
`reviewArtifactSha256` onto the new prose bytes; both are mechanical and the
publication builder already does exactly this on every append. What must not
happen is renumbering round 10 to 9 and letting the record show nine rounds when
ten occurred.

I am not treating this as a Scope 2 blocker. It is a defect in the assembly of
the publication package, not in the code, the evidence, the oracle or the
derived-fork surface; it cannot cause an unsound publication, only a refused
one; and its cause is a commit that was abandoned for good reason, not a
weakening. An honest round-10 `NOT_READY` on these grounds would be a verdict
about bookkeeping that the gate itself already enforces, and would cost the loop
a further round for nothing.

### Carried forward from round 9, unchanged

- **R9-1** — the two platform lifecycle receipts at C bind `17366d2a4`, not C.
  Material, not blocking, closed by the in-flight re-mint.
- **R9-2** — `reviewArtifactSha256` binds the *current* prose artifact, not the
  prose as it stood at each round, so the chain cannot attest what an earlier
  round said. Material, not blocking, now filed as
  `issues/20260807-review-prose-history-not-frozen.md` and deliberately deferred
  to a cycle that needs a new C anyway. R10-1 above is the same weakness showing
  its other face: the chain cannot detect a round that was *removed* from the
  record either.
- The suggestion that the `build.rs` allowlist mirror test be made
  two-directional. Robustness nit; recorded in the same ticket.

### Scope 1 verdict — LLP 0163 / 0164 / 0165 conformance

**`READY` at `fac516e9a` for all three Specs.** This is a delta verdict carried
forward on a delta I verified: the fork sources, the fork suites, the three
Specs, LLP 0158, `schemas/` and the two governing guide pages are byte-identical
between `42f699749` and C, and the only in-scope change is a client-bundle
metrology fixture that no fork code path reads. I did not re-derive spec
conformance from the Specs and could not execute the Rust fork suites here; if
the surface changes, this verdict does not carry.

### Scope 2 verdict — derived-fork publication

**`READY` for publication of the narrow local `operating.instance-forks`
capability at `fac516e9a`,** subject to the P-time steps the checker itself
enforces, and to R10-1 being repaired before P is assembled.

The substance is exactly what round 9 found and nothing in the delta disturbs
it: the oracle is unchanged and green at 66/66, the anchors and the guide row
are withheld in the tree, the digest chain is parameterised rather than
hard-coded, and publication remains satisfiable at this C once the ceremony is
completed. The ceremony is still not mine to supply and a `READY` here does not
supply any of it: both platform lifecycle receipts re-minted at C (R9-1), the
codex family's own round naming C, the round-9 splice (R10-1), and Charlie's new
v2 acceptance binding the four history heads, the exact evidence digest set and
the implementation digest `sha256:d49f0353…`. A publication missing any of them
refuses, which round 9 confirmed by construction and which I did not re-derive.

### Verification actually performed

- `git diff --name-status` and `--stat` for `42f699749..fac516e9a`, whole-repo
  and restricted to the ten `IMPLEMENTATION_ROOTS` entries plus `vendor/ibex`;
  full read of the single in-scope diff.
- `qualifiedImplementationChangesBetween` and `implementationDigestAt` at both
  commits through the shipped module export.
- `sha256` of `bun.lock` at both commits, compared against the twenty
  substituted values; full read of the `bun.lock` delta.
- `git ls-tree` of `vendor/ibex` at both commits.
- Empty-diff confirmation over `src/`, `llp/0158`, `llp/0163`, `llp/0164`,
  `llp/0165`, `schemas/`, `guide/capabilities.md`,
  `guide/operating/instance-forks.md`.
- `node --test tests/agent_safe_publication_checker_v1.mjs` at C — 66 pass, 0
  fail.
- `validateDerivedForkReview` run at C against all four histories with
  `qualificationCommit = fac516e9a`, before my append: all four fail only with
  `authoritative verdict does not name qualification C`.
- The same call against my own two histories after appending round 10:
  `llp/reviews/0163-0165-derived-fork-implementation-2026-08-06.fable.verdicts.v1.json
  rounds are missing, duplicated, or non-monotonic` — and the same for the 0158
  sidecar. That is R10-1, reproduced through the shipped oracle.
- Exhaustive search for round 9: all 382 refs and 400 reflog-reachable commits;
  no sidecar version has ever exceeded eight entries. Primary-worktree copies
  carry six.
- Read of `PUBLICATION_ONLY_PATHS`, `PUBLICATION_CYCLE_ALLOWLIST`,
  `validatePublicationRecord`, `validatePublishedEvidenceSemantics`,
  `validatePublishedDerivedForkEvidenceSemantics`, `validateDerivedForkReview`,
  `validateDerivedForkAuthorAcceptance` and `runChecker` at C; read of the
  anchors, carriers, receipts, author acceptance and both platform benches.
- Not done: `cargo build`/`cargo test` and the Rust fork suites (`vendor/ibex`
  uninitialized), the working-tree digest comparison (same cause), the round-9
  adversarial corpus and satisfiability construction (deliberately not re-run —
  bounded delta round, nothing they depend on changed), and any de-novo
  derivation of spec conformance.

### Recommended next step

Splice the genuine round-9 prose sections and round-9 verdict entries into all
four artifacts ahead of round 10, re-chain, and re-stamp the prose digests; do
not renumber round 10. Then finish the ceremony: re-mint both platform lifecycle
receipts and the fork receipt/carrier/acceptance at `fac516e9a`, take Charlie's
v2 acceptance of the resulting four ten-entry history heads and the
implementation digest `sha256:d49f0353…`, and build P. If the round-9 record
cannot be recovered intact, say so in the gate issue and take a fresh round from
each family rather than closing the gap by renumbering — and either way, R9-2's
frozen per-round prose digest is now the fix that would have made this whole
question answerable by the gate instead of by whoever still has the files.
