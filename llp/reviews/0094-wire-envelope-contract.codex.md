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

## Round 2 — 2026-07-25 (delta round)

**Round record (persisted before launch):** target revision v0.2 sha256 `35e10c02602b1a0325a21dad705aa39ca20463a3d83adb10231958a8d767ff6d` at worktree HEAD `bc02ec85`; delta round — instructions enumerate the v0.1→v0.2 delta (15 items) and require [IN-DELTA] vs [PRE-EXISTING] classification on every concern; topology unchanged (Fable fresh subagent / Codex CLI `gpt-5.6-sol` high effort, mutually blind, instruction-based blindness self-attested, confined to the review worktree); shared instruction file sha256 prefix `ae563a61bf0901cf`; reviser: orchestrator. Growth-budget note: v0.2 is 751 lines vs 543 entering the loop (+38%; overage driven by Round-1 Major resolutions and the LLP 0093-mandated dev-mode section — disclosed in the revision commit).

**Revision under review:** sha256 `35e10c02602b1a0325a21dad705aa39ca20463a3d83adb10231958a8d767ff6d` (MATCH per reviewer's own check; HEAD `bc02ec85` MATCH)
**Runtime:** ~460 s (04:04:31–04:12:11 local)
**Verdict:** NOT READY — 4 Major + 1 Moderate, all [IN-DELTA]

### Review body (verbatim)

# Review: LLP 0094 — Wire envelope contract (Round 2, delta)

## 1. Revision check

- Document SHA-256: **MATCH** — `35e10c02602b1a0325a21dad705aa39ca20463a3d83adb10231958a8d767ff6d`
- Worktree HEAD: **MATCH** — `bc02ec85`

## 2. Overall assessment

Revision v0.2 materially improves the route-domain definition, dev-mode posture, staged negotiation, blast-radius record, and treatment of known response divergences. However, four Major contract inconsistencies remain in delta-touched sections. Most importantly, the re-open/echo rules do not define one coherent state machine, the DTO matrix misclassifies `/app/ensure`, and the hosted wire inventories remain incomplete or inaccurate. The known unimplemented B1–B4 stages and pending redeploy do not drive this assessment.

## 3. Strengths (delta-focused)

- §0A.0 now bounds the route matrix clearly and prevents omission from being confused with incorporation by reference. The proof routes in §0A.1 match `cloudflare/src/gateway.js` and `coordinator.js`.
- §0A.6 accurately distinguishes dev body-auth assertions from connection capability authentication, consistent with LLP 0031’s route matrix and `src/server.rs`.
- §0B.5–§0B.7 substantially improve rollout safety: present-offer versus absent-offer enforcement is staged separately, non-kit early offering is acknowledged, and the Swift population is included in the B4 re-audit.
- §0B.6’s exact local decode-class signal correctly identifies `SNAPBACK_REQUEST_JSON_INVALID` from `parse_optional_json` / `ApiError::request_json_invalid`, and appropriately tickets the Swift client’s broader heuristic.
- §0C.6 adopts the right high-level posture: served/schema disagreements are defects, not evolution precedents, and temporary tolerance is narrowly scoped.
- §0D’s receipt typing is supported by `LiveSubscribeOutput` and `LiveUnsubscribeOutput` in `src/local.rs` and their regenerated schemas.

## 4. Concerns

1. **(Major) [IN-DELTA] The re-open, response-echo, legacy-eligibility, and B4 rules do not form a deterministic state machine.**

   Evidence: `llp/0094-wire-envelope-contract.spec.md` §0B.3 says a fresh absent offer creates a legacy lineage with no echo; an absent re-open preserves the existing binding; and a present `snapback.v1` on a legacy lineage confirms but never upgrades it. Yet the same offer table says a known offer receives a `wireVersion` echo, while §0B.6 defines echo present as bound and echo absent as legacy. Therefore:

   - an explicitly bound lineage re-opened without an offer has no defined echo behavior;
   - a legacy lineage re-opened with `snapback.v1` either receives an echo that falsely suggests non-legacy eligibility, or violates the known-offer echo rule;
   - §0B.4/B4 says an absent open refuses, while §0B.3 says an absent re-open preserves the lineage, without stating whether B4 exempts authenticated re-opens;
   - an unknown token on re-open is both “unknown” (`UNSUPPORTED`) and a “changed offer” (`MISMATCH`), with no precedence rule.

   The current implementations make this distinction load-bearing because `ConnectionRegistry::open_prepared` in `src/server.rs` and `kitOpenConnection` in `cloudflare/src/coordinator.js` return the same live grant on a valid `previousToken`.

   **Resolution:** Add a normative re-open matrix crossing lineage state (explicitly offered versus legacy), request offer (known-equal, known-different, unknown, absent), and stage (B1 versus B4). Specify persisted lineage state, echo presence, open-time-gated eligibility, refusal-code precedence, and whether B4 permits absent authenticated re-opens.

2. **(Major) [IN-DELTA] The expanded DTO matrix incorrectly classifies `/app/ensure` requests and responses as open.**

   Evidence: §0C.1 labels the `/app/ensure` intent body open, but the local family is deliberately closed: `EnsureAppInput` and every `EnsureAppExplicitInput` variant use `deny_unknown_fields`, and `EnsureAppRequest` is documented as a closed family in `src/local.rs`. `schemas/app.ensure.input.schema.json` likewise describes a closed family.

   §0C.2 groups `/app/ensure` outputs with `/app/bundle` as open additive-optional objects. In fact, `EnsureAppAttestOutcome`, `EnsureAppProvisionOutcome`, and legacy `EnsureAppOutcome` all use `deny_unknown_fields`; their definitions in `schemas/app.ensure.output.schema.json` set `additionalProperties: false`. Hosted `kitEnsureApp` is open, but §0C.1 explicitly presents its decoder column as the local-arm fact.

   This is not editorial: it incorrectly sanctions ungated additive evolution for a closed family.

   **Resolution:** Split `/app/ensure` from `/app/bundle` in both directions. Record local ensure request and emission families as closed, hosted ensure decoding as open under §0C.3, and apply the closed-family gating/version rule to ensure-output additions.

3. **(Major) [IN-DELTA] §0C.6’s “every audited place” error-envelope ledger is incomplete, making its tolerate-only-these-shapes rule false.**

   Evidence: item 3 names only `kitError` and `kitFailure`. Other in-domain hosted paths emit additional non-schema shapes:

   - `parseJsonObjectRequest` is used for all kit JSON routes and returns `requestDiagnostic`; that function emits top-level `ok`, `code`, and `message` alongside an under-filled `diagnostic`, violating both `ErrorResponse`’s closed outer object and required inner fields.
   - `cloudflare/src/gateway.js` method refusals for kit routes emit an under-filled diagnostic.
   - the kit-stream non-upgrade branch emits `{error: "expected websocket upgrade"}`.
   - `platformFailureResponse` emits another under-filled diagnostic family on kit routes.

   These bytes are reachable on §0A.1 routes, but §0C.6 instructs clients to tolerate only its enumerated deviations.

   **Resolution:** Audit every gateway, coordinator parsing, platform-failure, and route-handler error emitter reachable within §0A’s domain. Either converge them with the existing ticket or enumerate each precise temporary exception. Add schema assertions for malformed body, wrong method, missing upgrade, platform failure, handler failure, and ordinary coded refusal.

4. **(Major) [IN-DELTA] The revised hosted kit-socket reply grammar is still inaccurate.**

   Evidence: §0F item 2 and the amended marker-envelope ticket characterize kit replies as `kind`-tagged. Actual `Coordinator.subscribe` behavior is mixed:

   - resume success uses `kind: "current_as_of"` for kit sockets;
   - ping uses `kind: "pong"`;
   - an ordinary successful in-band subscribe still emits `type: "snapshot"`;
   - subscribe failures emit `type: "error"`;
   - in-band unsubscribe performs a session-scoped delete but emits no acknowledgement.

   Thus `validateLiveSocketFrame` does serve both request populations, but the response grammar is neither uniformly `kind`-tagged nor fully inventoried by operation/outcome. Schema work following §0F as written would encode the wrong protocol.

   **Resolution:** Add a request × outcome × socket-population table for `subscribe`, `unsubscribe`, and `ping`, including fresh snapshot, `current_as_of`, every error, and no-response behavior. Decide explicitly whether to contract the mixed as-built grammar or converge it first, then make the ticket and schema gates match that decision.

5. **(Moderate) [IN-DELTA] The socket-token classifier gives contradictory definitions for malformed version tokens.**

   Evidence: §0B.4 defines a wire-version-shaped token as matching `snapback.v<digits>`, but immediately says a present malformed `snapback.v*` token classifies as unknown rather than absent. Values such as `snapback.vx` or `snapback.v1.0` do not match the stated shape, so implementations can legitimately choose either `WIRE_VERSION_REQUIRED` or `WIRE_VERSION_UNSUPPORTED`.

   **Resolution:** Define one executable predicate and precedence algorithm—for example, reserve every valid WebSocket token beginning `snapback.v` as a version candidate, recognize exact supported tokens within that namespace, and classify all other candidates as unknown. Add boundary fixtures for malformed suffixes, unrelated subprotocols, bearer tokens, duplicates, and mixed known/unknown sets.

## 5. Suggestions (non-blocking)

- Move struck-through OQ2 into a short decision log so “Open questions” contains only unresolved choices.
- Generate or validate the DTO closure table mechanically against the serde/schema inventory; the `/app/ensure` error is exactly the drift such a check should catch.
- Give each §0C.6 exception an explicit removal condition and acceptance-test name, making the temporary conformance qualification easy to retire.
- Include negative remote probes for the retired hosted root routes, as proposed in OQ4.

## 6. Open questions for the author

1. Is `wireVersion` echo intended to witness the lineage’s original explicit offer, the current request’s offer, or merely the bound token? Those meanings differ on re-open.
2. Should the mixed hosted in-band socket replies be preserved as wire v1, or should the coordinator converge them to one dialect before schema commitment?
3. Is `error.response.schema.json` intended to govern every pre-upgrade and HTTP failure on kit routes, including gateway and JSON-parser refusals? The current prose implies yes, while the ledger audits only a subset.

## 7. Verdict

**NOT READY** — v0.2 closes many round-1 gaps, but the re-open negotiation contract remains internally underdetermined, the expanded closure matrix makes a materially wrong evolution decision for `/app/ensure`, and the hosted response and socket inventories are not complete enough to serve as a clean-room P-0 contract. These are unresolved Major correctness and coherence issues introduced or touched by the delta; the deliberately unimplemented stages and pending deployment are not reasons for this verdict.

## 8. Blindness self-attestation

I did not read anything under `llp/reviews/`, other scratchpad files, secrets, API-key material, or credential files, and I made no filesystem modifications.
