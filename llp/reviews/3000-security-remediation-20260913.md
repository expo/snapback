# Snapback 4 security remediation — 2026-09-13

**Record author:** Codex (implementation and review synthesis; not an independent reviewer).
**Scope:** S01–S12 from the [Grok security review](./3000-security-review-20260913.md), plus `engine-lock-held-across-slow-io`, `session-lifecycle-and-default-store`, and `asset-range-and-cache-headers`.
**Related:** [LLP 3000 §7](../3000-snapback4.explainer.md#7-decisions-during-execution), [implementation journal](../../snapback4/JOURNAL.md).

## Disposition

All fifteen findings are resolved in one integrated change:

| Finding | Resolution |
|---|---|
| S01 — development cross-origin doors | Development requests require a loopback peer, a literal loopback/localhost `Host`, and an absent or matching local HTTP(S) `Origin`. Allowed origins are reflected; foreign, `null`, duplicate, and malformed origin or credential headers are refused before routing. |
| S02 — cleartext all-interface serve | `serve` defaults to `127.0.0.1`. A literal non-loopback bind requires `--i-understand-cleartext`, prints a warning, and is documented as a deliberate proxy deployment seam. |
| S03 — unauthenticated catalog and changes | The schema, generated API, native module, and change feed require a live principal. Long polls authenticate before occupying a waiter and again after waking. `/auth/config` exposes only two booleans. |
| S04 — auth lock and rate limits | Argon2 runs outside the engine mutex with a credential-state recheck. The host bounds concurrent password work and rate-limits guest, signup, and login attempts by peer and normalized email without an unbounded key map. Password and auth-body sizes are bounded. |
| S05 — hidden uniqueness oracle | ID and unique-index collisions return generic `E_RULE` when the conflicting row is unreadable, including insert-if-absent and upsert paths. Readable conflicts retain the useful constraint refusal. |
| S06 — deleted partition images | Catch-up derives a current readable row image. Deleted, expired, replaced, and currently hidden rows produce a tombstone or no new disclosure; `delivered-history` still preserves a device copy that was already delivered. |
| S07 — private-store permissions | On Unix, store parents and asset directories are 0700 and databases, WAL/SHM sidecars, staged assets, and final assets are 0600, including pre-existing permissive paths. Unsupported platforms fail closed until an owner-only implementation exists. |
| S08 — upload lock | Upload bytes are admitted and written to a staged file outside the engine mutex under a two-upload semaphore. Commit reauthenticates the session and validates the upload generation before publishing the file and catalog entry. Asset sweeping also deletes files outside the lock. |
| S09 — predictable IDs | Every server and device minting path uses operating-system cryptographic randomness; the web build uses Web Crypto through `getrandom`. Entropy failure is returned instead of falling back to xorshift. |
| S10 — audience self-grant | `check` requires each audience insert branch to prove an existing same-table grant or creation of the referenced group. It verifies the real recipient slot and a plain matching index, and requires audience columns to be immutable or guarded. The rule covers ordinary insert, insert-if-absent, and upsert. |
| S11 — unbounded HTTP work | The vendored host caps accepted connections, short workers, long-poll waiters, request headers, and one request per connection. Header, body, response, and idle deadlines bound slow clients; excess connections close. |
| S12 — once and media bounds | Images have positive dimensions capped at 16,384 per side and 40 million pixels; video duration is positive and at most one hour. A placed view-once asset counts its uploader, while an unplaced owner preview does not. Range is refused before consuming a once view. |
| Slow I/O before identity | Protected POST routes authenticate before buffering their bodies and reauthenticate after slow work. Upload and password work no longer hold the engine mutex. Logout is also authenticated before body handling. |
| Session lifecycle and default store | Ordinary sessions expire after seven days, refresh rotates the token atomically, logout-all revokes every account session, and expired rows are indexed and pruned opportunistically. The browser default is memory-only; readable `localStorage` persistence is an explicit opt-in. The client refreshes sessions before the final 24 hours and guards against stale-token races. |
| Asset range and cache headers | Unsatisfiable valid ranges return 416 with `Content-Range: bytes */size`; malformed ranges are ignored as ordinary HTTP requests. Every asset response uses `Cache-Control: private, no-store`, and view-once ranges are refused before view accounting. |

The security contract is recorded in LLP 3000 and in the Snapback 4 compiled
guide and package reference. Each closed filesystem ticket records its focused
acceptance evidence.

## Preserved limits

TLS still terminates at a same-host proxy. The backend does not trust forwarded
address or scheme headers, so the proxy must keep the loopback listener private,
strip development persona headers, preserve `Authorization` and `Origin`, and
apply any real-client rate limit itself. Generic hidden-conflict refusal reduces
the existence oracle but is not a claim of formal noninterference. Private files
are not securely erased, and media validation bounds trusted header facts rather
than fully decoding every frame or pixel.

## Executed validation

The initial integrated candidate passed `snapback4/scripts/test.sh` with zero
failures in 52 seconds, including all Rust workspaces, the WebAssembly build,
package type/build checks, fixtures, the host boundary suite, the simulation
security suite, both device stores, and 66 client tests. After self-review added
the strict credential parsing, pre-wait authentication, logout admission, and
native-sidecar regression, these focused checks also passed:

- `cargo test -p snapback4 --bin snapback4` — 23 passed.
- `cargo test -p snapback4-device --test native` — 4 passed.
- `cargo test -p snapback4-lang --test guide` — 8 passed.

The final exact-commit suite and independent remediation verdict are appended
after the candidate is frozen. No live DNS-rebinding browser, production TLS
terminator, Windows ACL, or production deployment qualification is claimed.
