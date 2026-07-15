**Reviewer family:** GPT (OpenAI Codex)
**Provider / runtime:** OpenAI Codex CLI v0.144.4 (`codex exec`, non-interactive), model gpt-5.6-sol, reasoning effort ultra, read-only sandbox, workdir = repo root, session id 019f62c9-0018-7a23-a550-20109507f606; 546,956 tokens used. Orchestrated by the ENG-24996 cross-family review gate (LLP 0005 review loop via /llp-review).
**Date:** 2026-07-14
**Redacted:** no redaction applied — no secrets in the reviewed material; reviewer instructed not to read `.agent-local-secrets.md`, credential files, or `llp/reviews/`, and not to quote secret material. Sending repository content to OpenAI was authorized by the human-directed ENG-24996 review-gate assignment.
**Method:** cli-runner — fresh session, blind to all archived reviews. The brief identified the document as an implementation-derived Spec for landed code (LLP 0039 item 5 / ENG-24603) and directed the reviewer at spec-vs-code fidelity, internal consistency, cross-LLP consistency, security soundness, and reimplementability, with MATERIAL/MINOR/EDITORIAL severities.

# LLP 0059 reviews — GPT family

## Round 1 — 2026-07-14

**Reviewed:** `llp/0059-session-projection-and-client-barrier.spec.md`, sha256 `565534f09b958e329e1abb69e3e595a9cc8ad53aa672d4e617e4013383fbfbbf` (committed at repo HEAD `fdfdd94`).
**Verdict:** NOT READY

### Review body (verbatim)

## Overall assessment

The core server architecture is thoughtful and largely fail-closed, especially the projection, ticket, grant, and transactional incarnation machinery. However, the document is not ready for ratification as an implementation-faithful Spec. Several shipped client and handshake paths violate its central claim that predecessor authority cannot publish across a transition, and two client-store behaviors contradict frozen LLP 0039. These are active correctness/security gaps, not merely documentation polish.

## Strengths

- The authorization-stream record is genuinely closed and canonical: the implementation validates UUIDv7, rejects unknown or reordered encodings, and compares the exact serialized bytes (`src/auth/session_projection.rs:49-104`). Reset rotates that record in the same transaction as destructive app/auth changes (`src/storage.rs:607-659`).

- Projection startup uses one SQLite snapshot for the stream, identities, sessions, and tombstones (`src/storage/auth_stream.rs:57-176`) and publishes only after detached rebuild succeeds (`src/auth/runtime.rs:244-275`). This matches the Spec’s pre-bind, all-or-nothing posture.

- Unique mutation tickets and sibling-safe rollback are well implemented. Begin inserts the exact ticket into topology and leaf indexes (`src/auth/session_projection.rs:1362-1437`); compare-unmark removes only that ticket (`src/auth/session_projection.rs:1500-1538`); revocation and rotation finalize exact successor state (`src/auth/session_projection.rs:1540-1617`, `1684-1760`).

- Connection acts have a strong final cut: the publication fence is acquired before the registry, the exact grant id is rechecked, and the registry guard remains held through the bounded synchronous act (`src/server.rs:2574-2617`). Reverse-indexed terminalization is similarly exact (`src/server.rs:1367-1445`, `1841-1875`).

- The browser custody primitives are strong in isolation. Authority objects and custody records have exact shape validation (`packages/snapback-contract/auth-coordinator.mjs:140-215`, `223-299`); `compareAndCommit` reloads durable custody under ownership and requires a synchronous callback (`packages/snapback-contract/auth-coordinator.mjs:697-724`); rotation compares the custody revision (`packages/snapback-contract/auth-coordinator.mjs:726-795`). IndexedDB replacement checks both custody revision and fallback-lease ownership in the same transaction (`packages/snapback-contract/auth-custody-indexeddb.mjs:230-263`).

- The Spec is appropriately candid that IndexedDB bearer custody is coordination rather than an XSS defense (`llp/0059-session-projection-and-client-barrier.spec.md:1163-1172`) and does not overclaim hosted or multi-replica safety (`llp/0059-session-projection-and-client-barrier.spec.md:121-126`).

## Concerns

1. **MATERIAL — Cross-context publication is guarded by a stale in-memory hint, weakening frozen LLP 0039.**

Frozen LLP 0039 requires every success, failure, callback, reconciliation, and durable write to be an authority-epoch compare-and-commit (`llp/0039-auth-vertical-slice.rfc.md:1047-1056`). LLP 0059 instead permits exposure through either `isCurrent` or `compareAndCommit` (`llp/0059-session-projection-and-client-barrier.spec.md:1100-1106`), even though it later defines `isCurrent` as only a fast in-memory hint (`llp/0059-session-projection-and-client-barrier.spec.md:1207-1215`).

The implementation follows the weaker rule. `isCurrent` checks only local `#record` state (`packages/snapback-contract/auth-coordinator.mjs:493-512`); cross-context convergence depends on receiving a BroadcastChannel wakeup (`packages/snapback-contract/auth-coordinator.mjs:462-481`, `1175-1203`). Yet inbound live frames, durable updates, and ephemeral overlays publish after only `isCurrent` (`demos/_kit/client.mjs:2719-2757`, `3714-3735`, `4104-4135`). The promised `pageshow`, visibility, and focus reconciliation is not installed; the coordinator is durably synchronized only on selected foreground HTTP/handshake paths (`demos/_kit/client.mjs:1053-1055`, `1306-1308`).

Consequently, if tab B commits `clearing` while tab A misses or delays the wakeup, A can still consider its predecessor capture current and publish an A frame or callback after B’s durable transition. This directly defeats the claimed dropped-broadcast safety (`llp/0059-session-projection-and-client-barrier.spec.md:1251-1264`) and executable two-context race (`llp/0059-session-projection-and-client-barrier.spec.md:1782-1800`).

*Resolves with:* Restrict `isCurrent` to a non-authoritative prefilter; require durable `compareAndCommit` at every final callback/state exposure, install the specified lifecycle gates, and add a deterministic test that drops the clearing broadcast and releases a queued predecessor frame after the durable CAS.

2. **MATERIAL — Terminal socket loss does not reliably clear custody or suppress reconnect.**

The Spec and frozen LLP 0039 require the client to classify either the typed frame or close code 4401 as terminal, stop reconnect, and compare-and-clear the captured authority (`llp/0059-session-projection-and-client-barrier.spec.md:987-992`; `llp/0039-auth-vertical-slice.rfc.md:1021-1029`).

On the server, the text frame and close frame are sent sequentially inside one deadline. If the text send blocks until that deadline, the future is cancelled before code 4401 is attempted (`src/server.rs:10150-10173`). The existing test exercises only a writable socket (`src/server.rs:21337-21410`).

On the client, the close handler ignores the `CloseEvent` code and reason (`demos/_kit/client.mjs:3737-3745`), and every ordinary loss schedules reconnect (`demos/_kit/client.mjs:3753-3780`). Reconnect then performs a direct `authSession` handshake (`demos/_kit/client.mjs:3627-3660`), but that direct handshake path does not compare-and-clear terminal rejection of persisted custody (`demos/_kit/client.mjs:1048-1103`); terminal clearing exists only in the generic request path (`demos/_kit/client.mjs:1368-1398`). The server does reject such persisted credentials after revocation or a move to dev mode (`src/server.rs:5965-5993`), so this can become an indefinite reconnect/rejection loop while predecessor client state remains settled.

*Resolves with:* Prioritize or independently bound delivery of 4401, inspect `CloseEvent.code` and reason client-side, classify terminal direct-handshake errors, run `compareAndClear` against the exact socket capture, and test both close-only and handshake-only convergence with the terminal text frame withheld.

3. **MATERIAL — Diagnostic `/auth/session` can publish predecessor authority across a mode-transition cut.**

The Spec says every response has a final fence and that the handshake’s projection and incarnation come from one prepared authority (`llp/0059-session-projection-and-client-barrier.spec.md:42-44`, `1593-1596`). LLP 0058 likewise says an old admitted request cannot publish after the mode barrier (`llp/0058-shared-invocation-authority-and-staged-auth-mode-protocol.spec.md:560-564`).

A mode transition first sets admission to non-accepting (`src/auth/admission.rs:563-578`). A handshake arriving during that interval is deliberately given no admission lease (`src/server.rs:4894-4907`). Its fallback branch resolves authority, discards the returned publication fence, then separately rereads the incarnation (`src/server.rs:5951-6014`). Because there is no admission or prepared authority, response wrapping retains no fence through body publication (`src/server.rs:4990-5017`).

This admits both a predecessor response after the transition and an internally mixed response if the incarnation changes between authority resolution and the second read.

*Resolves with:* Distinguish stable committed pending mode from transient transition-owned closure. Refuse the transient case, or retain a special diagnostic admission/publication lease and one prepared authority through the response body.

4. **MATERIAL — A fresh anonymous handshake can be cached under a peer-installed authenticated authority.**

On fresh boot, the kit fetches an anonymous handshake and then calls `establishAnonymous` (`demos/_kit/client.mjs:1053-1064`). If another context installs authenticated custody during that fetch, `establishAnonymous` simply reads and adopts the existing settled record without comparing it to the supplied anonymous authority (`packages/snapback-contract/auth-coordinator.mjs:540-571`). The kit then caches the original anonymous response under the returned authenticated capture (`demos/_kit/client.mjs:998-1004`, `1057-1064`).

The result is an anonymous projection and descriptor labeled current for an authenticated custody epoch, contrary to the boot requirement to compare returned projection, incarnation, and mode before exposure (`llp/0059-session-projection-and-client-barrier.spec.md:1401-1409`, `1593-1599`).

*Resolves with:* Make `establishAnonymous` return a distinct “existing custody adopted” result and force a new bearer-authenticated handshake, or require exact equality between the fetched authority and the record being adopted before caching.

5. **MATERIAL — The localStorage client store contradicts the frozen generation-segmented fallback requirement.**

Frozen LLP 0039 requires generation-segmented namespaces wherever the store cannot provide a conditional transaction (`llp/0039-auth-vertical-slice.rfc.md:1578-1582`). LLP 0059 is even more explicit: a localStorage adapter must not implement read-then-`setItem` CAS or maintain a mutable current key (`llp/0059-session-projection-and-client-barrier.spec.md:1455-1466`).

The shipped adapter serializes through Web Locks but still reads and replaces one mutable localStorage key (`packages/snapback-contract/client-store.mjs:2937-2977`). That is exactly the representation the Spec forbids; it is not the immutable `(appIdHash, authorityEpoch, authorityKey)` namespace described by the document.

*Resolves with:* Implement immutable generation-segmented keys derived solely from settled custody, or remove localStorage as a sessions-mode store and use a transactional adapter. Add the required delayed-old-writer test against the actual adapter.

6. **MATERIAL — Crash recovery cannot preserve the frozen same-principal transition semantics.**

The custody record persists only the pending successor during clearing (`llp/0059-session-projection-and-client-barrier.spec.md:1117-1142`). The implementation likewise removes the current authority when writing clearing (`packages/snapback-contract/auth-coordinator.mjs:880-900`). Recovery therefore hardcodes `previousAuthority: null` and `disposition: delete` (`packages/snapback-contract/auth-coordinator.mjs:947-958`).

The durable store maps an unknown predecessor to full deletion (`packages/snapback-contract/client-store.mjs:3005-3015`, `3068-3095`), and the test explicitly expects all same-user private state to be deleted after recovery (`packages/snapback-contract/client-store-authority.test.mjs:926-963`). That contradicts both LLP 0059’s same-user/new-session preservation row and acceptance criterion (`llp/0059-session-projection-and-client-barrier.spec.md:1364-1382`, `1829-1832`) and frozen LLP 0039’s same-principal rule (`llp/0039-auth-vertical-slice.rfc.md:1068-1074`).

*Resolves with:* Version custody to persist the minimum secret-free predecessor classification needed to recover the exact transition disposition. A blanket crash-recovery deletion exception would require an explicit governing LLP 0039 decision; LLP 0059 cannot silently introduce it.

7. **MATERIAL — The current client-store migration is not the exact fail-closed migrator the Spec claims.**

LLP 0059 says formats 1–4 are accepted only through exact identifiable predecessor shapes (`llp/0059-session-projection-and-client-barrier.spec.md:1421-1428`, `1481-1486`), consistent with LLP 0043’s complete-shape requirement (`llp/0043-offline-replay-retention.rfc.md:243-257`).

Code has explicit exact top-level recognition only for the two format-4 shapes (`packages/snapback-contract/client-store.mjs:610-659`). Any object marked version 1, 2, or 3 is immediately promoted to version 5 (`packages/snapback-contract/client-store.mjs:661-685`), missing fields are synthesized (`packages/snapback-contract/client-store.mjs:704-732`), and unknown top-level fields are removed only for ambiguous format 4 (`packages/snapback-contract/client-store.mjs:997-1021`).

The same chapter also claims every privacy-bearing format-5 record carries epoch/key tags (`llp/0059-session-projection-and-client-barrier.spec.md:1430-1433`), while current validation explicitly permits both to be absent and instead validates modern principal/descriptor axes (`packages/snapback-contract/client-store.mjs:481-505`, `573-596`).

*Resolves with:* Add closed shape validators for formats 1–3, reject or quarantine partial/extended forms before migration, and rewrite the record-tag claim to reflect LLP 0043’s current two-axis model. Add adversarial extended, truncated, and hybrid fixtures for every legacy version.

8. **MATERIAL — Contract reports `resume` complete before reconstruction and readiness complete.**

The Spec says local `resume` obtains a fresh handshake/grant and resubscribes, with exposure resuming only after mandatory participants report readiness (`llp/0059-session-projection-and-client-barrier.spec.md:1348-1355`, `1540-1550`).

The coordinator writes settled custody and awaits participant `resume` before unpausing publication (`packages/snapback-contract/auth-coordinator.mjs:984-1001`). Contract’s participant, however, merely schedules a zero-delay refresh and returns (`packages/snapback-contract/index.mjs:2239-2287`, `3697-3733`). Handshake, snapshot, and live reconstruction happen later; failures are swallowed into a blank surface rather than reported to the coordinator (`packages/snapback-contract/index.mjs:1938-2121`, `3585-3694`).

This is fail-closed at the surface, but it is not the specified awaited barrier. It also exposes an internal contradiction: custody is already settled before the `resume` phase, so the acceptance claim that a throw in “each participant phase” leaves custody clearing cannot literally cover `resume` (`llp/0059-session-projection-and-client-barrier.spec.md:1792-1812`).

*Resolves with:* Decide explicitly between an awaited reconstruction barrier and a two-tier design with durable settlement followed by asynchronous, per-surface readiness. Then make the API, failure state, retry ownership, and acceptance traces match that choice.

9. **MATERIAL — Readiness facts are asserted rather than derived from the specified probes and evidence.**

The Spec says the three item-5 readiness facts become true only when their implementation and executable probes are installed, and every acceptance is prerequisite (`llp/0059-session-projection-and-client-barrier.spec.md:1610-1640`, `1676-1687`, `1879-1883`).

Production passes literal `true` for connection binding, two-phase revocation, and coordinator readiness (`src/cli.rs:327-340`) before constructing the coordinator (`src/cli.rs:1568-1602`) or starting the expiry worker (`src/cli.rs:1669-1681`). Activation is derived directly from those booleans (`src/auth/mode.rs:368-395`). Later startup failure still aborts before listener bind, which mitigates runtime risk, but the readiness object cannot establish the executable-evidence claim made by this Spec.

*Resolves with:* Either make these truthful structural/runtime facts set only after their components are installed, or define them as trusted compile-time composition assertions and maintain a separately enforced CI evidence manifest mapping every acceptance to a test/failpoint.

10. **MINOR — Reset publication order is the reverse of the implementation-derived normative sequence.**

The Spec installs/finalizes the successor stream and only then invalidates predecessor grants and effects (`llp/0059-session-projection-and-client-barrier.spec.md:994-1014`). Code deliberately terminalizes predecessor grants while the stream ticket remains installed (`src/server.rs:9316-9327`), publishes reset-owned successor state next (`src/server.rs:9328-9422`), and calls `finish_stream_reset` last (`src/server.rs:9423-9437`). Projection clearing, incarnation replacement, and ticket removal occur together in that final call (`src/auth/session_projection.rs:1811-1842`).

The implementation remains fail-closed, but an “exact choreography” Spec cannot state the opposite order.

*Resolves with:* Rewrite the reset sequence to describe early predecessor terminalization under the still-blocked stream and the final atomic projection-clear/incarnation/ticket cut.

11. **MINOR — The public credential-classification prose contradicts superseded recovery.**

The Spec says public finite lookup does not reveal whether a token is current, superseded, revoked, or absent (`llp/0059-session-projection-and-client-barrier.spec.md:1670-1674`). Elsewhere it requires an outside-grace superseded token to return `SNAPBACK_AUTH_CREDENTIAL_SUPERSEDED` (`llp/0059-session-projection-and-client-barrier.spec.md:584-591`, `1724-1728`), which is what the implementation does (`src/auth/coordinator.rs:774-806`).

*Resolves with:* Limit the uniform-invalid posture to malformed, unknown, revoked, and expired credentials, and name superseded recovery as the deliberate exception.

12. **MINOR — The normative projection model omits state needed to reproduce shipped classification.**

The logical sketch includes only Current and Superseded token-index entries and omits the session’s current-token owner (`llp/0059-session-projection-and-client-barrier.spec.md:222-264`). Shipped state includes `current_token`, `authority_instance_id`, and Terminal/Unavailable token entries (`src/auth/session_projection.rs:279-303`, `385-399`). Those states determine finite resolution and whether known blocked tokens consume their exact session throttle rather than the unknown-token bucket (`src/auth/session_projection.rs:923-1030`; `src/server.rs:1961-1988`).

Equivalent Rust layout is allowed, but these observable classification and accounting rules are not optional implementation details.

*Resolves with:* Expand the logical model or normative invariants to specify current-token ownership, terminal/unavailable digest retention, and their exact finite/grant-open/throttle behavior.

## Suggestions

- Split the document into a stable item-5 protocol core and a short composed-production appendix. Historical format 3, current format 5, and later item-6/7/8 behavior are currently interleaved enough to obscure ownership.

- Add a traceability table mapping every executable acceptance item to a concrete test, failpoint, readiness fact, and implementation choke point.

- Model the server ticket machine and browser custody/barrier machine as small executable state machines. Generating adversarial traces from one model would be especially valuable for ambiguous commit, dropped wakeup, lease theft, and crash-recovery cases.

- Provide sequence diagrams for the three hardest cuts: mode transition versus `/auth/session`, peer custody transition versus inbound callbacks, and clearing crash recovery. These relationships are difficult to reconstruct from prose alone.

- Enforce the stated one-coordinator-per-app/context rule through a canonical factory or registry, rather than relying on callers not to construct competing local participant sets.

## Open questions

- Is the terminal transport contract “a 4401 close frame by the deadline” or “hard transport teardown by the deadline, with 4401 best effort”? Client behavior and acceptance tests must use the same answer.

- What minimum predecessor metadata may be persisted in clearing custody so crash recovery can honor the frozen same-principal and anonymous-to-authenticated dispositions?

- Is Contract reconstruction part of the coordinator’s awaited `resume`, or an explicitly asynchronous post-settle readiness phase? What durable/local state represents failure in the latter design?

- Are the three item-5 readiness fields runtime/structural probes, compile-time composition facts, or attestations of CI evidence?

- Should `/auth/session` be refused during transient transition-owned admission closure, or should it carry a special publication lease distinct from ordinary app admission?

## Readiness verdict

**NOT READY.** The stale cross-context publication window, terminal reconnect/clearing failure, unfenced handshake path, localStorage contradiction, and crash-recovery disposition loss undermine the document’s central authority-barrier claims and frozen LLP 0039 outcomes. Those defects require implementation and protocol reconciliation before ratification; the MINOR model and wording corrections should land with that work.
## Round 2 — 2026-07-14

**Revision under review:** `llp/0059-session-projection-and-client-barrier.spec.md`, sha256 `d78399dcc37cca8a6f385519405149aa89d1ffa62e3bc1634e6cdc5b2a799d3c` (committed at repo HEAD `b11a6fa`)
**Runtime detail:** OpenAI Codex CLI v0.144.4 (`codex exec`, non-interactive), model gpt-5.6-sol, reasoning effort ultra, read-only sandbox, session id 019f637b-fe34-79d1-9439-5a2f7d371c86; 529,331 tokens used; fresh session, blind to all archived reviews and to the concurrent Fable-family round; orchestrated by /llp-super-refine
**Verdict:** NOT READY

### Review body (verbatim)

## 1. Overall assessment

The proposal’s core architecture is sound: durable server authority, exact act-time publication fences, and a client-wide epoch barrier are the right primitives. The grant/outbox work is particularly strong, and the acceptance plan is unusually concrete.

However, LLP 0059 is not ready for ratification. It currently mixes an aspirational protocol, historical item-5 behavior, composed production behavior, and claims that the implementation and readiness evidence have landed. Several load-bearing guarantees are contradicted by the implementation; two server traces can violate restart/restore guarantees; and the browser barrier lacks a coherent durable and cross-context completion protocol.

## 2. Strengths

- The authority model is precise. [§Connection-bound authority](/Users/ccheever/projects/snapback/llp/0059-session-projection-and-client-barrier.spec.md:599) separates readable connection identity from immutable grant authority, while [§Act-time validation](/Users/ccheever/projects/snapback/llp/0059-session-projection-and-client-barrier.spec.md:709) requires a final synchronous publication cut. Exact grant identity, reverse invalidation, and registry-held handoff are substantively implemented in [src/server.rs](/Users/ccheever/projects/snapback/src/server.rs:990), [src/server.rs](/Users/ccheever/projects/snapback/src/server.rs:1896), and [src/server.rs](/Users/ccheever/projects/snapback/src/server.rs:2593).

- [§Durable and ephemeral outboxes](/Users/ccheever/projects/snapback/llp/0059-session-projection-and-client-barrier.spec.md:914) gives a credible leased-delivery protocol: recovery markers win, acknowledgement follows ownership transfer, and HTTP’s first-body cut is explicit. The queue selection and acknowledgement machinery in [src/ephemeral.rs](/Users/ccheever/projects/snapback/src/ephemeral.rs:2286) and [src/ephemeral.rs](/Users/ccheever/projects/snapback/src/ephemeral.rs:2399), plus HTTP fencing in [src/server.rs](/Users/ccheever/projects/snapback/src/server.rs:5220), largely match that design.

- The client model correctly identifies delayed success as dangerous, not merely delayed failure. [§Authority identity and captures](/Users/ccheever/projects/snapback/llp/0059-session-projection-and-client-barrier.spec.md:1093) and [§Coordinator interface](/Users/ccheever/projects/snapback/llp/0059-session-projection-and-client-barrier.spec.md:1223) make authority capture and final compare-and-commit central rather than treating logout as a cache clear.

- The document is honest about browser limits. [§Durable custody record](/Users/ccheever/projects/snapback/llp/0059-session-projection-and-client-barrier.spec.md:1208) explicitly declines to claim IndexedDB protects against same-origin XSS, and [§Cross-context ownership](/Users/ccheever/projects/snapback/llp/0059-session-projection-and-client-barrier.spec.md:1296) avoids pretending one tab can synchronously blank every suspended peer.

- The independent capability axes in [§Independent item-5 availability axes](/Users/ccheever/projects/snapback/llp/0059-session-projection-and-client-barrier.spec.md:1547) compose correctly with LLP 0053/0043. The server negotiates later-item axes independently in [src/auth/handshake.rs](/Users/ccheever/projects/snapback/src/auth/handshake.rs:373), and the format-5 store has real independent authority, queue, and retention state in [client-store.mjs](/Users/ccheever/projects/snapback/packages/snapback-contract/client-store.mjs:649).

- [§Executable acceptance](/Users/ccheever/projects/snapback/llp/0059-session-projection-and-client-barrier.spec.md:1739) appropriately calls for deterministic schedulers and failpoints rather than timing-based race tests. That is the right standard for this protocol.

## 3. Concerns

### 1. MATERIAL — The durable-time design does not make terminal authority irreversible

[§Durable session clock floor](/Users/ccheever/projects/snapback/llp/0059-session-projection-and-client-barrier.spec.md:321) says maintenance persists progress only up to its cadence, but then concludes that once a generation terminalizes at epoch `E`, the floor has been committed and restart cannot revive it. [§Operation-specific publication](/Users/ccheever/projects/snapback/llp/0059-session-projection-and-client-barrier.spec.md:455) consequently makes expiry write-free.

The implementation raises only an in-memory atomic in [AuthProvider::now_ms](/Users/ccheever/projects/snapback/src/auth/provider.rs:830). The expiry worker terminalizes directly in memory in [src/auth/runtime.rs](/Users/ccheever/projects/snapback/src/auth/runtime.rs:383) and [src/auth/session_projection.rs](/Users/ccheever/projects/snapback/src/auth/session_projection.rs:863); durable persistence happens later during GC in [src/storage/auth.rs](/Users/ccheever/projects/snapback/src/storage/auth.rs:502). Therefore:

- a forward jump can terminalize a session, followed by a crash before GC, after which a lower clock rebuilds it as current; and
- if the monotonic deadline fires while wall time has moved backward, GC can persist only the lower sampled epoch rather than the elapsed session deadline, so even GC followed by restart can revive the generation.

Declared restore has the inverse failure. Startup passes raw `SystemTime::now()` into restore before seeding from the durable floor in [src/cli.rs](/Users/ccheever/projects/snapback/src/cli.rs:1474). Restore writes that value as `revoked_at_ms` in [src/storage/auth.rs](/Users/ccheever/projects/snapback/src/storage/auth.rs:624), while rebuild rejects a revocation earlier than creation in [src/auth/session_projection.rs](/Users/ccheever/projects/snapback/src/auth/session_projection.rs:647). The declaration is removed before rebuild in [src/auth/lifecycle.rs](/Users/ccheever/projects/snapback/src/auth/lifecycle.rs:230). A backup created at time 100 and restored under clock 50 can therefore be durably rendered projection-corrupt with its retry declaration already gone.

**Resolution criterion:** Before publishing any time-derived terminal event, durably advance a shared frontier to at least the authoritative deadline or durably record that generation’s terminality. Restore must derive its timestamp from durable state and guarantee it is at least every affected session’s creation timestamp. Add deterministic crash tests for forward-jump expiry, monotonic expiry under backward wall time, and restore under a lower host clock.

### 2. MATERIAL — LLP 0057 and LLP 0059 specify different public outcomes for commit ambiguity

LLP 0059 says it consumes LLP 0057’s provider protocol “without re-owning” it in [§Scope](/Users/ccheever/projects/snapback/llp/0059-session-projection-and-client-barrier.spec.md:111). LLP 0057 nevertheless requires plaintext successor/code state to be discarded and an unavailable result returned after an initially unknown commit outcome in [§Concurrency, locks, and linearization](/Users/ccheever/projects/snapback/llp/0057-auth-provider-protocol.spec.md:1179).

By contrast, LLP 0059’s [§Rollback and ambiguous commit](/Users/ccheever/projects/snapback/llp/0059-session-projection-and-client-barrier.spec.md:428) finalizes an exact durable successor. The code follows LLP 0059: rotation maps an exact successor back to committed in [src/auth/provider.rs](/Users/ccheever/projects/snapback/src/auth/provider.rs:1369), then returns the retained plaintext successor in [src/auth/coordinator.rs](/Users/ccheever/projects/snapback/src/auth/coordinator.rs:649). Issuance does the same in [src/auth/provider.rs](/Users/ccheever/projects/snapback/src/auth/provider.rs:3430).

Exact-successor recovery may be a reasonable refinement, but there cannot be two normative public-response rules for the same provider operation.

**Resolution criterion:** Choose the owning rule explicitly. If exact durable proof permits publishing the retained successor, revise or supersede LLP 0057 and specify the proof and plaintext-custody requirements. Otherwise discard the carrier after every initially ambiguous commit. Before-/after-commit fault tests must assert the selected public response.

### 3. MATERIAL — Auth-client protocol 1 is advertised without the required coordinator

[§Authority identity and captures](/Users/ccheever/projects/snapback/llp/0059-session-projection-and-client-barrier.spec.md:1095) requires one coordinator per app/partition, and [§Contract and kit barrier participation](/Users/ccheever/projects/snapback/llp/0059-session-projection-and-client-barrier.spec.md:1619) says `setBearerToken` is no longer a local token swap. Protocol 1 is supposed to represent completion of that sequence.

The kit instead defaults `authClientProtocol` to `1` while defaulting `authCoordinator` to `null` in [demos/_kit/client.mjs](/Users/ccheever/projects/snapback/demos/_kit/client.mjs:808). It has a full uncoordinated handshake path at [client.mjs](/Users/ccheever/projects/snapback/demos/_kit/client.mjs:891), permits local bearer replacement at [client.mjs](/Users/ccheever/projects/snapback/demos/_kit/client.mjs:945), and returns request results without a final authority commit when no coordinator exists at [client.mjs](/Users/ccheever/projects/snapback/demos/_kit/client.mjs:1404). Contract likewise treats a missing coordinator as successful direct commit in [packages/snapback-contract/index.mjs](/Users/ccheever/projects/snapback/packages/snapback-contract/index.mjs:231). The handshake suite positively tests a sessions mutation using protocol 1, an injected bearer, and no coordinator in [auth-handshake.mjs](/Users/ccheever/projects/snapback/demos/_kit/tests/auth-handshake.mjs:98).

**Resolution criterion:** The bundled client may offer protocol 1 only after installing canonical per-app custody, a singleton coordinator, and mandatory participants. A no-coordinator client must offer no compatible sessions protocol and must fail closed. Add default-construction and two-context tests that prove this invariant.

### 4. MATERIAL — Durable transition state is insufficient across crashes and contexts

The exact custody shape in [§Durable custody record](/Users/ccheever/projects/snapback/llp/0059-session-projection-and-client-barrier.spec.md:1162) removes the predecessor during `clearing` and retains only the successor. That cannot reproduce all rows in the transition table, particularly same-user/new-session preservation.

The implementation demonstrates the loss:

- The clearing write drops predecessor identity in [auth-coordinator.mjs](/Users/ccheever/projects/snapback/packages/snapback-contract/auth-coordinator.mjs:893).
- Recovery reconstructs `previousAuthority: null` in [auth-coordinator.mjs](/Users/ccheever/projects/snapback/packages/snapback-contract/auth-coordinator.mjs:969).
- The store maps an unknown predecessor to delete-all in [client-store.mjs](/Users/ccheever/projects/snapback/packages/snapback-contract/client-store.mjs:3005).
- A production test explicitly expects same-user/new-session crash recovery to delete the queue and retained state in [client-store-authority.test.mjs](/Users/ccheever/projects/snapback/packages/snapback-contract/client-store-authority.test.mjs:870), contradicting the ordinary table and its acceptance claim.

Cross-context completion is also not durable. Online peer adoption explicitly skips `commitDurable` in [auth-coordinator.mjs](/Users/ccheever/projects/snapback/packages/snapback-contract/auth-coordinator.mjs:1096), while physical-store registration is only a realm-local `WeakMap` in [index.mjs](/Users/ccheever/projects/snapback/packages/snapback-contract/index.mjs:113). If tab A owns the transition but has no Contract store, a suspended tab B’s physical store remains at the predecessor epoch. Participant unregistration can similarly mark an entry removed before its durable phase and later loops skip it in [auth-coordinator.mjs](/Users/ccheever/projects/snapback/packages/snapback-contract/auth-coordinator.mjs:918).

**Resolution criterion:** Persist a versioned transition intent containing predecessor and successor authority, classification/disposition, epoch, and transition identity. Every physical store must idempotently record application of that intent before exposure, regardless of which tab initiated it. Mandatory participants must remain phase-eligible until durable completion. Crash tests must reproduce every transition-table row exactly; if conservative deletion is intentional, the Spec must explicitly ratify that data-loss policy.

### 5. MATERIAL — The barrier lacks a coherent ownership cut between durable settle and online resume

[§Transition barrier](/Users/ccheever/projects/snapback/llp/0059-session-projection-and-client-barrier.spec.md:1365) says exclusive ownership spans the durable transition, while phase 9 requires fresh handshake, grant, resubscription, and participant readiness before exposure. But those participant operations ultimately use `compareAndCommit`, which reacquires custody ownership under [§Coordinator interface](/Users/ccheever/projects/snapback/llp/0059-session-projection-and-client-barrier.spec.md:1252).

The implementation holds `withOwnership` around the entire transition in [auth-coordinator.mjs](/Users/ccheever/projects/snapback/packages/snapback-contract/auth-coordinator.mjs:869) and awaits `resume` before returning in [auth-coordinator.mjs](/Users/ccheever/projects/snapback/packages/snapback-contract/auth-coordinator.mjs:1013). A genuine Contract resume would deadlock when it re-entered the same Web Lock. Contract avoids this by scheduling its refresh and returning immediately in [index.mjs](/Users/ccheever/projects/snapback/packages/snapback-contract/index.mjs:2205) and [index.mjs](/Users/ccheever/projects/snapback/packages/snapback-contract/index.mjs:2388), allowing the coordinator to report transition success before the mandatory surface is ready.

This long ownership interval also blocks peers. A clearing wake merely sets `publicationPaused` and asynchronously waits for ownership in [auth-coordinator.mjs](/Users/ccheever/projects/snapback/packages/snapback-contract/auth-coordinator.mjs:1265); it does not synchronously blank existing boundaries. The owner may meanwhile hold the lock across the resume handshake, and refresh explicitly holds it across an unbounded network request in [auth-coordinator.mjs](/Users/ccheever/projects/snapback/packages/snapback-contract/auth-coordinator.mjs:771). The required `pageshow`, visibility, and focus gates are not installed by the constructor at [auth-coordinator.mjs](/Users/ccheever/projects/snapback/packages/snapback-contract/auth-coordinator.mjs:462).

**Resolution criterion:** Define an explicit phase-8 ownership release. Durable custody may settle under ownership, but all contexts must remain locally blank until successor-fenced readiness completes after release. No network request may hold the cross-context mutex. Wake and lifecycle handlers must synchronously pause/blank before awaiting durable reload. Tests must cover a hung network resume, dropped broadcast, frozen peer, and focus/pageshow before successor exposure.

### 6. MATERIAL — A close-code-only terminal event reconnects instead of clearing

[§Typed terminal auth error](/Users/ccheever/projects/snapback/llp/0059-session-projection-and-client-barrier.spec.md:995) requires either the typed frame or close code to suppress reconnect and run captured-authority `compareAndClear`. The server emits close code `4401` with reason `auth_error` in [src/server.rs](/Users/ccheever/projects/snapback/src/server.rs:10333).

The managed client handles terminal auth only in its message branch. Its close handler discards `CloseEvent` details in [client.mjs](/Users/ccheever/projects/snapback/demos/_kit/client.mjs:3784), and generic loss always schedules reconnect in [client.mjs](/Users/ccheever/projects/snapback/demos/_kit/client.mjs:3800). The raw stream also ignores close details in [client.mjs](/Users/ccheever/projects/snapback/demos/_kit/client.mjs:2200). Thus losing the frame but receiving the mandated close produces exactly the generic reconnect loop the Spec says is closed.

**Resolution criterion:** Both live APIs must terminal-latch `4401/auth_error`, suppress reconnect, clear only the captured current authority, and ignore a delayed A close after B settles. Add close-without-frame and delayed-close race tests.

### 7. MATERIAL — The closed handshake cannot prove its claimed identity boundary

[§Bootstrap response revision](/Users/ccheever/projects/snapback/llp/0059-session-projection-and-client-barrier.spec.md:1644) requires canonical UUIDv7 incarnation values, and handshake acceptance requires cross-app values to fail in [§Handshake and activation](/Users/ccheever/projects/snapback/llp/0059-session-projection-and-client-barrier.spec.md:1910).

The exact response DTO contains no app or deployment identity in [src/auth/handshake.rs](/Users/ccheever/projects/snapback/src/auth/handshake.rs:234). The client validator rejects unknown fields and therefore cannot receive such proof in [client.mjs](/Users/ccheever/projects/snapback/demos/_kit/client.mjs:566). A coordinator’s `appId` is merely local configuration, so a client pointed at the wrong app accepts that app’s incarnation under its locally chosen id. Cross-app rejection is impossible under the current closed shape.

Canonical identity is also under-enforced: the Rust schema requires only nonempty session/user/incarnation strings in [src/auth/handshake.rs](/Users/ccheever/projects/snapback/src/auth/handshake.rs:119), and the kit performs the same nonempty-string checks in [client.mjs](/Users/ccheever/projects/snapback/demos/_kit/client.mjs:593).

**Resolution criterion:** Add a server-proven canonical app/deployment identity and validate it before any custody transition, likely through a revised protocol version. Validate canonical UUIDv7 spelling for stream, session, and user identifiers at the wire projection boundary. Add wrong-app, wrong-version, uppercase, and noncanonical UUID tests.

### 8. MATERIAL — The handshake is not consistently captured and final-fenced

[§Bootstrap response revision](/Users/ccheever/projects/snapback/llp/0059-session-projection-and-client-barrier.spec.md:1652) requires authority projection and incarnation to come from one prepared authority. In the admission-closed path, the server resolves the bearer and discards its `FencedPublication` in [src/server.rs](/Users/ccheever/projects/snapback/src/server.rs:6172), separately rereads the current incarnation in [src/server.rs](/Users/ccheever/projects/snapback/src/server.rs:6202), and returns unfenced JSON in [src/server.rs](/Users/ccheever/projects/snapback/src/server.rs:6230). A reset/revoke between those steps can produce a hybrid or stale response. The associated test explicitly expects no prepared authority or admission lease while pending in [src/server.rs](/Users/ccheever/projects/snapback/src/server.rs:14482).

The client side has the same gap. Cached handshake reads use only in-memory capture equality in [client.mjs](/Users/ccheever/projects/snapback/demos/_kit/client.mjs:891), and post-network coordinated completion checks only `isCurrent` before caching in [client.mjs](/Users/ccheever/projects/snapback/demos/_kit/client.mjs:1095), despite the Spec defining `isCurrent` as a hint. Pending/unavailable handshakes are cached and thrown as availability errors without running the required blank barrier.

**Resolution criterion:** Carry one prepared authority and incarnation through the response’s final body-publication fence, including diagnostic mode, or retry/refuse. Client cache reads and post-await completion must pass a durable compare-and-commit. Pending/unavailable mode must enter a custody-preserving blank barrier. Add reset/revoke-at-body-handoff and missed-broadcast-during-handshake tests.

### 9. MATERIAL — Readiness is asserted rather than derived from the required evidence

[§Allowed order](/Users/ccheever/projects/snapback/llp/0059-session-projection-and-client-barrier.spec.md:536) requires test/dev lock-rank assertions. [§Readiness facts](/Users/ccheever/projects/snapback/llp/0059-session-projection-and-client-barrier.spec.md:1669) and [§Handshake and activation](/Users/ccheever/projects/snapback/llp/0059-session-projection-and-client-barrier.spec.md:1912) require each omitted module, wiring edge, or worker to keep its fact false, and [§Implementation handoff](/Users/ccheever/projects/snapback/llp/0059-session-projection-and-client-barrier.spec.md:1942) claims real probes landed.

The relevant locks remain raw mutexes in [src/auth/session_projection.rs](/Users/ccheever/projects/snapback/src/auth/session_projection.rs:401), [src/auth/coordinator.rs](/Users/ccheever/projects/snapback/src/auth/coordinator.rs:1052), and [src/server.rs](/Users/ccheever/projects/snapback/src/server.rs:941); no rank facility or inversion assertion is present. Production readiness passes literal `true` values for connection binding, two-phase revocation, and auth coordinator in [src/cli.rs](/Users/ccheever/projects/snapback/src/cli.rs:327). Its test verifies those literals rather than omission/failure behavior in [src/cli.rs](/Users/ccheever/projects/snapback/src/cli.rs:3406).

**Resolution criterion:** Implement rank-aware dev/test guards with intentional inversion failures and connect each readiness fact to executable module/wiring/worker probes. Otherwise distinguish static build facts from runtime readiness, remove the landed-evidence claim, and keep the affected fact false.

### 10. MATERIAL — The specified localStorage protocol is the opposite of the implementation and governing LLP

[§Format 3 and authority tags](/Users/ccheever/projects/snapback/llp/0059-session-projection-and-client-barrier.spec.md:1514) says a localStorage adapter MUST use immutable generation-segmented namespaces and MUST NOT use read-then-`setItem` or a mutable current pointer. Acceptance requires the segmented stale-writer proof in [§Client store and Contract boundaries](/Users/ccheever/projects/snapback/llp/0059-session-projection-and-client-barrier.spec.md:1881).

The actual adapter reads and overwrites one mutable key with `storage.setItem(key, JSON.stringify(state))` under a Web Lock in [client-store.mjs](/Users/ccheever/projects/snapback/packages/snapback-contract/client-store.mjs:2937). Governing LLP 0008 explicitly ratifies this one-key load/modify/save protocol in [§Serialization](/Users/ccheever/projects/snapback/llp/0008-local-first-sync-and-realtime.rfc.md:427).

**Resolution criterion:** Either implement immutable epoch/key-segmented namespaces and their stale-writer/GC acceptance, or revise LLP 0059 with a complete proof for the Web-Lock design and reconcile LLP 0008. The implementation, governing RFC, and acceptance suite must specify one protocol.

## 4. Suggestions

- Replace the mutable clearing record with an append-only transition journal containing transition id, predecessor, successor, disposition, and per-store applied epoch. Custody can be a derived current pointer, while recovery and peer catch-up remain exact.

- Split client transition into two cuts: a short durable custody cut under cross-context ownership, followed by local successor preparation while blank. Publish local readiness atomically only after handshake/store/surface preparation succeeds.

- Make protocol support an installed capability object produced by the canonical coordinator factory, rather than a numeric constructor default that can exist without its implementation.

- Commit one global time frontier before terminalizing a batch of due sessions. This preserves batching without requiring a separate session-row write for every expiry.

- Since the document remains Draft, introduce a revised handshake protocol now with explicit app/deployment identity instead of preserving an under-specified closed v1 shape.

- Add a conformance table mapping every readiness fact to its implementation edge, failpoint test, and negative omission test. Remove “landed” claims until every row is evidenced.

- Correct Grants acceptance item 2: it currently says revoked, expired, malformed, and random bearers are indistinguishable, contradicting [§Diagnostics and safe exposure](/Users/ccheever/projects/snapback/llp/0059-session-projection-and-client-barrier.spec.md:1729) and LLP 0057’s deliberate `AUTH_REQUIRED` versus `SESSION_EXPIRED` distinction.

## 5. Open questions

1. After an initially ambiguous credential commit, is exact durable successor proof sufficient to release the retained plaintext credential, or is LLP 0057’s unavailable outcome still authoritative?

2. Must crash recovery preserve every transition-table disposition exactly, or is conservative delete-all an accepted data-loss policy?

3. What precisely constitutes transition success: settled custody, all local durable commits, or completed handshake/grant/resubscription for every mandatory local surface?

4. Who applies a physical client-store transition when the initiating tab has no instance of that store and the owning tab is suspended?

5. Which operations may perform network I/O while holding custody ownership? If any remain, what is their hard liveness bound and takeover mechanism under Web Locks?

6. What server identity must the handshake bind: canonical app id, database identity, deployment identity, origin, or a tuple of these?

7. Which durable mechanism closes monotonic-deadline expiry across restart without imposing unacceptable write amplification?

8. Are readiness fields static build facts or live process facts? How does a server prove the client coordinator package and its mandatory participants are actually present?

## 6. Readiness verdict

Not ready. The server time frontier, restore path, client protocol negotiation, crash/cross-context transition recovery, terminal close handling, handshake identity/fencing, readiness proof, and localStorage protocol all have unresolved material correctness or coherence problems.

READINESS VERDICT: NOT READY
## Round 2 — 2026-07-14

**Revision under review:** `llp/0059-session-projection-and-client-barrier.spec.md`, sha256 `d78399dcc37cca8a6f385519405149aa89d1ffa62e3bc1634e6cdc5b2a799d3c` (committed at repo HEAD `b11a6fa`)
**Runtime detail:** OpenAI Codex CLI v0.144.4 (`codex exec`, non-interactive), model gpt-5.6-sol, reasoning effort ultra, read-only sandbox; fresh session, blind to all archived reviews and to the concurrent Fable-family round; orchestrated by /llp-super-refine
**Verdict:** NOT READY

### Review body (verbatim)

## 1. Overall assessment

The proposal’s core architecture is sound: durable server authority, exact act-time publication fences, and a client-wide epoch barrier are the right primitives. The grant/outbox work is particularly strong, and the acceptance plan is unusually concrete.

However, LLP 0059 is not ready for ratification. It currently mixes an aspirational protocol, historical item-5 behavior, composed production behavior, and claims that the implementation and readiness evidence have landed. Several load-bearing guarantees are contradicted by the implementation; two server traces can violate restart/restore guarantees; and the browser barrier lacks a coherent durable and cross-context completion protocol.

## 2. Strengths

- The authority model is precise. [§Connection-bound authority](/Users/ccheever/projects/snapback/llp/0059-session-projection-and-client-barrier.spec.md:599) separates readable connection identity from immutable grant authority, while [§Act-time validation](/Users/ccheever/projects/snapback/llp/0059-session-projection-and-client-barrier.spec.md:709) requires a final synchronous publication cut. Exact grant identity, reverse invalidation, and registry-held handoff are substantively implemented in [src/server.rs](/Users/ccheever/projects/snapback/src/server.rs:990), [src/server.rs](/Users/ccheever/projects/snapback/src/server.rs:1896), and [src/server.rs](/Users/ccheever/projects/snapback/src/server.rs:2593).

- [§Durable and ephemeral outboxes](/Users/ccheever/projects/snapback/llp/0059-session-projection-and-client-barrier.spec.md:914) gives a credible leased-delivery protocol: recovery markers win, acknowledgement follows ownership transfer, and HTTP’s first-body cut is explicit. The queue selection and acknowledgement machinery in [src/ephemeral.rs](/Users/ccheever/projects/snapback/src/ephemeral.rs:2286) and [src/ephemeral.rs](/Users/ccheever/projects/snapback/src/ephemeral.rs:2399), plus HTTP fencing in [src/server.rs](/Users/ccheever/projects/snapback/src/server.rs:5220), largely match that design.

- The client model correctly identifies delayed success as dangerous, not merely delayed failure. [§Authority identity and captures](/Users/ccheever/projects/snapback/llp/0059-session-projection-and-client-barrier.spec.md:1093) and [§Coordinator interface](/Users/ccheever/projects/snapback/llp/0059-session-projection-and-client-barrier.spec.md:1223) make authority capture and final compare-and-commit central rather than treating logout as a cache clear.

- The document is honest about browser limits. [§Durable custody record](/Users/ccheever/projects/snapback/llp/0059-session-projection-and-client-barrier.spec.md:1208) explicitly declines to claim IndexedDB protects against same-origin XSS, and [§Cross-context ownership](/Users/ccheever/projects/snapback/llp/0059-session-projection-and-client-barrier.spec.md:1296) avoids pretending one tab can synchronously blank every suspended peer.

- The independent capability axes in [§Independent item-5 availability axes](/Users/ccheever/projects/snapback/llp/0059-session-projection-and-client-barrier.spec.md:1547) compose correctly with LLP 0053/0043. The server negotiates later-item axes independently in [src/auth/handshake.rs](/Users/ccheever/projects/snapback/src/auth/handshake.rs:373), and the format-5 store has real independent authority, queue, and retention state in [client-store.mjs](/Users/ccheever/projects/snapback/packages/snapback-contract/client-store.mjs:649).

- [§Executable acceptance](/Users/ccheever/projects/snapback/llp/0059-session-projection-and-client-barrier.spec.md:1739) appropriately calls for deterministic schedulers and failpoints rather than timing-based race tests. That is the right standard for this protocol.

## 3. Concerns

### 1. MATERIAL — The durable-time design does not make terminal authority irreversible

[§Durable session clock floor](/Users/ccheever/projects/snapback/llp/0059-session-projection-and-client-barrier.spec.md:321) says maintenance persists progress only up to its cadence, but then concludes that once a generation terminalizes at epoch `E`, the floor has been committed and restart cannot revive it. [§Operation-specific publication](/Users/ccheever/projects/snapback/llp/0059-session-projection-and-client-barrier.spec.md:455) consequently makes expiry write-free.

The implementation raises only an in-memory atomic in [AuthProvider::now_ms](/Users/ccheever/projects/snapback/src/auth/provider.rs:830). The expiry worker terminalizes directly in memory in [src/auth/runtime.rs](/Users/ccheever/projects/snapback/src/auth/runtime.rs:383) and [src/auth/session_projection.rs](/Users/ccheever/projects/snapback/src/auth/session_projection.rs:863); durable persistence happens later during GC in [src/storage/auth.rs](/Users/ccheever/projects/snapback/src/storage/auth.rs:502). Therefore:

- a forward jump can terminalize a session, followed by a crash before GC, after which a lower clock rebuilds it as current; and
- if the monotonic deadline fires while wall time has moved backward, GC can persist only the lower sampled epoch rather than the elapsed session deadline, so even GC followed by restart can revive the generation.

Declared restore has the inverse failure. Startup passes raw `SystemTime::now()` into restore before seeding from the durable floor in [src/cli.rs](/Users/ccheever/projects/snapback/src/cli.rs:1474). Restore writes that value as `revoked_at_ms` in [src/storage/auth.rs](/Users/ccheever/projects/snapback/src/storage/auth.rs:624), while rebuild rejects a revocation earlier than creation in [src/auth/session_projection.rs](/Users/ccheever/projects/snapback/src/auth/session_projection.rs:647). The declaration is removed before rebuild in [src/auth/lifecycle.rs](/Users/ccheever/projects/snapback/src/auth/lifecycle.rs:230). A backup created at time 100 and restored under clock 50 can therefore be durably rendered projection-corrupt with its retry declaration already gone.

**Resolution criterion:** Before publishing any time-derived terminal event, durably advance a shared frontier to at least the authoritative deadline or durably record that generation’s terminality. Restore must derive its timestamp from durable state and guarantee it is at least every affected session’s creation timestamp. Add deterministic crash tests for forward-jump expiry, monotonic expiry under backward wall time, and restore under a lower host clock.

### 2. MATERIAL — LLP 0057 and LLP 0059 specify different public outcomes for commit ambiguity

LLP 0059 says it consumes LLP 0057’s provider protocol “without re-owning” it in [§Scope](/Users/ccheever/projects/snapback/llp/0059-session-projection-and-client-barrier.spec.md:111). LLP 0057 nevertheless requires plaintext successor/code state to be discarded and an unavailable result returned after an initially unknown commit outcome in [§Concurrency, locks, and linearization](/Users/ccheever/projects/snapback/llp/0057-auth-provider-protocol.spec.md:1179).

By contrast, LLP 0059’s [§Rollback and ambiguous commit](/Users/ccheever/projects/snapback/llp/0059-session-projection-and-client-barrier.spec.md:428) finalizes an exact durable successor. The code follows LLP 0059: rotation maps an exact successor back to committed in [src/auth/provider.rs](/Users/ccheever/projects/snapback/src/auth/provider.rs:1369), then returns the retained plaintext successor in [src/auth/coordinator.rs](/Users/ccheever/projects/snapback/src/auth/coordinator.rs:649). Issuance does the same in [src/auth/provider.rs](/Users/ccheever/projects/snapback/src/auth/provider.rs:3430).

Exact-successor recovery may be a reasonable refinement, but there cannot be two normative public-response rules for the same provider operation.

**Resolution criterion:** Choose the owning rule explicitly. If exact durable proof permits publishing the retained successor, revise or supersede LLP 0057 and specify the proof and plaintext-custody requirements. Otherwise discard the carrier after every initially ambiguous commit. Before-/after-commit fault tests must assert the selected public response.

### 3. MATERIAL — Auth-client protocol 1 is advertised without the required coordinator

[§Authority identity and captures](/Users/ccheever/projects/snapback/llp/0059-session-projection-and-client-barrier.spec.md:1095) requires one coordinator per app/partition, and [§Contract and kit barrier participation](/Users/ccheever/projects/snapback/llp/0059-session-projection-and-client-barrier.spec.md:1619) says `setBearerToken` is no longer a local token swap. Protocol 1 is supposed to represent completion of that sequence.

The kit instead defaults `authClientProtocol` to `1` while defaulting `authCoordinator` to `null` in [demos/_kit/client.mjs](/Users/ccheever/projects/snapback/demos/_kit/client.mjs:808). It has a full uncoordinated handshake path at [client.mjs](/Users/ccheever/projects/snapback/demos/_kit/client.mjs:891), permits local bearer replacement at [client.mjs](/Users/ccheever/projects/snapback/demos/_kit/client.mjs:945), and returns request results without a final authority commit when no coordinator exists at [client.mjs](/Users/ccheever/projects/snapback/demos/_kit/client.mjs:1404). Contract likewise treats a missing coordinator as successful direct commit in [packages/snapback-contract/index.mjs](/Users/ccheever/projects/snapback/packages/snapback-contract/index.mjs:231). The handshake suite positively tests a sessions mutation using protocol 1, an injected bearer, and no coordinator in [auth-handshake.mjs](/Users/ccheever/projects/snapback/demos/_kit/tests/auth-handshake.mjs:98).

**Resolution criterion:** The bundled client may offer protocol 1 only after installing canonical per-app custody, a singleton coordinator, and mandatory participants. A no-coordinator client must offer no compatible sessions protocol and must fail closed. Add default-construction and two-context tests that prove this invariant.

### 4. MATERIAL — Durable transition state is insufficient across crashes and contexts

The exact custody shape in [§Durable custody record](/Users/ccheever/projects/snapback/llp/0059-session-projection-and-client-barrier.spec.md:1162) removes the predecessor during `clearing` and retains only the successor. That cannot reproduce all rows in the transition table, particularly same-user/new-session preservation.

The implementation demonstrates the loss:

- The clearing write drops predecessor identity in [auth-coordinator.mjs](/Users/ccheever/projects/snapback/packages/snapback-contract/auth-coordinator.mjs:893).
- Recovery reconstructs `previousAuthority: null` in [auth-coordinator.mjs](/Users/ccheever/projects/snapback/packages/snapback-contract/auth-coordinator.mjs:969).
- The store maps an unknown predecessor to delete-all in [client-store.mjs](/Users/ccheever/projects/snapback/packages/snapback-contract/client-store.mjs:3005).
- A production test explicitly expects same-user/new-session crash recovery to delete the queue and retained state in [client-store-authority.test.mjs](/Users/ccheever/projects/snapback/packages/snapback-contract/client-store-authority.test.mjs:870), contradicting the ordinary table and its acceptance claim.

Cross-context completion is also not durable. Online peer adoption explicitly skips `commitDurable` in [auth-coordinator.mjs](/Users/ccheever/projects/snapback/packages/snapback-contract/auth-coordinator.mjs:1096), while physical-store registration is only a realm-local `WeakMap` in [index.mjs](/Users/ccheever/projects/snapback/packages/snapback-contract/index.mjs:113). If tab A owns the transition but has no Contract store, a suspended tab B’s physical store remains at the predecessor epoch. Participant unregistration can similarly mark an entry removed before its durable phase and later loops skip it in [auth-coordinator.mjs](/Users/ccheever/projects/snapback/packages/snapback-contract/auth-coordinator.mjs:918).

**Resolution criterion:** Persist a versioned transition intent containing predecessor and successor authority, classification/disposition, epoch, and transition identity. Every physical store must idempotently record application of that intent before exposure, regardless of which tab initiated it. Mandatory participants must remain phase-eligible until durable completion. Crash tests must reproduce every transition-table row exactly; if conservative deletion is intentional, the Spec must explicitly ratify that data-loss policy.

### 5. MATERIAL — The barrier lacks a coherent ownership cut between durable settle and online resume

[§Transition barrier](/Users/ccheever/projects/snapback/llp/0059-session-projection-and-client-barrier.spec.md:1365) says exclusive ownership spans the durable transition, while phase 9 requires fresh handshake, grant, resubscription, and participant readiness before exposure. But those participant operations ultimately use `compareAndCommit`, which reacquires custody ownership under [§Coordinator interface](/Users/ccheever/projects/snapback/llp/0059-session-projection-and-client-barrier.spec.md:1252).

The implementation holds `withOwnership` around the entire transition in [auth-coordinator.mjs](/Users/ccheever/projects/snapback/packages/snapback-contract/auth-coordinator.mjs:869) and awaits `resume` before returning in [auth-coordinator.mjs](/Users/ccheever/projects/snapback/packages/snapback-contract/auth-coordinator.mjs:1013). A genuine Contract resume would deadlock when it re-entered the same Web Lock. Contract avoids this by scheduling its refresh and returning immediately in [index.mjs](/Users/ccheever/projects/snapback/packages/snapback-contract/index.mjs:2205) and [index.mjs](/Users/ccheever/projects/snapback/packages/snapback-contract/index.mjs:2388), allowing the coordinator to report transition success before the mandatory surface is ready.

This long ownership interval also blocks peers. A clearing wake merely sets `publicationPaused` and asynchronously waits for ownership in [auth-coordinator.mjs](/Users/ccheever/projects/snapback/packages/snapback-contract/auth-coordinator.mjs:1265); it does not synchronously blank existing boundaries. The owner may meanwhile hold the lock across the resume handshake, and refresh explicitly holds it across an unbounded network request in [auth-coordinator.mjs](/Users/ccheever/projects/snapback/packages/snapback-contract/auth-coordinator.mjs:771). The required `pageshow`, visibility, and focus gates are not installed by the constructor at [auth-coordinator.mjs](/Users/ccheever/projects/snapback/packages/snapback-contract/auth-coordinator.mjs:462).

**Resolution criterion:** Define an explicit phase-8 ownership release. Durable custody may settle under ownership, but all contexts must remain locally blank until successor-fenced readiness completes after release. No network request may hold the cross-context mutex. Wake and lifecycle handlers must synchronously pause/blank before awaiting durable reload. Tests must cover a hung network resume, dropped broadcast, frozen peer, and focus/pageshow before successor exposure.

### 6. MATERIAL — A close-code-only terminal event reconnects instead of clearing

[§Typed terminal auth error](/Users/ccheever/projects/snapback/llp/0059-session-projection-and-client-barrier.spec.md:995) requires either the typed frame or close code to suppress reconnect and run captured-authority `compareAndClear`. The server emits close code `4401` with reason `auth_error` in [src/server.rs](/Users/ccheever/projects/snapback/src/server.rs:10333).

The managed client handles terminal auth only in its message branch. Its close handler discards `CloseEvent` details in [client.mjs](/Users/ccheever/projects/snapback/demos/_kit/client.mjs:3784), and generic loss always schedules reconnect in [client.mjs](/Users/ccheever/projects/snapback/demos/_kit/client.mjs:3800). The raw stream also ignores close details in [client.mjs](/Users/ccheever/projects/snapback/demos/_kit/client.mjs:2200). Thus losing the frame but receiving the mandated close produces exactly the generic reconnect loop the Spec says is closed.

**Resolution criterion:** Both live APIs must terminal-latch `4401/auth_error`, suppress reconnect, clear only the captured current authority, and ignore a delayed A close after B settles. Add close-without-frame and delayed-close race tests.

### 7. MATERIAL — The closed handshake cannot prove its claimed identity boundary

[§Bootstrap response revision](/Users/ccheever/projects/snapback/llp/0059-session-projection-and-client-barrier.spec.md:1644) requires canonical UUIDv7 incarnation values, and handshake acceptance requires cross-app values to fail in [§Handshake and activation](/Users/ccheever/projects/snapback/llp/0059-session-projection-and-client-barrier.spec.md:1910).

The exact response DTO contains no app or deployment identity in [src/auth/handshake.rs](/Users/ccheever/projects/snapback/src/auth/handshake.rs:234). The client validator rejects unknown fields and therefore cannot receive such proof in [client.mjs](/Users/ccheever/projects/snapback/demos/_kit/client.mjs:566). A coordinator’s `appId` is merely local configuration, so a client pointed at the wrong app accepts that app’s incarnation under its locally chosen id. Cross-app rejection is impossible under the current closed shape.

Canonical identity is also under-enforced: the Rust schema requires only nonempty session/user/incarnation strings in [src/auth/handshake.rs](/Users/ccheever/projects/snapback/src/auth/handshake.rs:119), and the kit performs the same nonempty-string checks in [client.mjs](/Users/ccheever/projects/snapback/demos/_kit/client.mjs:593).

**Resolution criterion:** Add a server-proven canonical app/deployment identity and validate it before any custody transition, likely through a revised protocol version. Validate canonical UUIDv7 spelling for stream, session, and user identifiers at the wire projection boundary. Add wrong-app, wrong-version, uppercase, and noncanonical UUID tests.

### 8. MATERIAL — The handshake is not consistently captured and final-fenced

[§Bootstrap response revision](/Users/ccheever/projects/snapback/llp/0059-session-projection-and-client-barrier.spec.md:1652) requires authority projection and incarnation to come from one prepared authority. In the admission-closed path, the server resolves the bearer and discards its `FencedPublication` in [src/server.rs](/Users/ccheever/projects/snapback/src/server.rs:6172), separately rereads the current incarnation in [src/server.rs](/Users/ccheever/projects/snapback/src/server.rs:6202), and returns unfenced JSON in [src/server.rs](/Users/ccheever/projects/snapback/src/server.rs:6230). A reset/revoke between those steps can produce a hybrid or stale response. The associated test explicitly expects no prepared authority or admission lease while pending in [src/server.rs](/Users/ccheever/projects/snapback/src/server.rs:14482).

The client side has the same gap. Cached handshake reads use only in-memory capture equality in [client.mjs](/Users/ccheever/projects/snapback/demos/_kit/client.mjs:891), and post-network coordinated completion checks only `isCurrent` before caching in [client.mjs](/Users/ccheever/projects/snapback/demos/_kit/client.mjs:1095), despite the Spec defining `isCurrent` as a hint. Pending/unavailable handshakes are cached and thrown as availability errors without running the required blank barrier.

**Resolution criterion:** Carry one prepared authority and incarnation through the response’s final body-publication fence, including diagnostic mode, or retry/refuse. Client cache reads and post-await completion must pass a durable compare-and-commit. Pending/unavailable mode must enter a custody-preserving blank barrier. Add reset/revoke-at-body-handoff and missed-broadcast-during-handshake tests.

### 9. MATERIAL — Readiness is asserted rather than derived from the required evidence

[§Allowed order](/Users/ccheever/projects/snapback/llp/0059-session-projection-and-client-barrier.spec.md:536) requires test/dev lock-rank assertions. [§Readiness facts](/Users/ccheever/projects/snapback/llp/0059-session-projection-and-client-barrier.spec.md:1669) and [§Handshake and activation](/Users/ccheever/projects/snapback/llp/0059-session-projection-and-client-barrier.spec.md:1912) require each omitted module, wiring edge, or worker to keep its fact false, and [§Implementation handoff](/Users/ccheever/projects/snapback/llp/0059-session-projection-and-client-barrier.spec.md:1942) claims real probes landed.

The relevant locks remain raw mutexes in [src/auth/session_projection.rs](/Users/ccheever/projects/snapback/src/auth/session_projection.rs:401), [src/auth/coordinator.rs](/Users/ccheever/projects/snapback/src/auth/coordinator.rs:1052), and [src/server.rs](/Users/ccheever/projects/snapback/src/server.rs:941); no rank facility or inversion assertion is present. Production readiness passes literal `true` values for connection binding, two-phase revocation, and auth coordinator in [src/cli.rs](/Users/ccheever/projects/snapback/src/cli.rs:327). Its test verifies those literals rather than omission/failure behavior in [src/cli.rs](/Users/ccheever/projects/snapback/src/cli.rs:3406).

**Resolution criterion:** Implement rank-aware dev/test guards with intentional inversion failures and connect each readiness fact to executable module/wiring/worker probes. Otherwise distinguish static build facts from runtime readiness, remove the landed-evidence claim, and keep the affected fact false.

### 10. MATERIAL — The specified localStorage protocol is the opposite of the implementation and governing LLP

[§Format 3 and authority tags](/Users/ccheever/projects/snapback/llp/0059-session-projection-and-client-barrier.spec.md:1514) says a localStorage adapter MUST use immutable generation-segmented namespaces and MUST NOT use read-then-`setItem` or a mutable current pointer. Acceptance requires the segmented stale-writer proof in [§Client store and Contract boundaries](/Users/ccheever/projects/snapback/llp/0059-session-projection-and-client-barrier.spec.md:1881).

The actual adapter reads and overwrites one mutable key with `storage.setItem(key, JSON.stringify(state))` under a Web Lock in [client-store.mjs](/Users/ccheever/projects/snapback/packages/snapback-contract/client-store.mjs:2937). Governing LLP 0008 explicitly ratifies this one-key load/modify/save protocol in [§Serialization](/Users/ccheever/projects/snapback/llp/0008-local-first-sync-and-realtime.rfc.md:427).

**Resolution criterion:** Either implement immutable epoch/key-segmented namespaces and their stale-writer/GC acceptance, or revise LLP 0059 with a complete proof for the Web-Lock design and reconcile LLP 0008. The implementation, governing RFC, and acceptance suite must specify one protocol.

## 4. Suggestions

- Replace the mutable clearing record with an append-only transition journal containing transition id, predecessor, successor, disposition, and per-store applied epoch. Custody can be a derived current pointer, while recovery and peer catch-up remain exact.

- Split client transition into two cuts: a short durable custody cut under cross-context ownership, followed by local successor preparation while blank. Publish local readiness atomically only after handshake/store/surface preparation succeeds.

- Make protocol support an installed capability object produced by the canonical coordinator factory, rather than a numeric constructor default that can exist without its implementation.

- Commit one global time frontier before terminalizing a batch of due sessions. This preserves batching without requiring a separate session-row write for every expiry.

- Since the document remains Draft, introduce a revised handshake protocol now with explicit app/deployment identity instead of preserving an under-specified closed v1 shape.

- Add a conformance table mapping every readiness fact to its implementation edge, failpoint test, and negative omission test. Remove “landed” claims until every row is evidenced.

- Correct Grants acceptance item 2: it currently says revoked, expired, malformed, and random bearers are indistinguishable, contradicting [§Diagnostics and safe exposure](/Users/ccheever/projects/snapback/llp/0059-session-projection-and-client-barrier.spec.md:1729) and LLP 0057’s deliberate `AUTH_REQUIRED` versus `SESSION_EXPIRED` distinction.

## 5. Open questions

1. After an initially ambiguous credential commit, is exact durable successor proof sufficient to release the retained plaintext credential, or is LLP 0057’s unavailable outcome still authoritative?

2. Must crash recovery preserve every transition-table disposition exactly, or is conservative delete-all an accepted data-loss policy?

3. What precisely constitutes transition success: settled custody, all local durable commits, or completed handshake/grant/resubscription for every mandatory local surface?

4. Who applies a physical client-store transition when the initiating tab has no instance of that store and the owning tab is suspended?

5. Which operations may perform network I/O while holding custody ownership? If any remain, what is their hard liveness bound and takeover mechanism under Web Locks?

6. What server identity must the handshake bind: canonical app id, database identity, deployment identity, origin, or a tuple of these?

7. Which durable mechanism closes monotonic-deadline expiry across restart without imposing unacceptable write amplification?

8. Are readiness fields static build facts or live process facts? How does a server prove the client coordinator package and its mandatory participants are actually present?

## 6. Readiness verdict

Not ready. The server time frontier, restore path, client protocol negotiation, crash/cross-context transition recovery, terminal close handling, handshake identity/fencing, readiness proof, and localStorage protocol all have unresolved material correctness or coherence problems.

READINESS VERDICT: NOT READY
### Orchestrator disposition (round 2, outside the verbatim body)

Disposition: #1 (durable-time terminal) → cross-referenced the LLP 0057 restore
clock-floor fix; durable-frontier-before-terminal-event named an obligation; #2
(0057/0059 commit-ambiguity contradiction) → resolved from the 0057 side (0057
now defers to this document's exact-successor reconciliation); #3 (protocol-1
without coordinator) → named defect obligation (no-coordinator client fails
closed); #4 (durable transition intent) → named defect obligation or explicit
data-loss ratification; #5 (ownership cut) → phase-8 release obligation, no
network I/O under the mutex; #6 (close-code terminal latch) → named obligation
for both live APIs; #7 (handshake app-identity/UUIDv7) → named obligation; #8
(final-fence handshake capture) → named obligation; #9 (readiness probes) →
overclaim corrected, probes named an obligation; #10 (localStorage vs LLP 0008)
→ flagged as a genuine cross-document conflict requiring reconciliation. The
suggestions (append-only transition journal, two-cut client transition, capability
object for protocol support) are recorded for the implementer.

## Independent implementation review — 2026-07-15

### Provenance

- Reviewer family: GPT (OpenAI Codex)
- Provider/runtime: Codex CLI 0.144.4
- Model: `gpt-5.6-sol`
- Review mode: read-only, ephemeral, high reasoning effort
- Reviewed commit: `3e52f2b158f70fc2e19b7853e956c823b8f3800e`
- Human authorization: ENG-24996 completion request
- Secrets or redactions: none

### Verbatim review

READINESS VERDICT: NOT READY

- MATERIAL: The constants table says “Client custody format 1” while the normative type and implementation use format 2. Make the table consistent at 2.
- MATERIAL: `validateAuthCustody` does not bind a transition intent's embedded authority/key pairs or a settled intent successor to the containing settled record, and `#adoptPeerSettled` trusts that validation. Validate both embedded authority/key pairs; require a settled intent successor epoch, key, and authority to equal the containing record; validate the derivable transition ID if possible; and add corruption and peer-adoption tests.
- MINOR: The lock hierarchy says the stalled-revocation L9 fixture is not discoverable while the Status section says a fixture proves it. Reconcile the prose or name the test.

## Final implementation review — 2026-07-15

### Provenance

- Reviewer family: GPT (OpenAI Codex)
- Provider/runtime: Codex CLI 0.144.4
- Model: `gpt-5.6-sol`
- Method: read-only, ephemeral CLI; high reasoning effort; blind to `llp/reviews/`
- Reviewed commit: `62a11cedfb1ff7ad0258dc3e6ce667989b88b819`
- Human authorization: ENG-24996 completion request
- Secrets or redactions: none

### Review body (local Markdown links omitted)

## Overall assessment

The revision is substantially stronger and most prior repairs are visibly implemented. However, three MATERIAL boundary gaps remain. I reviewed committed `62a11ce` without inspecting `llp/reviews/` or secrets and made no changes.

## Strengths

- The Spec clearly separates durable authority, process projection, publication fences, and client custody, while preserving LLP 0039/0057/0058 ownership boundaries.
- Major repairs are concrete: durable clock-floor storage, ranked projection locks, custody-v2 transition intent validation, ownership release before resume/network, protocol-1 coordinator enforcement, deployment identity validation, Web-Lock one-key storage, and terminal `4401/auth_error`.
- The server retains prepared authority/admission through the response body, supporting the final-publication claim.
- The inspected coordinator, handshake, and offline-replay JavaScript suites all pass.

## Concerns

1. **MATERIAL — expiry can publish a terminal event beyond the persisted frontier.**
   LLP 0059 requires the authoritative deadline to be durably advanced before terminal publication. `terminalize_due_sessions` computes the frontier using one `(epoch, monotonic)` sample, awaits its durable write, then calls `expire_due` with fresh samples. A second session can become due during that await and be terminalized although its later epoch deadline was not persisted. After a crash plus wall-clock rollback, that generation can rebuild current. The existing test covers only one session with no advancement during the durable-write interval.
   **Resolution:** terminalize using the exact sampled pair whose complete due frontier was persisted, or loop/recompute and persist until the terminalized set is wholly covered. Add a deterministic two-session test advancing time during the storage await, followed by rollback restart.

2. **MATERIAL — fresh coordinated handshakes lack the durable final compare-and-commit fence.**
   The Spec requires every async completion to validate after its final await. The cached lookup correctly uses durable `compareAndCommit`, but `#coordinatedAuthSession` checks only in-memory `isCurrent` and then caches/returns the newly fetched response. Another context can durably transition custody between that check and exposure while its broadcast remains delayed. The handshake suite tests cache behavior but no cross-context transition at this cut.
   **Resolution:** durably compare-and-commit the exact capture immediately before caching or returning every successful fresh handshake, including establish/transition paths; add a delayed-broadcast, two-coordinator race proving the predecessor response cannot be returned or used to start an operation.

3. **MATERIAL — production readiness probes do not prove the facts they assert.**
   LLP 0059 says each omitted module, wiring, or worker must keep its fact false. Yet `runtime_auth_program_readiness` derives connection binding from two route-path names, two-phase revocation from logout/session route presence, and `authCoordinator` from source-text substrings. These checks do not establish final drains/reverse invalidation, provider-callsite rewiring, expiry-worker installation, durable custody, mandatory participants, or store wiring.
   **Resolution:** derive facts from typed registrations/construction receipts for the actual mechanisms and worker installation, with negative tests independently omitting each required wiring and proving sessions cannot bind.

4. **EDITORIAL — barrier phase numbering drift.**
   `auth-coordinator.mjs` calls durable settle “phase 7” and resume “phase 8,” while the Spec’s numbered barrier makes them phases 8 and 9. Align the comment to prevent future recovery mistakes.

No separate MINOR findings.

**Readiness verdict: NOT READY**
