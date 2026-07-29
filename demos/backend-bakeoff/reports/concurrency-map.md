# LLP 0102 concurrency map

**Coordinator:** primary Codex agent on the control-plane Mac
**Frozen Snapback commit:** `ed31c1dd428298dc7ab4734ee2e3c2354112ba1a`
**Integration rule:** workers own only their isolated arm directory and return a
diary-entry draft. The coordinator alone edits shared diaries, reports,
remediation ledgers, scoring inputs, and the primary worktree.

| Frozen start order | Arm | Worker / machine | Isolation | Merge ownership |
| ---: | --- | --- | --- | --- |
| 1 | Chat / Appwrite | Coordinator / control-plane Mac | Primary arm directory; Appwrite API `8090`, installer `20080`, Vite `4186`; exact official Compose project and disposable Appwrite CLI session; fresh project `llp0102-chat-appwrite` | Coordinator writes and audits directly |
| 2 | Chat / Firebase | Worker 1 / Apartment MacBook Air `100.70.173.122` | Detached remote checkout at `/Users/ccheever/worktrees/llp0102-chat-firebase` on the frozen commit; emulator project `llp0102-chat-firebase-w1`; Auth `9299`, Firestore `8280`, UI `4287`, hub/log `4501/4502`; worktree-local Firebase/XDG state | Worker returns the complete arm plus diary draft; coordinator imports and audits |
| 3 | Chat / Convex | Worker 2 / Hetzner `expo-build-1000` `100.65.137.99` | Detached remote checkout at `/home/ccheever/worktrees/llp0102-chat-convex` on the frozen commit; anonymous local deployment and worktree-local CLI state; backend `3310`, site `3311`, Vite `4288`; namespace `llp0102-chat-convex-w2` | Worker returns the complete arm plus diary draft; coordinator imports and audits |
| 4 | Chat / Supabase | Worker 3 / control-plane Mac, separate worktree | Detached worktree `/private/tmp/llp0102-chat-supabase` on the frozen commit; Docker project/volume namespace `llp0102-chat-supabase-w3`; Supabase API/DB/Studio range rooted at `55421`; Vite `4289`; worktree-local CLI state | Worker returns the complete arm plus diary draft; coordinator imports and audits |
| 5 | Chat / Snapback | Coordinator / control-plane Mac | Detached worktree `/private/tmp/llp0102-chat-snapback` on the exact frozen commit; fresh local SQLite target, dynamically allocated exact Snapback/Vite ports, arm-owned runtime and sessions, no hosted claim | Coordinator writes and audits directly |
| 6 | Chat / InstantDB | Worker 2 / Hetzner `expo-build-1000` `100.65.137.99` | Detached local worktree `/private/tmp/llp0102-chat-instantdb` with remote execution mirror `/home/ccheever/worktrees/llp0102-chat-instantdb`; worktree-local CLI/XDG state; Vite `4290`; fresh disposable Instant app or exact arm namespace `llp0102-chat-instantdb-w2` | Worker returns the complete arm plus diary draft; coordinator imports and audits |
| 7 | Chat / SpacetimeDB | Worker 1 / Apartment MacBook Air `100.70.173.122` | Detached local worktree `/private/tmp/llp0102-chat-spacetimedb` with remote execution mirror `/Users/ccheever/worktrees/llp0102-chat-spacetimedb`; worktree-local CLI/config/home; local server `3312`, Vite `4291`; exact database/namespace `llp0102-chat-spacetimedb-w1` | Worker returns the complete arm plus diary draft; coordinator imports and audits |

Later arms are assigned from the frozen per-app order as workers free up.
Independent arms may finish out of order, but no later arm is dispatched before
the earlier arm has been assigned. Every worker must use exact target-bound
cleanup, retain failed attempts, avoid shared diary/report edits, and stop on an
LLP 0102 Stop-class defect.

## Live progress

| Arm | State | Coordinator integration |
| --- | --- | --- |
| Chat / Appwrite | Complete | Capsule, diary, audit, and cleanup proof integrated |
| Chat / Firebase | Complete | Capsule, diary, worker audit, and cleanup proof integrated |
| Chat / Convex | Complete | Capsule, diary, worker audit, logout adjudication, and cleanup proof integrated |
| Chat / Supabase | Complete | Capsule, diary, coordinator audit, and cleanup proof integrated |
| Chat / Snapback | Complete | Capsule, diary, coordinator audit, issue links, and cleanup proof integrated |
| Chat / InstantDB | Complete | Capsule, diary, worker audit, failed attempts, exact data/user cleanup, token invalidation, and disclosed provider-managed shell expiry integrated |
| Chat / SpacetimeDB | Complete | Capsule, diary, worker audit, preserved cleanup failure, and exact cleanup proof integrated |
