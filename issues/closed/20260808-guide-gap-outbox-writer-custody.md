# guide-gap: outbox writer custody is untaught (SNAPBACK_OUTBOX_NOT_WRITER, SNAPBACK_OFFLINE_QUEUE_DISABLED)

**Opened:** 2026-08-08 · **Severity:** P3 (documentation)

guide/sync/offline-and-retention.md teaches `SNAPBACK_RQS_STORE_NOT_WRITER`
for materialization/registration only (:84-87), and its outbox section
(:150-209) never says that mutations on a client without store-writer
ownership refuse with `SNAPBACK_OUTBOX_NOT_WRITER`
(packages/snapback-client/index.mjs:7594, outbox-shared.mjs). Three repo
integration surfaces hit this unexpectedly per
issues/20260807-declarative-mutation-sessions-bearer-misrouted-offline.md
(2026-08-08 re-triage), whose scope is fixture/product repair, not guide
teaching. The memory-fallback refusal `SNAPBACK_OFFLINE_QUEUE_DISABLED` is
likewise described in prose (:739-740) but never named.

Ask: one paragraph on the offline page — mutations require writer custody
of the durable store; a second client over the same directory refuses
rather than queues; name both codes. Coordinate with the misrouted-offline
ticket's repair, which may make writer acquisition awaited in the
high-level client (in which case document the awaited behavior instead).

Found by the 2026-08-08 comprehensive docs review (sync slice).

## Resolution

Fixed 2026-08-08 (docs-review execution, 1284ae8a5).
guide/sync/offline-and-retention.md now teaches writer custody: the store
is single-writer, a second client over the same directory is a reader that
refuses `SNAPBACK_OUTBOX_NOT_WRITER` rather than queuing, generated
declarative mutations degrade via `queue: 'auto'` server delegation, and
explicit `queue: true` without queue custody refuses
`SNAPBACK_OFFLINE_QUEUE_DISABLED` (the memory-fallback prose now names the
code too). Checked before writing: the misrouted-offline repair
(20260807 ticket) has not landed, so refuse-not-queue is the honest
current behavior; if writer acquisition later becomes awaited, this
paragraph should be updated with that repair.
