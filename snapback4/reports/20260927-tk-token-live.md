# Lane TK — service tokens from a live store owner

Branch: `sb4-intent/tk-token-live`. Base: `54099bc88`.
Implementation: `7e85a25a0`; refusal wording correction: `8e8cf4814`;
consumer test correction: `9a2533030`.
Host: expo-build-1000, Linux x86_64.
No push or publication. The supervisor owns integration and blind reviews.

## Result and forms

The existing CLI now asks a live persistent dev/serve owner to mint through
its writer. Offline minting retains its old path and interpretation. Every
successful invocation prints only the bearer token plus one newline on stdout,
including `--json`; the principal, expiry and selected store remain on stderr.
No Quarry syntax or TypeScript API was added.

| Situation | Command (in the project, on the server host) |
| --- | --- |
| Persistent dev is running | `TOKEN=$(snapback4 token --service ranker)` |
| Explicit lifetime and shared JSON flag | `TOKEN=$(snapback4 token --service ranker --days 30 --json)` |
| `serve ./release` is running | `TOKEN=$(snapback4 token --service ranker --release ./release)` |
| Server is stopped | `TOKEN=$(snapback4 token --service ranker --days 30)` (add `--release ./release` for a deployment) |

The server checks the actual loopback socket peer, a literal loopback Host,
absence of Origin, and exactly one current per-run proof. It does not infer
locality from forwarding headers or grant this capability to bearer tokens or
personas. The HTTP endpoint is `POST /dev/token`, under an already-reserved
core namespace, and its replies do not enable CORS and have `Cache-Control:
no-store`. A public/wildcard bind does not grant network minting.

## File map

All paths below are relative to `snapback4/`.

| File | Change |
| --- | --- |
| `crates/snapback4/src/serve_token.rs` | New private proof creation/reading, bounded local HTTP client, peer/proof admission, and mint handler calling the existing `identity::service_session` under the server writer. |
| `crates/snapback4/src/store_owner.rs` | Retains the per-run proof in the acquired owner, writes it before publishing the address, and exposes the existing bounded address reader to token discovery. |
| `crates/snapback4/src/serve.rs` | Registers and dispatches the reserved endpoint before generic routes. Its POST uses the existing bounded mutation-worker admission. |
| `crates/snapback4/src/verbs.rs` | Routes only `E_STORE_BUSY` token requests to the live owner; preserves offline ownership, session minting and success output. |
| `crates/snapback4/tests/token_live.rs` | Eight process tests detailed below. |
| `crates/snapback4/tests/run_admission.rs` | Changes the two live-host tests to expect token success, including canonical database aliases; other writers still refuse. |
| `packages/snapback4/test/periphery.test.mjs` | Updates both existing consumer tests to redeem tokens minted offline and live, for default flags, both days spellings, service `=` spelling and `--json`; invalid names still refuse. |
| `crates/snapback4-lang/src/guide/services.rs` | Documents live/offline token use, local proof requirements and recovery, including uncertain lost replies. |
| `crates/snapback4-lang/src/guide.rs` | Corrects the residency card's blanket offline-writer refusal statement for token. |
| `crates/snapback4-lang/src/guide/refusals.rs` | Explains token's `E_STORE_BUSY` recovery. |
| `crates/snapback4-lang/src/guide/codes.rs` | Updates the existing code's why entry; no new diagnostic code. |
| `crates/snapback4-lang/tests/guide/refusal_actions.rs` | Pins live mint recovery, the uncertain lost-reply boundary and the unchanged refusal for other offline writers. |
| `packages/snapback4/SERVER.md` | Adds live/offline provisioning instructions and stdout capture to the token paragraph. |
| `JOURNAL.md` | One dated append with implementation, measurements and exclusions. |
| `reports/20260927-tk-token-live.md` | This report and verification record. |

## Tests and evidence

`cargo test -p snapback4 --test token_live`: **8 passed**, 0 failed.

| Test | What it proves |
| --- | --- |
| `dev_live_and_offline_share_validation_expiry_and_durable_sessions` | Real dev mints; the token authenticates `/q/who`; plaintext stdout/stderr discipline; default/noninteger days and 1–3,650 day clamping match offline; name validation and exit status match; persisted digest/family/principal/kind/expiry are correct; tokens survive restart while the old proof is refused. A +25h dev clock does not change offline-compatible wall-clock mint timestamps. |
| `serve_live_and_offline_share_validation_expiry_and_durable_sessions` | The same checks with a deployed release and real `serve`, selected through the CLI's `token --release` option. |
| `public_listeners_refuse_remote_peers_and_missing_wrong_duplicate_or_browser_proofs` | Both public dev and serve refuse an actual non-loopback peer even with the correct proof and spoofed forwarded headers. Missing/wrong/duplicate proofs, browser Origin, non-loopback Host, bearer/persona substitutes and invalid/oversize bodies create no sessions. Wildcard CLI discovery still mints over loopback. |
| `unreachable_old_and_wrong_store_listeners_refuse_without_offline_writes` | Unreachable, non-loopback, wrong-store and proof-less owner discovery fail with empty stdout and a named `E_STORE_BUSY` recovery; neither database gains sessions. |
| `private_proof_rejects_links_public_modes_and_unreadable_files` | CLI refuses symlink/hard-link proofs and modes 0644/0000 without changing sessions or the target. An unreadable stale proof does not break offline minting. |
| `ipv6_loopback_discovery_mints` | An IPv6 loopback dev owner can mint a usable token through discovery. |
| `first_dev_store_is_still_required_and_temporary_dev_never_publishes_a_proof` | Missing persistent store retains the old refusal; fresh dev creates no project store/proof and exposes no mint authority. |
| `startup_refuses_proof_symlinks_and_hard_links_without_overwriting_the_target` | Release startup rejects unsafe proof files without readiness, sessions or target modification. |

Affected existing ownership target: **27 passed**, 0 failed. Final complete
consumer periphery file: **19 passed**, 0 failed. Final whole guide:
**86 passed**, 0 failed (every card/README/manual Quarry block, notes, code
registry, recovery facts and introductions). Frozen Bun install passed without dependency
changes. `./ref-check --verbose`: **517 LLP docs, 9,612 refs in 27,183 files,
0 errors, 0 unchecked**. Diff whitespace and changed-source line limits pass.

Ran `scripts/test.sh` exactly once. Exact summary:

```text
== 1 failure(s) in 1416 s
   client tests
```

Exit status **1**. The client phase failed only the two existing
periphery tests which pinned the old live-token refusal (status 2, actual 0).
Both failures are **lane-owned**, not baseline or environmental. Their
assertions are updated as above; the two token tests now pass and redeem all
16 captured bearers (two server modes × offline/live × four flag forms).
Both original tests are named `<dev|serve>: piped token stdout is one usable
bearer, and server stdout carries its URL and optional dev token`; the failure
was at `periphery.test.mjs:99`. Reproduce at `8e8cf4814` with
`node --test --test-name-pattern='piped token stdout' packages/snapback4/test/periphery.test.mjs`.
At `9a2533030`, that command passes both tests, and the complete file passes
19/19. There were **no baseline or environmental failures in the full suite**.

The Rust phase passed **3,843 tests**, with 24 intentional ignores across
238 binaries / 951 executions, in 903 seconds. Ordinary client inventory:
2,643 tests, 2,631 passed, the two failures above, 10 skipped; seven additional
shards passed 56/56. Models passed **78/78** in 279 seconds. All other phases
passed. The inherited 60-second suite budget is exceeded; no budget or timeout
was changed. The full suite was not repeated after test-only corrections:
qualification is this red full run plus the passing affected checks.

The final guide rerun also caught one **lane-owned** stale recovery pin in
`definitions::w11_every_registered_code_quotes_its_definition`: it required
the unconditional old “No work was admitted” sentence. That pin now preserves
the offline refusal and explicitly covers live mint/lost-reply recovery.
The entire final guide passes 86/86. Reproduce the old pin failure at
`9a2533030` with `cargo test -p snapback4-lang --test guide`; the final branch
includes its correction.

Raw evidence is retained in ignored
`target/lane-tk-evidence/full-suite.log` and `full-suite.exit`.

Wasm before the full suite and in its build phase: **1,981,512 B raw /
572,053 B gzip**, **0 B delta**, **788 B below** the unchanged 572,841 B
budget. SHA-256:
`5436a3d17dc29dbee2148bbad942ddea866526e48f9d159e96be5a6c18fe1969`.
No source in the wasm dependency closure changed.

## Engineering choices and limits

No design deviation or blocked portion. The brief left these details open:

- The proof is 32 OS-random bytes encoded as 64 lowercase hex characters in
  `<canonical database>-token`. It uses the existing `O_NOFOLLOW`, separate
  regular inode, single-link and size-bounded auxiliary-file checks. Creation
  is 0600 in the store's 0700 directory. It is rotated at every server start;
  a stale file is harmless and is not an ownership lock.
- Token discovery reuses `serve.lock`, the actual address record used by
  doctor. `<database>-owner` remains the empty lifetime-lock sidecar. This
  corrects the brief's address-sidecar name to match the implementation.
- IPv4/IPv6 wildcard advertisements map to loopback, as doctor does. A
  specific non-loopback bind without a loopback listener refuses; use a
  loopback/wildcard bind or the offline path.
- Minting calls the exact offline identity routine, including its existing
  validation, session records and expiry. It samples wall time, as the CLI
  did, rather than the dev testing clock. No audit semantics were added.
- Request bodies are limited to 4,096 bytes, CLI replies to 8,192 bytes;
  connect/read/write timeouts are 1/10/2 seconds. There are no HTTP redirects,
  proxies, DNS lookups, retries or fallback writes after a live-owner refusal.
  If a mint reply is lost, an unused session may exist until expiry; the
  diagnostic says so. The operator may explicitly rerun.
- Temporary `--fresh`/`--memory` servers remain outside persistent-store
  token discovery. Engine authorization, disclosure, durability, meters,
  device code, ceilings, versions and dependencies are unchanged.

No known implementation problem remains. Operational limits can be reproduced
by starting `dev --fresh`, by removing the private proof while a persistent
server runs, or by leaving an unreachable address in `serve.lock`: token
refuses without opening another writer; the diagnostics give recovery.

Pre-suite failures: two new tests initially caught a lane-owned live/offline
invalid-name exit-code mismatch (2 versus 1); fixed and all eight now pass.
An initial preliminary wasm build failed with Binaryen's
`all used features should be allowed` on `i32.extend16_s` (environmental).
The explicit-PATH recheck and full suite's wasm build pass without an optional
optimizer. No tool installation, source or budget change was needed; the
original optimizer was no longer discoverable during inspection.

Toolchain/environment: Node 24.13.1, Bun 1.3.14, Rust 1.97.0,
wasm-bindgen 0.2.127; eight Cargo build jobs, dev/test debug information off,
incremental off, fd limit 65,536. Only one full suite was launched.

Orientation: the `llp-orient` context was scoped to store ownership and service
identity. LLP 3000 §4/§7 governs the Snapback 4 fence; LLP 3000.019 §3.4
governs live-owner routing and hardened sidecars; its §3.7 supplies loopback
discovery; LLP 3000.021 and the TK brief set release intent. The existing
services card supplies the authored service surface. No core or disclosure
design needed revision; no further skill hand-off was needed.
