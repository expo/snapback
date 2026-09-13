# Replica startup audit

- Audit date: 2026-09-13
- Delivery revision inspected: `714027ef962ed667c2a983d816f232ecf1089ae3`
- Disposition: the original ticket closure is supported as obsolete only; the current evidence does not localize a new replica defect

## Implementation lineage

The closed ticket `issues/closed/20260913-snapback4-replica-apply-quadratic.md` traced an unbenchmarked complexity defect at baseline `6918cccbc264cf000982b03a5a11a2cf5563f885`: `snapback4/packages/snapback4/src/replica/store.ts:118-126,213-228` kept each index in a JavaScript array and used a binary search followed by per-row `splice`, causing O(k·n²) array moves for n applied rows across k indexes.

Commit `993688b29` deleted the entire `packages/snapback4/src/replica/*` implementation. The qualified Snapback 4 0.2.6 revision `342c53d306d7484cd64e820ee27a151e02eb4b0b` and inspected delivery revision route the browser through the Rust/WASM `WebDevice` over `MemoryStore` (`snapback4/crates/snapback4-device/src/web.rs:1-38`). The replacement stores rows and index entries in `BTreeMap` (`snapback4/crates/snapback4-device/src/memory.rs:30-38`) and applies row/index changes with map insertion and removal (`memory.rs:284-299,417-433`). The exact JavaScript array-memmove cause is absent. This supports closing the original report as obsolete; it does not establish a performance claim for the replacement.

## Observed benchmark values

- `/Users/ccheever/clique-sb4-20260913-full-3models/lanes/astra-snapback4/evidence/scale-sync-counts-before-fix.json` — SHA-256 `bd69e6a99f32a0816a03a9aa392ba7dfcca665565cbf705469b9c5bb6c406922`: 45,719 events, 12 pages, 10,595,486 bytes, and 227 ms summed server response time. The snapshot included 24,616 `repostCounts` entries.
- `/Users/ccheever/clique-sb4-20260913-full-3models/lanes/astra-snapback4/evidence/scale-sync-counts.json` — SHA-256 `6a789868db2ac0af2460bcb1567b5afbf2bf9f739d2ea804eac8cff901729515`: 22,099 events, 6 pages, 5,694,136 bytes, and 138 ms summed server response time after unused application counter state was removed. The 24,616 removed `repostCounts`, plus 492 `activeRepostCounts` and 504 `repostEdges` added in the replacement shape, account exactly for the 23,620-event reduction.
- `/Users/ccheever/clique-sb4-20260913-full-3models/lanes/astra-snapback4/evidence/scale-browser-50pct-attempt1.json` — SHA-256 `0508e554eab45a4ae8dc384a6a2e5c41edc5f2fb9f1f660b4536d5c1c0ac2bc7`: the larger snapshot run timed out after 30,290 ms waiting for the following-feed UI.
- `/Users/ccheever/clique-sb4-20260913-full-3models/lanes/astra-snapback4/evidence/scale-startup-diagnostic.json` — SHA-256 `c9ec2b3eed8b7c59a56920bd0de299f4a6dd71a57c1a39ea378d7921fe6ca52b`: start-to-ready was 29,934 ms, while 13 `/sync` responses summed to 189 ms.
- `/Users/ccheever/clique-sb4-20260913-full-3models/lanes/astra-snapback4/evidence/scale-browser-50pct-after-fix2.json` — SHA-256 `2dc74ea602f65ff8a506815835497de4e320471332fd8f91582d79f48412bdfd`: the reduced snapshot passed with `coldStartMs` 14,752.613375.
- `/Users/ccheever/clique-sb4-20260913-full-3models/lanes/astra-snapback4/evidence/scale-browser-50pct.json` — SHA-256 `5fa909b83ce61ac3f32e7f1b92b381e2b076bfbd8e8fa5465df0f9e8ecefadcf`: a later reduced-snapshot run passed with `coldStartMs` 14,276.962459.

## Timing boundary and inference limits

The browser probe measures from initial navigation through login, following-feed readiness, chats navigation, and the first chat row (`scripts/scale-browser-probes.mjs:17-25`). It therefore combines network transfer, authentication, device open/apply/persistence, query evaluation, application work, rendering, and navigation. The evidence contains server response durations for `/sync`, but no device-apply span or profile.

Reducing the snapshot by about half coincided with roughly halving observed cold-start duration, so the evidence supports a volume-sensitive whole-startup observation. It does not identify which client phase dominates, demonstrate quadratic scaling, or reproduce the removed JavaScript mechanism. Without phase timing, a controlled event-count curve, or a stated violated product budget, a separate performance ticket would be speculative and is not justified by this audit.
