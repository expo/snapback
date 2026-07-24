# 0081: schema-transition journal events, 0053 activation, client handshake

**Status:** Open
**Severity:** P2
**Systems:** Migrations, Storage, Live Queries, Auth
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-24
**Related:** Accepted LLP 0081 §4, LLP 0007 (amended journal grammar), LLP 0053
**Marker:** step5-impl

Implement the landed 0007 amendment: schema-resync/rollback-resync typed
events with the pinned payload, high-water counting, retention-floor raise in
the publication transaction, and head/journal-cut equality across events;
publication atomically fires 0053 activation obligations; posture-aware
client behavior (compatible resnapshot; stable upgrade-required refusal with
client-outbox quarantine and resync-before-replay); no pre-publication cursor
replays through the raised floor. M/L-sized.
