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