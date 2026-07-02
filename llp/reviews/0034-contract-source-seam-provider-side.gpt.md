# Review: LLP 0034 Contract Source Seam, Provider Side

**LLP:** 0034-contract-source-seam-provider-side
**Family:** GPT
**Provider/runtime:** OpenAI Codex CLI v0.142.5, model gpt-5.5, `codex exec` read-only sandbox
**Date:** 2026-07-01
**Redacted:** No
**Method:** Independent single-pass review requested by the Claude (Fable 5) session that authored the draft (which per LLP 0005 does not count as a reviewer; this is one of two independent family reviews gathered for it). The reviewer was given the document, Exact LLP 0284 rev 3 (the interface it implements), snapback LLP 0013/0025/0031, and read-only filesystem access to both repos, and was instructed to verify factual claims against code and answer the LLP 0005 standard questions. It independently verified claims in `src/local.rs`, `src/server.rs`, `src/ephemeral.rs`, `demos/_kit/client.mjs`, `demos/_kit/codegen.mjs`, and the All Aboard demo. Review body below is verbatim.

---

## Overall Assessment
This is a good proposal and the D1-D5 split is mostly the right Snapback-side companion to Exact LLP 0284. I would keep it Draft. The factual base is strong, but the RFC currently under-specifies the hardest provider-side parts: logical subscription identity across socket reconnects, receipt version source, permission-epoch resync semantics, and the exact adapter/codegen boundary for ephemeral descriptors.

## Strengths
(cite specific sections and verified file:line evidence)

- 0034 correctly grounds snapshot-with-subscribe: `subscribe_live` returns `subscription_id`, `snapshot`, and `permission_epochs` in one response ([llp/0034...:24](/Users/ccheever/projects/snapback/llp/0034-contract-source-seam-provider-side.rfc.md:24), [src/local.rs:561](/Users/ccheever/projects/snapback/src/local.rs:561), [src/local.rs:596](/Users/ccheever/projects/snapback/src/local.rs:596)).
- The “browser durable push is wiring, not a new transport” claim is directionally accurate: `/live/{connection_id}/stream` exists ([src/server.rs:56](/Users/ccheever/projects/snapback/src/server.rs:56)), the kit opens it ([demos/_kit/client.mjs:164](/Users/ccheever/projects/snapback/demos/_kit/client.mjs:164)), and All Aboard still polls every 1500 ms ([demos/all-aboard/surfaces/contract/main.ts:123](/Users/ccheever/projects/snapback/demos/all-aboard/surfaces/contract/main.ts:123)).
- The bootstrap/ensure lineage is real: identical ephemeral collection replacement no-ops ([src/ephemeral.rs:697](/Users/ccheever/projects/snapback/src/ephemeral.rs:697)), and `ensure_collections` validates without clearing rooms/outboxes ([src/ephemeral.rs:716](/Users/ccheever/projects/snapback/src/ephemeral.rs:716)).
- The manifest/codegen starting point is described accurately: per-query `subscription` is emitted ([demos/_kit/codegen.mjs:149](/Users/ccheever/projects/snapback/demos/_kit/codegen.mjs:149), [demos/_kit/codegen.mjs:183](/Users/ccheever/projects/snapback/demos/_kit/codegen.mjs:183)), and the four manifests are written ([demos/_kit/codegen.mjs:420](/Users/ccheever/projects/snapback/demos/_kit/codegen.mjs:420)).
- The quoted ephemeral defaults match code: TTL 5000 ms, max TTL 30000 ms, value caps 1024/4096, sustained 20 Hz, burst 60, dispatch 33 ms ([src/ephemeral.rs:158](/Users/ccheever/projects/snapback/src/ephemeral.rs:158)).
- The §6 first-proof mapping usefully separates All Aboard durable proof from presence and receipts ([llp/0034...:239](/Users/ccheever/projects/snapback/llp/0034-contract-source-seam-provider-side.rfc.md:239)), matching Exact 0284’s “Done means” list ([0284:448](/Users/ccheever/projects/exact/llp/0284-contract-source-seam.rfc.md:448)).

## Concerns
(each concern tagged [high]/[medium]/[low], stating the problem and "What would resolve it:")

- [high] D1’s reconnect/resume story conflicts with current socket close behavior. 0034 says reconnect resumes via `resume_live` ([llp/0034...:115](/Users/ccheever/projects/snapback/llp/0034-contract-source-seam-provider-side.rfc.md:115)), but `live_stream` calls `disconnect` on socket close ([src/server.rs:658](/Users/ccheever/projects/snapback/src/server.rs:658)), and `disconnect` removes durable subscriptions for that connection ([src/local.rs:857](/Users/ccheever/projects/snapback/src/local.rs:857)). That means a killed socket currently destroys the subscription `resume_live` would need. What would resolve it: specify logical subscription lifetime separately from transport connection lifetime, or change D1 to say close always re-subscribes with a fresh snapshot and never “resumes” the old subscription id.

- [high] The receipt version source is not pinned enough to be implementable. 0034 says `snapshotVersion` / `lastDeltaVersion` are a new per-subscription monotonic sequence assigned where outbox enqueues ([llp/0034...:143](/Users/ccheever/projects/snapback/llp/0034-contract-source-seam-provider-side.rfc.md:143)), while current durable payloads carry the query/storage `version` ([src/local.rs:1257](/Users/ccheever/projects/snapback/src/local.rs:1257)) and overflow emits `resync_required` without subscription/version identity ([src/ephemeral.rs:561](/Users/ccheever/projects/snapback/src/ephemeral.rs:561)). What would resolve it: define one concrete version tuple, e.g. `{storageVersion, subscriptionSeq, epoch}`, and require every durable update, resync, permission resync, receipt, and snapshot to carry it.

- [high] Permission-epoch resync is under-modeled. Existing `resume_live` compares recorded permission epochs ([src/local.rs:650](/Users/ccheever/projects/snapback/src/local.rs:650)), and permission changes enqueue `resync_required` ([src/local.rs:1404](/Users/ccheever/projects/snapback/src/local.rs:1404)). 0034 mentions permission epochs only as today’s subscribe output, not as part of connection-axis transitions or receipts. What would resolve it: add permission-epoch changed as a first-class `SubscriptionReceipt` reason/event, with required client behavior and conformance coverage.

- [medium] The connection-axis table is honest as an adapter target but not yet backed by provider events. Current WS code has no heartbeat envelope, no durable subscribe/ack message on the socket, and no explicit retry scheduling; it just drains every 25 ms ([src/server.rs:625](/Users/ccheever/projects/snapback/src/server.rs:625)). What would resolve it: add provider events/envelopes for `open`, `heartbeat`, `established`, `resync_required`, `closed`, and `retry_scheduled`, or restate the table as kit-derived policy with exact timers.

- [medium] D3’s descriptor migration needs a sharper implementation seam. Current `renderContractModules` iterates functions only and emits query/mutation modules ([demos/_kit/codegen.mjs:1059](/Users/ccheever/projects/snapback/demos/_kit/codegen.mjs:1059)); ephemeral collections are generated only as API refs ([demos/_kit/codegen.mjs:982](/Users/ccheever/projects/snapback/demos/_kit/codegen.mjs:982)). What would resolve it: explicitly add “codegen iterates ephemeralCollections and emits `*.ephemeral.ts` / `*.publish.ts` plus meta sidecars” and name the Exact import-descriptor changes required to consume them.

- [medium] The D1-D5 split leaves Exact-side adapter acceptance implicit. 0034 maps Exact §5 item 3 to “D1+D3 plus the Exact-side adapter” ([llp/0034...:240](/Users/ccheever/projects/snapback/llp/0034-contract-source-seam-provider-side.rfc.md:240)), but that adapter work is not assigned to a specific Exact deliverable. What would resolve it: add a small ownership table for each §5 item with Snapback deliverable, Exact deliverable, and demo owner.

- [low] The privacy wording around ids is muddy. 0034 says client ids are PII-bearing, then says receipts carry versions and ids ([llp/0034...:156](/Users/ccheever/projects/snapback/llp/0034-contract-source-seam-provider-side.rfc.md:156)). What would resolve it: distinguish opaque correlation ids allowed in receipts from user/session/client ids that are excluded or hashed/redacted.

## Suggestions
- Treat D1 as “logical subscription session” work, not just browser wiring. The existing socket is usable, but the lifetime semantics need a new state machine.
- Make the first implementation use coarse “poke + resnapshot/fetch” for durable updates, as OQ1 leans, but still assign receipt sequence numbers to pokes. That gives conformance determinism without prematurely designing row deltas.
- Add a minimal receipt envelope now, even before full Exact integration: `kind`, `bindingId`, `subscriptionId`, `event`, `transport`, `storageVersion`, `subscriptionSeq`, `reason`.
- Add one conformance case specifically for permission epoch change: subscribe, mutate permission, assert resync receipt, assert stale retained rows are not trusted.
- Add a multi-connection case: two tabs same user, one socket dies, the other remains live, connection-owned ephemeral self/source identity remains distinct.

## Open Questions
- Is `connection_id` a client-chosen bearer-ish value, a server-issued connection identity, or both during migration?
- Should WebSocket close immediately dispose durable subscriptions, or should logical subscriptions survive a reconnect grace window?
- Is `snapshotVersion` intended to be the durable DB version, a per-binding sequence, or a compound value?
- Where exactly does `actionInvocationId` for receipts come from for cron/action-driven mutations?
- Does `defaultLive: true` for every LiveQuery ship in the first proof, or should only All Aboard’s target query opt in first?
- Should ephemeral resume always re-snapshot, as 0034 OQ6 leans, and should that be made normative now?

## Recommended Next Step
revise-and-stay-Draft. The proposal is the right direction, but acceptance should wait for a revision that pins subscription lifetime, receipt versioning, permission-epoch receipts, and the Exact/Snapback ownership table for each §5 proof item.
