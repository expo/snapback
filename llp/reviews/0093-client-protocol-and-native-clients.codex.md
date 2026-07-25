**Reviewer family:** Codex (OpenAI)
**Provider / runtime:** codex-cli 0.145.0, model gpt-5.6-sol, reasoning effort high, sandbox read-only, invoked non-interactively (`codex exec` with stdin from /dev/null) by the orchestrating /llp-super-refine Claude session
**Date:** 2026-07-24
**Redacted:** no — repo-local review; blindness is instruction-based (self-attested): reviewer instructed not to read llp/reviews/, session scratchpads, or credential files, enforced additionally by read-only sandbox for writes but not reads
**Method:** codex exec, fresh session per round; prompt pinned the document sha256 and repo HEAD

# LLP 0093 reviews — Codex family

## Round 1 — 2026-07-24

**Round record (persisted before launch):** target `llp/0093-client-protocol-and-native-clients.rfc.md` sha256 `e3fc8abcc501314da4e64d6a4dba12bcff5c623c864afb860ca27013919b8e7f` (untracked working-tree file at HEAD `33705541`); topology: single-target loop, two families (Fable subagent / Codex CLI `gpt-5.6-sol` at high effort), mutually blind, instruction-based blindness self-attested; shared instruction file sha256 prefix `9da0667e5b8f92a1`; reviser: orchestrator. Runtime recorded on receipt.

**Launch note:** the first `codex exec` launch was killed mid-review by an orchestrating-session restart (~210 KB of exploration logged, no final message produced; recorded, not counted). Relaunched fresh with identical instructions against the unchanged target hash — verified `e3fc8abc…` after restart. Round unchanged.

**Revision under review:** sha256 `e3fc8abcc501314da4e64d6a4dba12bcff5c623c864afb860ca27013919b8e7f` (untracked working-tree file at HEAD `33705541`; both MATCH per the reviewer's own revision check)
**Runtime:** relaunch leg completed 22:28 local (started ~22:21); interrupted first leg excluded
**Verdict:** NOT READY

### Review body (verbatim)

## Revision check

- Document SHA-256: `e3fc8abcc501314da4e64d6a4dba12bcff5c623c864afb860ca27013919b8e7f` — **MATCH**
- Repository HEAD: `33705541` — **MATCH**

## Overall assessment

The RFC identifies a real, well-supported product gap and chooses a sensible delivery strategy: document the existing protocol, build conformance fixtures, and prove the document with one clean-room Swift implementation before multiplying SDKs. Most repository claims are accurate, including the mixed casing, HTTP wrapper versus unwrapped socket payloads, server-selected delta/replace behavior, liveness constants, outbox bounds, and demand-armed cron consequences.

It is not ready because several direction-level contracts conflict with the code or governing LLPs. Most importantly, wire-v1 negotiation is not enforceable as described; the proposed cumulative auth class contradicts LLP 0059’s independent capability axes; `resume_live` reopens a decision LLP 0090 already made; and Class P blesses a billing-visible demand lifecycle without requiring clients to release that demand. These are not missing byte-level details for follow-on Specs—they are defective or unresolved decisions in this RFC.

## Strengths

1. The corrected demo evidence is unusually candid and useful. The distinction between the chat matrix’s gateway protocol and Snapback’s actual wire, and the correction from “2-second polling” to the real 700 ms and 1.5 s cadences, are supported by the cited code and avoid building the proposal on a false anecdote (§“The corrected demo evidence,” lines 56–86).

2. The lifecycle motivation is materially important and well grounded. The RFC correctly identifies subscription as a demand signal capable of arming `WhileLive` jobs, with hosted billing consequences (§“The warm-poll leakage,” lines 88–107; D3, lines 244–255). LLP 0049 and both local and Cloudflare implementations support this characterization.

3. The inventory captures most of the existing protocol’s non-obvious facts accurately: mixed casing, wrapped HTTP versus unwrapped WebSocket durable payloads, connection-wide overflow resync, server-selected delta/replace behavior, open-string resync reasons, and the shipped heartbeat/backoff constants (§“What exists today,” lines 124–176).

4. “Spec + fixtures + one proving client” is a strong sequencing choice. Building Swift from the specification and treating every source-code lookup as a specification defect is a credible way to test whether the external-implementer view is real (D4, lines 271–283).

5. The RFC generally draws a useful boundary around LLP 0051: this proposal owns remote protocol interoperability, while LLP 0051 retains local execution, mutation IR, and WASM concerns (D5, lines 293–298). Deferring Kotlin and Dart until the contract survives Swift is also justified by the maintenance evidence.

## Concerns

1. **(Major) The wire-v1 evolution and negotiation policy is internally inconsistent and cannot currently enforce its promised refusals.** D1 declares new envelope kinds additive within v1, requires clients to ignore unknown kinds and fields, and says incompatible changes mint `snapback.v2` (lines 190–205). But the generated envelope schemas are closed `oneOf` unions over known kinds, some nested objects reject unknown fields, and a generated Swift enum will ordinarily fail on an unknown variant. LLP 0091 explicitly recognizes this: `CurrentAsOf` is *not* old-decoder tolerant and is safe only because the request proves capability (`origin/main` LLP 0091 lines 416–444). Moreover, the server merely echoes `snapback.v1` when offered (`src/server.rs:16419–16424`); it does not require the offer, while the RFC defaults Class P to no HTTP version carrier. Thus neither lane can reliably refuse an incompatible peer or select v2.

   **Resolution:** Decide the transport handshake at RFC level. Require and validate a v1 offer on WebSocket, and either add an HTTP protocol carrier or bind an exact protocol version during `/connection/open`. Define missing/unknown-offer refusal. Limit ungated v1 evolution to genuinely optional fields; require capability negotiation or a new version for new variants whose semantics are not provably ignorable. Reconcile this policy with the schemas and LLP 0091.

2. **(Major) The cumulative P/L/A taxonomy contradicts LLP 0059’s independent auth axes and excludes authenticated poll-only clients.** D2 says the classes are cumulative and defines Class A as Class L plus all four auth capability axes (lines 212–231). Accepted LLP 0059 §“Independent item-5 availability axes” explicitly requires online request/response, auth-scoped live, queued replay, and retained reads to remain independently negotiated (`llp/0059...:2298–2326`). A poll-only native surface can authenticate without implementing WebSocket live transport, and a live client need not implement authorized retained reads. P-3 also contradicts D2 by leaving open which of the four axes a native client must offer (lines 311–313).

   **Resolution:** Make P/L a transport axis and define auth features as orthogonal profiles or capability claims: authenticated request/response, invalidation-safe auth-scoped live, authority descriptors/queued replay, authorized leases/retained reads, and sender-constrained custody. State how these compose with LLP 0012’s Online/Parity classifications.

3. **(Major) The RFC reopens `resume_live` despite LLP 0090 already deciding its fate.** D3 and Open question 1 say the route must either be adopted or retired and characterize it as overlapping RQS reattach (lines 256–262, 315–318). Accepted LLP 0090 instead explicitly keeps the existing subscription-id reattach route and token resume as disjoint mechanisms (`llp/0090...:360–374`). Origin/main’s LLP 0091 then specifies their dispatch order and keeps reattach local-arm-only in v1 (lines 469–525).

   **Resolution:** Remove the retire/adopt open question and cite LLP 0090/0091’s decided split: reattach continues a server-retained subscription; token resume seeds a new subscription from client-held state. If retirement is intended, explicitly amend LLP 0090 and the corresponding LLP 0034/0031 contracts.

4. **(Major) Class P creates billing-visible demand but has no conformance obligation to release it.** Class P requires opening a connection, subscribing, and draining on a declared cadence, but says nothing about unsubscribe, disposal, backgrounding, crash recovery, overlapping drains, or cessation (lines 217–224). D3 correctly says subscriptions can arm hosted cron work until unsubscribe, socket close, or connection purge (lines 248–255), but a poll client has no socket-close teardown. The local idle purge is 120 seconds (`src/server.rs:14013`), which also makes the claim that widget-style Channel C consumers “need” a persistent drain lane questionable: ordinary widget refresh cadences exceed that lifetime and are better served by LLP 0090/0092’s state-free bundle read.

   **Resolution:** Make bounded demand ownership part of Class P/L conformance: explicit unsubscribe on normal shutdown/backgrounding, defined crash/purge behavior, one drain owner, non-overlapping drains, bounded cadence with retry/backoff, and a rule preventing abandoned subscriptions from indefinitely arming work. Separate persistent outbox polling from Channel C’s one-shot bundle-fetch use case.

5. **(Moderate) The RFC’s “destructive drain” description is stale and materially misleading for retry behavior.** Lines 159–160 say the server dequeues before the client sees the batch. Accepted LLP 0059 instead specifies leased selection without removal, acknowledgement only at the ownership-transfer cut, and retention/release on cancellation or failed transfer (`llp/0059...:1415–1479`). The drain is destructive from the client’s perspective after acknowledgement, but it is not pre-dequeued as stated.

   **Resolution:** Describe the exact ownership cut: leased selection, HTTP acknowledgement at first-body transfer, removal only after acceptance, and possible redelivery when cancellation occurs before that cut. Add conformance fixtures around cancellation and duplicate-tolerant delivery.

6. **(Moderate) The existing exact-byte tests are not a complete or directly generatable fixture authority.** The Summary and D1 imply comprehensive exact-byte coverage, and D2 proposes generating fixtures from it (lines 17–22, 182–188, 233–238). `src/live_wire.rs:394–616` covers durable envelopes, selected socket frames, the request-id alias, and receipts, but not every client-visible schema. `RealtimeEnvelope` is defined in `src/ephemeral.rs`, and broader coverage currently lives in schema round-trip instances. Rust test assertions are also not themselves a machine-readable fixture source.

   **Resolution:** Name the serde types plus committed schemas as the shape authority, define precedence if prose/schema/tests disagree, and create an explicit fixture corpus—possibly generated from `artifact_instances()`—covering every conformance class and transition. Characterize today’s exact-byte tests as representative until that corpus exists.

7. **(Moderate) The Channel C justification conflates snapshot bundles with persistent polling.** Lines 49–52 use LLP 0090 Channel C consumers to justify blessing `/outbox`. LLP 0090 defines Channel C as fetched snapshot bundles, and LLP 0092 distinguishes state-free `read` mode from time-bounded `register` mode with attach/reaping. Neither says socket-constrained surfaces should maintain an outbox-drain subscription.

   **Resolution:** Justify the poll lane from its existing fallback/test utility, or explicitly propose and reconcile a persistent Channel C poll profile with LLP 0090/0092. Do not imply that all widgets/extensions need it.

## Suggestions (non-blocking)

- Correct the inventory attribution: `RealtimeEnvelope` is defined in `src/ephemeral.rs`, not `src/live_wire.rs`.
- Avoid calling LLP 0064’s exact-token rule “ratified”; LLP 0064 is currently Draft.
- Clarify that the `request_id` alias applies to `LiveSocketClientMessage.requestId`, not generically to every envelope.
- Require first-party native clients to carry connection grants in headers; treat the query-parameter token accepted by `/outbox` as a constrained compatibility path because URLs are commonly logged.
- Rephrase the guide claim. LLP 0061’s GAP rows primarily track existing author-facing capabilities lacking pages; absent Kotlin/Dart products are product gaps unless the capability index deliberately expands to roadmap non-capabilities.
- Add conformance cases proving one malformed or unknown item cannot abort processing of the remainder of an already acknowledged HTTP batch.

## Open questions for the author

1. Is P/L intended to describe transport only, with authentication and offline capabilities orthogonal, or is A intentionally a monolithic SDK tier?
2. Does this RFC intend to amend LLP 0090’s accepted reattach decision? If not, why is `resume_live` still open?
3. Are future envelope kinds guaranteed to be semantically ignorable, or should all new kinds be request/capability-gated as LLP 0091 does for `CurrentAsOf`?
4. Which Swift host is the proving target: a foreground iOS app, a background-capable app, or a widget/extension? Their viable demand and polling lifecycles differ substantially.

## Verdict

NOT READY — The direction is strong, but version negotiation, auth capability composition, reattach scope, and poll-demand teardown contain unresolved material defects.

## Round 2 — 2026-07-24 (delta round)

**Round record (persisted before launch):** target revision v0.2 sha256 `573c030a6498c3aaef3b8ef9403c283dfc918ce042c4b53a378db4761ec383e8` at HEAD `33705541`; delta round per LLP 0010 §2 addendum — instructions enumerate the v0.1→v0.2 delta (12 items) and require IN-DELTA vs PRE-EXISTING classification on every concern; topology unchanged (Fable fresh subagent / Codex `gpt-5.6-sol` high effort, mutually blind, instruction-based blindness self-attested); instruction file sha256 prefix `f12f15b4a45c3f29`; reviser: orchestrator. Growth-budget note: v0.2 is 462 lines vs 302 entering the loop (+53%, over the ~20% guideline; overage driven by Round-1 Major resolutions — disclosed here and in the final report).

**Revision under review:** sha256 `573c030a6498c3aaef3b8ef9403c283dfc918ce042c4b53a378db4761ec383e8` (MATCH per reviewer's own check; HEAD `33705541` MATCH)
**Verdict:** NOT READY — 2 Major + 1 Moderate + 1 Minor, ALL classified [IN-DELTA]; no PRE-EXISTING MATERIAL concern reported

### Review body (verbatim)

## 1. Revision check

**MATCH.**

- Document SHA-256: `573c030a6498c3aaef3b8ef9403c283dfc918ce042c4b53a378db4761ec383e8`
- Repository HEAD: `33705541`

## 2. Overall assessment

The RFC identifies a real adoption gap and proposes a strong spec-first remedy: explicit transport classes, capability-gated evolution, cross-language fixtures, lifecycle obligations, and a clean-room Swift implementation.

It is not ready because two revised decisions do not yet describe an implementable, coherent contract. Class P cannot operate on the current hosted arm, despite the RFC requiring per-arm conformance, and the new HTTP version-binding decision neither defines a single refusal policy nor reaches all routes included in the client protocol. The normative testing seams also remain incorrectly arm-uniform.

## 3. Strengths

1. The motivation carefully corrects the demo record instead of building the proposal on the earlier polling claim, while preserving the legitimate conclusion that no supported non-JS client path exists (lines 65–96).

2. The inventory is unusually useful for a direction RFC. It records route asymmetry, mixed casing, HTTP wrapping, leased-drain ownership, reconnect behavior, server-selected delta strategy, aliases, and liveness constants (lines 136–201).

3. The evolution policy makes the important distinction between ignorable optional additions and capability-gated new kinds, and correctly treats unknown-kind tolerance as defense-in-depth rather than permission for ungated emission (lines 231–248).

4. Separating transport classes from auth profiles is the right response to LLP 0059’s independent capability axes. The planned negative fixtures and per-arm claims provide a credible route to cross-language conformance rather than documentation-only compatibility (lines 263–321).

5. The RFC elevates demand ownership and billing-visible subscription effects into client obligations, while preserving the distinction between subscription reattach and token-based query-state resume established by LLP 0090 and origin/main’s LLP 0091 (lines 287–295 and 327–359).

6. The Swift proving-client discipline is well chosen: a foreground application, built from the specification and fixtures, with every JS-source dependency treated as a specification defect and recorded through repository tickets and a diary (lines 363–380).

7. The rollout separates envelope/versioning, lifecycle/conformance, the proving client, and auth profiles into reviewable contract clusters rather than attempting one oversized implementation specification (lines 399–415).

## 4. Concerns

1. **(Major) [IN-DELTA] Class P is impossible on the current hosted arm, contradicting the per-arm conformance decision.**

   The RFC declares the HTTP drain a supported tier (lines 55–61), defines Class P as socketless subscribe plus outbox drain (lines 271–281), and requires class claims against both local and hosted arms from the start (lines 307–310). The hosted implementation cannot satisfy that class:

   - `cloudflare/src/coordinator.js:3887-3893` refuses subscription unless a current WebSocket session exists.
   - `cloudflare/src/coordinator.js:1269-1279` returns an empty outbox by design.
   - The hosted capability manifest explicitly says the HTTP poll fallback carries no deltas.
   - The RFC’s 120-second crash backstop is local-only: hosted grants use a 24-hour default at `cloudflare/src/coordinator.js:99-101,3344-3347`.

   This is more than missing implementation detail: hosted Snapback deliberately binds demand to socket ownership, consistent with LLP 0090’s socketless-HTTP-cannot-arm-demand invariant. Implementing hosted Class P would therefore require a lifecycle and ownership decision, not merely routing work.

   **Resolution:** Either scope Class P to the local arm and represent hosted poll delivery as an explicit GAP, or add a named prerequisite that reconciles LLP 0090 and implements hosted socketless subscription ownership, durable outbox delivery, bounded drain semantics, and crash cleanup. In either case, replace the universal 120-second rule with an arm-specific lifecycle matrix.

2. **(Major) [IN-DELTA] The HTTP version-binding decision is internally unresolved and does not cover the RFC’s full HTTP protocol surface.**

   Lines 224–229 say the wire version is bound at `/connection/open`, but then leave missing or unknown offers to “open a legacy-scoped connection or refuse.” Those are materially different compatibility policies. Unknown-version fallback is especially incompatible with the exact-token/new-token doctrine cited in lines 243–244 because it permits a future client to be interpreted under v1 rather than refused.

   The binding also reaches only connection-scoped operations unless P-0 changes route ownership. Current one-shot query, mutation, and action calls are not associated with the connection grant: `packages/snapback-client/index.mjs:3345-3353,3404-3441` sends no connection token, while that token is sent for subscribe and drain. Yet the RFC includes finite routes in the protocol inventory (lines 140–146) and requires Class P to implement one-shot queries and mutations with receipts (lines 278–279). A version stored only on the connection therefore cannot select or constrain their request and response shapes.

   Class L adds a second selection point at WebSocket upgrade, but the RFC does not require that selection to equal the version already bound at connection open.

   **Resolution:** Pin one exact matrix for absent, known, and unknown HTTP offers; require synchronous refusal for unknown offers, and either refuse absence or define a bounded legacy migration mode. Then decide the version domain explicitly: either limit `snapback.v1` to connection-scoped live/outbox traffic and define separate compatibility for finite APIs and receipts, or require every versioned HTTP request to carry a connection grant whose selected version the server enforces. For Class L, require the socket offer/selection to equal the connection-bound version. Add both arms and every affected route to P-0 and the negative fixtures.

3. **(Moderate) [IN-DELTA] The normative cron testing seams are presented as universal even though the hosted arm exposes a different contract.**

   Lines 337–340 name `/_snapback/api/cron/tick` and `/_snapback/api/cron/{name}/run` as the documented deterministic escape hatches. Those are local-arm routes (`src/admin.rs:1962-1978`). The hosted implementation instead exposes admin-gated `POST /cron/run` with `{job}` (`cloudflare/src/gateway.js:90-104`; `cloudflare/src/coordinator.js:912-924`) and no matching tick route.

   Because preventing cross-arm acceptance-test folklore is one of the RFC’s central motivations, documenting only the local seam would reproduce the defect for hosted test authors.

   **Resolution:** Add these administration/testing routes to an explicit arm × seam matrix. Either document the distinct hosted `/cron/run` contract and absence of tick, or make route convergence a rollout prerequisite before claiming one normative testing seam.

4. **(Minor) [IN-DELTA] The Summary’s source attribution still contradicts the corrected inventory.**

   Lines 21–26 say every live-wire envelope family is single-sourced in `src/live_wire.rs`, while lines 156–158 correctly state that the drain wrapper `RealtimeEnvelope` is defined in `src/ephemeral.rs:1406`.

   **Resolution:** Change the Summary attribution to name both `src/live_wire.rs` and `src/ephemeral.rs`, or say that the families are single-sourced Rust serde/schemars types without naming one module.

## 5. Suggestions (non-blocking)

1. Update the stale destructive-first comments in `packages/snapback-client/index.mjs:3692-3697` and `src/server.rs:18459-18463` during P-1; they still say the server has already dequeued the batch, contrary to LLP 0059 and this RFC’s corrected leased-transfer account.

2. Replace “the fixture corpus … becomes the exhaustive artifact” (lines 254–256) with a bounded claim such as “the complete committed conformance corpus.” `artifact_instances()` can seed representative valid instances but cannot by itself exhaust JSON’s value space or all optional-field combinations.

3. State whether actions are required, optional, or a separate capability profile. They appear in the protocol inventory but not in either transport class.

4. Give per-arm conformance claims stable machine-readable identifiers, such as `poll/local`, `live/local`, and `live/hosted`, so unsupported tuples cannot be flattened into a generic Class P or Class L claim.

5. Make the shape-authority paragraph explicitly rank serde behavior, generated schema, normative fixtures, and illustrative byte tests, especially for accepted aliases that schemars may not express.

## 6. Open questions for the author

1. Is `snapback.v1` intended to version only connection-scoped live traffic, or the complete client protocol including finite query/mutation/action responses and receipts?

2. Is hosted Class P an intended new hosted capability, or should Class P initially be local-only?

3. For an absent HTTP wire offer, is the intended decision refusal or a temporary legacy connection? What exact operations would a legacy connection be permitted to perform?

4. Should the cron testing surface converge across arms, or should the implementer specification intentionally expose arm-specific administration seams?

## 7. Verdict

**NOT READY** — The RFC needs a feasible per-arm disposition for Class P and a complete, unambiguous HTTP version-negotiation contract before its core direction is coherent.

## Round 3 — 2026-07-24 (delta round)

**Round record (persisted before launch):** target revision v0.3 sha256 `aa9a92d53ac8ea5cf6897edb8e3cfce111aa6c02600d2a110a1ca5805932d7a1` at HEAD `33705541`; second delta round — instructions enumerate the v0.2→v0.3 delta (12 items) with IN-DELTA/PRE-EXISTING classification duty; topology unchanged (Fable fresh subagent / Codex `gpt-5.6-sol` high effort, mutually blind, instruction-based blindness self-attested); instruction file sha256 prefix `fefa50342c22b51e`; reviser: orchestrator. Round budget: 3 of 3 (final in-budget round). Growth note: v0.3 is 535 lines (+77% over loop entry; disclosed).

**Revision under review:** sha256 `aa9a92d53ac8ea5cf6897edb8e3cfce111aa6c02600d2a110a1ca5805932d7a1` (MATCH per reviewer's own check; HEAD `33705541` MATCH)
**Verdict:** NOT READY — 1 Major + 3 Moderate + 1 Minor, ALL classified [IN-DELTA]; no PRE-EXISTING MATERIAL concern reported

### Review body (verbatim)

## 1. Revision check — MATCH

- Document SHA-256: `aa9a92d53ac8ea5cf6897edb8e3cfce111aa6c02600d2a110a1ca5805932d7a1` — MATCH.
- Repository HEAD: `33705541` — MATCH.

## 2. Overall assessment

The RFC has a compelling direction, strong repository grounding, and a substantially improved account of arm asymmetry. However, v0.3 leaves several contradictions in the core version-negotiation and conformance decisions. Most importantly, `live/hosted` cannot satisfy the stated cumulative Class L definition, and the legacy negotiation matrix does not define a version binding compatible with the current JS client. These are direction-level defects rather than follow-on implementation details.

## 3. Strengths

1. The RFC now represents hosted behavior honestly. The arm-scoped lane statement (`0093:52-61`), route inventory (`0093:140-153`), Class P restriction (`0093:311-319`), and machine-readable tuple set (`0093:348-352`) agree with the hosted socket requirement and declared-empty outbox in `cloudflare/src/coordinator.js`.

2. Demand ownership is treated as a protocol obligation rather than incidental client etiquette. The arm-specific crash matrix (`0093:325-336`) correctly distinguishes the local 120-second idle reap from hosted socket-session teardown and correctly refuses to treat the hosted grant TTL as demand release.

3. The lifecycle inventory captures several easy-to-miss but essential facts: reconnect versus reattach (`0093:393-404`), leased-drain ownership transfer (`0093:405-410`), and server-selected delta versus replacement (`0093:411-412`). These agree with LLP 0034, LLP 0059, and LLP 0090/0091.

4. The evolution policy correctly separates additive fields, open `resync_required` reasons, capability-gated new kinds, and genuinely incompatible changes (`0093:253-270`). Requiring tolerant client decoding while keeping generated schemas closed is a sound distinction.

5. The conformance corpus is designed around externally observable state transitions rather than implementation internals (`0093:354-366`). Making the abstract client state machine an explicit P-1 deliverable materially improves the feasibility of independent Swift and Kotlin implementations.

6. The Swift proving-client discipline is strong: build from the specification and fixtures, treat source consultation as evidence of a specification defect, and record those defects rather than silently working around them (`0093:414-428`). The rollout decomposition (`0093:450-469`) is appropriately staged for a direction RFC.

## 4. Concerns

1. **(Major) [IN-DELTA] The cumulative Class L definition makes `live/hosted` logically unclaimable.**

   Class P requires a functioning HTTP drain (`0093:296-309`). Class L is defined as “Class P plus the WebSocket stream” (`0093:320-323`). Yet the hosted arm requires a current socket to subscribe and returns an empty drain (`0093:311-319`), while `live/hosted` is nevertheless declared claimable (`0093:348-352`). This is not merely missing implementation: the RFC simultaneously requires and forbids the poll behavior inherited by hosted Class L.

   **Resolution:** Replace the cumulative hierarchy with a common client core plus lane-specific Poll and Live obligations, or explicitly redefine Class L so hosted implementations do not inherit drain delivery. Then update the supported tuple set, both-lanes summary, fixture routing, and Swift rollout to match the chosen model.

2. **(Moderate) [IN-DELTA] The legacy connection has no defined version binding compatible with the socket equality rule.**

   The socket offer must equal the version bound at connection open (`0093:225-229`). A known HTTP offer binds a version, but an absent offer merely creates a “legacy” connection (`0093:230-242`). The document never says whether that legacy connection is internally bound to v1. This matters immediately: the current JS kit omits a wire offer in `POST /connection/open` (`packages/snapback-client/index.mjs:2341-2349`) but offers `snapback.v1` on the socket (`:6446-6460`). Under a literal “offer must equal the version already bound” rule, the migration bridge rejects the current client.

   The same paragraph says legacy connections are ineligible for every offer-gated kind (`0093:237-240`), while the evolution policy allows capability proof at either open or subscribe (`0093:253-260`). That leaves subscribe-scoped features such as LLP 0091’s `resumeFromToken`/`CurrentAsOf` path ambiguous.

   **Resolution:** Pin a complete matrix. Most plausibly, absent open offers should create a legacy-marked connection internally bound to v1, permitting the current v1 socket while restricting only capabilities not independently proved at subscribe. Explicitly state how subscribe-scoped offers behave and add transition cases for the current JS client.

3. **(Moderate) [IN-DELTA] The stated `snapback.v1` domain omits connection-scoped request/response contracts and misstates receipt ownership.**

   The version domain names live envelopes, socket frames, and the drain (`0093:244-251`), but omits the connection handshake and the request/response bodies for subscribe, resume, unsubscribe, and invalidation operations. These are part of the connection protocol, and origin/main’s LLP 0091 specifically evolves the subscribe input and live-subscription behavior.

   The finite-route sentence also says receipts ride `/query`, `/mutation`, and `/action` responses (`0093:246-248`), while the Rust `Receipt` union covers mutations and subscription lifecycle (`src/live_wire.rs:278-379`); query and action responses do not generally carry those receipts. Class P repeats the same ambiguity at `0093:303-304`. Because the shared Receipt schema crosses the proposed finite/connection boundary, the evolution authority is presently unclear.

   **Resolution:** Define the version domain over all connection-handshake and connection-authenticated request/response shapes, then enumerate which finite routes remain outside it. Correct the receipt inventory to distinguish mutation receipts from connection-scoped subscription receipts and state the evolution rule for the shared Receipt union.

4. **(Moderate) [IN-DELTA] The hosted cron seam is normalized without reconciling LLP 0031’s route boundary.**

   The inventory says the routes are governed by LLP 0031 (`0093:140`), but D3 promotes hosted admin-gated `POST /cron/run` as the documented seam (`0093:382-390`). LLP 0031’s invariant requires system/control operations under `/_snapback/*` and says no system operation lives at the root (`llp/0031-server-route-taxonomy.spec.md:78-97`). The current hosted route is indeed root-level (`cloudflare/src/gateway.js:90-104`, `cloudflare/src/coordinator.js:912-924`), but documenting existing code does not resolve the governing-spec conflict.

   **Resolution:** Either migrate the hosted operation to a classified `/_snapback/api/cron/{name}/run`-style route, or explicitly amend LLP 0031 with a justified provider-specific exception. P-0’s arm × route matrix should record the chosen route class and authority policy.

5. **(Minor) [IN-DELTA] The document gives exact-byte tests conflicting authority levels.**

   The Summary and “Normative source” declare schemas and exact-byte tests normative (`0093:34-38`, `0093:211-213`), while the ranked precedence section calls exact-byte tests illustrative (`0093:272-281`). That defeats the purpose of the newly explicit authority ranking.

   **Resolution:** Apply one formulation consistently throughout, preferably serde ground truth → generated schemas → normative fixtures → illustrative byte tests.

## 5. Suggestions (non-blocking)

1. Replace “destructive only on acknowledgement” (`0093:143-144`) with wording that names the transport ownership-transfer cut. LLP 0059’s acknowledgement occurs at writer-queue acceptance or the HTTP first-body cut, not through an application-level client ACK.

2. Expand the hosted teardown citation from `coordinator.js:4486` to the actual deletion and reconciliation range, approximately `:4470-4487`.

3. Qualify the claim that exact-value tests “must use one-shot queries” (`0093:380-381`). One-shot queries avoid creating demand, but deterministic assertions may also require isolation from existing subscribers and explicit scheduler/admin control.

4. Have P-1 include negative transition cases for arm mismatch—particularly attempting `poll/hosted`, attempting hosted subscribe before socket establishment, and losing the hosted socket while a subscribe is in flight.

## 6. Open questions for the author

1. Is hosted Class L intended to guarantee an HTTP fallback eventually, or is the intended decision that Live and Poll are sibling lane classes rather than cumulative tiers?

2. Should an absent connection-open offer implicitly bind v1 for legacy compatibility, and may such a connection still prove a new envelope capability at subscribe time?

3. Is hosted `/cron/run` intended as a permanent exception to LLP 0031, or should this RFC require its migration into the reserved system namespace?

## 7. Verdict

NOT READY

The arm/class contradiction and incomplete legacy-version matrix leave the RFC’s core conformance and negotiation decisions internally inconsistent.

## Loop close-out — 2026-07-24

**Terminal condition:** round budget exhausted (3/3) with sustained asymmetry — Fable READY on v0.2 and v0.3 (and v0.1); Codex NOT READY on v0.1, v0.2, and v0.3. The detail-horizon stop was NOT applied: Codex's Round-3 Major (cumulative Class L made `live/hosted` logically unclaimable) identified a genuine defective decision introduced by the loop's own v0.2 revision, independently corroborated by Fable's Round-3 Moderate 2 — not altitude-dispositionable detail.

**Final verdicts bind to revision v0.3**, sha256 `aa9a92d53ac8ea5cf6897edb8e3cfce111aa6c02600d2a110a1ca5805932d7a1`: Fable READY, Codex NOT READY. **A later revision v0.4 exists** (sha256 `501ea766f6215266116d8807c5d9ed69583fcdf5ee48c19aa8e7d501d2a7db3c`) applying both families' Round-3 resolutions; it is **unreviewed** by either family (delta-rule branch: budget barred a fourth round, so the final revision is labeled unreviewed).

**Delta-convergence status:** in both delta rounds (2 and 3) neither family reported any MATERIAL concern in pre-existing text — every Major/Moderate across rounds 2-3 was classified [IN-DELTA], i.e. introduced by the loop's own revisions. The convergence claim is scoped: pre-existing (v0.1-era) text is clean across both families; the v0.4 fixes to in-delta defects are unreviewed.

**Disposition ledger (Round 3 → v0.4):**
- Codex C1 (Major, class contradiction) — FIXED: classes restructured as client core + sibling poll/live delivery lanes; `live/hosted` inherits no drain obligations; tuple set, Summary, fixtures, and Swift rollout updated.
- Codex C2 / Fable C1 (legacy × socket cell) — FIXED: legacy connections implicitly v1-bound for socket equality (offer confirms, never upgrades); subscribe-scoped capability proofs preserved for legacy; current-JS-kit transition case stated.
- Codex C3 / Fable C3 (version domain, receipt ownership) — FIXED: domain extended to `/connection/open` and all connection-authenticated DTOs incl. `/ephemeral/*` and the invalidation ack pair; Receipt union ownership corrected (mutation + subscription receipts; stricter connection-scoped evolution rule for the shared union).
- Codex C4 (hosted `/cron/run` vs Active LLP 0031 root boundary) — RECORDED, not resolved: conflict stated in D3.1, migrate-or-amend delegated to P-0, new OQ6. Resolution is an author/P-0 decision.
- Codex C5 (byte-test authority inconsistency) — FIXED: single precedence statement; Summary/Normative-source aligned.
- Fable C2 (`live/hosted` obligations + hosted fallback blackout) — FIXED: lane model + lifecycle fact 2a.
- Fable C4 (load-bearing doctrine cited from Draft 0064/0051) — NOTED in D5 as a status dependency; advancing 0064 rides with its amendment.
- All four Codex suggestions and three of four Fable suggestions applied; Fable's revision-history-provenance suggestion deferred to commit time.

**Proposed next step (author applies; this loop sets nothing beyond Review):** stay in **Review**. The document entered the loop Draft and was set Review at loop start per authorization. Both families agree pre-existing text is clean; the unreviewed v0.4 addresses every enumerated Round-3 concern; the author may accept the asymmetry record as-is, commission a fourth (out-of-budget) delta round on v0.4, or revert to Draft.

## Round 4 — 2026-07-24 (delta round; author-extended budget)

**Round record (persisted before launch):** the author extended the loop budget by up to 3 rounds (rounds 4-6, converge early on dual-READY) after the Round-3 close-out. Target revision v0.4 sha256 `501ea766f6215266116d8807c5d9ed69583fcdf5ee48c19aa8e7d501d2a7db3c` at HEAD `33705541`; third delta round — instructions enumerate the v0.3→v0.4 delta (16 items) with IN-DELTA/PRE-EXISTING classification duty; topology unchanged (Fable fresh subagent / Codex `gpt-5.6-sol` high effort, mutually blind, instruction-based blindness self-attested); instruction file sha256 prefix `189bc8681ff9b7d9`; reviser: orchestrator. This round removes v0.4's UNREVIEWED label whatever the verdicts.

**Revision under review:** sha256 `501ea766f6215266116d8807c5d9ed69583fcdf5ee48c19aa8e7d501d2a7db3c` (MATCH per reviewer's own check; HEAD `33705541` MATCH)
**Verdict:** NOT READY — 5 Moderate [IN-DELTA] + 1 Minor [PRE-EXISTING]; no Major; no PRE-EXISTING MATERIAL concern

### Review body (verbatim)

## 1. Revision check — MATCH

- Document SHA-256: `501ea766f6215266116d8807c5d9ed69583fcdf5ee48c19aa8e7d501d2a7db3c` — MATCH.
- Repository HEAD: `33705541` — MATCH.

## 2. Overall assessment

The RFC has a strong direction, solid repository grounding, and a substantially clearer core/lane model. It is not yet ready because several v0.4 decisions conflict with the current normative types or leave connection-version and conformance boundaries internally inconsistent.

## 3. Strengths

1. The normative-source hierarchy is unusually clear: serde is ground truth, generated schemas are its machine view, fixtures carry facts schemas cannot express, and exact-byte tests are illustrative (lines 212–220, 290–299).

2. The legacy negotiation cell is practical and precise. It preserves today’s JS client while distinguishing open-time gates from subscribe/resume-scoped capability proofs and gives the bridge an explicit end state (lines 228–252).

3. The core-plus-sibling-lanes model correctly rejects cumulative tiers and accurately records the hosted arm’s socket ownership, empty drain, and reconnect-only recovery behavior (lines 306–351, 441–444).

4. The lifecycle section captures client-visible facts that are both consequential and well verified: demand-armed cron activation, socket-close teardown, leased-drain ownership, and server-selected delta behavior (lines 403–452). Recording the hosted `/cron/run` conflict with LLP 0031 rather than silently normalizing it is particularly good (lines 419–427).

5. The rollout separates direction from byte-level contracts while assigning concrete artifacts—route matrix, state machine, fixtures, and auth profiles—to follow-on Specs (lines 493–515).

## 4. Concerns

1. **(Moderate) [IN-DELTA] The claimed shared `Receipt` authority does not exist on subscription responses.**

   Lines 263–267 and 322–323 say the typed `Receipt` union covers both mutation and subscription receipts and therefore evolves under one stricter rule. Mutation responses do use `Receipt` (`src/server.rs:5661-5668`), but `LiveSubscribeOutput.receipt` and `LiveUnsubscribeOutput.receipt` are `Option<Value>` (`src/local.rs:636-644`, `739-744`). Consequently, the generated subscription schemas leave the field unconstrained (`schemas/live.subscribe.output.schema.json:410-412`; `schemas/live.unsubscribe.output.schema.json:108`). The runtime happens to construct a `Receipt::Subscription` before converting it to `Value`, but neither the route serde type nor its schema makes that normative. This directly contradicts D1’s authority model.

   **Resolution:** Either require P-0 to change both subscription output fields to `Option<Receipt>` and regenerate the schemas before ratifying the shared-union claim, or explicitly describe the current subscription receipt as an untyped compatibility seam and make closing that seam a named P-0 deliverable.

2. **(Moderate) [IN-DELTA] The client core incorrectly classifies every non-header grant carrier as a development affordance.**

   Lines 315–319 require header grant carriage and describe any non-header carrier as dev compatibility. That is false for WebSockets: the production server supports the connection token as a WebSocket subprotocol because browser WebSocket APIs cannot set arbitrary headers (`src/server.rs:5375-5385`), and LLP 0031’s normative matrix permits header or subprotocol carriage on the stream while reserving query carriage as the dev-only fallback (`llp/0031-server-route-taxonomy.spec.md:301-305`). The RFC itself acknowledges header-or-subprotocol carriers at lines 165–169.

   **Resolution:** Split the rule by transport: connection-authenticated HTTP uses the header, except for the explicitly documented dev-only drain query fallback; WebSocket upgrades use either the header where available or the production connection-token subprotocol. Keep the wire-version subprotocol distinct from the bearer subprotocol.

3. **(Moderate) [IN-DELTA] “Decode both wrapper forms” remains in the common core even though wrapper framing is lane-specific.**

   Lines 315–323 require every client to decode both wrapper forms, while lines 308–313 declare sibling, non-cumulative lanes and lines 348–351 explicitly remove drain obligations from `live/hosted`. The wrapper asymmetry is itself transport-specific: Lane P receives `RealtimeEnvelope::Durable`, while Lane L receives the durable envelope unwrapped (lines 181–182). As written, `live/hosted` still inherits drain-wrapper decoding and `poll/local` inherits socket-form decoding, making tuple conformance broader than the lane it claims.

   **Resolution:** Put normalization of `LiveEnvelope` state transitions in the core, put `RealtimeEnvelope` unwrapping in Lane P, and put unwrapped durable/control-frame dispatch in Lane L. A multi-lane implementation may compose both adapters without imposing both on each individual tuple.

4. **(Moderate) [IN-DELTA] The expanded connection-version domain sweeps a public, connectionless ephemeral route under `snapback.v1`.**

   Lines 254–260 place the `/ephemeral/*` family inside the connection-scoped version. However, `POST /ephemeral/collections/ensure` is a public, identity-free compatibility route with no connection grant or version binding (`llp/0031-server-route-taxonomy.spec.md:304-305`). It therefore cannot inherit the version negotiated at `/connection/open`.

   **Resolution:** Enumerate the connection-authenticated ephemeral routes covered by `snapback.v1`—publish, subscribe, delete, and socket operations—and explicitly exclude `/ephemeral/collections/ensure` under route stability/additive evolution, or introduce and justify an independent version carrier for that route.

5. **(Moderate) [IN-DELTA] The v0.4 domain expansion lacks an evolution rule for client-to-server DTOs and the self-versioning open handshake.**

   D1 now includes `/connection/open` and all connection-authenticated request/response DTOs in `snapback.v1` (lines 254–269), but the evolution policy only explains tolerant additions to existing envelopes (lines 271–286). Several newly covered request types are deliberately closed: `OpenConnectionRequest` has `deny_unknown_fields` (`src/server.rs:4071`), as do authorization-invalidation and ephemeral request DTOs. An optional field sent by a newer v1 client therefore does not “provably survive” an older v1 server. `/connection/open` is the sharpest case because the version is carried inside the closed DTO being versioned.

   **Resolution:** State evolution separately by direction and decoder posture. Server-to-client optional additions may remain within v1 only where old clients demonstrably ignore them; client-to-server additions require an explicit feature proof, compatible fallback, or a new version. P-0 must also define how an older server responds to a newer open-handshake field before a connection version can be bound.

6. **(Minor) [PRE-EXISTING] The supposedly exhaustive route inventory omits routes required by named auth profiles.**

   Lines 137–154 say the inventory pins the surface follow-on Specs must cover, while D2 includes authorized leases and queued replay among client auth profiles (lines 369–377). The inventory does not name `POST /query/{name}/authorized-lease` or `POST /client-mutations/acknowledge`, both present in the governing LLP 0031 matrix (`llp/0031-server-route-taxonomy.spec.md:291-305`).

   **Resolution:** Add those routes to the inventory and arm matrix, or explicitly state that P-3 owns a separate protocol surface and narrow the inventory’s exhaustiveness claim accordingly.

## 5. Suggestions (non-blocking)

1. Explain that committed schema `$id` values currently use the artifact/schema namespace `snapback.v0`, which is distinct from the proposed wire identity `snapback.v1`; otherwise external implementers may reasonably infer a version contradiction.

2. Clarify OQ3’s baseline: `artifact_instances()` currently emits only `data-tier.profile.json` (`src/schema_export.rs:419-426`). P-1 must extend it or add a separate wire-fixture generator; it does not presently provide live-wire instances.

3. Make updating the JS kit to offer the open-time wire version an explicit gate before P-0 reaches the legacy-refusal end state.

4. Define whether a client supporting both local lanes advertises two independent tuples or a composite machine-readable claim such as `poll+live/local`.

## 6. Open questions for the author

1. Is provider authentication lifecycle—`/auth/session`, exchange, refresh, logout, pairing, and agent credentials—part of this client protocol, or does P-3 cover only capability carriage after credentials already exist?

2. Should `live/local` require Lane P as an operational fallback, matching the current JS kit, or is it intentionally a Lane-L-only claim with reconnect as its sole required recovery path?

## 7. Verdict

NOT READY — The direction is strong, but the receipt authority, carrier rules, lane obligations, and expanded version domain need reconciliation before the RFC can define coherent conformance claims.

## Round 5 — 2026-07-24 (delta round; author-extended budget)

**Round record (persisted before launch):** target revision v0.5 sha256 `859756c6c6c39cbced562f9a62a8ef2e3acd17fafe516563456d5b8d1b726450` at HEAD `33705541`; fourth delta round — instructions enumerate the v0.4→v0.5 delta (12 items) with IN-DELTA/PRE-EXISTING classification duty; topology unchanged (Fable fresh subagent / Codex `gpt-5.6-sol` high effort, mutually blind, instruction-based blindness self-attested); instruction file sha256 prefix `3f0b179ae315148b`; reviser: orchestrator. Extended budget: round 5 of 6.

**Revision under review:** sha256 `859756c6c6c39cbced562f9a62a8ef2e3acd17fafe516563456d5b8d1b726450` (MATCH per reviewer's own check; HEAD `33705541` MATCH)
**Verdict:** NOT READY — 2 Moderate [IN-DELTA], 1 Moderate [PRE-EXISTING] (bundle-register omission), 1 Minor [PRE-EXISTING]; no Major

### Review body (verbatim)

## 1. Revision check

MATCH — document sha256 `859756c6c6c39cbced562f9a62a8ef2e3acd17fafe516563456d5b8d1b726450`; repository HEAD `33705541`.

## 2. Overall assessment

This is a strong direction RFC with an unusually honest inventory of the current protocol. The v0.5 transport, receipt, fixture, and evolution-policy refinements materially improve it. However, the new direction-specific compatibility policy rests on an inaccurate claim about existing request DTOs, and its handshake guarantee cannot hold against pre-P-0 servers. The conformance model also remains unreconciled with Accepted LLP 0090’s bundle-register bootstrap.

## 3. Strengths

1. The motivation distinguishes actual evidence from earlier folklore and ties the native-client gap to concrete demo behavior rather than competitive aspiration (`llp/0093-client-protocol-and-native-clients.rfc.md:65-97`).

2. The route and envelope inventory is specific about arm asymmetry, drain wrapping, mixed casing, open reason strings, and reattach versus resubscribe semantics (`:137-209`). The v0.5 additions for authorized leases and mutation acknowledgements agree with LLP 0031 and the installed route registry.

3. The revised version domain is substantially more precise. It correctly includes connection-authenticated ephemeral HTTP/socket operations, excludes the Public identity-free collections-ensure route, and identifies the current `Option<Value>` subscription-receipt seam before claiming a shared typed union (`:257-282`).

4. Shape-authority precedence is clear, and the new fixture-seed and namespace qualifications prevent two easy overclaims: `artifact_instances()` currently emits only the data-tier profile, and `snapback.v0` schema IDs are not the wire-version identity (`:312-327`).

5. Grant carriage now matches LLP 0031’s transport matrix: HTTP header, browser-compatible WebSocket bearer subprotocol, no URL credential, and a distinct wire-version subprotocol (`:343-352`). Moving drain and socket wrapper framing into their respective lanes also makes the conformance split coherent (`:357-381`).

6. Independent arm/lane tuples avoid accidentally making the JS kit’s composition mandatory for other clients, while the negative-fixture plan gives the compatibility rules executable force (`:416-438`).

7. The rollout is sensibly decomposed into wire, lifecycle/conformance, proving client, and auth-profile work, with explicit blast-radius and schema-regeneration gates (`:534-562`).

## 4. Concerns

1. **(Moderate) [IN-DELTA] The client→server evolution policy incorrectly describes the current request surface as closed.** The RFC says request DTOs are “deliberately closed” and presents `OpenConnectionRequest` as the norm (`:284-296`). In fact, `LiveSubscribeInput`, `LiveResumeInput`, and `LiveUnsubscribeInput` lack `deny_unknown_fields` (`src/local.rs:613-737`), as do `HandlerInput` (`src/manifest.rs:2628-2650`) and the generated `LiveSocketClientMessage` authority (`src/live_wire.rs:239-272`). Their generated schemas consequently do not close the top-level objects. Moreover, socket decoding is auth-mode-specific: sessions use a separate closed `SessionLiveSocketClientMessage`, while dev uses the open generated type (`src/server.rs:17653-17684,18131-18138`). This is not merely editorial: LLP 0091’s `resumeFromToken` addition benefits from the compatible-fallback behavior of an open subscribe DTO, whereas closing that family would itself be a behavioral change.

   **Resolution:** Replace the blanket closed-DTO premise with an audited per-family matrix covering the actual decoder, schema closure, and fallback semantics by route, transport, and auth mode. P-0 should explicitly decide which currently open DTOs remain open for compatible fallback and which become closed, with blast-radius evidence for every closure change. The evolution rule can remain “proof, fallback, or new version,” but its justification must reflect the heterogeneous current wire.

2. **(Moderate) [IN-DELTA] The open-handshake bootstrap guarantee is impossible for pre-P-0 servers.** The RFC requires that “an older server must refuse a newer open readably … never a parse error” (`:292-296`). The current `OpenConnectionRequest` is closed (`src/server.rs:4071`), so a server predating the new wire-version member rejects that member during JSON decoding before version negotiation can run. Server-first rollout protects a controlled deployment sequence, but it cannot retroactively give already-deployed servers a coded version refusal.

   **Resolution:** Scope the readable exact-token refusal to servers that implement the new offer member. Specify a staged rollout: first deploy servers that admit the field and return a typed unknown-token refusal; then enable client offers; finally refuse absent offers after the compatibility window. For genuinely pre-P-0 servers, require the client to treat parse rejection or a missing response-side binding/echo as incompatibility rather than claiming that parse rejection cannot occur.

3. **(Moderate) [PRE-EXISTING] The universal client-core and hosted lifecycle model omit LLP 0090’s bundle-register exception.** The core currently requires `/connection/open` followed by separate subscription operations (`:343-356`), and the hosted lifecycle text says socketless HTTP cannot arm demand and that socket close/error is the hosted demand-release path (`:367-375,388-404`). Accepted LLP 0090 defines a sanctioned exception: credentialed `POST /app/bundle` register mode atomically mints the connection grant and subscriptions under a bounded pending-registration owner before socket attachment, with deadline/reaper release. Origin/main’s LLP 0092 §0D.7 pins that route as “the one sanctioned socketless-demand exception.” This does not make `poll/hosted` claimable, but it is an alternate bootstrap and a distinct demand owner/release path. The RFC already names Channel C bundle consumers (`:59-61`), so leaving its lifecycle outside the protocol model is internally inconsistent.

   **Resolution:** Either add bundle-register as an optional RQS bootstrap/profile with its pending-owner, atomic handoff, attach-deadline, and reaper transitions, or explicitly exclude Channel C from LLP 0093 conformance and explain which document owns its client obligations. Preserve the statement that ordinary socketless subscribe cannot arm hosted demand and that `poll/hosted` remains unavailable.

4. **(Minor) [PRE-EXISTING] LLP 0064 carries a conflicting reconnect identity rule that the proposed amendment does not name.** LLP 0093 requires reconnect-as-resubscribe-with-`supersedes` (`:376-381`), which depends on retaining the connection identity; LLP 0031 also says socket close does not revoke the grant. Draft LLP 0064 instead says React Native reconnect “obtains a fresh connection grant” (`llp/0064-native-client-surfaces.rfc.md:94-98`). D5 proposes amending 0064 only to add protocol-native clients and preserve token/evidence doctrines (`0093:525-529`).

   **Resolution:** Add grant reuse and reconnect identity to the required LLP 0064 reconciliation, explicitly choosing whether “fresh grant” means idempotent re-open of the surviving grant or must be replaced with the connection-preserving rule.

## 5. Suggestions (non-blocking)

- Update the local disconnect citation at `:395`: `src/local.rs:8976` is the cron refresh call; the relevant function and subscription removal are at approximately `src/local.rs:8907-8966`.
- Have P-3 provide an integration index for `/auth/session`, request-code, exchange, refresh, logout, and family-alarm routes even though their lifecycle remains normatively owned by LLP 0059/0060/0077.
- Include a fixture for the known `durable_bytes` fallback, distinguishing it from an unknown future kind; the current JS kit acknowledges but ignores it.
- Qualify “complete committed conformance corpus” as complete over the specified behavior classes, not exhaustive over all valid schema values.

## 6. Open questions for the author

1. Is request closure intended to become uniform in P-0, or is the desired v1 policy explicitly family-specific so compatible-fallback additions such as `resumeFromToken` remain possible?
2. Should Channel C register-mode clients make an LLP 0093 conformance claim, or remain governed exclusively by LLP 0090/0092?
3. Is the handshake compatibility promise intended only for P-0-capable older servers, or is a separate legacy-server detection mechanism expected?

## 7. Verdict

NOT READY — The request-evolution and handshake guarantees need correction, and the conformance lifecycle must be reconciled with LLP 0090’s bundle-register bootstrap.

## Round 6 — 2026-07-24 (delta round; final round of author-extended budget)

**Round record (persisted before launch):** target revision v0.6 sha256 `ef3a2e777da842667a0481ca51c120ddc4361824a7d580eb23d7617af6b1d5bb` at HEAD `33705541`; fifth delta round — instructions enumerate the v0.5→v0.6 delta (10 items) with IN-DELTA/PRE-EXISTING classification duty; topology unchanged (Fable fresh subagent / Codex `gpt-5.6-sol` high effort, mutually blind, instruction-based blindness self-attested); instruction file sha256 prefix `d66d04f4e065b8fd`; reviser: orchestrator. Extended budget: round 6 of 6 — terminal round.

**Revision under review:** sha256 `ef3a2e777da842667a0481ca51c120ddc4361824a7d580eb23d7617af6b1d5bb` (MATCH per reviewer's own check; HEAD `33705541` MATCH)
**Verdict:** NOT READY — 2 Moderate [IN-DELTA] (server→client closure authority; durable_bytes recovery), 1 Minor [PRE-EXISTING]; no Major

### Review body (verbatim)

## 1. Revision check

MATCH — document sha256 `ef3a2e777da842667a0481ca51c120ddc4361824a7d580eb23d7617af6b1d5bb`; repository HEAD `33705541`.

## 2. Overall assessment

The RFC is evidence-rich, directionally coherent, and substantially improved by v0.6. The decoder-closure correction, staged handshake bootstrap, hosted register-mode exception, reconnect reconciliation, and root-route audit all match the cited repository state and governing LLPs. `./ref-check --verbose` also passes with zero errors.

Two material protocol questions remain: server→client schema closure is not reconciled unambiguously with tolerant-client conformance, and `durable_bytes` is ratified as known-but-ignored even though ignoring it can leave a client silently stale.

## 3. Strengths

1. The inventory is unusually honest about current asymmetry: local-only reattach, hosted empty drain, mixed casing, transport-specific wrapping, leased-drain ownership, and server-selected delta versus replacement are all stated rather than normalized away (`llp/0093-client-protocol-and-native-clients.rfc.md:137-209`).

2. The staged negotiation design preserves today’s clients while establishing an enforceable end state. In particular, legacy connections are explicitly v1-bound, unknown offers refuse, absent offers are temporary, and pre-P-0 decode rejection is distinguished from typed refusal (`llp/0093-client-protocol-and-native-clients.rfc.md:225-255`, `284-328`).

3. Core plus sibling delivery lanes plus orthogonal auth profiles is the right decomposition. It represents `poll/local`, `live/local`, and `live/hosted` honestly without making hosted clients pretend that an empty drain is a recovery lane (`llp/0093-client-protocol-and-native-clients.rfc.md:357-419`, `439-471`).

4. The hosted `POST /app/bundle` register-mode exception is accurately bounded and delegated: it is a pending-registration bootstrap into Lane L, not a precedent for ordinary socketless subscribe or `poll/hosted` (`llp/0093-client-protocol-and-native-clients.rfc.md:390-408`).

5. Demand ownership is elevated to protocol behavior, including billing-visible activation, arm-specific teardown, idle reaping, and explicit release obligations. That directly addresses the motivating warm-poll failure mode (`llp/0093-client-protocol-and-native-clients.rfc.md:421-437`, `477-524`).

6. The rollout separates envelope/version work, lifecycle/conformance, the Swift proof, and auth profiles into reviewable contract clusters with concrete evidence gates (`llp/0093-client-protocol-and-native-clients.rfc.md:573-606`).

## 4. Concerns

1. **(Moderate) [IN-DELTA] Server→client schema closure and tolerant-client conformance have conflicting authority.**

   D1 ranks serde and generated schemas above fixtures, calls schemas normative, and permits optional fields on existing server envelopes; it then requires clients to ignore unknown fields as a conformance rule layered above the closed schemas (`llp/0093-client-protocol-and-native-clients.rfc.md:215-223`, `284-326`, `330-343`). Several server→client nested DTOs are explicitly closed—for example `AuthorizationInvalidationSnapshot` at `src/live_wire.rs:106-108`—as are response DTOs such as `AuthorizationInvalidationAckOutput` at `src/local.rs:760-764`. Their generated schemas use `additionalProperties: false`. A schema-validating client can therefore reject an addition that the prose expects a tolerant client to ignore. P-0’s closure matrix is presently described only inside the client→server policy.

   **Resolution:** Extend P-0’s closure matrix to every server→client top-level and nested family in the wire-v1 domain. Explicitly distinguish schemas as descriptions of emitted current instances from the client acceptance grammar, state which authority wins on unknown fields, and require capability gating or a new wire token for additions to any family whose deployed/schema-driven clients are not proven tolerant.

2. **(Moderate) [IN-DELTA] Ratifying `durable_bytes` as “known-but-ignored” permits silent permanent staleness.**

   The new fixture language distinguishes the known-but-ignored `durable_bytes` kind from an unknown future kind (`llp/0093-client-protocol-and-native-clients.rfc.md:330-343`). But `DurableBytes` exists specifically so an invalid UTF-8 durable payload is not silently dropped (`src/live_wire.rs:188-191`); `live_stream_text` emits that frame (`src/local.rs:12721-12729`), and the WebSocket handoff can then accept and remove its outbox lease (`src/server.rs:17569-17580`). The current kit has no recovery transition for the frame. Ignoring it while leaving the socket healthy loses an acknowledged durable update without forcing a snapshot.

   **Resolution:** Give `durable_bytes` a normative recovery action—preferably close/reconnect and fresh subscribe, or an equivalent forced resync—and encode that action in P-1’s abstract state machine and fixtures. If ignoring is intended, prove and state the invariant that guarantees a subsequent resync before the client can remain or report current.

3. **(Minor) [PRE-EXISTING] The gotcha ledger incorrectly calls the open reason string and `request_id` alias the wire’s “only forward-compat escape hatches.”**

   That statement (`llp/0093-client-protocol-and-native-clients.rfc.md:201-206`) conflicts with D1’s optional-field evolution, open client DTOs, capability-gated kinds, and compatible fallbacks (`llp/0093-client-protocol-and-native-clients.rfc.md:284-328`). A spelling alias is compatibility history, not an escape hatch for future semantics.

   **Resolution:** Replace “only forward-compat escape hatches” with a narrower description such as “two existing envelope-level compatibility details,” and point readers to D1 for the complete evolution policy.

## 5. Suggestions (non-blocking)

1. **[PRE-EXISTING]** Rename “exact-wire-byte tests” to “exact wire-shape tests.” `src/live_wire.rs:394-616` compares `serde_json::Value`, which pins names, casing, tags, and values but not serialized JSON bytes or object-member order.

2. **[IN-DELTA]** Make the absent-offer deprecation gate audit all `/connection/open` consumers, not only the non-kit socket population named for socket refusal.

3. **[PRE-EXISTING]** Add P-1 fixtures for `SNAPBACK_CONNECTION_TOKEN_INVALID` after local idle reaping or hosted grant expiry, including whether recovery refreshes only the grant or also re-establishes every subscription.

4. **[IN-DELTA]** Record the Draft status of LLP 0091 and LLP 0092 alongside the existing LLP 0051/0064 status-dependency note, since v0.6 relies on their precise fallback and register-mode contracts.

## 6. Open questions for the author

1. Are generated schemas intended to validate only what current servers emit, while the fixture state machine defines what clients must accept? If so, should the precedence section state those separate domains instead of ranking them globally?

2. What exact client transition should follow `durable_bytes`: forced resubscribe, connection-wide resync, terminal failure, or something else?

3. When a connection grant is reaped or expires, should a conformant core preserve logical subscription identities across a new grant, or treat every subscription as fresh without `supersedes`?

## 7. Verdict

NOT READY

The direction is strong, but server→client closure authority and `durable_bytes` recovery remain material compatibility and correctness issues.

## Loop close-out (extended budget) — 2026-07-24

**Terminal condition:** author-extended budget exhausted (6 rounds total: 3 original + 3 authorized). Sustained asymmetry persisted to the end — Fable READY on all six revisions reviewed; Codex NOT READY on all six — but with a strictly narrowing severity trajectory on the Codex side: R1 4 Major, R3 1 Major, R4-R6 zero Major (5 → 3 → 2 Moderate). From Round 2 onward, every Codex Major/Moderate but one was [IN-DELTA] — introduced by the loop's own revisions; the single [PRE-EXISTING] Moderate (Round 5: the LLP 0090/0092 bundle-register socketless-demand exception missing from the conformance model) was fixed in v0.6 and verified accurate by both Round-6 reviewers.

**Final verdicts bind to revision v0.6**, sha256 `ef3a2e777da842667a0481ca51c120ddc4361824a7d580eb23d7617af6b1d5bb`: Fable READY (1 Minor citation nit), Codex NOT READY (2 Moderate [IN-DELTA]). **A later revision v0.7 exists** (sha256 `eb3df2dcba2af4ef4daaaa49ec084e4bfdf66b63c385ba36762ea7450de23639`) applying both families' Round-6 resolutions; it is **unreviewed**.

**Disposition ledger (Round 6 → v0.7):**
- Codex C1 (Moderate, server→client closure vs tolerant-client conformance) — FIXED: P-0 closure matrix made bidirectional with the closed server→client examples cited; schemas pinned as describing emitted instances while the fixture corpus/state machine define the acceptance grammar (acceptance grammar wins on unknown fields); additions to unproven-tolerant families need capability gating or a new token; `authInvalidationProtocol`'s degrade-to-legacy asymmetry added to the audit (also Fable R6 S1/S3).
- Codex C2 (Moderate, `durable_bytes` silent staleness) — FIXED: D3 fact 2b gives the frame a required forced-resync recovery transition, encoded in P-1's state machine and fixtures; the kit's ignore posture named a defect, not a precedent.
- Codex C3 (Minor, "only forward-compat escape hatches") — FIXED: narrowed to "two existing envelope-level compatibility details," pointer to D1.
- Codex S1-S4 — APPLIED: wire-shape test renaming (Value comparison, not bytes); absent-offer gate audits all `/connection/open` consumers; grant-loss recovery fixtures added to P-1; 0091/0092 Draft status recorded in the dependency note.
- Fable C1 (Minor, citation mapping) — FIXED: `AuthorizationInvalidationAckInput` (`src/local.rs:754`), `HandlerInput` (`src/manifest.rs:2629`), sessions-socket named a third auth-mode-dependent family at `:17658`.
- Fable OQ2 (register-mode citation in tuples) — the "bootstrap into Lane L, not a poll lane" sentence stands as sufficient; not separately restated.

**Convergence claim, scoped:** pre-existing (pre-loop) text was never the subject of a MATERIAL concern by either family in any of the five delta rounds; the one loop-internal PRE-EXISTING Moderate was resolved and re-verified. All remaining NOT READY substance was introduced-and-fixed churn within the loop's own revisions, with v0.7 the unreviewed fix of the final two Moderates.

**Proposed next step (author applies):** stay in **Review**. Options remain: accept the asymmetry record as-is; commission a single further delta round on v0.7 to clear its unreviewed label (the v0.7 delta is small: 12 targeted edits); or revert to Draft. Growth disclosure: 302 lines at loop entry → 762 at v0.7 (~2.5×), driven throughout by Major/Moderate resolutions demanding real contract decisions.
