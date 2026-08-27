# Caller-owned dev-loop papercuts from the Q-b probe (restart lease, SIGTERM semantics, guide port)

**Status:** Closed
**Opened:** 2026-08-25
**Systems:** CLI, Local server lifecycle, Guide
**Related:** LLP 0307 (Q-b probe F2-F4),
`benchmarks/runs/2026-08-25-qb-lifecycle-probe-0127/record.md`

## Problems (published 0.1.27, caller-owned URL-first path)

1. **F2:** native `snapback restart` demands a secret-read lease
   (`SNAPBACK_ADMIN_SECRET_READ_REQUIRED`) — there is no credential-free
   caller-owned restart verb for the ordinary dev loop.
2. **F3:** the URL-first guide did not distinguish the two `snapback dev`
   ownership paths. SIGTERM leaves a pre-existing, attached backend running,
   but stops a backend that the same dev loop spawned and marked managed.
3. **F4:** the `snapback guide` fallback hint hardcodes port 4287
   regardless of the running server's actual port.

## Wanted

A dev-scoped restart path (or a documented equivalent) that needs no
secret lease; the attach/daemon lifecycle stated plainly in the URL-first
guide section (including how to actually stop the server); the guide hint
deriving its port from the live descriptor. Each is small; they share the
dev-loop surface.

## Resolution (2026-08-26)

- **F2 ships as authenticated server-owned self-stop for both direct stop and
  restart (round-3 correction).** The earlier claim that a credential-free
  PID-and-nonce-bound direct stop was sound is withdrawn. Both values in that
  comparison were caller-controlled when a 0600 descriptor targeted a fake
  loopback responder, so the CLI could be induced to signal an unrelated live
  PID. The comparison and its `startupNonceAndPid` receipt claim are removed,
  not strengthened.

  `snapback stop`, `snapback restart`, `snapback_stop`, and
  `snapback_restart` now terminate at the same served AdminWrite `host.stop`.
  The CLI sends only the descriptor's `startupNonce`; the authenticated server
  compares it with its own boot identity and requests its own graceful
  shutdown through its process-local channel. No descriptor/responder PID
  enters the request, stop result, liveness witness, or any CLI/MCP signal
  call. The served result contains only `shutdownRequested: true` and
  `shutdownMode: "serverSelfStop"`; it has no PID, stopped PID, echoed nonce,
  or `verifiedBy` field. The caller now validates the result's exact declared
  lifecycle authority and two-field self-stop shape, but does not preserve that
  responder claim as a CLI identity attestation. Its exact success data is
  `credentialedHostOpResultAccepted: true`,
  `configuredUrlStoppedAnswering: true`, and
  `processIdentityVerified: false`; the top-level CLI authority is null.

  The round-4 forge-envelope-then-close review established a residual that is
  **not closed by this resolution**: within the same-UID local trust model, a
  principal can read or replace both 0600 carriers, reproduce every declared
  authority/target/nonce input, run its own responder, and close it after the
  forged result. No PID or nonce echo supplies an independent trust root. The
  CLI therefore reports only the accepted credentialed result and configured-
  URL observation, never verified predecessor-process identity. The open
  limitation is tracked separately in
  `issues/20260826-same-uid-lifecycle-responder-indistinguishability.md`.

  The ordinary local loop remains zero-explicit-credential when the descriptor
  points to its readable owner-only auto-minted admin-token carrier. This is
  credential discovery, not a credential-free nonce authority claim. Without
  that carrier, direct stop refuses with
  `SNAPBACK_HOST_STOP_ADMIN_CREDENTIAL_REQUIRED`, restart refuses with
  `SNAPBACK_HOST_RESTART_ADMIN_CREDENTIAL_REQUIRED`, the target remains live,
  and the coded message names the sanctioned no-credential path: keep the
  caller-owned loop in the foreground and stop it with Ctrl-C. Live regressions
  cover the exact forged PID+nonce stop exploit, fake `{ "ok": true }`
  restart, a fully forged PID+nonce+typed-result restart, persistent-health
  liveness lies, forge-then-close receipt honesty, real credentialed success,
  and prod/test/demo profile preservation; every fake case leaves a live victim
  untouched.
- **F3 delivered with the ownership distinction made executable and taught.**
  The URL-first client page and authoring-loop guide now state that SIGTERM
  leaves a pre-existing **attached** backend running, but stops a
  **self-spawned managed** backend. A package-level regression pins the exact
  ready-file-existed classification used by the runtime. Human output still
  prints the explicit stop command for both plain and Expo `onEvent` paths.
- **F4 delivered with the narrow option authorized by the review:**
  descriptor-derived Guide URLs are accepted only for a syntactically closed
  loopback HTTP origin. Owner-only descriptor reading and nonce matching are
  retained, but no claim is made that the public nonce authenticates a remote
  HTTP origin. Non-loopback, HTTPS, credential-bearing, and path-bearing
  descriptor URLs fall back instead of becoming Guide links. Regressions cover
  a real non-default loopback port and the rejected origin classes.

Verification (2026-08-26):

- `cargo test -p snapback-cli`: `test result: ok. 144 passed; 0 failed; 0
  ignored; 0 measured; 0 filtered out`; doctest: `1 passed; 0 failed`.
- `cargo test -p snapback --test host_ops_v0 -- --nocapture`: `test result:
  ok. 19 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out`.
- `node packages/snapback-cli/dev-env-writer.test.mjs`:
  `dev-env-writer.test.mjs: managed/attached lifecycle classification, CRLF idempotence,
  marker/conflict/mode/atomicity, canonical port-80 URLs, warning, and
  plain/supervised print cases passed`.
- Registry export: `test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured;
  1 filtered out`.
- `node scripts/generate-control-catalog.mjs`: `[control-catalog] wrote 160
  entries` with `host.stop` served and `host.restart`'s authenticated,
  server-owned stop mechanism recorded.
- `cargo run -p snapback-tools --bin snapback-schemagen`: exit 0 and rewrote
  `schemas/host-ready.schema.json`; `serverProfile` now references the generated
  `ServerProfile` enum (`dev`, `demo`, `test`, `prod`).
- `node scripts/generate-guide-manifest.mjs`: `[diagnostics-registry] wrote —
  3697 codes, 13104 sites, 1728 HTTP-classified`; `[guide-manifest] wrote
  guide/guide-manifest.generated.json (157 pages)` and the flat projections.
- `node scripts/check-guide.mjs`: `[guide-check] ok — 22 passed, 0 failed, 0
  skipped, 0 preconditions; 157 pages, 1884 snippets, 174 routes + 51 host-ops
  joined, 103 warnings`.
- `node scripts/check-inventories.mjs`: `[check-inventories] PASS: 360 package
  tests; 32 scripts tests; 31 demos/31 catalog entries; 487 publication leaves;
  157 guide pages/1884 snippets`.
- `./ref-check --verbose`: `ref-check: ok — 321 LLP docs, 7428 refs in 16036
  files, 0 errors, 0 unchecked`.
