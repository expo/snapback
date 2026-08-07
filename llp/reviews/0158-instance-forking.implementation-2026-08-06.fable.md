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
