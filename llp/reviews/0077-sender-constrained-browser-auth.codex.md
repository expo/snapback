**Reviewer family:** GPT (Codex)
**Provider / runtime:** OpenAI Codex CLI v0.145.0 — model gpt-5.6-sol, reasoning effort ultra, sandbox read-only, approval never; non-interactive `codex exec` orchestrated by /llp-super-refine
**Date:** 2026-07-23
**Redacted:** no — repo-local review; no secrets in the reviewed material; reviewer instructed not to read credential files or llp/reviews/
**Method:** cli-runner

# LLP 0077 reviews — GPT family

## Round 1 — 2026-07-23

**Revision under review:** `llp/0077-sender-constrained-browser-auth.spec.md`, sha256 `cb7c82df2c0b21839d62cfdf630eb53a0579f5ec53eca997e9deef37a19474d0` (untracked file at repo HEAD `55033289`)
**Runtime detail:** codex session id 019f8e02-f854-7610-82e7-ffe35630bcbe, workdir /Users/ccheever/projects/snapback; fresh session — no access to the orchestrating Claude session, to archived reviews, or to the concurrent Claude-family round. Ran the four named Node suites (passed); inspected but did not execute the Rust tests (read-only sandbox cannot bootstrap/build). Compared the design against RFC 9449 and the Web Cryptography API via web fetch.
**Verdict:** NOT READY

### Review body (verbatim)

1. **Revision check** — MATCH

- `shasum -a 256 llp/0077-sender-constrained-browser-auth.spec.md` returned `cb7c82df2c0b21839d62cfdf630eb53a0579f5ec53eca997e9deef37a19474d0`.
- `git rev-parse --short HEAD` returned `55033289`.

2. **Overall assessment**

The proposal’s core direction is good. Non-extractable browser custody, session-family thumbprint binding, mandatory server nonces, fail-closed replay state, and pre-body proof admission are appropriate defenses against copied credentials and off-device replay. The threat boundary is unusually honest: it explicitly disclaims active-XSS resistance, matching LLP 0060 C3’s delegated scope (`llp/0077-sender-constrained-browser-auth.spec.md:99-110`; `llp/0060-hosted-auth-security.rfc.md:835-878`).

The current state is nevertheless not ready. Most importantly, sender-bound connection grants still have real bare-bearer paths: all connection-token HTTP acts bypass sender admission, and a WebSocket upgrade can bypass it by carrying the grant in the permitted header rather than the subprotocol. There are also material conflicts with LLP 0057’s superseded-bearer grace and lost-refresh rules, incomplete normative wire/storage detail, and several implementation-checkpoint claims that the tests do not establish.

The four named Node suites passed. I inspected the Rust implementation and tests, but did not execute Cargo tests because this read-only review environment cannot perform the required bootstrap/build writes. The Draft status and explicit statement that no capability is positive are disciplined (`llp/0077-sender-constrained-browser-auth.spec.md:3-9`, `92-95`); LLP 0072 likewise still refuses positive hosted qualification without remote evidence (`llp/0072-trusted-single-tenant-control-plane.rfc.md:205-230`, `517-519`).

3. **Strengths**

- The proposal stays within LLP 0060 C3’s sender-constraint slice and preserves its narrow copied-credential claim (`llp/0077-sender-constrained-browser-auth.spec.md:99-110`; `llp/0060-hosted-auth-security.rfc.md:835-868`). Its exclusion of agents and other non-browser credential classes is consistent with LLP 0055’s hosted refusal (`llp/0077-sender-constrained-browser-auth.spec.md:255-265`; `llp/0055-agent-principals-and-scoped-grants.rfc.md:548-583`).

- The protected-resource proof is unusually precise: closed ES256/P-256 header and payload shapes, canonical base64url, fixed coordinate/signature sizes, token hash, target, nonce, and proof-id rules are stated at `llp/0077-sender-constrained-browser-auth.spec.md:112-170`. The browser primitive generates a non-extractable private key and signs the declared shape (`packages/snapback-client/sender-proof.mjs:30-91`), while custody validates the key, public JWK, thumbprint, and live sign/verify relationship (`packages/snapback-contract/auth-coordinator.mjs:439-560`).

- Proof consumption and nonce rotation really are coupled in one SQLite `IMMEDIATE` transaction (`src/auth/sender_proof.rs:972-1081`). Middleware performs sender admission before its admitted-body guard (`src/server.rs:8305-8385`, `8497-8531`), and the served outage test establishes fail-closed behavior without consuming either proof or nonce state (`src/server.rs:23936-24004`).

- The cross-language test genuinely launches the Node WebCrypto vector and verifies it in Rust (`tests/sender_proof_cross_language.rs:21-48`). Inclusive time endpoints are tested (`src/auth/sender_proof.rs:1556-1573`), and the two-connection SQLite race produces exactly one success and one replay refusal (`src/auth/sender_proof.rs:1728-1758`).

- Logout and authority-transition fencing are thoughtfully composed. The client signs logout, adopts the response nonce, clears custody, and completes anonymous resumption (`packages/snapback-client/index.mjs:3106-3193`); the positive custody-deletion behavior is tested (`packages/snapback-client/sender-transport.test.mjs:505-540`).

4. **Concerns**

1. **Major — Sender-bound connection grants still admit bare-bearer use.** The Spec says v2 covers connection grants and that protected HTTP and connection opens require proof (`llp/0077-sender-constrained-browser-auth.spec.md:99-106`, `214-223`, `255-258`). However, live, outbox, and ephemeral HTTP routes use `ConnectionGrantHeader` (`src/server.rs:6287-6335`, `6347-6401`), while sender admission handles only the exact `ConnectionGrantHeaderOrWebSocketSubprotocol` policy and then reads only the subprotocol token (`src/server.rs:8337-8347`). The later connection gate accepts the bare header token without consulting `hosted_sender` (`src/server.rs:8612-8650`). The WebSocket policy itself accepts header or subprotocol (`src/server.rs:6337-6345`, `4862-4871`), so an off-device client can bypass proof by sending `x-snapback-connection-token`. The browser client also hashes the session bearer for generic HTTP proofs (`packages/snapback-client/index.mjs:1936-1964`, `2490-2510`) while correctly hashing the grant for WebSocket (`packages/snapback-client/index.mjs:1967-1982`). Resolve this by proof-gating every use of a grant carrying `hosted_sender`, independent of route and carrier; bind HTTP grant proofs to the exact grant token; and add pre-body negative tests for every grant route and both carriers.

2. **Major — Sender admission breaks LLP 0057’s superseded-token grace, while lost-refresh recovery contradicts its authority.** LLP 0057 requires ordinary authenticated use of an in-grace tombstone to resolve as the same session and says a lost successful refresh strands the successor bearer (`llp/0057-auth-provider-protocol.spec.md:753-790`). The ordinary provider implements current-then-tombstone resolution (`src/auth/provider.rs:2819-2884`, `3003-3035`), but sender lookup joins only the current `_auth_sessions.token_hash` (`src/auth/sender_proof.rs:1105-1126`), causing proof-present predecessor tokens to be rejected before ordinary resolution (`src/auth/sender_proof.rs:757-790`). Meanwhile, LLP 0077 describes recovery for every accepted protected response, which incorrectly includes a committed refresh whose successor credential was lost (`llp/0077-sender-constrained-browser-auth.spec.md:186-205`). Resolve this with a projection-free sender-binding lookup that honors LLP 0057’s live/revoked/tombstone-grace matrix, and explicitly exempt successful credential rotation from generic nonce lost-response recovery. Add inclusive ten-second, sleeping-tab, refresh-race, and committed-response-loss tests.

3. **Major — This is not yet the complete versioned wire/storage contract LLP 0060 delegates.** LLP 0060 requires exact issuance/resource proofs, credential classes, HTTP and WebSocket transports, replay dimensions, downgrade behavior, and storage lifecycle (`llp/0060-hosted-auth-security.rfc.md:870-878`). LLP 0077 gives an exact protected-resource proof, but issuance and WebSocket are mostly prose (`llp/0077-sender-constrained-browser-auth.spec.md:193-223`). A second implementation cannot derive the exact issuance DTO/payload, subprotocol grammar, duplicate and size rules, status mappings, nonce entropy/TTL, replay keys, or backup/restore treatment. Those details currently live only in code (`packages/snapback-client/sender-proof.mjs:94-139`; `src/server.rs:4764-4774`, `8209-8255`; `src/auth/sender_proof.rs:269-330`). LLP 0057 still declares the exchange request exactly `{challengeId, code}` (`llp/0057-auth-provider-protocol.spec.md:955-1013`), so LLP 0077 also needs an explicit amendment and precedence rule. Finally, “durably records” is inaccurate: the sender binding is in the process-local grant record (`src/server.rs:2117-2137`, `4131-4142`), consistent with LLP 0059’s restart-invalidated grants (`llp/0059-session-projection-and-client-barrier.spec.md:1050-1053`). Resolve this with exact versioned DTOs, ABNF/carrier rules, storage schemas and key dimensions, error/status mappings, lifecycle semantics, and explicit authority amendments.

4. **Major — Deletion-only v1 migration is neither implemented nor structurally enforced.** The checkpoint says live tests prove deletion-only migration (`llp/0077-sender-constrained-browser-auth.spec.md:38-46`). The client test proves only that attaching a sender constraint through one legacy transition is rejected (`packages/snapback-contract/auth-sender-custody.test.mjs:223-243`); a legacy startup instead reaches the v3-only credential refusal (`packages/snapback-contract/auth-coordinator.mjs:1068-1084`). There is no tested revoke/clear/new-exchange migration. Server-side, `bind_new_session_sender_constraint` can bind any existing session id (`src/auth/sender_proof.rs:1084-1102`), and the test named `v1_has_no_implicit_upgrade` actually binds an already-existing unbound session (`src/auth/sender_proof.rs:2062-2088`). Admission does fail closed for an unbound bearer, but that is not migration. Resolve this with a capability restricted to the session-issuance transaction, an end-to-end legacy-startup migration, best-effort revocation plus durable deletion, interrupted recovery, and proof that no supported API can bind an extant v1 family.

5. **Moderate — The nonce policy contradicts its own privacy and lost-response claims.** The Spec says a retired request receives the still-current nonce and that diagnostics do not distinguish wrong nonce from bad signature or unknown token (`llp/0077-sender-constrained-browser-auth.spec.md:181-191`, `267-280`). Code checks nonce before signature (`src/auth/sender_proof.rs:1289-1306`); a wrong nonce invokes `fresh_challenge`, which generates and installs another nonce generation (`src/auth/sender_proof.rs:686-726`, `858-868`). A proof-present unknown token instead returns `INVALID` without a challenge (`src/auth/sender_proof.rs:757-776`). Thus a copied bearer plus a previously exposed public JWK can distinguish a live binding and force nonce churn without a valid signature. The stale-proof test compares the returned challenge only with post-call state, not with the prior successor (`src/auth/sender_proof.rs:2000-2023`). Resolve this by authenticating the proof before mutating nonce state, returning the existing current nonce for an authenticated retired generation, defining one intentional unknown/live wire policy, and testing timing, diagnostics, and durable state for paired cases.

6. **Moderate — Client response-nonce handling still leaks a successor and can misreport committed effects.** The transport gathers request secrets before fetch, then installs `DPoP-Nonce` without adding it to the redaction set (`packages/snapback-client/index.mjs:2715-2745`); diagnostics are sanitized only against that original set (`packages/snapback-client/index.mjs:2784-2798`). The reflection test covers request nonce `NONCE_8` but omits successor `NONCE_9`, even though it installs `NONCE_9` (`packages/snapback-client/sender-transport.test.mjs:235-259`, `364-380`). This contradicts the forbidden-error-carrier rule (`llp/0077-sender-constrained-browser-auth.spec.md:225-232`). Separately, a successful response is parsed before the client throws when its successor nonce is missing (`packages/snapback-client/index.mjs:2560-2566`), so a mutation or ephemeral act can commit while the caller observes failure and may retry. Resolve this by redacting the validated response nonce before callbacks/body parsing and specifying missing-successor responses as indeterminate outcomes with safe receipt/idempotency rules and side-effecting tests.

7. **Moderate — Replay retention is one inclusive second short.** Proof time accepts both equality endpoints (`src/auth/sender_proof.rs:1260-1266`, `1556-1573`). A proof first accepted at server time `iat-5` remains valid at `iat+30`, but its replay row expires at first-admission time plus 35 seconds and cleanup deletes rows at `expires_at_seconds <= now` (`src/auth/sender_proof.rs:874-889`, `1011-1016`). At that final accepted second the row can therefore be removed. Nonce rotation normally supplies an additional barrier for resource proofs, but the stated replay-retention contract and nonce-free issuance defense are still under-retained. Resolve this by retaining through the final inclusive second—such as 36 seconds or cleanup using `<`—and add an integrated replay-boundary test.

8. **Moderate — Several checkpoint and acceptance claims overstate the evidence.** The hosted constructor forces safe initial options (`packages/snapback-client/hosted-browser.mjs:22-41`), but inherited transport fields remain writable public properties and requests branch directly on mutable `senderConstrained` (`packages/snapback-client/index.mjs:1085-1089`, `2499-2510`); the hosted test covers constructor options and the setter, not direct mutation (`packages/snapback-client/hosted-browser.test.mjs:9-27`). This does not bypass a correctly bound server-side v2 session, but it disproves “every direct-bearer seam.” The acceptance text says “two processes,” whereas its test is two threads in one process using separate SQLite connections (`llp/0077-sender-constrained-browser-auth.spec.md:282-289`; `src/auth/sender_proof.rs:1728-1758`). Logout deletion is tested with memory custody, while IndexedDB is tested separately for persistence, not post-logout reopen (`packages/snapback-client/auth-sender-custody.test.mjs:245-279`; `packages/snapback-client/sender-transport.test.mjs:505-540`). Reword the checkpoint to the exact evidence or add private transport state, bundle mutation sentinels, subprocess replay testing, and IndexedDB reopen-after-logout coverage.

5. **Suggestions**

- Move the implementation checkpoint into a clearly non-normative appendix and add a conformance table mapping each normative requirement to unit, cross-language, served, browser, and remote evidence.

- Add an explicit “RFC 9449 profile and deviations” table. The core `typ`/JWK/`jti`/`htm`/`htu`/`iat`/`ath`/nonce structure follows [RFC 9449](https://www.rfc-editor.org/rfc/rfc9449.html), while Snapback deliberately retains the Bearer authentication scheme, mandates one-time nonces, closes algorithms and claims, adds `version`, defines custom issuance, and transports WebSocket proofs via subprotocol. These are defensible choices, but should not be left implicit.

- Clarify that WebCrypto’s `extractable: false` applies to the generated private key; the generated public key remains exportable by design under the [Web Cryptography API](https://www.w3.org/TR/webcrypto/).

- Generate the protected-route inventory from the route registry so additions cannot silently omit sender admission. Include proxy/access-log tests that ensure connection-token and sender-proof WebSocket subprotocol values are redacted.

6. **Open questions**

- For each connection-token HTTP act, is `ath` the grant token, the session bearer, or an explicitly domain-separated combination? Which credential is authoritative after grant issuance?

- Should stale, missing, and wrong nonces return the existing current nonce or rotate it? What availability guarantee prevents a copied bearer from continuously churning legitimate custody?

- How should concurrent tabs and concurrent requests compose with one current nonce generation without challenge ping-pong or ambiguous effects?

- What exact user-visible flow handles legacy v1 custody, a lost successful refresh response, and best-effort revocation when the old family cannot be contacted?

- On backup, restore, rollback, and process restart, are nonce/replay rows restored, discarded, or rendered unreachable solely by a new admission epoch?

- Does LLP 0077 formally amend LLP 0057’s provider DTOs and LLP 0059’s grant shape, and which document has precedence for each extended field?

7. **Verdict**

Verdict: NOT READY — Sender-bound connection grants still have bare-bearer paths, and the cross-authority, nonce, migration, and normative-contract issues must be resolved before this Spec can satisfy LLP 0060 C3.
