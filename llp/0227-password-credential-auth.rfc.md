# LLP 0227: First-class email+password credential auth on the sessions surface

**Type:** RFC
**Status:** Review
**Systems:** Auth, Server, CLI, Client protocol, Guide
**Author:** Charlie Cheever / Claude
**Date:** 2026-08-10
**Revised:** 2026-08-10 (a — initial draft, commissioned by the author ruling
in `issues/20260809-password-credential-auth.md`)
**Revised:** 2026-08-10 (b — Draft → Review at llp-super-refine loop start,
the one authorized transition; independent-loop topology)
**Revised:** 2026-08-10 (c — round-1 revision; see Revision history)
**Related:** LLP 0057 (auth catalog and provider protocol — the substrate this
extends), LLP 0151 (first-party identity integrations — tier-1
username+password sketch and the identities-vs-credentials rule), LLP 0039
(auth vertical slice — server-derived principals), LLP 0011 (auth and
permissions — Argon2-outside-the-writer-lock rule, non-oracular failure
shapes), LLP 0058 (staged auth-mode protocol and the external-broker seam),
LLP 0059 (session projection), LLP 0024 (agent operating surface — one core,
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
relation**. The catalog (an LLP 0057 versioned migration) adds one table:

```sql
CREATE TABLE "_auth_password_credentials" (
  id TEXT NOT NULL PRIMARY KEY,
  user_id TEXT NOT NULL,
  identity_id TEXT NOT NULL,          -- the canonical-address identity row
  phc_string TEXT NOT NULL,           -- self-describing PHC format
  credential_generation INTEGER NOT NULL DEFAULT 1,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until_ms INTEGER,
  FOREIGN KEY(user_id) REFERENCES "_auth_users"(id) ON DELETE CASCADE,
  FOREIGN KEY(identity_id, user_id)
    REFERENCES "_auth_identities"(id, user_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX "_auth_password_credentials_identity_uq"
  ON "_auth_password_credentials"(identity_id);
```

At most one password credential per identity; the identity row (and therefore
the canonical address, canonicalized exactly per LLP 0057 §Canonical address)
is the join point back to the principal. Implementation adds the catalog's
usual CHECK discipline (positive JS-safe generation, nonnegative counters,
timestamp domains, PHC length bound) and the address-keyed attempt ledger
(§Lockout) as a second bounded relation.

**This is auth catalog v3.** The current implementation recognizes exactly
v1 and v2, and an extra protected `_auth_*` table under either marker is
catalog corruption — so this RFC is a catalog version, not a mechanical
number: fresh activation creates v3; v2→v3 upgrades **automatically at
activation** (additive `CREATE TABLE`s, no data rewrite, one transaction
under LLP 0057's catalog rules with its crash/rollback discipline); v1
behavior is unchanged from 0057 (v1→v2 remains deferred, and v1→v3 composes
that deferral); an older binary encountering v3 refuses per 0057's
recognition discipline rather than serving unknown tables; password routes on
a pre-v3 catalog refuse with a stable readiness code and
`authProgramReadiness` exposes the fact.

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
responses. Every route below is public-path (no bearer) except change, and all
are callable non-interactively — the benchmark's core demand.

| Route | Body | Success |
|---|---|---|
| `POST /auth/password/signup` | `{ email, password }` | 200, composed credential response |
| `POST /auth/password/signin` | `{ email, password }` | 200, composed credential response |
| `POST /auth/password/change` | `{ currentPassword, newPassword }` + bearer | 200, composed credential response (rotated bearer; see below) |
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
snapback auth password change --url … --password-stdin   # current\nnew\n
```

Passwords are accepted **only** via stdin (or `SNAPBACK_PASSWORD` for harness
ergonomics, documented as test-profile material) — never argv, so they never
enter process listings or shell history. Unlike `session mint`, these verbs
require **no admin token and no impersonation capability**: they are the
product front door, not an operator impersonation path.

Client methods: `client.authPasswordSignup({ email, password })`,
`client.authPasswordSignIn({ email, password })`,
`client.authPasswordChange({ currentPassword, newPassword })`,
`client.authPasswordReset({ challengeId, code, newPassword })`. Adoption
splits by predecessor state: signup/signin/reset adopt as **anonymous
issuance** (the `authExchange` path, which requires an anonymous
coordinator), while change is an **authenticated same-authority rotation**
(the `withCredentialRotation` path refresh already uses: verify same
authority descriptor, replace the credential within it, refuse on authority
mismatch or stale response). Custody, refresh, and the logout barrier are
untouched.

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
  credential) additionally requires a **fresh operation-bound email-code
  challenge** consumed in the same transaction (LLP 0151's step-up rule): a
  stolen bearer alone can neither rotate nor create the credential. Set on an
  address whose `'password'` identity belongs to a *different* principal
  **displaces** that identity and its credential when the acting principal
  holds the address's `'email-code'` identity — email proof outranks an
  unverified squat; the displaced principal keeps its sessions and data but
  loses password login. Both change forms write the hash, increment
  `credential_generation`, rotate the acting session's bearer, and revoke the
  user's other sessions (revocation operation below).
- **Reset** reuses LLP 0057's challenge machinery: request a code via the
  existing `POST /auth/request-code`, then `POST /auth/password/reset`
  consumes the challenge in one transaction that verifies the code for the
  credential's address, replaces the hash, revokes the user's other sessions,
  and mints a fresh session. Note 0057's one-active-challenge-per-address
  invariant applies: a reset code and a sign-in code are the same spendable
  proof (either is consumable at `/auth/exchange`), and a new request
  supersedes the outstanding challenge — security-equivalent, and stated so
  suites don't trip on it. Local target: capture mailbox (admin- and
  impersonation-gated, test material); production reset carries LLP 0045's
  mail adapter as its external prerequisite. Preissued recovery codes stay
  with the 0151 lifecycle spec.

**Two-phase verification fence.** Verification reads the exact predecessor —
`(credential id, credential_generation, phc_string, lock state)` — computes
the KDF outside the writer lock (LLP 0011), then the issuing/accounting
transaction **requires that exact `(id, generation)` predecessor** before any
failure accounting, upgrade-on-verify swap, or session mint; on mismatch (a
concurrent change/reset landed) it refuses or restarts — a stale proof never
authorizes, mirroring LLP 0059's exact-predecessor discipline.

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
| `SNAPBACK_AUTH_PASSWORD_LOCKED` | credential lockout | 10 consecutive failures → locked 15 minutes |
| `SNAPBACK_AUTH_PASSWORD_EXISTS` | signup on an address that already resolves to an account (local profiles; see §Threat notes) | — |
| `SNAPBACK_AUTH_PASSWORD_WEAK` | screening refusal at signup/change | length < 8, > 1024 bytes, or blocklist hit |
| `SNAPBACK_AUTH_THROTTLED` | windowed budget or KDF-concurrency cap | reuses LLP 0057's budget machinery |

**Failure accounting is address-keyed and account-existence-blind.** A
bounded attempt ledger keyed by canonical address (not by credential row)
records failed attempts whether or not an account exists; the lockout
threshold and `PASSWORD_LOCKED` fire identically for existing and missing
addresses, so the lockout state discloses nothing the uniform
`PASSWORD_INVALID` didn't (LLP 0151's non-oracular rule). Anti-lockout-DoS:
the lock is scoped to (address, source class) with a global budget backstop,
so a third party cannot cheaply deny a known address; ledger retention is
bounded and GC'd. Accounting is transactional; admission (budget + lock
check) happens **before** KDF work is spent; success resets the address's
counter; lock expiry reopens without operator action. Signup and signin also
count against per-address and global rolling windows via 0057's existing
budget transaction shape — but note 0057's current budget substrate counts
retained challenge rows, which password signin does not create, so the
attempt ledger above is the declared substrate for password-path budgets.

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
mismatch or identity collision). The pilot's data absorbs via **attach**: its
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
- **Custody.** No password or hash in argv, logs, receipts, snapshots, or
  inspect; credential responses `no-store`; body-capture logging disabled on
  these routes — all inherited LLP 0057 rules, restated here as in-scope.

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
   existing and a missing address in parallel — identical codes and
   thresholds through and past lockout (`PASSWORD_INVALID` ×9,
   `PASSWORD_LOCKED` on the 10th, reopening after the window, both
   addresses); assert `SNAPBACK_AUTH_THROTTLED` at a deliberately lowered
   test-profile budget — proving configurability.
4. **Change consequences and the fence:** other sessions of the user are
   revoked after change/reset (only that user's — a bystander session on the
   instance survives); the acting session's bearer is rotated; old bearer
   follows the 0057 credential-resolution matrix; a signin racing a
   change/reset (KDF completed against the predecessor hash) refuses rather
   than minting, and a bearer alone cannot set a first password (step-up
   challenge required).
5. **Import:** an imported scrypt PHC credential signs in successfully and is
   observed (admin projection: generation + algorithm class only) to have
   upgraded to argon2id.
6. **Uniformity smoke:** no-account vs wrong-password signin are
   code-identical and within a declared timing envelope.
7. **Guide + capability index:** a `guide/auth/passwords.md` page with
   CI-verified snippets; a **new** `auth.passwords` capability row is added
   with route witnesses (none exists today — the index gains the row rather
   than flipping one); `authProgramReadiness` gains a password-provider
   facet including catalog-v3 readiness.

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

Review (c). Commissioned 2026-08-10 from
`issues/20260809-password-credential-auth.md`. No implementation has begun.

## Revision history

- **(a)** initial draft. **(b)** Draft → Review at loop start.
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
