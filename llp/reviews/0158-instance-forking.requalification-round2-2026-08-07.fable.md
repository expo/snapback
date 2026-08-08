# Review: derived-fork requalification round 2 (delta), commit 622d61b9f

**Family:** fable
**Provider/runtime:** Anthropic / Claude (Fable 5), Claude Code agent session
**Date:** 2026-08-07
**Redacted:** no
**Reviewed commit (round-2 qualification C):**
`622d61b9f29c18bdab3e4f0b23fa9de085eb3161`
**Implementation tree SHA-256 (v3 scoped):**
`sha256:f4c68ebfc0209659da01c91b30b82d2d54004e746e6683530778dc4f5413d612`
**Digest version:** `snapback:agent-safe-implementation-tree:v3`
**Scope at this C:** roots `src`; files `.gitmodules`, `Cargo.lock`,
`Cargo.toml`, `build.rs`, `scripts/check-agent-safe-publication.mjs`,
`scripts/generated-artifact-policy.mjs`,
`scripts/local-proof-selection-policy.v1.json` (newly in scope),
`vendor/ibex` (gitlink)

**Method:** declared **delta round** on my round-1 head
(`review-fable.requalification-2026-08-07.md`, READY with F1/F2 Medium,
F3 Med-Low, F4–F6 residue). I did not read the codex review; the three
blockers were restated neutrally in the commission. I read the complete fix
delta `336a605bc..622d61b9f` on the scoped surface, re-derived the digest
with this C's own checker, and re-ran the Node suite. No Rust execution is
possible in this worktree (no bootstrapped runtime); the two new
`instance_fork.rs` barrier tests and the 52/52 module run are
**supervisor-supplied execution evidence**, relied on explicitly below.

**Commit identity note.** The commission names fix commits `236545215` and
`ed21704ef`; the commits on this branch are `3fbbbed7d` and `622d61b9f`. I
compared `git patch-id --stable` for both pairs: identical
(`19f499eb…` and `9cda6060…` respectively) — the named commits are the same
changes pre-rebase. No content discrepancy.

---

## Execution evidence produced in this worktree

- `implementationDigestAt(root, 622d61b9f, DERIVED_FORK_IMPLEMENTATION_SCOPE)`
  = `sha256:f4c68ebfc0209659da01c91b30b82d2d54004e746e6683530778dc4f5413d612`
  — matches the commissioned digest exactly, recomputed with this C's own
  checker after confirming the scope constant now carries the policy file.
- `node scripts/check-agent-safe-publication.mjs` on the clean tree:
  `agent_safe_storage_v1:withheld`,
  `agent_safe_derived_deployment_fork_v1:withheld` — correct posture.
- `node --test tests/agent_safe_publication_checker_v1.mjs`: **90/90 pass**
  (was 76; the 14 new fixtures are the blocker negatives).
- Scoped-surface delta enumerated: exactly
  `scripts/check-agent-safe-publication.mjs`,
  `scripts/generated-artifact-policy.mjs`, `src/instance_fork.rs` changed;
  `Cargo.*`, `build.rs`, `.gitmodules`, the `vendor/ibex` gitlink, and the
  policy file itself are byte-identical to round-1 C. Besides the two fix
  commits, the only scoped-surface commit is `c89024abe`, whose changes to
  the two scripts I verified line-by-line to be **comment/prose only**
  (LLP 0189 annotations; no executable change).

---

## (a) Are the three blockers closed to a blocking-fixed bar?

### Blocker 1 / my F2 — canonical receipt scope: CLOSED

`validateReceiptShape` now refuses a derived-fork v3 receipt whose
`implementationScope` is not canonically deep-equal to
`DERIVED_FORK_IMPLEMENTATION_SCOPE`
(`scripts/check-agent-safe-publication.mjs:1145-1148`), and the refusal
sits at receipt-shape time — line 2165 in `validatePublicationRecord`,
before digest computation, snapshot evaluation, and
`validatePublishedEvidenceSemantics` (line 2225) — so no review or evidence
authority is granted to a rogue-scope receipt. `canonicallyEqual` is a
key-sorted deep compare with no field dropped, so it cannot be satisfied by
a same-leaves-different-declaration scope (the round-1 fixture already
proved those digest differently; now they cannot even reach digesting).
The author-acceptance contract is bumped to
`snapback.derived-fork-author-acceptance.v3` with **explicit**
`implementationScope` and `residualV2DepartingClass` keys under
`exactKeys`, each required to deep-equal both the receipt's scope and the
canonical constant — exactly the "legible, not transitive" binding my F2
asked for. Negatives exist and run green: scope-drop, root-drop, and
scope-substitution receipts each refuse with
`receipt scope does not equal the canonical derived-fork scope`, plus one
acceptance-side negative each for scope and residual-class drift. This is
the bar I set in F2, met in full.

### Blocker 2 / my F1 — transfer-input closure: CLOSED, twice over

Two independent closures, either of which would have satisfied F1:

1. **The policy file is in the digest scope.** Any post-C edit to
   `scripts/local-proof-selection-policy.v1.json` is now a scoped change:
   the new fixture proves a tampered policy at P flips the snapshot to
   `invalid` with
   `scoped surface changed without requalification: M:scripts/local-proof-selection-policy.v1.json`.
   The D-4 input-closure sentence is now literally satisfied — the
   semantics-affecting input is closed over by the digest.
2. **The four admitted gate definitions are frozen in-checker.**
   `DERIVED_FORK_ADMITTED_COVERAGE_GATES` mirrors the exact reviewed
   registry entries (records, recordPaths, triggerRules, regenerate
   commands), and `assertCoverageTransfers` now requires the live policy
   entry to be canonically equal to the admitted constant — arbitrary
   nonempty prose no longer passes — plus `gateRecordsExistAtHead` (record
   paths must exist as regular-file blobs, mode `100xxx`, in the committed
   tree at HEAD — symlinks and working-tree-only files refused) plus a
   trigger-rule match for each departing leaf (record-path match alone no
   longer counts as coverage, which is *stricter* than round 1; I checked
   all nine leaves match their gate's triggers). The tamper negatives I
   asked for exist at both levels: gate deletion, record/trigger remap, and
   `regenerateCommand: 'true'` each refuse in `assertCoverageTransfers`
   *and* invalidate a published claim in the post-C fixture.

The deliberate consequence is a fail-closed sync tripwire: any legitimate
edit to one of the four gate entries now reds the checker until the
in-checker mirror is updated in the same change, which rotates the claim
digest and forces requalification — that is the stated design ("rotating
both authorities through requalification"), and it cannot fail open.

### Blocker 3 (new) — conflicting-ID first-publication race: CLOSED

The codex finding was real and my round-1 F5 under-called it: I verified
the same-ID race and noted the conflicting-ID window was refused "at the
next selecting act," but between `ensure_expected_app` and that next act
sit the mint and launch — both racers could complete `fork create`
successfully in one run. The fix replaces last-writer-wins rename with an
install-once protocol (`install_app_root_identity_sync`,
`src/instance_fork.rs:1390-1474`): synced unique `create_new` temporary,
then `fs::hard_link(temp, path)` — link(2) is atomic no-replace, so exactly
one first writer can ever publish — then unlink + directory fsync. On
`AlreadyExists` the loser reads the winner's bytes (necessarily complete:
anything at the final path arrived via link of an already-fsynced
temporary) and compares: same identity → idempotent success; different →
`SNAPBACK_FORK_APP_BINDING_MISMATCH` with details, before any mint or
launch. Error precedence is right: a conflicting writer receives the
identity refusal even if the loser's temp cleanup also fails, while a
same-ID loser surfaces a genuine cleanup I/O error rather than masking it.
The read-then-install TOCTOU in `ensure_expected_app` is closed by the same
mechanism (a winner appearing between the read and the install lands in the
AlreadyExists compare).

The two tests are the right ones and are non-vacuous as written: both use
the pre-rename hook as a two-party barrier inside the publication window
(deterministic, not sleep-based); the same-ID test asserts one identity
file and no residue; the conflicting-ID test drives two full
`publish_managed` attempts and asserts **exactly one mint, one
launch-boundary crossing, one refusal with the mismatch code, and no fork
directory for the loser** — precisely the production consequence the
blocker named. Execution (including the 32-writer regression and the
52/52 module run) is supervisor-supplied.

**Hard-link path scrutiny (commissioned):**

- *Crash residue:* a crash before `hard_link` leaves only a
  `.{name}.install-{uuidv7}` temporary in `.snapback/` (never the final
  name); a crash between link and unlink leaves the **complete** final file
  plus the temporary. No state exposes a truncated or absent-but-linked
  identity, and no production reader enumerates `.snapback/`
  (`load_expected_app` reads the exact path), so residue is inert — same
  Low class as my round-1 F4, unchanged disposition.
- *AlreadyExists compare:* `link(2)`'s `EEXIST` maps to
  `ErrorKind::AlreadyExists` on both claimed platforms; any other link
  error (including `EPERM`/`EOPNOTSUPP` on a filesystem without hard
  links) propagates as a typed io_error — fail-closed, never silent. If
  the final path vanished between the failed link and the read (no
  production path ever deletes the identity), `fs::read` errors and the
  caller refuses. A pre-planted symlink at the identity path makes `read`
  follow it, but writing into the app root is already full authority in
  the acknowledged cooperating-local threat model — not a claim boundary.
- *Ordering:* bytes are written and fsynced before the link, the directory
  is fsynced after install on both winner and loser paths, and the outer
  error arm's second `remove_file` of an already-removed temp is a
  discarded ENOENT. Sound.

### My F3 — residual departing-class disclosure: CLOSED

`DERIVED_FORK_RESIDUAL_V2_DEPARTING_CLASS` freezes the residual v2→v3
departing roots (`packages/snapback-codegen`, `packages/snapback-contract`,
`tests` — I verified this is exactly the v2 `IMPLEMENTATION_ROOTS` minus
the v3 scope), the nine separately-ledgered paths, and a disposition
sentence; the v3 acceptance contract requires it verbatim, with a refusal
fixture. The classification the named author accepts now says what
actually happened.

---

## (b) New defects in the fix delta

None found that block. Two notes:

**N1 — Low. The v3 acceptance validator still pins
`authorLine === 'Charlie Cheever — accepted 2026-08-06'`**
(`scripts/check-agent-safe-publication.mjs:2015`), and the evidence
locators still name the `2026-08-06`-dated bench/acceptance artifact paths.
A fresh acceptance minted by *this* requalification will be signed on a
later date; since any checker edit after C rotates the digest and restarts
the cycle, the ceremony must either mint the fresh acceptance under the
pinned line (a factual-precision wrinkle the author should consciously
accept, since the line would understate the re-acceptance date) or plan the
line update as part of the cut *before* the next C. Fail-closed either way
— a mismatch refuses — but worth deciding deliberately now rather than
discovering at mint time. (The bench receipt-overwrite papercut the fix
commit ticketed is the same family.)

**N2 — Note. The admitted-gates mirror duplicates four registry entries.**
Redundant with the policy file now being in-scope, but the redundancy is
defense-in-depth in the right direction (both authorities must agree,
either alone refuses), and the sync cost is a deliberate requalification
tripwire. `canonicalValue` drops nothing, so even a cosmetic reorder of a
gate's trigger array refuses — strict, but strictness here is the point.

Everything else in the delta on the scoped surface is the two fix commits
plus comment-only annotations (`c89024abe`). `write_json_sync`/
`replace_bytes_sync` and all their other call sites are untouched from
round 1; `ensure_expected_app` is the only caller routed to the new
install-once path, which is correct — every other carrier is replaceable
evidence where last-complete-writer-wins is the intended semantic.

## (c) Checker suite

Green in this environment: 90/90 unit tests, clean-tree checker run
`withheld`/`withheld`, digest recomputed and matching. No generated-demo
artifacts were demanded by any check I ran (`scripts/check-generated-artifacts`
is a shell script and was not needed; the Node suite carries its own
fixtures).

---

## Verdict

All three round-2 blockers are closed at the root cause with the specific
negatives that would have caught them; my round-1 F1/F2/F3 are addressed
beyond the bar I set (F1 doubly); the fix delta introduces no new defect —
the hard-link install-once path is correct under crash, race, and
error-mapping scrutiny; and the scoped surface contains nothing else but
comment-only annotation. Conditional on the supervisor-supplied dual-platform
execution evidence (fork suites including the two new barrier tests, and
the row-13 bench) green at exactly
`622d61b9f29c18bdab3e4f0b23fa9de085eb3161`, and with N1 (stale-dated
authorLine pin) consciously resolved by the author at acceptance time:

**Verdict: READY** — no blocking findings; N1 (Low) is a ceremony-consistency
decision for the named author, N2 and the carried F4/F5-class residue are
non-blocking notes.
