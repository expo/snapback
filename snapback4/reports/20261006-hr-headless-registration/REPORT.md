# Lane HR — headless password registration

Date: 2026-10-06. Base: `547c6113bdab6a68c3b8628d79fa6c0b6eb0ce53` (0.4.13).
Branch: `sb4-intent/hr-headless-registration`. All commands ran in the supplied
eb1000 workspace; its runtime hostname reports `expose-builder-pixel`. No SSH,
other fleet host, publication or push was used.

The existing public SDK already supports password signup and login in Node.
The repair makes that path visible and executable in the auth guide, starter
and adapter documentation. It adds no auth endpoint, CLI verb, client contract
or privileged seed mechanism.

## Existing surfaces, traced to code

| Surface | Existing behavior and source |
| --- | --- |
| HTTP password signup/login | `POST /auth/signup` and `/auth/login` take `{email, password}` and return `{session}` or `{denied}`. Signup creates both credentials and a live session. [HTTP routing](../../crates/snapback4/src/serve.rs), [admission and dispatch](../../crates/snapback4/src/auth.rs), [prepare/finish signup and login](../../crates/snapback4-core/src/identity.rs). |
| HTTP identity configuration and lifecycle | Public `GET /auth/config` advertises enabled methods. `/auth/guest`, `/auth/refresh`, `/auth/logout` and `/auth/logout-all` handle guest creation and session lifecycle. Schema `use identity password` enables passwords only; `use identity` also enables guests. [Routing/config](../../crates/snapback4/src/serve.rs), [enabled check and handlers](../../crates/snapback4/src/auth.rs). |
| Node SDK | The names are lowercase `signup(url, email, password)` and `login(...)` from `snapback4/auth`, returning `{ok: true, session}` or `{ok: false, why}`. Pass the session to `createClient({url, session})` from `snapback4/client`, then use generated queries/mutations. No DOM, browser storage or browser signup is required. [Auth exports](../../packages/snapback4/src/auth.ts), [client options/session](../../packages/snapback4/src/client.ts), [package exports and Node fetch selection](../../packages/snapback4/package.json). |
| App lifecycle API | `createApp(...).auth.signup(...)` and `.auth.login(...)` call the same helpers while owning app session persistence and transitions. There is no `auth.signUp` spelling. [App auth implementation](../../packages/snapback4/src/app.ts). The raw auth helpers and online client are sufficient for a short seed script. |
| CLI | There is no `snapback4 auth …` or password-account creation command. `run <op> --as <persona/principal>` acts against the developer's local store. `token --service <name>` creates a service seat, not password credentials. [CLI dispatch/help](../../crates/snapback4/src/main.rs), [run and token](../../crates/snapback4/src/verbs.rs). |
| Development shortcuts | `use personas alice, bob`, `persona: "alice"` / `x-snapback-persona: alice`, and local `run --as` exercise the development cast. Unauthenticated loopback `POST /seed` accepts application `{table,row}` entries as the system principal. These neither create password credentials nor test password sign-in. HTTP personas and `/seed` are refused under `serve`; dev doors check peer/Host/Origin. [principal_of, dev_request and seed routing](../../crates/snapback4/src/serve.rs). `dev --fresh`/`--memory` selects a temporary store; `dev --replay` suppresses new effects and holds schedules. [CLI dev mode](../../crates/snapback4/src/main.rs). |
| External identity/service minting | Service-authenticated `POST /auth/session` and `mintSession` can mint sessions for accounts authenticated by the application. They do not register passwords and are unnecessary for password seeds. [Service mint route](../../crates/snapback4/src/serve.rs), [worker helper](../../packages/snapback4/src/worker.ts). |

Passwords retain randomly salted Argon2id hashes; signup commits the uniqueness
check, account and initial session atomically. The minimum is eight Unicode
scalars and the maximum is 1,024 UTF-8 bytes. Unknown-account login pays the
same verification work. See `hash_password`, `prepare_signup`, `finish_signup`
and `verify_password` in [identity.rs](../../crates/snapback4-core/src/identity.rs).

Admission stays unchanged: `serve` and non-loopback peers share 30 identity
attempts per socket peer per minute, plus 10 login/signup attempts per normalized
email per minute, and two concurrent KDF slots. Dev loopback lifts the minute
counters and uses 2–16 host-sized KDF slots. Saturation returns retryable
`E_RATE_LIMIT`; hashing stays outside the engine mutex. See
[Admission and handle](../../crates/snapback4/src/auth.rs). The recipe runs
sequentially and stops on refusals; it adds no automatic retries or bypass.

The new script reads its password from the environment, logs only email and
principal, reports refusal codes, and clears each client in `finally`.
It never logs sessions, bearer tokens or passwords. Auth handling is unchanged;
the server's optional [qualification trace](../../crates/snapback4/src/serve_trace.rs)
records timing/count metadata rather than request bodies. HTTPS remains required
off loopback; proxy rate limiting by actual client address remains the operator's
responsibility because the binary charges its socket peer.

## Paved path

- `snapback4 guide auth` (also `seed`, `replay`, `session`, `personas`) now begins
  with password schema opt-in and a **Seed accounts headlessly** recipe. It
  imports the actual package exports and generated API, runs on Node 24 and
  makes signup's already-live session explicit. The card remains 118 lines,
  equal to its prior line count, with its existing lifecycle, deployment,
  admission, replay and SQL inspection facts retained.
- `snapback4 new <dir> --template social` now emits
  [scripts/seed.mjs](../../crates/snapback4/src/verbs/init/social/seed.mjs).
  With `SEED_PASSWORD` set privately, `node scripts/seed.mjs` creates two users;
  `SEED_USERS=N` selects 1–1000. Each separate client writes its own profile.
  `SEED_AUTH=login` explicitly reuses the existing accounts. Duplicate or failed
  signup is never guessed to mean successful registration. Partial completion
  and production rate limits are explained in the starter README.
- Online, web and Expo starter READMEs point directly at this auth recipe.
  The online starter explicitly requires adding `use identity password` because
  its original schema is persona-only; web/Expo/social already enable passwords.
- [Client and operations](../../packages/snapback4/CLIENT-AND-OPERATIONS.md)
  gives Node instructions at sign-in and links them from replay/adapter guidance.
  Browser token borrowing is unnecessary. Replay suppression remains a separate
  development choice.

## Tests and verification

Environment: Node 24.13.1, Bun 1.3.14, Rust 1.97.0 and locked Binaryen
132.0.0, after `bun install --frozen-lockfile` in `snapback4/`. Cargo and the
full suite use `LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT`.
Full invocation from the worktree root:
`LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT bash snapback4/scripts/test.sh`.

- [Headless client test](../../packages/snapback4/test/headless-registration.test.mjs)
  compiles the literal CLI guide JS against the generated API, then executes it
  as a Node subprocess for signup and login. Two accounts sign in, write their
  own rows, and are refused forged ownership (`E_RULE`) and hidden-row edits
  (`NOT_FOUND`, preserving non-disclosure). It verifies unchanged rows, duplicate
  signup refusal, wrong-password refusal, independent Argon2id salts and no
  password/session output.
- [Social starter test](../../packages/snapback4/test/social-starter.test.mjs)
  executes the exact installed script for two accounts, then its explicit login
  mode. Both profile writes are read back. Each account can send in its own
  conversation and is refused (`NOT_MEMBER`) in the other's. The installed
  `.mjs` also participates in the starter's TypeScript check.
- Guide Quarry compiles with no diagnostics/notes. The guide test checks the
  auth/seed/replay aliases and unchanged line budget. The existing published
  path check now recognizes precisely the two application script paths.
- Affected client/starter/session run: **40 passed**, no skips or failures.
- `cargo test -p snapback4 --test init`: **22 passed**.
- `cargo test -p snapback4-lang --test guide`: **113 passed**.
- Full-suite Rust auth coverage passed: the CLI unit target ran **318 tests**
  (4 existing ignores), including admission/rate limits, KDF concurrency,
  loopback dev behavior and release refusal of development doors. The core
  identity integration target ran **2 tests**; the core unit target ran **242**
  (1 existing ignore), including hashing, verification and credential rechecks.
- Existing `client-seams` auth tests passed through HTTP and the public SDK,
  including password Unicode/byte bounds, 200 guest and 200 same-email dev
  attempts, and production refusals at peer attempt 31 / email attempt 11.
- `./ref-check --verbose`: **528 LLP documents, 10,421 references, zero errors**
  ([final audit](ref-check.log.gz)); `git diff --check` also passed.
- Full suite parallel client phase: **323/323 files passed**, 6,442 tests
  passed and 47 existing skips; zero failures or cancellations. Rust, fixture
  wrappers, package/app typechecks, docs budget and release guard also passed.
- The final guide wording was rebuilt and rechecked: **113 guide tests plus
  the headless Node test passed**.
- Full suite final outcome: **zero failures in 1,601 seconds** (26m 41s).
  Both default-count serial model files passed: **79 tests**, no skips or
  cancellations. This includes 5,000 session sequences per tier and 3,000
  online-client interleavings; counts and watchdogs were unchanged.
  [Complete suite log](full-suite.log.gz).

Retained focused evidence: [client/starter/session tests](affected-client.log.gz),
[final guide tests](guide.log.gz), [headless guide execution](headless-guide.log.gz),
[starter generation](starter-init.log.gz), and [wasm build](wasm.log.gz).

The first focused JS attempt ran the previous binary while Cargo still held
its build lock; it failed on missing new guide/script output. After rebuilding,
the guide test's expected hidden-row refusal was corrected to `NOT_FOUND`.
Guide verification also caught a compile-helper type mismatch, a wrapped
literal phrase and the new application paths. Those test/doc corrections are
included; no auth behavior was changed to make the tests pass.

The initial locked wasm build measured **2,117,335 bytes raw / 639,888 bytes
gzip**, below `metrics/wasm-budget.json`'s **639,941** cap. SHA-256:
`2491ab0c3abf50554cc6e48de96a2f63e7bc30f78ab61638b1e5b40c85f18944`.
No device source or dependency changes are present. The full-suite rebuild is byte-for-byte identical (SHA-256 checked), so the
change adds **zero wasm bytes** and the cap is unchanged.

## Scoped LLP orientation and audit

Scope: password auth discovery, starter packaging, executable guide examples.
[LLP 3000 §1/§4/§7](../../../llp/3000-snapback4.explainer.md) supplies the
Snapback 4 fence, one-owner client contract and tested-guide policy;
[LLP 2000.000 §5.1/§12](../../../llp/2000.000-keep-the-core-flip-two-substrates.rfc.md)
preserves authentication and existing ceilings.
[LLP 3000.007 §7/§8/§20.2](../../../llp/3000.007-relaxed-quarry-and-explicit-residency.rfc.md)
(in `llp/current`) governs the online client, dev auth admission and starter
packaging. Its §8.5 now records the existing API as the seed/adapter path.
Referenced decisions remain applicable; no contract/schema/admission redesign,
new LLP or open design ruling is required. Hand-off: none.

Limits: ordinary signup is not idempotent, and this script is not an atomic
multi-account transaction. It stops on refusal and documents partial-run
recovery. Passwords are supplied by the caller. The script does not implement
production bulk provisioning or a browser/native UI proof. No new runtime or
security qualification is claimed beyond the affected and full-suite evidence.

## Round 1 — review fixes (2026-10-06)

Base: `a7e08ed9b1`. Addressed the Astra P2 and Grok Medium/Low findings in
`~/sb4-intent/reviews/hr-r0.{astra,grok}.md` on the same eb1000 worktree.

- Added `headless`, `signup`, `sign-up`, `register` and `replay adapter` aliases
  to the auth card. Guide tests check every mapping and its listing; the Node
  test invokes each through the CLI, including `replay adapter` as one quoted
  argument, and requires successful output identical to `guide auth`.
- Both scripts now surface the supplied refusal message. Duplicate signup
  explains "that email already has an account; sign in instead". The first
  focused run caught a repeated `E_AUTH` prefix: the server message already
  contains it, so the final scripts use the message directly.
- The guide now rejects unknown `SEED_AUTH` values just like the starter.
  Both executable tests try `singup` before creating accounts and require a
  clear refusal, no stdout and no password in stderr. Duplicate-account
  failures also check the message and absence of password output.
- The replay sample now uses environment-supplied password login, a session
  client, checked write outcomes and `signOut()` in `finally`. Its comment
  makes the existing conversation membership prerequisite explicit.

After rebuilding the CLI, `cargo test -p snapback4-lang --test guide` passed
**113 tests**, including the unchanged **118-line** auth-card budget. Running
`node --test packages/snapback4/test/headless-registration.test.mjs packages/snapback4/test/social-starter.test.mjs`
from `snapback4/` passed **15 tests** (1 headless, 14 social), with no failures
or skips. The literal guide script and generated seed script typecheck and run.
`./ref-check --verbose` passed with 528 documents, 10,421 references and zero
errors; `git diff --check` passed. Retained evidence:
[guide](round1-guide.log.gz), [client/starter](round1-client.log.gz),
[reference audit](round1-ref-check.log.gz).

No auth implementation, device source or wasm build input changed; the wasm
cap is unchanged. The full suite and wasm rebuild were not repeated for this
scoped review follow-up. Nothing was pushed or published.
