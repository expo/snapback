# Clique build diary — glm-snapback-explicit (snapback explicit profile, 0.1.29)

## M1 — Accounts and profiles (green)

**What I built.** In-system email+password identity on Snapback's sessions
auth (built-in provider, argon2id server-side, recovery codes, expiring
revocable sessions), a `profiles` table with server-enforced handle
uniqueness (unique index), profile CRUD via an upsert mutation with typed
refusals (`HANDLE_TAKEN`, `HANDLE_INVALID`, `NAME_INVALID`, `LINK_INVALID`),
avatar upload through a declared asset intent (public-immutable delivery,
`avatar` rendition), and an Expo Router app (auth screen, profile
edit/view, settings/logout, tab shell) wired to the frozen UI kit's
AuthForm and ProfileForm.

**What felt easy.** The auth itself was almost zero code — declaring the
auth program in `schema.mjs` gave me signup/signin/sessions/logout/recovery
with server-side hashing and revocation, and the [grader] password-storage
requirement is satisfied by the platform's documented provider path. The
asset pipeline was one intent declaration plus one `attach` line, and the
public rendition URL Just Worked. Live queries meant "profile edit appears
on the other client" was free once the read was live.

**What fought me.** (1) The auth catalog froze `minimumLength` at the first
activation — my dev store started before I declared 8, and the change
silently refused to apply through the normal successor flow; I needed a
recorded pre-M1 fresh reset. (2) Headless client ergonomics: the first
authenticated mutation after a signup/sign-in can race the custody
adoption barrier (`SNAPBACK_AUTH_STALE_RESULT`, `SNAPBACK_OUTBOX_NOT_WRITER`
with multiple in-process clients); my seed/suite needed a retry-with-new-
mutation-id wrapper. (3) `ctx.db.patch` is table-first — I hit
`SNAPBACK_UNKNOWN_TABLE` from the row-id-only spelling. (4) Environment
friction: chromium shared libs missing on the host (solved with a
prebuilt browser-libs dir), and the frozen choreography harness needs the
instrument's sibling directories mirrored into a writable location.

**What the explicit profile saved or cost.** Saved: refusals are declared
and typed (`ctx.refuse` with a `refusals:` list), so the suite can assert
exact application codes; the codegen emits exact function references so the
suite's `client.mutate(api.setProfile, ...)` is compile-checked against the
args contract; the supervisor lifecycle (application-ready receipt, binding,
successor activations) is fully machine-readable. Cost: the define/plan DSL
has opinions (table-first patch, null-vs-absent in result contracts,
opaque structured fields) that cost a few correction loops, and the
explicit `visibility`/`index`/`refusals` declarations are more ceremony
than a schemaless backend would demand — but they are exactly what the
[grader] trust probes will later check.

**Docs/diagnostics that were missing or wanted.** The wire-route shapes
(`/auth/password/signup` needing the auth-client-protocol header; the
positioned `baseUrl` constructor arg) were only fully visible in package
type sources; a "drive the generated API from Node" page in the Guide would
have saved an hour. The command-client input shape (flat args + asset
source) is documented only via tests. Everything else was discoverable via
`snapback guide` and the served capability index.

**Green evidence.** Suite 7/7 (`.acceptance/suite-m1.json`), starter-m1
seed idempotent ×3, choreography m1 segment green
(`choreo-receipts/m1-receipts.jsonl`).
