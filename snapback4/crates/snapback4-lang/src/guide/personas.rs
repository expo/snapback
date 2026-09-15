//! Identity and developer inspection.
pub(super) const CARD: &str = r##"# Personas

For a replay mode that must not emit notifications, run `snapback4 dev --replay`.
Startup prints `replay on — new effects suppressed; schedules held`.
`doctor` reports the persisted dev replay and schedule policy, even after the host stops.
New emits are counted as `suppressed` by `doctor`, with no queued payload:
they are never delivered, including after restarting with or without `--replay`.
Mutations and explicitly run jobs keep their writes, results and meters.
Replay holds schedule admission; restart without it resumes at the next
boundary, skipping held periods. Already queued jobs still run, with their
new emits suppressed. Effects queued before replay keep their ordinary lifecycle.

`--hold-effects` only pauses worker claims: effects stay durable and become
claimable after restarting without the flag. `--hold-schedules` only holds
schedule admission, skipping held periods on restart. Use `--replay` when
new effects must never be delivered; use the effect hold to keep them queued.
The suppression policy stays on the dev store for local `run` invocations
until the next host start; a restart without `--replay` restores normal
emission for new writes and keeps the count. `serve` and release commands
refuse `--replay` with E_REPLAY_DEV_ONLY; production always emits normally.
With `--fresh`, the count dies with the in-memory store; `doctor` and local
`run` inspect the separate on-disk store.

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
live principal. Signup requires at least 8 characters (Unicode scalar values)
and at most 1,024 UTF-8 bytes; login accepts at most 1,024 UTF-8 bytes.
Password hashing runs in bounded concurrent slots outside the engine mutex.
Under `serve`, guest, login and signup share 30 attempts per socket peer per
minute, while login and signup also share 10 per normalized email per minute
(E_RATE_LIMIT). Under `dev`, loopback peers have neither minute counter; their
Argon2 slots equal the host's available cores, capped at 16 and never below 2.
Startup prints the slot count and the lifted counters once. `serve` and
non-loopback peers keep two slots and the minute counters; full slots refuse
with retryable E_RATE_LIMIT. Connection/worker caps remain. Unknown emails
perform the same Argon2 verification work.

An email-and-password product declares `use identity password`; plain
`use identity` also mints guest sessions. `use identity guests` admits only
guests; without `use identity`, both methods are disabled.

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
