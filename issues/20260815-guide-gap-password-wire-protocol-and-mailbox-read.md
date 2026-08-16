# guide-gap: password wire-protocol header and capture-mailbox read shape are undocumented

**Status:** Open
**Opened:** 2026-08-15 · **Severity:** P3 · **Area:** Guide / auth
**Found by:** the password clean-install proof
(`issues/closed/20260809-password-credential-auth.md`), against published
0.1.22 packages.

Two wire facts the proof had to learn from typed refusals instead of the
guide (the refusals were accurate and remediating — this gap costs a
round-trip each, not a dead end):

1. **`x-snapback-auth-client-protocol: 1` is required on the raw HTTP
   password routes** (`/auth/password/signup` etc. answer a typed 400
   `SNAPBACK_AUTH_PROFILE_CLIENT_UNSUPPORTED` without it), but
   `guide/auth/passwords.md`'s wire section never mentions the header. The
   published client sets it internally (`authClientProtocol: 1`).
2. **The capture-mailbox read shape is undocumented in practice**:
   `GET /_snapback/api/auth/mailbox?challengeId=…` needs
   `x-snapback-admin-token` (not `authorization: Bearer`) plus the
   impersonation-capability header from the `.snapback/dev.ready.json`
   sidecar — each element learned from a separate typed refusal.

## Desired resolution

Absorb both into `guide/auth/passwords.md` (wire section) and whichever page
owns the capture mailbox, per LLP 0061 §5.
