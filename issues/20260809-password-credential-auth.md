# Add first-class password credential auth (Clique pilot F5 #1)

The P2 pilot's Snapback lane (record 2026-08-09-social-messenger-p2-pilot.md)
scored B2 auth 48/100 — the pilot's floor: Snapback ships email-code
sessions (auth.sessions) but no password credential mode, so the lane
hand-rolled scrypt hashing in a gateway and shelled out to `snapback
session mint` per login (HTTP shape undocumented). Supabase's GoTrue
scored 82 on the same brief for comparison: email+password signup/signin
with server-side hashing, standard rate limiting, and token issuance,
callable non-interactively.

Ask: a built-in password provider on the sessions surface — server-side
KDF (argon2id/scrypt), signup + signin commands, standard lockout/rate
posture, composing with the existing server-derived principals and
external-identity-broker custody rules (LLP 0057/0151). The LLP
0066/0067 auth-mode matrix is the design home; this ticket is the
demand signal with benchmark evidence.

## Author ruling — 2026-08-10

Commissioned. Design an RFC for a first-class email+password provider on the
existing sessions surface: server-side argon2id KDF, signup + signin callable
non-interactively, a declared and testable lockout/rate posture, composing
with server-derived principals and the external-identity-broker custody
rules (LLP 0057/0151). Scope fence: exactly email+password on the sessions
surface — this commission is not a general OAuth/identity-provider program.

2026-08-10: RFC drafted as `llp/0227-password-credential-auth.rfc.md`
(Draft; open questions left for the author: production signup enumeration
posture, operator unlock verb, `SNAPBACK_PASSWORD` env carrier).

## Implementation update — 2026-08-11/12 (ticket stays OPEN)

**The premise above is now out of date and should not be read as current.** The
ticket says Snapback "ships email-code sessions but no password credential
mode." The internal core has existed since `961b8be8c` (LLP 0214 floor: catalog
v3, argon2id register/authenticate/set/change, recovery codes, assurances). What
was actually missing was that **none of it was reachable** — no HTTP routes, no
CLI verbs, no client methods — which is why the pilot lane still hand-rolled a
scrypt gateway and shelled out to `snapback session mint`.

Landed since:

| Commit | What |
|---|---|
| `b180492e9` | Catalog v4 — password attempt ledger, `email-v1` identifier mode, explicitly pinned Argon2id policy |
| `ef936353f` | Password/guest-claim/recovery minting rerouted through the real provider issuance path; user-scoped revocation; displacement; lockout + two-phase fence; bounded KDF concurrency; LLP 0215 budget bindings; upgrade-on-verify |
| `d6fc55d7f` | 7 public HTTP routes with complete LLP 0031 policy tuples |
| `534b58bdb` | `snapback auth password …` CLI verbs and `@expo/snapback-client` methods |

Against the four properties this ticket says GoTrue won on:

- **email+password signup/signin callable non-interactively** — `POST /auth/password/signup` and `/signin`, plus CLI verbs taking the password on stdin. No admin token, no impersonation capability, no `auth.mintSession`.
- **server-side hashing** — argon2id m=19456/t=2/p=1, pinned in code, computed outside the storage writer lock on a bounded pool.
- **standard rate limiting** — declared, testable lockout (10 failures → 15 min, every threshold a profile parameter, not a fixed constant — deliberately answering this ticket's own complaint that GoTrue's unconfigurable meter cost the pilot ~2.6h of an envelope run) plus LLP 0215 named budgets.
- **token issuance** — the ordinary LLP 0057 composed credential response; sessions land in normal `AuthCoordinator` custody.

**Why this stays open:** the commission's definition of done is a fresh app
using the **published** `@expo/snapback-*` packages. Repository-only tests are
explicitly insufficient. This closes when a clean install proves the
client-facing flow end to end. The `auth.passwords` capability row is `partial`
until then.

Honest boundaries at this point, none of them hidden in the capability row:
production signup blind-accept and mail-delivered password reset are **not**
implemented — both are annotated LLP 0045 delivery prerequisites and
`authProgramReadiness` reports them unready. Local reset works only against the
capture mailbox. `auth.importPasswordCredential` is not implemented.

## Publication blocker cleared — 2026-08-15

The "waits on the next qualified publication" condition is satisfied: 0.1.21
(2026-08-14, LLP 0041 §0.1.21) was the fourth completed qualified promotion,
cut from `c10b454162f6`, which carries the entire password surface listed
above (all four landings are 2026-08-11/12). The 0.1.22 fast-path publication
(2026-08-15, from `272bea745bb0`) carries the same closure; `newestQualified`
remains 0.1.21. The clean-install proof can now run against published
packages; it is in flight in this session and its outcome will be recorded
here.

## Author ruling — 2026-08-15: mail-reset and import stay deferred

Mail-delivered password reset and `auth.importPasswordCredential` are **not
commissioned now**. Mail reset stays behind its LLP 0045 delivery
prerequisite rather than stacking a second gated program on the outbox; note
that the same day's wave-4 identity ruling
(`issues/20260808-wave4-identity-program.md`) commits to operating an
Expo-hosted shared email/SMS delivery service, so the prerequisite has a
ruled path — revisit both features when that delivery path exists or a
benchmark/demand signal forces them. Until then the honest-boundaries
paragraph above remains the accurate capability statement.
