**Reviewer family:** Codex (OpenAI)
**Provider / runtime:** codex-cli 0.145.0, model gpt-5.6-sol, reasoning effort high, sandbox read-only, invoked non-interactively (`codex exec` with stdin from /dev/null) by the orchestrating Claude session running the /llp-review loop
**Date:** 2026-07-25
**Redacted:** no — repo-local review; blindness is instruction-based (self-attested): reviewer instructed not to read llp/reviews/, session scratchpads, or credential files, enforced additionally by read-only sandbox for writes but not reads
**Method:** codex exec, fresh session per round; prompt pinned the document sha256 and worktree HEAD

# LLP 0094 reviews — Codex family

## Round 1 — 2026-07-25

**Round record (persisted before launch):** target `llp/0094-wire-envelope-contract.spec.md` sha256 `5f577de54cdc903f74eaa701ef19f642c48c0de0f11e38e1490c49f1cf2c272d` (committed at worktree HEAD `137dee8c`, a checkout of origin/main including 2ff44077); topology: single-target loop, two families (Fable fresh subagent / Codex CLI `gpt-5.6-sol` at high effort), mutually blind, instruction-based blindness self-attested, both confined to a dedicated review worktree; shared instruction file sha256 prefix `a9a3ca72b5f68dd5`; known-state carve-outs in the instructions (B1–B4 unimplemented-by-design, hosted redeploy pending, §0A.5/§0E newly added) — reviewers told these are context, not findings; reviser: orchestrator.

**Revision under review:** sha256 `5f577de54cdc903f74eaa701ef19f642c48c0de0f11e38e1490c49f1cf2c272d` (MATCH per reviewer's own check; HEAD `137dee8c` MATCH)
**Runtime:** ~408 s (03:41:49–03:48:37 local)
**Verdict:** NOT READY — 3 Major, 3 Moderate, 1 Minor

### Review body (verbatim)

# Review: LLP 0094 — Wire envelope contract (Round 1)

## 1. Revision check

- Document SHA-256: `5f577de54cdc903f74eaa701ef19f642c48c0de0f11e38e1490c49f1cf2c272d` — **MATCH**
- Worktree HEAD: `137dee8c` — **MATCH**

## 2. Overall assessment

LLP 0094 is unusually strong where it is precise. The drain contract, staged negotiation rationale, local/hosted decoder asymmetry, typed receipts, and ownership-refusal clarification are grounded in the implementation and expose several facts a clean-room client genuinely needs. The migration under `/_snapback/*` is also accurately reflected in the current gateway, coordinator, harness, and local workerd listener.

However, the document claims a complete arm-by-route and DTO closure contract while omitting or mischaracterizing several served wire families. Most importantly, existing hosted success and error responses do not conform to the Rust-generated schemas that the document declares authoritative. Those are current code facts, not unimplemented B1–B4 work.

The negotiation design also leaves connection re-open/rebinding and socket-offer error classification insufficiently decided. These ambiguities would force independent server implementations to invent materially different behavior at precisely the compatibility boundary this Spec is intended to pin.

## 3. Strengths

1. **The drain shape is precise and code-accurate.** §0A.5 correctly identifies the bare JSON array returned by `src/server.rs::drain_outbox`, including the single durable `resync_required` envelope for `admitted.is_none()`, `reason: "unknown_or_reaped"`, no subscription id, and `clear_retained: true` (`src/server.rs:19045-19157`). It also correctly describes `retain_realtime_handoff_in` as the ownership-transfer cut and the absence of a client ACK route.

2. **The hosted system-route migration is accurately audited.** §0A.3 matches `cloudflare/src/gateway.js` and `cloudflare/src/coordinator.js`: cron, config, reset, eviction, host-call, and testing paths now live under `/_snapback/*`; the gateway reserves that namespace from asset fallback; and `src/workerd_exec.rs` plus `packages/snapback-harness/workerd/handler-server.mjs` use `/_snapback/host-call`. The existing admin, testing, and per-invocation gates remain distinct.

3. **The receipt typing change is correctly implemented.** §0D matches `src/local.rs::LiveSubscribeOutput` and `LiveUnsubscribeOutput`, whose fields are now `Option<Receipt>`. Both emission paths construct `Receipt::Subscription` and convert only the retention-ring copy with `into_value()`. The regenerated subscribe and unsubscribe schemas reference the closed `Receipt` union.

4. **The local/hosted decoder asymmetry is recognized rather than hidden.** §§0B.5, 0B.6, and 0C.3 correctly distinguish the local closed `OpenConnectionRequest` from hosted `kitOpenConnection`, which currently ignores unknown members. That distinction is essential to a safe staged rollout.

5. **The live-ownership clarification is well grounded.** §0E correctly traces `SNAPBACK_LIVE_RESUME_OWNERSHIP` through unsubscribe, replacement, reattach, and manual retry via `src/local.rs::live_owner_mismatch`, with identity comparison ultimately grounded in retained authority matching.

## 4. Concerns

1. **(Major) Shared-route hosted responses contradict the schemas and arm-uniform shapes asserted by the Spec.**

   The current hosted arm emits several payloads that are not instances of the declared authoritative schemas:

   - `cloudflare/src/coordinator.js::kitMutation` returns `{version, changed_count, result}` at lines 4373–4380, while `schemas/mutation.output.schema.json` requires `receipt` and is closed.
   - `kitUnsubscribe` returns only `{removed: true}` at lines 4481–4499, while `live.unsubscribe.output.schema.json` requires `subscription_id` and `disposed`.
   - `kitError`/`kitFailure` at lines 5543–5553 emit diagnostics containing only `code`, `message`, and sometimes `details`; `error.response.schema.json` requires `code`, `severity`, `subsystem`, `message`, and `details`.
   - Locally, `src/server.rs::FunctionResponse<T>` can flatten an `attribution` member onto a `MutationResponse`, while the closed `mutation.output.schema.json` does not admit `attribution`.

   This conflicts with §0A's unqualified shared route rows, §0E's statement that negotiation refusals use `error.response.schema.json`, and §0F's claim that everything else client-visible is schema-governed. A schema-driven native decoder can therefore work against local and fail against hosted on the same named route.

   **Resolution:** Either align both arms' success and error bytes to shared schemas and add executable hosted response-schema gates, or define explicit per-arm response families with committed schemas and mark every differing route in §0A. The Spec's precedence rule must also account for JS-authored hosted bytes rather than declaring only Rust serde ground truth.

2. **(Major) The purported complete DTO closure matrix is not complete enough to support its evolution claims.**

   §0C says its scope is "every wire family of the §0A matrix, both directions," but it omits, among others, `ConnectionGrant`, `ErrorResponse`, mutation output, query and action outputs, app ensure and bundle DTOs, authorized-lease DTOs, client-mutation acknowledgement DTOs, and the HTTP ephemeral request/outcome families. `src/schema_export.rs:146-329` exports many of these; `src/ephemeral.rs::PublishRequest`, `DeleteRequest`, `SubscribeRequest`, and their outcomes are served but have no standalone route-schema rows here. The omissions conceal the concrete divergences in Concern 1.

   The governing LLP 0093 D1 also requires P-0 to include a named dev-mode posture explaining what is accepted without an auth handshake. LLP 0094 has auth labels in the route matrix but no such implementer-facing section.

   **Resolution:** Replace §0C with an exhaustive route × direction × arm × auth-mode inventory. Every row should name the actual decoder/emitter symbol, committed schema or explicit schema gap, closure posture, aliases, and fallback/gating rule. Add LLP 0093's required dev-mode posture or explicitly amend the governing RFC if that obligation has moved.

3. **(Major) Re-open rebinding is incompatible with a single connection-scoped binding unless grant-generation behavior is defined.**

   §0B.3 says the version is bound once at open, but then says a `previousToken` re-open may change the offer and "re-bind," while not mutating a live socket's binding. Current local reuse preserves the same connection id, token, and opaque grant id (`src/server.rs::ConnectionRegistry::open_prepared`, lines 4650–4705). Hosted reuse likewise returns the same id and token (`kitOpenConnection`, lines 4212–4216). Neither open path necessarily retires an already-live socket.

   Consequently, the Spec does not say which version governs subsequent HTTP requests, existing subscriptions, server-pushed envelopes, and a later socket if the same grant is re-opened with a different offer. Capturing an old version on the existing socket while changing the connection record creates two versions inside something the Spec calls one connection-scoped surface.

   **Resolution:** Make the wire version immutable for an existing grant generation and require an exact match on idempotent re-open, or define rebinding as a generation transition that retires/replaces the prior socket and subscriptions before publication. Pin the refusal code and acceptance fixtures for a changed offer under `previousToken`.

4. **(Moderate) Socket-offer parsing, refusal classification, and rollout timing are internally ambiguous.**

   §0B.4 says an upgrade with "no known" token gets `SNAPBACK_WIRE_VERSION_REQUIRED`, but also says a present malformed offer never falls through to absent. §0E defines `UNSUPPORTED` only for `/connection/open`, leaving no result for a socket offering only `snapback.v2`, a malformed wire token, duplicate tokens, or multiple distinct wire tokens. It also lists `MISMATCH` as active at B1+, while §0B.5 says socket refusal is enabled at B3.

   **Resolution:** Specify the exact socket token grammar and precedence for absent, malformed, unknown, duplicate, multiple-known, and known-plus-unknown offers, including the bearer subprotocol's exclusion from version classification. Assign one refusal code to each class and state whether all socket equality/refusal enforcement begins at B3 or whether a defined subset begins at B1.

5. **(Moderate) The B4 consumer inventory is stale at the review HEAD.**

   §0B.7 says the kit is the only in-repo constructor of the open body apart from hosted-suite and Rust test callers. At `137dee8c`, `clients/swift/SnapbackClient/Sources/SnapbackClient/SnapbackClient.swift:90-128` directly constructs `/connection/open` bodies, including `wireVersion`, and owns its own fallback behavior. This new caller is compliant today, but it invalidates the supposedly enumerable B4 gate population.

   **Resolution:** Add the Swift client and all direct open-body test/harness constructors to the recorded population. Prefer a reproducible search or static gate that fails when a new direct caller is added without an explicit B4 classification.

6. **(Moderate) The "complete" route matrix omits served hosted proof routes.**

   The hosted gateway forwards root `/query` and `/mutation`, and the coordinator serves `/query`, `/mutation`, and `/live/stream` before the kit routes (`cloudflare/src/gateway.js:42`; `cloudflare/src/coordinator.js:1695-1709`). §0B.4 and §0F acknowledge the proof socket, but §0A's normative rule says a route absent from an arm's column is not served. The local system surface is likewise incorporated only by reference despite the summary's claim that admin/testing seams are included per arm.

   **Resolution:** Add explicit rows for the hosted proof routes marked "served, frozen proof protocol, outside wire v1," or narrow §0A's completeness and absence rule to a precisely defined route domain. Represent the referenced local system surface in a way that cannot be read as absent.

7. **(Minor) Hosted legacy detection is described using an echo that does not exist as a distinguishing witness.**

   §0B.6 calls hosted detection "absence-of-echo," but §0B.3 leaves the open response unchanged, and the pre-B1 hosted socket already echoes `snapback.v1` when offered (`acceptKitSocket`, line 4600). The following sentence correctly says the client cannot distinguish pre-B1 from B1, so the "absence-of-echo" phrase is misleading.

   **Resolution:** State plainly that hosted pre-B1 detection is impossible from current response/socket bytes and relies exclusively on deployment gating, or add a bound-version response witness and define its bootstrap semantics.

## 5. Suggestions (non-blocking)

1. Generate the route/DTO inventory from the local route registry, `schema_export`, and an explicit hosted-route manifest so omissions become reviewable diffs.

2. Add fixture names for every negotiation branch, especially changed-offer re-open, unknown socket token, duplicate token, malformed token, and hosted full diagnostic-envelope validation.

3. Prefer symbol-only citations where line drift is already substantial. Examples include `LIVE_STREAM_SUBPROTOCOL`, `kitOpenConnection`, and `acceptKitSocket`; their facts remain identifiable while the cited courtesy lines have moved.

4. Turn B1–B4 into a table with server behavior, client behavior, enabled refusals, deployment prerequisite, and rollback posture per stage.

## 6. Open questions for the author

1. Are common route names intended to have arm-neutral response schemas? If not, where are the authoritative hosted schemas and how does a native client select them?

2. Is `wireVersion` intended to be immutable per grant, per connection id, or per socket session?

3. Are `/query`, `/mutation`, and `/live/stream` intentionally excluded from §0A, despite the matrix's current completeness and absence language?

4. Does hosted rollout intentionally provide no runtime witness that B1 bound the open-time offer, or should `wireVersion` be echoed in `ConnectionGrant`?

## 7. Verdict

**NOT READY** — the document cannot yet serve as the normative high-stakes wire contract because existing hosted success and error bytes contradict its schema-authority claims, the closure and route inventories are materially incomplete, and changed-offer re-open semantics are not coherently defined for a connection-scoped version binding. These are Major correctness, completeness, and decision-quality concerns within this Spec's P-0 scope; they are independent of the acknowledged unimplemented B1–B4 stages.

## 8. Blindness self-attestation

I did not read any `llp/reviews/` content, unrelated session scratchpads, `.agent-local-secrets.md`, or credential material, and I made no worktree modifications.
