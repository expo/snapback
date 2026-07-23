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

## Round 2 — 2026-07-23

**Revision under review:** `llp/0077-sender-constrained-browser-auth.spec.md`, sha256 `1c583c3d358edd2e9c3de62df19bd12b4f5f3a273ed3c30b412d521995f67b46` (content MATCH; the reviewer noted HEAD had advanced to `742c5b4d` because the orchestrating session committed the round-1 revision mid-round — the file is tracked and clean at that commit, content identical to the pin)
**Runtime detail:** codex session id 019f8e17-207f-7b91-ae48-f229f1c9ea97, workdir /Users/ccheever/projects/snapback; fresh session — no access to the orchestrating Claude session, to archived reviews, or to the concurrent Claude-family round. Ran the named Node suites (pass); inspected Rust source without building (read-only sandbox). Compared against RFC 9449 and the Web Cryptography API via web fetch.
**Verdict:** NOT READY

### Review body (verbatim)

1. **Revision check**

**MISMATCH.** `shasum -a 256 llp/0077-sender-constrained-browser-auth.spec.md` returned `1c583c3d358edd2e9c3de62df19bd12b4f5f3a273ed3c30b412d521995f67b46`, so the document content is a **MATCH**. `git rev-parse --short HEAD` returned `742c5b4d`, not the stated `55033289`. `git status --short -- llp/0077-sender-constrained-browser-auth.spec.md` was clean, and `git ls-files --error-unmatch ...` showed the file is tracked here, not untracked. I reviewed the matching on-disk document against code at `742c5b4d`.

2. **Overall assessment**

This is a good security direction and substantially the right decomposition for LLP 0060 C3. The threat model is appropriately narrow, the DPoP-inspired profile is tailored thoughtfully to Snapback’s admission epochs and session families, and the document treats HTTP, WebSocket, custody, replay, refresh, logout, and reset as one composed protocol rather than independent features.

It is not ready as a normative Spec or as evidence that C3 is satisfied. The current implementation has multiple bare-bearer paths, nonce and replay-boundary defects, a broken grace lookup, and reachable post-hoc v1 binding. More importantly, the desired nonce protocol itself has an expiry deadlock and does not define concurrent-request semantics. The document’s defect ledger is commendably candid, but the implementation checkpoint overstates several tests and sits too close to normative prose.

I inspected all listed tests. The relevant JavaScript suites pass, but several named claims are narrower than their tests. I did not run Cargo tests because doing so would create build artifacts under the read-only constraint; the Rust conclusions below come from source-level inspection.

3. **Strengths**

- The scope matches LLP 0060’s delegated C3 slice: proof classes, HTTP/WebSocket transport, URI reconstruction, algorithms, nonce/replay policy, downgrade behavior, and custody lifecycle are all addressed (`llp/0060-hosted-auth-security.rfc.md:837-878`; `llp/0077-sender-constrained-browser-auth.spec.md:159-384`).

- The threat claim is disciplined: copied credentials become unusable off-device, while active same-origin compromise remains out of scope (`llp/0060-hosted-auth-security.rfc.md:861-885`; `llp/0077-sender-constrained-browser-auth.spec.md:144-157`). That is consistent with WebCrypto’s API-level, rather than hardware-backed, custody model.

- The cryptographic profile is unusually concrete. Client generation is non-extractable P-256 and proof formation is ES256 (`packages/snapback-client/sender-proof.mjs:30-92`); the Rust verifier closes the header/payload codec and enforces inclusive time boundaries (`src/auth/sender_proof.rs:1214-1311,1520-1640`); and the cross-language test really invokes the JavaScript vector and verifies it in Rust (`tests/sender_proof_cross_language.rs:21-48`).

- The production consume/rotate cut is genuinely atomic: `BEGIN IMMEDIATE`, replay insertion, exact nonce CAS, and commit occur in one transaction (`src/auth/sender_proof.rs:972-1081`). The served outage test drops replay authority, proves pre-body 503 refusal, repairs it, and then accepts the same proof, demonstrating fail-closed behavior without half-consumption (`src/server.rs:23936-24004`).

- Custody validation is strong: key usages, non-extractability, thumbprint agreement, and live private/public signing agreement are checked (`packages/snapback-contract/auth-coordinator.mjs:439-559`), and nonce-plus-credential replacement is revision- and generation-fenced in one durable write (`packages/snapback-contract/auth-coordinator.mjs:1510-1580`).

- Scope boundaries remain consistent with governing authorities. Agent, operator, pairing, and automation credentials are excluded (`llp/0077-sender-constrained-browser-auth.spec.md:374-384`), matching LLP 0055’s hosted refusal and future-agent-DPoP posture (`llp/0055-agent-principals-and-scoped-grants.rfc.md:1187-1192,1819-1827`). Family alarm remains revoke-only, as LLP 0057 requires (`llp/0057-auth-provider-protocol.spec.md:811-835`; `llp/0077-sender-constrained-browser-auth.spec.md:309-312`).

- Status discipline is good. LLP 0077 is Draft, lists capability-blocking defects, and explicitly says no capability is positive (`llp/0077-sender-constrained-browser-auth.spec.md:3-4,107-142`). LLP 0072 independently says no positive hosted-auth receipt producer exists and the profile remains unsupported while Draft (`llp/0072-trusted-single-tenant-control-plane.rfc.md:205-230,510-519`).

4. **Concerns**

1. **Major — The hosted artifact still exposes direct bare-bearer construction and mutation.** `HostedBrowserSnapbackClient` subclasses the generic `SnapbackClient`, exposing that constructor through the JavaScript prototype chain (`packages/snapback-client/hosted-browser.mjs:10-41`). Its inherited transport/authentication fields are publicly writable (`packages/snapback-client/index.mjs:1060-1097`); switching to uncoordinated mode causes `this.bearerToken` to be emitted as `Authorization: Bearer ...` (`packages/snapback-client/index.mjs:1354-1376,1846-1855`). The sentinel covers exports, constructor options, and `setBearerToken`, but not prototype reachability or direct mutation (`packages/snapback-client/hosted-browser.test.mjs:9-27`). This violates LLP 0060’s structural-exclusion requirement (`llp/0060-hosted-auth-security.rfc.md:633-647`) and the checkpoint acknowledges the missing mutation sentinel (`llp/0077-sender-constrained-browser-auth.spec.md:21-24`). Resolve it with composition or a hosted-only base that has no bearer seam, private/frozen authority state, and prototype/direct-field negative tests.

2. **Major — Sender-bound connection grants still act as bare bearers.** Server admission looks only for the WebSocket subprotocol token; absence returns `Ok(None)` and skips sender admission (`src/server.rs:8337-8347`). Later code accepts either header or subprotocol carriers (`src/server.rs:4862-4871`), while HTTP connection-token routes use the header carrier (`src/server.rs:6287-6401`) and reach the ordinary grant gate (`src/server.rs:8612-8650,9126-9167`). On the client, generic HTTP proofs hash the session bearer even when a connection grant header is presented (`packages/snapback-client/index.mjs:1936-1963,3385-3390,6261-6267`). This directly contradicts the all-routes/all-carriers grant contract (`llp/0077-sender-constrained-browser-auth.spec.md:326-331`). Resolve it by requiring exact grant lookup and grant-token `ath` verification before every grant route, including both permitted WebSocket carriers, with per-route negative tests.

3. **Major — The nonce state machine is unsafe in code and internally incomplete in the Spec.** Current `fresh_challenge` rotates an existing family nonce (`src/auth/sender_proof.rs:686-725`), through an UPSERT that advances its generation (`src/auth/sender_proof.rs:580-628`); missing-proof and wrong-nonce requests invoke it (`src/auth/sender_proof.rs:765-773,858-868`). A copied bearer can therefore churn legitimate custody, contradicting `llp/0077-sender-constrained-browser-auth.spec.md:246-252`.

   The proposed replacement deadlocks at expiry: an expired nonce must receive the “still-current” nonce, challenges may not replace an installed generation, yet nonces expire after 120 seconds (`llp/0077-sender-constrained-browser-auth.spec.md:238-259`). Returning the expired value cannot produce an acceptable next proof. Concurrent protected requests are also unspecified: the client can start multiple fetches using one nonce (`packages/snapback-client/index.mjs:1936-1964,2530-2559`), while response publication requires an exact revision and next generation (`packages/snapback-contract/auth-coordinator.mjs:1510-1580`). Resolve this with a complete transition table for live, retired, expired, wrong-epoch, and inaccessible-successor states, plus either cross-tab request serialization or an explicit multi-flight nonce design.

4. **Major — Replay retention fails at the final inclusive second, and the race test does not exercise the live path.** The accepted window totals 35 seconds (`src/auth/sender_proof.rs:21-25`) and includes both endpoints (`src/auth/sender_proof.rs:1260-1266`). Production stores `now + 35` but purges rows with `expires_at_seconds <= now` (`src/auth/sender_proof.rs:874-876,1011-1016`). At the final valid second, a key holder can reuse the same `jti` with the successor nonce after the row is purged. The two-connection test races `consume_sender_proof_id`, an otherwise unused helper, rather than live proof-plus-nonce consumption (`src/auth/sender_proof.rs:1132-1202,1728-1759`). Retain the replay key beyond the inclusive boundary and add a two-connection served-path test using the same `jti`, a fresh valid proof, and the current successor nonce.

5. **Major — In-grace token resolution does not compose with LLP 0057.** Sender lookup joins only the current `_auth_sessions.token_hash` (`src/auth/sender_proof.rs:1107-1126`), while LLP 0057 requires tombstone resolution inside the inclusive ten-second grace interval (`llp/0057-auth-provider-protocol.spec.md:762-779`). Thus the implementation cannot satisfy LLP 0077’s claimed same-session grace behavior (`llp/0077-sender-constrained-browser-auth.spec.md:230-234,423-425`). Reuse the provider’s canonical current/tombstone classifier before thumbprint verification, while explicitly preserving LLP 0059’s narrower rule that connection-open accepts only a current token (`llp/0059-session-projection-and-client-barrier.spec.md:972-979`).

6. **Major — The v1→v2 downgrade boundary is not structurally closed.** `bind_new_session_sender_constraint` can bind an arbitrary existing session (`src/auth/sender_proof.rs:1084-1102`), and its own test creates a v1 session and then attaches a binding (`src/auth/sender_proof.rs:2062-2087`). On the client, `credentialFor` exposes a v3 bearer without a profile guard (`packages/snapback-contract/auth-coordinator.mjs:1046-1060`); coordinated startup reads it, and proof wrapping depends only on mutable `senderConstrained` state (`packages/snapback-client/index.mjs:2048-2069,2136-2141`). The cited custody tests cover rotation and no automatic attachment, not legacy-startup refusal (`packages/snapback-contract/auth-sender-custody.test.mjs:207-243`). Make binding possible only inside the new-session issuance transaction, add an explicit v3 startup/version gate, and specify rollback behavior for legacy clients and servers.

7. **Major — Admission precedence conflicts with LLP 0057/0058 without an explicit amendment.** LLP 0077 maps unknown tokens into `SNAPBACK_AUTH_SENDER_PROOF_INVALID` (`llp/0077-sender-constrained-browser-auth.spec.md:395-399`), whereas LLP 0057 and LLP 0058 require malformed or unknown bearers to produce `SNAPBACK_AUTH_REQUIRED` (`llp/0057-auth-provider-protocol.spec.md:762-775`; `llp/0058-shared-invocation-authority-and-staged-auth-mode-protocol.spec.md:1112-1116`). LLP 0077 also consumes sender proof before body ingestion (`llp/0077-sender-constrained-browser-auth.spec.md:214-223`), while LLP 0058 requires forbidden authority fields in the body to win before considering a valid bearer (`llp/0058-shared-invocation-authority-and-staged-auth-mode-protocol.spec.md:1072-1088,1157-1168`). Resolve this with an exhaustive token-state × proof-state × nonce-state × body-state precedence table and explicit amendments to LLP 0057/0058.

8. **Major — Successor nonce secrecy and indeterminate-success handling violate the normative contract.** The client reads and commits the response nonce before parsing but never adds that successor to the redaction set (`packages/snapback-client/index.mjs:2715-2716,2730-2748`). Missing successor detection happens only after the response body/effect has been processed, and it throws a failure (`packages/snapback-client/index.mjs:2017-2024,2560-2566`), contrary to the requirement not to report failure for a possibly committed effect (`llp/0077-sender-constrained-browser-auth.spec.md:352-357`). The reflection test includes the predecessor nonce but not the returned successor (`packages/snapback-client/sender-transport.test.mjs:346-380`). Add the validated successor to redaction before callbacks/parsing, classify missing-nonce success as an explicit indeterminate result, and test reflected successors plus committed non-idempotent effects.

9. **Moderate — The implementation checkpoint overstates what the tests prove.** The “two connections” race does not exercise live consume/rotate, and the test named restart-durable uses one in-memory database without reopening it (`src/auth/sender_proof.rs:1700-1759`). JavaScript “lost-response recovery” is a typed 401 challenge rather than a dropped committed response (`packages/snapback-client/sender-transport.test.mjs:261-280,321-328`). Its WebSocket test checks proof presence, method, URI, and nonce, but not grant `ath` or browser-inaccessible upgrade-header recovery (`packages/snapback-client/sender-transport.test.mjs:329-345`). Legacy-startup refusal and successor-nonce redaction are also not established. Replace “passes/proves” language in `llp/0077-sender-constrained-browser-auth.spec.md:21-112` with a claim-to-test matrix and add the missing served-path cases.

10. **Major — The document is not yet a complete second-implementation contract.** Unlike the accepted protocol LLPs, it declares no normative vocabulary (`llp/0057-auth-provider-protocol.spec.md:164-169`; `llp/0058-shared-invocation-authority-and-staged-auth-mode-protocol.spec.md:141-145`). Critical rules remain present-tense narrative rather than closed requirements. `AuthCustodyV3` is only described as a delta, not a full record schema (`llp/0077-sender-constrained-browser-auth.spec.md:364-372`); the exact replay key tuple implemented as `(admission_epoch, proof_id)` is absent from the contract (`src/auth/sender_proof.rs:280-296`); “normalized absolute path” is not an interoperable URI algorithm (`llp/0077-sender-constrained-browser-auth.spec.md:204-212`); and the added grant thumbprint/epoch does not formally revise LLP 0059’s closed grant shape (`llp/0059-session-projection-and-client-barrier.spec.md:935-994`; `llp/0077-sender-constrained-browser-auth.spec.md:314-331`). Add normative vocabulary, full schemas, route/carrier matrices, exact replay and URI algorithms, and lifecycle transition tables for logout, reset/restore, admission replacement, and WebSocket successor-header loss.

5. **Suggestions**

- Present this explicitly as a Snapback sender-proof profile derived from [RFC 9449](https://www.rfc-editor.org/rfc/rfc9449.html), with a conformance/deviation table covering the retained `Bearer` scheme, mandatory nonce, `admissionEpoch`, issuance proof, grant binding, and URI construction (`llp/0077-sender-constrained-browser-auth.spec.md:194-202`).

- State plainly that WebCrypto `extractable: false` is origin/API custody, not hardware-backed protection; the active-XSS limitation is already correctly acknowledged (`llp/0077-sender-constrained-browser-auth.spec.md:155-157,337-350`; [Web Cryptography Level 2](https://www.w3.org/TR/webcrypto-2/)).

- Generate shared JavaScript/Rust conformance fixtures for URI normalization, canonical JWK/base64url decoding, duplicate headers, all inclusive time seconds, replay retention, and every nonce transition.

- Consider replacing the single global current nonce with a small bounded lease of one-use, family-bound nonce tickets. That would support concurrent tabs and lost/out-of-order responses without serializing all protected browser traffic, while preserving atomic consumption.

- Move the checkpoint and defect ledger into a clearly non-normative appendix, with each claim linked to a test name, execution status, and covered invariant.

6. **Open questions**

- How does a legitimate custody recover when its installed current nonce expires without permitting unauthenticated nonce churn?

- Must protected requests be serialized per custody across tabs, or will the server support multiple outstanding one-use nonces?

- What is the exact replay uniqueness namespace: deployment, admission epoch, proof class, thumbprint/family, and `jti`?

- Which diagnostic wins among invalid body authority fields, unknown bearer, missing proof, invalid signature, wrong nonce, and replay?

- What exact version-negotiation or static deployment gate prevents legacy clients or a rolled-back server from treating a bound family as bearer-v1?

- Is `BoundGrantAuthorityV2` a formal new shape, and does connection-open remain current-token-only while ordinary finite requests retain LLP 0057 grace?

- How does a browser recover the successor nonce from a successful WebSocket upgrade when JavaScript cannot read the response header, and must the proof-bearing subprotocol be prevented from becoming the selected application-visible protocol?

- Is one thumbprint intentionally limited to one family per admission epoch, as the current nonce key `(admission_epoch, jwk_thumbprint)` implies (`src/auth/sender_proof.rs:288-296`)?

7. **Verdict**

Verdict: NOT READY

The architecture is promising and the Draft is honest, but current bare-bearer, nonce, replay, grace, downgrade, and normative-contract defects must be resolved before LLP 0060 C3 can be satisfied.

## Round 3 — 2026-07-23

**Revision under review:** `llp/0077-sender-constrained-browser-auth.spec.md`, sha256 `b227f95ac59a65f8158095e245d175702cc3f00e6c8771ae2cf0fa606133fc1c` (the reviewer flagged a pin MISMATCH: the prompt carried the round-1 pin `1c583c3d…` while the on-disk/HEAD file is the round-2 revision `b227f95…` committed at `3dd38c29`; the review covers the on-disk revision)
**Runtime detail:** codex session id 019f8e2b-5d8f-7d21-be11-dffdf01985ef, workdir /Users/ccheever/projects/snapback; fresh session — no access to the orchestrating Claude session, to archived reviews, or to the concurrent Claude-family round. Ran the four Node suites (pass); inspected Rust source without building.
**Verdict:** NOT READY

### Review body (verbatim)

1. **Revision check** — **MISMATCH**

Commands run:

- `shasum -a 256 llp/0077-sender-constrained-browser-auth.spec.md` → `b227f95ac59a65f8158095e245d175702cc3f00e6c8771ae2cf0fa606133fc1`
- `git rev-parse --short HEAD` → `3dd38c29`

HEAD matches, but the file does not match pinned SHA-256 `1c583c3d358edd2e9c3de62df19bd12b4f5f3a273ed3c30b412d521995f67b46`. This review covers the on-disk `b227f95…` revision and must not be attributed to the requested pin.

2. **Overall assessment**

The core design is good: a closed ES256/P-256 profile, mandatory rotating server nonce, family thumbprint binding, shared replay authority, and transactional nonce consumption materially constrain off-device replay without making an XSS-resistance claim. It stays conceptually within LLP 0060 C3 and composes thoughtfully with LLPs 0057–0059.

The Draft is also unusually candid about six known implementation defects and correctly keeps all capabilities negative. However, it is not ready. The normative request precedence is internally contradictory; issuance, migration, grace, reset, and WebSocket recovery remain insufficiently specified for an independent implementation; and several implementation-checkpoint claims are broader than the code or tests support. I also found unlisted blockers: the hosted artifact exposes the generic bearer constructor through its superclass, v3 custody can enter a non-sender transport, and protected requests are not serialized per nonce generation.

The four relevant Node suites passed, but one passing sentinel is demonstrably incomplete. I inspected the Rust tests rather than executing Cargo because the repository requires a mutating bootstrap before Cargo commands in this read-only review.

3. **Strengths**

- The threat claim is correctly narrow: copied-credential/off-device replay resistance, never XSS resistance (`llp/0060-hosted-auth-security.rfc.md:835-883`; `llp/0077-sender-constrained-browser-auth.spec.md:160-171`).

- The JOSE profile is closed and testable: exact header/payload members, canonical base64url, fixed P-256/ES256, 16-byte `jti`, token/method/URI/nonce/thumbprint bindings, and deliberate RFC 9449 deviations (`llp/0077-sender-constrained-browser-auth.spec.md:173-216`; `src/auth/sender_proof.rs:30-69`, `1196-1311`).

- Atomic proof consumption and nonce rotation are implemented in one immediate SQLite transaction (`llp/0077-sender-constrained-browser-auth.spec.md:296-301`; `src/auth/sender_proof.rs:972-1076`). The two-independent-connection race really asserts one success and one replay (`src/auth/sender_proof.rs:1728-1759`), while the Spec accurately lists a true two-process race as pending (`llp/0077-sender-constrained-browser-auth.spec.md:121-125`).

- Both time endpoints are inclusive in code and tests (`llp/0077-sender-constrained-browser-auth.spec.md:250-256`; `src/auth/sender_proof.rs:1260-1266`, `1556-1572`). The positive Node WebCrypto-to-Rust test also exists and verifies live generated bytes (`tests/sender_proof_cross_language.rs:21-47`).

- Replay-authority failure is strongly fail-closed: a proof is refused before body polling, and the identical proof succeeds after authority repair, demonstrating that neither replay nor nonce state partially committed (`src/server.rs:23928-24004`).

- Custody state is carefully fenced by revision and sender generation, with non-extractable-key persistence, key-match validation, stale-rotation refusal, and key deletion represented in tests (`packages/snapback-contract/auth-coordinator.mjs:1510-1579`; `packages/snapback-contract/auth-sender-custody.test.mjs:136-220`, `245-301`).

- Status discipline is good: the document remains Draft, names blocking defects, explicitly says no capability is positive, and leaves the remote hosted matrix pending (`llp/0077-sender-constrained-browser-auth.spec.md:4`, `121-156`, `458-480`). That aligns with LLP 0060 and LLP 0072’s hosted gates (`llp/0060-hosted-auth-security.rfc.md:1090-1113`; `llp/0072-trusted-single-tenant-control-plane.rfc.md:210-230`, `517-519`).

4. **Concerns**

1. **Major — The hosted artifact does not structurally exclude the generic bearer constructor.** The checkpoint says it does (`llp/0077-sender-constrained-browser-auth.spec.md:34-37`), and LLP 0060 makes structural exclusion—not a usage convention—a hosted prerequisite (`llp/0060-hosted-auth-security.rfc.md:633-647`). But the hosted export subclasses the imported generic client (`packages/snapback-client/hosted-browser.mjs:10`, `22-41`), so `Object.getPrototypeOf(HostedBrowserSnapbackClient)` returns `SnapbackClient`, whose constructor accepts `bearerToken` (`packages/snapback-client/index.mjs:1046-1085`). I reproduced construction through that path. The sentinel checks only exports, hosted options, and the setter (`packages/snapback-client/hosted-browser.test.mjs:9-27`). Moreover, `senderConstrained` is mutable and v3 custody’s bearer is exposed through the legacy accessor, allowing a generic coordinator-backed client to send it without DPoP (`packages/snapback-contract/auth-coordinator.mjs:1046-1060`; `packages/snapback-client/index.mjs:2048-2069`). Resolve with a non-inheriting façade or opaque factory, make sender posture intrinsic to v3 custody, privatize transport posture, and add prototype-graph/direct-mutation sentinels.

2. **Major — There is no coherent normative request-precedence algorithm.** The Summary says proof verification precedes reading an application body (`llp/0077-sender-constrained-browser-auth.spec.md:163-167`), while the normative order places LLP 0058’s forbidden-body-field inspection before proof parsing and consumption (`llp/0077-sender-constrained-browser-auth.spec.md:228-239`). LLP 0058 requires that forbidden field to win even beside a valid bearer (`llp/0058-shared-invocation-authority-and-staged-auth-mode-protocol.spec.md:1112-1116`). The server currently performs sender admission first and rejects forbidden fields later (`src/server.rs:8497-8519`, `8853-8862`). Credential precedence is also contradictory: LLP 0077 requires absent/unparseable carriers to yield `SNAPBACK_AUTH_REQUIRED` (`llp/0077-sender-constrained-browser-auth.spec.md:241-244`) but later includes an unknown token under `_SENDER_PROOF_INVALID` (`llp/0077-sender-constrained-browser-auth.spec.md:448-452`), contrary to LLP 0057 (`llp/0057-auth-provider-protocol.spec.md:309-313`). The served test currently asserts malformed bearer → `_SENDER_PROOF_REQUIRED` without a proof and `_INVALID` with one (`src/server.rs:23667-23721`). Resolve with one explicit two-stage state machine defining body polling, bearer classification, proof verification, replay/nonce mutation, and diagnostic precedence, plus combined negative tests asserting both result and unchanged replay/nonce state.

3. **Major — The required one-request-per-generation serialization is not implemented.** The Spec correctly requires it (`llp/0077-sender-constrained-browser-auth.spec.md:402-410`), but concurrent calls can prepare proofs from the same capture, dispatch independently, and race successor-nonce CAS (`packages/snapback-client/index.mjs:2502-2560`). If a stale request’s challenge commits the successor locally before an accepted non-idempotent request processes the same successor header, the accepted request can be reported as stale despite its effect having committed. WebSocket proof creation similarly reserves no generation (`packages/snapback-client/index.mjs:1967-1982`). Resolve with a per-custody queue spanning proof creation through nonce-header commit for HTTP, refresh, logout, connection open, and WebSocket initiation, plus an inverted-response-order regression test.

4. **Major — The issuance extension is not an interoperable normative wire contract.** The Spec gives the signed payload but only narratively says `senderConstraint` carries a public JWK and proof (`llp/0077-sender-constrained-browser-auth.spec.md:308-344`). It omits the exact wrapper keys, whether the member is required on hosted and forbidden locally, equality between the separately carried JWK and proof-header JWK, issuance time/replay rules, and precedence against LLP 0057’s code-attempt accounting (`llp/0057-auth-provider-protocol.spec.md:709-736`). The implementation has made concrete choices—`{protocol, publicJwk, proof}`, hosted-required, local-forbidden, exact key equality—but those are only visible in code (`src/auth/wire.rs:45-94`; `src/server.rs:9320-9360`; `src/auth/sender_proof.rs:1320-1352`). Resolve with an exact closed request/response schema and a transaction/error matrix covering challenge attempts, issuance `jti`, session insertion, binding, initial nonce, commit, and publication.

5. **Major — Grace handling and hosted v1 migration need a route/activation matrix.** LLP 0077 broadly says an in-grace proof-bearing bearer resolves as the same session (`llp/0077-sender-constrained-browser-auth.spec.md:259-263`), but LLP 0059 says a superseded bearer may never mint or renew a connection grant (`llp/0059-session-projection-and-client-barrier.spec.md:972-979`). Likewise, LLP 0060 permits bearer v1 only locally (`llp/0060-hosted-auth-security.rfc.md:880-885`), while LLP 0077 describes deletion-and-re-exchange without stating how hosted activation treats extant unbound families (`llp/0077-sender-constrained-browser-auth.spec.md:329-344`, `389-393`). Resolve with a route table explicitly limiting grace to ordinary finite requests, requiring current tokens for refresh/connection open, requiring v2 exchange on hosted targets, and defining whether activation revokes old v1 families or refuses until none remain.

6. **Moderate — Stable live challenges contradict the claimed family non-enumeration property.** A bound family must receive the same live nonce repeatedly without rotation (`llp/0077-sender-constrained-browser-auth.spec.md:275-286`), while nonce issuance supposedly confirms no bearer or family fact (`llp/0077-sender-constrained-browser-auth.spec.md:288-294`). Unknown carriers currently receive fresh untracked random challenges (`src/auth/sender_proof.rs:686-726`). Two probes therefore distinguish stable bound-family state from unknown state. Resolve with a stable, keyed cover nonce for unknown carriers that can never authorize work, or explicitly narrow the non-enumeration claim and document the oracle.

7. **Moderate — Reset and epoch lifecycle contradict the implementation and remain non-normative.** The Spec says deployment restart or reset starts a fresh replay namespace (`llp/0077-sender-constrained-browser-auth.spec.md:335-337`), but the hosted authority is installed once and requests reuse its epoch (`src/admin.rs:948-975`; `src/server.rs:8327-8333`). Reset deletes sessions, and thus bindings by cascade, but does not clear sender replay/nonce tables or rotate hosted admission (`src/auth/sender_proof.rs:299-305`; `src/storage/auth.rs:1880-1915`). Resolve by defining the exact epoch authority and the transaction for reset, restore, restart, rollback, and admission replacement, including whether replay/nonces are cleared, restored but unreachable, or retained until expiry.

8. **Moderate — Several checkpoint claims exceed the tests.** “Lost-response challenge recovery” is actually an explicit typed challenge response, not a committed request whose response disappears (`llp/0077-sender-constrained-browser-auth.spec.md:72-74`; `packages/snapback-client/sender-transport.test.mjs:261-280`). Client WebSocket coverage checks only proof shape (`packages/snapback-client/sender-transport.test.mjs:329-345`); its socket mock simply opens (`packages/snapback-client/sender-transport.test.mjs:549-559`), while the Rust test can read the 101 nonce and never tests browser-inaccessible-header recovery or reconnect (`src/server.rs:24081-24094`). The reflection test covers the request nonce/JWK/proof segments but not the successor nonce, which code commits without adding to the redaction set (`packages/snapback-client/index.mjs:2730-2748`; `packages/snapback-client/sender-transport.test.mjs:235-258`, `364-380`). Narrow those checkpoint statements or add stateful lost-response, real-browser reconnect, and successor-reflection tests.

9. **Minor — Canonical URI normalization differs between Spec and code.** The Spec says to resolve literal dot segments and describes lowercased IDNA authority normalization (`llp/0077-sender-constrained-browser-auth.spec.md:220-248`); the implementation requires a pre-canonical ASCII origin and rejects any `%`, backslash, doubled slash, or literal `.`/`..` segment (`src/auth/deployment.rs:367-390`, `553-591`). Rejection is defensible, but two conforming implementations would disagree. Choose and specify one byte-exact algorithm.

5. **Suggestions**

- Add a generated route matrix covering issuance, ordinary session work, refresh, logout, family alarm, connection open, every grant-backed HTTP act, and WebSocket upgrade. For each, state credential carrier, `ath` target, grace eligibility, nonce behavior, replay namespace, and diagnostic precedence.

- Expand the RFC 9449 deviations list. Resource-server nonce challenges in RFC 9449 use `WWW-Authenticate: DPoP ... use_dpop_nonce`; Snapback uses custom JSON diagnostics and should state that deviation explicitly (`llp/0077-sender-constrained-browser-auth.spec.md:208-216`, `267-273`; [RFC 9449 §9](https://www.rfc-editor.org/rfc/rfc9449.html#section-9)).

- Replace “v1 serializes” with “the initial sender-constrained v2 implementation serializes” (`llp/0077-sender-constrained-browser-auth.spec.md:402-410`).

- Turn the implementation checkpoint into a claim/evidence ledger naming the exact test, environment, and limitation for each claim. This would make “shape-only,” “same-process,” “fake IndexedDB,” and “real TCP but non-browser” scopes visible.

- Bind LLP 0072’s hosted-auth drill receipt to the accepted LLP 0077 revision hash and acceptance-artifact digests (`llp/0072-trusted-single-tenant-control-plane.rfc.md:210-224`).

6. **Open questions**

- Which exact operation wins between forbidden-body-field detection and sender-proof consumption, and does a body rejection consume the proof/nonce?

- Should unknown carriers receive stable cover nonces, or is the bound-family existence oracle acceptable?

- Which routes accept an in-grace superseded token, especially `/connection/open` and grant renewal?

- Must hosted activation revoke all v1 families, or is permanent hosted refusal with possible local rollback sufficient?

- What is the authoritative sender admission epoch, and what rotates it on restart, reset, restore, or rollout?

- When a browser cannot read a successful WebSocket upgrade’s successor nonce, when does the serialization queue release and how is the next protected request resynchronized?

- Which issuance failures consume a code attempt, an issuance `jti`, both, or neither?

7. **Verdict**

Verdict: NOT READY

The core cryptographic direction is sound, but the normative precedence, issuance/rollout contract, client serialization, and false structural/checkpoint claims require resolution first.

## Round 4 — 2026-07-23

**Revision under review:** `llp/0077-sender-constrained-browser-auth.spec.md`, sha256 `a4028a14d8ffc02a57f06fb8305b1b8a07b3f0bf802c7a011e80bcec57bd8806` at repo HEAD `7e5b54b8` (pin MISMATCH: the orchestrator's prompt carried a stale round-1 pin due to a sed templating bug; the reviewer verified HEAD and reviewed the on-disk round-4 revision)
**Runtime detail:** codex session id 019f8e41-e0da-70a0-8191-ae53a3667c33, workdir /Users/ccheever/projects/snapback; fresh session — no access to the orchestrating Claude session, to archived reviews, or to the concurrent Claude-family round. Ran the two Node suites (pass); inspected Rust source without building.
**Verdict:** NOT READY

### Review body (verbatim)

1. **Revision check**

**MISMATCH.** I ran:

```text
$ shasum -a 256 llp/0077-sender-constrained-browser-auth.spec.md
a4028a14d8ffc02a57f06fb8305b1b8a07b3f0bf802c7a011e80bcec57bd8806  llp/0077-sender-constrained-browser-auth.spec.md

$ git rev-parse --short HEAD
7e5b54b8
```

HEAD matches the stated revision, but the file does not match the pinned SHA-256 `1c583c3d358edd2e9c3de62df19bd12b4f5f3a273ed3c30b412d521995f67b46`. I reviewed the on-disk `a4028a…` revision.

2. **Overall assessment**

The proposal is directionally strong. Sender-constraining hosted browser credentials is the right response to LLP 0060 C3, and the document correctly limits its claim to copied-credential/off-device replay rather than XSS resistance (`llp/0077-sender-constrained-browser-auth.spec.md:184-197`; `llp/0060-hosted-auth-security.rfc.md:835-878`). The closed ES256 profile, non-extractable WebCrypto custody, nonce generation, token and target binding, and atomic SQLite consume/rotate cut form a credible foundation.

The implementation is not currently safe to claim as sender-constrained. Sender-bound connection grants still have bare-bearer carriers, unauthenticated requests can churn a live family nonce, and replay retention forgets a proof identifier at its final valid second. The document commendably records these as blocking defects (`llp/0077-sender-constrained-browser-auth.spec.md:141-182`), but several additional doc/code and cross-authority inconsistencies remain.

As a normative Spec, it is also incomplete. Important exchange-wire, custody-schema, epoch-lifecycle, and WebSocket successor-nonce decisions remain open, while the document purports to modify LLP 0057/0058 precedence without an adequate amendment. The long implementation checkpoint sometimes overstates what tests prove. Draft status and “No capability is positive” are disciplined (`llp/0077-sender-constrained-browser-auth.spec.md:134-139`), but the Spec is not ready for independent implementation or gate satisfaction.

3. **Strengths**

- The protocol is deliberately closed: exact ES256/P-256 header and payload shapes, canonical base64url, fixed JTI and signature sizes, thumbprint binding, and refusal of algorithm agility are specified and implemented (`llp/0077-sender-constrained-browser-auth.spec.md:199-242`; `src/auth/sender_proof.rs:1196-1352`).

- Browser key generation uses non-extractable P-256 custody, while record validation live-signs to verify the private key, public JWK, and thumbprint agree (`packages/snapback-client/sender-proof.mjs:30-40`; `packages/snapback-contract/auth-coordinator.mjs:439-560`).

- The cross-language test is substantive: it launches Node WebCrypto proof generation and verifies the result in Rust (`tests/sender_proof_cross_language.rs:21-48`; `packages/snapback-client/sender-proof.vector.mjs:6-20`).

- Successful proof consumption, replay insertion, exact nonce-generation CAS, and successor installation share one SQLite transaction (`src/auth/sender_proof.rs:932-1081`). The two-connection race really uses two SQLite connections on separate threads and asserts one success and one replay refusal (`src/auth/sender_proof.rs:1727-1759`).

- Replay-authority failure is fail-closed before body execution, and the served test shows repair permits the same previously unconsumed proof afterward (`src/server.rs:23928-24004`).

- Logout and reset paths have meaningful coverage: logout removes sender custody and resumes anonymously (`packages/snapback-client/sender-transport.test.mjs:463-540`), while reset terminalizes the grant and refuses a signed stale request before body polling (`src/server.rs:24095-24144`).

- Both requested JavaScript suites passed: `node packages/snapback-client/sender-transport.test.mjs` and `node packages/snapback-contract/auth-sender-custody.test.mjs`. `./ref-check --verbose` also completed with zero errors.

4. **Concerns**

1. **Major — Sender-bound connection grants retain bare-bearer paths.** Sender admission recognizes the header-or-subprotocol route class but extracts only the WebSocket subprotocol token (`src/server.rs:8337-8347`). HTTP live/outbox/ephemeral routes use the grant header (`src/server.rs:6287-6401`), and downstream authentication accepts header or subprotocol (`src/server.rs:4862-4871`, `src/server.rs:8612-8650`). The client likewise attaches grant headers but generic proof preparation hashes the session bearer, not the grant (`packages/snapback-client/index.mjs:1936-1964`, `packages/snapback-client/index.mjs:3385-3391`, `packages/snapback-client/index.mjs:6261-6267`). This directly violates the every-use rule (`llp/0077-sender-constrained-browser-auth.spec.md:420-425`). Resolve it with one carrier-independent grant resolver, grant-token `ath` selection for every grant route, and negative tests for both permitted carriers on every registered route.

2. **Major — An unauthenticated copied-bearer holder can churn the legitimate client’s nonce.** Missing and wrong-nonce proofs call `fresh_challenge` (`src/auth/sender_proof.rs:823-868`), which generates and installs a new live nonce (`src/auth/sender_proof.rs:686-725`). The current test only compares the challenge with the post-rotation database row, so it enshrines rather than detects the mutation (`src/auth/sender_proof.rs:2000-2023`). Resolve by returning an existing live nonce without mutation, minting only when absent or expired, and asserting that repeated attacker challenges leave both value and generation unchanged.

3. **Major — Replay retention forgets a still-valid JTI at the final inclusive second.** Time verification accepts both endpoints (`src/auth/sender_proof.rs:1260-1266`; tests at `src/auth/sender_proof.rs:1556-1573`), but admission stores expiry as receipt time plus 35 seconds and purges rows with `expires_at_seconds <= now` (`src/auth/sender_proof.rs:872-889`, `src/auth/sender_proof.rs:1011-1016`). At the earliest valid receipt, that deletes the JTI exactly when the proof remains time-valid. The existing replay test explicitly purges an expiry of 140 at time 140 (`src/auth/sender_proof.rs:1701-1724`). Resolve using verified `iat + 30 + 1`, an exclusive `< now` purge, and exact-boundary tests for resource and issuance proofs.

4. **Major — Downgrade and v1-binding invariants are not structural.** The hosted façade subclasses the generic client (`packages/snapback-client/hosted-browser.mjs:10-22`), whose bearer, coordinator, and `senderConstrained` fields are writable and whose default is bearer-only (`packages/snapback-client/index.mjs:1046-1088`). A legacy client can read a v3 bearer and take the unsigned branch (`packages/snapback-contract/auth-coordinator.mjs:1046-1060`; `packages/snapback-client/index.mjs:2048-2069`), contrary to the checkpoint’s “v3-only credentials at legacy startup” claim (`llp/0077-sender-constrained-browser-auth.spec.md:81-84`). Separately, the public binding helper can attach a key to any extant session, and its test does exactly that (`src/auth/sender_proof.rs:1084-1103`, `src/auth/sender_proof.rs:2061-2089`). Resolve with a non-inheriting façade or private intrinsic transport posture, a v3-aware legacy-startup refusal, and an issuance-only binding capability unavailable for arbitrary session IDs.

5. **Major — The client nonce state machine violates the normative contract.** No per-custody queue exists; calls independently create and start proofs under the same generation (`packages/snapback-client/index.mjs:2499-2560`; `packages/snapback-contract/auth-coordinator.mjs:1632-1664`). The received successor nonce is installed but never added to the diagnostic redaction set, which was assembled before the response (`packages/snapback-client/index.mjs:2715-2748`). A successful body is read and parsed before the caller discovers that the successor header was missing and reports failure (`packages/snapback-client/index.mjs:2560-2566`, `packages/snapback-client/index.mjs:2747-2811`). WebSocket success additionally leaves JavaScript unable to read the upgrade successor, with queue release explicitly undecided (`llp/0077-sender-constrained-browser-auth.spec.md:446-464`, `llp/0077-sender-constrained-browser-auth.spec.md:562-563`). Resolve with one explicit HTTP/refresh/logout/connection/WebSocket state machine spanning proof creation through successor commit, including indeterminate-success handling.

6. **Major — Client and server canonicalize proof URIs differently.** The Spec requires rejecting percent encoding, backslashes, doubled slashes, and dot segments rather than resolving them (`llp/0077-sender-constrained-browser-auth.spec.md:284-290`). The server implements those rejections (`src/auth/deployment.rs:367-391`), but the client delegates to `new URL`, which can normalize these inputs before the proof is formed (`packages/snapback-client/index.mjs:102-114`). Resolve by validating the raw path before URL resolution and sharing a cross-language negative corpus for every prohibited form.

7. **Major — Diagnostic precedence contradicts governing Accepted LLPs and current code.** LLP 0077 challenges present malformed or unknown carriers (`llp/0077-sender-constrained-browser-auth.spec.md:274-282`), whereas LLP 0057 and LLP 0058 require missing, malformed, and unknown bearer states to yield `SNAPBACK_AUTH_REQUIRED` (`llp/0057-auth-provider-protocol.spec.md:767-775`, `llp/0057-auth-provider-protocol.spec.md:1098-1106`; `llp/0058-shared-invocation-authority-and-staged-auth-mode-protocol.spec.md:1112-1116`). LLP 0057 delegates only exchange members and `DPoP-Nonce`, not ordinary diagnostic precedence (`llp/0057-auth-provider-protocol.spec.md:8-16`). Implementation matches neither matrix consistently: absent authorization becomes an empty bearer and receives a sender challenge, while an unknown carrier accompanied by a proof becomes `_INVALID` without a nonce (`src/server.rs:8391-8423`; `src/auth/sender_proof.rs:757-776`). Resolve by formally amending the Accepted authorities or retaining their diagnostic, then add an exhaustive absent/malformed/unknown × absent/malformed/valid-proof test matrix.

8. **Major — Pre-body sender admission overrides LLP 0058’s stated forbidden-field precedence.** LLP 0058 requires forbidden authority fields to be rejected before bearer consideration and says that result always wins (`llp/0058-shared-invocation-authority-and-staged-auth-mode-protocol.spec.md:1072-1088`, `llp/0058-shared-invocation-authority-and-staged-auth-mode-protocol.spec.md:1771-1777`). LLP 0077 instead admits the bearer, key, nonce, and proof before the body is polled (`llp/0077-sender-constrained-browser-auth.spec.md:254-272`), matching the middleware implementation (`src/server.rs:8440-8529`). This may be the preferable security order, but it is not merely “composing” with LLP 0058. Resolve through an explicit amendment and a proof × bearer × forbidden-field precedence table.

9. **Major — Issuance and custody are not closed interoperability contracts.** The inner issuance proof is exact, but wrapper keys, hosted-required/local-forbidden modes, JWK equality, replay accounting, and precedence against code-attempt accounting remain open (`llp/0077-sender-constrained-browser-auth.spec.md:359-395`, `llp/0077-sender-constrained-browser-auth.spec.md:556-559`). LLP 0057 already fixes attempt and atomic exchange semantics (`llp/0057-auth-provider-protocol.spec.md:709-736`). Likewise, `AuthCustodyV3` is described only as the v2 shape “plus” fields, without a complete top-level version or transition-intent-v2 schema (`llp/0077-sender-constrained-browser-auth.spec.md:471-479`; `llp/0059-session-projection-and-client-barrier.spec.md:1665-1683`, `llp/0059-session-projection-and-client-barrier.spec.md:1786-1799`). Resolve with exact closed request, response, transaction-order, record, phase-invariant, and corruption/migration schemas.

10. **Major — Admission-epoch lifecycle is both contradictory and unimplemented.** The normative text says restart or reset creates a new epoch and replay space (`llp/0077-sender-constrained-browser-auth.spec.md:386-388`), while the open questions say the rotator and reset/restore/restart behavior are undecided (`llp/0077-sender-constrained-browser-auth.spec.md:552-555`). Current hosted-serving authority remains clone-shared across reset, and reset does not rotate it (`src/admin.rs:775-777`, `src/admin.rs:948-975`; `src/server.rs:14239-14458`). Resolve by distinguishing hosted admission epoch, authorization-stream incarnation, and process-local grant generation, then define table behavior for restart, replacement, reset, restore, rollback, backup, and expiry.

11. **Moderate — In-grace superseded session tokens do not compose with LLP 0057 as promised.** The Spec says they resolve to the same family (`llp/0077-sender-constrained-browser-auth.spec.md:300-304`), but sender lookup joins only the current `_auth_sessions.token_hash` and never the tombstone/grace relation (`src/auth/sender_proof.rs:1107-1126`). Resolve by reusing canonical token classification and testing current, in-grace, revoked, and grace-expired states.

12. **Moderate — The implementation checkpoint overstates test coverage.** “Lost-response recovery” only simulates receiving a typed newer-nonce challenge; it does not lose an accepted response or committed refresh (`packages/snapback-client/sender-transport.test.mjs:261-280`). JavaScript WebSocket tests check selected proof fields but not signature, grant-token `ath`, inaccessible successor handling, or reconnect resynchronization (`packages/snapback-client/sender-transport.test.mjs:329-345`). The named restart-durable replay test uses an in-memory database (`src/auth/sender_proof.rs:1701-1724`). The two-connection race is real, but it is two threads rather than the two processes required by Acceptance (`src/auth/sender_proof.rs:1727-1759`; `llp/0077-sender-constrained-browser-auth.spec.md:518-519`). Finally, the reflected-error test covers request nonce/JWK/proof material, not the successor nonce that remains unredacted (`packages/snapback-client/sender-transport.test.mjs:357-380`; `llp/0077-sender-constrained-browser-auth.spec.md:105-113`). Resolve by narrowing checkpoint language and adding the missing effect-level tests.

13. **Moderate — The nonce non-enumeration claim is stronger than the design.** A known live family returns a stable installed nonce, while an unknown carrier receives a fresh random cover nonce, exposing a repeat-query family-existence signal (`llp/0077-sender-constrained-browser-auth.spec.md:329-345`). The document itself leaves this unresolved (`llp/0077-sender-constrained-browser-auth.spec.md:550-551`). Either use a stable keyed cover nonce or explicitly accept and document the observable.

5. **Suggestions**

- Move the dated implementation narrative into an appendix or companion Plan. Keep the Spec body centered on numbered MUST-level requirements and conformance identifiers so a second implementation does not have to infer obligations from checkpoint prose.

- Generate a protected-surface matrix from the route registry: route, credential class, permitted carrier, `ath` target, nonce source, grace behavior, and expected negative diagnostics. Use it to generate both server and client conformance tests.

- Express nonce handling as a small transition table with states such as live, expired, in-flight, committed-success-header-lost, refresh-success-lost, and WebSocket-upgraded-header-inaccessible. Property-test that only verified consumption advances a live generation.

- Expand the RFC-deviation section to include error signaling and the fact that standard DPoP does not bind request bodies. Consider either explicitly accepting that limitation or adding a Snapback body-digest claim for non-idempotent actions. See [RFC 9449](https://www.rfc-editor.org/rfc/rfc9449.html).

- State explicitly that `extractable: false` is a WebCrypto API guarantee, not necessarily hardware-backed custody, and retain the current limitation that same-origin code can invoke the key. See the [Web Cryptography API](https://www.w3.org/TR/webcrypto/).

- Add a sentence preserving LLP 0055’s hosted route refusals: sender proof constrains an otherwise admitted browser-session authority; it never makes agent or `servicePrincipal` routes hosted-admissible (`llp/0055-agent-principals-and-scoped-grants.rfc.md:548-583`; `llp/0077-sender-constrained-browser-auth.spec.md:481-491`).

6. **Open questions**

- Will LLP 0057/0058 be amended to adopt the new diagnostic and body precedence, or will this Spec conform to their existing matrices?

- What is the exact closed exchange wrapper, and when do invalid issuance proofs consume code attempts or replay identifiers?

- What complete `AuthCustodyV3` and transition-intent-v2 schema must every implementation persist?

- Which event authoritatively rotates the sender admission epoch, and how do reset, restore, restart, rollback, and backup affect nonce and replay tables?

- Is the live-family existence signal acceptable, or must unknown carriers receive stable keyed cover nonces?

- Does v2 retain strict one-flight serialization, or should it launch with bounded one-use nonce tickets?

- After a successful browser WebSocket upgrade whose response header is inaccessible, when is the queue released and how is the successor nonce recovered without risking duplicate effects?

- What exhaustive route/carrier registry defines every browser-session and connection-grant protected surface?

7. **Verdict**

Verdict: NOT READY

The cryptographic core is promising, but live bare-grant, nonce-churn, replay-boundary, downgrade, and canonicalization defects plus unresolved normative and cross-authority contracts must be fixed before LLP 0060 C3 can be satisfied.

## Round 5 — 2026-07-23

**Revision under review:** `llp/0077-sender-constrained-browser-auth.spec.md`, sha256 `4b1dc95be94d6420467c612abe4eeab6ea7113aebcf1a7733e6fb2528d7130f8` (MATCH at repo HEAD `56534268`)
**Runtime detail:** codex session id 019f8e53-2d5b-7c40-b6ec-011870224798, workdir /Users/ccheever/projects/snapback; fresh session — no access to the orchestrating Claude session, to archived reviews, or to the concurrent Claude-family round. Ran the two Node suites (pass); inspected Rust source without building.
**Verdict:** NOT READY

### Review body (verbatim)

1. **Revision check** — MATCH. `shasum -a 256 llp/0077-sender-constrained-browser-auth.spec.md` returned `4b1dc95be94d6420467c612abe4eeab6ea7113aebcf1a7733e6fb2528d7130f8`; `git rev-parse --short HEAD` returned `56534268`.

2. **Overall assessment**

The core proposal is good: a closed, mandatory-nonce, non-extractable-key DPoP-style profile is an appropriate implementation of LLP 0060 C3. The threat claim is honest, the desired wire is substantially more precise than most implementation-led security proposals, and its listed deviations from [RFC 9449](https://datatracker.ietf.org/doc/html/rfc9449) are generally sensible narrowings rather than new negotiation surface (`llp/0077-sender-constrained-browser-auth.spec.md:201-259`; `llp/0060-hosted-auth-security.rfc.md:835-885`).

It is not yet a complete security contract for a second implementation. The admission-epoch lifecycle and WebSocket nonce state machine remain explicitly undecided; several rules conflict with Accepted LLP authorities; and logout has an unhandled lost-response state that can strand custody. The document is therefore correct to remain Draft and to prohibit any positive hosted capability claim (`llp/0077-sender-constrained-browser-auth.spec.md:150-199`).

The two named Node suites, `auth-sender-custody.test.mjs` and `sender-transport.test.mjs`, pass. I inspected but did not execute the Rust tests. The implementation checkpoint is unusually candid and most of its concrete claims are supported, but some evidence claims remain overstated or unverified.

3. **Strengths**

- The proposal stays within LLP 0060 C3’s intended subject matter: key custody, family binding, per-request and connection proofs, nonce/replay authority, migration, and credential-class exclusions (`llp/0060-hosted-auth-security.rfc.md:835-878`; `llp/0077-sender-constrained-browser-auth.spec.md:216-259,383-534`).

- The threat boundary is accurate: copied credentials and off-device replay are constrained, while active same-origin code remains able to invoke the signing key and is not called XSS-resistant (`llp/0077-sender-constrained-browser-auth.spec.md:201-214`; `llp/0060-hosted-auth-security.rfc.md:861-885`).

- The desired codec is unusually exact. WebCrypto creates a non-extractable P-256 key and the client emits the prescribed proof shapes (`packages/snapback-client/sender-proof.mjs:30-40,43-139`); Rust enforces closed fields, canonical base64url/JWK coordinates, bindings, signature, and inclusive time limits (`src/auth/sender_proof.rs:1196-1311,1519-1640`).

- The replay evidence is real but properly qualified: two threads open independent SQLite connections to one file and produce one success plus one replay (`src/auth/sender_proof.rs:1727-1759`); separate tests cover atomic consume/rotate and rollback (`src/auth/sender_proof.rs:1771-1899`). The inclusive boundary and adjacent failures are explicitly tested (`src/auth/sender_proof.rs:1556-1573`).

- Pre-body and fail-closed behavior are well supported. Panic-on-poll bodies prove malformed sender admission returns before body ingestion (`src/server.rs:23652-23749`), and replay-authority failure consumes neither proof nor nonce before the repaired authority accepts the same pair (`src/server.rs:23928-24004`).

- Custody evidence is substantial: forbidden-carrier checks, transition recovery, structured-clone reopen, and private/public mismatch rejection exist (`packages/snapback-contract/auth-sender-custody.test.mjs:81-301`). The reflected-material regression covers bearer, request nonce, JWK coordinates, proof segments, and the full proof (`packages/snapback-client/sender-transport.test.mjs:235-259,346-378`).

- Status discipline is strong. The Spec identifies eight blocking defects, says remaining remote and production evidence is absent, and makes no positive capability claim (`llp/0077-sender-constrained-browser-auth.spec.md:150-199`). This agrees with LLP 0072’s lack of a positive hosted qualification producer (`llp/0072-trusted-single-tenant-control-plane.rfc.md:210-230`).

4. **Concerns**

1. **Major — The eight-item implementation defect ledger is accurate and remains release-blocking.** Independent inspection confirms live-nonce churn (`src/auth/sender_proof.rs:686-726,765-773,858-869`), bare grant-header paths (`src/server.rs:8337-8363,4862-4871`), current-token-only sender lookup (`src/auth/sender_proof.rs:1107-1126`), inclusive replay purging (`src/auth/sender_proof.rs:872-879,1011-1016,1155-1160`), successor-nonce/body-order mishandling (`packages/snapback-client/index.mjs:1994-2024`), binding of an extant v1 session (`src/auth/sender_proof.rs:1084-1103,2062-2088`), absent network-spanning serialization (`packages/snapback-contract/auth-coordinator.mjs:1632-1684`), and inheritance from the mutable generic bearer client (`packages/snapback-client/hosted-browser.mjs:22-41`). These correspond to `llp/0077-sender-constrained-browser-auth.spec.md:157-199`. Resolve every ledger item with its negative test before any activation or positive capability assertion.

2. **Major — Replay epoch and reset/restore/rollback semantics contradict themselves.** The Spec states that restart or reset creates a fresh replay namespace (`llp/0077-sender-constrained-browser-auth.spec.md:410-412`), then leaves table lifecycle and the authority that rotates the epoch open (`llp/0077-sender-constrained-browser-auth.spec.md:597-600`). LLP 0060 assigns the monotone admission epoch to deployment-bound control-plane attestation, not ordinary process restart (`llp/0060-hosted-auth-security.rfc.md:464-479,531-547`), while LLP 0059 rotates the authorization-stream incarnation on reset/restore (`llp/0059-session-projection-and-client-barrier.spec.md:1542-1587`). As an inference, restoring a snapshot containing an old current nonce but lacking a later replay row could resurrect an accepted proof unless a non-rollbackable authority invalidates the whole state set. Resolve this with one exact lifecycle covering ordinary restart, reset, declared restore, backup rollback, admission replacement, nonce/replay rows, family bindings, grants, clocks, and ambiguous commits.

3. **Major — The WebSocket successor-nonce state machine is knowingly incomplete.** Successful upgrade consumes the family nonce (`llp/0077-sender-constrained-browser-auth.spec.md:451-461`), while all proof-bearing work must serialize behind the successor (`llp/0077-sender-constrained-browser-auth.spec.md:496-507`); nevertheless queue release and resynchronization are left open because browser JavaScript cannot read upgrade response headers (`llp/0077-sender-constrained-browser-auth.spec.md:603-604`). The current browser client creates the proof and immediately constructs `WebSocket` without any successor-commit path (`packages/snapback-client/index.mjs:1967-1983,3694-3711`). The Rust test can read the upgrade header through tungstenite (`src/server.rs:24081-24094`), so it does not prove browser behavior; the JavaScript test checks only method, URI, and nonce (`packages/snapback-client/sender-transport.test.mjs:329-345`). Resolve with an exact real-browser open/error/cancel/reconnect state machine, queue-release rule, deliberate resynchronization protocol, and browser-level test. Also normatively forbid selecting or echoing the proof-bearing subprotocol; current server behavior safely selects only the ordinary live protocol (`src/server.rs:24084-24086`), but the Spec does not require that.

4. **Major — Diagnostic precedence conflicts with Accepted authorities and the code implements neither contract consistently.** LLP 0077 says malformed or unknown carriers receive `SENDER_PROOF_REQUIRED` while claiming this “composes” with LLP 0057 (`llp/0077-sender-constrained-browser-auth.spec.md:298-306`). Accepted LLP 0057 and LLP 0058 require `AUTH_REQUIRED` for malformed or unknown bearers (`llp/0057-auth-provider-protocol.spec.md:1098-1105`; `llp/0058-shared-invocation-authority-and-staged-auth-mode-protocol.spec.md:1121-1125`); their recorded amendments do not delegate this diagnostic change. Meanwhile, the server converts an absent required header to an empty bearer and invokes sender admission (`src/server.rs:8391-8423`), which returns `SENDER_PROOF_REQUIRED` when no proof is present (`src/auth/sender_proof.rs:757-776`), contrary to LLP 0077’s own absent-header rule. With an unknown carrier and a supplied proof, it instead returns `SENDER_PROOF_INVALID` without the promised cover nonce (`src/auth/sender_proof.rs:765-776`). Resolve by choosing one complete carrier/proof diagnostic matrix, explicitly amending LLP 0057/0058 if necessary, and adding served pre-body tests for every matrix cell.

5. **Major — LLP 0060 D3 throttling is absent from the supposedly exact admission order.** D3 requires every challenge exchange, refresh, connection-open, and malformed/unresolved credential attempt to atomically charge all applicable shared buckets, including on denial, and to remain bounded during limiter failure (`llp/0060-hosted-auth-security.rfc.md:315-374`). LLP 0077’s ordered admission algorithm omits the limiter (`llp/0077-sender-constrained-browser-auth.spec.md:271-281`), and “failed proof consumes no code attempt” could be misimplemented as “consumes no throttle attempt” (`llp/0077-sender-constrained-browser-auth.spec.md:430-438`). Resolve by placing D3’s charge at an exact point in the normative order, distinguishing provider code-attempt state from shared throttle accounting, and adding denial-charge tests for malformed proof, unknown carrier, refresh, and connection-open.

6. **Major — A lost logout response can strand valid-looking local custody indefinitely.** The generic lost-response rule assumes the family remains resolvable so the server can return its current nonce (`llp/0077-sender-constrained-browser-auth.spec.md:371-381`), but successful logout revokes that family. Sender lookup only joins current, unrevoked sessions (`src/auth/sender_proof.rs:1107-1126`); the client clears custody only after receiving the logout response (`packages/snapback-client/index.mjs:3106-3144`), and its same-stream `SENDER_PROOF_INVALID` behavior deliberately preserves v3 custody (`packages/snapback-client/sender-transport.test.mjs:428-436`). Without a live durable-delete signal, the next signed request cannot obtain a usable nonce or prove anonymous succession. Resolve with a bounded revoked-family sender tombstone sufficient to authenticate and return terminal `durableDelete`, or a specified anonymous recovery handshake that safely proves the terminal outcome before clearing custody; add a committed-logout/transport-loss test.

7. **Major — Issuance attempt and replay accounting are not composed with LLP 0057.** LLP 0077 says a failed issuance proof consumes neither a code attempt nor replay id (`llp/0077-sender-constrained-browser-auth.spec.md:430-438`), while Accepted LLP 0057 requires every code submitted to an active challenge to increment its attempt counter (`llp/0057-auth-provider-protocol.spec.md:709-730`). The issuance proof binds `challengeId` but not `code` (`llp/0077-sender-constrained-browser-auth.spec.md:385-400`), and the Spec never states whether a cryptographically valid proof paired with a wrong code consumes its `jti`. Resolve with an atomic outcome table for invalid proof, valid proof plus wrong code, valid proof plus correct code, exhausted challenge, replay, and authority failure; then record the resulting semantic amendment in LLP 0057. A valid proof should not be reusable across code guesses merely because session binding did not commit.

8. **Major — Connection-grant composition under-amends LLP 0059.** LLP 0077 requires each grant to retain thumbprint and admission epoch and requires a proof on every grant use (`llp/0077-sender-constrained-browser-auth.spec.md:451-468`). LLP 0059 defines a closed `BoundGrantAuthorityV1` without those fields and permits only a current token—not an in-grace superseded token—to mint or renew a grant (`llp/0059-session-projection-and-client-barrier.spec.md:933-979`). LLP 0077’s broad grace-composition and acceptance wording does not preserve that carve-out explicitly (`llp/0077-sender-constrained-browser-auth.spec.md:324-328,575-577`). Resolve by defining a versioned sender-bound grant shape or exact sidecar with equality/invalidation rules, amending LLP 0059, and adding a negative connection-open test using an in-grace predecessor. The current bare-grant implementation defect confirms why this authority boundary must be closed (`src/server.rs:8337-8363`).

9. **Moderate — The implementation checkpoint still overstates some evidence.** The cross-language test is a fresh live WebCrypto vector, not a deterministic fixed vector (`tests/sender_proof_cross_language.rs:1-3,21-47` versus `llp/0077-sender-constrained-browser-auth.spec.md:557-558`). The client WebSocket test does not assert grant-token `ath`; the bound test uses a separately handcrafted Rust proof (`packages/snapback-client/sender-transport.test.mjs:329-345`; `src/server.rs:24041-24083`). The replay race covers standalone replay insertion, not concurrent full consume/rotate. The reset test proves grant invalidation and stale-proof refusal but does not query binding deletion, and no sender-specific declared-restore test appears in the named files (`src/server.rs:24102-24144`). The custody suite proves in-place attachment refusal, not legacy-startup refusal (`packages/snapback-contract/auth-sender-custody.test.mjs:223-243`). Finally, reflected request material is tested, but the successor nonce is neither reflected nor included in the forbidden set, so successor-before-body-parser sanitation remains unproved and correctly remains defect 5 (`packages/snapback-client/sender-transport.test.mjs:346-380`; `packages/snapback-client/index.mjs:1994-2024`). Resolve by narrowing the checkpoint language or adding the missing tests.

5. **Suggestions**

- Move the long checkpoint and defect history (`llp/0077-sender-constrained-browser-auth.spec.md:59-199`) into a clearly non-normative evidence appendix or companion Plan, leaving the main Spec as a conformance contract.

- Add server and client state-transition tables covering every response class: accepted 2xx/non-2xx, typed challenge, malformed response, missing/duplicate nonce header, network loss, WebSocket open/error/cancel, refresh loss, logout loss, reset, restore, and rollback.

- Print the complete closed `AuthCustodyV3` shape and pin both top-level and nested `formatVersion` values; the current “V2 plus” description is not sufficient for an independent implementation (`llp/0077-sender-constrained-browser-auth.spec.md:514-522`; `llp/0059-session-projection-and-client-barrier.spec.md:1665-1683,1786-1801`).

- Add a distinct v2 session/grant token syntax that legacy parsers reject. It is useful defense in depth even with LLP 0060 D6’s handler-first activation and coordinator-first rollback (`llp/0060-hosted-auth-security.rfc.md:551-610`).

- Expand the RFC-deviation inventory to cover uppercase `htm`, rejection-oriented URI canonicalization, the precise ASCII/octet interpretation of `ath`, CSPRNG requirements, fresh proof generation on retry, and duplicate `DPoP-Nonce` handling (`llp/0077-sender-constrained-browser-auth.spec.md:243-259,263-269,308-314`).

- Bind future LLP 0072 qualification evidence to the exact LLP 0077 protocol version and content digest, not merely a generic `senderConstrainedV2` capability (`llp/0072-trusted-single-tenant-control-plane.rfc.md:210-230`).

- State explicitly that sender proof never re-enables any hosted route or credential class refused by LLP 0055 (`llp/0055-agent-principals-and-scoped-grants.rfc.md:548-583,1145-1199`; `llp/0077-sender-constrained-browser-auth.spec.md:524-534`).

6. **Open questions**

- Which non-rollbackable authority owns `admissionEpoch`, and exactly which lifecycle events rotate it?

- What is the browser-observable WebSocket state machine after an accepted upgrade whose successor nonce header is inaccessible?

- How does a client recover from committed logout with a lost response and no live invalidation channel?

- Does a valid issuance proof paired with a wrong code consume its replay id, and how is that cut composed atomically with LLP 0057 attempt accounting?

- Is the live-family-versus-unknown-carrier nonce signal accepted, or must a stable keyed cover nonce be specified (`llp/0077-sender-constrained-browser-auth.spec.md:353-361`)?

- Is sender-bound connection authority a new grant version or an inseparable sidecar to `BoundGrantAuthorityV1`, and how does equality/reuse work?

- Must v2 tokens gain a legacy-rejecting syntax, or is LLP 0060 D6 the sole mixed-version downgrade barrier?

7. **Verdict**

Verdict: NOT READY

The design is promising, but unresolved replay/epoch and WebSocket state machines, cross-authority contradictions, lost-logout recovery, and confirmed bare-bearer/nonce/replay defects are blocking.

## Round 6 — 2026-07-23

**Revision under review:** `llp/0077-sender-constrained-browser-auth.spec.md`, sha256 `d6bb3e4ab7d2338dfc764165d52d23c8afb85cb60cafe03563ce0f28e156a39f` (MATCH at repo HEAD `99e8e993`)
**Runtime detail:** codex session id 019f8e68-141f-79f1-a4c3-b048c70a6c98, workdir /Users/ccheever/projects/snapback; fresh session — no access to the orchestrating Claude session, to archived reviews, or to the concurrent Claude-family round. Ran the four Node suites (pass); inspected Rust source without building.
**Verdict:** NOT READY

### Review body (verbatim)

1. **Revision check**

MATCH.

- `shasum -a 256 llp/0077-sender-constrained-browser-auth.spec.md` → `d6bb3e4ab7d2338dfc764165d52d23c8afb85cb60cafe03563ce0f28e156a39f`
- `git rev-parse --short HEAD` → `99e8e993`

2. **Overall assessment**

The proposal has the right security architecture: non-extractable P-256 custody, closed ES256 proofs, thumbprint-bound families, mandatory nonces, atomic replay/nonce transitions, pre-body admission, and explicit HTTP/WebSocket coverage. Its threat claim is appropriately limited to copied-credential/off-device replay rather than XSS resistance (`llp/0077-sender-constrained-browser-auth.spec.md:222-241`; `llp/0060-hosted-auth-security.rfc.md:835-883`).

It is nevertheless not ready. The nine acknowledged defects already block conformance (`llp/0077-sender-constrained-browser-auth.spec.md:171-220`), and inspection found additional unledgered contradictions: the admission-epoch lifecycle conflicts with its governing authorities and current storage model; the exact issuance discriminator differs from both implementations; valid wrong-code issuance proofs are not replay-consumed; and canonical-URI rejection is not implemented. Critical WebSocket and logout recovery state machines also remain open questions.

The four relevant JavaScript suites passed under Node. Static inspection confirms the Rust inclusive-boundary, replay-race, cross-language, and fail-closed tests exist, but I did not execute Rust tests in this read-only review. Several checkpoint statements are broader than their tests prove.

3. **Strengths**

- The threat boundary is unusually clear and agrees with LLP 0060 C3: copied tokens alone become unusable, while active same-origin code can still invoke the key (`llp/0077-sender-constrained-browser-auth.spec.md:222-235`; `llp/0060-hosted-auth-security.rfc.md:835-878`).

- The cryptographic profile is precise and suitably closed: ES256/P-256, exact JOSE fields, canonical base64url, fixed-size JTI and signature, and RFC 7638 thumbprints (`llp/0077-sender-constrained-browser-auth.spec.md:243-276`). Client construction and Rust verification follow that shape (`packages/snapback-client/sender-proof.mjs:30-139`; `src/auth/sender_proof.rs:1250-1352`).

- The requested boundary tests genuinely exist. Both inclusive time endpoints and their immediate failures are covered (`src/auth/sender_proof.rs:1519-1573`); two SQLite connections produce one replay winner (`src/auth/sender_proof.rs:1727-1759`); and replay-authority failure refuses before body polling and permits the identical proof after repair (`src/server.rs:23928-24004`).

- Custody tests cover non-extractable keys, private/public matching, fenced transitions, fake-IndexedDB reopen, and mismatch refusal (`packages/snapback-contract/auth-sender-custody.test.mjs:42-71,136-220,245-301`).

- Agent credentials remain correctly outside this slice: LLP 0055 keeps hosted service principals refused and leaves their DPoP-shaped sender binding separate (`llp/0055-agent-principals-and-scoped-grants.rfc.md:145-162,1813-1825`).

- Status discipline is good. The document is Draft and repeatedly denies any positive capability (`llp/0077-sender-constrained-browser-auth.spec.md:164-169,237-241,673-674`), consistent with LLP 0072’s still-ineligible hosted profile (`llp/0072-trusted-single-tenant-control-plane.rfc.md:210-230,517-519`).

4. **Concerns**

1. **Major — `admission_epoch` conflates two authorities with incompatible lifecycles.** LLP 0077 says the control-plane-bound epoch rotates only on reset and that one reset transaction rotates it, revokes families, and clears replay/nonce tables (`llp/0077-sender-constrained-browser-auth.spec.md:444-465`). LLP 0060 defines `HostedAdmission.admissionEpoch` as a short-lived serving/control-plane epoch replaced or withdrawn by attestation, health, rollout, or routing changes (`llp/0060-hosted-auth-security.rfc.md:464-479,531-548,591-608,792-799`). LLP 0059 separately rotates authorization-stream incarnation on reset, logical import, and declared restore (`llp/0059-session-projection-and-client-barrier.spec.md:321-340,1542-1587`). Current `HostedAdmission` is immutable, while reset deletes sessions but neither rotates it nor clears replay/nonce tables (`src/auth/deployment.rs:228-254,356-365`; `src/storage/auth.rs:1880-1915`). The reset test proves only grant termination and stale-family refusal (`src/server.rs:24102-24144`). Resolve this by defining a distinct durable `senderReplayEpoch`, colocated transactionally with session/replay state, and separately attesting it from the serving admission epoch.

2. **Major — two exact conformance rules disagree with the implementation.** The normative exchange body requires `senderConstraint.protocol: "snapback.sender-constrained.v2"` (`llp/0077-sender-constrained-browser-auth.spec.md:467-488`), but the client, server, and integration test require `"snapback.sender-issuance.v2"` (`packages/snapback-client/index.mjs:91-92,2870-2877`; `src/auth/sender_proof.rs:26-29`; `src/server.rs:9332-9338`; `packages/snapback-client/sender-transport.test.mjs:190-195`). Separately, conformance requires rejecting percent encoding, backslashes, doubled slashes, and dot segments (`llp/0077-sender-constrained-browser-auth.spec.md:341-347,702-710`), while the client delegates to WHATWG `new URL()` normalization and returns the resolved path (`packages/snapback-client/index.mjs:102-114`). Choose the discriminator’s meaning, align both implementations and tests, and add URI negative vectors.

3. **Major — valid issuance proofs are reusable across wrong-code attempts.** The Spec requires a cryptographically valid proof’s JTI to be consumed even when the code is wrong or exhausted (`llp/0077-sender-constrained-browser-auth.spec.md:490-501`). The wrong-code transaction returns `CodeInvalid`/`CodeLocked` before sender commitment installation, which occurs only on successful issuance (`src/auth/provider.rs:4217-4246,4397-4403`); unknown challenges bypass the commitment as well (`src/server.rs:10996-11025`). This permits precisely the cross-guess reuse the normative table forbids. Consume the JTI in the same rejection transaction and add wrong-code, exhausted-code, replay, and ambiguous-commit tests.

4. **Major — downgrade and bare-bearer resistance are not closed.** The document retains the `Bearer` scheme, calls all deviations “narrowings,” and leaves a legacy-rejecting token syntax versus D6 undecided (`llp/0077-sender-constrained-browser-auth.spec.md:278-286,697-698`). RFC 9449 instead uses `Authorization: DPoP` and requires a DPoP-bound token presented as Bearer to be rejected ([RFC 9449 §§7.1–7.2](https://www.rfc-editor.org/rfc/rfc9449.html#section-7.1)). A custom Bearer-based profile can be sound, but retaining Bearer is not itself a narrowing and demands a structural compensating invariant. Today defects 2 and 8 identify bare-grant and mutable-client seams (`llp/0077-sender-constrained-browser-auth.spec.md:181-186,209-215`), while accepted `BoundGrantAuthorityV1` has no thumbprint or sender epoch (`llp/0059-session-projection-and-client-barrier.spec.md:935-994`). Define `BoundGrantAuthorityV2`, exact equality/invalidation rules, activation and rollback treatment of v1 families, and either a legacy-rejecting token/scheme or an exhaustive central resolver invariant.

5. **Major — WebSocket and logout nonce recovery are not complete protocols.** Every accepted proof rotates the nonce (`llp/0077-sender-constrained-browser-auth.spec.md:405-410`), but queue release and resynchronization after an unreadable successful WebSocket 101 header remain undecided (`llp/0077-sender-constrained-browser-auth.spec.md:688-690`). The client emits the upgrade proof but has no successor-commit state machine there (`packages/snapback-client/index.mjs:1967-1982`), and per-custody serialization is explicitly unimplemented (`llp/0077-sender-constrained-browser-auth.spec.md:585-596`). Logout recovery likewise permits either a tombstone or an unspecified anonymous handshake without fixing route, retention, transaction, or response semantics (`llp/0077-sender-constrained-browser-auth.spec.md:517-526`), while LLP 0057 currently makes repeat logout `SESSION_EXPIRED` (`llp/0057-auth-provider-protocol.spec.md:801-805`). Select and specify one exact state machine for each case.

6. **Major — diagnostic precedence contradicts accepted authorities and current code.** LLP 0077 says malformed or unknown present carriers receive `SENDER_PROOF_REQUIRED` while a genuinely absent header receives `AUTH_REQUIRED` (`llp/0077-sender-constrained-browser-auth.spec.md:331-339`). LLP 0057 and LLP 0058 both assign malformed and unknown carriers `AUTH_REQUIRED` (`llp/0057-auth-provider-protocol.spec.md:767-775,1098-1105`; `llp/0058-shared-invocation-authority-and-staged-auth-mode-protocol.spec.md:1121-1125`). Current required-route code also converts an absent header to an empty bearer and issues the sender-proof challenge (`src/server.rs:8391-8406`; `src/auth/sender_proof.rs:765-776`). Add an explicit authority amendment or retain existing precedence, then pin statuses, response schema, `WWW-Authenticate`, `DPoP-Nonce`, and CORS exposure. RFC 9449’s nonce pattern uses 401 plus both `WWW-Authenticate: DPoP ...` and `DPoP-Nonce` ([RFC 9449 §9](https://www.rfc-editor.org/rfc/rfc9449.html#section-9)).

7. **Moderate — the MUST-level contract remains incomplete and its defect ledger is not exhaustive.** `AuthCustodyV3` is described as “V2 plus” while the open questions admit that description cannot support an independent implementation (`llp/0077-sender-constrained-browser-auth.spec.md:603-611,694-696`), despite LLP 0059 calling it closed (`llp/0059-session-projection-and-client-barrier.spec.md:1786-1801`). The `hosted_sender` route marker introduced by LLP 0058 is not accompanied by an exhaustive route/carrier inventory (`llp/0058-shared-invocation-authority-and-staged-auth-mode-protocol.spec.md:8-16`). LLP 0060 D3 shared-throttle charging is normative (`llp/0077-sender-constrained-browser-auth.spec.md:302-308`) but is not present in the sender-admission path or identified as a numbered defect (`src/server.rs:8321-8437`). These omissions contradict the claim that every unmet target rule is tagged (`llp/0077-sender-constrained-browser-auth.spec.md:237-241`). Close the schemas and route inventory and expand the ledger.

8. **Moderate — several implementation-checkpoint claims overstate their tests.** The claimed refusal of “v3-only credentials at legacy startup” is not covered by the cited custody tests; those test in-place attachment and legacy rotation refusal (`llp/0077-sender-constrained-browser-auth.spec.md:107-114`; `packages/snapback-contract/auth-sender-custody.test.mjs:207-242`). A generic client configured with `senderConstrained:false` can still read coordinated v3 custody and take the bare session path (`packages/snapback-client/index.mjs:1046-1077,2048-2069`). The reflected-error test checks request nonce `NONCE_8` but not successor `NONCE_9` (`packages/snapback-client/sender-transport.test.mjs:235-259,364-380`); its URL sentinel omits JWK coordinates and compact-proof segments (`packages/snapback-client/sender-transport.test.mjs:381-399`). The WebSocket assertions cover method, URI, and nonce but not `ath`, signature, JTI, or client-visible non-echo (`packages/snapback-client/sender-transport.test.mjs:329-345,649-661`). Finally, the replay race exercises the standalone JTI primitive, not the production consume-and-rotate transaction (`src/auth/sender_proof.rs:1132-1193,1727-1759`). Narrow the checkpoint language or add the missing tests.

5. **Suggestions**

- Correct the conformance time notation from self-referential `[iat−30, iat+5]` to `iat ∈ [now−30, now+5]` (`llp/0077-sender-constrained-browser-auth.spec.md:349-354,702-708`).

- Publish one language-neutral conformance corpus covering issuance failures, URI rejection, inclusive time/purge boundaries, duplicate fields, grant carriers, and nonce recovery. Run it against Rust, Node, and a real browser.

- Say “remove the persisted non-extractable `CryptoKey` handle” rather than “delete the key”; WebCrypto supplies no deterministic key-destruction operation. Current tests prove custody-record removal (`packages/snapback-client/sender-transport.test.mjs:528-533`; `packages/snapback-contract/auth-sender-custody.test.mjs:215-220`).

- Describe secret-read leases as excluded from the app-browser profile, not as non-browser authorities: LLP 0060 explicitly defines `AdminSecretRead` as a browser-memory lease, while the first hosted operator surface is disabled (`llp/0060-hosted-auth-security.rfc.md:712-733,781-799`; `llp/0077-sender-constrained-browser-auth.spec.md:619-623`).

- Bind the final 0077 protocol revision and conformance-corpus digest directly into LLP 0072’s hosted-auth drill receipt rather than only reaching it transitively through LLP 0060 (`llp/0072-trusted-single-tenant-control-plane.rfc.md:210-224`).

6. **Open questions**

- Is replay isolation keyed by a new durable sender epoch, the authorization-stream incarnation, or some composition of those with the independent serving admission epoch?

- Is the exchange object’s outer protocol `sender-constrained.v2` or `sender-issuance.v2`, and what does that discriminator semantically version?

- Will v2 use the RFC 9449 `DPoP` authorization scheme, a distinct token prefix, or a universally enforced resolver that makes legacy Bearer acceptance impossible?

- What exact activation and rollback rules revoke, preserve, or refuse extant v1 families and grants?

- When does the per-custody queue release after WebSocket open, error, cancellation, or an unreadable 101 response, and which protected request performs resynchronization?

- Which logout-lost-response design is selected, what authenticates it, and how long is recovery state retained?

- Is the stable-live-nonce versus random-cover-nonce family-existence signal acceptable (`llp/0077-sender-constrained-browser-auth.spec.md:387-395`)?

- What are the complete `AuthCustodyV3` and sender-bound grant schemas, including format versions, transitions, equality, invalidation, and rollback behavior?

7. **Verdict**

Verdict: NOT READY

The security direction is strong, but multiple normative contradictions, unimplemented replay and lifecycle requirements, and unresolved recovery/downgrade state machines must be closed before a second implementation or positive hosted capability can conform.

## Round 7 — 2026-07-23

**Revision under review:** `llp/0077-sender-constrained-browser-auth.spec.md`, sha256 `9236b279d793b841176041c69d86ecafc842f6b17d01e8541fb836569d621f61` (MATCH at repo HEAD `feb76b2c`)
**Runtime detail:** codex session id 019f8e79-5574-7323-bd78-7b89925897fd, workdir /Users/ccheever/projects/snapback; fresh session — no access to the orchestrating Claude session, to archived reviews, or to the concurrent Claude-family round. Ran the four Node suites (pass); inspected Rust source without building.
**Verdict:** NOT READY

### Review body (verbatim)

1. **Revision check**

MATCH.

- `shasum -a 256 llp/0077-sender-constrained-browser-auth.spec.md` → `9236b279d793b841176041c69d86ecafc842f6b17d01e8541fb836569d621f61`
- `git rev-parse --short HEAD` → `feb76b2c`

2. **Overall assessment**

The proposal is a strong security direction and stays within the browser sender-constraint slice delegated by LLP 0060 C3. Its threat claim is appropriately narrow—copied-credential/off-device replay resistance, not XSS resistance—and it explicitly covers non-extractable custody, session-family thumbprint binding, HTTP and WebSocket proofs, mandatory nonces, replay failure, and credential-class exclusions (`llp/0077-sender-constrained-browser-auth.spec.md:250-269`, `llp/0060-hosted-auth-security.rfc.md:835-878`).

The cryptographic verifier and core SQLite consume/rotate transaction are substantially better developed than the surrounding lifecycle contract. The Rust implementation has closed codecs, canonical decoding, exact binding checks, inclusive time-boundary tests, atomic replay/nonce operations, a real two-connection replay race, and a served fail-closed outage test (`src/auth/sender_proof.rs:1196-1311`, `src/auth/sender_proof.rs:1520-1640`, `src/auth/sender_proof.rs:1728-1759`, `src/auth/sender_proof.rs:972-1081`, `src/server.rs:23937-24004`).

However, this is not yet a complete, internally consistent specification from which an independent implementation can be built. The replay epoch and diagnostic matrices contradict themselves; the custody, grant, logout-recovery, WebSocket, and downgrade contracts defer essential choices; two Accepted governing LLPs have not received amendments that this Spec assumes; and the implementation ledger omits additional security-relevant divergences. The document correctly remains Draft and refuses a positive capability claim (`llp/0077-sender-constrained-browser-auth.spec.md:178-187`, `llp/0072-trusted-single-tenant-control-plane.rfc.md:210-230`).

I ran the four named Node suites—sender proof, sender transport, hosted browser, and sender custody—and all passed. I did not run Cargo because this was a read-only review and the repository requires bootstrap before Cargo commands; the Rust conclusions below come from direct implementation and test-body inspection.

3. **Strengths**

- The threat model is precise and honest about same-origin signing oracles and active compromise (`llp/0077-sender-constrained-browser-auth.spec.md:250-269`, `llp/0060-hosted-auth-security.rfc.md:861-868`).

- The proof format is unusually testable: closed ES256/P-256 fields, canonical base64url, exact coordinate/signature/JTI sizes, and RFC 7638 thumbprints are normative (`llp/0077-sender-constrained-browser-auth.spec.md:271-314`). Rust enforces these properties and rejects unknown fields, duplicate JSON members, malformed framing, wrong algorithms, noncanonical encodings, and tampering (`src/auth/sender_proof.rs:30-69`, `src/auth/sender_proof.rs:1196-1311`, `src/auth/sender_proof.rs:1576-1640`).

- The inclusive time boundaries really are tested: both endpoints succeed and the immediately adjacent seconds fail (`src/auth/sender_proof.rs:1260-1267`, `src/auth/sender_proof.rs:1556-1573`).

- Atomic nonce rotation is credible at the SQLite cut. The implementation checks the current generation, inserts replay state, compare-and-sets the nonce, and commits one transaction; tests prove replay refusal does not rotate another family’s nonce (`src/auth/sender_proof.rs:972-1081`, `src/auth/sender_proof.rs:1772-1826`, `src/auth/sender_proof.rs:1829-1900`).

- The Node-to-Rust test genuinely generates a live WebCrypto proof and verifies it in Rust (`tests/sender_proof_cross_language.rs:21-47`). The real WebSocket test binds a TCP listener, consumes a grant proof, does not echo the proof-bearing subprotocol, and observes the successor nonce (`src/server.rs:24049-24094`).

- Custody validation checks non-extractability, thumbprint agreement, and a live private/public signing round trip; the custody suite covers interrupted transitions, fenced rotations, IndexedDB reopen, and key mismatch (`packages/snapback-contract/auth-coordinator.mjs:479-562`, `packages/snapback-contract/auth-sender-custody.test.mjs:136-301`).

- The LLP 0058 route-scoped body-order amendment is explicitly recorded rather than silently assumed (`llp/0058-shared-invocation-authority-and-staged-auth-mode-protocol.spec.md:8-16`). The current-token-only grant-opening carve-out also agrees with LLP 0059 (`llp/0059-session-projection-and-client-barrier.spec.md:972-979`).

- Credential-class scope is disciplined. Browser sessions and grants are covered, while operator, agent, scoped automation, pairing, and lease credentials remain excluded, consistent with LLP 0055 (`llp/0077-sender-constrained-browser-auth.spec.md:658-668`, `llp/0055-agent-principals-and-scoped-grants.rfc.md:913-914`, `llp/0055-agent-principals-and-scoped-grants.rfc.md:1813-1825`).

4. **Concerns**

1. **Major** — The diagnostic and reset-recovery contract is internally contradictory and conflicts with LLPs 0057/0059.

   The HTTP section says absent `Authorization` yields `SNAPBACK_AUTH_REQUIRED`, while malformed or unknown carriers receive `SENDER_PROOF_REQUIRED` (`llp/0077-sender-constrained-browser-auth.spec.md:359-367`). The nonce section instead includes an absent carrier among cases receiving an uninstalled sender challenge (`llp/0077-sender-constrained-browser-auth.spec.md:415-423`). Both differ from LLP 0057 and LLP 0059, which require structurally invalid and unknown bearers to remain uniformly `AUTH_REQUIRED` (`llp/0057-auth-provider-protocol.spec.md:762-775`, `llp/0059-session-projection-and-client-barrier.spec.md:2585-2593`).

   The shipped behavior matches neither complete story: required routes convert absent and malformed carriers into an empty bearer (`src/server.rs:8391-8406`); no proof then produces `SENDER_PROOF_REQUIRED`, while a proof with no family produces `SENDER_PROOF_INVALID` (`src/auth/sender_proof.rs:757-777`). The client’s reset recovery probe runs only after `_INVALID`, not `_REQUIRED` (`packages/snapback-client/index.mjs:2161-2180`), and the reset test mocks that shipped `_INVALID` divergence (`packages/snapback-client/sender-transport.test.mjs:175-185`, `packages/snapback-client/sender-transport.test.mjs:428-452`). A conforming `_REQUIRED` server would therefore exhaust the one retry and strand custody (`packages/snapback-client/index.mjs:1994-2044`).

   Resolve this with one exhaustive matrix over carrier state, proof state, family state, diagnostic, nonce disclosure, and reset/logout recovery. Amend LLPs 0057 and 0059 if their public matrix changes, then align client and server tests with that single matrix.

2. **Major** — The replay-epoch lifecycle is simultaneously normative and still undecided.

   The Spec defines a distinct durable `sender_replay_epoch`, preserved across rollout and advanced on authorization-stream incarnation change (`llp/0077-sender-constrained-browser-auth.spec.md:472-499`). Elsewhere admission still validates an “admission epoch,” nonces remain “admission-epoch-bound,” and an open question asks whether the sender epoch is new, the LLP 0059 incarnation, or a composition (`llp/0077-sender-constrained-browser-auth.spec.md:339-342`, `llp/0077-sender-constrained-browser-auth.spec.md:425-431`, `llp/0077-sender-constrained-browser-auth.spec.md:733-735`). LLP 0060’s serving admission is a short-lived snapshot that expires or is replaced, so it is unsuitable as the durable replay namespace (`llp/0060-hosted-auth-security.rfc.md:531-548`).

   The implementation still keys both tables directly by serving `admission_epoch` (`src/auth/sender_proof.rs:280-295`, `src/server.rs:8327-8333`) and reset does not advance a distinct epoch or clear those tables (`src/storage.rs:768-804`).

   Resolve this by fixing one exact storage type and authority, its reset/import/restore transaction, the nonrollbackable control-plane ratchet, and failure recovery. Replace every ambiguous “admission epoch” use with either `serving_admission_epoch` or `sender_replay_epoch`, and remove the stale open question.

3. **Major** — The browser custody, logout-recovery, and WebSocket contracts are not complete enough for a second client.

   The Spec explicitly concedes that the closed `AuthCustodyV3` schema and browser-observable WebSocket state machine remain undefined and that a second client cannot be built from it (`llp/0077-sender-constrained-browser-auth.spec.md:740-758`). Logout requires a bounded authenticated recovery path, but the mechanism, retention, lookup, nonce semantics, and LLP 0057 interaction are left open (`llp/0077-sender-constrained-browser-auth.spec.md:560-571`, `llp/0077-sender-constrained-browser-auth.spec.md:729-732`). This falls short of LLP 0060’s required versioned storage, deletion, recovery, and downgrade specification (`llp/0060-hosted-auth-security.rfc.md:870-878`).

   The gap is operational, not editorial: the client clears custody only after the sender fetch returns (`packages/snapback-client/index.mjs:3123-3144`), while the server’s sender lookup excludes the revoked family after logout (`src/auth/sender_proof.rs:1114-1126`). LLP 0059 expects lost terminal frames to converge through a later handshake, grant, or request, but sender admission now blocks that route without a tombstone or distinct recovery authority (`llp/0059-session-projection-and-client-barrier.spec.md:1526-1539`).

   Resolve this with a closed V3 schema and normative state machines for total response loss, header-only response loss, logout recovery, WebSocket open/error/cancel, inaccessible upgrade headers, queue release, and reconnect.

4. **Major** — Downgrade refusal remains an open design decision even though LLP 0060 makes it a prerequisite.

   LLP 0060 makes public bearer v1 local-only and requires a closed protocol version that cannot downgrade a bound family (`llp/0060-hosted-auth-security.rfc.md:447-452`, `llp/0060-hosted-auth-security.rfc.md:850-878`). LLP 0077 requires sender material at hosted exchange and says migration is deletion-and-re-exchange, but does not specify activation, rollback, or how pre-existing v1 families behave when hosted mode is enabled (`llp/0077-sender-constrained-browser-auth.spec.md:522-531`, `llp/0077-sender-constrained-browser-auth.spec.md:617-621`). It leaves legacy-rejecting token syntax versus sole reliance on D6 open (`llp/0077-sender-constrained-browser-auth.spec.md:749-750`).

   Retaining `Authorization: Bearer` is explicitly a deviation from RFC 9449 (`llp/0077-sender-constrained-browser-auth.spec.md:306-314`), making structural downgrade refusal especially important. The inherited generic client and mutable sender flag also remain direct-bearer seams (`packages/snapback-client/hosted-browser.mjs:22-41`, `packages/snapback-client/index.mjs:1046-1088`).

   Resolve this with an activation/rollback matrix covering persisted v1 families and older handlers. A versioned credential syntax or standard `Authorization: DPoP` carrier would make refusal structural; otherwise D6 must prove that no legacy handler can interpret a v2 credential as a bare bearer.

5. **Major** — The Spec claims an LLP 0057 issuance-accounting amendment that does not exist.

   LLP 0077 requires every cryptographically valid issuance proof to consume its `jti`, including wrong, locked, or exhausted code outcomes, and says LLP 0057 carries a corresponding Revised note (`llp/0077-sender-constrained-browser-auth.spec.md:533-547`). LLP 0057’s note delegates only the optional `senderConstraint` member and `DPoP-Nonce` response header; it does not amend exchange outcome accounting (`llp/0057-auth-provider-protocol.spec.md:8-16`). LLP 0057’s existing transaction rules govern code-attempt outcomes but say nothing about a sender replay insertion (`llp/0057-auth-provider-protocol.spec.md:709-736`).

   The code demonstrates why the missing authority matters: a rejected exchange commits only the provider rejection, while sender commitment is installed solely on the issue branch (`src/server.rs:10695-10721`).

   Resolve this by amending LLP 0057 with the complete atomic outcome table and transaction ownership, then implement and test the valid-proof/wrong-code and valid-proof/exhausted-code cases.

6. **Major** — Sender-bound grant authority remains undefined, and the current carrier inventory contains bare-bearer seams.

   LLP 0077 requires proof on every grant use but admits that the versioned grant shape and LLP 0059 amendment are pending (`llp/0077-sender-constrained-browser-auth.spec.md:573-602`). LLP 0059’s Accepted `BoundGrantAuthorityV1` has neither thumbprint nor admission epoch (`llp/0059-session-projection-and-client-barrier.spec.md:935-970`).

   The known defect is confirmed: sender admission recognizes a grant only through the WebSocket subprotocol branch (`src/server.rs:8337-8347`), while ordinary authorization accepts the header carrier (`src/server.rs:4862-4871`). Connection-token HTTP routes do not enter that proof branch, and generic HTTP proof construction hashes the session bearer instead of the presented grant (`src/server.rs:6287-6401`, `packages/snapback-client/index.mjs:1936-1948`).

   Resolve this with `BoundGrantAuthorityV2`, exact equality/invalidation rules, and an exhaustive generated inventory of every grant-presenting route and permitted carrier. Every entry should test missing, malformed, wrong-`ath`, replayed, and authority-unavailable proofs before handler execution.

7. **Major** — The defect ledger is not complete, contrary to the document’s claim that every unmet target rule is tagged.

   LLP 0077 says each unmet normative rule is tagged and gated by the ledger (`llp/0077-sender-constrained-browser-auth.spec.md:265-269`). At least three additional divergences are untagged:

   - D3 requires a shared atomic throttle before proof processing (`llp/0077-sender-constrained-browser-auth.spec.md:330-336`, `llp/0060-hosted-auth-security.rfc.md:315-364`). `HostedServingAuthority` contains only admission and origin, and sender admission proceeds directly into proof processing; later process-local connection accounting cannot satisfy D3 (`src/auth/deployment.rs:289-292`, `src/server.rs:8324-8424`, `src/server.rs:8803-8831`).

   - The normative order is sender admission, forbidden-field inspection, then credential resolution (`llp/0077-sender-constrained-browser-auth.spec.md:344-357`). `SessionAuth` authority is resolved first, while body inspection and the forbidden-field check occur later (`src/server.rs:8533-8588`, `src/server.rs:8719-8780`, `src/server.rs:8853-8861`).

   - Defect 11 mentions only dot-segment resolution, but the client also fails to reject all percent-encoded, backslash, and doubled-slash paths required by conformance because it delegates to WHATWG URL resolution (`llp/0077-sender-constrained-browser-auth.spec.md:369-375`, `packages/snapback-client/index.mjs:102-114`). Client-side JWK and nonce checks also use character/length regexes rather than decode-and-re-encode canonicality (`packages/snapback-client/sender-proof.mjs:19-25`, `packages/snapback-client/index.mjs:94-125`).

   Add these to the blocking ledger, implement the D3 and ordering cuts, broaden the URI vectors, and remove the claim of exhaustive tagging until a generated conformance inventory verifies it.

8. **Moderate** — Several implementation-checkpoint statements overstate what the tests prove.

   The “lost-response challenge recovery” test injects an ordinary typed 401 challenge and retry; it does not commit an operation and discard its response (`packages/snapback-client/sender-transport.test.mjs:261-280`, `packages/snapback-client/sender-transport.test.mjs:321-328`). The WebSocket proof-shape assertion checks only method, URI, and nonce—not grant-token `ath`, header, JTI, signature, or proof distinctness (`packages/snapback-client/sender-transport.test.mjs:329-345`). I found no test for “v3-only credentials at legacy startup”; the cited custody area instead tests legacy attachment refusal, persistence, and key mismatch (`packages/snapback-contract/auth-sender-custody.test.mjs:223-301`).

   The two-connection race is real but races only `consume_sender_proof_id`, not the full verify/consume/rotate or served-request cut (`src/auth/sender_proof.rs:1728-1759`). The test named `replay_authority_is_atomic_bounded_and_restart_durable` uses one in-memory connection and never restarts or reopens it (`src/auth/sender_proof.rs:1701-1724`).

   Reword the checkpoint to the narrower evidence or add true lost-response, complete grant-proof, legacy-startup, restart-reopen, and full consume/rotate concurrency tests.

9. **Moderate** — Replay authority initialization does not validate an existing schema fail-closed.

   Initialization uses `CREATE TABLE IF NOT EXISTS` for security-critical replay and nonce tables but performs no inspection of an existing table’s columns, strictness, primary key, checks, or foreign keys (`src/auth/sender_proof.rs:269-307`). A malformed restored or pre-existing table without the uniqueness constraint could weaken replay protection rather than make the authority unavailable.

   Resolve this with exact schema validation during hosted preflight and a negative test proving that a weakened or incompatible table produces `SENDER_PROOF_AUTHORITY_UNAVAILABLE`.

5. **Suggestions**

- Move the long revision history, checkpoint, and defect ledger into a companion Issue or Plan LLP. Keep this Spec centered on stable normative types, state machines, outcome matrices, and conformance vectors.

- Generate a route × carrier × credential-state × proof-state table from route metadata. It should drive both server tests and the hosted-auth drill so a newly added route cannot silently become a bare-bearer seam.

- Bind the exact LLP 0077 revision or conformance-vector digest into LLP 0072’s content-addressed hosted-auth drill receipt, alongside the handler and admission identities (`llp/0072-trusted-single-tenant-control-plane.rfc.md:210-224`).

- Make the RFC 9449 deviation list exhaustive. In addition to the listed differences, call out issuance proof transport in a JSON member, the shared nonce namespace across authorization/resource surfaces, strict path rejection, and retaining the Bearer scheme. Standard DPoP-bound tokens use `Authorization: DPoP`; see [RFC 9449 §§4 and 7](https://www.rfc-editor.org/rfc/rfc9449.html).

- Model the nonce/custody protocol as a small executable state machine. Property-based schedules covering two tabs, lost headers, total response loss, refresh, logout, reset, WebSocket cancellation, and stale CAS would likely find lifecycle gaps more efficiently than example-only tests.

- Keep serialized single-flight as the initial safe profile, but measure its head-of-line blocking before finalizing it permanently. A bounded server-issued batch of one-use nonce tickets could later preserve replay resistance without making every browser request globally sequential.

6. **Open questions**

- What exactly owns and stores `sender_replay_epoch`, and how does reset/import/restore advance it against a nonrollbackable control-plane ratchet?

- What is the final diagnostic and nonce-disclosure matrix for absent, malformed, unknown, revoked, superseded, and reset-invalidated carriers?

- Which authenticated logout-recovery design is chosen, and what are its retention, proof, nonce, privacy, and repeat-logout rules?

- When does the per-custody queue release around WebSocket open/error/cancel, and how does the browser resynchronize after an inaccessible successful-upgrade header?

- What is the complete closed `AuthCustodyV3` schema, including anonymous, clearing, corrupt, migration, and recovery states?

- What is the exact `BoundGrantAuthorityV2` shape, and which grant carriers and route classes are permitted?

- Is downgrade refusal structural through versioned token/carrier syntax, or entirely dependent on D6 admission? What happens to extant v1 families during activation and rollback?

- Which authority provides shared replay, nonce, and D3 throttle state for the first adapter, and how are schema mismatch, restart, backup rollback, and ambiguous commits handled?

- Is the residual live-family signal from stable installed versus random cover nonces acceptable, or must unknown carriers receive a stable keyed cover value?

- Is strict one-current-nonce serialization an intentional long-term browser performance contract, or only the v2 launch profile?

7. **Verdict**

Verdict: NOT READY

The cryptographic core is promising, but the contradictory epoch and diagnostic rules, unresolved custody/grant/logout/downgrade contracts, missing authority amendments, and unledgered server gaps must be resolved before this can satisfy LLP 0060 C3.

## Round 8 — 2026-07-23

**Revision under review:** `llp/0077-sender-constrained-browser-auth.spec.md`, sha256 `be8fd692b006955388b2b5080de50a389702526c8db72faaf93cbd5b1f8fd477` (MATCH at repo HEAD `0b516b48`)
**Runtime detail:** codex session id 019f8e8b-1b59-7133-9a10-9b2b3dbeb7ee, workdir /Users/ccheever/projects/snapback; fresh session — no access to the orchestrating Claude session, to archived reviews, or to the concurrent Claude-family round. Ran the Node suites (pass); inspected Rust source without building.
**Verdict:** NOT READY

### Review body (verbatim)

1. **Revision check**

MATCH.

- `shasum -a 256 llp/0077-sender-constrained-browser-auth.spec.md` → `be8fd692b006955388b2b5080de50a389702526c8db72faaf93cbd5b1f8fd477`
- `git rev-parse --short HEAD` → `0b516b48`

2. **Overall assessment**

This is a good and necessary design direction. It stays largely within LLP 0060 C3’s delegated browser-session slice, uses a closed cryptographic profile, accurately limits its claim to copied-credential/off-device replay, and treats proof replay, nonce state, credential custody, connection grants, and lifecycle changes as one composed authority problem rather than isolated cryptography ([llp/0077:275](/Users/ccheever/projects/snapback/llp/0077-sender-constrained-browser-auth.spec.md:275), [llp/0060:835](/Users/ccheever/projects/snapback/llp/0060-hosted-auth-security.rfc.md:835)).

It is not ready for acceptance or a positive capability gate. The twelve-item implementation-defect ledger is substantially accurate, but several normative questions remain unresolved, two diagnostic paths contradict governing authorities and current code, and the document is not yet sufficient to implement a second client. The most serious gaps concern bare connection-grant carriers, replay-epoch semantics, the final-inclusive replay boundary, per-custody serialization, WebSocket successor-nonce handling, logout convergence, D3 accounting, and v1→v2 downgrade closure.

I ran the four named JavaScript suites; all passed. `./ref-check --verbose` also passed with zero errors. I inspected the Rust test bodies rather than executing Cargo under the read-only constraint. The tests exist, but several checkpoint descriptions overstate what they prove.

3. **Strengths**

- The exact ES256/P-256 header and payload, canonical encodings, fixed-size `jti`, closed fields, token hash, URI, nonce, and thumbprint bindings form a strong, independently testable profile ([llp/0077:296](/Users/ccheever/projects/snapback/llp/0077-sender-constrained-browser-auth.spec.md:296), [src/auth/sender_proof.rs:30](/Users/ccheever/projects/snapback/src/auth/sender_proof.rs:30), [src/auth/sender_proof.rs:1196](/Users/ccheever/projects/snapback/src/auth/sender_proof.rs:1196)).

- The verifier’s inclusive time boundaries and broad negative corpus are real, including unknown fields, malformed encodings, duplicate fields, framing, binding axes, and signature tampering ([src/auth/sender_proof.rs:1260](/Users/ccheever/projects/snapback/src/auth/sender_proof.rs:1260), [src/auth/sender_proof.rs:1520](/Users/ccheever/projects/snapback/src/auth/sender_proof.rs:1520), [src/auth/sender_proof.rs:1576](/Users/ccheever/projects/snapback/src/auth/sender_proof.rs:1576)).

- Successful replay consumption and nonce rotation are correctly coupled in one SQLite `IMMEDIATE` transaction, and replay-authority failure is tested fail-closed before body polling ([src/auth/sender_proof.rs:932](/Users/ccheever/projects/snapback/src/auth/sender_proof.rs:932), [src/server.rs:23936](/Users/ccheever/projects/snapback/src/server.rs:23936)).

- The non-extractable WebCrypto key, exact public identity, custody generation, structured-clone persistence, and compare-and-rotate barriers are well designed and exercised ([llp/0077:647](/Users/ccheever/projects/snapback/llp/0077-sender-constrained-browser-auth.spec.md:647), [packages/snapback-contract/auth-coordinator.mjs:1063](/Users/ccheever/projects/snapback/packages/snapback-contract/auth-coordinator.mjs:1063), [packages/snapback-contract/auth-sender-custody.test.mjs:245](/Users/ccheever/projects/snapback/packages/snapback-contract/auth-sender-custody.test.mjs:245)).

- The served proof gate really precedes body polling, and the WebSocket positive test crosses a real bound TCP listener, verifies the grant-bound proof, and avoids negotiating the proof-bearing subprotocol ([src/server.rs:8491](/Users/ccheever/projects/snapback/src/server.rs:8491), [src/server.rs:23652](/Users/ccheever/projects/snapback/src/server.rs:23652), [src/server.rs:24041](/Users/ccheever/projects/snapback/src/server.rs:24041)).

- Scope and status are unusually honest: agent/operator authorities are excluded, active-XSS resistance is disclaimed, every known defect blocks capability, and LLP 0072 remains non-positive ([llp/0077:286](/Users/ccheever/projects/snapback/llp/0077-sender-constrained-browser-auth.spec.md:286), [llp/0077:697](/Users/ccheever/projects/snapback/llp/0077-sender-constrained-browser-auth.spec.md:697), [llp/0077:193](/Users/ccheever/projects/snapback/llp/0077-sender-constrained-browser-auth.spec.md:193), [llp/0072:517](/Users/ccheever/projects/snapback/llp/0072-trusted-single-tenant-control-plane.rfc.md:517)).

4. **Concerns**

1. **Major** — The epoch contract remains internally contradictory. HTTP verification and the nonce section still describe an “admission epoch” and deployment/admission-epoch-bound nonces, while the lifecycle section requires a distinct durable `sender_replay_epoch` specifically because LLP 0060’s serving epoch rotates during rollout and health changes ([llp/0077:351](/Users/ccheever/projects/snapback/llp/0077-sender-constrained-browser-auth.spec.md:351), [llp/0077:457](/Users/ccheever/projects/snapback/llp/0077-sender-constrained-browser-auth.spec.md:457), [llp/0077:504](/Users/ccheever/projects/snapback/llp/0077-sender-constrained-browser-auth.spec.md:504), [llp/0060:531](/Users/ccheever/projects/snapback/llp/0060-hosted-auth-security.rfc.md:531)). The implementation keys both tables on the serving epoch and reset/restore do not perform the required ratchet and clear ([src/auth/sender_proof.rs:269](/Users/ccheever/projects/snapback/src/auth/sender_proof.rs:269), [src/server.rs:8327](/Users/ccheever/projects/snapback/src/server.rs:8327), [src/storage/auth.rs:1336](/Users/ccheever/projects/snapback/src/storage/auth.rs:1336)). Resolve this by using one term throughout, specifying the durable schema and non-rollbackable ratchet, and adding rollout/restart/reset/restore straddle tests.

2. **Major** — The final-inclusive replay seam is real. The normative rule retains a `jti` through `iat + 30 + 1` and purges only with `< now`, but code anchors retention at verification time and purges with `<= now` ([llp/0077:404](/Users/ccheever/projects/snapback/llp/0077-sender-constrained-browser-auth.spec.md:404), [src/auth/sender_proof.rs:348](/Users/ccheever/projects/snapback/src/auth/sender_proof.rs:348), [src/auth/sender_proof.rs:1011](/Users/ccheever/projects/snapback/src/auth/sender_proof.rs:1011)). For a proof initially accepted at the +5-second future-skew boundary, its row can be deleted exactly when the verifier still accepts it. The two-connection race calls the test-only `consume_sender_proof_id`, not production consume-and-rotate ([src/auth/sender_proof.rs:1129](/Users/ccheever/projects/snapback/src/auth/sender_proof.rs:1129), [src/auth/sender_proof.rs:1728](/Users/ccheever/projects/snapback/src/auth/sender_proof.rs:1728)). Fix the arithmetic and comparator, then race the production transaction and explicitly replay at the final inclusive second.

3. **Major** — Sender-bound connection grants still have bare-bearer paths. The Spec requires proof on every permitted carrier, but sender admission only considers the WebSocket subprotocol token; header-only live, outbox, and ephemeral routes proceed through ordinary connection-token authentication ([llp/0077:624](/Users/ccheever/projects/snapback/llp/0077-sender-constrained-browser-auth.spec.md:624), [src/server.rs:8337](/Users/ccheever/projects/snapback/src/server.rs:8337), [src/server.rs:4862](/Users/ccheever/projects/snapback/src/server.rs:4862), [src/server.rs:6287](/Users/ccheever/projects/snapback/src/server.rs:6287)). Moreover, LLP 0059 still defines only `BoundGrantAuthorityV1`, while the V2 equality and invalidation amendment is pending ([llp/0059:933](/Users/ccheever/projects/snapback/llp/0059-session-projection-and-client-barrier.spec.md:933), [llp/0077:637](/Users/ccheever/projects/snapback/llp/0077-sender-constrained-browser-auth.spec.md:637)). Resolve this with a versioned grant shape and a carrier-by-route negative matrix proving every sender-bound grant use requires a grant-token `ath` proof.

4. **Major** — The one-live-nonce model lacks a complete browser state machine. The Spec requires serialization from proof creation through successor installation, but the client has no per-custody queue ([llp/0077:669](/Users/ccheever/projects/snapback/llp/0077-sender-constrained-browser-auth.spec.md:669), [packages/snapback-client/index.mjs:1985](/Users/ccheever/projects/snapback/packages/snapback-client/index.mjs:1985)). The successful WebSocket upgrade rotates the server nonce, yet browser JavaScript cannot read its response header; queue release, open/error/cancel behavior, and resynchronization remain explicitly open ([llp/0077:783](/Users/ccheever/projects/snapback/llp/0077-sender-constrained-browser-auth.spec.md:783)). Until this is specified, a successful effect can be followed by stale-authority failure or unsafe retry. Define one closed HTTP/WebSocket state machine and test concurrent calls, dropped headers, upgrade success, cancellation, and reconnect.

5. **Major** — The proposed logout tombstone does not guarantee eventual safe custody deletion. It is retained only for LLP 0057’s short supersession-grace horizon; after expiry, the server returns generic `SESSION_EXPIRED` even though LLP 0059 says only an authenticated `durableDelete` disposition authorizes destructive local deletion ([llp/0077:595](/Users/ccheever/projects/snapback/llp/0077-sender-constrained-browser-auth.spec.md:595), [llp/0057:807](/Users/ccheever/projects/snapback/llp/0057-auth-provider-protocol.spec.md:807), [llp/0059:1475](/Users/ccheever/projects/snapback/llp/0059-session-projection-and-client-barrier.spec.md:1475)). A client offline longer than the tombstone can remain stranded indefinitely. Specify a durable authenticated recovery witness, a retention bound covering the full possible custody lifetime, or an anonymous key-bound recovery protocol with exact nonce and terminal-disposition rules.

6. **Major** — LLP 0077’s D3 ordering cannot satisfy LLP 0060 as written. It places the atomic “all applicable buckets” charge before token/family lookup, but LLP 0060 requires the family/user bucket whenever a credential resolves and requires one complete charge-on-denial transaction ([llp/0077:351](/Users/ccheever/projects/snapback/llp/0077-sender-constrained-browser-auth.spec.md:351), [llp/0060:315](/Users/ccheever/projects/snapback/llp/0060-hosted-auth-security.rfc.md:315)). The implementation has no shared D3 authority and also resolves `SessionAuth` before the forbidden-authority-field check ([src/auth/deployment.rs:283](/Users/ccheever/projects/snapback/src/auth/deployment.rs:283), [src/server.rs:8533](/Users/ccheever/projects/snapback/src/server.rs:8533), [src/server.rs:8853](/Users/ccheever/projects/snapback/src/server.rs:8853)). Resolve this by allowing bounded carrier classification/family lookup before the single limiter transaction, while keeping proof verification and body polling afterward.

7. **Major** — Issuance atomicity is normative but lacks an implementable authority boundary. A valid issuance proof must consume its `jti` even on wrong or exhausted codes, while successful proof consumption, code accounting, thumbprint binding, and session publication must be one transaction ([llp/0077:567](/Users/ccheever/projects/snapback/llp/0077-sender-constrained-browser-auth.spec.md:567), [llp/0057:715](/Users/ccheever/projects/snapback/llp/0057-auth-provider-protocol.spec.md:715)). Current rejection handling never installs the sender commitment ([src/server.rs:10695](/Users/ccheever/projects/snapback/src/server.rs:10695)). Pin a shared transactional provider interface—or restrict the first profile to co-located SQLite—and test wrong, locked, exhausted, racing, and crash outcomes.

8. **Major** — Diagnostic precedence contradicts both LLP 0057 and current behavior. LLP 0077 says it “composes” with LLP 0057 while changing malformed and unknown carriers from `AUTH_REQUIRED` to a sender challenge; LLP 0057’s delegation note only amends exchange, not this resolution matrix ([llp/0077:386](/Users/ccheever/projects/snapback/llp/0077-sender-constrained-browser-auth.spec.md:386), [llp/0057:768](/Users/ccheever/projects/snapback/llp/0057-auth-provider-protocol.spec.md:768), [llp/0057:1104](/Users/ccheever/projects/snapback/llp/0057-auth-provider-protocol.spec.md:1104)). Current code converts an absent header into an empty bearer and challenges it, while an unknown carrier with a present proof returns `_INVALID` without the promised nonce ([src/server.rs:8391](/Users/ccheever/projects/snapback/src/server.rs:8391), [src/auth/sender_proof.rs:757](/Users/ccheever/projects/snapback/src/auth/sender_proof.rs:757)). Add an explicit LLP 0057 amendment and a complete carrier × proof diagnostic matrix.

9. **Major** — The downgrade and independent-client contract is unfinished. The Spec admits that `AuthCustodyV3`, the sender-bound grant shape, and the WebSocket state machine are insufficient to build a second client, while the v1 token-syntax versus D6-barrier decision remains open ([llp/0077:789](/Users/ccheever/projects/snapback/llp/0077-sender-constrained-browser-auth.spec.md:789), [llp/0077:795](/Users/ccheever/projects/snapback/llp/0077-sender-constrained-browser-auth.spec.md:795)). LLP 0060 requires a closed version that cannot downgrade bound families ([llp/0060:840](/Users/ccheever/projects/snapback/llp/0060-hosted-auth-security.rfc.md:840)). Specify complete schemas, legacy-session and outstanding-grant draining, handler-first activation, coordinator-first rollback, and stale-client interleavings before acceptance.

10. **Moderate** — The reflected-material gap is only partially closed. The response nonce is installed before body parsing but is never added to the redaction set, contrary to the normative rule ([llp/0077:662](/Users/ccheever/projects/snapback/llp/0077-sender-constrained-browser-auth.spec.md:662), [packages/snapback-client/index.mjs:2715](/Users/ccheever/projects/snapback/packages/snapback-client/index.mjs:2715), [packages/snapback-client/index.mjs:2730](/Users/ccheever/projects/snapback/packages/snapback-client/index.mjs:2730)). The passing test reflects and checks the request nonce, not the successor response nonce, and it does not check decoded `ath` or `jti`, although token/proof hashes and proof ids are forbidden ([packages/snapback-client/sender-transport.test.mjs:235](/Users/ccheever/projects/snapback/packages/snapback-client/sender-transport.test.mjs:235), [packages/snapback-client/sender-transport.test.mjs:364](/Users/ccheever/projects/snapback/packages/snapback-client/sender-transport.test.mjs:364), [packages/snapback-client/sender-proof.mjs:73](/Users/ccheever/projects/snapback/packages/snapback-client/sender-proof.mjs:73), [llp/0077:718](/Users/ccheever/projects/snapback/llp/0077-sender-constrained-browser-auth.spec.md:718)). Add the validated response nonce and decoded sensitive fields before any callback/body read and test malicious reflection of each.

11. **Moderate** — Several implementation-checkpoint claims need qualification. The cross-language test is one positive Node-generated vector, not a browser or negative interoperability corpus ([tests/sender_proof_cross_language.rs:21](/Users/ccheever/projects/snapback/tests/sender_proof_cross_language.rs:21)). “Lost-response challenge recovery” is a synthetic typed challenge, not a successfully committed response that was actually dropped ([packages/snapback-client/sender-transport.test.mjs:261](/Users/ccheever/projects/snapback/packages/snapback-client/sender-transport.test.mjs:261)). The claimed refusal of “v3-only credentials at legacy startup” is not tested and appears false: generic `credentialFor` exposes the bearer without a format guard, and the non-sender client takes the ordinary bearer branch ([packages/snapback-contract/auth-coordinator.mjs:1046](/Users/ccheever/projects/snapback/packages/snapback-contract/auth-coordinator.mjs:1046), [packages/snapback-client/index.mjs:2048](/Users/ccheever/projects/snapback/packages/snapback-client/index.mjs:2048), [packages/snapback-contract/auth-sender-custody.test.mjs:183](/Users/ccheever/projects/snapback/packages/snapback-contract/auth-sender-custody.test.mjs:183)). Replace narrative claims with an evidence table distinguishing unit, router, bound-server, real-browser, and production-cut coverage.

12. **Moderate** — Status is honest locally but inconsistent across the corpus. LLP 0077 remains Draft and correctly claims no positive capability, yet Accepted LLP 0057 grants it precedence, Accepted LLP 0058 installs its route reorder, and LLP 0059 calls its custody shape “closed” even though 0077 says the complete schema is still open ([llp/0077:3](/Users/ccheever/projects/snapback/llp/0077-sender-constrained-browser-auth.spec.md:3), [llp/0057:8](/Users/ccheever/projects/snapback/llp/0057-auth-provider-protocol.spec.md:8), [llp/0058:8](/Users/ccheever/projects/snapback/llp/0058-shared-invocation-authority-and-staged-auth-mode-protocol.spec.md:8), [llp/0059:8](/Users/ccheever/projects/snapback/llp/0059-session-projection-and-client-barrier.spec.md:8)). Make those amendments conditional on 0077 acceptance/activation or advance the documents together after the contract closes.

5. **Suggestions**

- Separate the normative protocol into a compact state-machine/specification section and move the seven-round revision narrative and implementation checkpoint into an appendix or diary.

- Add explicit transition tables for nonce state, custody state, logout recovery, WebSocket upgrade, reset/restore, and v1→v2 activation. These relationships are presently distributed across prose and open questions.

- Consider keyed cover nonces such as `HMAC(server_secret, replay_epoch || token_digest || time_bucket)` for unresolved carriers. That can give repeated unknown carriers stable-looking challenges without installing database state.

- Consider distinct HTTP and WebSocket nonce lanes, or a bounded lease of single-use nonce tickets. Either avoids making an unreadable WebSocket response header the synchronization point for all subsequent HTTP work.

- Expand the RFC-deviation inventory. RFC 9449 uses the `DPoP` authorization scheme, `cnf.jkt`, and `WWW-Authenticate: DPoP ... use_dpop_nonce`; Snapback retains `Bearer`, stores binding in family state, and uses custom diagnostics. Those choices can be valid, but they are interoperability and downgrade deviations, not merely profile narrowings ([RFC 9449 §§6–9](https://www.rfc-editor.org/rfc/rfc9449.html#section-6)).

- Add real Chromium, Firefox, and WebKit reopen/logout tests. WebCrypto supports P-256 and structured-clonable `CryptoKey` handles, but also warns that structured-cloned handles cannot later be revoked by the source origin; the document should distinguish IndexedDB deletion from server-side key-family revocation ([WebCrypto security considerations](https://www.w3.org/TR/webcrypto/#security-developers)).

6. **Open questions**

- What durable mechanism guarantees `durableDelete` after an arbitrarily delayed lost logout response?

- Where exactly does `sender_replay_epoch` live, and what non-rollbackable authority ratchets it across restore/import?

- Is the first adapter restricted to one serialized SQLite authority, or must issuance and replay support a distributed transactional provider?

- What exact queue and nonce state follows WebSocket success, cancellation, inaccessible headers, and reconnect?

- What is the closed `BoundGrantAuthorityV2` shape, and which epoch participates in its equality and invalidation rules?

- Will v2 tokens be syntactically distinguishable from v1, or is the D6 activation barrier the sole downgrade defense?

- Are stable keyed cover nonces required for unknown carriers, or is the residual family-existence signal accepted?

- What complete `AuthCustodyV3` schema and public API allow an independent client without exposing a bearer-only legacy path?

- Does Snapback claim RFC 9449 interoperability, or only a documented DPoP-shaped private profile?

7. **Verdict**

Verdict: NOT READY

The design is strong in direction, but unresolved normative contradictions and confirmed replay, nonce, bare-grant, logout, throttle, migration, and diagnostic gaps must be closed before acceptance.
