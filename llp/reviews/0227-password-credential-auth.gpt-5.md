# Review artifact — LLP 0227 (password credential auth) — gpt-5 family

Target: `llp/0227-password-credential-auth.rfc.md`
Loop: llp-super-refine 2026-08-10, independent-loop topology, orchestrated by
Claude Fable 5 (session 0f56679e); reviser = orchestrator.

## Round 1 — 2026-08-10

- Reviewer: gpt-5 family — codex exec, model gpt-5.6-sol, reasoning xhigh,
  read-only sandbox, --ignore-user-config (launch attempt 2; attempt 1 died
  mid-review with no output and is recorded as a void, never counted).
- Capsule: detached worktree at commit `1c19e047b` (structural exclusion of
  `llp/reviews/0227*` — none exist at that commit).
- Target revision: (b), sha256
  `6f70a9842429b593910859cea4f48fa24393cba3af0f93a260c3eb8c8d7cf14d`.
- Instructions: sr-review-r1 template, sha256
  `f78b71c5d1d9d92f9aaf0c8dcdba3e6da6878d11a29e94e12b5c5ccace483c4c`.
- Verdict: **NOT READY** (9 MATERIAL concerns; binds to the capsule/target
  hashes above).

### Verbatim review

## 1. Summary

LLP 0227 proposes first-class email/password credentials layered onto Snapback’s existing principal, session, custody, and token machinery: Argon2id storage, signup/signin/change/reset routes, CLI/client projections, lockout budgets, and legacy-hash import.

The broad direction is sound: passwords should be a credential class, not a parallel identity or session system. The RFC is not ready, however. Its signup flow does not prove email ownership yet binds into the verified-email identity namespace, enabling account pre-hijacking. Several other security and compatibility contracts—fresh authentication, stale-verification races, lockout opacity, revocation scope, catalog migration, client custody, and production scope—are either incorrect or unresolved.

## 2. Direction assessment

The strongest decisions are correct:

- Credential state is separated from identity state, as required by LLP 0151.
- Successful password authentication reuses the existing session core and credential response.
- Expensive password hashing runs outside the SQLite writer.
- Session custody, refresh, invalidation, and token-family behavior remain shared rather than forked.
- The benchmark demand is real: the pilot recorded B2 scores of 48 for Snapback and 82 for Supabase and identified password auth as a headline gap ([benchmark record](/Users/ccheever/projects/snapback-worktrees/sr-r1/benchmarks/records/2026-08-09-social-messenger-p2-pilot.md:42), lines 42–62 and 104–119).

The central model nevertheless conflates two different assertions:

1. “This secret authenticates the account whose login name is this email-shaped string.”
2. “This principal has proved control of this email address.”

A password proves the first, not the second. The current RFC creates a full principal and session before email verification, then makes later email-code proof join that same principal. That is unsafe and inconsistent with the repository’s meaning of `_auth_identities`. The direction becomes sound once signup uses pending/unverified state, or once unverified login identifiers are modeled separately and linked to verified identities only through an authenticated transition.

## 3. Concerns

1. **The signup identity model enables account pre-hijacking and cannot represent its own semantics — MATERIAL**

   **Text at issue:** “A password is a second way to prove control of a canonical email address,” while signup creates a principal, canonical-address identity, credential, and session even though that identity “is not email-verified”; a later email-code exchange is supposed to yield the same principal ([LLP 0227](/Users/ccheever/projects/snapback-worktrees/sr-r1/llp/0227-password-credential-auth.rfc.md:35), lines 35–40 and 148–166).

   **Evidence:** LLP 0151 defines `_auth_identities` as holding external subjects and **verified identifiers**, with credentials in a separate relation ([LLP 0151](/Users/ccheever/projects/snapback-worktrees/sr-r1/llp/0151-first-party-identity-integrations.rfc.md:364), lines 364–374). The current schema requires `verified_at_ms` and has no unverified state ([src/storage/auth.rs](/Users/ccheever/projects/snapback-worktrees/sr-r1/src/storage/auth.rs:318), lines 318–329). Successful email-code exchange creates or reuses an `email-code` identity; reuse does not perform any verification-state update ([src/auth/provider.rs](/Users/ccheever/projects/snapback-worktrees/sr-r1/src/auth/provider.rs:3914), lines 3914–3943; [planned path](/Users/ccheever/projects/snapback-worktrees/sr-r1/src/auth/provider.rs:4360), lines 4360–4462).

   Consequently, an attacker can register a victim’s email, receive a full session, and retain both that session and the password when the victim later proves email control. The victim’s email-code login joins the attacker-created principal rather than displacing the attacker.

   There is also a durable projection mismatch: session resolution derives `session.provider` from `identity.provider` ([src/auth/provider.rs](/Users/ccheever/projects/snapback-worktrees/sr-r1/src/auth/provider.rs:2827), lines 2827–2867), while the RFC requires `session.provider` to report the credential class ([LLP 0227](/Users/ccheever/projects/snapback-worktrees/sr-r1/llp/0227-password-credential-auth.rfc.md:119), lines 119–123). One shared `email-code` identity cannot report password authentication without another durable authentication-method fact.

   **Fix:** Model signup as pending registration until email proof atomically creates/binds the verified identity, credential, and session; or introduce a separate unverified login-identifier relation and an explicit verified linking transition. Specify collision/pre-hijacking resolution and where the session’s authentication method is stored or derived.

2. **The first-password “set” path permits bearer-only account takeover — MATERIAL**

   **Text at issue:** `currentPassword: null` is accepted whenever an authenticated principal has no password credential ([LLP 0227](/Users/ccheever/projects/snapback-worktrees/sr-r1/llp/0227-password-credential-auth.rfc.md:167), lines 167–174).

   **Evidence:** LLP 0151 requires link, identifier, and recovery-configuration changes to have fresh step-up verification, not merely a live session ([LLP 0151](/Users/ccheever/projects/snapback-worktrees/sr-r1/llp/0151-first-party-identity-integrations.rfc.md:380), lines 380–391). The repository already exposes an operation-bound step-up substrate, although delivery is currently local/test-only ([guide](/Users/ccheever/projects/snapback-worktrees/sr-r1/guide/auth/sessions-and-principals.md:151), lines 151–158).

   A stolen bearer for an account without a password could therefore set one, rotate the attacker’s bearer, and revoke the legitimate user’s other sessions.

   **Fix:** Require an operation-bound fresh proof for first-password attachment—normally a newly consumed email challenge or equivalent verified authenticator. Add acceptance coverage proving that a bearer alone cannot set the first password.

3. **Out-of-lock verification lacks a stale-predecessor fence — MATERIAL**

   **Text at issue:** The KDF runs outside the writer and “only the constant-time comparison result and the pre-computed replacement hash enter the transaction”; generation CAS is specified only for upgrade-on-verify ([LLP 0227](/Users/ccheever/projects/snapback-worktrees/sr-r1/llp/0227-password-credential-auth.rfc.md:84), lines 84–97).

   **Evidence:** A password change or reset can replace the hash and revoke sessions while an old-password verification is in flight. Nothing in the RFC requires session issuance to recheck the exact credential generation/hash that produced the successful result. LLP 0059 requires plans to carry exact generations and digests and commits to compare every planned predecessor ([LLP 0059](/Users/ccheever/projects/snapback-worktrees/sr-r1/llp/0059-session-projection-and-client-barrier.spec.md:542), lines 542–567). The current provider follows that pattern for identity state, cap eviction, and tokens ([src/auth/provider.rs](/Users/ccheever/projects/snapback-worktrees/sr-r1/src/auth/provider.rs:4360), lines 4360–4443).

   Without this fence, an old password can mint a new session after change/reset has supposedly ended its authority.

   **Fix:** Pin a two-phase password verification protocol: read exact credential id, generation, PHC bytes, and lock state; perform the KDF outside the writer; then transactionally require that exact predecessor before failure accounting, upgrade, or session issuance. A mismatch must restart or refuse, never authorize the stale proof. Add change/reset-versus-signin race tests.

4. **The lockout contract is an account oracle and lacks a password-budget substrate — MATERIAL**

   **Text at issue:** Missing account and wrong password are supposedly uniform, but real credentials return `PASSWORD_LOCKED` after ten failures; accounting lives on the credential row, while rolling budgets “reuse LLP 0057’s budget machinery” ([LLP 0227](/Users/ccheever/projects/snapback-worktrees/sr-r1/llp/0227-password-credential-auth.rfc.md:199), lines 199–225 and 242–258).

   **Evidence:** A nonexistent account has no credential row or `failed_attempts`, so after ten probes an existing account produces `PASSWORD_LOCKED` while a missing account cannot. That is an enumeration oracle and gives attackers a fifteen-minute denial-of-service primitive. LLP 0151 requires password guessing throttles and non-oracular public failures ([LLP 0151](/Users/ccheever/projects/snapback-worktrees/sr-r1/llp/0151-first-party-identity-integrations.rfc.md:248), lines 248–267 and 425–427).

   Existing LLP 0057 budgets are not a generic meter: the implementation counts retained `_auth_verification_codes` rows before inserting another challenge ([src/storage/auth_catalog_ops.rs](/Users/ccheever/projects/snapback-worktrees/sr-r1/src/storage/auth_catalog_ops.rs:370), lines 370–419). Password signin creates no such row, and the proposed DDL contains no attempt-event ledger for absent accounts.

   **Fix:** Keep lock state non-oracular at the public boundary, or provide equivalent durable dummy state for missing accounts while addressing lockout DoS. Define a bounded password-attempt ledger covering missing, wrong, locked, and successful outcomes; specify admission before KDF, address/global/source keys, retention/GC, profile thresholds, and timing. Acceptance must compare missing/wrong/locked behavior through and beyond the threshold.

5. **The cited session-revocation operation revokes every user, not one user — MATERIAL**

   **Text at issue:** Change and reset revoke “the user’s other sessions via LLP 0057’s bulk-revocation transaction scoped to the user” ([LLP 0227](/Users/ccheever/projects/snapback-worktrees/sr-r1/llp/0227-password-credential-auth.rfc.md:167), lines 167–184).

   **Evidence:** LLP 0057’s reusable bulk transaction explicitly revokes **every session not already revoked**, and its two consumers are downgrade and declared restore ([LLP 0057](/Users/ccheever/projects/snapback-worktrees/sr-r1/llp/0057-auth-provider-protocol.spec.md:874), lines 874–889). The source likewise selects and updates every live session without a `user_id` predicate ([src/storage/auth.rs](/Users/ccheever/projects/snapback-worktrees/sr-r1/src/storage/auth.rs:1775), lines 1775–1815). LLP 0059 also requires authority-ending operations to plan, begin, commit, finalize, and propagate their exact affected sessions ([LLP 0059](/Users/ccheever/projects/snapback-worktrees/sr-r1/llp/0059-session-projection-and-client-barrier.spec.md:542), lines 542–567).

   Reusing the cited helper would log out every user. Merely adding a SQL predicate would still omit projection fencing and publication semantics.

   **Fix:** Specify a new user-scoped revocation operation. Define the exact session set, exclusion of the acting session for change, reset’s newly minted session, generation/reason transitions, atomicity with credential mutation and bearer rotation, and LLP 0059 projection settlement.

6. **The client adoption rule is wrong for password change — MATERIAL**

   **Text at issue:** Every password client method adopts the result into `AuthCoordinator` “exactly as `authExchange` does” ([LLP 0227](/Users/ccheever/projects/snapback-worktrees/sr-r1/llp/0227-password-credential-auth.rfc.md:140), lines 140–144).

   **Evidence:** `authExchange` requires an anonymous predecessor and rejects an authenticated coordinator ([packages/snapback-client/index.mjs](/Users/ccheever/projects/snapback-worktrees/sr-r1/packages/snapback-client/index.mjs:5008), lines 5008–5017). Password change necessarily starts authenticated. Existing refresh uses `withCredentialRotation`, verifies same authority, and replaces the credential within that authority ([packages/snapback-client/index.mjs](/Users/ccheever/projects/snapback-worktrees/sr-r1/packages/snapback-client/index.mjs:5241), lines 5241–5304).

   **Fix:** Separate anonymous issuance adoption for signup/signin/reset from authenticated same-authority rotation for change. Pin stale-response races, authority-descriptor equality, sender-key handling, and indeterminate-success behavior. Add the omitted reset client/CLI surface or explicitly scope it out.

7. **The catalog-version and migration decision is deferred too late — MATERIAL**

   **Text at issue:** The RFC adds a protected `_auth_*` table but says the catalog migration number “bind[s] at implementation time” ([LLP 0227](/Users/ccheever/projects/snapback-worktrees/sr-r1/llp/0227-password-credential-auth.rfc.md:51), lines 51–77 and 309–314).

   **Evidence:** The current implementation recognizes only exact v1 and v2 catalogs; v1→v2 migration is already explicitly deferred ([src/storage/auth.rs](/Users/ccheever/projects/snapback-worktrees/sr-r1/src/storage/auth.rs:24), lines 24–38 and 137–179). An extra protected table under either marker is catalog corruption ([src/storage/auth.rs](/Users/ccheever/projects/snapback-worktrees/sr-r1/src/storage/auth.rs:2091), lines 2091–2177).

   **Fix:** Decide whether this is auth catalog v3 and specify fresh activation, v2→v3 and v1 behavior, crash/rollback semantics, old-binary refusal, password-route readiness by catalog state, backup/restore/GC/export behavior, and whether migration is automatic or explicitly unavailable. These are compatibility decisions, not mechanical numbering.

8. **The RFC must choose between a local pilot slice and LLP 0151 Tier 1 — MATERIAL**

   **Text at issue:** It says it implements LLP 0151’s Tier-1 password row while excluding recovery codes, describes every successful signup as a composed credential response, separately proposes production blind acceptance with no session, and leaves that production behavior open ([LLP 0227](/Users/ccheever/projects/snapback-worktrees/sr-r1/llp/0227-password-credential-auth.rfc.md:44), lines 44–49, 112–123, 246–255, and 297–302).

   **Evidence:** LLP 0151 says password accounts without verified email require preissued recovery codes and calls that part of the password package ([LLP 0151](/Users/ccheever/projects/snapback-worktrees/sr-r1/llp/0151-first-party-identity-integrations.rfc.md:248), lines 248–267 and 396–403). Its Tier-1 definition requires both deployment arms, supported client surfaces, guide, fixture, demo, and capability row ([LLP 0151](/Users/ccheever/projects/snapback-worktrees/sr-r1/llp/0151-first-party-identity-integrations.rfc.md:193), lines 193–221; [acceptance](/Users/ccheever/projects/snapback-worktrees/sr-r1/llp/0151-first-party-identity-integrations.rfc.md:807), lines 807–827). LLP 0227’s acceptance covers only a headless local-style flow.

   The checkout explicitly says hosted auth is absent and the local target lacks shared throttling and sender-constrained credentials ([root LLP](/Users/ccheever/projects/snapback-worktrees/sr-r1/llp/0000-snapback.explainer.md:370), lines 370–384; [target guide](/Users/ccheever/projects/snapback-worktrees/sr-r1/guide/auth/targets.md:22), lines 22–38 and 55–95). The current capability index has `auth.sessions` but no password GAP row to “flip” ([guide/capabilities.md](/Users/ccheever/projects/snapback-worktrees/sr-r1/guide/capabilities.md:73), lines 73–80).

   **Fix:** Either declare this a local, partial benchmark-closure slice and remove the Tier-1/production claims, or complete the Tier-1 package: recovery, hosted admission and sender-constrained issuance, all supported client witnesses, and one coherent production signup response. Blind acceptance cannot be byte-shape-identical to a credential-bearing success when it deliberately returns no session.

9. **Import neither preserves pilot principals nor bounds foreign KDF cost — MATERIAL**

   **Text at issue:** Import “provisions the principal/identity as signup does,” stores any allowlisted `argon2id`, `scrypt`, or `bcrypt` hash verbatim, and “directly absorbs” the pilot data ([LLP 0227](/Users/ccheever/projects/snapback-worktrees/sr-r1/llp/0227-password-credential-auth.rfc.md:227), lines 227–238).

   **Evidence:** Signup refuses any existing identity. The pilot used the sanctioned session-mint seam ([LLP 0208](/Users/ccheever/projects/snapback-worktrees/sr-r1/llp/0208-clique-pilot-gap-closure.plan.md:145), lines 145–159), and that seam creates or reuses an `email-code` identity for the address ([src/auth/provider.rs](/Users/ccheever/projects/snapback-worktrees/sr-r1/src/auth/provider.rs:2517), lines 2517–2559; [issuance lookup](/Users/ccheever/projects/snapback-worktrees/sr-r1/src/auth/provider.rs:4059), lines 4059–4086). Import “as signup” would therefore refuse the pilot’s already-minted principals rather than attach credentials to them.

   Algorithm allowlisting alone also does not bound PHC parameters. A foreign hash can request excessive memory or work, contradicting the RFC’s claim that concurrency alone bounds memory×time exposure. The checkout contains no Argon2/scrypt/bcrypt verifier dependency yet, which is consistent with “no implementation,” but means no existing parser supplies unstated safety bounds.

   **Fix:** Define separate create-versus-attach import modes with exact expected-principal/collision rules and principal continuity. Bound encoded length, algorithm/version, salt/tag sizes, and every cost parameter. Add a fixture in the pilot’s actual encoding. The actual pilot hash records were not present in the reviewed checkout, so their PHC compatibility could not be verified.

10. **Schema, policy, and document cleanup remains — implementation-phase**

   **Text at issue:** The DDL and surface leave several implementers to guess.

   **Evidence and fix:**

   - Add checks for positive/JS-safe generation, nonnegative failures, timestamp domains/order, lock range, PHC length, and identity/user consistency. Existing catalog DDL applies such checks systematically ([src/storage/auth.rs](/Users/ccheever/projects/snapback-worktrees/sr-r1/src/storage/auth.rs:320), lines 320–395).
   - Name the source and measurement unit for the 8–1024 policy. LLP 0151 requires “length minimums per current guidance” but does not establish eight bytes as its baseline ([LLP 0151](/Users/ccheever/projects/snapback-worktrees/sr-r1/llp/0151-first-party-identity-integrations.rfc.md:248), lines 248–267). The claimed OWASP alignment could not be verified from repository material.
   - Specify where profile thresholds are declared and validated. Existing LLP 0057 budgets are code constants ([src/auth/provider.rs](/Users/ccheever/projects/snapback-worktrees/sr-r1/src/auth/provider.rs:49), lines 49–65).
   - Resolve stdin framing, simultaneous/missing credential sources, reset CLI/client methods, and the `SNAPBACK_PASSWORD` question.
   - Reconcile top-level `Status: Review` with the bottom `Draft (a)` status and collapse the duplicate `Revised` metadata ([LLP 0227](/Users/ccheever/projects/snapback-worktrees/sr-r1/llp/0227-password-credential-auth.rfc.md:3), lines 3–11 and 309–314).
   - Phrase “undocumented HTTP shape” as historical: the pilot record supports that experience, but the current guide now documents the mint host-operation shape ([guide](/Users/ccheever/projects/snapback-worktrees/sr-r1/guide/auth/sessions-and-principals.md:126), lines 126–149).

## 4. Verifications performed

- Read LLP 0227 in full before inspecting dependencies.
- Confirmed the commissioning issue’s exact scope and author ruling ([issue](/Users/ccheever/projects/snapback-worktrees/sr-r1/issues/20260809-password-credential-auth.md:1), lines 1–30).
- Confirmed the pilot’s scores, scrypt gateway workaround, GoTrue meter, and F5 gap from the benchmark record.
- Checked the root LLP and governing LLPs 0011, 0039, 0057, 0058, 0059, 0151, 0024, 0037, and 0045 for identity, concurrency, DTO, projection, target, and delivery contracts.
- Inspected the exact v1/v2 auth schemas and catalog validation.
- Inspected email-code provisioning, identity lookup, session issuance, session-provider resolution, request budgets, session revocation, and exact-successor checks in Rust.
- Inspected request DTOs, sender constraints, `AuthCoordinator` login/rotation paths, guide target claims, capability rows, and readiness facts.
- Confirmed that the current request-code budget counts `_auth_verification_codes`, and that LLP 0057’s bulk helper is global.
- Confirmed that `Cargo.toml`/`Cargo.lock` contain no current Argon2, scrypt, bcrypt, or generic password-hash verifier dependency; implementation has not begun as stated.
- Could not verify the pilot’s actual stored scrypt encoding or parameters because those records were not present in the checkout. Could not verify the external OWASP/NIST alignment from repository material alone.
- Did not read review artifact contents, inspect other worktrees/reflogs, or modify any file.

VERDICT: NOT READY
## Round 2 — 2026-08-10 (delta round)

- Reviewer: gpt-5 family — codex exec, model gpt-5.6-sol, reasoning xhigh,
  read-only sandbox, --ignore-user-config.
- Capsule: detached worktree at commit `0eac1d309`.
- Target revision: (c), sha256 prefix `61e11d642156d73e`.
- Instructions: sr-review-r2 delta template.
- Verdict: **NOT READY** (7 MATERIAL: 6 IN-DELTA, 1 PRE-EXISTING).

### Verbatim review

## Summary

The RFC’s product goal and session-surface direction are sound, and revision (c)’s separate `'password'` namespace is a meaningful improvement. It is not implementation-ready: six unresolved material concerns remain, principally conflicting catalog-v3 authorities, unsafe/undefined reset behavior, impossible displacement semantics, and an incomplete lockout contract.

## Direction assessment

First-class email+password auth should reuse Snapback’s existing principals, sessions, credential responses, custody coordinator, and revocation machinery. Separating an unverified password login name from the verified `'email-code'` identity is preferable to treating password signup as proof of email control.

However, this RFC currently establishes a parallel password/catalog-v3 architecture beside LLP 0214 without reconciling it. The right direction is one authoritative catalog and lifecycle design, with the narrower benchmark slice explicitly superseding or extending LLP 0214—not a second incompatible v3.

## Concerns

1. **MATERIAL — IN-DELTA. Two incompatible documents claim auth catalog v3, with opposite migration rules.**

   Exact text at issue: “**This is auth catalog v3**” and “v2→v3 upgrades **automatically at activation**” ([RFC lines 94–104](/Users/ccheever/projects/snapback-worktrees/sr-r2/llp/0227-password-credential-auth.rfc.md:94)).

   Repository evidence: LLP 0214 already defines marker `3` as its own exact, substantially different catalog, including `_auth_credentials`, assurances, recovery state, and a different `_auth_password_credentials` shape ([LLP 0214 lines 603–660](/Users/ccheever/projects/snapback-worktrees/sr-r2/llp/0214-snapback-identity-core.spec.md:603), [lines 825–895](/Users/ccheever/projects/snapback-worktrees/sr-r2/llp/0214-snapback-identity-core.spec.md:825)). It expressly says “No current activation silently migrates v1 or v2,” directly contradicting 0227. The checkout also records that the attempted 0214 catalog-v3 work broke backup format and quiescence tests ([issue lines 9–42](/Users/ccheever/projects/snapback-worktrees/sr-r2/issues/20260810-llp-0214-floor-catalog-v3-backup-blocked.md:9)). Current activation recognizes v1/v2 and returns without upgrading either ([src/storage/auth.rs lines 994–1003](/Users/ccheever/projects/snapback-worktrees/sr-r2/src/storage/auth.rs:994)).

   Fix shape: designate one catalog-v3 authority. Either explicitly supersede and reconcile LLP 0214’s catalog/password portions, or extend its shape under a later marker. Pin one migration policy and include backup-manifest, reset, restore, crash, and exact-recognition consequences before allowing automatic v2 migration.

2. **MATERIAL — IN-DELTA. Reset has no safe principal-selection rule after the new namespace split.**

   Exact text at issue: reset “verifies the code for the credential’s address, replaces the hash, revokes the user’s other sessions, and mints a fresh session” ([RFC lines 220–231](/Users/ccheever/projects/snapback-worktrees/sr-r2/llp/0227-password-credential-auth.rfc.md:220)).

   Under the RFC’s own containment state, password signup creates principal P1, while a later email-code exchange for the same address creates P2 ([lines 199–204](/Users/ccheever/projects/snapback-worktrees/sr-r2/llp/0227-password-credential-auth.rfc.md:199)). A reset code proves P2’s email control. Resolving the password credential by address would reset P1 and mint access to P1’s data; resolving through P2 finds no credential. This contradicts the later statement that set-displacement is the sanctioned unification. LLP 0151 avoids this ambiguity by allowing email reset only with a verified email and requiring recovery codes for password accounts without one ([LLP 0151 lines 248–267](/Users/ccheever/projects/snapback-worktrees/sr-r2/llp/0151-first-party-identity-integrations.rfc.md:248)).

   Fix shape: define reset behavior for password-only, email-code-only, same-principal dual-identity, and two-principal squat states. Pin which identity/provider the new session uses. To preserve containment, reset should not transfer the squatter principal; password-only recovery therefore needs recovery codes, prior email linking, or an explicit narrower non-recoverable posture.

3. **MATERIAL — IN-DELTA. Displacement cannot both remove the old identity and preserve its sessions under the declared schema.**

   Exact text at issue: set “**displaces** that identity and its credential,” while “the displaced principal keeps its sessions and data” ([RFC lines 208–219](/Users/ccheever/projects/snapback-worktrees/sr-r2/llp/0227-password-credential-auth.rfc.md:208)).

   Repository evidence: sessions reference `(identity_id, user_id)` with `ON DELETE CASCADE` ([src/storage/auth.rs lines 532–558](/Users/ccheever/projects/snapback-worktrees/sr-r2/src/storage/auth.rs:532)); `(provider, subject)` is unique ([lines 755–770](/Users/ccheever/projects/snapback-worktrees/sr-r2/src/storage/auth.rs:755)); and the repository’s identity decision calls provider identity immutable ([LLP 0226 lines 49–55](/Users/ccheever/projects/snapback-worktrees/sr-r2/llp/0226-identity-architecture.decision.md:49)). Deleting the identity deletes its sessions, retaining it blocks the replacement, and rewriting/transferring it violates or fails existing invariants.

   Fix shape: specify a realizable retirement/tombstone model, including identity schema/index changes and refresh projection semantics, or change the promise and revoke the displaced sessions. Add an acceptance assertion covering those pre-existing sessions after displacement.

4. **MATERIAL — IN-DELTA. The required first-set step-up proof has no wire carrier or operation binding.**

   Exact text at issue: `currentPassword: null` “requires a fresh operation-bound email-code challenge consumed in the same transaction” ([RFC lines 208–212](/Users/ccheever/projects/snapback-worktrees/sr-r2/llp/0227-password-credential-auth.rfc.md:208)), but the declared change body and client method carry only `currentPassword` and `newPassword` ([lines 139–170](/Users/ccheever/projects/snapback-worktrees/sr-r2/llp/0227-password-credential-auth.rfc.md:139)).

   Repository evidence: current step-up requests are a closed operation-tagged enum with only grant approval, agent invitation, and effect approval ([src/server.rs lines 14125–14144](/Users/ccheever/projects/snapback-worktrees/sr-r2/src/server.rs:14125)); consuming operations carry `{ challengeId, code }` explicitly ([lines 14113–14130](/Users/ccheever/projects/snapback-worktrees/sr-r2/src/server.rs:14113)). The binding includes exact session generation, authority instance, operation, and target ([src/auth/provider.rs lines 181–250](/Users/ccheever/projects/snapback-worktrees/sr-r2/src/auth/provider.rs:181)).

   Fix shape: add a closed password-set step-up request operation and target, add `stepUp: { challengeId, code }` to the change/set DTO and client method, state the eligible email-code session, and pin atomic proof consumption. A separate set route would also be coherent.

5. **MATERIAL — IN-DELTA. The account-existence-blind lockout ledger is not an exact or internally consistent contract.**

   Exact text at issue: the credential table retains `failed_attempts` and `locked_until_ms`, while a “second bounded relation” becomes the declared address/source-class accounting substrate ([RFC lines 69–92](/Users/ccheever/projects/snapback-worktrees/sr-r2/llp/0227-password-credential-auth.rfc.md:69), [lines 278–292](/Users/ccheever/projects/snapback-worktrees/sr-r2/llp/0227-password-credential-auth.rfc.md:278)).

   No table name, DDL, key, index, source-class derivation, retention horizon, or capacity disposition is given, although exact catalog recognition compares all such facts. Credential-level counters cannot represent `(address, source class)` locks, leaving two conflicting authorities. The existing local email-code budget has only address/global dimensions; the repository’s effective-source grouping is a hosted-edge mechanism ([src/auth/effective_source.rs lines 1–12](/Users/ccheever/projects/snapback-worktrees/sr-r2/src/auth/effective_source.rs:1), [src/auth/throttle.rs lines 221–229](/Users/ccheever/projects/snapback-worktrees/sr-r2/src/auth/throttle.rs:221)). Adding canonical addresses to another relation also conflicts with LLP 0057’s current closed address-custody list ([LLP 0057 lines 1546–1556](/Users/ccheever/projects/snapback-worktrees/sr-r2/llp/0057-auth-provider-protocol.spec.md:1546)).

   Fix shape: define exact ledger DDL/indexes, trusted source derivation for every local ingress topology, capacity/GC behavior, threshold/reset/expiry transactions, and lifecycle treatment. Remove credential counters or define a single non-conflicting role for them, and amend the canonical-address custody rule.

6. **MATERIAL — IN-DELTA. Credential cardinality is inconsistent with change and import.**

   Exact text at issue: the schema enforces only one password per identity, change carries no email/credential selector, and `attach` can add a credential to an arbitrary existing user ([RFC lines 83–88](/Users/ccheever/projects/snapback-worktrees/sr-r2/llp/0227-password-credential-auth.rfc.md:83), [lines 304–318](/Users/ccheever/projects/snapback-worktrees/sr-r2/llp/0227-password-credential-auth.rfc.md:304)).

   Multiple identities may belong to one user in the shipped schema. Thus repeated imports can produce multiple password credentials, after which `{ currentPassword, newPassword }` has no declared target. The existing identity-core draft instead pins at most one live password per principal ([LLP 0214 lines 887–895](/Users/ccheever/projects/snapback-worktrees/sr-r2/llp/0214-snapback-identity-core.spec.md:887)).

   Fix shape: either enforce one live password credential per `user_id` and make attach refuse an existing one, or add an explicit credential/address selector and fully specify multi-password change, set, reset, lockout, and revocation semantics.

7. **MATERIAL — PRE-EXISTING. Reset can install a password that signup/change would reject.**

   Exact text at issue: `PASSWORD_WEAK` and the common-password blocklist apply only at “signup/change” ([RFC lines 270–276](/Users/ccheever/projects/snapback-worktrees/sr-r2/llp/0227-password-credential-auth.rfc.md:270), [lines 341–343](/Users/ccheever/projects/snapback-worktrees/sr-r2/llp/0227-password-credential-auth.rfc.md:341)), while reset accepts `newPassword`.

   Fix shape: apply the identical current password policy and screening version to reset, with the same typed refusal and an acceptance case.

8. **implementation-phase — PRE-EXISTING. Password-hash export/snapshot custody is worded more broadly than the shipped store-copy contract permits.**

   Exact text at issue: PHC strings are “never in … exports,” and “No password or hash” enters “snapshots” ([RFC lines 126–130](/Users/ccheever/projects/snapback-worktrees/sr-r2/llp/0227-password-credential-auth.rfc.md:126), [lines 344–346](/Users/ccheever/projects/snapback-worktrees/sr-r2/llp/0227-password-credential-auth.rfc.md:344)).

   `snapback store export` deliberately online-backs up the exact database and produces a faithful, directly bootable copy with the same credentials and sessions ([LLP 0192 lines 121–162](/Users/ccheever/projects/snapback-worktrees/sr-r2/llp/0192-store-durable-state-set.decision.md:121), [src/store_state.rs lines 369–395](/Users/ccheever/projects/snapback-worktrees/sr-r2/src/store_state.rs:369)).

   Fix shape: qualify the prohibition as app/logical exports, projections, manifests, and runtime snapshots. Explicitly permit owner-authorized physical auth backup, whole-store export, and replication ciphertext to carry the database bytes while their manifests and diagnostics remain redacted.

9. **implementation-phase — IN-DELTA. The verification-fence race disposition contradicts acceptance.**

   Exact text at issue: predecessor mismatch “refuses **or restarts**” ([RFC lines 233–239](/Users/ccheever/projects/snapback-worktrees/sr-r2/llp/0227-password-credential-auth.rfc.md:233)), while acceptance requires the racing signin to refuse ([lines 373–379](/Users/ccheever/projects/snapback-worktrees/sr-r2/llp/0227-password-credential-auth.rfc.md:373)).

   Fix shape: choose one disposition. If refusal is intended, pin its public code and confirm it performs no failure accounting; otherwise revise the acceptance result and define bounded restart behavior.

10. **implementation-phase — IN-DELTA. Password client adoption has no declared sender-constrained disposition.**

    Exact text at issue: anonymous methods reuse `authExchange`, while change uses `withCredentialRotation` ([RFC lines 167–176](/Users/ccheever/projects/snapback-worktrees/sr-r2/llp/0227-password-credential-auth.rfc.md:167)); sender-constrained issuance is outside scope.

    Current `authExchange` performs a distinct sender-issuance proof flow ([packages/snapback-client/index.mjs lines 5008–5061](/Users/ccheever/projects/snapback-worktrees/sr-r2/packages/snapback-client/index.mjs:5008)), and refresh uses a separate sender rotation path rather than ordinary `withCredentialRotation` ([lines 5241–5297](/Users/ccheever/projects/snapback-worktrees/sr-r2/packages/snapback-client/index.mjs:5241)).

    Fix shape: explicitly refuse password methods when sender-constrained custody is active, or specify the route-bound issuance/nonce-rotation protocol. Do not silently downgrade to bearer-only custody.

## Verifications performed

- Read revision (c)’s authoritative delta list first, then the complete RFC.
- Traced catalog recognition/activation, identity/session foreign keys, challenge consumption, step-up binding, revocation, session projection, and client coordinator behavior in the checkout.
- Compared the RFC with LLP 0057, 0151, 0192, 0214, and 0226, plus the catalog-v3 backup issue.
- Confirmed the benchmark’s B2 48/82 figures and password-gap account in the checked-in pilot record and commissioning issue.
- Confirmed there is currently no `auth.passwords` capability row or password route/implementation outside design documents.
- Ran `./ref-check --verbose`: 228 LLP documents, 4,785 refs, zero errors or unchecked references.
- Did not inspect `llp/reviews/`, other worktrees, branches, or reflog; modified no files.
- Could not independently verify the external “OWASP-aligned” characterization from repository evidence alone; no external source was consulted.

## Verdict

VERDICT: NOT READY
## Round 3 — 2026-08-10 (delta round; final budgeted round)

- Reviewer: gpt-5 family — codex exec, model gpt-5.6-sol, reasoning xhigh,
  read-only sandbox, --ignore-user-config.
- Capsule: detached worktree at commit `ceb7803c4`.
- Target revision: (d), sha256 prefix `1bb56bc226e46052`.
- Instructions: sr-review-r3 delta template.
- Verdict: **NOT READY** (6 MATERIAL, all IN-DELTA).

### Verbatim review

## 1. Summary

The product direction is sound: password authentication should be a credential class feeding the existing session, principal, custody, and projection machinery. Revision (d), however, leaves six material ambiguities or contradictions around catalog authority, budgets, lockout serialization, displacement, and step-up targeting. An implementer still has several plausible but security-incompatible choices.

## 2. Direction assessment

The core choices are right:

- Keep password and email-code identities distinct so password signup does not assert email ownership.
- Reuse LLP 0057 sessions and credential responses rather than create parallel tokens.
- Hash server-side, outside the SQLite writer lock, with generation-fenced upgrade-on-verify.
- Require email proof for first password attachment and same-principal email proof for reset.
- Rotate the acting credential and terminate other sessions after sensitive changes.
- Route client adoption through the existing anonymous-issuance and authenticated-rotation coordinators.

The direction should proceed, but only after the overlapping identity-core and effect-budget authorities become one executable contract.

## 3. Concerns

1. **MATERIAL — IN-DELTA — The claimed catalog reconciliation with LLP 0214 is not true.**

   Exact text at issue: “its two tables land as a strict subset of 0214's catalog progression” and “where 0214's password shape and this sketch differ, 0214's shape supersedes” ([LLP 0227, lines 116–131](/Users/ccheever/projects/snapback-worktrees/sr-r3/llp/0227-password-credential-auth.rfc.md:116)).

   Repository evidence:

   - LLP 0214 makes v3 recognition exact and classifies changed or extra owned objects as `SNAPBACK_AUTH_CATALOG_CORRUPT` ([LLP 0214, lines 603–660](/Users/ccheever/projects/snapback-worktrees/sr-r3/llp/0214-snapback-identity-core.spec.md:603)).
   - LLP 0227's `_auth_password_attempts` does not exist in LLP 0214. The two `_auth_password_credentials` definitions are not subset/superset shapes: 0227 stores `user_id`, `identity_id`, `phc_string`, and generation directly; 0214 uses a base `_auth_credentials` row plus a material row keyed by `credential_id`, and constrains `algorithm = 'argon2id'` ([LLP 0214, lines 825–901](/Users/ccheever/projects/snapback-worktrees/sr-r3/llp/0214-snapback-identity-core.spec.md:825)).
   - The disagreement extends beyond DDL. LLP 0214 says it owns password transitions, uses `/register` and `/authenticate`, uses an app-local provider installation and `username-v1`, mandates recovery-code issuance for new password accounts, and defines different diagnostics ([LLP 0214, lines 2275–2466](/Users/ccheever/projects/snapback-worktrees/sr-r3/llp/0214-snapback-identity-core.spec.md:2275)). LLP 0227 uses fixed provider `'password'`, email canonicalization, `/signup` and `/signin`, foreign scrypt/bcrypt storage, and intentionally no self-serve recovery for password-only accounts.
   - Acceptance still says “catalog-v3 readiness” even though the new paragraph permits a different future marker ([LLP 0227, lines 448–452](/Users/ccheever/projects/snapback-worktrees/sr-r3/llp/0227-password-credential-auth.rfc.md:448)).

   Fix shape: establish one authority for the complete password slice, not just its table name. Amend or supersede the conflicting LLP 0214 sections; publish one exact catalog descriptor including the attempt-state disposition; reconcile provider identity, route aliases, diagnostics, recovery scope, and imported-hash representation; and name the actual marker/readiness predicate. Remove “strict subset” unless the resulting exact DDL really is one.

2. **MATERIAL — IN-DELTA — `loopback`/`remote` accounting contradicts the effect-budget authority and does not provide the claimed lockout-DoS resistance.**

   Exact text at issue: local `source_class` is the two-valued `loopback`/`remote` partition, followed by “a third party cannot cheaply deny a known address” ([LLP 0227, lines 99–108](/Users/ccheever/projects/snapback-worktrees/sr-r3/llp/0227-password-credential-auth.rfc.md:99), [lines 331–345](/Users/ccheever/projects/snapback-worktrees/sr-r3/llp/0227-password-credential-auth.rfc.md:331)).

   Repository evidence:

   - LLP 0215 owns auth budget names, axes, charging, and refusal behavior ([LLP 0215, lines 44–78](/Users/ccheever/projects/snapback-worktrees/sr-r3/llp/0215-effect-budgets.spec.md:44)).
   - It explicitly says the local target has no effective-source capability and “must not claim or synthesize one” ([LLP 0215, lines 252–303](/Users/ccheever/projects/snapback-worktrees/sr-r3/llp/0215-effect-budgets.spec.md:252)), repeating that local policy must omit source rules or refuse ([LLP 0215, lines 785–803](/Users/ccheever/projects/snapback-worktrees/sr-r3/llp/0215-effect-budgets.spec.md:785)).
   - A single `remote` class groups every non-loopback caller. Any remote attacker able to submit ten guesses can therefore lock out all legitimate remote callers for that address. It protects loopback from remote traffic; it does not protect one remote caller from another.
   - LLP 0215 already names `auth.guessing`, `auth.enumeration`, `auth.hash-cpu`, and `auth.session-mint`; 0227 instead invents a second accounting vocabulary while saying it reuses LLP 0057 machinery.

   Fix shape: reconcile explicitly with LLP 0215. For the local slice, omit the source axis and state the honest address-level lockout-DoS tradeoff, or first add a target-authenticated effective-source capability through its governing authority. Hosted source grouping must defer to LLP 0060/0215. Bind password signin and current-password change to named budgets, numeric profile terms, charge-on-denial behavior, and any compatibility aliases.

3. **MATERIAL — IN-DELTA — The keyed address hash has no key identity or rotation contract.**

   Exact text at issue: `address_hash` is “keyed hash of the canonical address,” but the table has no key/version column and the prose supplies no key authority ([LLP 0227, lines 87–108](/Users/ccheever/projects/snapback-worktrees/sr-r3/llp/0227-password-credential-auth.rfc.md:87)).

   Repository evidence:

   - The existing auth keyring rotates its active key every 30 days and retains retired keys only while referenced challenges require them ([LLP 0057, lines 640–657](/Users/ccheever/projects/snapback-worktrees/sr-r3/llp/0057-auth-provider-protocol.spec.md:640); [keyring implementation, lines 170–223](/Users/ccheever/projects/snapback-worktrees/sr-r3/src/auth/keyring.rs:170)).
   - Challenges store `key_id`; `_auth_password_attempts` does not. Hashing with the current active key would silently lose an existing lock/window at rotation. A separate stable key would introduce unspecified custody, backup, restore, and rotation behavior.
   - LLP 0215 permits protected canonical values for local counters and reserves HMAC-key topology for properly governed targets ([LLP 0215, lines 305–318](/Users/ccheever/projects/snapback-worktrees/sr-r3/llp/0215-effect-budgets.spec.md:305)).

   Fix shape: either use the protected canonical address for this local-only ledger, or define a domain-separated key authority with a stored key/version identifier, rotation lookup/migration rules, retired-key retention tied to ledger references, and explicit backup/restore custody.

4. **MATERIAL — IN-DELTA — The two-phase fence does not fence the mutable lockout predecessor.**

   Exact text at issue: verification reads `(credential id, credential_generation, phc_string, lock state)`, but the transaction requires only exact `(id, generation)` before minting/accounting ([LLP 0227, lines 283–292](/Users/ccheever/projects/snapback-worktrees/sr-r3/llp/0227-password-credential-auth.rfc.md:283)). Revision (d) then makes `_auth_password_attempts` the sole accounting authority without giving it a generation.

   A correct-password KDF can begin while unlocked, ten failures can lock the ledger, and the correct result can then enter its transaction with an unchanged credential generation. The RFC does not decide whether that result must observe the new lock or may reset the counter and mint. Concurrent ninth/tenth failures have the same ambiguity.

   The current email-code implementation re-reads every mutable challenge field inside the writer transaction and CASes the exact attempt predecessor ([provider implementation, lines 4244–4358](/Users/ccheever/projects/snapback-worktrees/sr-r3/src/auth/provider.rs:4244)).

   Fix shape: require the final transaction to re-read and apply the current ledger state after serialization, including window rollover and `locked_until_ms`, before success/reset or failure increment. If snapshot equality is intended, add an attempt generation and CAS it. Add acceptance interleavings for ninth/tenth/correct attempts and for lock expiry.

5. **MATERIAL — IN-DELTA — FK cascade is not by itself the required session-terminal protocol for displacement.**

   Exact text at issue: displacement “retires” the password identity, which “revokes the sessions minted through it (they cascade with the identity)” ([LLP 0227, lines 252–260](/Users/ccheever/projects/snapback-worktrees/sr-r3/llp/0227-password-credential-auth.rfc.md:252)).

   Repository evidence:

   - Deleting an identity really does cascade-delete its sessions and their token tombstones in the current catalog ([LLP 0057, lines 423–479](/Users/ccheever/projects/snapback-worktrees/sr-r3/llp/0057-auth-provider-protocol.spec.md:423)).
   - Accepted LLP 0059 requires every operation ending authority to plan the exact affected set, premark and drain it before the durable write, commit, publish the terminal disposition, and reconcile ambiguous commits ([LLP 0059, lines 1181–1202](/Users/ccheever/projects/snapback-worktrees/sr-r3/llp/0059-session-projection-and-client-barrier.spec.md:1181)). A committed backing-authority deletion must then publish `durableDelete`; clients cannot infer that from a missing row or generic `revoked` result ([LLP 0059, lines 1518–1583](/Users/ccheever/projects/snapback-worktrees/sr-r3/llp/0059-session-projection-and-client-barrier.spec.md:1518)).
   - Once the FK cascade has committed, the exact affected session set is no longer available for a post-hoc plan.

   Fix shape: specify displacement as a first-class terminal operation: pre-plan sessions tied to the displaced identity, premark/drain them, atomically retire/delete the identity and credential, publish `durableDelete`, settle projections, and reconcile predecessor/successor state on commit ambiguity. Pin whether “retire” means LLP 0214's `disabled_at_ms` plus explicit session revocation or physical deletion.

6. **MATERIAL — IN-DELTA — First-set step-up does not uniquely select its email identity and target.**

   Exact text at issue: set “binds the address of the acting principal's own `'email-code'` identity,” while the change DTO gains only `stepUp: { challengeId, code }` ([LLP 0227, lines 239–251](/Users/ccheever/projects/snapback-worktrees/sr-r3/llp/0227-password-credential-auth.rfc.md:239)).

   Repository evidence:

   - `_auth_identities` is unique by `(provider, subject)`, not by `(user_id, provider)`; the schema permits multiple email-code identities for one principal ([LLP 0057, lines 423–437](/Users/ccheever/projects/snapback-worktrees/sr-r3/llp/0057-auth-provider-protocol.spec.md:423)).
   - The existing step-up address helper chooses the identity through which the current session was minted and requires that identity itself to be `email-code`; it does not choose an arbitrary email-code identity belonging to the principal ([auth catalog implementation, lines 17–48](/Users/ccheever/projects/snapback-worktrees/sr-r3/src/storage/auth_catalog_ops.rs:17)).
   - The RFC does not say whether a broker-origin session with an email-code identity may set a password, which email wins when several exist, or what exact target is included in the new step-up HMAC.

   Fix shape: choose one rule. Either require an email-code-origin acting session and use that exact session identity, or add a closed email/identity target to both the set and step-up-request DTOs, validate ownership, and bind its canonical identity into the challenge. Add multiple-email and broker-origin acceptance cases.

7. **implementation-phase — PRE-EXISTING — The CLI password carrier is incomplete and ambiguously framed.**

   Exact text at issue: change reads `current\nnew\n`, while “CLI verbs are thin projections of these routes”; reset has no listed CLI verb ([LLP 0227, lines 179–190](/Users/ccheever/projects/snapback-worktrees/sr-r3/llp/0227-password-credential-auth.rfc.md:179)).

   Password policy does not prohibit newline characters, and LLP 0214 states that exact decoded password strings are not normalized ([LLP 0214, lines 2018–2021](/Users/ccheever/projects/snapback-worktrees/sr-r3/llp/0214-snapback-identity-core.spec.md:2018)). Newline separation therefore cannot unambiguously represent every admitted pair.

   Fix shape: use an unambiguous bounded stdin format, such as a closed JSON object or explicit length framing, and define trailing-EOF behavior. Add the reset CLI projection or narrow the “these routes” claim.

8. **implementation-phase — PRE-EXISTING — Failure transport and commit-ambiguity handoff remain unspecified.**

   The RFC says refusals are “stable typed codes” but supplies no HTTP statuses, retry envelope, route-registry credential/effect classifications, or ambiguity reconciliation for signup/change/reset ([LLP 0227, lines 318–353](/Users/ccheever/projects/snapback-worktrees/sr-r3/llp/0227-password-credential-auth.rfc.md:318)). The route taxonomy requires independent credential-resolution, invocation-authority, effect, and response-sensitivity classifications ([LLP 0031, lines 219–253](/Users/ccheever/projects/snapback-worktrees/sr-r3/llp/0031-server-route-taxonomy.spec.md:219)). LLP 0057 also forbids guessing after ambiguous credential mint/rotation commits and requires exact durable reconciliation ([LLP 0057, lines 1524–1544](/Users/ccheever/projects/snapback-worktrees/sr-r3/llp/0057-auth-provider-protocol.spec.md:1524)).

   Fix shape: add the complete route-policy/status/retry matrix and define exact predecessor/successor reconciliation for every operation that changes a password, consumes a challenge, rotates a bearer, or terminates sessions. Add fault-injection acceptance for lost commit acknowledgements.

## 4. Verifications performed

- Read the revision-(d) history first, then all 509 lines of LLP 0227.
- Compared it with LLP 0214's catalog, password transitions, recovery floor, diagnostics, and acceptance matrix.
- Compared lockout and throttling with LLP 0215's budget ownership, axes, privacy, local/hosted realization, and open numeric policy.
- Checked accepted LLP 0057/0059 contracts and current Rust DDL, keyring rotation, exact challenge CAS, session lookup, step-up address derivation, route registry, and client coordinator behavior.
- Confirmed LLP 0192 supports the revised physical-store custody carve-out.
- Confirmed the benchmark record contains B2 48 versus 82 and the reported 2.62-hour auth-meter observation.
- Confirmed `main` at `ceb7803c4` contains no password routes, tables, diagnostics, client methods, Argon2 dependency, or `auth.passwords` capability row; this agrees with “No implementation has begun.”
- Worktree was clean. No file was modified. I did not inspect `llp/reviews/`, another worktree, git history, or the reflog.
- I did not independently verify the external “OWASP-aligned” characterization; this review verified repository consistency only.

## 5. Verdict

VERDICT: NOT READY