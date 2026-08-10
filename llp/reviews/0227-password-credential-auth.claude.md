# Review artifact — LLP 0227 (password credential auth) — claude family

Target: `llp/0227-password-credential-auth.rfc.md`
Loop: llp-super-refine 2026-08-10, independent-loop topology, orchestrated by
Claude Fable 5 (session 0f56679e); reviser = orchestrator.

## Round 1 — 2026-08-10

- Reviewer: claude family — fresh general-purpose subagent, model
  claude-fable-5 (session model), no shared context with the orchestrator's
  revisions or the other family.
- Capsule: detached worktree at commit `1c19e047b` (structural exclusion of
  `llp/reviews/0227*` — none exist at that commit; no-reviews/no-worktree
  instruction residue self-attested).
- Target revision: (b), sha256
  `6f70a9842429b593910859cea4f48fa24393cba3af0f93a260c3eb8c8d7cf14d`.
- Instructions: sr-review-r1 template, sha256
  `f78b71c5d1d9d92f9aaf0c8dcdba3e6da6878d11a29e94e12b5c5ccace483c4c`.
- Verdict: **NOT READY** (2 MATERIAL concerns; binds to the capsule/target
  hashes above).

### Verbatim review

**Summary**

LLP 0227 decides to add an email+password credential class to the existing LLP 0057 sessions surface — one principal, multiple credentials, identical composed credential response — with argon2id/PHC storage, upgrade-on-verify, a declared lockout/budget contract, and a gated PHC-import host operation. The direction is right and well-evidenced: the commissioning ruling, the benchmark record, and the governing LLPs all check out, and the design composes cleanly with the repo's auth substrate at the architectural level. However, the RFC's identity-row mechanics do not fit the catalog as it actually exists (`_auth_identities` keyed by `(provider, subject)`, `verified_at_ms NOT NULL`, `session.provider` derived from the identity join), and the document's stated constraints ("adds one table", "refresh … unchanged") make the conflict unresolvable by an implementer without contradicting the text. Two MATERIAL concerns on that axis.

**Direction assessment**

The central decision — a second proof-of-address-control credential on the same sessions core, not a parallel identity/token system — is correct and is the strongest part of the document.

- The demand signal is real and verified: the pilot record shows B2 auth 48 (Snapback) vs 82 (Supabase) (`benchmarks/records/2026-08-09-social-messenger-p2-pilot.md:45`), F5's headline "no password auth (undocumented session-mint HTTP shape)" (line 105), and the GoTrue 30-signups/5min/IP meter costing ≈2.62 h (lines 60–62). The author ruling in `issues/20260809-password-credential-auth.md` commissions exactly this scope, including the scope fence.
- Reusing the sessions surface honors LLP 0151's structural rulings, which this RFC correctly cites: identities-vs-credentials separation (`llp/0151-…rfc.md:366-373`), the tier-1 username+password package (lines 248–266), session rotation + revoke-others on credential change (line 388), and the last-authenticator rule deferred because v1 ships no unlink (lines 393–395 — the RFC's deferral reasoning is valid).
- KDF-outside-the-writer-lock is genuinely LLP 0011's Valet-proven rule (`llp/0011-auth-and-permissions.rfc.md:119`). The stripes, budgets, mailbox gating, and redaction posture all match LLP 0057 as written.
- The scope fence (no OAuth, no passkeys, no recovery codes) matches the commissioning ruling verbatim and is the right cut for the benchmark gap.

The idea is right. The defects below are about mechanics the document pins incorrectly or leaves in a state where the plausible implementation is wrong.

**Concerns**

1. **Identity provider value, exchange unification, and `session.provider` semantics are jointly incoherent — MATERIAL.**
   Text at issue: "create the `_auth_users` row, canonical-address identity, and credential"; "`session.provider` reporting the credential class"; "Refresh, logout, … — everything downstream of minting — is LLP 0057 unchanged"; "The catalog … adds one table."
   Evidence: `_auth_identities` is keyed by a unique `(provider, subject)` index (`src/storage/auth.rs:402-407`) and already hosts multiple provider strings (`'email-code'`, `'agent-credential'` — `src/storage/auth_agents.rs:767`). The email-code exchange resolves identities by `provider = 'email-code' AND subject = address` and **creates a brand-new user** when none matches (`src/auth/provider.rs:3914-3944`). `session.provider` on refresh/resolution is read from the joined `identity.provider` (`src/auth/provider.rs:2834, 2856, 2950`), not from any per-session record — `_auth_sessions` has no provider column (`src/storage/auth.rs:534-559`).
   Consequences: the RFC never says what `provider` a password-signup-created identity carries. If an implementer picks `'password'` (a plausible guess given the (provider, subject) model), a later email-code exchange for the same address creates a *second principal*, destroying the RFC's core same-principal claim and acceptance criterion 2. If they pick `'email-code'` (the guess that unifies), then refresh — which the RFC pins as "unchanged" — reports `session.provider = "email-code"` for a password-minted session, contradicting "`session.provider` reporting the credential class"; the mint response and refresh response for the same session would disagree. There is no reading that satisfies all three commitments plus "adds one table."
   Fix: pin the identity provider value explicitly; state whether email-code exchange's lookup changes; and reconcile `session.provider` (either declare it reports the identity provider everywhere with a separate mint-time indicator, or admit the catalog/DTO change that makes per-session credential-class reporting real).

2. **"Not email-verified" is unrepresentable in the catalog as amended — MATERIAL.**
   Text at issue: "a password-signup-created identity records creation time but is **not** email-verified; verification happens only when an email-code exchange later succeeds for the same address. Verified status gates nothing in v1 except reset delivery in production profiles."
   Evidence: `_auth_identities.verified_at_ms` is `INTEGER NOT NULL` (`src/storage/auth.rs:520-529`); every existing insert sets it to now (`src/auth/provider.rs:3932-3940`); the exchange path never *updates* `verified_at_ms` for a pre-existing identity — it only inserts new rows. The RFC's migration "adds one table" and touches nothing else.
   Consequences: the steered implementation ("records creation time") is `verified_at_ms = now`, which is byte-identical to a verified identity — silently defeating the one thing verified status is declared to gate (production reset delivery). The alternative (a `0` sentinel, permitted by the CHECK) plus a modification to the exchange transaction to promote unverified→verified is workable but is nowhere stated, and the exchange change contradicts "everything downstream of minting is LLP 0057 unchanged" in spirit and 0057's frozen-catalog recognition discipline in letter.
   Fix: pin the representation (sentinel vs. a nullable column via the versioned migration), name the exchange-path change that performs verification, or drop unverified semantics from v1 and gate production reset delivery by another means.

3. **"LLP 0057's bulk-revocation transaction scoped to the user" does not exist — implementation-phase.**
   0057's owned bulk-revocation transaction revokes "**every** session not already revoked" instance-wide and names exactly two consumers (0058 downgrade, declared restore) (`llp/0057-auth-provider-protocol.spec.md:874-890`). No user-scoped variant exists in the spec or in code (the only per-user machinery is the session-cap oldest-revocation). The required *behavior* (revoke the user's other sessions on change/reset) is unambiguous and correct per 0151, so an implementer can settle it — but the citation should say "a user-scoped variant preserving 0057's revocation invariants (generation bump, no deletion, clock floor)" rather than claiming reuse of a transaction whose literal reuse would revoke every user on the instance.

4. **No capability-index GAP row exists to "flip" — implementation-phase.**
   Acceptance criterion 7 says "the capability row flips from GAP with route witnesses." `guide/capabilities.md` contains no password row at all (verified: zero matches for "password"); the nearest row, `auth.sessions`, is already `shipped` for email-code (`guide/capabilities.md:73`). The criterion should say a new row is *added* (or `auth.sessions` amended), and arguably a GAP row should be filed now per the index's own convention.

5. **Production blind-accept forks the signup success DTO, unreconciled with the routes table — implementation-phase.**
   The routes table pins `POST /auth/password/signup` → "200, composed credential response" unconditionally, but §Threat notes' production blind-accept posture returns a "uniform accepted shape, no session" — which, to be uniform, must also apply to *new*-address production signups (otherwise shape itself is the oracle). This is confined to open question 1 and annotated as not-shipped, so it is settleable — but the routes table or OQ1 should acknowledge the profile-dependent DTO fork so criterion 1's script isn't written against a shape production would break.

6. **Reset's interaction with the one-active-challenge invariant unstated — implementation-phase.**
   Reset "reuses LLP 0057's email-code challenge machinery unchanged," but 0057 permits one active challenge per canonical address (`_auth_verification_codes_one_active`, `src/storage/auth.rs:452-457`) and its exchange *also* consumes valid codes by minting a session. So a reset-requested code is equally spendable at `/auth/exchange`, and a reset request supersedes an outstanding sign-in challenge (and vice versa). Security-equivalent (both prove address control), but the doc should say so; acceptance suites and the guide page will otherwise trip on it.

7. **Status header inconsistency — implementation-phase.**
   Header says `Status: Review` with revision (b) recording the Draft→Review transition (lines 4, 10–11); the closing §Status still says "Draft (a)" (line 311). One of them is stale.

**Verifications performed**

- Commissioning ticket `issues/20260809-password-credential-auth.md`: exists; author ruling 2026-08-10 with the exact scope fence the RFC restates. Checks out.
- Benchmark record `benchmarks/records/2026-08-09-social-messenger-p2-pilot.md`: B2 48/55/82 (line 45), F5 headline no-password-auth item (line 105), GoTrue fixed 30-signups/5min/IP and ≈2.62 h auth-meter loss (lines 60–62). All check out. The "hand-rolled scrypt in a gateway" detail appears in the ticket, not the record itself — consistent, not contradicted.
- Catalog schema (`src/storage/auth.rs:306-476, 486-560`): `_auth_users`, `_auth_identities`, `_auth_sessions` shapes; the composite unique index `_auth_identities_id_user_uq (id, user_id)` exists, so the RFC's proposed composite FK is valid and mirrors `_auth_sessions`' pattern. Checks out. Also surfaced the `verified_at_ms NOT NULL` and `(provider, subject)` facts behind concerns 1–2.
- Exchange/session-creation core (`src/auth/provider.rs:3910-3982`): provider-scoped identity lookup, new-user creation, session-cap enforcement in-transaction, `SessionResponse.provider` population; refresh derives provider from the identity join (`provider.rs:2834-2950`). Basis of concern 1.
- LLP 0057: composed credential response shape `tokenType/token/refreshAfter/session/authorityDescriptor` (lines 1019–1037) — matches the RFC's description exactly; §Canonical address (line 671); 256 address stripes (line 694); per-address/global budgets (lines 229–231, 708–710); request-code always-202 non-oracular (line 862); capture mailbox dev/test/demo-only and impersonation-gated (lines 900–930, "mailbox read" among the four gated effects); bulk revocation instance-wide (lines 874–890 — basis of concern 3); challenge attempts capped at 5 transactionally (lines 228, 489–499, 738–739); credential responses `no-store` (line 1004). All check out except as noted.
- LLP 0058: `auth.mintSession` requires AdminWrite + exact process ImpersonationCapability, dev/test/demo only (line 2012) — supports the RFC's `session mint` characterization and the import-op gate class. Checks out.
- LLP 0151: identities/credentials separation, tier-1 password package with NIST-aligned screening and Argon2-outside-lock, sessions-consequences, last-authenticator rule, recovery-codes-for-unverified-email packaging (lines 248–266, 366–401). The RFC's deferral of recovery codes is an honest, flagged narrowing. Checks out.
- LLP 0011 line 119: Argon2 outside the DB lock, Valet-proven. Checks out.
- LLP 0024 line 135: "One core, thin projections." Checks out. LLP 0037: Rust-owned DTO schemas, unknown-field rejection (line 274). Checks out.
- LLP 0045: notifications outbox with email-first delivery; 0057 explicitly names "a future LLP 0045 delivery adapter" for code delivery — the RFC's "external prerequisite" framing checks out.
- Error codes: `SNAPBACK_AUTH_THROTTLED` exists (`src/server/api_error.rs:61`); no existing `SNAPBACK_AUTH_PASSWORD_*` collisions. Checks out.
- Client surface: `authRequestCode`/`authExchange` on the client with AuthCoordinator custody (`packages/snapback-client/index.mjs:4986-5010`) — proposed `authPassword*` naming is consistent. Checks out.
- `guide/auth/sessions-and-principals.md` exists; `guide/auth/passwords.md` does not (to be created — fine); no password capability row exists (concern 4). `AuthProgramReadiness` lives in `src/auth/mode.rs` (cited via `guide/capabilities.md:79`), so "gains a password-provider facet" has a real anchor.
- Not verified: argon2id parameter choice against OWASP text (out-of-repo; the values are the well-known OWASP minimum-baseline configuration and are stated as pinned policy, which is the right structure). The `SNAPBACK_PASSWORD` env carrier (OQ3) sits in tension with 0057's never-from-environment posture for secret bearers (`llp/0057…:958-961`) — appropriately left as an author question.

VERDICT: NOT READY

## Round 2 — 2026-08-10 (delta round)

- Reviewer: claude family — fresh general-purpose subagent (not the round-1
  reviewer, not the reviser), model claude-fable-5.
- Capsule: detached worktree at commit `0eac1d309` (0 target review
  artifacts present, verified).
- Target revision: (c), sha256 prefix `61e11d642156d73e`.
- Instructions: sr-review-r2 delta template (IN-DELTA vs PRE-EXISTING
  classification mandatory).
- Verdict: **NOT READY** (2 MATERIAL, both IN-DELTA; binds to the
  capsule/target hashes above).

### Verbatim review

**1. Summary**

Revision (c) is a substantial, well-grounded re-architecture: the `'password'`-provider identity namespace, set-displacement rule, step-up on first set, exact-predecessor verification fence, address-keyed blind attempt ledger, user-scoped revocation, catalog v3, and split import modes are all verifiable against the substrate and mostly correct against it. I verified the load-bearing repo claims (identity-join provider derivation, instance-wide-only bulk revocation, challenge-row budget substrate, anonymous-coordinator `authExchange`, `withCredentialRotation`, capability-index absence of an `auth.passwords` row, benchmark numbers, commissioning ruling) and they hold. Two MATERIAL gaps remain, both introduced by the delta: the set form's wire contract cannot carry the step-up proof it now requires, and the reset flow's composition with the new two-principal squat model contradicts the document's own "sanctioned unification" rule.

**2. Direction assessment**

The direction is right. The RFC implements exactly the author's commission (`issues/20260809-password-credential-auth.md` lines 19–26: email+password on the sessions surface, argon2id, non-interactive, declared lockout posture, scope-fenced away from OAuth), and targets precisely the four properties GoTrue won on (B2 48 vs 82 confirmed in `benchmarks/records/2026-08-09-social-messenger-p2-pilot.md` lines 45, 60–62). The core architectural choices are sound and substrate-aligned: "one principal, multiple credentials" follows LLP 0151's identities-vs-authenticators rule (`llp/0151-...rfc.md` lines 366–374); the separate `'password'` identity row is the correct pre-hijack containment shape and composes with the existing exchange path unmodified (all email-code lookups are already provider-scoped — `src/auth/provider.rs:3954, 4031, 4400, 4805`); the "no new column, no DTO change" claim for `session.provider` is true (sessions store `identity_id`, no provider column — `src/storage/auth.rs:334–358` — and session reads join `_auth_identities` and report `identity.provider` — `src/auth/provider.rs:2871, 2921`); the new user-scoped revocation is genuinely necessary (0057's helper revokes "every session not already revoked" instance-wide — `llp/0057-...spec.md` §Bulk session revocation); and the observation that 0057's budget substrate counts retained challenge rows, which password signin does not create, is correct and correctly resolved by the attempt ledger.

**3. Concerns**

1. **MATERIAL / IN-DELTA — the set form's pinned wire shape cannot carry the step-up proof it requires.** Revision (c) added: "The **set** form (`currentPassword: null`, principal has no password credential) additionally requires a **fresh operation-bound email-code challenge** consumed in the same transaction" (§Principal binding). But the routes table pins `POST /auth/password/change` body as `{ currentPassword, newPassword }`, the client method as `client.authPasswordChange({ currentPassword, newPassword })`, and the CLI as `--password-stdin # current\nnew\n` — none has a slot for `challengeId`/`code`, and §Surface declares `deny_unknown_fields` on all DTOs. An implementer is forced to invent the challenge carriage (extra body fields? a separate set route? header?) and, worse, to guess **which address** the set form binds: the challenge's address, or the principal's existing `'email-code'` identity's address — these diverge for broker-minted or imported principals with no email-code identity, and the displacement precondition ("when the acting principal holds the address's `'email-code'` identity") reads differently under each guess. Fix shape: pin the set-form request shape (all three surfaces), state the address-derivation rule, and state whether a principal with no `'email-code'` identity can set at all.

2. **MATERIAL / IN-DELTA — reset contradicts the "sanctioned unification" rule in the squatted-address configuration.** The delta declares: "the set-displacement rule above is the sanctioned unification, always in favor of email proof" (§Composition and precedence). But §Principal binding's reset bullet resolves the credential purely by the challenge's address — "verifies the code for the credential's address, replaces the hash, revokes the user's other sessions, and mints a fresh session" — so when the address's `'password'` identity belongs to a squatter principal, an email-proving caller is minted **into the squatter's principal** (inheriting its attacker-seeded content and history), the opposite disposition from displacement (squatter keeps its account, loses password login). A victim who already owns the address's `'email-code'` principal and runs "forgot password" lands in the attacker's account instead of their own. The mechanism is deterministic but the two rules give opposite outcomes for the same trust configuration, and nothing tells the implementer whether reset should refuse, displace, or take over when the password identity's principal differs from the email-code identity's principal. Fix shape: pin reset's behavior in the split-principal configuration (e.g., reset refuses — or displaces per the sanctioned rule — whenever the address's `'email-code'` identity exists on a different principal; plain reset only otherwise), or explicitly rule takeover as intended and amend the "sanctioned unification" sentence and the containment narrative to match.

3. **implementation-phase / IN-DELTA — dual failure-accounting stores without a declared authority.** The credential DDL (pre-existing columns `failed_attempts`, `locked_until_ms` in §Credential storage) coexists with (c)'s address-keyed, account-existence-blind attempt ledger, which must be the store that fires `PASSWORD_LOCKED` "identically for existing and missing addresses." The credential-row columns are now redundant or projection-only, and no reconciliation rule is stated. Acceptance criterion 3 pins the observable behavior so a wrong guess is caught, but the RFC should either drop the columns or declare them projections of the ledger.

4. **implementation-phase / IN-DELTA — "source class" is undefined.** The anti-lockout-DoS property rests on "the lock is scoped to (address, source class) with a global budget backstop" (§Lockout), but "source class" appears nowhere else in the document or the corpus I searched. Any reasonable partition plus the global backstop satisfies the stated property, so this identifies no defective decision, but v1 should name the partition (per-IP, loopback-vs-remote, etc.) before the contract is called declared.

5. **implementation-phase / IN-DELTA — fence outcome "refuses or restarts" vs acceptance "refuses."** §Principal binding's fence permits "refuses or restarts" on predecessor mismatch; acceptance criterion 4 asserts the racing signin "refuses rather than minting." Pin one (refuse), since a restart that re-verifies against the successor hash has observably different semantics.

6. **implementation-phase / IN-DELTA — catalog v3's frozen shape is only partially enumerated.** V3 membership is governed by 0057's exact-recognition discipline (`validate_exact`, frozen table/index sets — `src/storage/auth.rs:166–179, 2006–2014`), and (c) declares the attempt ledger a catalog relation ("a second bounded relation") without DDL, while also leaving "v1→v3 composes that deferral" readable two ways (v1 stays v1 vs. upgrades later). The v1 reading converges behaviorally today (password routes refuse pre-v3 either way), and DDL can land at implementation, but the frozen-catalog discipline makes the ledger's shape part of the version contract worth pinning at spec time.

**4. Verifications performed**

- `src/storage/auth.rs` (lines 166–179, 306–420, 486+, 1977–2014): catalog v1/v2 markers, `CURRENT_CATALOG = &CATALOG_V2`, exact-recognition validation, `_auth_identities` schema with `provider`/`subject`/`verified_at_ms`, unique `(provider, subject)` and `(id, user_id)` indexes, `_auth_sessions` with `identity_id` and composite FK, no provider column.
- `src/auth/provider.rs`: provider-scoped email-code lookups (3954, 4031, 4400, 4801–4840); session reads joining identities and populating `provider: row.get(3)` (2871–2954); `SNAPBACK_AUTH_THROTTLED` in use; hardcoded `provider: "email-code"` only in the in-memory issuance projection.
- `llp/0057-auth-provider-protocol.spec.md`: §Canonical address (671), 256 stripes (694, 229–231), challenge created whether or not an identity exists (729), non-enumeration (1614), one-active-challenge supersession (716), composed response shape `tokenType`/`refreshAfter`/`authorityDescriptor` (1021–1050), instance-wide bulk revocation (§Bulk session revocation), §Security and redaction (1546), `SNAPBACK_AUTH_THROTTLED` registry row (1147), camelCase-per-LLP-0037 (1002), per-address/global budgets (229–230, 708–709).
- `llp/0151-...rfc.md` (215, 248–268, 366–401, 425–427): tier-1 password package, zero-dependency floor, recovery-codes-at-creation rule (deferred by 0227's scope declaration), identities/credentials separation, step-up rule, session rotation on change, non-oracular budgets.
- `llp/0011-...rfc.md` line 119 (Argon2 outside the DB lock); `llp/0059-...spec.md` exact-predecessor discipline (1627+); `llp/0024-...spec.md` line 135 (one core, thin projections).
- `packages/snapback-client/index.mjs`: `authExchange` requires AuthCoordinator custody and anonymous predecessor authority (5008–5017); `withCredentialRotation` with same-authority and same-authority-instance verification (5259–5290).
- `guide/capabilities.md` auth rows (73–79): no `auth.passwords` row exists; `AuthProgramReadiness` in `src/auth/mode.rs` (line 79 witness) and `authProgramReadiness` in `src/server.rs`.
- `benchmarks/records/2026-08-09-social-messenger-p2-pilot.md`: B2 48/55/82 (45), GoTrue 30-signups/5min/IP and ≈2.62 h auth-meter loss (60–62), F5 gap list (104).
- `issues/20260809-password-credential-auth.md`: commissioning ruling and scope fence match the RFC verbatim.
- `src/host_ops.rs` (59, 799, 2024) and `src/admin_impersonation.rs`: `auth.mintSession` host op and impersonation-capability gate class exist for the import-op analogy.
- `guide/auth/sessions-and-principals.md` exists. No argon2 dependency in `Cargo.toml` — consistent with "No implementation has begun."
- Not verified (out of reachable scope): LLP 0045's current adapter status beyond its file's existence; OWASP parameter currency (19 456 KiB / t=2 / p=1 matches the cheat-sheet values as of my knowledge, not re-checked live).

**5. Verdict**

VERDICT: NOT READY

## Round 3 — 2026-08-10 (delta round; final budgeted round)

- Reviewer: claude family — fresh general-purpose subagent, model
  claude-fable-5.
- Capsule: detached worktree at commit `ceb7803c4` (0 target review
  artifacts present, verified).
- Target revision: (d), sha256 prefix `1bb56bc226e46052`.
- Instructions: sr-review-r3 delta template.
- Verdict: **NOT READY** (3 MATERIAL, all IN-DELTA; binds to the
  capsule/target hashes above).

### Verbatim review

**1. Summary**

Revision (d) is a genuinely responsive round: the catalog-authority collision with LLP 0214 is now acknowledged and deferred, reset is pinned same-principal-only with the four configurations enumerated, displacement is made realizable against the actual schema (verified: `_auth_sessions` FKs `(identity_id, user_id)` with `ON DELETE CASCADE` and `PRAGMA foreign_keys = ON`), the first-set step-up gets a wire carrier, and the lockout ledger gets DDL. Almost every repo-verifiable claim checks out. However, three in-delta consistency defects remain: the newly pinned single-authority attempt ledger cannot carry the windowed signup/signin budgets the same section declares; the 0214 shape-supersedes clause, taken literally, destroys the RFC's own displacement mechanics (0214's password shape has no identity link, so nothing cascades); and acceptance criterion 7 still demands "catalog-v3 readiness" after (d) withdrew the v3 claim.

**2. Direction assessment**

The direction is right. The benchmark evidence is real and correctly cited (B2 48 vs GoTrue 82, `benchmarks/records/2026-08-09-social-messenger-p2-pilot.md:45`; the fixed 30-signups/5min/IP meter and ≈2.62 h auth-meter loss, lines 60–62), the commission ruling exists with the exact scope fence (`issues/20260809-password-credential-auth.md`), and the core design bets are sound and substrate-verified: same session-creation core and composed credential response (shape confirmed at `llp/0057-auth-provider-protocol.spec.md:1021-1072`), password-as-its-own-identity-row (supported by the existing `(provider, subject)` unique index, `src/storage/auth.rs:405`), Argon2 outside the writer lock (LLP 0011:119), the anonymous-issuance vs `withCredentialRotation` client split (both verified in `packages/snapback-client/index.mjs:5009-5016, 5260`), and the existing operation-bound step-up ceremony to extend (`src/auth/provider.rs:184-305`). The (d) move to subordinate catalog versioning to LLP 0214 is the correct call in direction; its execution has the seam described in concern 2.

**3. Concerns**

1. **MATERIAL, IN-DELTA — the pinned attempt ledger cannot express the declared windowed budgets.** §Lockout declares: "Signup and signin also count against per-address and global rolling windows via 0057's existing budget transaction shape — … the attempt ledger above is the declared substrate for password-path budgets." But the (d)-pinned `_auth_password_attempts` DDL (one row per `(address_hash, source_class)`, `failed_count`, `window_start_ms`, "records failed attempts", "success resets the address's counter") records only failures and is erased on success. A successful-signup rate window — precisely the GoTrue-meter behavior the RFC benchmarks against, and what "windowed budget" in the `SNAPBACK_AUTH_THROTTLED` row implies — has no representable substrate: successes are never recorded, and the reset-on-success rule destroys any rolling count. 0057's own budget counts retained challenge rows in half-open windows (`llp/0057-auth-provider-protocol.spec.md:707-714`), which the RFC correctly notes doesn't apply — but the replacement it declares can't do the job either. An implementer must guess whether budgets count only failures (plausible from the DDL; changes the abuse posture and the acceptance-3 THROTTLED assertion) or all attempts (needs schema the RFC doesn't have). Fix shape: either extend the ledger to account admitted attempts distinct from the lockout failure counter (e.g., a windowed attempt counter not reset on success), or explicitly scope password-path windowed budgets to failed attempts and say so in the code table.

2. **MATERIAL, IN-DELTA — the 0214 deference clause, applied as written, breaks the RFC's own mechanics.** §Credential storage says "its two tables land as a strict subset of 0214's catalog progression … where 0214's password shape and this sketch differ, 0214's shape supersedes." I verified 0214's password shape (`llp/0214-snapback-identity-core.spec.md:828-896`): a base `_auth_credentials` relation keyed by `user_id`/`kind` plus an `_auth_password_credentials` material relation keyed only by `credential_id` — **no `identity_id` anywhere**, revocation by `revoked_at_ms` rather than row retirement, and a wave-1 password floor of `identifier: 'username'` with `username-v1` canonical subject (lines 276, 820-821), not this RFC's email-shaped subject. If 0214's shape supersedes, then: (a) displacement's "credential cascades with the retired identity" has nothing to cascade through (no identity FK); (b) "strict subset" is false — `_auth_password_attempts` and the `identity_id` join exist nowhere in 0214's progression; (c) the identifier-class divergence (email vs 0214's username floor, with two different canonicalization rules — the same-principal reset check and displacement both depend on address-equality against the `'email-code'` identity's `email-v1` canonicalization) is a mechanism-level conflict the shape-deference clause doesn't cover. The deference decision is right; the ambiguity about *what this slice actually builds* is the defect — a conscientious implementer reading "0214's shape supersedes" and building 0214's shape produces a system in which the RFC's displacement and attach-mode refusal semantics don't hold. Fix shape: pin that this slice implements the sketch DDL under a pre-v3 marker agreed with 0214's owner, and enumerate the named reconciliation items (identifier class email vs username floor and its canonicalization bridge; identity-linked credential vs kind-based credential; displacement-by-identity-retirement vs `revoked_at_ms`) instead of a blanket shape-supersedes rule.

3. **MATERIAL, IN-DELTA — acceptance criterion 7 contradicts (d)'s central catalog ruling.** Criterion 7 requires "`authProgramReadiness` gains a password-provider facet **including catalog-v3 readiness**," but (d) withdrew minting v3 ("This RFC therefore mints no catalog version of its own … it lands under the next marker agreed with that owner"), and v3 is 0214's blocked floor (`issues/20260810-llp-0214-floor-catalog-v3-backup-blocked.md`). As written the acceptance contract asserts a marker the body no longer claims. Trivial fix: "readiness for the password tables' catalog marker."

4. **implementation-phase, IN-DELTA — wrong LLP citation for replication ciphertext.** §Threat notes/Custody: "replication ciphertext (LLP 0192)". LLP 0192 (`0192-store-durable-state-set.decision.md`) contains no replication or ciphertext content (verified by exhaustive grep); encrypted replication lanes are LLP 0188 (`0188-ltx-sqlite-replication.rfc.md`, "encrypted on every lane"). 0192 correctly covers the export/backup halves of the sentence. Cite 0188 for the replication member.

5. **implementation-phase, IN-DELTA — displacement's projection disposition is unnamed.** Displacement deletes session rows via cascade — a new class of operation against 0057's "deletes nothing" bulk-revocation posture (`0057:880-884`), consciously chosen and defensible. LLP 0059 has the right settlement concept (`durableDelete` terminal disposition for a committed ending of a backing authority, `0059:1546-1553`), but the RFC pins 0059 settlement only for the change/reset revocation set, not for displacement's cascaded deletions; an implementer could plausibly skip settlement frames for rows that no longer exist. Name `durableDelete` as displacement's settlement disposition.

6. **implementation-phase, IN-DELTA — the 10th-attempt semantics vs pre-KDF admission.** The table says "10 consecutive failures → locked 15 minutes" and acceptance 3 pins `PASSWORD_LOCKED` on the 10th attempt; but admission "happens before KDF work is spent," and at the 10th attempt's admission only 9 failures exist — so the 10th must spend KDF, fail, and then report LOCKED from the same transaction that recorded the 10th failure. Achievable and pinned by acceptance, but worth one sentence so an implementer doesn't return INVALID on the 10th.

7. **implementation-phase, PRE-EXISTING — CLI `change` verb's bearer source is unspecified.** `snapback auth password change` requires a bearer per the route table, but the verb sketch shows only `--url`/`--password-stdin`; no flag or env for the session token is named. Detail-only; no defective decision.

**4. Verifications performed**

- Read the full RFC at `/Users/ccheever/projects/snapback-worktrees/sr-r3/llp/0227-password-credential-auth.rfc.md` and its (d) delta enumeration.
- Commission ruling and scope fence: `issues/20260809-password-credential-auth.md`.
- Benchmark claims (B2 48/55/82; GoTrue 30-signups/5min/IP; ≈2.62 h auth meter; F5/F6 sections): `benchmarks/records/2026-08-09-social-messenger-p2-pilot.md:45,51-62,104,112`.
- Current catalog DDL: `_auth_users`/`_auth_identities`/`_auth_sessions` with composite `(identity_id, user_id)` FK `ON DELETE CASCADE`, `(provider, subject)` and `(id, user_id)` unique indexes, one-active-challenge index (`src/storage/auth.rs:310-460, 497-806`); `PRAGMA foreign_keys = ON` (`src/storage/auth.rs:2265`); sessions→identities provider join (`src/storage/auth_catalog_ops.rs:26-27`); identity rows deleted only in tests today.
- LLP 0057: bulk-revocation deletes-nothing invariant (874-889), request-code budget counting retained challenge rows (707-714), 256-stripe substrate (`src/auth/provider.rs:49,1471`), composed exchange response shape (1021-1072), capture mailbox, budget/throttle machinery (`src/auth/throttle.rs`).
- LLP 0214: catalog v3, credential/material shapes and one-live-per-user index (828-896), username identifier floor (276, 820-821), no-silent-migration (652), marker recognition (607-655); blocker ticket `issues/20260810-llp-0214-floor-catalog-v3-backup-blocked.md`; 0214 contains no `_auth_password_attempts`.
- LLP 0151: tier-1 username+password package, zero-dependency floor, recovery-code posture for password-only accounts, step-up-for-authenticator-change, identities/authenticators split, non-oracular rule (90-91, 215, 248-267, 366-427).
- LLP 0011 Argon2-outside-lock rule (119); LLP 0059 `durableDelete` disposition and clock floor; LLP 0045 header (delivery-adapter prerequisite); LLP 0192 grep for replication/ciphertext (absent) and store-export faithful-copy language (121-153); LLP 0188 encrypted replication.
- Client: `authExchange` requires anonymous-authority coordinator (`packages/snapback-client/index.mjs:5009-5018`), `withCredentialRotation` (5260), `senderConstrained` issuance path.
- Step-up ceremony types and operation-bound @ref (`src/auth/provider.rs:31-305`); `auth.mintSession` impersonation/profile/mode gating (`src/server.rs:20210-20239`, `src/cli.rs:3925-3927`).
- Capability index: rows 73-83 of `guide/capabilities.md` — no `auth.passwords` row exists; `AuthProgramReadiness` witness at `src/auth/mode.rs`.
- Not verified (out of reach of static reading): timing-envelope achievability of acceptance 6; I did not attempt to run any code. I did not read anything under `llp/reviews/`.

**5. Verdict**

VERDICT: NOT READY
