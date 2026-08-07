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
