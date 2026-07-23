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
