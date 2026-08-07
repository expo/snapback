# Review: derived-fork requalification candidate, commit 336a605bc

**Family:** fable
**Provider/runtime:** Anthropic / Claude (Fable 5), Claude Code agent session
**Date:** 2026-08-07
**Redacted:** no
**Reviewed commit (qualification C):** `336a605bc808a340c71407c148af450789f420ad`
**Implementation tree SHA-256 (v3 scoped):**
`sha256:c42666589ceea579e7ac6a635e3a4ef9b4f888a54b329c552929fff71c81ecf0`
**Digest version:** `snapback:agent-safe-implementation-tree:v3`
**Scope under review:** roots `src`; files `.gitmodules`, `Cargo.lock`,
`Cargo.toml`, `build.rs`, `scripts/check-agent-safe-publication.mjs`,
`scripts/generated-artifact-policy.mjs`, `vendor/ibex` (gitlink)
**Qualified capability:** `agent_safe_derived_deployment_fork_v1`
(`operating.instance-forks`), narrow local claim on exactly `macos/aarch64`
and `linux/x86_64`; fail-closed `deny-all-v1`, non-promotable, host-mediated
isolation, no process containment, no npm/hosted/merge-back claim.

**Method:** fresh clean-context session; read-only worktree pinned at
`336a605bc`; mutually blind (no `review-codex*`/`codex-review*` artifact and
no other concurrent review was read). This worktree has **no bootstrapped
Rust runtime**, so this is a static review of the scoped delta
`ad0ad5874..HEAD` plus Node-based execution: `bun install --frozen-lockfile`,
`node scripts/check-agent-safe-publication.mjs`,
`node --test tests/agent_safe_publication_checker_v1.mjs`, and direct
invocation of the checker's exported digest/snapshot/transfer functions. I
read the requalification ticket, LLP 0189, the LLP 0158 claim anchors in
`src/`, and rounds 1–4 of the prior fable implementation review for context;
this artifact is a fresh head, not a delta amendment of that corpus.

---

## Execution evidence produced in this worktree

- `node scripts/check-agent-safe-publication.mjs` on the clean tree at C
  prints `agent_safe_storage_v1:withheld` and
  `agent_safe_derived_deployment_fork_v1:withheld` — the correct
  pre-publication posture (a fresh v3 receipt does not exist yet).
- `node --test tests/agent_safe_publication_checker_v1.mjs`: **76/76 pass**
  (Node v25.9.0), including the new v3 fixtures (70 → 76).
- **Digest independently recomputed at C**:
  `implementationDigestAt(root, C, DERIVED_FORK_IMPLEMENTATION_SCOPE)` =
  `sha256:c42666589ceea579e7ac6a635e3a4ef9b4f888a54b329c552929fff71c81ecf0`,
  matching the commissioned digest exactly. (Unscoped v2 at C is
  `sha256:6edb47e5…`, confirming the scope is doing real work.) I read the
  digest algorithm line-by-line rather than trusting the number: version tag
  plus the canonical scope JSON are in the hash preimage, entries are
  code-point sorted `mode/path/content-bytes`, the `vendor/ibex` gitlink is
  hashed as its commit oid, `PUBLICATION_CYCLE_ALLOWLIST` leaves are
  excluded, and `validateImplementationScope` bars allowlist leaves from
  `scope.files`, bars traversal/absolute/backslash paths, and requires
  sorted-unique roots/files with no nesting or root-shadowed files.
- **Departing set independently verified**: the in-v2-scope change set
  `ad0ad5874..a5465b4a2` (prior qualified C → withdrawal) is exactly the
  nine paths hardcoded in `DERIVED_FORK_COVERAGE_TRANSFERS` — no more, no
  fewer. The exact-set-equality check in `assertCoverageTransfers` refuses
  both a missing and an extra path, and both negatives are fixtures.

**Reliance statement (explicit).** Everything Rust-executable is outside
this worktree's reach: the fork CLI acceptance suites
(`tests/instance_fork_cli_v1.rs`), the new concurrency and descriptor unit
tests, the renewal/recover crash matrices, and the row-13 dual-platform
lifecycle benches. My verdict **relies on the supervisor-supplied
dual-platform execution evidence (macos/aarch64 + linux/x86_64 suites and
the row-13 bench) at exactly this C** for every claim of that class. What I
attest from my own reading and Node execution: the scoped delta's content,
the digest arithmetic, the checker semantics, and the non-vacuity of the
new tests as written.

---

## Scoped delta since the withdrawn publication (what I reviewed)

Digest-covered files changed in `ad0ad5874..HEAD`: `src/instance_fork.rs`,
`src/cli.rs`, `src/server.rs`, `src/manifest.rs`,
`scripts/check-agent-safe-publication.mjs` (allowlisted publication carriers
under `src/` also changed but are digest-excluded and remain
receipt-digest-bound). Commission highlights 1–5 in order:

### 1. Atomic filesystem evidence (`d97bc81ab`) — sound

`write_json_sync` now routes through `replace_bytes_sync`: unique
`.{name}.replace-{uuidv7}` temp in the same directory, `create_new(true)`
(O_EXCL, so concurrent writers can never interleave on a shared temp),
`write_all` + `sync_all`, rename, then directory fsync, with temp removal on
every error path. Torn final bytes are impossible; a crash before rename
leaves the old carrier intact; concurrent complete writers settle last-wins.
I checked **every production call site** for create-exclusive reliance and
found none — the prior implementation was a truncating, non-exclusive
`File::create`, so no caller could have depended on exclusivity, and the one
first-publication site (`ensure_expected_app`, `src/instance_fork.rs:231`)
gains strictly better behavior: a concurrent `load_expected_app` can no
longer observe partial bytes. Locking is unaffected because every lifecycle
lock (`admit_creation`, `lock_cleanup`) lives in a **separate** lock file,
never in a JSON carrier, so the inode swap cannot strand an flock. The
registry scan (`src/instance_fork.rs:2380-2382`) filters on extension
`json`, which the temp names do not carry, so a crash-leftover temp cannot
wedge `list`/`reap`. The two new tests are the right ones: the rename-hook
test proves the final path is never exposed pre-rename on first publication,
and the 32-writer barrier test proves first-publication idempotence.
Residuals are F4/F5 below (both Low).

### 2. Descriptor probe fork race (`d1e52cd71`) — conclusion justified

The production sweep (`configure_detached_child`) is **unchanged** in this
commit; the delta is test-only plus one new unit test. The diagnosis is
correct as written: `libc::pipe` followed by `F_SETFD FD_CLOEXEC` has a
process-wide window in a threaded test harness during which any parallel
`Command` spawn's forked child inherits the writer; if that child is
long-lived, the old EOF probe blames the detached server for a descriptor an
unrelated process holds. The replacement closes the window at the syscall
(`O_CLOEXEC` in `custom_flags` at open) and switches the probe to a
per-open-file-description `flock` lease, asserting `WouldBlock`
specifically. Crucially the fix does not merely delete the flaky evidence:
`detached_child_configuration_closes_an_inherited_descriptor_on_exec`
(`src/cli.rs`) now proves the sweep **directly** — dup2 of a lease fd to 198
(dup2 clears CLOEXEC, so it genuinely inherits), spawn through the real
`configure_detached_child`, and a lock probe that fails iff the exec'd child
retained the descriptor — and it isolates its own deliberately non-CLOEXEC
fd by re-running itself in a subprocess, so it cannot re-create the same
race for its neighbors. The integration test still exercises the real
`snapback fork create` executable end to end. "Test artifact, production
sweep correct" is the right conclusion; the sweep's design correctness was
additionally four-way verified in round 3 of the prior corpus and is
untouched here. Execution on both platforms is supervisor-supplied.

### 3. Checker changes (`0a60693cc`, `ff015ee6d`) — no custody rule weakened

**Prose-history freeze.** Post-cutoff rounds must carry
`proseHistoryBinding: "frozen-per-round"` with strictly-monotonic
`reviewArtifactByteLengthAtRound` whose prefix bytes hash to the recorded
per-round digest, and the authoritative round must cover the complete
artifact — so review prose becomes append-only the moment the first
post-cutoff round lands, and any later rewrite of earlier prose breaks a
recorded prefix digest. The legacy carve-out is genuinely closed: an entry
is legacy only at its exact index with the exact enumerated reviewed commit
(rounds 1–12, `LEGACY_REVIEW_COMMITS`) **and** the exact hardcoded verdict
code; round 13+ can never present as legacy (`LEGACY_REVIEW_COMMITS[12]` is
undefined). I cross-checked the hardcoded fable implementation codes
(`R,N,R,…`) against the actual round 1–3 verdicts in the prior review
artifact — they match. A fully-rebound forgery (rewriting prose and
regenerating the whole verdicts JSON with fabricated frozen bindings) is
stopped where it was always stopped: the entry hash chain terminates in
`headEntrySha256` + `roundCount`, which the named-author acceptance binds
exactly, and the acceptance is digest-bound in the receipt/carrier/anchor
chain. Every pre-existing binding (current-artifact digest per entry,
family constancy, commit ancestry, verdict shape) is retained. This is a
strict strengthening.

**Codegen declaration gate.** All 33 `AgentSafe*` declarations in
`packages/snapback-codegen/index.d.mts` are compared against the four
committed schema projections, which are first checked mutually identical;
the parser fails closed on any declaration shape it does not recognize
(non-`$ref` unions, extra members, optionality — `required` must equal the
full property set and `additionalProperties` must be `false`). The gate is
additionally invoked from the DK-7 Rust schema test, so the Rust →
committed-schema → hand-declaration chain is machine-closed in both proof
lanes. The `src/manifest.rs` delta here is a test-fixture spelling refresh
inside `mod agent_safe_capability_tests` (keeping the tampering negatives
live against current lower-camel spellings) — no production change. Both
R11-1/R12-1 regression negatives run in the passing suite.

### 4. LLP 0189 D-3/D-4 v3 digests (`1dba92d4d`) — mechanism verified; three hardening gaps found

What holds, verified by reading and by running the fixtures:

- **Semantic-role scoping.** The two checkers that define the publication
  semantics stay in the digest (`scripts/check-agent-safe-publication.mjs`,
  `scripts/generated-artifact-policy.mjs`); the nine departing files are
  proof-fixture/metrology/inventory leaves that the checker never reads at
  check time — none defines the claim's semantics.
- **The scope declaration itself is bound.** The canonical scope JSON is in
  the digest preimage, and the fixture proves two scopes selecting the same
  leaves produce different digests. `DERIVED_FORK_IMPLEMENTATION_SCOPE`,
  `DERIVED_FORK_COVERAGE_TRANSFERS`, and `PUBLICATION_CYCLE_ALLOWLIST` are
  constants inside an in-scope file, so editing any of them — including
  moving a file out of scope via the transfer ledger, or allowlisting a
  `src/` path to exclude it — rotates the claim digest and forces
  requalification with fresh review heads and author acceptance. That is
  the designed answer to "can an attacker move a semantics-defining file
  out of scope through the transfer mechanism," and it holds.
- **Coverage-transfer enforcement.** Exact set equality against the nine
  reviewed departing paths (missing and extra both refused, both fixtures
  exist); each transfer target must be out of scope and must name a
  registered gate with non-empty records, recordPaths, and
  regenerateCommand whose record paths or trigger rules actually cover the
  leaf (`gateMatchesPath`); a stub, unknown gate, or non-covering trigger
  refuses. `ci-workflow-fixtures` and `local-proof-inventory` are newly
  registered in the drift registry as the ledger requires.
- **Gate quality for the nine.** All four target gates are genuine
  recompute-vs-frozen-record gates, not presence pins: client-bundle
  metrology recomputes bundle facts against the committed baselines (which
  *are* four of the nine files); local-proof-inventory recomputes the
  canonical gate inventory and versioned-seed carrier invariants;
  ci-workflow-fixtures recomputes workflow/toolchain invariants;
  agent-safe-publication-fixtures recomputes the generated-publication leaf
  set — which is precisely the aspect of
  `tests/agent_safe_publication_checker_v1.mjs` whose wave drift rotated
  the withdrawn digest.
- **D-3 snapshot semantics.** `evaluateClaimSnapshot` classifies
  post-qualification drift scoped/invalid vs out-of-scope/standing; the
  motivating fixture (all nine wave files change → `stands`; one byte of
  `src/qualified.rs` → `invalid` with the exact path named) passes, and the
  CLI surfaces standing out-of-scope drift on stderr rather than silently.
- **No legacy hole.** v1 receipts refuse when published; v2 receipts refuse
  when published with "re-qualification with v3 required"; v2 stays
  readable for withheld/historical records only.

The gaps are findings F1–F3 below.

### 5. Fork runtime claim surface — no regression found

The complete `src/` delta since prior qualified C is: the atomic-write
change plus its tests (`instance_fork.rs`), a tests-mod-only addition
(`cli.rs`, single hunk inside `mod tests`), typed
`{retryable: true, authorityDisposition: "carrier", cause:
"stream_replaced"}` details on the two **anonymous-arm**
`SNAPBACK_AUTH_STREAM_RESET` refusals (`server.rs` — the LLP 0059
publication fence and the refusal itself are unchanged; the hint marks only
anonymous re-establishment, which on a fork is exactly the class the rotated
keyring already forces, so no fork-isolation interaction), and pinned
contributor-chain hash refreshes plus a test-spelling fix in `manifest.rs`.
Claim anchors spot-checked present and unchanged: non-promotable lineage
(`promotable: false`, mint refusal on lineage disagreement), nested-fork
refusal at both gates, `deny-all-v1` egress posture strings at the CLI
surface, the fail-closed `for_derived_host_op` egress family gate wired at
both host-op dispatch sites (`src/local.rs:4129`, `src/server.rs:1406`),
and the eleven `SNAPBACK_FORK_EGRESS_DENIED` sites in `instance_fork.rs`.
Grants/TTL, reap/drop, resource-limit admission, and diff custody were not
touched by any delta commit; the prior twelve-round corpus continues to
cover them, and the posture is honest at this C: capability-index target
`none` with a GAP row naming the requalification ticket, and both
publication anchors `withheld`.

---

## Findings

**F1 — Medium. Input-closure gap: the drift-gate registry that the
in-digest transfer validator consumes is out of scope and not
content-pinned.** `validateDerivedForkCoverageTransfers` reads
`scripts/local-proof-selection-policy.v1.json` at check time, but that file
is neither in the v3 scope nor pinned by content in any claim record.
*Demonstration:* edit the policy so a transfer-target gate keeps valid
shape but loses enforcement teeth (e.g. `regenerateCommand: "node -e 0"`,
or shrink `client-bundle-metrology.recordPaths` to a single file while its
trigger prefix still matches) — the claim digest does not rotate,
`runChecker` still passes, and the nine files' real coverage silently
degrades, violating "coverage moves, it never vanishes" without any
claim-relevant event. *Mitigations that exist:* any edit to the policy file
classifies as `selector-authority` → `FAIL_CLOSED_FULL` (I ran the
selector: the full 140-gate inventory is selected), the
`drift_prone_gates_v0` committed-history corpus exercises enforcement, and
shape validation refuses empty/missing fields — so this needs a reviewed
landing, not a quiet drive-by. But amended D-4 says the digest "closes over
the semantics-affecting inputs of its in-digest checkers, pinned by content
in the claim record," and this input is neither closed over nor pinned.
*Resolution:* freeze the four transfer-target gate entries (records,
recordPaths, triggerRules, regenerateCommand) — or a canonical-JSON digest
of them — as a constant inside `check-agent-safe-publication.mjs` (already
in-digest) and refuse on live-policy mismatch. Note the sequencing
consequence honestly: because the checker is in-scope, this fix rotates the
digest, so it should ride the next natural requalification cycle per D-3
rather than restart this one.

**F2 — Medium. The checker never asserts that a derived-fork v3 receipt's
`implementationScope` equals the canonical
`DERIVED_FORK_IMPLEMENTATION_SCOPE`.** The constant is used only by the
transfer validator (line 624); `validateReceiptShape` accepts any
shape-valid scope, digests are recomputed under the *receipt's* scope, and
the author-acceptance schema has no explicit scope field — the scope is
bound only transitively, as bytes inside the digest preimage.
*Demonstration:* the checker's own test fixture publishes a record whose
receipt scope is `{roots:['src'], files:['vendor/ibex']}` — not the
canonical scope — and it validates as `published`; a future mint that
omitted `scripts/check-agent-safe-publication.mjs` from scope would let
subsequent checker edits (the semantics-defining file) land without
invalidating the claim. *Why not blocking:* the exploit must survive the
human ceremony — the acceptance must name the rogue digest, which will not
match the digest the review heads name (this review names
`sha256:c42666…` for the canonical scope, so a divergent mint is detectable
by construction), and both records are `withheld` today. *Resolution:* for
`agent_safe_derived_deployment_fork_v1`, require deep-equality of
`receipt.implementationScope` with the canonical constant, and add the
scope (or its digest) as a named field of the author-acceptance schema so
D-4's "the scope classification is itself part of the claim record the
named author accepts" is legible rather than transitive. Same sequencing
note as F1.

**F3 — Medium-Low. The machine-enforced transfer ledger covers the nine
reviewed files, but the v2→v3 departing set is much larger.** All of
`tests/` (including `tests/instance_fork_cli_v1.rs`, the fork acceptance
suite itself) and `packages/snapback-codegen`/`packages/snapback-contract`
left the digest, and only the nine wave-drift paths have named
frozen-record custody. Much of the remainder has trigger-level selection
coverage but no record-level gate: weakening the fork CLI suite post-C
turns nothing red and does not invalidate the claim. This does not falsify
the narrow claim — the qualification evidence is produced at C, later test
weakening cannot retroactively alter it, and the next requalification's
fresh review heads re-inspect the suites — and the commission and the
LLP 0189 Revised header both frame the reviewed transfer as the nine-file
set, so I read this as the author's ratified interpretation. But D-4's
letter says "removing a file from a digest is legal only in the same
change that adds (or names the existing) drift gate covering it," and the
residual class is currently implicit. *Resolution:* the fresh
author-acceptance record (or the 0189 implementation ticket) should name
the residual departing class and its rationale explicitly, so the accepted
scope classification matches what actually happened.

**F4 — Low. Crash-leftover `.{name}.replace-{uuid}` temporaries are never
swept.** On a crash between `create_new` and the rename's directory sync,
the temp survives. Inside fork destination trees it is removed with the
tree at drop/reap; in the registry directory and the app root's
`.snapback/` it lingers indefinitely (harmless — the registry scan filters
non-`json` extensions, and `managed_target`'s exact-direct-child re-bind is
unaffected). *Resolution:* sweep `.{'*'}.replace-*` during `list`/`reap`,
or ignore; cosmetic, same class as the deliberately-retained cleanup-lock
files.

**F5 — Low (pre-existing, note only). `ensure_expected_app` first
publication retains a benign TOCTOU for two racers presenting different
app ids** — both observe NotFound, both write, last rename wins, and the
loser holds an in-memory identity disagreeing with disk. Every selecting
act re-validates the presented identity against the on-disk receipt
(`validate_expected_app`), so the loser is refused at its next verb; the
committed race test covers the same-app-id case that matters. The old code
had the same window with torn-read failure modes on top; this is strictly
improved. Worth a one-line comment, nothing more.

**F6 — Note. Legacy review rounds 1–12 remain prose-unbound until the
first frozen-per-round entry lands.** Until the requalification ceremony
appends round 13+, the historical prose region is still
rewritable-with-full-rebind in principle — exactly the ticket's original
finding — but the closed legacy enumeration (exact commits + verdict
codes) prevents both adding unbound rounds and flipping any recorded
verdict, and the acceptance-bound head hash prevents any rebind from
standing. The first post-cutoff round permanently freezes everything
beneath it. Custody is not weakened; the remaining exposure dies at the
next ceremony by construction.

---

## Verdict

The scoped delta since the withdrawn publication is careful work: the
atomicity fix is correct at every call site, the descriptor-race
conclusion is proven rather than asserted, both checker changes strengthen
custody, the D-3/D-4 implementation does what LLP 0189 rules — with the
digest arithmetic, the nine-file departing set, and the
stands/invalid semantics all independently reproduced in this worktree —
and the fork runtime claim surface is unchanged and honest. F1–F3 are real
hardening gaps in the publication *mechanism*, but none is exploitable
without defeating the named-author ceremony, none affects the fork
runtime's behavior, and fixing F1/F2 rotates the in-scope checker — work
that belongs to the next natural cycle under D-3, named in the acceptance
record now.

Conditional on the supervisor-supplied dual-platform execution evidence
(both fork suites and the row-13 bench, green at exactly
`336a605bc808a340c71407c148af450789f420ad`), and with F1/F2/F3 named in
the fresh named-author acceptance:

**Verdict: READY** — no blocking findings; F1 and F2 (Medium) are
next-cycle checker hardening, F3 (Medium-Low) is an acceptance-record
legibility item, F4/F5/F6 are non-blocking residue.
