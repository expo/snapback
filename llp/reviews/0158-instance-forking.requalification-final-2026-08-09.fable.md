# Review: derived-fork requalification final delta, commit 772c00649

**Family:** fable
**Provider/runtime:** Anthropic / Claude (Fable 5), Claude Code agent session
**Date:** 2026-08-09
**Redacted:** no
**Reviewed commit (final qualification C):**
`772c00649534d68b2ba63b98699e8ce2b2019057`
**Implementation tree SHA-256 (v3 scoped):**
`sha256:53e85a9f1958bcba44ceac12c24e70608b79ae9eeb47871bdd405fc6db796b75`
**Digest version:** `snapback:agent-safe-implementation-tree:v3` (scope:
roots `src`; files `.gitmodules`, `Cargo.lock`, `Cargo.toml`, `build.rs`,
`scripts/check-agent-safe-publication.mjs`,
`scripts/generated-artifact-policy.mjs`, `vendor/ibex` — the selection
policy has **left** the scope; see item 1)

**Method:** declared **delta round** on my rounds 1–3 heads (READY at
`336a605bc`, `622d61b9f`, `03f9d147c`). No codex review was read. I read
the policy-custody redesign (`dcdcdc4be`) in full, enumerated the complete
`03f9d147c..772c00649` scoped delta (151 commits; 48 scoped files),
machine-separated the `cargo fmt` sweep from semantic change, and read
every semantic commit touching the fork surface. Node checks executed
here; Rust execution is supervisor-supplied (relied on explicitly below).

**Execution evidence produced in this worktree:**
digest recomputed with this C's own checker =
`sha256:53e85a9f…6b75`, matching the commission exactly; clean-tree
checker run reports both records `withheld`; unit suite **97/97 pass**;
and I exercised the new custody directly: the C-committed policy bytes
hash to `sha256:40546403…9c32`, `validateDerivedForkCoverageTransfers`
with that pin validates all 9 transfers, an all-zero pin refuses as a
placeholder (`binding is invalid`), and a well-formed wrong pin refuses
with the exact expected/actual mismatch message.

**Reliance statement.** All Rust execution — the fork CLI suites, the
instance-fork/fork-promotion module tests including the new
damaged-branch-reap and staging-cleanup tests, the shutdown-checkpoint
process test, and the row-13 dual-platform bench — is outside this
worktree's reach (no bootstrapped runtime). My verdict relies on the
**supervisor-supplied dual-platform execution evidence at exactly
`772c00649`** for every claim of that class.

---

## 1. Policy custody: content pin at C — meets and completes my F1 bar

`dcdcdc4be` replaces round 2's scope-membership custody (which my round-2
review endorsed but which, as the commission reports, re-created the
wave-drift treadmill on the first routine fleet selector registration)
with the design amended D-4 actually names: **pinned by content in the
claim record**. Verified point by point:

- The scope no longer lists the policy file, and
  `validateImplementationScope` now *refuses* a scope that lists it
  ("content-pinned selection policy redundantly scoped") — exactly one
  custody mode can exist, so the two mechanisms cannot silently disagree.
- A derived-fork v3 receipt must carry `selectionPolicySha256`
  (`exactKeys`-enforced: mandatory for the derived record, forbidden for
  the storage record), format-validated, with placeholders rejected.
- Transfer validation reads the policy bytes **at qualification C via
  git** (`committedBytes(root, C, path)`), verifies they hash to the
  receipt pin (refusing with expected/actual on mismatch — demonstrated
  live), parses those C-bytes, and runs the admitted-gates checks against
  them with `recordCommit = C` (gate record files must exist as regular
  blobs **at C**, not HEAD — the whole validation is C-anchored).
- **Post-C live divergence is inert both ways**, as commissioned: it
  cannot invalidate the claim (the file is out of scope, so
  `evaluateClaimSnapshot` classifies it out-of-scope/standing — the
  renamed fixture proves a tampered live policy leaves the claim
  standing) and it cannot change the transfer verdict (nothing reads the
  working-tree policy anymore — a second fixture proves validation
  ignores different post-C working-tree bytes). The fleet commits that
  landed after `dcdcdc4be` and touched the live policy (e.g. the
  `bb06e0618` module-ownership gate registration) are the design working
  as intended: digest unrotated, verdict unchanged.
- The named-author acceptance contract carries `selectionPolicySha256`
  and requires it to equal the receipt's — mismatch fixtures on both
  sides run in the green 97.
- **Pin form:** a raw SHA-256 of the exact committed blob at C — byte-
  exact, which is the right canonical form for a file whose bytes *are*
  the registry (stronger than canonical-JSON, immune to reserialization
  games). Domain separation is by named field and single-purpose
  comparison (only ever checked against the recomputed C-blob digest);
  there is no cross-digest confusion surface. Adequate.
- The round-2 in-checker `DERIVED_FORK_ADMITTED_COVERAGE_GATES` mirror is
  retained, so the C-bytes must still match the reviewed gate definitions
  exactly — a shape-valid stub cannot impersonate a gate even at C.

One layering consequence, noted for the record rather than as a defect:
with the policy out of scope, post-publication *live* erosion of the four
gates (e.g. a future deletion from the registry) no longer touches the
claim — continuity of the nine files' real coverage after C is owned by
the proof system itself (the canonical-inventory and drift-gate fixtures,
selector-authority FAIL_CLOSED_FULL on policy edits, and D-1 battery
tickets), not by the claim record. That is precisely LLP 0189's ruled
layering (claims are snapshots; the battery owns ongoing truth), and I
accept it as such.

## 2. The fork-surface fleet delta

**Fmt separation.** `2844b8f75` (`cargo fmt --all`) is the bulk of the
48-file churn. I compared it hunk-by-hunk at the token level
(whitespace-stripped): `fork_promotion.rs`, `write_authority.rs`,
`storage.rs`, and `server.rs` are character-identical modulo whitespace;
`instance_fork.rs`, `cli.rs`, and `local.rs` differ additionally only in
brace-pair and comma placement — the exact shapes rustfmt produces
(match-arm block collapse, trailing commas), with no identifier, literal,
or operator changes. Semantically neutral.

**Semantic commits, scrutinized:**

- **Reap self-heal** (`a646bb71a`, `fork_promotion.rs`): the expired
  managed in-app-branch sweep no longer aborts (`?` → `.ok()`) when a
  damaged branch workspace fails to reopen; the custody transition
  active→tearing_down→dropped proceeds and the receipt is honestly
  custody-derived (`dropped_managed_receipt`) instead of fabricated from
  inspection. Exactness preserved: the loop still touches only expired
  profiles, and TTL — not inspectability — is the drop authority, which
  matches the claim's expiry philosophy. The new test proves a damaged +
  healthy pair both reach `dropped` with workspace files gone. The
  theoretical widening (a transiently unreadable *expired* branch is now
  dropped rather than wedging) is the correct disposition for an expired
  branch. No claim invariant regressed.
- **Directory mode** (`a646bb71a`, `instance_lock.rs`): the reserved
  instance directory is created `0o700` (was `0o777`-modulo-umask), then
  `set_permissions(0o700)` + owner/uid/mode/type validation, with a
  platform-gated test. Pure hardening of host-mediated isolation.
- **Staging cleanup on publish error** (`a646bb71a`,
  `instance_fork.rs`): an ordinary in-process publication error now
  best-effort removes the credential-bearing staging directory it
  created (deliberate test crash-cuts exempted so `recover` coverage
  stays real). I checked the rename boundary: after the atomic
  staging→destination rename the staging path no longer exists, so the
  error-path `remove_dir_all(&staging)` on any later failure is a
  harmless ENOENT — it can never delete a published fork. The
  asset-cut test now asserts no staging residue after refusal.
- **Custody inventory** (`24af62549`): one new closed-inventory row,
  `_snapback_job_idempotency_tombstones_v1` → `Copy`. Non-credential
  (idempotency tombstones), and jobs are idled on forks anyway; the
  fail-closed `CUSTODY_UNCLASSIFIED` audit is what forced this row to
  exist — the design working.
- **New host op** (`7b8df2715`): `mutation.settlement` added to the
  `for_derived_host_op` local-allow list with an @ref justifying it as a
  read-only projection of the request's own settlement identity (no
  egress, no independent effect), plus a corpus assertion that it is
  admitted on a fork while the unclassified future-op probe still
  denies. The fail-closed egress default is intact.
- **Shutdown checkpoint** (`b71969a5b`, `write_authority.rs` +44): the
  armed authorizer admits `wal_checkpoint(*)`/`journal_mode(DELETE|WAL)`
  only under a scoped `enter_shutdown_maintenance` token that refuses to
  overlap any active writer, resets on Drop, and can never authorize
  DML. Content-neutral pragmas, storage-internal issuance, bounded by a
  timeout so SIGTERM never hangs. The BranchRegistry-lane renew
  checkpoint arm from round 2's N1 closure is untouched. No weakening of
  the armed-fork write seam.
- **Admin token discovery** (`2777f1585`): ready-file host ops resolve
  the *database-named* minted token with a new owner-only-mode check —
  a fork server resolves its own fork-local minted token; no parent
  crossover introduced.
- Remaining commits (`298ebfeab` teardown/secrets-off-argv,
  `fced59265` guide reference routes, `64843e075` clippy type-alias on
  the test hook, `286d7fb0a` one `FieldType::Enum` arm grouped with the
  string class, `e3def8d2d` durable-state copy verb — local-CLI
  authority in the cooperating trust domain, plus a visibility-only
  `pub(crate)` change in `fork_promotion.rs`, `3bea79ec0` fan-out
  coalescing, `dd5d9ffbd`/`8f1d2a26d` promotion-lane scripts out of the
  fork path): none touches a claim invariant.

**Claim anchors re-verified present at this C:** non-promotable lineage,
nested-fork refusal (both gates), `deny-all-v1` posture strings, the
fail-closed `for_derived_host_op` wiring at both dispatch sites
(`src/local.rs:4221`, `src/server.rs:1402`), finite-TTL/expiry authority,
and exact reap/drop.

## 3. Rounds 1–3 closures at this C

All survive, confirmed in the current files and the green suite:
`install_app_root_identity_sync` (hard-link install-once, first-writer-
wins, conflicting-ID refusal) at `src/instance_fork.rs:1404` and wired at
`:233`; atomic `replace_bytes_sync` at `:1494`; canonical-scope
deep-equality refusal; the admitted-gates mirror (now C-anchored);
`residualV2DepartingClass` in the acceptance contract; frozen-per-round
prose bindings with the closed 12-round legacy enumeration; dated
append-only evidence locators with calendar/`>= C-date`/absent-at-C
enforcement and the locator-derived author line; A-only publication
custody for fresh dated evidence; and the withheld short-circuit (receipt
shape — including the derived-record `selectionPolicySha256` key rule —
is validated even for withheld records; transfer validation correctly
runs only when a claim exists to protect). My round-3 residues R3-1
(`%cs` timezone seam), R3-2 (historical-evidence P-window mutability via
the allowlist-first branch), and R3-3 (no upper date bound) remain as
known non-blocking papercuts, unchanged by this delta.

---

## Verdict

The content-pin custody is the design my round-1 F1 was reaching for and
is better than the scope-membership form I accepted in round 2 — it
closes the semantic input by content in the claim record, makes post-C
policy evolution provably inert in both directions, and got there after
the treadmill evidence was honestly documented rather than forced
through. The 151-commit fleet delta contains one formatting sweep
(verified token-neutral on the fork surface) and a set of semantic
changes that are each either hardening in the claim's favor or neutral,
with the two commissioned focal points (reap self-heal, directory mode)
both correct and honestly receipted. Every closure from rounds 1–3
stands. Conditional on the supervisor-supplied dual-platform execution
evidence (fork suites and the row-13 bench) green at exactly
`772c00649534d68b2ba63b98699e8ce2b2019057`:

**Verdict: READY** — no blocking findings; the carried R3-1/R3-2/R3-3
papercuts and the noted battery-owned post-C gate-continuity layering are
non-blocking record items.
