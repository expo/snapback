# Clique M7 Diagnostic Continuation Report

Status: M7 is green at the commissioned diagnostic boundary. The final-source, coverage-validated suite and the frozen fresh-session Chromium segment both pass. This is not a calibrated benchmark score or a protocol-conforming full-run claim: M3 remains the supplied non-green/aborted milestone, and no native M6/M8 requalification was commissioned.

## Delivered behavior

- Group members can create polls with a server-enforced question bound of 200 characters and two through four options, each capped at 50 characters. Direct-message poll creation is rejected.
- Each member has one changeable vote per poll. Vote writes are set-state operations over a unique message/voter row; exact mutation retries are idempotent, changing an existing vote moves one tally, and clearing only removes the selected option.
- Poll questions, stable options, live per-option tallies, viewer selection, and total votes render through the frozen poll UI kit. The app supplies the semantic DOM bridge required by the frozen browser contract without changing the kit or harness.
- Web tabs use separate session-scoped IndexedDB range-store namespaces. Offline vote intent is durable, exposes a pending state while queued, drains after reconnect, reconciles to other clients, and clears the pending marker from the operation's queued-only `pending` collection.
- Chat settings display the stored visible-message count. Polls and new messages increment it; tombstoned messages and scheduled expirations decrement it. Expired rows are not visible-counted.

## Schema transition and preservation

`preExistingCountStructures=true`. Before M7, `messageCounts` counted all message rows by conversation and chat settings exposed that value. Tombstoned rows therefore counted; expired rows disappeared from the count only when the scheduled purge deleted them. Live pre-transition values were six for `d-alice-bob`, one for `derived-conversation`, and nine for `g-starter`.

The transition added a required `conversations.visibleMessageCount`, a tombstone-aware `visibleMessageCounts` maintain, poll option/vote tables, and a poll tally maintain. `admin.backfillConversationMessageCounts` completed in one chunk over all three conversations and wrote the observed six/one/nine counts. The final generation is `030479ec81d67bc3fb9ef9bc7b0f27a3848dd6d9300f4b74dc4738ea3274bb03`; no backend owner restart was required.

The existing `messages.kind` field was not rewritten. A new optional logical `messageType` is populated on new writes, old rows project through unchanged `kind`, and a poll uses legacy-compatible storage plus logical type `poll`. This avoided a destructive discriminator migration after the owner refused the initial widening plan before any data changed.

The canonical Node 24 post-migration snapshot ran before acceptance mutations. Its semantic payload equals the supplied snapshot after ignoring capture timestamps, with message IDs `sm0001` through `sm0015`, two conversations, 15 unique messages, six quotes, and 81 receipt rows across persona views intact. This establishes populated-value preservation for text/quote fields and receipts. Starter media, reactions, edits, tombstones, and view-once classes were empty, so no populated-value migration proof is claimed for those classes.

Acceptance and regression runs subsequently added normal test fixtures; the assigned backend was never reset or reseeded. Baseline IDs remain intact, and the service/database remain available for independent inspection.

## Passing evidence

- Final M7 suite: `artifacts/suite-m7-1788887554.json`, SHA-256 `2584f8a79fafb94b450527912c168f2e4484b8e7f5472908d483049619fccad4`. It passed `snapback2 check`, TypeScript, all authored journeys, M7 feature acceptance, and the commissioned regression sequence.
- Coverage: `coverage/m7.json`, SHA-256 `29cab2533f1113f7900c5d1940afcf129636561539d26f61a365c1487b911d7f`. It exactly maps suite-required IDs `m7-a01`, `m7-a03`, `m7-a04`, `m7-a06`, `m7-a07`, and `m7-a09` to passing tests. No independent coverage assessment was supplied or claimed.
- Fresh-session M7 choreography: `../evidence/m7-choreography-attempt-6.jsonl`, SHA-256 `ce469977719e3ce4bb5f38b4a9e6dfac058db8537a2300e36f6ea32dda011e0c`. All three retained live-tally attempts passed, with click-to-observer visibility of 168.4 ms, 168.1 ms, and 170.8 ms. The sole offline reconciliation attempt passed, including queued busy state, remote tally convergence, and pending-state clearance.
- Choreography observations: `../evidence/m7-choreography-attempt-6.observations.jsonl`, SHA-256 `0184e42a687b45c0ff5ba53dc8885f7cacff0836bb311858282ef862a88b5248`.
- Setup identity: `../evidence/m7-setup-identity.json`, SHA-256 `c5d4a683906863be85a9e8fae333dd23c89bde8796ceba38b8cf2a4135d1e67f`; it records Node 24.18.0, published `snapback2@0.0.19`, Playwright 1.62.1, Chromium, workspace closure, and no separately qualified binary claim.
- Final isolated export entry: `artifacts/m7-web-4/_expo/static/js/web/entry-93c12ecd6c5945d8ea91391e7e78ed69.js`, SHA-256 `3a2223f33d2ce7bdb22da388e630a4cc1dd9b730b76349ff1e6ab6406edb159d`. The pre-navigation endpoint check found only `http://127.0.0.1:53134` and no unexpected local port.
- Canonical post-migration snapshot: `../evidence/post-migration-snapshot.json`, SHA-256 `64ca0e085c27f076b762f74fe72279d912a7fe09d1ebc093dff44e65e22a837c`.

The final regression receipts for M1, M2, M4, M5, M6, and M8 all pass and are hash-bound in `m7-run-record.json`. M3 was intentionally excluded as the preserved prior failure. These are local suite regressions only; they do not create absent native M6/M8 behavioral proof.

## Retained failures and limits

All material failures are retained in `m7-run-log.md`: quarry binding and bound failures, the refused destructive migration, the over-bounded rewrite job, a clock-polluted authored journey, malformed command entries, an accidental Node 26 snapshot/probe, a retry-sensitive suite assertion, multi-tab hydration contention, absent poll DOM semantics, and the initially non-clearing offline busy marker. Failed choreography receipt/observation files and every M7 suite/export log remain under the permitted evidence/log directories.

The frozen instrument is unchanged. Final SHA-256 values match the initial pins for its manifest (`ee75020c41bb09186dc003e1f2cdf0dedebbb3adc21abfbfeb83addba2e64623`), brief (`129fd79c5a2b19c7312fc41ed931647b79e2c4afc611c3cc431e0e26a452fbc6`), assertions (`e15c3952856148fef9872f9d509159b47fe0066bdca904330ae96196ba732d04`), and choreography (`8caf5ebdc9a85a2757fe5109740184bdac37977ac98d0a583f16f9dea383177f`). No excluded context was supplied or accessed.

## Clock and running services

The supervisor start was epoch `1788883136.39942`. The authoring clock stopped at the first final-source, hash-bound green suite plus choreography boundary, epoch `1788887679`: 4,542.60058 seconds elapsed against the fixed 14,400-second cap.

The original backend wrapper/listener remain PID 9726/9727 on 53134. The final static export is served by owned PID 29215 on 53135. No other lane's backend or web origin port was configured or contacted.

The machine-readable result is `m7-run-record.json`; the qualitative development history and closing analysis are in `m7-diary.md` and `m7-essay.md`.
