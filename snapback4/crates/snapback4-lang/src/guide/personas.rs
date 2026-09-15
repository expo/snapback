//! Identity and developer inspection.
pub(super) const CARD: &str = r##"# Personas

For seeding or recorded-action replay, run
`snapback4 dev --hold-effects --hold-schedules` to hold effect claims and
scheduled jobs without an app replay flag.

`use personas alice, bob` declares a development cast. `snapback4 run send
'{..}' --as alice` (the default persona is alice) and the
`x-snapback-persona: alice` header in development act as `dev:alice`;
`persona: "alice"` on the client sends the header. Personas are a
development door: the socket peer, `Host`, and optional browser `Origin` must
all be literal loopback/local http(s) values. Foreign, opaque, malformed and
duplicate Origins are refused before routing, and CORS reflects only an
admitted local Origin. `snapback4 dev` is development only: it admits
loopback personas and an unauthenticated `POST /seed` as the system principal;
deploy with `snapback4 deploy` + `snapback4 serve`.
A deployed server (`snapback4 serve`) refuses personas
and seed, defaults to `127.0.0.1`, and requires
`--i-understand-cleartext` for a non-loopback HTTP bind. Put a TLS terminator
in front, preserve `Authorization` and `Origin`, strip persona headers, and
rate-limit there by the actual client address; the binary trusts only its
socket peer.

`GET /auth/config` is the small public advertisement for guest/password
support. Catalog, schema, generated API, native module and changes require a
live principal. Signup accepts 8–1,024 password bytes and login at most 1,024;
password hashing runs in bounded concurrent slots outside the engine mutex.
Under `serve`, guest, login and signup share 30 attempts per socket peer per
minute, while login and signup also share 10 per normalized email per minute
(E_RATE_LIMIT). Under `dev`, loopback peers have neither minute counter; their
Argon2 slots equal the host's available cores, capped at 16 and never below 2.
Startup prints the slot count and the lifted counters once. `serve` and
non-loopback peers keep two slots and the minute counters; full slots refuse
with retryable E_RATE_LIMIT. Connection/worker caps remain. Unknown emails
perform the same Argon2 verification work.

Ordinary guest and password sessions last seven days. `refreshSession`
atomically exchanges a live token; `logoutAll` revokes every session for the
principal. The client refreshes near expiry and uses an in-memory session
store by default. Both online and local clients expose `session()`,
`onSession`, `refreshSession()` and `logoutAll()`: rotation adopts the bearer
before notification, and sign-out or a current-session refusal clears it.
Personas have no session; a bare-token online client has none until refresh
returns one. Only the local client has `sync()`.
`localStorageSessionStore()` is an explicit compatibility
choice whose token can be read by same-origin script; native apps should pass
their secure store.

`snapback4 sql "SELECT * FROM messages" [--limit N] [--json]` inspects
the developer's own dev store; `--release dir` selects a deployment. It
opens read-only alongside the running server and is never rule-filtered.
Only application-table views are exposed; internal tables and raw r/i are
refused. Views and `data` include absent required literal defaults; optional
columns stay null. Device persistence exports retain raw storage images.
The default limit is 200, with a notice when more rows exist."##;
