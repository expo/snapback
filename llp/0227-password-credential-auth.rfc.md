# LLP 0227: First-class email+password credential auth on the sessions surface

**Type:** RFC
**Status:** Implemented (local slice)
**Systems:** Auth, Server, CLI, Client protocol, Guide
**Author:** Charlie Cheever / Claude
**Date:** 2026-08-10
**Revised:** 2026-08-25 (j — password-set subject derivation and published
client step-up mint surface corrected per LLP 0303)
**Revised:** 2026-08-10 (a — initial draft, commissioned by the author ruling
in `issues/20260809-password-credential-auth.md`)
**Revised:** 2026-08-10 (b — Draft → Review at llp-super-refine loop start,
the one authorized transition; independent-loop topology)
**Revised:** 2026-08-10 (c — round-1 revision; see Revision history)
**Revised:** 2026-08-10 (d — round-2 revision; see Revision history)
**Revised:** 2026-08-10 (e — post-round-3 closing fixes; **unreviewed** — see
Revision history)
**Revised:** 2026-08-10 (f — round-3 revision under the author's extended
budget; see Revision history)
**Revised:** 2026-08-10 (g — round-4 revision; see Revision history)
**Revised:** 2026-08-10 (h — round-5 closing revision; loop terminal — see
Revision history)
**Revised:** 2026-08-10 (i — 0214 reconciliation applied; see Revision
history)
**Revised:** 2026-08-12 (j — Review → Implemented (local slice); Status records
the implemented-core / exposed-surface / published-closure split, the six
author rulings of 2026-08-11, and the verification-cost correction to
§Migration)
**Revised:** 2026-08-15 (k — password `minimumLength` declaration: bounded
8–128 bytes, 12-byte default, first-boot startup-carrier enforcement, and
actionable policy refusals)
**Related:** LLP 0057 (auth catalog and provider protocol — the substrate this
extends), LLP 0151 (first-party identity integrations — tier-1
username+password sketch and the identities-vs-credentials rule), LLP 0039
(auth vertical slice — server-derived principals), LLP 0011 (auth and
permissions — Argon2-outside-the-writer-lock rule, non-oracular failure
shapes), LLP 0058 (staged auth-mode protocol and the external-broker seam),
LLP 0059 (session projection), LLP 0258 (application auth bootstrap —
composition owner over this mechanism; cross-reference only), LLP 0024 (agent operating surface — one core,
thin projections), LLP 0045 (mail delivery adapter — external prerequisite for
production reset), LLP 0037 (closed DTO conventions),
`benchmarks/records/2026-08-09-social-messenger-p2-pilot.md` (B2 = 48 vs
GoTrue 82; F5 headline gap), `issues/20260809-password-credential-auth.md`,
`guide/auth/sessions-and-principals.md`

## Summary

The Clique P2 pilot scored Snapback's B2 auth milestone 48/100 — the lane's
floor — against Supabase GoTrue's 82, because Snapback ships only email-code
sessions. The lane hand-rolled scrypt hashing in a gateway and shelled out to
`snapback session mint` per login over an undocumented HTTP shape. GoTrue won
on exactly four properties: email+password signup/signin callable
non-interactively, server-side hashing, standard rate limiting, and token
issuance.

This RFC adds a **password credential class to the existing sessions surface**.
A password proves control of *the account whose login name is this
email-shaped string* — deliberately **not** proof of control of the email
address itself; only an email-code exchange proves that, and the two claims
get two distinct identity rows (§Principal binding). A successful signin runs
the same session-creation core as an email-code exchange and returns the
identical LLP 0057 composed credential response. There is **no parallel
identity system, no parallel token, and no new session shape** — one
principal, multiple credentials. Storage is server-side argon2id with
upgrade-on-verify migration; the lockout/rate posture is a declared, testable,
non-oracular contract with stable refusal codes.

**Scope declaration.** This is a **local-target benchmark-closure slice**: it
implements the password portion of LLP 0151's tier-1 package on the local
target, and does not claim tier-1 completion (recovery codes, hosted
admission, sender-constrained issuance, and the full witness matrix stay with
LLP 0151). Production-profile behaviors named here (blind-accept signup,
mail-delivered reset) are annotated external prerequisites, not shipped
claims.

**Scope fence (author ruling 2026-08-10):** exactly email+password on the
sessions surface. This is not a general OAuth/identity-provider program — that
catalog belongs to LLP 0151, whose tier-1 "username + password" row this RFC
implements, narrowed to email as the identifier. Passkeys, guest claiming,
recovery codes, MFA, and provider adapters stay in 0151 and its commissioned
lifecycle spec.

## Credential storage

Per LLP 0151's structural rule, **identities and authenticators do not share a
relation**. The catalog (an LLP 0057 versioned migration) adds two tables:

```sql
CREATE TABLE "_auth_password_credentials" (
  id TEXT NOT NULL PRIMARY KEY,
  user_id TEXT NOT NULL,
  identity_id TEXT NOT NULL,          -- the 'password' identity row
  phc_string TEXT NOT NULL,           -- self-describing PHC format
  credential_generation INTEGER NOT NULL DEFAULT 1,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  FOREIGN KEY(user_id) REFERENCES "_auth_users"(id) ON DELETE CASCADE,
  FOREIGN KEY(identity_id, user_id)
    REFERENCES "_auth_identities"(id, user_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX "_auth_password_credentials_identity_uq"
  ON "_auth_password_credentials"(identity_id);
CREATE UNIQUE INDEX "_auth_password_credentials_user_uq"
  ON "_auth_password_credentials"(user_id);   -- one live password per principal

CREATE TABLE "_auth_password_attempts" (      -- the single accounting authority
  address TEXT NOT NULL PRIMARY KEY,          -- canonical address; a protected
                                              -- catalog relation in the same
                                              -- custody class as
                                              -- _auth_identities.subject
  window_start_ms INTEGER NOT NULL,
  failed_count INTEGER NOT NULL DEFAULT 0,    -- consecutive-failure lockout
                                              -- counter: reset on success;
                                              -- INTERNAL state only
  locked_until_ms INTEGER                     -- INTERNAL state only
);
```

**One live password credential per principal** (`_user_uq`): change needs no
credential selector, and import's attach mode refuses when one exists. All
password-path accounting lives **only** in `_auth_password_attempts` — the
credential row carries none, so there are not two accounting authorities —
and the ledger holds exactly one job: `failed_count` is the
consecutive-failure lockout counter that success resets, and it is
internal state (§Lockout). Rate metering is **not** this relation's job —
`SNAPBACK_AUTH_THROTTLED` is driven by LLP 0215's named budgets. The ledger stores the **canonical address** and is a protected
catalog relation in the same custody class as `_auth_identities.subject`
(LLP 0057's canonical-address custody list gains this row — an explicit
custody amendment, not a drive-by). **There is no source axis in this
slice**: the local target cannot authenticate a peer's source (that is LLP
0215's effective-source capability at the hosted edge), so the lock is
address-level and the honest tradeoff is stated — a third party who knows
an address can lock its password path for the window; the trusted local
target accepts this, and a source axis arrives only with a
target-authenticated effective-source capability. Rows are GC'd once their
window and any lock expire, under a bounded row count whose exhaustion
refuses with `SNAPBACK_AUTH_THROTTLED`.

At most one password credential per identity; the identity row (and therefore
the canonical address, canonicalized exactly per LLP 0057 §Canonical address)
is the join point back to the principal. Implementation adds the catalog's
usual CHECK discipline to both tables (positive JS-safe generation,
nonnegative counts, timestamp domains, PHC length bound, lock range).

**Catalog versioning defers to LLP 0214, the identity-core catalog
authority.** LLP 0214 already defines catalog marker 3 (with its own —
richer — `_auth_password_credentials` shape, credentials/assurances/recovery
relations, and an explicit **no silent v1/v2 migration** rule), and its
catalog-v3 floor is currently blocked on backup-format interactions
(`issues/20260810-llp-0214-floor-catalog-v3-backup-blocked.md`). This RFC
therefore mints **no catalog version of its own**: this slice implements
**the sketch DDL above**, landing under a marker agreed with 0214's owner
(before or after 0214's v3 unblocks), and the two password designs are
reconciled by that owner's program rather than by a blanket shape-deference
— the named reconciliation items are (i) identifier class and its
canonicalization bridge (this slice's `email-v1` canonical address vs
0214's `username-v1` floor), (ii) identity-linked credential rows (this
sketch) vs 0214's kind-based `_auth_credentials` (which would need an
equivalent carrier for displacement's identity-retirement semantics),
(iii) displacement-by-retirement vs 0214's `revoked_at_ms` lifecycle, and
(iv) the attempt-ledger's place in the catalog descriptor. 0214's no-silent-migration rule is adopted
(the earlier automatic-upgrade language is withdrawn); backup-manifest,
reset, restore, and crash consequences ride 0214's ticket.
**Implementation gate:** no code lands until the 0214 reconciliation has
produced **one exact composed catalog descriptor and marker** — activation,
v1/v2 behavior, backup/restore/reset, readiness refusal,
identity-to-credential linkage, and the displacement lifecycle included —
plus two more deliverables of the same program: (v) the public refusal-code
family reconciled (this RFC's `SNAPBACK_AUTH_PASSWORD_*` vs 0214's uniform
`SNAPBACK_AUTH_CREDENTIAL_INVALID`), and (vi) the exact LLP 0031
route-policy tuples for the four routes, minted against the reconciled
credential-resolution cases (the tuple *obligation* is this RFC's; the
tuple *values* depend on the reconciled resolution enum and land with the
descriptor).
This RFC contributes requirements to that descriptor; it does not mint it,
because today's binary rejects unknown markers and treats extra `_auth_*`
tables as corruption, so there is no unilateral marker this slice could
legally occupy. Unchanged either
way: an older binary refuses an unknown catalog per 0057's recognition
discipline, and password routes on a catalog without these tables refuse
with a stable readiness code surfaced through `authProgramReadiness`.

**KDF: argon2id, pinned v1 parameters** (OWASP-aligned): memory 19 456 KiB,
iterations 2, parallelism 1, 16-byte random salt, 32-byte tag. Stored as a PHC
string so every hash is self-describing. Policy lives in code as a versioned
`PasswordHashPolicy`; the stored string is never the policy authority.

**Upgrade-on-verify.** On successful verification, if the stored PHC string's
algorithm or parameters differ from the current policy (older argon2id
parameters, or an imported scrypt/bcrypt hash — §Migration), the server
rehashes the presented plaintext under current policy and swaps it in a
compare-and-swap on `credential_generation`. A lost race means another verify
already upgraded; the swap is skipped, never retried with a stale generation.

**Hashing runs outside the single-writer lock** (LLP 0011's Valet-proven
rule): the KDF computes on a bounded blocking pool before the verification
transaction opens; only the constant-time comparison result and the
pre-computed replacement hash enter the transaction. A concurrency cap bounds
in-flight KDF work; beyond it, requests refuse with
`SNAPBACK_AUTH_THROTTLED` rather than queueing unboundedly (cost-DoS
posture, §Threat notes).

**Custody.** PHC strings are secret material under LLP 0057 §Security and
redaction: never in logs, diagnostics, receipts, inspect payloads, exports, or
`Debug`. Plaintext passwords are zeroized after hashing and never enter SQLite,
argv, or any diagnostic. Admin projections may expose existence, timestamps,
generation, and lock state — never the hash.

## Surface: routes, CLI verbs, client methods

All request/response DTOs follow LLP 0037: camelCase, `deny_unknown_fields`,
committed generated schemas, `Cache-Control: no-store` on credential
responses. Each route registers a complete LLP 0031 policy tuple — path
policy, credential resolution (reset/step-up proofs may need a new closed
resolution case), invocation authority, legacy-body policy, effect policy,
response sensitivity (credential-bearing → sensitive, body-capture
disabled), and session overlay — following LLP 0057's exact tuples for the
predecessor auth routes; an unregistered handler is unreachable by
construction. Every route below is public-path (no bearer) except change, and all
are callable non-interactively — the benchmark's core demand.

| Route | Body | Success |
|---|---|---|
| `POST /auth/password/signup` | `{ email, password }` | 200, composed credential response |
| `POST /auth/password/signin` | `{ email, password }` | 200, composed credential response |
| `POST /auth/password/change` | closed union: `{ currentPassword, newPassword }` (rotate) **or** `{ currentPassword: null, newPassword, stepUp: { challengeId, code } }` (set) + bearer | 200, composed credential response (rotated bearer; see below) |
| `POST /auth/password/reset` | `{ challengeId, code, newPassword }` | 200, composed credential response |

The success payload of signup, signin, and reset is **byte-shape-identical to
LLP 0057's exchange response** (`tokenType`, `token`, `refreshAfter`, flat
`session`, top-level `authorityDescriptor`) with `session.provider` reporting
the credential class. Refresh, logout, family alarm, rotation, sliding use,
session cap — everything downstream of minting — is LLP 0057 unchanged.

CLI verbs are thin projections of these routes (LLP 0024: one core, thin
projections), replacing the pilot's shell-out to `snapback session mint`:

```
snapback auth password signup --url … --email a@b.c --password-stdin
snapback auth password signin --url … --email a@b.c --password-stdin
snapback auth password change --url … --session-token-stdin --password-stdin
```

The change verb carries its bearer via `--session-token-stdin` (first line of
stdin, before the password lines) or the documented session-token file flag —
never argv.

Passwords are accepted **only** via stdin (or `SNAPBACK_PASSWORD` for harness
ergonomics, documented as test-profile material) — never argv, so they never
enter process listings or shell history. Unlike `session mint`, these verbs
require **no admin token and no impersonation capability**: they are the
product front door, not an operator impersonation path.

Client methods: `client.authPasswordSignup({ email, password })`,
`client.authPasswordSignIn({ email, password })`,
`client.authPasswordChange({ currentPassword, newPassword })` /
`client.authPasswordSet({ newPassword, stepUp })`,
`client.authPasswordReset({ challengeId, code, newPassword })`. Adoption
splits by predecessor state: signup/signin/reset adopt as **anonymous
issuance** (the `authExchange` path, which requires an anonymous
coordinator), password rotation is an **authenticated same-authority
rotation** (the `withCredentialRotation` path refresh already uses: verify
the same authority descriptor, replace the credential within it, refuse on
authority mismatch or stale response), and first-password set is an
authenticated same-user transition to the newly issued local-password
session. Set additionally projects the new recovery codes returned by its
credential-creation transaction. Custody, refresh, and the logout barrier are
untouched. **Sender-constrained custody:** when sender-constrained
credentials are active, v1 password methods refuse with a typed client
error rather than silently downgrading to bearer-only custody; the
route-bound issuance/nonce-rotation protocol for password mints is deferred
with the rest of the sender-constrained program.

## Principal binding: same sessions, no parallel identity

**The password login identifier is its own identity row.** A password
signup/set writes an `_auth_identities` row with `provider = 'password'` and
`subject =` the canonical address. It is a *login identifier*, never proof of
address control: it can never satisfy an email-code lookup (which resolves
`provider = 'email-code'` only, unchanged), and the email-code exchange path
is not modified by this RFC. `verified_at_ms` on a `'password'` identity is
its creation time and carries **no** email-verified meaning — verified-email
semantics live exclusively in the `'email-code'` provider namespace, so no
catalog column changes meaning. Because sessions already record
`identity_id`, `session.provider` reports `'password'` at mint **and** on
every later refresh with no new column and no DTO change.

- **Signup** canonicalizes the address, then in one `IMMEDIATE` transaction
  (address-stripe-locked, same 256-stripe discipline as request-code):
  refuse if the canonical address already resolves to **any** existing
  identity (either provider — §Threat notes for the enumeration posture);
  otherwise create the `_auth_users` row, the `'password'` identity, and the
  credential, enforce the session cap, and mint one session.
  **Pre-hijack containment is structural:** because a password-created
  principal is joined only through its `'password'` identity, a later
  email-code exchange for the same address misses it and mints a *separate*
  principal — an attacker who squats a victim's address gains an account of
  their own, never the victim's logins or data. The squatted `'password'`
  identity is displaced by the rule below.
- **Signin** resolves the canonical address to the `'password'` identity and
  credential, verifies (two-phase fence below), then runs the **same
  session-creation core** as a successful exchange.
- **Change** requires an authenticated session **and** the current password.
  The **set** form (`currentPassword: null`, principal has no password
  credential) binds **the address of the acting principal's own
  `'email-code'` identity** — a principal without one (password-only after
  displacement, broker-minted, imported without attach) cannot set and
  refuses with a typed code — and additionally requires a **fresh
  operation-bound step-up challenge** consumed in the same transaction
  (LLP 0151's rule): the change/set DTO gains an optional
  `stepUp: { challengeId, code }` member, carried by a new
  closed password-set entry in the existing operation-tagged step-up enum,
  bound to the exact session generation, authority instance, operation, and
  server-derived target as the existing step-up consumers are — the **target
  is the exact `'email-code'` identity that issued the authenticated
  session**, never a caller-supplied identity selector (LLP 0303), so a
  multi-email principal's set is unambiguous and a single-email principal's
  is exact. The proof is acquired end-to-end through
  `POST /auth/step-up/request` with `{ operation: 'passwordSet' }` (or the
  client's `authStepUpRequest` projection); one-active-challenge rules apply,
  and the set call consumes it via `stepUp`. A stolen bearer alone can neither
  rotate nor create the credential. Set on an address whose `'password'`
  identity belongs to a *different* principal **displaces** that identity
  and its credential — email proof outranks an unverified squat.
  Displacement is a **first-class session-terminal operation**, not a bare
  FK side effect: the transaction plans the exact session set tied to the
  displaced identity, atomically retires the identity and credential
  (removing those sessions with it), and publishes LLP 0059 settlement for
  exactly that set with the `durableDelete` terminal disposition — the
  committed ending of a backing authority, which is what this is. The
  displaced principal keeps its account, data, and any sessions minted
  through other identities, and loses password login. Both change forms write the hash, increment
  `credential_generation`, rotate the acting session's bearer, and revoke
  the user's other sessions (revocation operation below).
- **Reset is same-principal only.** `POST /auth/password/reset` resolves the
  address, then requires that the address's `'email-code'` identity and its
  `'password'` identity belong to the **same principal**; any other
  configuration (password-only account, email-code-only account, or the
  two-principal squat state) refuses with the uniform failure code —
  transferring a squatter's credential to an email-prover, or resetting a
  password-only account that has never proved the address, is exactly the
  pre-hijack this RFC contains, and LLP 0151 reaches the same posture
  (email reset only against a verified email; recovery for password-only
  accounts is the recovery-codes package, out of this slice). A password-only
  principal's recovery path in v1 is therefore: none self-serve (documented
  non-recoverable posture; the gated operator seam and 0151's recovery codes
  are the successors). The reset transaction consumes the challenge, applies
  the **same screening policy and version as signup/change** (identical
  `PASSWORD_WEAK` refusal), replaces the hash, revokes the user's other
  sessions, and mints a fresh session. 0057's one-active-challenge
  invariant applies: a reset code and a sign-in code are the same spendable
  proof, and a new request supersedes the outstanding challenge. Local
  target: capture mailbox (admin- and impersonation-gated, test material);
  production reset carries LLP 0045's mail adapter as its external
  prerequisite. Preissued recovery codes stay with the 0151 lifecycle spec.

**Two-phase verification fence.** Verification reads the exact predecessor —
`(credential id, credential_generation, phc_string, lock state)` — computes
the KDF outside the writer lock (LLP 0011), then the issuing/accounting
transaction **requires that exact `(id, generation)` predecessor** before any
failure accounting, upgrade-on-verify swap, or session mint; on mismatch (a
concurrent change/reset landed) it **refuses** with the uniform
`SNAPBACK_AUTH_PASSWORD_INVALID` and performs **no failure accounting** — a
stale proof never authorizes and never penalizes, mirroring LLP 0059's
exact-predecessor discipline. (No restart: the old password is simply wrong
now.) The fence covers the **ledger predecessor** too: the final
transaction re-reads current ledger state under serialization — window
rollover and `locked_until_ms` included — before any success reset, failure
increment, or mint, so a lock acquired during the KDF window is honored and
a rolled window is not double-counted.

**User-scoped revocation operation.** Change and reset use a **new**
user-scoped revocation (LLP 0057's bulk-revocation transaction is
deliberately instance-wide and is *not* reused): in the credential-mutating
transaction, revoke exactly the user's live sessions minus the acting session
(change) or minus the newly minted session (reset), preserving 0057's
revocation invariants — generation bump, no row deletion, revocation clock
floor — and settling projections per LLP 0059 for exactly the affected
session set.

**Composition and precedence.** One principal may carry both an
`'email-code'` and a `'password'` identity for the same address (the
authenticated set path creates exactly this), and broker-minted sessions
(LLP 0058 seam) compose unchanged; each path independently proves its own
claim and mints an ordinary session — no path shadows another. Two
*different* principals may transiently hold the address's two identity rows
(unverified password signup followed by the address owner's email-code
login); the set-displacement rule above is the sanctioned unification, always
in favor of email proof. Custody rules compose unchanged: the broker seam
remains a gated non-production host operation per LLP 0057/0058; the password
routes never accept a caller-asserted `userId` (LLP 0039); credential
material never crosses the redaction boundary. Unlinking a password
credential is **deferred** to the 0151 lifecycle spec — v1 ships set,
change, and displacement only.

## Lockout and rate posture: a declared, testable contract

Refusals are **stable typed codes, not silent throttling** — the same
assertable-refusal discipline as the rest of the auth surface:

| Code | Trigger | Declared v1 threshold |
|---|---|---|
| `SNAPBACK_AUTH_PASSWORD_INVALID` | wrong password **or** no such account (uniform) | — |
| `SNAPBACK_AUTH_PASSWORD_LOCKED` | credential lockout — **internal + authenticated observability only, never on the public wire** (a locked credential answers `PASSWORD_INVALID`, byte- and timing-identical) | 10 consecutive failures → locked 15 minutes |
| `SNAPBACK_AUTH_PASSWORD_EXISTS` | signup on an address that already resolves to an account (local profiles; see §Threat notes) | — |
| `SNAPBACK_AUTH_PASSWORD_WEAK` | screening refusal at signup/change | length < 8, > 1024 bytes, or blocklist hit |
| `SNAPBACK_AUTH_THROTTLED` | windowed budget or KDF-concurrency cap | LLP 0215 named budgets (declared parameters; annotated prerequisite while 0215 is wave-1a) |

**Failure accounting is address-keyed and account-existence-blind; budgets
are LLP 0215's.** The attempt ledger (§Credential storage) holds **lockout
state only**. Windowed rate budgets — per-address and global signup/signin
meters, KDF-concurrency, and any future axes — bind to **LLP 0215's effect
budgets** (named budget rules with its exact rolling windows,
charge-on-denial, and idempotent retry accounting): this RFC declares the
named password budgets there and does not mint a parallel budget
authority (LLP 0214 forbids a second endpoint counter). The ledger records
attempts whether or not an account exists; lock state is **internal**: the public wire answers the uniform
`PASSWORD_INVALID` for wrong-password, no-account, and locked alike —
identical code, shape, headers, and timing envelope — because a *visible*
lock is itself an oracle (a real account's counter resets when its owner
signs in; a missing address's never does, so visible lock behavior would
diverge across allowed histories and disclose successful-authentication
activity). Lock state surfaces only through the authenticated admin
projection and `authProgramReadiness`-class observability (LLP 0151's
non-oracular rule; LLP 0214's uniform password-result contract). The address-level lockout-DoS tradeoff is stated in
§Credential storage. Accounting is transactional. Only **budget** refusals short-circuit
before KDF (`THROTTLED` is a typed public code anyway); **lock-window
attempts spend uniform KDF cost** — dummy or real, exactly as
nonexistent-address signins do — before the uniform refusal, or the
fast-path itself becomes the lock-state timing oracle. The lock check
still runs at admission — note the boundary case: the
10th attempt admits (only 9 failures exist at admission), spends its KDF,
fails, and the same transaction that records the 10th failure classifies
it internally as `PASSWORD_LOCKED` (the wire still answers the uniform
`PASSWORD_INVALID`); success resets `failed_count` only; a `failed_count` below threshold
decays when its window rolls (declared v1 window: 15 minutes, a profile
parameter like every threshold here); lock expiry reopens without
operator action. Signup and signin rate metering is entirely LLP 0215's: the named
password budgets (per-address and global axes) are declared there, and
neither 0057's challenge-row substrate (which password signin does not
create) nor this RFC's attempt ledger carries any budget counter.

### Password policy declaration

The app may declare `minimumLength` on its `defineAuth` password mechanism.
The value is one app-wide safe integer from 8 through 128; multiple password
mechanisms must resolve to the same value. Omission preserves the 12-byte
default. The maximum accepted decoded UTF-8 length remains 1 024 bytes and the
common-password screen remains mandatory. Generated schema artifacts carry
the explicit value, and provider construction consumes the selected startup
artifact on first boot rather than the dormant schema. Changing this boot-time
policy requires a backend restart. `SNAPBACK_AUTH_PASSWORD_POLICY` names the
active minimum, maximum, declaration path, and default without echoing the
secret.

**Every threshold is a declared profile parameter, not a fixed constant.** The
pilot's Supabase lane lost ≈2.6 h of an envelope run to GoTrue's
unconfigurable 30-signups/5 min/IP meter (record §Scale-envelope, F6). Test
and dev profiles ship with budgets high enough for acceptance suites and
benchmark envelopes; production defaults are conservative. The contract is
testable because acceptance drives N failures and asserts the exact code at
the exact declared threshold — no tarpits, no adaptive black boxes.

## Migration and import of existing hashes

**Admitted, not deferred.** A host operation `auth.importPasswordCredential`
(AdminWrite + ImpersonationCapability, non-production profiles — the same gate
class as `auth.mintSession`) has two explicit modes:
**create** (`{ email, phcString }`, address must resolve to no identity —
provisions principal + `'password'` identity + credential as signup does) and
**attach** (`{ email, phcString, expectedUserId }` — attaches the credential
and `'password'` identity to exactly that existing principal, refusing on any
mismatch, on any identity collision, and when the principal already holds a
password credential — the one-per-principal index is load-bearing). The
pilot's data absorbs via **attach**: its
principals were minted through the sanctioned session-mint seam and already
exist. Foreign hashes are bounded, not just allowlisted: encoded length,
algorithm/version, salt and tag sizes, and every cost parameter (memory,
iterations, parallelism / N, r, p / bcrypt cost) validate against declared
caps before storage, so an imported PHC string cannot demand pathological
KDF work. First successful signin verifies under the stored algorithm and
**upgrades-on-verify to current argon2id policy**. Plaintext-password import
does not exist. Hosted-production import ceremony is out of scope until a
hosted auth target exists.

## Threat notes

- **Timing.** Signin against a nonexistent address verifies a precomputed
  dummy PHC hash so the KDF cost is uniform; comparisons are constant-time;
  `PASSWORD_INVALID` is returned for both wrong-password and no-account on an
  indistinguishable path.
- **Enumeration.** Signin and reset are non-oracular: reset's code request is
  the existing `request-code` route, which already answers identically whether
  or not an identity exists. **Signup is the honest exception**: a
  non-interactive signup that mints a session on success cannot be both
  useful and fully blind. V1 pins, per profile: local/dev/test profiles
  return `PASSWORD_EXISTS` (documented as a deliberate enumeration oracle on
  the trusted local target); the production posture is **blind-accept** —
  uniform accepted shape, no session, notice delivered to the existing
  account's address — which is gated on LLP 0045 delivery and is therefore an
  annotated external prerequisite, not a shipped claim (§Open questions).
- **Cost DoS.** The KDF concurrency cap plus windowed budgets bound
  memory×time exposure; hashing never holds the single-writer lock, so a
  guessing burst cannot starve unrelated writes (LLP 0011).
- **Screening.** Length 8–1024 bytes plus a compact embedded
  common-password blocklist at signup and change — LLP 0151's launch
  baseline, without claiming full NIST SP 800-63B reproduction.
- **Custody.** No password or hash in argv, logs, receipts, diagnostics,
  inspect payloads, or **logical/app-level exports and projections**;
  credential responses `no-store`; body-capture logging disabled on these
  routes — all inherited LLP 0057 rules. Owner-authorized **physical**
  store custody deliberately carries the database bytes as-is: `snapback
  store export`, whole-store backup (LLP 0192), and replication ciphertext (LLP 0188)
  produce faithful copies including credential hashes, while their
  manifests and diagnostics remain redacted.

## Acceptance criteria

Phrased against the Clique B2 brief: a benchmark lane must be able to score
the auth milestone **without hand-rolled hashing and without shelling out to
`snapback session mint`**.

1. **Non-interactive end-to-end:** a headless script performs signup → signin
   → authenticated call → change → re-signin using only documented HTTP
   routes (and again using only `client.authPassword*` methods), receiving
   the LLP 0057 composed credential response each time.
2. **Same-principal composition and containment:** an acceptance witness
   mints a persona via email-code, asserts password signup on that address
   refuses with `PASSWORD_EXISTS`, attaches a password through the
   authenticated set path (consuming the step-up challenge), signs in with
   it, and asserts one stable `userId` across both paths with
   `session.provider` reporting each mint's class consistently on refresh.
   A second witness proves containment: password-signup on a fresh address,
   then email-code login on that address yields a *different* principal, and
   the email-proved principal's set path displaces the squatter's credential.
3. **Declared lockout contract, non-oracular:** drive failures on an
   existing and a missing address in parallel — the public wire answers
   `PASSWORD_INVALID` uniformly through and past the threshold for both,
   within the declared timing envelope, including the history with a
   successful owner sign-in interposed between attacker failures; the
   lock's existence, threshold, and expiry are asserted through the
   authenticated admin projection; assert `SNAPBACK_AUTH_THROTTLED` at a
   deliberately lowered LLP 0215 test-profile budget — proving
   configurability.
4. **Change consequences and the fence:** other sessions of the user are
   revoked after change/reset (only that user's — a bystander session on the
   instance survives); the acting session's bearer is rotated; old bearer
   follows the 0057 credential-resolution matrix; a signin racing a
   change/reset (KDF completed against the predecessor hash) refuses with
   uniform `PASSWORD_INVALID` and no failure accounting; a bearer alone
   cannot set a first password (step-up challenge required); displacement
   revokes exactly the sessions minted through the displaced `'password'`
   identity while the squatter's other sessions and data survive; reset
   refuses in the two-principal squat and password-only configurations.
5. **Import:** an imported scrypt PHC credential signs in successfully and is
   observed (admin projection: generation + algorithm class only) to have
   upgraded to argon2id.
6. **Uniformity smoke:** no-account vs wrong-password signin are
   code-identical and within a declared timing envelope.
7. **Guide + capability index:** a `guide/auth/passwords.md` page with
   CI-verified snippets; a **new** `auth.passwords` capability row is added
   with route witnesses (none exists today — the index gains the row rather
   than flipping one); `authProgramReadiness` gains a password-provider
   facet including readiness for the password tables' catalog marker.

## Open questions

1. **Production signup enumeration posture** — is blind-accept (uniform
   accepted shape, **no session**, email notice) the ruled production
   default, or is a disclosed `PASSWORD_EXISTS` oracle acceptable there too?
   Note the DTO consequence either way: a uniform blind-accept shape must
   apply to new *and* existing addresses in production, so the routes
   table's "200, composed credential response" is the local/dev/test
   contract and production signup is a different declared shape — the
   acceptance script targets the local contract. (Local-profile oracle is
   pinned above; only the production default needs a ruling.)
2. **Operator unlock** — should v1 ship an admin verb to clear a lockout
   before `locked_until_ms`, or is waiting out the window acceptable until
   the 0151 lifecycle spec lands?
3. **`SNAPBACK_PASSWORD` env carrier** — keep as test-profile ergonomics for
   harnesses, or require stdin-only everywhere?

## Status

**Implemented (local slice), 2026-08-11/12.** Commissioned 2026-08-10 from
`issues/20260809-password-credential-auth.md`.

The distinction this section must keep visible — implemented core, exposed
surface, and published closure are three different claims:

| | State |
|---|---|
| **Internal core** | Implemented. Landed `961b8be8c` (LLP 0214 floor) and `ef936353f` (issuance integration, lockout, fence, KDF bounds, budgets). |
| **Exposed surface** | Implemented. `d6fc55d7f` (7 HTTP routes) and `534b58bdb` (CLI verbs + `@expo/snapback-client` methods). |
| **Published closure** | See the capability index. Until a published-package clean install proves the flow, `auth.passwords` stays `partial`. |

**Where the shipped implementation diverges from this RFC**, all under author
rulings taken 2026-08-11:

1. **Catalog v4, not "the composed v3 descriptor."** v3 shipped publicly in
   0.1.18/0.1.19 before the attempt ledger existed, and catalog recognition
   compares stored SQL against the marked version's descriptor — so amending v3
   in place would have made those stores refuse entirely. LLP 0214 §21 records
   the ruling.
2. **Identifier is `email-v1`** as this RFC wanted, implemented as LLP 0214
   §20.3's per-app activation mode rather than as this RFC's sketch DDL. LLP
   0214's kind-based credential shape won wholesale, as §20.1 ruled.
3. **Recovery codes are the primary self-serve recovery path**, not the
   "documented non-recoverable posture" in §Principal binding. The LLP 0214
   floor already shipped working recovery codes, so a password-only principal
   is *not* non-recoverable. `POST /auth/password/reset` exists but is
   non-production (local capture mailbox only), and mail-delivered reset
   remains an LLP 0045 prerequisite.
4. **Open question 1 (production signup enumeration) ruled:** local/dev/test
   return `SNAPBACK_AUTH_PASSWORD_EXISTS`, a deliberate documented oracle on
   the trusted local target. Production blind-accept is not implemented and
   `authProgramReadiness` reports it unready rather than pretending.
5. **Open question 2 (operator unlock) ruled: ship it.**
   `POST /_snapback/api/auth/password/unlock`, AdminWrite.
6. **Open question 3 (`SNAPBACK_PASSWORD`) ruled:** accepted under dev/test
   profiles only and refused elsewhere with a typed code; stdin is the sole
   carrier in any non-dev profile; never argv in any profile.

**One correction to §Migration and import.** This RFC bounds imported hash cost
parameters "before storage." That is necessary but not sufficient: PHC
verification re-derives from the parameters embedded in the stored hash, so a
policy-configured hasher does not bound verification cost. The implementation
therefore enforces ceilings at **verification** as well, for argon2, scrypt and
bcrypt alike, failing closed on unparseable parameters. The KDF concurrency cap
bounds how many verifications run concurrently; only the cost ceiling bounds how
expensive one is. See LLP 0214 §18's verification-cost caveat.

The `auth.importPasswordCredential` host operation itself (§Migration's
create/attach modes) is **not** implemented — no public path admits a foreign
hash today. The verification ceilings are in place ahead of it deliberately, so
that surface cannot land next to an unbounded verifier.

## Revision history

- **(a)** initial draft. **(b)** Draft → Review at loop start.
- **(i — 0214 reconciliation, author-commissioned)** The reconciliation
  this RFC's implementation gate demanded is ruled (LLP 0214 §20, v0.2):
  0214's kind-based credential shape supersedes this RFC's sketch DDL
  wholesale (the sketch remains as design rationale only); the composed v3
  descriptor gains `_auth_password_attempts` as lockout-only internal
  state; the per-app identifier mode is declared at activation
  (`email-v1` for this slice); displacement realizes as `revoked_at_ms`
  retirement + identity-link retirement + `durableDelete` session
  termination (not FK cascade); the public wire code family is 0214's
  uniform `SNAPBACK_AUTH_CREDENTIAL_INVALID`, with this RFC's
  `SNAPBACK_AUTH_PASSWORD_*` names internal/observability-only; the
  scrypt/bcrypt import allowlist widens 0214 §3.7's algorithm CHECK with
  this RFC's parameter caps. Implementation stays gated on 0214 §19's
  preconditions including the backup blocker. Reconciliation deliverables
  (v) and (vi) are discharged into 0214's descriptor-fixture obligation.
- **(h — closing revision, loop terminal)** round-5 convergent fixes from
  both families: the two surviving (f)-era budget-substrate sentences
  removed (LLP 0215 is the sole budget authority — the propagation gap both
  reviews caught); lock-window attempts spend uniform KDF (only budget
  refusals short-circuit — closing the timing oracle); the 10th-attempt
  wire answer corrected to uniform `PASSWORD_INVALID`; the lockout window
  declared (15 min v1, profile parameter) with sub-threshold decay; the set
  proof's end-to-end acquisition stated; the implementation gate widened
  with reconciliation deliverables (v) refusal-code family and (vi) LLP
  0031 tuples. The loop ends here for this document: its remaining
  round-5 MATERIALs are reconciliation-program work with LLP 0214/0215's
  owners, which further solo revision cannot converge — that program is
  the recommended next step, and this revision is final-unreviewed with
  respect to it.
- **(g)** round-4 revision: lock state made internal with a uniform public
  `PASSWORD_INVALID` (a visible lock is an oracle across
  owner-sign-in histories — LLP 0214's uniform-result contract; acceptance
  asserts via the admin projection); rate budgets rebound to LLP 0215's
  named effect budgets (no parallel counter — `admitted_count` removed;
  the ledger is lockout state only); implementation gated on the 0214
  reconciliation minting the one exact composed catalog descriptor and
  marker; the change route becomes a closed union carrying the set form's
  `stepUp` proof (client gains `authPasswordSet`); LLP 0031 route-registry
  policy tuples made an explicit obligation.
- **(f)** round-3 revision under the author's extended budget: the attempt
  ledger drops the source axis (LLP 0215 owns effective-source; the
  address-level lockout-DoS tradeoff stated honestly), stores the canonical
  address as a protected catalog relation under an explicit 0057 custody
  amendment, and gains the windowed `admitted_count` budget counter distinct
  from the lockout `failed_count`; the verification fence extends to the
  ledger predecessor; displacement becomes a first-class session-terminal
  operation with `durableDelete` settlement (LLP 0059); the step-up carrier
  binds the exact server-derived session identity; the
  10th-attempt boundary and the CLI bearer carrier are pinned.
- **(e — UNREVIEWED)** post-round-3 closing fixes applied after the review
  budget closed and not seen by any reviewer: acceptance criterion 7 made
  marker-neutral (the withdrawn catalog-v3 phrase removed); replication
  ciphertext re-cited to LLP 0188; the 0214 deference clause replaced with
  the pinned this-slice-implements-the-sketch formulation plus the four
  enumerated reconciliation items both round-3 reviews demanded. Remaining
  round-3 MATERIAL concerns are dispositioned in the loop's final report.
- **(d)** round-2 revision from dual-family review: catalog authority
  deferred to LLP 0214 (no competing v3; no-silent-migration adopted;
  automatic-upgrade language withdrawn); reset pinned same-principal-only
  with the four configurations enumerated and password-only accounts
  declared non-recoverable-self-serve in v1; displacement made realizable
  (identity retirement cascades its sessions — promise corrected);
  first-set step-up given its wire carrier (`stepUp` DTO member + closed
  step-up operation) and address rule (acting principal's own email-code
  identity); lockout ledger pinned (`_auth_password_attempts` DDL, hashed
  addresses, loopback/remote source classes, GC bounds) with credential-row
  counters removed — single accounting authority; one live password per
  principal enforced by index, attach refuses duplicates; reset applies
  identical screening; custody wording scoped to logical exports with LLP
  0192 physical custody carved out; fence disposition pinned to
  refuse-without-accounting; sender-constrained custody refuses password
  methods in v1.
- **(c)** round-1 revision from dual-family review: password login
  identifiers become their own `'password'` provider namespace (pre-hijack
  containment structural; email-code path unmodified; `session.provider`
  consistent at mint and refresh; no unverified-state column needed);
  set-displacement collision rule; step-up challenge required for first
  password set; two-phase exact-predecessor verification fence; address-keyed
  account-existence-blind attempt ledger with (address, source-class) lock
  scoping; new user-scoped revocation operation (0057's instance-wide helper
  explicitly not reused); client adoption split anonymous-issuance vs
  authenticated rotation + `authPasswordReset`; auth catalog v3 declared with
  activation/upgrade/refusal semantics; import split into create/attach
  modes with bounded PHC parameters; scope declared a local benchmark-closure
  slice of 0151 tier-1; acceptance criteria extended (containment,
  non-oracular lockout, fence race, step-up); capability-row and
  one-active-challenge wording fixed.
