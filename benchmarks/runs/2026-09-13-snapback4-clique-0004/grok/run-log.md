lane id grok-clique-snapback4-full-20260913
model grok-4.6
effort=xhigh
backend=snapback4-0.2.6
start=1789333935

package pins (recorded before install):
- snapback4@0.2.6
- snapback4-expo@0.2.1

1789333935 knowledge-lookup source=fixture: began reading instrument/ENVIRONMENT.md (wins over brief on environment facts)
1789334000 knowledge-lookup source=fixture: read ENVIRONMENT.md, CONTRACT.md, protocol.md, social-messenger.md (M1-M8), action-schema.md, fixtures README, personas, starter logs, windows.shortened.json, digest.shortened.json, UI screens.md, choreography README
1789334001 knowledge-lookup source=published docs: installing snapback4@0.2.6 and snapback4-expo@0.2.1 from public npm before any app authoring
1789333935..now PIDs: snapback4-dev=11325 (port 49300); expo-web=66487/66423 (port 49301); push-worker=19481
1789336011 milestone=m1 start-verification
1789336011 seed starter-m1.log ok
1789336011 suite m1 pass receipts/suite-m1.json
1789336200 correction-loop attribution=agent-error evidence=choreo m1 first miss: FeedScreen called usePage without SnapbackProvider; RequireAuth + AuthForm on unauthenticated /
1789336400 correction-loop attribution=agent-error evidence=logout left /settings without auth form then without feed tabs; RequireAuth on settings + router.replace('/') after login
1789336500 milestone=m1 green suite+choreo receipts/choreo-m1.jsonl
1789336800 milestone=m2 start
1789336900 correction-loop attribution=agent-error evidence=digestAcc insert E_RULE: follower could not read followee accumulator; set digestAcc read <- allow
1789337200 correction-loop attribution=agent-error evidence=m2 choreo: feed tabs missing on profile; AppChrome persistent tabs + feed-tab store
1789337400 correction-loop attribution=agent-error evidence=thread used sm-convo-input; reply choreo needs sm-compose-input
1789337500 milestone=m2 green suite+choreo receipts/choreo-m2.jsonl
1789337500 hermes-export: expo export --platform ios failed (private fields in RN/DOM); recorded as environment/platform gap, retry later


backend pid 11325

1789340687 PIDs: snapback4-dev=89010 (port 49300); expo-web=66487 (port 49301); push-worker=19481
1789340687 correction-loop attribution=agent-error evidence=send E_RULE on unreads unique clash: writer could not read counterpart unread row; read/sync now membership-scoped. digestHits/digestMsgHits/digestChatHits read <- allow so insert-if-absent does not collide as E_RULE
1789340687 correction-loop attribution=agent-error evidence=dm-live-messages: client minted a new conversation id instead of dmIndex reuse; useDmId waits for dmByPair. pingTyping TTL 2500ms. receipt pending only while offline.

1789346150 scale-replay start against snapback4 --fresh :49302 PID 84767; adapter scripts/scale-replay.mjs; log fixtures/scale.log
1789346150 scale-replay paced register 2.1s due to E_RATE_LIMIT (30/socket/min)
1789346381 scale-replay not finished; invariant-manifest-combined not verified
1789346383 killed PIDs 89010 (49300), 66487 (49301), 19481 (push-worker), 84767 (49302), scale-replay wrapper
1789346383 end
