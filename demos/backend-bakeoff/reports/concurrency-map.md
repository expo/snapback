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

## Stage 2 remediation concurrency

All remediation worktrees start at calibration commit `d4d8fc21`. Workers may
edit only their assigned product/test/arm-local evidence scope and return a
commit plus integration notes. The coordinator owns shared issues, Guide,
diaries, reports, ledger status, rerun capsules, final merge, and full proof.

| Ledger entry | Worker / machine | Isolation | Merge ownership |
| --- | --- | --- | --- |
| SB-001 protected live revocation | Worker 1 / control-plane Mac | Detached worktree `/private/tmp/llp0102-remed-revocation`; dedicated dynamic test ports and runtime dirs; no shared demo target | Coordinator reviews and cherry-picks |
| SB-002 idempotent live disposal | Worker 2 / Hetzner `expo-build-1000` | Detached local worktree `/private/tmp/llp0102-remed-disposal` plus remote mirror `/home/ccheever/worktrees/llp0102-remed-disposal`; test-local client/server state | Coordinator reviews and cherry-picks |
| SB-003 ephemeral readiness and generated typing | Worker 3 / Apartment Air | Detached local worktree `/private/tmp/llp0102-remed-ephemeral` plus remote mirror `/Users/ccheever/worktrees/llp0102-remed-ephemeral`; dedicated dynamic ports and runtime dirs | Coordinator reviews and cherry-picks |
| SB-004 effect-free reservation retry | Coordinator / control-plane Mac | Primary checkout; exact closed-diagnostic retry tests and frozen-arm rerun remain isolated from worker worktrees | Implemented in `ca46e040`; coordinator owns Guide/diary/ledger integration and rerun proof |

## Stage 3 deep-round concurrency

The deep round freezes Snapback product source at
`5f31cb6174daaefa04a1e05242acbbc22c725040`. Provider order governs
assignment/start order. Independent arms may finish out of order. Workers edit
only their arm directory and worktree-local runtime state; they return a commit,
raw arm artifacts, and a diary-entry draft. The coordinator alone integrates
shared diaries, reports, scoring, evidence audits, remediation ledgers, and the
primary branch.

### Linear first wave

| Frozen start order | Arm | Worker / machine | Isolation | Merge ownership |
| ---: | --- | --- | --- | --- |
| 1 | Linear / SpacetimeDB | Worker 1 / Minisforum Ubuntu `100.126.225.7` | Remote detached worktree `/home/ccheever/worktrees/llp0102-linear-spacetimedb-w1`; worktree-local CLI/config/data roots; standalone server `3320`, Vite `4320`; exact database namespace `llp0102-linear-spacetimedb-w1`; hosted claim only if an arm-scoped target becomes directly available | Worker returns arm commit/artifacts and diary draft; coordinator imports and audits |
| 2 | Linear / Firebase | Worker 2 / control-plane Mac, isolated worktree | Detached worktree `/private/tmp/llp0102-linear-firebase-w2`; emulator project `llp0102-linear-firebase-w2`; Auth `9321`, Firestore `8321`, Functions `5321`, Storage `9421`, UI `4321`, hub/log `4521/4522`; worktree-local Firebase/XDG state and browser profile | Worker returns arm commit/artifacts and diary draft; coordinator imports and audits |
| 3 | Linear / Supabase | Worker 3 / control-plane Mac, isolated worktree | Detached worktree `/private/tmp/llp0102-linear-supabase-w3`; Docker project/volume namespace `llp0102-linear-supabase-w3`; API/DB/Studio port range rooted at `56431`; Vite `4322`; worktree-local CLI/XDG state and fresh local project | Worker returns arm commit/artifacts and diary draft; coordinator imports and audits |

The coordinator retains the Linear/Snapback arm and does not begin it before
the first three provider assignments. As workers free, the remaining frozen
Linear order is Snapback, Convex, Appwrite, InstantDB; Partiful and Research
Room then follow their own frozen orders. Every assignment must preserve failed
attempts, exact target-bound cleanup, baseline state, and Stop-class pause
behavior.

### Linear second wave

| Frozen start order | Arm | Worker / machine | Isolation | Merge ownership |
| ---: | --- | --- | --- | --- |
| 4 | Linear / Snapback | Coordinator / control-plane Mac | Detached worktree `/private/tmp/llp0102-linear-snapback-coord`; frozen product commit `5f31cb6174daaefa04a1e05242acbbc22c725040`; fresh local SQLite target, dynamic exact server/Vite ports, arm-owned runtime/session/persona carriers | Coordinator implemented, audited, integrated, and cleaned the arm |
| 5 | Linear / Convex | Coordinator / control-plane Mac | Detached worktree `/private/tmp/llp0102-linear-convex-coord` at integration base `2a4472a4`; anonymous local Convex deployment with worktree-local CLI/config/data state; backend/site `3323/3324`, Vite `4323`; namespace `llp0102-linear-convex-coord` | Coordinator writes and audits directly; no shared report or scoring edit until arm evidence is complete |
| 6 | Linear / Appwrite | Worker 2 / control-plane Mac, isolated worktree | Detached worktree `/private/tmp/llp0102-linear-appwrite-w2` at integration base `2a4472a4`; official Compose project/volume namespace `llp0102-linear-appwrite-w2`; API `8091`, installer `20081`, Vite `4324`; worktree-local Appwrite CLI/config/session state and fresh arm-owned project/database/team/users | Worker returns only the arm commit/artifacts and diary draft; coordinator imports, audits, scores, and serializes shared files |
| 7 | Linear / InstantDB | Worker 3 / control-plane Mac, isolated worktree | Detached worktree `/private/tmp/llp0102-linear-instantdb-w3` at integration base `2a4472a4`; worktree-local CLI/XDG/browser state; Vite `4325`; fresh disposable Instant app when available, otherwise exact arm-owned namespace `llp0102-linear-instantdb-w3` on the authorized shared/free target | Worker returns only the arm commit/artifacts and diary draft; coordinator imports, audits, scores, and serializes shared files |

All seven Linear arms have now been assigned in exact frozen order.

## Stage 3 live progress

| Arm | State | Coordinator integration |
| --- | --- | --- |
| Linear / SpacetimeDB | Complete | 11 PASS, search/offline GAPs, hosted unavailable; capsule, diary, central evidence audit, migration proof, and cleanup-confidence correction integrated |
| Linear / Firebase | Complete | 12 PASS, one native-search GAP, one hosted credential-unavailable result; capsule, diary draft, evidence audit, and cleanup proof integrated |
| Linear / Supabase | Complete | 12 PASS, offline and hosted GAPs; capsule, diary, evidence audit, retained cold-Realtime failure, and cleanup proof integrated |
| Linear / Snapback | Complete | Capsule verifier, diary, LLP audit, guide-gap ticket, failed attempts, and cleanup proof integrated in `d3a6390a` |
| Linear / Convex | Complete | 12 PASS, offline GAP, hosted credential-unavailable; capsule, diary, coordinator evidence audit, corrected performance attempt, and exact cleanup integrated |
| Linear / Appwrite | Complete | 12 PASS, offline GAP, hosted unavailable; capsule, diary, central audit, native transaction/search evidence, and exact 29-container cleanup integrated |
| Linear / InstantDB | Complete | 12 PASS, search/operations GAPs; capsule, diary, central audit, cold-browser offline proof, format correction, and exact data/user cleanup integrated |

### Partiful first wave

| Frozen start order | Arm | Worker / machine | Isolation | Merge ownership |
| ---: | --- | --- | --- | --- |
| 1 | Partiful / Supabase | Coordinator / control-plane Mac | Detached worktree `/private/tmp/llp0102-partiful-supabase-coord` at the current evidence-integration head without Snapback product edits; official local Supabase stack with exact project/volume namespace `llp0102-partiful-supabase-coord`; API/DB/Studio range rooted at `57431`, Vite `4330`; worktree-local CLI/XDG state and fresh local project | Coordinator writes and audits directly; shared diary/report edits only after arm evidence and exact cleanup are complete |
| 2 | Partiful / Firebase | Worker 1 / control-plane Mac, isolated worktree | Detached worktree `/private/tmp/llp0102-partiful-firebase-w1`; emulator project `llp0102-partiful-firebase-w1`; Auth `9331`, Firestore `8331`, Functions `5331`, Storage `9431`, UI/Vite `4331/4332`, hub/log `4531/4532`; worktree-local Firebase/XDG/browser state and exact process ownership | Worker returns only the arm commit/artifacts and diary draft; coordinator imports, audits, scores, and serializes shared files |
| 3 | Partiful / SpacetimeDB | Worker 2 / Minisforum Ubuntu `100.126.225.7` | Remote detached worktree `/home/ccheever/worktrees/llp0102-partiful-spacetimedb-w2`; worktree-local CLI/config/data roots; standalone server `3332`, Vite `4333`; exact database namespace `llp0102-partiful-spacetimedb-w2`; hosted claim only with direct arm-scoped Maincloud evidence | Worker returns only the arm commit/artifacts and diary draft; coordinator imports, audits, scores, and serializes shared files |
| 4 | Partiful / Appwrite | Worker 3 / control-plane Mac after failed Hetzner container-runtime preflight | Detached worktree `/private/tmp/llp0102-partiful-appwrite-w3`; official Compose project/volume namespace `llp0102-partiful-appwrite-w3`; API `8092`, secondary gateway `8492`, installer `20082`, Vite `4334`; worktree-local Appwrite CLI/config/session/browser state and fresh arm-owned project/database/team/users. The rejected Hetzner attempt is retained: no Docker/Podman/nerdctl, install authority, or viable rootless namespace path. | Worker returns only the arm commit/artifacts and diary draft; coordinator imports, audits, scores, and serializes shared files |
| 5 | Partiful / Snapback | Worker 1 / control-plane Mac, exact frozen product worktree | Detached worktree `/private/tmp/llp0102-partiful-snapback-w1` at product/source commit `5f31cb6174daaefa04a1e05242acbbc22c725040`; arm-owned SQLite target/runtime/sessions/persona carriers; server `3335`, Vite `4335`; exact namespace `llp0102-partiful-snapback-w1`; no hosted claim without direct evidence | Worker returns only the arm commit/artifacts and diary draft; coordinator imports, audits, scores, guide-gaps, and serialized shared files |
| 6 | Partiful / Convex | Worker 2 / Minisforum Ubuntu `100.126.225.7` | Remote detached worktree `/home/ccheever/worktrees/llp0102-partiful-convex-w2`; worktree-local Convex CLI/config/data/browser state; local backend/site `3336/3337`, Vite `4336`; exact deployment namespace `llp0102-partiful-convex-w2`; fresh anonymous local target unless a directly authorized arm-scoped hosted target is available | Worker returns only the arm commit/artifacts and diary draft; coordinator imports, audits, scores, and serializes shared files |
| 7 | Partiful / InstantDB | Worker 3 / control-plane Mac, isolated worktree | Detached worktree `/private/tmp/llp0102-partiful-instantdb-w3`; worktree-local CLI/XDG/browser/profile state; Vite `4337`, browser-debug `9337`; fresh disposable Instant app when available, otherwise exact namespace `llp0102-partiful-instantdb-w3` on the authorized shared/free target with a timestamped baseline and namespace-only cleanup | Worker returns only the arm commit/artifacts and diary draft; coordinator imports, audits, scores, and serializes shared files |

All seven Partiful arms have now been assigned in exact frozen order.

## Partiful live progress

| Arm | State | Coordinator integration |
| --- | --- | --- |
| Partiful / Supabase | Complete | 14 PASS, hosted unavailable; capsule, diary, central evidence audit, retained cold-Realtime/effect failures, and exact cleanup integrated |
| Partiful / Firebase | Complete | 14 PASS, hosted unavailable; capsule, separate PARTY-07 remediation lineage, diary, central evidence audit, hashes, and exact two-target cleanup integrated |
| Partiful / SpacetimeDB | Complete | 14 PASS, hosted unavailable; canonical attempt ID, 15/16 calibrated confidence, capsule, diary, inventory audit, exact identity deletion, and closed-port proof integrated |
| Partiful / Appwrite | Complete | 14 PASS, hosted unavailable; calibrated 15/16 confidence, capsule, diary, central audit, retained Realtime/schedule/cleanup failures, and exact 29-container cleanup integrated |
| Partiful / Snapback | Complete | 12 PASS, three explicit product GAPs; capsule, diary, central evidence audit, calibrated 14/16 confidence, five guide-gap tickets, and exact cleanup integrated |
| Partiful / Convex | Complete | 14 PASS, hosted unavailable; separate PARTY-07 live-RSVP remediation lineage, calibrated 14/16 confidence, diary, central audit, and exact two-target cleanup integrated |
| Partiful / InstantDB | Complete | 9 PASS, six explicit product GAPs; retained linked-rule stream-invalidation failure, remediated fresh-target model, calibrated 13/16 confidence, three-target cleanup, diary, and central audit integrated |

### Research Room first wave

| Frozen start order | Arm | Worker / machine | Isolation | Merge ownership |
| ---: | --- | --- | --- | --- |
| 1 | Research Room / Snapback | Worker 1 / control-plane Mac, exact frozen product worktree | Detached worktree `/private/tmp/llp0102-research-snapback-w1` at product/source commit `5f31cb6174daaefa04a1e05242acbbc22c725040`; arm-owned SQLite target/runtime/sessions/persona carriers; server `3340`, Vite `4340`, effect receiver `20440`, browser-debug `9340`; exact namespace `llp0102-research-snapback-w1`; no hosted claim without direct evidence | Worker returns only the arm commit/artifacts, diary draft, and guide-gap drafts; coordinator imports, audits, scores, files guide gaps, and serializes shared files |
| 2 | Research Room / Supabase | Worker 2 / control-plane Mac after Partiful/Convex cleanup | Detached worktree `/private/tmp/llp0102-research-supabase-w2` at the current evidence-integration base with no Snapback product edits; official local Supabase stack with exact Docker project/volume namespace `llp0102-research-supabase-w2`; API/DB/Studio range rooted at `58431`, Vite `4341`; worktree-local CLI/XDG state and a fresh local project | Worker starts only after its Partiful/Convex target is sealed and cleaned, then returns only the arm commit/artifacts and diary draft; coordinator imports, audits, scores, and serializes shared files |
| 3 | Research Room / Firebase | Worker 3 / control-plane Mac after Partiful/InstantDB cleanup | Detached worktree `/private/tmp/llp0102-research-firebase-w3` at the current evidence-integration base; emulator project `llp0102-research-firebase-w3`; Auth `9342`, Firestore `8342`, Functions `5342`, Storage `9442`, UI/Vite `4342/4343`, hub/log `4542/4543`, Pub/Sub `8142`, Eventarc `9343`, Tasks `9542`, Hosting `5042`; worktree-local Firebase/Java/XDG/browser state and exact process ownership | Worker starts only after the InstantDB hosted target is sealed and exactly cleaned, then returns only the arm commit/artifacts and diary draft; coordinator imports, audits, scores, and serializes shared files |
| 4 | Research Room / SpacetimeDB | Worker 1 / Apartment MacBook Air `100.70.173.122` after Research/Snapback cleanup | Remote detached worktree `/Users/ccheever/worktrees/llp0102-research-spacetimedb-w1` at the current evidence-integration base; worktree-local CLI/config/data roots; standalone server `3344`, Vite `4344`; exact database namespace `llp0102-research-spacetimedb-w1`; hosted claim only with direct arm-scoped Maincloud evidence | Worker starts only after its frozen Snapback target is sealed and cleaned, returns the arm commit/artifacts and diary draft, and leaves shared reports/scoring to the coordinator |
| 5 | Research Room / Convex | Worker 2 / Minisforum Ubuntu `100.126.225.7` after Research/Supabase cleanup | Remote detached worktree `/home/ccheever/worktrees/llp0102-research-convex-w2` at the then-current evidence-integration base; fresh anonymous local deployment; worktree-local CLI/config/data/browser roots; backend/site `3345/3346`, Vite `4345`; exact namespace `llp0102-research-convex-w2` | Worker may start only after Research/Supabase is sealed/cleaned; it returns arm artifacts and diary draft while coordinator owns shared integration |
| 6 | Research Room / Appwrite | Worker 1 / control-plane Mac after Research/SpacetimeDB cleanup and Convex start gate | Detached worktree `/private/tmp/llp0102-research-appwrite-w1` at the then-current evidence-integration base; official Compose project/volume namespace `llp0102-research-appwrite-w1`; API `8093`, secondary gateway `8493`, installer `20083`, Vite `4346`; worktree-local CLI/config/session/browser state and fresh project/database/team/users | Worker must receive coordinator confirmation that Research/Convex has started before provisioning; returns only arm artifacts and diary draft |
| 7 | Research Room / InstantDB | Worker 3 / control-plane Mac after Research/Firebase cleanup and Appwrite start gate | Detached worktree `/private/tmp/llp0102-research-instantdb-w3` at the then-current evidence-integration base; worktree-local CLI/XDG/browser state; Vite `4347`, browser debug `9347`; fresh disposable hosted app with exact redacted target identity and target-scoped cleanup | Worker must receive coordinator confirmation that Research/Appwrite has started before provisioning; returns only arm artifacts and diary draft |

All seven Research Room arms are assigned in exact frozen order. Appwrite and
InstantDB retain explicit start barriers so faster earlier workers cannot
violate that order.

## Research Room live progress

| Arm | State | Coordinator integration |
| --- | --- | --- |
| Research Room / Snapback | Complete | Product-blocked: 1 PASS, two capability GAPs, 12 FAIL; sessions-plus-streaming admission defect, 8/16 calibrated confidence, diary, guide-gap issue, central audit, and exact cleanup integrated |
| Research Room / Supabase | Assigned | Worker 2 queued on an isolated control-plane Supabase namespace after exact Partiful/Convex cleanup |
| Research Room / Firebase | Assigned | Worker 3 queued on an isolated emulator project/port set after exact Partiful/InstantDB cleanup |
| Research Room / SpacetimeDB | Assigned | Worker 1 queued on an isolated Apartment Air standalone database after exact Research/Snapback cleanup |
| Research Room / Convex | Assigned | Worker 2 queued on a fresh Minisforum anonymous deployment after Research/Supabase cleanup |
| Research Room / Appwrite | Assigned / start-gated | Worker 1 queued on an isolated control-plane Compose project; provisioning waits for coordinator confirmation that Convex started |
| Research Room / InstantDB | Assigned / start-gated | Worker 3 queued on a fresh hosted temporary app; provisioning waits for coordinator confirmation that Appwrite started |
