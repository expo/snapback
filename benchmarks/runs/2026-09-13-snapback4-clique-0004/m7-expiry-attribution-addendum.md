# M7 maintained-count expiry attribution addendum

Audit date: 2026-09-14

Scope: bounded static clarification against published Snapback 4 `0.2.6`, pinned to repository commit `342c53d306d7484cd64e820ee27a151e02eb4b0b`. I ran no tests or probes and did not modify either builder lane, its received reports, or the earlier source audits.

## Correction

The Astra source-delta audit says that expired rows contribute to `visibleMessageCounts` until the physical expiry sweep. That sentence is wrong for the observable query surface in published 0.2.6. It should be read as superseded by this addendum. Astra's builder report and diary make the same attribution (`lanes/astra-snapback4/m7/final-report.md:28`; `m7/diary.md:7,15`), while Grok's builder report independently describes an approximately one-second sweep lag (`lanes/grok-snapback4/m7/final-report.md:108`). Those received builder statements remain immutable; they do not match the pinned implementation.

The narrow distinction is:

- A materialized aggregate target row in SQLite may still carry its pre-expiry value until a write or physical sweep updates it.
- Every supported server or device query of that maintained value passes the target through `Runner::live_aggregate`. When the maintain's source table has an expiry column, the runner recomputes the requested group from source rows at the query clock and excludes expired rows before returning the value. The stale physical target is therefore not the API result.
- A query already observed before the deadline carries `nextExpiry`; the online and local clients schedule a rerun at that deadline. There is no fixed one-second refresh wait in this path. Ordinary event-loop scheduling can add small latency.

## Count and sum use the same expiry path

The two M7 implementations model tombstones differently but do not differ in expiry handling:

- Astra uses `maintain visibleMessageCounts: sum messages of visibleWeight by conversationId`; live messages and polls write one and tombstones write zero (`lanes/astra-snapback4/snapback/chat.q:51-76,152-160,198-209,255-259,304-308`; final `chat.q` SHA-256 `f73bcc2c01343434835f9d2ee7fa5afc988bd1421b9735e05d3fd34ea15ec7a1`).
- Grok uses `maintain visibleMessageCounts: count messages by conversationId, tombstoned` and queries the `false` group (`lanes/grok-snapback4/snapback/schema.q:205-206,257-286,478-491`; final schema SHA-256 `8a9f9b7798f34991d7cf9d7dbe40312c04268e991cb2e4bd6a760774ae1c1e7b`).

At pinned 0.2.6, `Runner::live_aggregate` is selected whenever a read names a maintained target whose source expires. It scans that group, skips a candidate when `self.expired(source, &candidate)` is true, notes the next future expiry for every included source row, and only then branches between `MaintainKind::Count => 1` and `MaintainKind::Sum { of } => candidate[of]` (`snapback4/crates/snapback4-core/src/engine/read.rs:83-119,122-136`; pinned file SHA-256 `4b56883c8dec0bc8e01a092d2ac4fd53900f1179821bd4452a5af3ed740ddd82`). Thus both Astra's weighted sum and Grok's grouped count stop exposing an expired contribution at the logical deadline, before physical deletion.

This is also the recorded resolution of `issues/closed/20260913-snapback4-expired-rows-fill-sync-horizon.md`: maintained reads share logical-expiry semantics before cleanup (ticket SHA-256 `ecd28f4496a036510ea904216896d8e0a601ab95cd2d5bd05e3341f189616b88`, resolution lines 37-40).

## Server, device, and retained-watch behavior

The correction applies to all published query arms:

1. Server queries use the core runner above and return its `QueryOutcome.next_expiry`.
2. The interpreted device query creates the same `Runner`, sets `device=true`, and returns the same `next_expiry`; the native query arm does the same (`snapback4/crates/snapback4-core/src/engine/local.rs:19-45,71-99`; pinned file SHA-256 `f9c35f4bd3db94f3c00b90991c9bc9eac1663cd8b9547860232cc4f2495736c7`). The device dispatcher serializes it as `nextExpiry` (`snapback4/crates/snapback4-device/src/call.rs:75`; pinned file SHA-256 `3fb55c50b828f18cbbe0f332375ed236d8433e52953b84c436912c7ea113e5d0`).
3. The local client accepts `nextExpiry` from either a device answer or its server fallback and schedules the watch at `nextExpiry - Date.now()`; the timer reruns only the still-current watch (`snapback4/packages/snapback4/src/local.ts:577-620,636-668`; pinned file SHA-256 `d4687c9d345687a22b34cb5f7ecebb56149a4219aa892a5c80b6d282664365f9`). If a device lacks complete source coverage, the result is marked incomplete and an online client falls back to the server (`local.ts:608-620`). The online-only client likewise propagates `nextExpiry` and schedules the observed query (`snapback4/packages/snapback4/src/client.ts:177-227`; pinned file SHA-256 `e3217e8f5590c0bd1947bb351288164772237a8e4ee8d11591a2ceafff06381b`).

Consequently, this was not merely a server-read correction with a stale local retained projection left behind. A one-shot query made after expiry recomputes immediately on either engine. An active query established before expiry is rerun by the metadata timer even without a sweep event. An offline device can only speak for rows within its held partition; when coverage is incomplete, the read remains explicitly incomplete rather than claiming an authoritative full count.

## Evidence limits

Astra's M7 acceptance polls the count once per second for up to 195 seconds after creating a short-lived poll (`lanes/astra-snapback4/scripts/acceptance-m7.mjs:46-55`, SHA-256 `76fdac5770f7e024b1a9582567e2cec7ce81f4883519bae385c54737e83f9d1c`). Its retained result supports eventual logical removal, but that polling interval and receipt do not isolate physical sweep timing from query-time recomputation. Grok's M7 suite creates no expiring count fixture, as its own report acknowledges. This addendum is therefore a source-correctness attribution, not a new runtime measurement or independent assertion grade.
