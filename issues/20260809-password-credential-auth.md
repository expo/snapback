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
