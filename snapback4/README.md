# Snapback 4

One of two parallel candidates for the successor to Snapback 2, and the
sibling of Snapback 3, not its successor. It builds LLP 2000.000 as written:
the Snapback 2 core kept, two substrates flipped — resources metered at
runtime instead of priced statically; a client that replicates the viewer's
declared partition instead of caching receipted results — proved first on the
hub fixture, with a deterministic simulator as the primary harness.

Start at [`AGENTS.md`](./AGENTS.md). The root is
[LLP 3000](../llp/3000-snapback4.explainer.md); the design brief is
[LLP 2000.000](../llp/2000.000-keep-the-core-flip-two-substrates.rfc.md); the
scope is [`NOT-DOING.md`](./NOT-DOING.md); the chronology is
[`JOURNAL.md`](./JOURNAL.md).

Storage experiment: [Postgres evaluation prototype](./experiments/postgres/README.md)
runs real Quarry queries, mutations and sync against Postgres. It is opt-in,
not a CLI/deployment target; SQLite remains the shipped backend.

| | |
|---|---|
| `crates/snapback4-core` | the engine: value model, schema with `sync`, IR, one key encoding, the SQLite store, rules with hoisting, the runtime meter, the interpreter, the partition log, at-most-once writes, the day-two classifier |
| `crates/snapback4-lang` | Quarry in Rust: lexer, parser, binder, diagnostics with rewrites, the TypeScript emitter, the guide (the language card and the keyword cards, compiled by its tests) |
| `crates/snapback4` | the binary: `init`, `check`, `dev`, `deploy`, `rollback`, `serve`, `run`, `test`, `why`, `guide`, `data`, `doctor`, `device`, `types`; the HTTP wire |
| `crates/snapback4-device` | the device in Rust: the interpreter over its own SQLite behind one JSON call and a C ABI (the native module for Expo and Exact2 hosts); the same as wasm, for measurement |
| `crates/snapback4-sim` | the deterministic world: the engine and replica devices under faults, LLP 3000 §6's invariants |
| `crates/snapback4-native`, `native-fixtures/` | the guest SDK for native jobs — the app's Rust, hosted as wasm by the engine (LLP 3000.005) — and the fixture module the suite builds and runs |
| `packages/snapback4` | the client: the contract (the card), the online tier, the one local-first client over a device (`webDevice()` as wasm on the web, `snapback4-expo`'s module, `processDevice({ dir })` in Node), the React hooks, sign-in, a labelled mock; the CLI shim |
| `packages/snapback4-darwin-arm64`, `packages/snapback4-expo` | the binary as an optional dependency; the Expo module (Swift over the device's C ABI, the xcframework) |
| `apps/chat`, `apps/chat-expo` | the chat reference app on the web and on React Native; `snapback/schema.q` is the backend |
| `corpus/`, `fixtures/`, `floors/` | Snapback 2's conformance corpus; the Clique hub fixture wrapper; the five physical floors |
| `scripts/test.sh` | everything blocking, under 60 s |

`snapback4 dev` accepts browser requests only from `http(s)://localhost` or
literal loopback origins (any app port), with a loopback Host header. A
non-browser local tool may omit Origin. Personas and `/seed` are local
development capabilities; a DNS name that resolves to loopback is not one.

`snapback4 serve <dir>` defaults to HTTP on `127.0.0.1:4400`. Put a TLS
reverse proxy on the same host in front of it, and configure clients with
the public **https** URL. Preserve `Authorization` and `Origin`, strip
`x-snapback-persona`, and restrict direct access to the backend socket.
The backend always uses bearer tokens in `serve`; a proxy's loopback peer
address never grants developer identity. It does not trust forwarded IP or
scheme headers for identity or transport protection. A nonloopback literal
`--bind` needs `--i-understand-cleartext` and prints a warning; use it only
for a protected private hop to a TLS terminator.

The catalog (`/`, `/schema`, `/api.ts`) and `/changes` require a live bearer
session, or a local development persona. Public `GET /auth/config` returns
only the `guests` and `password` sign-in capabilities. The HTTP host caps
connections at 128, reserves 32 request workers and 32 separate long-wait
workers for change polls and effect claims, and closes excess requests. Headers have a 32 KiB / 5 second limit,
bodies a 30 second deadline, idle reads a 5 second limit, and responses a
5 second write deadline. These deadlines cover each complete phase, so
dribbling bytes does not extend them.

`POST /auth/refresh` rotates a live bearer session and returns the same
`{ session: { principal, kind, token, expiresAt } }` shape as sign-in; the
old token stops working in the same store transaction. `POST
/auth/logout-all` revokes every session for the current principal. Both take
the current bearer token. Viewer-authorized asset responses use
`Cache-Control: private, no-store`; a valid range beyond the file answers
416 with `Content-Range: bytes */N`, and view-once assets refuse every Range.

## Publishing

From `snapback4/`, `node scripts/publish.mjs` runs the blocking suite before
creating a stage, builds the production CLI and client, packs them, proves an
installed consumer and publishes both packages. `--dry-run` does the same work
through the consumer proof without publishing. A durable stage must be finished
with `--resume`; resume validates its original suite qualification and exact
tarball integrities, then repeats the installed-consumer proof without testing
unrelated current source. Use Node 24 on PATH.

The production darwin CLI in `snapback4-darwin-arm64` is signed with a
Developer ID Application identity, hardened runtime and a secure timestamp
in private publication staging before packing. The shared Cargo artifact is
copied there first; signing, verification, notarization and hashing use only
the staged copy. Signing and strict verification must succeed, including
in a dry run. `SNAPBACK4_SIGN_IDENTITY` chooses the identity; otherwise
exactly one Developer ID Application identity must be available in the
keychain. The installed binary's digest must match the staged signed artifact,
and its Developer ID signature must verify with the same authority and team.
The publish metrics record its signing authority and team id. Ordinary
developer builds, the JavaScript client and the Expo xcframework are not
signed by this publication step.

Set `SNAPBACK4_NOTARY_PROFILE` to a notarytool keychain profile to submit a
zip of the signed CLI to Apple and require `Accepted` before packing.
A bare binary cannot be stapled. Until a profile exists, publication
explicitly reports that the CLI is signed but **not notarized**, and records
`notarized: false`; accepted submissions record their id in the metrics.

`node scripts/measure-launch.mjs target/production/snapback4 --n 20 --load 2`
compares ad-hoc and Developer ID signing under two CPU load workers; omit
`--load` for an unloaded run. Each timed `--version` uses a fresh copy,
with copying and signing outside the timer. JSON reports all samples and
p50/p95/max milliseconds for each variant (nearest-rank percentiles).
`--timeout-ms 60000` bounds each launch; a timeout refuses partial results.
Fresh paths test fresh-file assessment, not a purge of every macOS cache.
Signing alone has not yet been shown to remove the `_dyld_start` stall.

For a public Following feed, declare `maintain feed: timeline`; run `snapback4 guide feeds`.
