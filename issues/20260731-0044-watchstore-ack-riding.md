# watchStore applies witnessed snapshots without discharging the obligation

**Status:** OPEN — recorded at the Lane 1 landing (2026-07-31)

Sessions-mode asset live subscriptions receive witnessed
`authorization_invalidation` envelopes (never plain `live_replace`).
`SnapbackAssetClient.watchStore`'s raw-lane consumer now applies the
witnessed snapshot rows (data-correct: publish → ready, deletion →
blank, proven by the conformance vector `sessionsLiveDelivers`), but it
does not run the LLP 0053 obligation machinery — the post-commit ACK
token is never sent, so the server obligation stays open and is covered
by 0053's lease for unreachable clients (safe by design, suboptimal:
lease-driven re-delivery/quarantine instead of clean discharge).

Fix: ride the deep client's `receiveAuthorizationProjection` path from
the raw lane (or route watchStore through the main subscribe machinery
that already ACKs), so long-lived asset watchers discharge obligations
like ordinary auth-scoped queries.
