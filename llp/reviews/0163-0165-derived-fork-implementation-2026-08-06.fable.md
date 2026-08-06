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
