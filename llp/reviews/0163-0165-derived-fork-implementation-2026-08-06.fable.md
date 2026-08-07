# Review: LLPs 0163/0164/0165 — spec vs. implementation, derived-fork surface (commit 7c2a27e0e)

**Family:** fable
**Provider/runtime:** Anthropic / Claude (Fable 5), Claude Code agent session
**Date:** 2026-08-06
**Redacted:** no
**Method:** fresh clean-context session; read-only worktree pinned at
`7c2a27e0e`; mutually blind (no other 2026-08-06 review artifact or the
codex worktree was read). Claims verified by reading the implementation and
its tests (`src/instance_fork.rs`, `src/storage/write_authority.rs`,
`src/storage/auth_invalidation.rs`, `src/operation_ledger.rs`, `src/storage.rs`,
`src/cli.rs`, `tests/instance_fork_cli_v1.rs`) against the three Specs, LLP
0158, and the guide page. Tests were verified by reading, not executed: this
review worktree has no bootstrapped Ibex runtime (`vendor/ibex` uninitialized,
no `target/`), and the brief authorizes reading with rigor. Every finding
below cites file:line at this commit.

**Scope note:** This review covers only the FORK-RELEVANT surface of each
Spec: 0164's diff surfaces as consumed by the derived deployment, 0165's
journal-completeness choke point as exercised by the fork-local arming, and
0163's non-involvement. The Track B storage-wide acceptance rows (LLP 0162
rows 1–4 and 10–14 beyond the fork legs), the in-app branch/promotion corpus,
and the C27–C33 qualification chain are explicitly NOT reviewed here.

---

## Overall assessment

The implementation is careful, closed, and fail-closed at every seam I
probed; the honest-labeling discipline (downgrade-not-upgrade, refusal codes,
machine-readable absence) is real, not decorative. LLP 0165's 2026-08-06
records describe the landed code accurately in every detail I checked. LLP
0163's non-involvement is genuine and machine-checkable. LLP 0164 — the
declared owner of the diff surfaces — was not revised when the
`snapback.fork-net-diff.v2` receipt and the `authorizer-backed-app-rows-v1`
completeness upgrade landed, so its 2026-08-06 reconciliation record now
misdescribes the current emission on exactly the surface it owns.

**Verdicts (fork-relevant surface only):**

- **LLP 0163 — READY.** Attribution absence is honest, machine-readable, and
  structurally enforced; one stale receipt-version citation (minor).
- **LLP 0164 — NOT READY** until a dated revision records the v2 net-diff
  receipt and the completeness upgrade (or explicitly delegates the receipt
  schema record to LLP 0158). One Medium concern; small fix.
- **LLP 0165 — READY**, with two hardening/precision concerns that do not
  falsify the claim as spelled.

---

## Per-document review

### LLP 0163 (operation identity / commit envelope) — non-involvement

**Verdict: READY (fork-relevant surface).**

What the Spec claims and what the code does:

- The fork-local manifest uses distinct logical lane names
  (`derivedForkOrdinaryAppRowJournal`, `derivedForkHostChildAppRowJournal` —
  `src/operation_ledger.rs:51-57`) activated by a dedicated fork-only cut
  (`activate_derived_fork_app_row_journal_coverage_in`,
  `src/operation_ledger.rs:1262-1281`) whose doc comment states the intent:
  "ordinary fork calls do not acquire or imply an LLP 0163 operation
  envelope" (`src/operation_ledger.rs:1254-1257`).
- The absence is structurally enforced, not just named. With the fork
  manifest armed, `operation_lane_covered("ordinaryMutation")` and
  `("hostChildMutation")` are false (exact string match against covered
  lanes, `src/storage.rs:2444-2453`), so identity-less fork mutations pass
  `require_covered_mutation_identity_for_lane` without needing issuance
  (`src/storage.rs:20336-20376`), and a mutation that *does* present LLP 0163
  issuance on a fork refuses `SNAPBACK_OPERATION_WRITER_IDENTITY_MISMATCH`
  before its first application write (`src/storage.rs:20461-20471`) — the
  fork can never silently mint 0163 envelopes. Tested:
  `src/instance_fork.rs:5626-5636` asserts both 0163 lanes are uncovered on
  an armed fork.
- The fork manifest cannot satisfy the storage-wide 0163 coverage predicate:
  `agent_safe_exact_operation_coverage_active` compares the covered-lane set
  against exactly `{ordinaryMutation, hostChildMutation}`
  (`src/storage.rs:2489-2515`), so fork arming cannot inflate the Track B
  claim; conversely `derived_fork_exact_app_row_journal_coverage_active`
  requires exactly the two fork lanes (`src/storage.rs:2574-2600`).
- The receipt's absence fact is a constant: `attribution: "absent-v1"`
  (`src/instance_fork.rs:3207`), asserted in the module corpus
  (`src/instance_fork.rs:5719`), the executable corpus
  (`tests/instance_fork_cli_v1.rs:2088`), and documented in the guide
  (`guide/operating/instance-forks.md`, "attribution: absent-v1" paragraph).
  Nothing in the receipt implies attribution: rows carry only
  table/rowId/operation/pre/post-image (`src/instance_fork.rs:808-823`), and
  the fork coverage receipt's own doc trail states the lane names "do not
  activate or advertise" 0163 lanes (LLP 0165 lines 380-391, LLP 0158 v2
  receipt section).
- 0163's 2026-08-06 scope correction (lines 999-1004) correctly cedes
  net-diff attribution to LLP 0185 Phase 4 item 8 and disclaims the row-9
  assertion.

**Concern (Low):** 0163 line 1001 names "`snapback.fork-net-diff.v1`" as the
receipt that "does not carry LLP 0163 operation identities today"; at this
commit the emitted receipt is `snapback.fork-net-diff.v2`
(`src/instance_fork.rs:3197`) and no v1-emitting path remains. The statement's
substance (no operation identities) is still true of v2
(`src/instance_fork.rs:3196-3221`). *Resolves:* a one-line dated touch-up
naming v2, ideally alongside the 0164 fix below.

### LLP 0164 (fork and promotion) — diff surfaces, derived legs

**Verdict: NOT READY (fork-relevant surface) — one Medium accuracy defect;
everything else checked out.**

Verified accurate:

- **Row-5 parent-write fixture closure (2026-08-06 record, first bullet).**
  Both named module fixtures exist —
  `derived_fork_keeps_its_pinned_copy_when_parent_writes_after_publication`
  (`src/instance_fork.rs:4145`) and
  `parent_commits_after_the_fork_point_are_invisible_to_the_published_fork`
  (`src/instance_fork.rs:4199`) — and the live-server bidirectional leg is
  real and strong: a hot parent commits after the fork point, the fork never
  sees it, fork writes never reach the parent, and stale cross-credentials
  are refused over live HTTP in both directions
  (`tests/instance_fork_cli_v1.rs:899-1051`).
- **Target-choice delegation (second bullet).** The opt-in retained base
  (`--retain-base`, digest-bound `ForkBaseReceiptV1`,
  `src/instance_fork.rs:3533-3557`) with the substrate named on every receipt
  (`substrate: "retained-base-v1"`, `src/instance_fork.rs:3203`) matches the
  "target's choice, named on the receipt" clause.
- **Asset coverage as a separate diff fact (third bullet).**
  `domains.assets: "omitted"` on every net receipt
  (`src/instance_fork.rs:3216`).
- **The `ForkDiffReceiptV1` naming hazard (second bullet, note).** Still
  true: two distinct Rust types share the name
  (`src/fork_promotion.rs:2702`, `src/instance_fork.rs:758`) and serialize
  different schemas.

**Concern (Medium — the NOT READY driver):** 0164's 2026-08-06
derived-deployment reconciliation states the local target "emits
`snapback.fork-net-diff.v1` with the substrate named on every receipt
(`retained-base-v1`, completeness `journal-enumerated-v1`)" (lines 492-495).
At this commit the implementation emits `ForkNetDiffReceiptV2`
(`schemaVersion: "snapback.fork-net-diff.v2"`, `src/instance_fork.rs:3196-3221`)
whose completeness can be `authorizer-backed-app-rows-v1` and which carries
new `writerCoverage`, `journalConsistency`, and `attribution` receipt facts.
0164 §Purpose assigns the diff surfaces — "attributed change sequence, net
diff, folding rules, substrate naming" — to this Spec and declares "on a §4
divergence the owning Spec per this split is the defect" (lines 108-115).
Commit `4444767cc` updated LLP 0158 (which documents v2 fully, including the
"incompatible replacement" framing) and LLP 0165, but not 0164. The corpus as
a whole is therefore accurate, but the *owning* Spec misdescribes its owned
surface: a reader following the declared ownership split to 0164 gets the
superseded receipt contract. *Resolves:* a dated 0164 revision that (a)
records `snapback.fork-net-diff.v2` and the two completeness spellings, or
(b) explicitly delegates the derived-deployment net-diff receipt schema to
LLP 0158's frozen-schema section and keeps only the substrate/folding
contract here. Either is a small documentation change; no code change is
required.

**Concern (Low):** the CLI projects the fork attributed-sequence receipt and
net receipt through `fork diff` (`src/cli.rs:3846-3851`); 0164's contract
summary describes the attributed sequence as "journal-derived" with sibling
comparison through a common base — for the derived class, sibling comparison
exists only implicitly (two receipts against the same parent cut,
demonstrated in `src/instance_fork.rs:5597-5606`), and 0164 never says which
of its diff clauses bind the derived class versus the in-app branch class.
*Resolves:* fold into the same dated revision — one sentence scoping the §Diff
clauses per fork class.

### LLP 0165 (proof domains / journal completeness) — fork-local choke point

**Verdict: READY (fork-relevant surface).**

I verified the 2026-08-06 record clause by clause against the code:

- **Arming order and window.** `arm_open_derived_fork_app_row_coverage`
  requires a minted derived fork, a file-backed database, and head ==
  fork-point before and after activation (`src/instance_fork.rs:1317-1346`);
  production arming runs on the serving connection after the cold-start pair
  composes and before listener bind (`src/cli.rs:7479-7491`; bind occurs
  later in the same startup sequence). Late arming refuses at the receipt
  level (`src/instance_fork.rs:5906-5912`) and even a directly-activated
  late manifest never upgrades completeness
  (`src/instance_fork.rs:5913-5925`).
- **Dual carriers + re-verification.** Identical receipts in
  `_snapback_meta.instance_fork_app_row_coverage_v1` and
  `fork-app-row-coverage-receipt.json` (`src/instance_fork.rs:1379-1388`);
  one-carrier-only, decode failure, cross-carrier disagreement, profile/
  fork-point/lane-set/digest mismatch, stream drift, manifest inactivity,
  and activation-time mismatch all refuse
  `SNAPBACK_FORK_WRITER_COVERAGE_INVALID`
  (`src/instance_fork.rs:2812-2892`); the self-digest binds exactly the field
  list 0165 names (`src/instance_fork.rs:909-937`). Verification happens
  inside the same read transaction as the head scan
  (`src/instance_fork.rs:2969-2977`), so the receipt cannot describe a
  different moment than the diff.
- **The spelling's semantics.** `authorizer-backed-app-rows-v1` requires
  verified coverage AND `journal-cross-check-verified`
  (`src/instance_fork.rs:3185-3191`); the armed class additionally requires
  the latest covered-journal post-image to equal the independently scanned
  head per touched row (`src/instance_fork.rs:3075-3089`), which is exactly
  the "cannot borrow an earlier legitimate journal entry" clause (0165 lines
  382-384). Retention gap, unarmed, and partial-layout forks stay
  `journal-enumerated-v1` (`src/instance_fork.rs:3134-3135, 3185-3191`;
  `tests/instance_fork_cli_v1.rs:1973-2029`).
- **Authorizer denial.** Direct in-process SQL against a covered table on the
  armed (and re-opened re-armed) connection is denied by SQLite at prepare
  time (`src/storage/write_authority.rs:626-665`, zero-capacity statement
  cache at `:331`; test `src/instance_fork.rs:5637-5647`). Trigger/
  view-mediated covered-table DML is denied even inside a token
  (`write_authority.rs:638-647`), and when armed no writer can acquire
  schema authority because `SchemaActivation`/`MigrationExecutor` are
  `blocked_when_coverage_armed` (`write_authority.rs:224-235, 396-408`).
- **Not the row-4 claim.** The fork lane names cannot satisfy the exact
  storage-wide predicate (`src/storage.rs:2489-2556`) and the Spec's Open
  item 3 correctly keeps default arming and the storage-wide program open.

**Concern (Medium — precision of one sentence, not the claim itself):** the
implementation-evidence sentence "Direct in-process SQL is denied by the
SQLite authorizer; external bypass, base tampering, and coverage-receipt
tampering refuse" (0165 lines 83-86) is true for every *tested* bypass shape
(out-of-band update after a journaled write, unjournaled insert, tampered
base, tampered single carrier — `src/instance_fork.rs:5781-5869, 5929-5987`)
but the external-bypass refusal is detection-based, not preventive: the
journal (`_snapback_changes`), version head (`_snapback_version`), meta
carrier, and coverage tables are outside the authorizer's covered set
(`write_authority.rs:338-346` covers only schema tables), and the receipts'
self-digests are unkeyed SHA-256. A bypass writer that also forges a matching
journal entry and version bump — via a second connection, or via in-process
out-of-token SQL to the uncovered `_snapback_*` tables — would produce an
`authorizer-backed-app-rows-v1` receipt. The normative spelling (0165 lines
374-384) is honest because it scopes itself to "physical writes ... made by
the process-owned SQLite connection ... admitted only under the generated
writer token" plus oracle agreement; the evidence sentence and the guide's
phrasing could be read stronger. *Resolves:* one dated sentence in 0165 (and
optionally the guide) stating the external-bypass property is
tamper-*evidence* against uncoordinated writes, not tamper-*proof* against a
writer that also rewrites the journal; optionally harden (below).

**Concern (Low — authorizer evasion surface for in-process raw SQL):** the
authorizer's catch-all allows everything not explicitly matched
(`write_authority.rs:663`): `PRAGMA writable_schema` plus direct
`sqlite_master` UPDATE (sqlite_master is not in `covered_tables`), `ATTACH`,
and the `CreateTemp*`/`DropTemp*` DDL variants (only the nine non-temp DDL
actions are matched at `write_authority.rs:648-656`; a `CREATE TEMP TABLE
items` would shadow a covered table for the token-holding writer, and a temp
trigger could write uncovered `_snapback_*` tables). All of these require
deliberately evasive in-process SQL — the same trust domain that could call
the C API directly — and unqualified writes to a same-named attached/temp
table are still denied by name matching, so this is hardening, not a claim
falsifier. *Resolves:* when armed, deny `Pragma { writable_schema }`, deny
DML on `sqlite_master`, and extend the schema-change match to the temp
variants; a focused negative per shape.

---

## Suggestions (non-blocking)

1. The retention-gap receipt keeps
   `writerCoverage.coverageWindow: "fork-point-to-observed-head-verified"`
   while completeness downgrades (`src/instance_fork.rs:5768-5777`). The
   window fact describes manifest verification, not journal coverage, but
   "verified" next to a downgraded completeness invites misreading; consider
   a third window spelling for the gap case.
2. Consider covering `_snapback_changes`/`_snapback_version` with an
   authorizer rule that admits them only inside a token or a named system
   writer — this converts the Medium concern above into a prevented shape on
   the process-owned connection.
3. `fork_app_row_coverage_digest` serializes with non-canonical
   `serde_json::to_vec` (`src/instance_fork.rs:912-925`); the same struct is
   re-serialized at verification so it round-trips today, but pinning JCS
   (as the promotion domain does) would remove a future map-ordering hazard.

## Open questions

1. Is there any production code path (beyond `DerivedForkRuntime::deny`'s
   marker writer, `src/instance_fork.rs:1660`, which touches only the egress
   table) that opens a second *writable* connection to a serving fork
   database? I found none, but an exhaustive inventory would let 0165 claim
   the process-owned-connection scope covers the whole process, not one
   connection.
2. Should the fork coverage receipt be authenticated (HMAC under the fork's
   minted keyring) rather than integrity-hashed, so carrier forgery requires
   key custody rather than file access?

## Recommended next step

Land one small dated revision touching 0164 (record v2 + completeness
spellings, scope §Diff clauses per fork class — clears the NOT READY) and
0163/0165 (v1→v2 mention; external-bypass precision sentence). No code
change is required for these verdicts; the authorizer hardening items can be
tracked as an `issues/` ticket.

---

## Round 2 — 2026-08-06, commit 96fd0ad1c

**Family:** fable
**Provider/runtime:** Anthropic / Claude (Fable 5), Claude Code agent session
**Date:** 2026-08-06
**Redacted:** no
**Method:** fresh clean-context session; read-only worktree pinned at
`96fd0ad1c` (`fix(forks): close derived-fork review blockers`). This is a
declared **delta round**: I read both families' round-1 artifacts under
`llp/reviews/`, and remained blind to the other family's round-2 work. I read
the full fix diff (`git show 96fd0ad1c`) and then the resulting code and tests
directly: `src/storage/write_authority.rs`, `src/storage.rs`,
`src/instance_fork.rs`, `src/cli.rs`, `src/server.rs`, `src/proof_checkpoint.rs`,
`src/fork_promotion.rs`, `src/operation_ledger.rs`, and
`tests/instance_fork_cli_v1.rs`, against LLP 0158/0163/0164/0165 and the guide
page. Tests were read for non-vacuity, not executed (`vendor/ibex`
uninitialized; no `target/`). Every cite is file:line at this commit.

### Disposition of the round-1 blockers (fork-relevant surface)

**Blocker 2 — authorizer bypasses below the DML/DDL surface: CLOSED, and the
class name honestly narrowed.** The authorizer is now allow-list shaped: an
explicit `Allow` arm for `Read`/`Select`/`Function`/`Transaction`/`Savepoint`/
`Recursive` and a terminal `_ => Deny`
(`src/storage/write_authority.rs:803-809`), so a future `AuthAction` variant
fails closed. Each named round-1 escape is closed:

- `PRAGMA writable_schema` and every non-allow-listed pragma deny
  (`write_authority.rs:763-802`), and `SQLITE_DBCONFIG_DEFENSIVE` is set **and
  read back** on every armed writable connection before the manifest becomes
  visible (`write_authority.rs:349-351, 396-399, 813-821`) — so the
  schema-alias route is blocked twice.
- `sqlite_schema`/`sqlite_master`/temp-schema-alias DML has its own arm
  (`write_authority.rs:700-710`); `ATTACH`/`DETACH`, all eight `*Temp*` DDL
  variants, `CreateVtable`/`DropVtable`, `Reindex`, `Analyze`, and `Unknown`
  deny unconditionally (`:748-762`); `AlterTable` joined the token-gated DDL
  arm (`:741`).
- Matching-journal forgery is closed: `_snapback_changes` and
  `_snapback_version` are now their own protected class requiring an
  app-write token (`write_authority.rs:664-667, 711-721`), and
  `permits_app_write` no longer accepts *any* live token — only the four
  envelope-mapped adapters plus always-rolled-back `DryRun`
  (`:176-189, 306-311`). Uncovered non-system tables (including tables created
  before arming) now deny while armed (`:722-732`).
- Second connections are now constructed through one factory that
  reconstructs the durable manifest, verifies defensive mode, installs the
  same policy, and holds a system-only lane token
  (`src/storage.rs:10709-10769`); the vector quarantine writer was converted
  (`:10825-10840`), as were the fork lifecycle and egress-marker writers
  (`src/instance_fork.rs:3024-3027`, `:2013-2016`).

The tests are adversarial, not happy-path:
`llp0165_armed_connection_is_defensive_default_deny_and_schema_alias_safe`
(`src/storage.rs:27256-27371`) exercises writable_schema, both schema aliases
with a positive "name is still `items`" assertion, ATTACH, DETACH, three temp
DDL shapes, ordinary DDL, covered-table rename, a pre-arm unknown table,
savepoint-wrapped raw DML, and both journal/version forgeries, each asserting
SQLite's `AuthorizationForStatementDenied`;
`llp0165_registered_second_writer_uses_connection_local_defensive_authority`
(`src/storage.rs:27373-27461`) proves the second connection admits its system lane, denies
app and journal DML, and — the sharp case — that holding a *primary* ordinary
token does not leak authority to it.

Attacks I constructed that still succeed are all outside the boundary the
Spec now states explicitly (`llp/0165-…spec.md:405-417`): `sqlite3_blob_write`
never reaches the authorizer (no prepare); in-process code can call
`conn.authorizer(None)` or `set_db_config(DEFENSIVE,false)`; raw file/WAL
writes are cross-process. 0165 names exactly these and says no receipt may be
called tamper-proof against them. Two residues *inside* the boundary are
noted as new findings N3 and N4 below; neither reaches an application row.

**Blocker 3 — receipt identity and the "attributed" misnomer: CLOSED.** Both
surfaces are now v3 with `(base, head]` stream-qualified boundaries
(`src/instance_fork.rs:904-931, 994-1014`; boundaries derived and
stream-rotation-refused at `:3273-3312`), `attribution: "absent-v1"` on both
(`src/instance_fork.rs:3451`, `:3988`), and a JCS-canonical, domain-separated SHA-256 over every
emitted fact with `receiptDigest` excluded from its own preimage
(`:1124-1159`). The naming is repaired end to end: the journal surface is
`snapback.fork-journal-diff.v3`, the CLI summary field became
`journalRowCount` (`src/cli.rs:3819`), and the `--net` help and guide no
longer say "attributed" (`src/cli.rs:1720-1729`;
`guide/operating/instance-forks.md` "Read the diff at its real boundary").
`diff_receipt_v3_digests_are_domain_separated_canonical_and_bind_every_fact`
(`src/instance_fork.rs:6738-6846`) pins two golden digests, asserts the two
domains cannot collide, and tampers **every** top-level field of both
receipts asserting the digest moves — non-vacuous.

**Blocker 4 (net-diff half) — unbounded work: CLOSED.** Journal rows, base
and head scan rows, and cumulative bytes are metered per row *during*
streaming before any map grows (`src/instance_fork.rs:3573-3643, 3747-3752,
3829-3844`), with WAL bytes seeded from bounded raw-WAL validation
(`:3715`), and a separate output-row bound after folding (`:3884-3897`). The
corpus proves refusal on unchanged, revert-heavy, and byte-heavy inputs and
asserts the reported `limitKind`/`scannedRows` (`:6978-7090`).

### Per-document verdicts (fork-relevant surface)

#### LLP 0163 — **READY** (unchanged from round 1; my Low is fixed)

The round-1 stale-version citation is repaired and correctly widened: the
scope correction now names both v3 receipts and keeps the LLP 0185 Phase 4
item 8 deferral (`llp/0163-…spec.md:998-1006`). Non-involvement remains
structurally enforced — fork lanes cannot satisfy the storage-wide predicate
(`src/storage.rs:2489-2515`), a fork mutation presenting 0163 issuance still
refuses before its first write (`:20461-20471`).

#### LLP 0164 — **READY** (round-1 NOT READY driver cleared)

The dated receipt-evolution record now matches reality at this commit:
`snapback.fork-net-diff.v3`, stream-qualified boundaries, the canonical
digest, and `registered-connection-defensive-app-rows-v1`
(`llp/0164-…spec.md:8, 495-512`). I checked the one *new* claim it makes — that
the in-app branch's `ForkDiffReceiptV1` is "genuinely attributed" — and it is
true: that receipt carries `AttributedChangeV1 { operation_identity,
principal_id, write_ordinal, … }` (`src/fork_promotion.rs:2682-2721`), unlike
the derived surface. The naming-hazard note was replaced correctly (the two
Rust types no longer share a name).

*Residual (Low, unchanged from round 1, non-blocking):* 0164 still never says
which of its §Diff clauses bind the derived class versus the in-app branch
class. Fold one sentence into the next dated revision.

#### LLP 0165 — **READY** (fork-relevant surface)

I re-verified the revised text clause by clause and found no overclaim. The
spelling rename to `registered-connection-defensive-app-rows-v1` is exactly
what the code computes (`src/instance_fork.rs:3958-3964`), and it still
requires *both* a verified coverage receipt and `journal-cross-check-verified`.
The new boundary paragraph (`llp/0165-…spec.md:405-417`) is the strongest
piece of honest labeling in this slice: it names page-level unauthenticity and
the coordinated app-row/version/journal forgery as *outside* the class rather
than implying prevention. My round-1 Medium ("the evidence sentence reads
stronger than the normative spelling") is resolved by that paragraph plus the
narrowed evidence sentence (`:76-92`); my round-1 Low (PRAGMA/sqlite_master/
ATTACH/TEMP hardening) is implemented.

*Concern (Low — internal asymmetry, defense-in-depth only):*
`permits_schema_catalog_write` admits `sqlite_schema` DML whenever
`internal_schema_maintenance` is held, for **any** target
(`src/storage/write_authority.rs:321-327`), whereas the DDL arm restricts
internal maintenance to `_snapback_`-owned targets
(`:313-319, 823-836`). Only verified defensive mode stops a covered-table
rename during an internal-maintenance window today. *Resolves:* pass
`internal_schema_target` into the catalog-write predicate too.

*Concern (Low — 0165's own digest is the odd one out):*
`fork_app_row_coverage_digest` still uses non-canonical `serde_json::to_vec`
(`src/instance_fork.rs:1074-1101`) while its two new neighbours use
`crate::rqs::jcs` (`:1104-1152`). It round-trips today; pinning JCS removes a
future map-ordering hazard and makes the three digests one story.

### New findings in the fix slice (severity · cite · resolution)

The two High findings are implementation regressions, not Spec defects — they
do not falsify 0163/0164/0165's text. They are recorded in full in the
companion Scope-2 artifact
(`llp/reviews/0158-instance-forking.implementation-2026-08-06.fable.md`,
Round 2, findings N1 and N2) and summarized here because they change the
Scope-2 verdict, not these three:

1. **High — `fork renew` fails and wedges an armed fork.** `apply_renewal`
   opens a registered writer on the live fork database and then runs
   `PRAGMA wal_checkpoint(FULL)` (`src/instance_fork.rs:3024-3032`,
   `:1351-1357`), which the new deny-by-default pragma arm refuses
   (`src/storage/write_authority.rs:763-802`) — after the lineage `UPDATE`
   has autocommitted.
2. **Medium — journal retention pruning is denied on every armed fork.**
   `prune_change_journal` deletes from `_snapback_changes` with no writer
   token (`src/storage.rs:3213, 3272-3275`), which the new integrity-table
   arm now refuses (`write_authority.rs:711-721`).

Two documentation-side findings do belong here:

3. **Low — the guide overstates the journal receipt's bounds.** It now says
   "Both surfaces are work-bounded: journal rows, net base/head scanned rows,
   WAL validation bytes, and streamed bytes are checked during streaming"
   (`guide/operating/instance-forks.md`, "Read the diff at its real
   boundary"). For `--net` that is exact. For the default journal receipt,
   `diff_receipt_bounded` checks a `COUNT(*)` *before* materializing and has
   no byte budget at all (`src/instance_fork.rs:3374-3431`), so 100k rows of
   arbitrarily large `row_json` still materialize. *Resolves:* either meter
   bytes on that path too, or say the journal surface is row-count-bounded
   pre-materialization.
4. **Low — the receipt digest ships without a way to check it.** Nothing
   reads a `receiptDigest` back, no CLI verb recomputes one, and neither 0164
   nor the guide states the preimage recipe (domain string, drop
   `receiptDigest`, JCS). A reviewer binding approval per LLP 0185 Phase 4
   currently has to read Rust to reproduce it. *Resolves:* publish the recipe
   in the guide, or add `fork diff --verify FILE`.

### Suggestions (non-blocking)

- The retention-gap `coverageWindow` spelling suggestion from round 1 is now
  effectively moot in production because of finding N2 (an armed fork can no
  longer prune, so it cannot reach a retention gap). Fix N2 first, then
  revisit.
- The registered-writer factory is a convention enforced by review, not by
  the type system: `Connection::open` remains callable. A
  `#[deny]`-style lint, a wrapper module boundary, or at minimum a test that
  greps for writable opens outside the factory would make 0165's
  "every additional process-owned writable connection joins the same
  authority seam" (`llp/0165-…spec.md:76-82`) executable rather than
  aspirational.

### Recommended next step

Accept LLP 0163, 0164, and 0165 for this fork-relevant publication surface —
the three specs now describe the landed code accurately, and the boundary
paragraph in 0165 is the honest one. Hold the *publication* on the two
implementation regressions in the companion artifact; they are ordinary bugs
with small fixes (allow the non-mutating maintenance pragmas on armed
connections or checkpoint before installing the authorizer; give the journal
prune a system-lane token) plus the two tests that would have caught them: a
renew of an armed complete-pair fork, and one maintenance sweep against an
armed fork.

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
three new slices as diffs (`5d1f6aab9`, `73af11d4e`, `0ee1fadc1`) and then the
resulting code directly: `src/storage/write_authority.rs`, `src/storage.rs`,
`src/operation_ledger.rs`, `src/instance_fork.rs`, `src/cli.rs`,
`src/proof_checkpoint.rs`, `tests/instance_fork_cli_v1.rs`, against LLP
0158/0163/0164/0165 and `guide/operating/instance-forks.md`. Tests were read
for non-vacuity, not executed (`vendor/ibex` uninitialized, no `target/`).
Every cite is file:line at this commit.

### Re-verdicts (fork-relevant surface)

| Document | Round 2 | Round 3 |
| --- | --- | --- |
| LLP 0163 | READY | **READY** (unchanged; untouched by these slices and still accurate) |
| LLP 0164 | READY | **READY** (untouched; its delegation still holds — see nit R3-7) |
| LLP 0165 | READY (fable) / NOT READY (codex) | **READY** — the codex continuity exploit is closed and 0165's revised text describes the closure accurately, with one precision nit (R3-1) |

### The codex manifest-continuity exploit — reconstruction attempts

I tried to rebuild the round-2 codex chain (delete the durable manifest →
open an unarmed registered writer → forge a matching app row / `_snapback_version`
/ `_snapback_changes` → restore the exact manifest → re-earn
`registered-connection-defensive-app-rows-v1`) and four variants of it. All
fail closed inside the class the Spec names.

- **Step 1 is now denied.** `_snapback_operation_coverage_v1` and
  `_snapback_operation_coverage_continuity_v1` are their own protected class
  (`src/storage/write_authority.rs:697-700, 733-742`); while armed, only an
  `OperationLedger` token may touch them
  (`permits_coverage_carrier_write`, `:336-338`). No registered-writer purpose
  maps to that lane (`src/storage.rs:11087-11097` — `BranchRegistry`,
  `AdminControl`, `VectorIndex` only), so no registered writer can reach it.
- **Step 2 is now fail-closed rather than fail-open.**
  `registered_writer_coverage_manifest` (`src/storage.rs:10878-11061`) requires
  agreement between the database receipt, the file receipt, the active stream,
  the active manifest, the `continuous` continuity row, and the absence of the
  gap sidecar; every contradiction routes through
  `break_registered_writer_coverage` (`:10821-10876`), which writes the durable
  gap file and flips the continuity row to `broken` **before** returning `Err`.
  There is no path that returns an unarmed-but-tokened writer on a database
  that carries fork coverage evidence, which also closes my round-2 N3.
- **Step 4 cannot re-arm.** `register_coverage_in` refuses a non-advancing
  manifest version and refuses outright once continuity is `broken`
  (`src/operation_ledger.rs:586-606`), and `verified_fork_app_row_coverage`
  now requires the continuity row to exist, be `continuous`, and match the
  fork-point receipt's version and digest (`src/instance_fork.rs:3686-3706`),
  refusing `SNAPBACK_FORK_WRITER_COVERAGE_GAP` otherwise. It also short-circuits
  on the gap sidecar first (`:3632-3636`), so a partial break (sidecar written,
  continuity update lost) still refuses rather than silently re-awarding —
  I looked for exactly that divergence and it is covered.
- **Variant A — do it with the `OperationLedger` token.** An in-crate holder
  of that token can delete both carriers, and `_snapback_meta` DML is admitted
  by the system-table arm (`write_authority.rs:779-786`), so the database-side
  coverage receipt can go too. The next registered-writer open then reads
  `(None, Some(file))` and breaks with `fork-coverage-database-receipt-missing`
  (`src/storage.rs:10957-10980`). To reach `Ok(None)` — the only unarmed exit —
  the attacker must also delete the fork-local receipt *file*, which is
  filesystem access, explicitly outside the class 0165 names
  (`llp/0165-…spec.md:442-447`).
- **Variant B — never open a second writer; mutate through the armed primary.**
  The primary's in-memory authority still holds the old manifest, so app-row
  DML without a token is still denied; `refresh_writer_authority_manifest`
  now routes through the same validator (`src/storage.rs:2424-2429`), so it
  cannot produce an unarmed window either.
- **Variant C — exact restore, byte for byte.** Even with an identical manifest
  row restored, the activation-time cross-check
  (`src/instance_fork.rs:3707-3720`) and the monotonic continuity row both have
  to agree; the continuity row is the fact the restore cannot reach without
  first passing through a `broken` transition.

**The committed negative proves what it claims.**
`registered_manifest_gap_and_exact_restore_cannot_reearn_completeness`
(`src/instance_fork.rs:8097-8217`) does three separate things: it proves a
registered writer is denied the manifest delete; it then *labels* the gap
simulation as out-of-class (a raw `Connection::open`) rather than pretending it
is in-class, and proves the next registered factory refuses with
`SNAPBACK_FORK_WRITER_COVERAGE_GAP` and writes the sidecar; and it performs the
full matching app/version/journal forgery plus exact manifest restore and
proves `net_diff_receipt` still refuses. The honesty of the middle step is the
right call — it is the only way to test the poisoning behaviour, and the
comment says so. What it does *not* prove is that no in-class route exists to
create the gap; that follows from the authorizer arms above, which are proven
separately at `src/storage.rs:27948-27960`.

### Codex round-2 finding 2 (post-allocation scan bytes) — closed in kind

`preflight_app_row_work` (`src/instance_fork.rs:4255-4301`) charges from
borrowed `ValueRef`s before any owned decode, `observe_scan` refuses first
(`:4193-4194`), and `verify_bounded_row_serialization` (`:4458-4488`) re-checks
the realised serialization against the same per-row bound through a counting
writer. Text escaping, blob hex expansion, vector decode, and JSON parse each
have an explicit multiplier. The new fixture proves refusal from borrowed
lengths for oversized text, blob, and vector values
(`:7639-7736`). One residual precision concern is R3-2 below.

### New findings in the round-3 slices

1. **R3-1 (Low — one sentence reads stronger than the authorizer).** 0165 now
   says "Exact coverage activation is the only manifest/continuity transition
   admitted under the operation-ledger token"
   (`llp/0165-…spec.md:416-419`). The authorizer admits *any* `Insert`/`Update`/
   `Delete` on both carriers to an `OperationLedger`-token holder
   (`src/storage/write_authority.rs:336-338, 733-742`); monotonicity is
   enforced by `register_coverage_in`
   (`src/operation_ledger.rs:569-607`), a code path, not by the policy. The
   surrounding conclusion ("deleting the manifest … and restoring identical
   bytes cannot re-earn this class") is still true, because the file receipt
   and gap sidecar carry it. *Resolves:* one clause — "the operation ledger is
   the only lane admitted to those carriers, and its only production
   transition is the monotonic activation in `register_coverage_in`".
2. **R3-2 (Low — the JSON preflight multiplier is not conservative, and is
   untested).** `manifest_value_work_bound` charges `bytes.len() * 8 + 2` for a
   `FieldType::Json` value before `serde_json` parses it
   (`src/instance_fork.rs:4335-4348`). For number-dense input the parsed
   representation is larger than that: `[0,0,0,…]` of *n* bytes yields ≈ n/2
   `Value`s in a `Vec<Value>`; `size_of::<serde_json::Value>()` is 32 bytes on
   64-bit, so the array alone is ≈16 n bytes before `Vec` growth slack, against
   an 8 n charge — a 2–4× under-charge of the declared in-flight bound. The
   vector arm has the same shape at a smaller factor (`bytes.len() + 40/dim`,
   `:4349-4372`, versus 8 bytes of `f64` plus a 32-byte `Value` per dimension
   plus growth slack). The new fixture covers text, blob, and vector but no
   JSON column (`:7639-7736`), so the multiplier is unproven either way.
   *Resolves:* raise the JSON factor (or parse into a bounded reader as the
   serialization side already does) and add one number-dense JSON row to the
   fixture. This is a constant-factor accounting precision item on a dev
   surface, not a re-opening of the codex finding.
3. **R3-7 (Low — 0164 nit, non-blocking, verdict unchanged).** 0164's receipt
   record enumerates the class outcomes as "unarmed, late-armed, or
   retention-gap forks fail closed to `journal-enumerated-v1`"
   (`llp/0164-…spec.md:506-509`). Since `73af11d4e` there is a fourth outcome
   it does not name: a registered-writer continuity gap *refuses* with
   `SNAPBACK_FORK_WRITER_COVERAGE_GAP` rather than downgrading. 0164 explicitly
   delegates class semantics to 0165 in the same paragraph (`:511-513`) and
   0165 names the refusal (`llp/0165-…spec.md:452-454`), so the corpus is
   accurate and 0164 stays READY. Fold the fourth outcome in whenever 0164 is
   next touched, alongside my still-open round-1/2 Low (which §Diff clauses
   bind the derived class versus the in-app branch class).

### Round-2 residuals, re-checked

- **Guide overstates the journal receipt's bounds (round-2 Low 3): CLOSED**,
  and closed the honest way rather than by widening the claim — the guide now
  says "The default journal receipt pre-counts and bounds rows before
  materialization; it does not have a byte-work budget"
  (`guide/operating/instance-forks.md:378-380`).
- **Receipt digest shipped without a way to check it (round-2 Low 4): CLOSED.**
  The guide publishes the exact recipe — drop `receiptDigest`, JCS, prefix with
  `snapback:fork-journal-diff-receipt:v3\n` or
  `snapback:fork-net-diff-receipt:v3\n`, SHA-256, `sha256:<64-hex>`
  (`guide/operating/instance-forks.md:340-348`) — and it matches the code
  byte for byte (`src/instance_fork.rs:1152-1187`).
- **`permits_schema_catalog_write` asymmetry (round-2 Low): NOT addressed.**
  Still admits `sqlite_schema` DML for any target under
  `internal_schema_maintenance`, while the DDL arm restricts internal
  maintenance to `_snapback_`-owned targets
  (`src/storage/write_authority.rs:328-334`). Unchanged severity;
  defence-in-depth only.
- **`fork_app_row_coverage_digest` is not JCS (round-2 Low): NOT addressed**
  (`src/instance_fork.rs:1103-1130`). I am downgrading this to a note rather
  than a concern: the preimage is a `json!` literal, and without serde_json's
  `preserve_order` feature the backing map is a `BTreeMap`, so key order is
  already deterministic. Pinning JCS remains a consistency improvement, not a
  hazard.

### Recommended next step

Accept LLP 0163, 0164, and 0165 for this fork-relevant publication surface.
The codex round-2 blocker is genuinely closed rather than argued away, the
continuity carrier is the right shape (monotonic, irreversible, checked at
both writer construction and receipt time), and 0165's revised text is accurate
modulo one clause. R3-1, R3-2, and R3-7 are all one-paragraph or one-fixture
items that can ride the next dated touch; none of them blocks acceptance.

## Round 4 — 2026-08-06, re-qualification delta 0ee1fadc1..0b8b0ff71

**Family:** fable
**Provider/runtime:** Anthropic / Claude (Fable 5), Claude Code agent session
**Date:** 2026-08-06
**Redacted:** no
**Method:** fresh clean-context session; read-only worktree pinned at
`0b8b0ff71`, blind to the codex family's round-4 work. Declared **bounded
delta round**: I read rounds 1-3 of both families, then read only the in-scope
diff `0ee1fadc1..0b8b0ff71` over the qualification digest's own scope
(`Cargo.toml Cargo.lock build.rs .gitmodules src packages/snapback-codegen
packages/snapback-contract tests scripts/check-agent-safe-publication.mjs
scripts/generated-artifact-policy.mjs`). Nothing was built or committed. Every
cite is file:line at `0b8b0ff71`. My companion Scope-2 artifact
(`0158-instance-forking.implementation-2026-08-06.fable.md`) carries the full
delta analysis; this section states only what bears on 0163/0164/0165.

### The delta does not reach the specifications

No LLP text changed in the in-scope diff — `llp/` is not in
`IMPLEMENTATION_ROOTS` at all
(`scripts/check-agent-safe-publication.mjs:38-49`), and I confirmed that
0163, 0164 and 0165 are byte-identical between the two commits.

More importantly, the code these specs govern is also byte-identical.
`src/fork_promotion.rs`, `src/branches.rs`, `src/storage/write_authority.rs`,
`src/operation_ledger.rs` and `src/cli.rs` do not appear in `git diff
--name-only 0ee1fadc1..0b8b0ff71 -- src`. The operation-identity and
commit-envelope surface (0163), the fork/promotion surface (0164), and the
proof-domain, checkpoint and continuity-carrier surface (0165) are unchanged.

I read `src/storage.rs` closely, since the write authority and the
registered-connection completeness class sit on it. Its whole delta is
clippy-shaped and behavior-preserving: `#[cfg(test)]` on
`captured_effect_intents` (`:2164`, sole caller is inside `mod tests`, which
opens at `src/local.rs:30958`; production readers use
`fork_promotion::captured_effect_intents` directly), deletion of two dead
`LocalDatabase` pass-throughs to `foreclose_branch_operation_admission` /
`retain_committed_branch_mutation` (the free functions and their callers are
untouched), two `if a { if let … }` → `if a && let …` collapses at
`:5443-5450` and `:6782-6789` (identical short-circuit; the canonical-mutation
admission call is reached under exactly the same conditions), and two
`#[allow(clippy::too_many_arguments, reason = …)]` attributes. Nothing the
completeness class depends on moved.

The one fork-adjacent behavioral line in the delta strengthens 0165 rather
than weakening it: `SNAPBACK_FORK_WRITER_COVERAGE_GAP` — the refusal 0165 §
requires of a registered writer that observes a discontinuous boundary — is
added to the server-invariant 500 class at `src/server.rs:42058`. The constant
and its producer already existed (`src/instance_fork.rs:43`); this closes a
"missing from the reviewed HTTP table" gap, so the code's projection now
matches the spec's vocabulary.

### Re-verdicts

| Document | Round 3 | Round 4 (re-qualified tree at `0b8b0ff71`) |
| --- | --- | --- |
| LLP 0163 | READY | **READY** (carries forward unchanged; neither the spec nor `src/operation_ledger.rs` is in the delta) |
| LLP 0164 | READY | **READY** (carries forward unchanged; `src/fork_promotion.rs` and `src/branches.rs` are not in the delta) |
| LLP 0165 | READY | **READY** (carries forward; the only fork-adjacent change registers `SNAPBACK_FORK_WRITER_COVERAGE_GAP` in the server refusal table, which brings the code closer to the spec) |

The round-3 nits R3-1, R3-2 and R3-7 are untouched by this delta and remain
open as one-paragraph items; none of them blocks.

### One Scope-1-adjacent note

The publication oracle now reads review verdicts from the *final* `## Round N`
section only (`scripts/check-agent-safe-publication.mjs:1264-1268`), and
accepts a spec verdict as a table row matching `^\| LLP 0163
\|[^\n]*\bREADY\b[^\n]*\|$` (`:1308-1316`). My round-3 row for 0165 is
`| LLP 0165 | READY (fable) / NOT READY (codex) | **READY** — …` (`:535` of
this file) — a row containing the literal text `NOT READY` that the regex
accepts. The oracle should anchor on the verdict cell rather than matching
`READY` anywhere in the row. Filed in full as R4-3 in my Scope-2 artifact;
it does not change any verdict above.

### Verdict

**Scope 1: READY for LLP 0163, LLP 0164 and LLP 0165 at `0b8b0ff71` — the
rounds 1-3 spec verdicts carry forward unchanged.**

The re-qualification blocker I found lives entirely in the publication chain
(the derived-fork receipt literals now embedded inside the qualified
implementation digest, and the dropped C-side digest conjunct in the narrowed
oracle), not in these three specifications or the code they govern. See
`llp/reviews/0158-instance-forking.implementation-2026-08-06.fable.md`
round 4, findings R4-1 and R4-2.

### Recommended next step

Keep 0163/0164/0165 Accepted. Nothing in this delta asks for a spec
amendment. Land the two publication-chain fixes and re-qualify; these three
documents need no further review round for that to proceed.

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
