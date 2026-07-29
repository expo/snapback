# Research Room / Appwrite evidence audit

- Frozen protocol: LLP 0102, 15 scenario IDs, Research Room deep round.
- Product source freeze: `5f31cb6174daaefa04a1e05242acbbc22c725040`.
- Coordinator integration base: `0dc4b3ff6257edc2ee0fea869fca5142531d0ce5`.
- Fresh-target preflight: exact worktree owner, four ports, Compose resources, volumes, networks, and installer name absent.
- Actor authority: three independent native Appwrite Auth principals; Alice and Bob share the native Team, Mallory has no membership.
- Positive/negative authority: member file download and protected query succeeded; Mallory received empty lists plus direct source/file refusals; Bob could not delete Alice's object.
- Authoritative state: independent TablesDB/Storage/Functions reads, not UI rendering, establish all mutations and terminal states.
- Transport: Bob's independent session received four row commits through Appwrite Realtime WebSocket callbacks. Polling was used only to inspect asynchronous Function execution settlement, never to claim native push.
- Cancellation: a confirmed cancellation resulted in a terminal answer and a later Function probe produced no additional progress or completion patch.
- Idempotency: retry retained exactly one question, one answer, and four progress rows.
- Schedule: a one-off Appwrite scheduled execution fetched a stable RFC 2606 document and retained both execution and durable refresh records.
- Secrets: secret Function variables were opaque through the read API; only canary presence, never value, was retained or printed.
- Performance: two warmups plus seven retained samples for every supported frozen path.
- Cleanup: complete; zero exact containers, volumes, networks, installer, or runtime containers remained, all four ports were closed, and all six ignored runtime paths were absent.
- Hosted evidence: explicit credential-unavailable GAP, not a product failure.
- Semantic retrieval: explicit product GAP; vectors were stored, but no fallback was used or mislabeled native.
- Stop-class defects: none.
- Cross-lane safety: only allowlisted resource names, labels, ports, counts, and executable/PID facts are retained; no raw process arguments, Docker environment/configuration, CLI session JSON, or secret-bearing command output appears in evidence.
