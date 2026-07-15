**Reviewer family:** Claude (Fable)
**Provider / runtime:** fresh Claude Code workflow subagent — model claude-fable-5, reasoning effort max (explicit per-agent override); orchestrated by /llp-super-refine
**Date:** 2026-07-14
**Redacted:** no — repo-local review; no secrets in the reviewed material; reviewer instructed not to read credential files or llp/reviews/
**Method:** sub-agent

# LLP 0057 reviews — Claude family

## Round 1 — 2026-07-14

**Revision under review:** `llp/0057-auth-provider-protocol.spec.md`, sha256 `c87b3e3836a3086581c36f7da93296625450313a29af84959ee16a0a4bd96d8b` (committed at repo HEAD `b11a6fa`)
**Runtime detail:** workflow run wf_f4bfeeab-1c8, agent acefdab81ff1cc183, model claude-fable-5, reasoning effort max (explicit per-agent override); fresh context — no access to the orchestrating session, to archived reviews, or to the concurrent GPT-family round
**Verdict:** NOT READY

### Review body (verbatim)

# LLP 0057 Review — Auth catalog and provider protocol (fresh, blind, cross-model)

Reviewer: Claude (Fable 5), independent LLP 0005 review loop. Blind constraints honored: nothing under `llp/reviews/` was read; no secret material was accessed.

## 1. Overall assessment

This is an unusually strong protocol spec. It takes exactly the obligations LLP 0039 deferred (`LLP 0039#protocol-obligations-deferred-to-implementation`, items 4, 6, 7 plus the item-3 core) and discharges them at executable-protocol rigor: exact encodings, exact DDL, exact state tables, exact lock order, exact crash residuals, and a fixture-backed acceptance matrix. I verified a wide sample of its load-bearing claims against the implementation and found essentially no spec-vs-code drift: every constant in the table matches (`src/auth/provider.rs:49-64`, `src/auth/keyring.rs:22-25`, `src/auth/mailbox.rs:22`, `src/auth/lifecycle.rs:22`, `src/storage/auth.rs:22`, `src/server.rs:6094`), the DDL matches (`src/storage/auth.rs:141-307`), the unbiased six-digit sampling matches (`src/auth/crypto.rs:127-151`), the 56-byte bearer/CRC-32-ISO-HDLC spelling matches with the `cbf43926` check value pinned in a test (`src/auth/crypto.rs:386-425,618`), the half-open throttle windows match (`src/auth/provider.rs:1816-1828`), the ENG-24981 backup inode-pinning revision matches a genuinely careful implementation (`src/auth/backup.rs:117-168,1039-1101`; `src/storage/auth.rs:686+` for the descriptor-bound, memory-journaled online backup with header normalization), the rescue multiset proof matches and is even stronger than the prose (adds `typeof()` and `COLLATE BINARY`, `src/storage/auth_rescue.rs:650-692`), the reservation predicate is shared across Rust and codegen (`src/storage.rs:5580-5583`, `packages/snapback-codegen/index.mjs:55`), the strict keyring file posture (exact `0600`, one hard link, fail-closed ACL/unsupported) is real (`src/secure_file.rs:54-121`), and the impersonation carrier, sibling-file discovery with startup-nonce verification, and CORS-allowlist exclusion are all as stated (`src/admin_impersonation.rs:25,133-216`; `src/server.rs:8627` omits `x-snapback-impersonation-capability`).

Is it a good idea? Yes. The four security boundaries in the Summary are the right ones, the credential non-substitution matrix is the document's best safety idea, and the honesty about residuals (stolen-successor until expiry, undeclared-restore resurrection, commit-before-response challenge orphan) is exactly what a security spec should do. My concerns are about completeness of the cross-spec ledger and the document's own acknowledged process state, not about the protocol's correctness.

## 2. Strengths

- **Boundary discipline with the frozen parent.** "Where 0039 pins an outcome, 0039 wins" (§Summary) is stated and then actually honored: the impersonation choice is one of 0039's two explicitly allowed alternatives (0039 lines 860-866: "a per-boot secret printed to the terminal"), the tiered supersession matrix reproduces 0039's design pins, and the LLP 0045 delegation is mirrored word-for-word from 0045's side (0045 lines 76-80). The ownership handshake is bidirectionally consistent.
- **Encodings pinned to the byte with cross-language fixtures** (§Binary and textual encodings, §Acceptance/Keyring and crypto). LP framing, digest domain string, canonical-base64url rejection-not-normalization, and the CRC check value are all fixture-pinned in Rust and independently in JS (`packages/snapback-codegen/auth-crypto-vectors.test.mjs`), including the Greek final-sigma canonicalization vector (`src/auth/crypto.rs:507-510`).
- **The throttle/GC retention coupling** (§Request-code transaction, §Garbage collection): retaining consumed/superseded challenges until `expires_at_ms` so that consuming a code cannot erase throttle history, with the half-open window boundary exactly matching the GC-deletable instant, is a genuinely elegant closure of a subtle bypass.
- **Non-enumeration and timing posture** (§Length-prefixed code digest, §Challenge states and exchange, §Logout, ordinary supersession, and family alarm): identical accepted-request responses for known/unknown addresses, dummy-HMAC equalization (`src/auth/provider.rs:752-793`), and the family alarm's fixed-shape, fixed-minimum-latency, always-202 response are all specified and implemented.
- **Crash-residual honesty at every seam** (§Request-code step 8, §Rotation, §Atomic publication and rotation, §Consistent backup step 7): each linearization point names its ambiguity behavior, and the commit-ambiguous rename handling (revalidate, accept only complete-prior or complete-candidate bytes) is the correct conservative shape; the backup Drop guard's `publication_attempted` latch (`src/auth/backup.rs:1079-1101`) implements the "never strip children after rename attempt" rule exactly.
- **The credential non-substitution matrix** (§Credential non-substitution) crossing seven carrier classes against three authority axes is the strongest single safety artifact here; it operationalizes 0039's "admin token is not a sufficient gate" pin.
- **Rescue's refusal-first posture** (§Transactional algorithm): the wide unsupported-schema refusal set, byte-preserving token rewriter, bidirectional multiset proof, and manifest hash-clearing (forcing explicit reprovision) prefer failing closed over cleverness.

## 3. Concerns

**C1. MATERIAL (coherence/completeness): the bulk session-revocation transaction is consumed by LLP 0058 as "LLP 0057's revoke-all transaction" but is nowhere specified in this document.**
Evidence: LLP 0058 line 777 ("revokes every durable session through LLP 0057's revoke-all transaction", sessions-to-dev downgrade step 2) and its implementation call site `src/storage/auth_mode.rs:759` → `revoke_all_sessions_in` (`src/storage/auth.rs:864-883`, doc comment: "matches declared-restore generation semantics without creating a restore marker or deleting identity rows"). LLP 0057's §Scope and ownership enumerates the owned session surface ("session minting, the 20-session cap, bearer rotation, tombstones, tiered supersession, logout, and the refresh-family alarm") without bulk revocation, and the seam-inventory paragraph ("item 4 now calls the read-only collision check at stage time and catalog/keyring activation at consume time...") omits this consumed seam entirely; `grep` confirms the document contains no "revoke-all"/downgrade text. Meanwhile §Implementation hand-off forbids varying "state outcomes" without revising this Draft — a contract that cannot bind for a state outcome the document never states. An implementer conforming to 0057 alone could implement the downgrade sweep by deletion or without generation increments, breaking 0058's "revoked sessions do not resurrect" and 0059's projection assumptions.
Resolution criterion: 0057 names and pins the reusable bulk-revocation transaction (semantics: requires `ReadyV1`; sets `revoked_at_ms = now` and increments generation once for every not-already-revoked session; deletes nothing; generation-exhaustion behavior stated), adds it to the owned-scope list and the item-4 seam inventory, and adds one acceptance line for it.

**C2. MATERIAL (process/decision-quality): by its own record, the document carries untriaged material review findings.**
Evidence: the Revised header ("material findings remain for author triage") and §Status ("its material findings await author triage. The review advises — it does not ratify."). This is grounded solely in the target document's own text, per the blind constraint. A Spec of this security weight cannot be called review-complete while it self-reports an open material-finding queue; the LLP 0005 loop requires author disposition, not merely archival.
Resolution criterion: each archived material finding receives a recorded author disposition (accepted-and-applied, or declined with rationale) reflected in the document's revision history, after which this concern dissolves regardless of the dispositions chosen.

**C3. MINOR (coherence with LLP 0059): the durable session clock floor silently rewrites this document's `now` semantics.**
Evidence: §Normative vocabulary pins "Unix epoch milliseconds for durable and wire timestamps" and §Sliding use pins `record_authenticated_use(..., now)` setting `last_used_at_ms = now`; the DDL CHECKs (`created_at_ms <= last_used_at_ms <= expires_at_ms`) make backward wall-clock movement a hard constraint failure. The implementation actually derives every wall-clock lifetime decision at `max(sample, floor)` under LLP 0059#durable-session-clock-floor (`src/storage/auth.rs:29,479-517`; LLP 0059 line 321). 0057 never acknowledges this overlay, so 0057-alone conformance either fails unavailability-shaped on clock regression or diverges from the sibling Spec's mandated behavior — and 0057's literal "sets `last_used_at_ms = now`" is not what the landed system does.
Resolution criterion: one sentence in §Normative vocabulary or §Sliding use stating that every wall-clock `now` used in durable auth writes is subject to the LLP 0059 durable clock floor, with a cross-reference.

**C4. MINOR (unpinned domain): session `generation` has no specified integer domain or exhaustion behavior.**
Evidence: the DDL pins only `CHECK(generation >= 1)` (§Catalog version 1); timestamps get an explicit `0..=9_007_199_254_740_991` domain but generation does not, even though `sessionGeneration` is wire-visible in the composed `authorityDescriptor` (§Public provider DTOs) and consumed by JS. The implementation chose a behavior the spec doesn't state: `revoke_all_sessions_in` fails closed as catalog corruption when any live generation reaches `9_007_199_254_740_991` (`src/storage/auth.rs:866-876`).
Resolution criterion: pin the generation domain (e.g., `1..=9_007_199_254_740_991`) and the exhaustion outcome in the constants or DDL section so the implemented refusal is spec-backed.

**C5. MINOR (rationale gap): the family alarm is destructively effective inside the supersession grace window.**
Evidence: §Credential resolution matrix row "Tombstone, age <= 10s, session live" → `/auth/family-alarm`: "revoke family", while refresh in the same cell deliberately avoids destruction (`REFRESH_SUPERSEDED`, protecting the sleeping/woken tab). A client-coordinator bug or over-eager fallback that calls the alarm inside grace destroys a healthy session that the refresh path was carefully designed to protect. This asymmetry is almost certainly intended (the alarm is only reached after custody reload and one retry fail, and deferring it would open a thief window), but the document explains the refresh-side grace at length and never explains why the alarm ignores it.
Resolution criterion: one sentence of rationale in §Logout, ordinary supersession, and family alarm stating why grace does not apply to the alarm (destroy-only, post-reconciliation-failure invocation contract), so a future editor does not "fix" the asymmetry.

**C6. EDITORIAL: the "dev" homonym (deployment profile vs auth mode) invites misreading.**
Evidence: "The capture provider is available in `dev`, `test`, and `demo`, never `prod`" (§Request-code transaction — profiles) vs "Provider routes in active dev mode return the typed HTTP-404 `SNAPBACK_AUTH_MODE_DEV`" (§Registry rows — auth mode). Both statements are correct and code-consistent, but the same token names two orthogonal axes within a few hundred lines, and the registry table's availability notes mix them ("Mailbox access and session minting are available in dev/test/demo").
Resolution criterion: a one-line vocabulary note (profile axis: dev/test/demo/prod; mode axis: dev/sessions per LLP 0058) near §Normative vocabulary, or consistent qualification ("dev profile" / "dev mode") throughout.

**C7. EDITORIAL: the family-alarm jitter is modulo-biased, unlike every other sampling rule in the document.**
Evidence: §Family alarm pins "0–5 ms of CSPRNG jitter"; the implementation samples `byte % 6` (`src/auth/provider.rs:4141`), a 43/42-per-256 bias. The spec pins rejection sampling for the six-digit code but is silent on jitter uniformity, so the code is technically conformant, and the bias is security-immaterial for a timing pad. Still, a document this exact should either say "uniformity not required" or require the same rejection discipline.
Resolution criterion: one clause in §Family alarm stating whether jitter uniformity is required.

## 4. Suggestions

- **Bind the backup unit's two halves to each other durably.** `backup.json` binds database and keyring at backup time, but a mixed restore assembled by hand (database from backup A, keyring from backup B, both individually valid) fails only lazily, per-challenge, as `PROVIDER_UNAVAILABLE` when a `key_id` is missing. Storing a keyring fingerprint (e.g., hash of the sorted key-id set) in `_snapback_meta` and revalidating at `ReadyV1` startup would make a mismatched pair fail closed at bind with a distinct diagnostic — cheap, and it also strengthens the §Keyring protocol "missing keyring" posture into a "wrong keyring" posture. This slots naturally under the existing open question about undeclared-restore detection.
- **Enumerate `_snapback_meta` auth-key fate in `app.reset`.** §Catalog write and lifecycle rules pins the reset delete list (which matches `reset_auth_catalog_in` exactly) and says the marker/keyring survive, but is silent on `auth_restore_declaration_id` (whose survival the restore idempotency contract quietly depends on) and the 0059 clock floor. One sentence closes it.
- **State the throttle-ordering rationale.** Steps 2–4 of §Request-code transaction do CSPRNG + HMAC + possibly a durable key rotation before the transactional throttle count. This is fine on a local target (0039 pins the throttle-honesty trade), and the count must be transactional to be race-free — but the document explains the rotation/admission separation without saying why no advisory pre-count precedes the crypto work. One clause prevents a future "optimization" from being proposed as a fix.
- **Consider a hash-chained auth event log as a named future item.** 0039 keeps audit trails a non-goal; given how much of this document is about attributable destruction (family alarm, restore declarations, downgrade revocation), a tamper-evident operator-plane event chain would materially help post-incident reconstruction and is the natural home for the "monotonic anchor" open question. A sentence in §Open questions would preserve the idea without scope creep.

## 5. Open questions

1. What recorded form will the author's triage of the archived review's material findings take, and does any of them alter a pinned constant, encoding, or state outcome (which would require fixture revision per §Implementation hand-off)?
2. Should the bulk-revocation transaction (C1) be owned here or explicitly ceded to LLP 0058 with 0057 providing only the storage primitive? Ownership must land on exactly one document.
3. Is the generation domain (C4) intended to be JS-safe-integer bounded, and is fail-closed-as-corrupt the intended exhaustion outcome versus refusing only the triggering operation?
4. Does the clock-floor overlay (C3) apply to *every* durable auth timestamp this document writes (challenge `requested_at_ms`, tombstone `superseded_at_ms`, key `retired_at_ms`), or only session-lifetime decisions? 0059's text is session-scoped; 0057's tables all carry the same CHECK bounds.
5. When the LLP 0045 delivery adapter eventually takes the ephemeral payload handle (§Capture mailbox), what acceptance artifact proves the "plaintext never enters a durable intent" boundary end-to-end across both documents?

## 6. Readiness verdict

The protocol design is sound, the implementation-verification story is exemplary, and nothing I checked in code contradicts the document. But two MATERIAL items remain: the revoke-all seam consumed by LLP 0058 is unspecified in the document that both 0058 and the code attribute it to (C1), and the document's own header and Status record untriaged material findings from the prior review gate (C2). Both are cheap to resolve — one pinned paragraph plus an acceptance line, and a recorded triage pass — after which I would expect this Spec to be ready for author ratification. C3–C7 are non-blocking polish.

READINESS VERDICT: NOT READY

### Orchestrator disposition (round 1, outside the verbatim body)

Spot-checks confirmed: no material spec-vs-code drift in the sampled constants,
DDL, and crypto vectors, as the review states. C1 (revoke-all transaction
consumed by LLP 0058 but unspecified) verified against 0058 and
`src/storage/auth.rs`.

Disposition: C1 → new §Bulk session revocation, added to owned scope and the
declared-restore branch, with an acceptance row; C2 (untriaged findings) →
the round-2 §Review triage records a disposition for every material finding of
both families; C3 (clock-floor overlay) → §Normative vocabulary now states the
LLP 0059 floor governs every durable `now`; C4 (generation domain) → pinned
`1..=9_007_199_254_740_991` with fail-closed exhaustion; C5–C7 (family-alarm
grace rationale, dev homonym, jitter uniformity) → non-blocking, folded into
the round-2 wording where cheap.

## Final implementation review — 2026-07-15

### Provenance

- Reviewer family: Anthropic Claude
- Provider/runtime: Claude CLI, model `claude-fable-5`
- Method: read-only Plan mode; high effort; no session persistence; blind to `llp/reviews/`
- Reviewed commit: `62a11cedfb1ff7ad0258dc3e6ce667989b88b819`
- Human authorization: ENG-24996 completion request
- Secrets or redactions: none

### Verbatim review

# LLP 0005 final review — LLP 0057 (auth catalog and provider protocol) @ 62a11ce

**Blind, advisory-only.** Document read in full; related LLPs 0059/0058/0024/0039 checked at every cited anchor; decisive implemented-boundary claims verified against code and the test corpus. Nothing under `llp/reviews/` was read.

## Overall assessment

This is a strong, near-final revision. The ENG-25001 repairs are real: every headline code-level obligation from the prior rounds — cross-table digest uniqueness, parse-gated family alarm, clock-floor derivation, descriptor-bound backup/restore, keyring commit-ambiguity reconciliation, stdin impersonation intake, and the rescue hardening — is implemented in the production paths the document describes, usually exactly as written. The remaining problems are concentrated in one place: the **Acceptance section asserts several executable vectors that do not exist as described**, and a few prose passages describe implementation mechanics more precisely than the code warrants. For a Spec that declares its executable artifacts "the implementation acceptance authority," those acceptance-accuracy gaps are material.

## Strengths

- **Cross-table token-digest uniqueness** is enforced inside both the issuance and rotation transactions (`src/auth/provider.rs:4169-4181`, `:3198-3206`), with the three-candidate coordinator loops (`src/server.rs:7592`, `:7647`; `AUTH_MAX_COLLISION_ATTEMPTS` at `src/auth/coordinator.rs:50`), zeroizing candidates, and exact premark removal on collision (`coordinator.rs:720-722`) — precisely the pinned repair.
- **Family alarm parse-gating** matches the spec's predicate description: the `actionable` flag requires `parsed.is_some() && live tombstone` (`provider.rs:1657-1691`) and gates the commit (`:3080-3084`); a production-path test plants the dummy digest as a live tombstone and proves no revocation (`provider.rs:6487`).
- **Clock-floor ordering** is exactly as pinned: catalog inspection → floor seed → declared restore with `provider.now_ms()` → mode composition → GC (`src/cli.rs:1567-1715`); restore derives its cut from the floor and catalog maxima (`src/storage/auth.rs:1118-1133`).
- **Backup/restore descriptor discipline** holds: descriptor-bound online backup via `/dev/fd` (never pathname reopen), header normalization through the pinned descriptor, staged-inspection through the retained descriptor, inode revalidation before and after rename, and post-attempt cleanup suppression (`src/auth/backup.rs`, `src/storage/auth.rs:1283-1377`).
- **Keyring** open checks (no-follow, owner, mode 0600, single hard link, 64 KiB cap) and the commit-ambiguous rename reconciliation (accept only exact prior or exact candidate bytes; mutation still returns unavailable) match the spec (`src/auth/keyring.rs:641-701`; `src/secure_file.rs`).
- **Rescue hardening** is all present: AUTOINCREMENT refusal, unshadowed-rowid-alias copy with bidirectional equality proof, managed four-key refusal with the stable diagnostic, and the exact-stored-name source / strict-grammar target split (`src/storage/auth_rescue.rs:330-349`, `:369-373`, `:496-546`, `:769-838`).
- **Cross-document reconciliation** checks out: LLP 0059's `#durable-session-clock-floor` and `#rollback-and-ambiguous-commit` sections exist and say what 0057 attributes to them; LLP 0058 line 831 consumes "LLP 0057's revoke-all transaction" and the downgrade code genuinely does (`src/storage/auth_mode.rs:874`, tested at `:2390`); LLP 0024's `auth.mintSession` row (its line 134) matches 0057's nested-flat-payload reconciliation verbatim.
- Mint/rotation **commit-ambiguity reconciliation** is implemented and tested (`provider.rs:4021-4036`, predecessor/successor test at `:6614`).

## Concerns

**MATERIAL 1 — Acceptance overclaim: issuance-collision coverage "through the production HTTP and host-operation paths."**
`Acceptance, "Token-digest uniqueness" bullet (~line 1551) claims the retryable-collision outcome is "asserted through the production HTTP and host-operation paths, not only a test-only helper." In fact: collision *reporting* is tested at the production plan/commit layer (`provider.rs:6540`), but three-candidate exhaustion is exercised only through the `#[cfg(test)]` helper `mint_session` (`provider.rs:2546`, used at `:5524`), which has its own retry loop separate from the server coordinator loops; no test drives a collision through the HTTP route, host-op, or `server.rs` coordinator loops, and nothing under `tests/` references `CandidateCollision`. Since this was the headline ENG-25001 defect obligation, the acceptance sentence overstates the closing evidence. *Resolution:* land a vector injecting a tombstone-colliding candidate through the production HTTP or host-op path asserting bounded retry and the retryable outcome (and exhaustion → `PROVIDER_UNAVAILABLE`), or reword the bullet to the plan/commit-layer coverage that exists.

**MATERIAL 2 — Acceptance overclaims in the rescue bullets.**
(a) The "managed sessions-era/staged/quarantined database is either atomically four-key-consistent after rescue or refused" vector does not exist: the rescue test helper deletes all three managed keys before every test (`auth_rescue.rs:1044-1049`), so no test ever reaches `SNAPBACK_AUTH_RESCUE_MANAGED_STATE_UNSUPPORTED` (present only in the diagnostics registry, `server.rs:21740`). (b) "Commit-ambiguity reconciliation (mint, rotation, rescue): fault injection at the commit boundary" — for rescue, all eight injection points fire *inside* `rescue_in_transaction` before `commit()` (`auth_rescue.rs:388-464`; commit at `:222`); `rescue_successor_is_durable` is never fault-injected. Mint/rotation are covered, so this is rescue-specific. *Resolution:* add the two rescue vectors, or scope the acceptance bullets to pre-commit rollback and code-inspection status for the untested paths.

**MINOR 1 — "Reusable bulk-revocation transaction … both consume" is half-true.** Declared restore inlines a duplicate of the UPDATE plus generation-max guard (`storage/auth.rs:1135-1151`) instead of calling `revoke_all_sessions_in` (`:1420`); only the 0058 downgrade consumes the shared function. Durable outcomes are identical today, but two copies of the fail-closed guard can drift. *Resolution:* refactor restore to consume the shared transaction, or reword `Bulk session revocation to require identical durable outcomes rather than shared consumption.

**MINOR 2 — Backup outcome reporting.** `Consistent backup step 6 says "The operation returns which of the three occurred," but `create_backup` returns only a manifest or `SNAPBACK_AUTH_BACKUP_INVALID`; Unpublished vs CommitAmbiguous differ only in message text, and the plain rename-error message ("artifact directory could not be published", `backup.rs:1082`) does not convey ambiguity. The safety behavior (cleanup suppression after a rename attempt) is correctly implemented (`backup.rs:1076`, `:1104`). *Resolution:* surface a named outcome/diagnostic detail distinguishing CommitAmbiguous, or reword the claim to the surfaced distinction.

**MINOR 3 — Rescue reconciliation prose misdescribes the code.** The spec says production reconciliation "reopens the database after a commit error" and reports failure for exact-predecessor vs terminal recovery otherwise; the code re-reads on the same connection and returns the same commit error for every non-successor state (`auth_rescue.rs:222-235`). Safe under SQLite atomicity, but the descriptive sentences should match. *Resolution:* align prose with code or implement the reopen/three-way split.

**MINOR 4 — Generation/timestamp schema bounds.** The pinned `generation` domain is `1..=2^53-1`, but the committed credential schema's `sessionGeneration` minimum is `0` (`manifest.rs:2427-2433` sets only the max), and item-4's `auth.session.output.schema.json` `session_generation` has no maximum at all (`auth/handshake.rs:165`). The handshake is item-4-owned, but the domain pin is this document's. *Resolution:* add the bounds or explicitly note the schema laxity.

**EDITORIAL 1 — Diagnostics table omission.** `Diagnostics lists `RESCUE_INVALID`, `RESCUE_SCHEMA_UNSUPPORTED`, and `BACKUP_INVALID` but omits `SNAPBACK_AUTH_RESCUE_MANAGED_STATE_UNSUPPORTED`, which `Transactional algorithm makes normative.

## Verdict

**NOT READY.** Two MATERIAL concerns remain, both acceptance-accuracy rather than design or implementation defects: the code verified well, so each is resolvable either by landing the named vectors (issuance-collision through a production route; rescue managed-state refusal; rescue commit-boundary reconciliation injection) or by precisely scoping the Acceptance text to the coverage that actually exists. Advisory only — no ratification or Status change performed.

## Blind final cross-family review — 2026-07-15

### Provenance

- Reviewer family: Claude Fable
- Provider/runtime: Claude Code 2.1.210
- Model: `claude-fable-5`
- Method: read-only plan-permission CLI; blind to `llp/reviews/`
- Session: `3dcf3648-673d-4107-8382-3d7bfca73f72`
- Reviewed commit: `8f03e42`
- Human authorization: ENG-24996 completion request
- Secrets or redactions: none

### Verbatim review artifact

# Blind final implementation review — LLP 0057 @ 8f03e42

## Context
Blind final implementation review of `llp/0057-auth-provider-protocol.spec.md` at exact commit 8f03e42 (verified HEAD, clean tree). Read-only; nothing under `llp/reviews/` was read; no files modified. Deliverable (in final message, ≤700 words): VERDICT, MATERIAL, MINOR, evidence as file:line, resolution criteria.

## Method
1. Full read of LLP 0057 (1783 lines) + LLP 0059 changed sections + the 8f03e42/c095370 diffs.
2. Explore agent A verified all eight ENG-25001 implementation obligations in Rust (cross-table digest uniqueness, family-alarm parse gate, clock-floor seeding order, backup three-state envelope, stdin impersonation intake, rescue identity/four-key/commit reconciliation, frozen-v1 fixture, 0058 downgrade bulk revocation) — all VERIFIED with impl+test line evidence.
3. Explore agent B verified all six cross-document ownership claims (0055, 0058, 0059 anchors, 0039 frozen deferrals, sessionGeneration-0 sentinel, 0045/0053 boundaries) — all CONSISTENT.
4. Direct inspection of the reentrant resume guards (`packages/snapback-contract/auth-coordinator.mjs:688-714`, `:728-742`), barrier machinery (`:1221-1247`, `:1298-1351`), regression tests (`auth-coordinator.test.mjs:412-490`), and the composed Contract test (`auth-coordinator-contract.test.mjs`). Ran both JS suites (pass) and `./ref-check` (0 errors).

## Findings (final)
- MATERIAL: none.
- MINOR 1: mismatch-during-resume path falls through to nested peer adoption that replaces `#activeBarrier` mid-resume (auth-coordinator.mjs:743-750 → 1328), while the reentrant guard throws STALE; 0059:1373-1379 pins only exact-match. Untested interleaving.
- MINOR 2: 0059:1998-2000 attributes the no-recursion proof to the composed Contract test; the actual proof is the coordinator unit suite (surface resume only schedules post-barrier work, index.mjs:2393-2396, 2210-2228).
- MINOR 3: 0057:164-166 catalog-maxima floor seeding is implemented only inside the declared-restore transaction (storage/auth.rs:1119-1134), not the generic seed (auth/runtime.rs:326-337).

## Verdict
READY — delivered in final message with resolution criteria.

## Blind final2 review — 2026-07-15

### Provenance

- Reviewer family: Claude Fable
- Provider/runtime: Claude Code / claude-fable-5
- Method: read-only blind review; archived verbatim from `/private/tmp/eng25001-final2-fable-0057.md`
- Session: `not recorded in supplied artifact`
- Reviewed commit: `3ac047322d055fad03e8308fdc0905d758eb9f61`
- Human authorization: ENG-25001 completion request
- Secrets or redactions: none

### Verbatim review artifact

VERDICT: READY

MATERIAL:
- None.

MINOR:
- Diagnostic-only bug: `#finishClearingOwned`'s catch (packages/snapback-contract/auth-coordinator.mjs:1206–1215) sets `this.#activeBarrier = null` before building the `SNAPBACK_AUTH_TRANSITION_FAILED` details, so `phase` is always `'unknown'` for clearing-phase failures (the resume-path error at :1288–1294 reports phase correctly). Fix by capturing the phase before nulling.
- Evidence-recording gap, editorial: the acceptance-evidence paragraph (llp/0059-session-projection-and-client-barrier.spec.md:2024–2031) names the during-resume durable-advancement suites but not the two committed delayed-delivery reload regressions (pre-barrier→during-resume, auth-coordinator.test.mjs:602–660; post-barrier, :662–703), and no revision note records 3ac0473. The normative rule (spec :1396–1402, "begun before the barrier but completing after settle … a mismatch fails stale") plus acceptance §Coordinator races item 1 (:1979–1983) already require the behavior, so this is prose lag, not drift; adding one evidence sentence would aid ratification review.
- Liveness/ergonomics: `synchronize()` dedup (auth-coordinator.mjs:714) can hand a caller arriving after a completed barrier the still-pending pre-barrier promise, which then rejects `SNAPBACK_CLIENT_AUTHORITY_STALE` even though a fresh reload would succeed. Fail-closed and self-healing (the 3ac0473 test's follow-up `synchronize()` at test :701 succeeds); consider not deduping onto a reload whose ownership callback predates the last barrier.
- Hardening: a `transition()`/`compareAndClear()` initiated while a barrier is in its resume phase (e.g., a terminal `auth_error` arriving on the freshly resumed socket via demos/_kit/client.mjs:3975–3991) can start a nested `#finishClearingOwned` that replaces `#activeBarrier` mid-resume, interleaving participant phases and letting the outer transition return a by-then-stale capture. All traced outcomes fail closed (`captureFor` :419–425 refuses clearing records, durable CAS and `#adoptSettled` :1485–1495 block stale writes/adoption, recovery converges from durable clearing), and the spec claims only `synchronize()` semantics during resume (:1392–1395), so this is an unclaimed corner — suggest a reentrancy guard or spec sentence plus a test, not a blocker.

EVIDENCE:
- Target: the prompt's filename `llp/0057-session-authentication-and-authorization.spec.md` does not exist at 3ac0473 (or in history); the session/AuthCoordinator spec is `llp/0059-session-projection-and-client-barrier.spec.md` (numbered 0057 before renumbering commit 69c718d). Read completely (2172 lines): Summary/Provenance, Server authority model, Two-phase mutation, Locking, Connection-bound authority, Fenced effects, Reset/restore, Client custody & AuthCoordinator (:1145–1569), Client store (:1570–1675), Contract/kit participation, Handshake/readiness, Diagnostics, Executable acceptance (:1858–2083), Implementation handoff, Open decisions/Review triage (:2113–2172).
- Cut 1 (synchronize completing during resume): spec :1390–1399; implementation reentrant path auth-coordinator.mjs:688–713 (exact settled revision/epoch/key or `SNAPBACK_CLIENT_AUTHORITY_STALE`), adoptPeer barrier-active fence :1227–1238 (5c23b44), plain-capture fence (baaf890); tests auth-coordinator.test.mjs:412–448 (owner exact, no recursion), :450–490 (peer exact), :492–545 (durable advanced during owner resume → `SNAPBACK_AUTH_TRANSITION_FAILED`, stays blank, later clean sync adopts peer successor), :547–600 (peer-adoption resume race → STALE, resume ran once), :602–660 (pre-barrier reload delivered during resume → STALE).
- Cut 2 (synchronize result completing after the barrier): 3ac0473 diff to auth-coordinator.mjs only — hoisted `exact` check, `exact && !publicationPaused` idempotent confirmation (:1239–1243), `localAtRead`/`publicationPausedAtRead` fence (:730–745, :1244–1256), unconditional plain-capture exact check incl. `result === null` (:1260–1277); regression test :662–703 (delivery delayed past barrier completion → STALE, successor capture intact, subsequent synchronize clean). Spec language pre-pinned by 5c23b44 (:1396–1402), so no spec change was required in 3ac0473; interaction with the during-resume fences preserved (barrier-active branches semantically unchanged).
- Commit chain inspected: 8f03e42 (reentrant resume path + spec :1389–1396 predecessor text + acceptance note), 5c23b44 (generalized reentrant check, adoptPeer fence, real Contract participants `await coordinator.synchronize()` in resume at packages/snapback-contract/index.mjs:2392–2401 and :3906–3911, spec normative/acceptance text, intent-recovery stranding), baaf890 (plain-capture during-resume fence + test), c095370 (readiness gates: typed construction receipts with injected-failure tests in src/auth/runtime.rs; spec :2013–2023, :2056–2060), 3ac0473 (post-barrier rejection).
- Composed evidence: auth-coordinator-contract.test.mjs mounts real single/multi-live surfaces (:246, :380) and asserts each real participant resumed exactly once (:394–417); ENG-25001 items verified — lock-rank guards src/auth/session_projection.rs:31–92 with inversion test :2876; L9 fixture src/server.rs:14937 (substantive, holds affected commit while unrelated room progresses); custody format-2 intent validation auth-coordinator.mjs:237–272/:305–400 with tests :164–323; phase-8 ownership release (test :1110–1138) and rotation network outside ownership (:835–876); terminal 4401/`auth_error` latch demos/_kit/client.mjs:2302–2323/:3911–3991; handshake cache `compareAndCommit` fence demos/_kit/client.mjs:969/:1133/:1512/:1693; LLP 0008 one-key Web-Lock localStorage adapter client-store.mjs:2938–2978 with delayed-predecessor-writer test offline-replay.test.mjs:1095–1127; fallback-lease fencing and two consecutive takeovers (+1 tokens) auth-custody-indexeddb.test.mjs:132–291.
- Governing context: LLP 0057 §ENG-25001 closure (:1755–1786), LLP 0058 §ENG-25001 disposition (:1860–1893) and 5c23b44 deltas (witness pair, `no-store, private`, descriptor pinning, readiness-negation wording), LLP 0000 (:359–368) — all consistent with LLP 0059 at HEAD; worktree clean at 3ac047322d055fad03e8308fdc0905d758eb9f61; llp/reviews and secrets untouched.
