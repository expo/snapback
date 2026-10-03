lane id grok-clique-snapback4-full-20260913
model grok-4.6
effort=xhigh
backend=snapback4-0.4.10
start=1790830364
pins: snapback4@0.4.10 snapback4-expo@0.4.10
1790830364 knowledge-lookup ENVIRONMENT.md (source: fixture) host macOS arm64 M5 Max, Node 24.18.0, ports 49360-49379, M1-M6+M8 in scope, M7 out, nothing struck
20996 snapback4-dev-49360
20999 notifications-worker
20995 snapback4-node-wrapper
21635 expo-web-49361
23562 expo-web-49361
55111 snapback4-dev-49360
55114 notifications-worker
55113 notifications-watchdog
55110 snapback4-node-wrapper
23562 expo-web-49361
1790835219 backend-restart --fresh after follows own-key sync + planned home (attribution: agent-error) evidence: generated api setFollow predicts eligible, home/followingThem/postState run device
1790835219 knowledge-lookup snapback4 guide feeds/receipts (source: package README/guide) view following materializes per-reader; setFollow was predicts never with online-only follows so unfollow did not overlay home. Own-key follows + planned home. messageReceipts horizon is messages-only so client recomputes receipt from membersOf.
1790835219 correction-loop m2-follow-projection: profile sm-feed-item polluted Following; chrome feed 360px strip; reply did not open /post thread (attribution: agent-error)
1790835880 m2 choreography green (suite+choreo) evidence: coverage/receipts-m2.jsonl green:true
1790835880 correction-loop m2-repost-attribution: optimistic setRepost + keep:false on feeds so unrepost and unfollow overlay (attribution: agent-error)
1790836200 m3 choreography green evidence: coverage/receipts-m3.jsonl
1790836200 correction-loop m3-member-cutoff: deterministic dm idFrom pair; hold namedGroup+history after remove (attribution: agent-error)
1790836900 m4 choreography green evidence: coverage/receipts-m4.jsonl
1790836900 correction-loop m4-media: wait for in-flight upload before send; video useAsset separate from poster; never query principal 'none' (attribution: agent-error)
1790837400 m5 choreography green evidence: coverage/receipts-m5.jsonl
1790837400 correction-loop m5-settings-search: conversation-id settings route; replica inboxSnippets word-prefix search; sm-search-offline from useLink (attribution: agent-error)
1790837500 m6 choreography green evidence: coverage/receipts-m6.jsonl
84969 snapback4-dev-49362
84978 notifications-worker-49362
84977 notifications-watchdog-49362
84967 snapback4-node-wrapper-49362
1790838359 scale-replay start epoch=1790838359 port=49362 --fresh
1790839547 scale-replay end epoch=1790839547 actions=167157 failed=0 wallSeconds=1188.567 sha256=b26bf1ae8ccf2d64c8ca34bca6562b63a5174956a40c33c123aff8050b6abba9 checkpoints 10%=24777 50%=88057
1790839547 scale-replay verification vs invariant-manifest-combined.json: pass (actionCount, sha256, checkpoint prefixes, alice following=2, u0001 following=5)
1790838270 m8 choreography green evidence: coverage/receipts-m8.jsonl
1790838270 correction-loop m8-insights-zero: hide InsightsSummary until query present; freeze OpenDirect id (attribution: agent-error)
end=1790839684
