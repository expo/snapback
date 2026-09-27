# Lane TK, round 1 — mutual proof for live token minting

Branch: `sb4-intent/tk-token-live`; host: expo-build-1000, Linux x86_64.
Read the round-0 prompt, report, journal entry and complete Grok review
`~/sb4-intent/reviews/tk-r0.grok.md` (READY WITH CHANGES). The other reviewer
family did not supply a security review; this report makes no second-review claim.

Fetched origin and merged `origin/main` at `880788cc5` first. Merge commit
`143d4804f` keeps both append-only JOURNAL sides. Implementation `2316fe561`;
wire tests and canonical-path portability `1e28f5e63`. Each commit carries
`Co-Authored-By: GPT-6 Astra <noreply@openai.com>`. No push or publication.

## Result

The CLI never sends the per-run store secret. Its first message contains a
fresh 32-byte random nonce and the intended service, days and store identity.
The owner returns a fresh nonce and the requested server-domain HMAC-SHA256;
the CLI verifies that MAC before sending the client-domain HMAC-SHA256.
The binding is an unambiguous versioned tuple. Store identity includes the
canonical path's raw bytes and the store's device/inode, so aliases resolve
consistently, including `/var` versus `/private/var` on Darwin. Both sides
use RustCrypto `verify_slice` for fixed-size tags. The nonce table is capped
at 128 entries with a 10-second monotonic TTL; completion atomically removes
its entry before proof verification and minting. Expired entries are reclaimed
on challenge admission. At most 128 bounded request bindings remain in memory.

Both rounds retain actual loopback peer admission, exactly one literal
loopback Host, no Origin, single protocol headers, bounded HTTP bodies/replies,
no CORS, no-store replies and uniform 403 authentication refusals. The old
secret header is rejected. Mapped IPv4 peers on an IPv6 listener fail closed,
including mapped loopback; native `::1` works. Minting still uses the one
owner's bounded writer admission and unchanged identity routine. No retries,
redirects, proxy/DNS resolution or offline fallback after live failure.
The offline path, CLI flags, token-only stdout, validation and expiry are unchanged.

A further necessary protection: mutual proofs alone let an active listener
relay the handshake and read the final bearer. The final response is therefore
authenticated and encrypted with ChaCha20-Poly1305, using a separately
HMAC-derived per-transcript key. A transparent relay can forward the one intended
mint or deny delivery, but cannot read the bearer or replay another mint.
The same envelope authenticates validation errors. LLP 3000.019 §3.4 records
the full byte-level transcript, domains, expiry, bounds and reply construction.

## File map

Paths are relative to `snapback4/` unless marked otherwise.

| File | Round-1 change |
| --- | --- |
| `crates/snapback4/src/serve_token.rs` | Replaces the bearer-secret request with two verified rounds and encrypted final replies; retains file hardening, writer use, offline-compatible identity behavior and uniform refusal. |
| `crates/snapback4/src/serve_token_protocol.rs` | Nonces, canonical store identity, tuple binding, RustCrypto MAC verification, bounded monotonic challenge state and authenticated reply encryption. |
| `crates/snapback4/src/serve_token_protocol_tests.rs` | Five deterministic unit tests for independent MAC vectors, request/direction binding, one-use and concurrent consumption, capacity/expiry, and ciphertext integrity. |
| `crates/snapback4/src/store_owner.rs` | The owner retains an Authority (private key, store identity and nonce state), initialized before announcing readiness. |
| `crates/snapback4/Cargo.toml`, `Cargo.lock` | Add server/CLI-only HMAC 0.12.1 and ChaCha20-Poly1305 0.10.1 and their locked dependencies. No device dependency or version change. |
| `crates/snapback4/tests/token_live.rs` | Adapt round-0 cases to mutual proofs; add impostor capture, transparent relay, binding/replay, literal-Host/no-CORS and `[::]` mapped-peer tests; canonicalize temporary roots. |
| `crates/snapback4/tests/token_live/protocol.rs` | Independent wire fixture constructs transcripts, captures actual HTTP and forwards adversarial traffic without invoking production protocol helpers. |
| `crates/snapback4/tests/run_admission.rs` | Canonicalize temporary roots before path assertions, for Darwin's temporary-directory aliases. |
| `crates/snapback4-lang/src/guide/services.rs` | Describe mutual proofs, a secret that never crosses the wire and encrypted token replies. |
| `packages/snapback4/SERVER.md` | Same operational facts beside existing token provisioning commands. |
| Repository `llp/3000.019-what-the-builder-still-wrote.rfc.md` | Preserve the reviewed ownership design; add the live-mint protocol and active-relay rationale to §3.4. |
| `JOURNAL.md` | Preserve both merge sides; append one round-1 evidence entry. |
| `reports/20260927-tk-token-live-r1.md` | This round's report; round 0 remains historical evidence. |

## Working forms

No Quarry syntax or SDK API was added. All existing token forms still run:

- Persistent dev: `TOKEN=$(snapback4 token --service ranker)`.
- Explicit lifetime and JSON flag: `TOKEN=$(snapback4 token --service ranker --days 30 --json)`.
- Live release: `TOKEN=$(snapback4 token --service ranker --release ./release)`.
- Stopped owner: `TOKEN=$(snapback4 token --service ranker --days 30)` (add `--release ./release` for a release).

Every successful command prints exactly the 43-character token and newline;
prose and the selected store remain on stderr. Temporary dev has no persistent
mintable store. Literal loopback and wildcard advertisements retain their paths;
a specific public-only bind still refuses local mint discovery.

## Tests and what they prove

Affected Rust: **5 protocol tests + 13 process tests + 27 ownership tests pass**.
The 13 process tests retain all eight round-0 cases: dev/serve live and offline
validation, clamping, wall-clock expiry, durable sessions, secret rotation,
remote/browser/wrong-secret/duplicate refusal, stale/other-store owners,
unsafe private files, IPv6 discovery, temporary/missing stores and unsafe startup.
Round-1 additions:

| Test | Claim |
| --- | --- |
| `impostor_captures_only_a_nonce_and_cannot_mint_or_elicit_a_client_proof` | Real impostor listener captures the real CLI's first message. Forged/stale/wrong-service/wrong-days/wrong-store server MACs elicit no second request or retry. Captured bytes contain no secret or client proof; forwarding/reflection mints no sessions. |
| `a_forwarding_impostor_cannot_read_the_minted_token_or_replay_completion` | A real TCP relay forwards both rounds and records all bytes. The CLI obtains one usable token; the relay sees neither secret nor token, and replaying completion returns 403 with session count still one. |
| `proofs_bind_every_request_field_and_only_one_completion_can_mint` | Both dev and serve reject changed service, days, store, either nonce and reflected server proofs; a correct completion mints once and replay fails. |
| `ipv6_wildcard_refuses_ipv4_mapped_loopback_and_remote_peers` | Actual dev and serve bound to `[::]` reject IPv4 connections from loopback and the non-loopback interface even with valid proof; native `::1` CLI discovery succeeds. |
| `literal_host_no_origin_and_no_cors_apply_to_both_rounds` | Both phases refuse localhost/DNS Host, browser Origin and OPTIONS, never grant CORS, and carry no-store. |
| `known_hmac_vectors_and_direction_separation` | MACs match independent Python stdlib vectors; directions differ and changing each server tag byte fails. This is functional evidence, not a timing measurement. |
| `nonce_is_single_use_even_after_invalid_proof_or_transcript` | Consumption cannot be reused after success, wrong MAC, wrong transcript or reflection. |
| `expiry_and_pending_capacity_use_monotonic_time_without_sleep` | Exact TTL and capacity boundaries, reclamation and fresh admission are deterministic; no real-time sleeps. |
| `concurrent_completion_has_exactly_one_winner` | Eight simultaneous completions admit exactly one caller. |
| `replies_require_the_secret_and_exact_transcript_and_authenticate_all_bytes` | Wrong key, either nonce, binding, and every changed ciphertext/tag byte fail decryption. |

Whole guide: **86/86** (all cards, README/manual Quarry, lead paragraphs and
registry/refusal facts). Consumer periphery: **19/19**, including redeeming
live/offline tokens in every existing flag/mode combination. Frozen Bun install
and package build pass. Reference audit: **517 LLP docs, 9,622 refs in 27,245
files, zero errors or unchecked**. Diff whitespace passes; largest changed
source is 414 lines, below the unchanged 1,500-line ceiling.

Timing was **not measured**. The implementation uses RustCrypto's
constant-time verification rather than a hand-written comparison; no noisy
timing assertion was added. Library API reference:
[RustCrypto HMAC](https://docs.rs/hmac/0.12.1/hmac/),
[ChaCha20-Poly1305](https://docs.rs/chacha20poly1305/0.10.1/chacha20poly1305/).

## Final qualification

Ran `scripts/test.sh` **exactly once**, exit **0**. Exact summary:

```text
== 0 failure(s) in 1400 s
```

**Every full-suite failure: none.** No lane-owned, baseline or environmental
failure. Rust: **3,883 passed, 24 existing ignored**; 244 test binaries /
957 executions, 913 seconds. Ordinary clients: **2,633 passed, 10 existing
skipped**; seven extra shards: **56/56**, client phase 194 seconds. Client
models: **78/78**, 263 seconds. Fixture wrappers: **9/9**. Native and wasm
builds, docs budget, release guard, package typecheck/build, chat generation
and both app typechecks all pass. All new protocol/wire tests and existing
token consumers passed inside this full run. No product/test source changed after it
started; only this report and the final journal entry were written afterward.
The inherited 60-second suite budget is still exceeded; it was not raised.

Evidence is in ignored
`target/lane-tk-round1/`: `protocol.log`, `affected.log`, `periphery.log`,
`guide.log`, `bun-install.log`, `package-build.log`, `check.log`,
`ref-check.log`, `ref-check-final.log`, `full-suite.log`, `full-suite.exit`,
`wasm-before.txt`, `wasm-after.txt`.

The suite's wasm build passes at **1,981,512 B raw / 572,053 B gzip**, identical
to the pre-run artifact (delta **0/0 B**), **788 B** under the unchanged
**572,841 B** cap. SHA-256:
`5436a3d17dc29dbee2148bbad942ddea866526e48f9d159e96be5a6c18fe1969`.
Node 24.13.1, Bun 1.3.14, Rust 1.97.0, wasm-bindgen 0.2.127; eight Cargo jobs,
dev/test debug information off, incremental off, fd limit 65,536. No tool was
installed outside the worktree; the local LLP skill submodule was initialized
inside this worktree. No new test runner or gate.

## Deviations, limits and failure accounting

- The requested mutual proof is implemented exactly with both HMAC domains
  and nonce orderings. Encrypting the final reply is an additional protection
  against the concrete forwarding attack described above; it adds two
  server/CLI dependencies, without extending the device's dependency closure.
- `localhost` is refused at this private door because the round-1 request
  explicitly requires a literal loopback Host. Other endpoints are unchanged.
- Malformed protocol requests now share the 403 authentication refusal. A
  body cannot be authenticated until it parses and its binding is known;
  round-0's bearer-authorized malformed-body 400 assertions were deliberately
  changed. Authenticated service-name validation still yields CLI exit 1.
- The impostor test redirects the address hint to a real local listener to
  reproduce BSD's interception outcome on Linux too; it never relies on Linux
  allowing a competing wildcard/specific-address bind. The `[::]` test uses
  actual dual-stack connections, with no mocked peer addresses.
- macOS execution is **pending the supervisor's host run**. This lane has no
  Darwin runtime result and does not claim one. Suggested qualification:
  `cargo test -p snapback4 --bin snapback4 serve::token`, then
  `cargo test -p snapback4 --test token_live --test run_admission`, from
  `snapback4/`, plus the existing periphery consumer target.
- One preliminary **lane-owned compile error**: `serde_json::from_slice`'s
  type could not be inferred through a match guard (E0282). Fixed by an explicit
  `::<Mint>` before any affected test run. It is recorded in `check.log`.
  Reproduction of the former error: omit that type parameter in
  `serve_token.rs` and run `cargo check -p snapback4`.
- No unmutated affected-test or full-suite failure, and no baseline or
  environmental test failure. No known implementation problem remains.
  Operational limits: `dev --fresh` has no persistent token store; a removed/unreadable `-token`, an unreachable
  `serve.lock` hint, or a specific public-only bind refuses without another
  writer. Recovery remains named in E_STORE_BUSY. An interrupted final reply
  can leave one unused session, so the CLI never retries it automatically.

## Scoped llp-orient context

Scope: live-owner token discovery/admission, protected sidecars, identity minting
and the services guide. Governing in-flight documents in `llp/current/` are
LLP 3000 (fence/process), LLP 2000.000 (design brief), LLP 3000.019 (ownership
and discovery), and LLP 3000.021 (release intent). None of this scope is governed
by a Snapback 1 foundation gate. Active constraints: LLP 3000#4 and #7;
LLP 3000.019#3.4 (single writer, inode/sidecar protections) and #3.7 (loopback
address discovery). The current services card is the authoring source of truth.
Open risk was Grok's BSD listener interception; this round replaces the bearer
proof and covers the relay consequence. Doc update is the existing §3.4 and
services/SERVER text; hand-off: none. Integration and blind review stay with
the supervisor.
