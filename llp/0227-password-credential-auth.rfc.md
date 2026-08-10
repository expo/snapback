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
A password is a second way to prove control of a canonical email address; a
successful signin runs the same session-creation core as an email-code
exchange and returns the identical LLP 0057 composed credential response. There
is **no parallel identity system, no parallel token, and no new session
shape** — one principal, multiple credentials. Storage is server-side argon2id
with upgrade-on-verify migration; the lockout/rate posture is a declared,
testable contract with stable refusal codes.

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
is the join point back to the principal.

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
`client.authPasswordChange({ currentPassword, newPassword })`. Each adopts the
credential into `AuthCoordinator` exactly as `authExchange` does; custody,
refresh, and the logout barrier are untouched.

## Principal binding: same sessions, no parallel identity

- **Signup** canonicalizes the address, then in one `IMMEDIATE` transaction
  (address-stripe-locked, same 256-stripe discipline as request-code):
  refuse if the canonical address **already resolves to any existing
  identity** — not merely an existing password credential (§Threat notes for
  the enumeration posture) — otherwise create the `_auth_users` row,
  canonical-address identity, and credential, enforce the session cap, and
  mint one session. The refusal is load-bearing: an unauthenticated signup
  that attached a credential to an existing email-code principal would hand
  out sessions on someone else's account without any proof of address
  control. Attaching a password to an existing account instead goes through
  the authenticated **set** form of change (below) or reset.
  `verified_at_ms` semantics: a password-signup-created identity records
  creation time but is **not** email-verified; verification happens only when
  an email-code exchange later succeeds for the same address. Verified status
  gates nothing in v1 except reset delivery in production profiles.
- **Signin** resolves the canonical address to the credential, verifies
  (KDF outside the lock), then runs the **same session-creation core** as a
  successful email-code exchange. `ctx.auth.userId` is the same principal the
  email-code path yields for that address.
- **Change** requires an authenticated session **and** the current password
  (a step-up-equivalent proof; a stolen bearer alone cannot rotate the
  credential). `currentPassword: null` is accepted **only** when the
  principal has no password credential yet — the authenticated **set** path
  by which an email-code account gains a password. Both forms write the hash,
  increment `credential_generation`, rotate the acting session's bearer, and
  **revoke the user's other sessions** via LLP 0057's bulk-revocation
  transaction scoped to the user — LLP 0151's sessions-consequences rule.
- **Reset** reuses LLP 0057's email-code challenge machinery unchanged:
  request a code via the existing `POST /auth/request-code`, then
  `POST /auth/password/reset` consumes the challenge in one transaction that
  verifies the code for the credential's address, replaces the hash, revokes
  the user's other sessions, and mints a fresh session. On the local target
  the code arrives through the capture mailbox (admin- and
  impersonation-gated, test material); production reset carries LLP 0045's
  mail adapter as its external prerequisite, exactly like email-code sign-in
  itself. Preissued recovery codes (LLP 0151) are deliberately **not** in
  scope; they belong to the commissioned lifecycle spec.

**Composition and precedence.** An address may simultaneously carry an
email-code sign-in path, a password credential, and broker-minted sessions
(LLP 0058 seam invoking `auth.mintSession`). All resolve to the **same
principal** through the canonical-address identity; there is no precedence to
arbitrate because no path shadows another — each independently proves control
and mints an ordinary session. Custody rules compose unchanged: the broker
seam remains a gated non-production host operation per LLP 0057/0058; the
password routes never accept a caller-asserted `userId` (LLP 0039); and
credential material never crosses the redaction boundary. Removing/unlinking a
password credential is **deferred** to the 0151 lifecycle spec, where the
last-authenticator rule is computed jointly across credential classes — v1
ships set and change only, so the rule cannot yet be violated.

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

Failure accounting is transactional exactly like 0057's challenge attempts:
each failed verify commits `failed_attempts + 1` under the address stripe; the
tenth sets `locked_until_ms`; success resets the counter; expiry of the lock
window reopens the credential without operator action. Signup and signin also
count against per-address and global rolling windows via 0057's existing
budget transaction shape.

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
class as `auth.mintSession`) accepts `{ email, phcString }` where the PHC
algorithm is one of `argon2id`, `scrypt`, or `bcrypt`. It provisions the
principal/identity as signup does and stores the foreign hash verbatim; the
first successful signin verifies under the stored algorithm and
**upgrades-on-verify to current argon2id policy**. This directly absorbs the
pilot's hand-rolled scrypt gateway data. Plaintext-password import does not
exist. Hosted-production import ceremony is out of scope until a hosted auth
target exists.

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
2. **Same-principal composition:** an acceptance witness mints a persona via
   email-code, asserts password signup on that address refuses with
   `PASSWORD_EXISTS`, attaches a password through the authenticated set path,
   signs in with it, and asserts one stable `userId` across both credential
   paths and that email-code exchange still works afterward.
3. **Declared lockout contract:** drive 9 failures (`PASSWORD_INVALID` each),
   assert `PASSWORD_LOCKED` on the 10th, assert reopening after the window,
   and assert `SNAPBACK_AUTH_THROTTLED` at the declared budget in a test
   profile with the budget deliberately lowered — proving configurability.
4. **Change consequences:** other sessions of the user are revoked after
   change/reset; the acting session's bearer is rotated; old bearer follows
   the 0057 credential-resolution matrix.
5. **Import:** an imported scrypt PHC credential signs in successfully and is
   observed (admin projection: generation + algorithm class only) to have
   upgraded to argon2id.
6. **Uniformity smoke:** no-account vs wrong-password signin are
   code-identical and within a declared timing envelope.
7. **Guide + capability index:** a `guide/auth/passwords.md` page with
   CI-verified snippets; the capability row flips from GAP with route
   witnesses; `authProgramReadiness` gains a password-provider facet.

## Open questions

1. **Production signup enumeration posture** — is blind-accept (uniform shape,
   no session, email notice) the ruled production default, or is a disclosed
   `PASSWORD_EXISTS` oracle acceptable there too? (Local-profile oracle is
   pinned above; only the production default needs a ruling.)
2. **Operator unlock** — should v1 ship an admin verb to clear a lockout
   before `locked_until_ms`, or is waiting out the window acceptable until
   the 0151 lifecycle spec lands?
3. **`SNAPBACK_PASSWORD` env carrier** — keep as test-profile ergonomics for
   harnesses, or require stdin-only everywhere?

## Status

Draft (a). Commissioned 2026-08-10 from
`issues/20260809-password-credential-auth.md`. No implementation has begun;
the catalog migration number and route registry rows bind at implementation
time under LLP 0057's catalog rules.
