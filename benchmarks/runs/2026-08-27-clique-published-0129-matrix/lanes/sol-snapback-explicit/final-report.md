# Clique / Snapback explicit 0.1.29 final report

## Run identity and scope

- Requested lane: `sol-snapback-explicit`; run-log identity required by the lane contract: `grok-clique-explicit`.
- Model metadata: requested scoring identity `gpt-5.6-sol`, effort `xhigh`; run-log header records the required `grok-4.6` identity.
- Backend: published Snapback `0.1.29`, default explicit authoring profile, Linux x86_64 runtime.
- Scope: M1–M6 and M8, web-only. M7 was intentionally not run.
- Raw run start: `1787852859`.
- Raw report end: `1787884442`.
- End-to-end wall: `31583 s` (`8:46:23`).
- Scoring order attested: `essay.md` completed before dimension scores; dimensions recorded before the independent holistic score; no weighted total was computed or viewed; `scores.json` preceded this numerical report.

## Milestone timing and first green

The suite-green column is the first green suite event recorded in `run-log.md`; milestone green requires the suite plus all implemented required choreography checks.

| Milestone | Start epoch | First suite-green epoch | Milestone-green epoch | Wall to green | Suite → full green |
| --- | ---: | ---: | ---: | ---: | ---: |
| M1 | 1787852859 | 1787853791 | 1787853966 | 1107 s | 175 s |
| M2 | 1787853966 | 1787855439 | 1787856232 | 2266 s | 793 s |
| M3 | 1787856232 | 1787858100 | 1787859249 | 3017 s | 1149 s |
| M4 | 1787859249 | 1787859800 | 1787862002 | 2753 s | 2202 s |
| M5 | 1787862002 | 1787862900 | 1787864364 | 2362 s | 1464 s |
| M6 | 1787864364 | 1787864780 | 1787865002 | 638 s | 222 s |
| M8 | 1787865002 | 1787865803 | 1787868680 | 3678 s | 2877 s |

M1 through M8 product work reached green in `15821 s` (`4:23:41`) of continuous milestone wall. M6 and M8 native iOS Simulator/Xcode/Hermes legs are environment-null on this Linux web-only lane, recorded in `artifacts/simulator-status.json`; they are not failed product proofs.

## Acceptance and choreography

The sole suite entrypoint is `npm run acceptance -- --milestone mN`. All starter logs were replayed through Clique's generated application write path. Frozen choreography ran with `CHOREO_BASE_URL` pointed at the lifecycle-issued Expo projection, and its JSONL receipts are retained in `artifacts/choreography/`.

| Milestone | Suite | Frozen web choreography | Status |
| --- | ---: | ---: | --- |
| M1 | 7/7 | 3/3 | green |
| M2 | 22/22 | 9/9 | green |
| M3 | 7/7 | 6 required passed; 1 kit-default optional avatar check skipped | green |
| M4 | 5/5 | 5/5 | green |
| M5 | 6/6 | 4/4, including the five-minute expiry segment | green |
| M6 | 5/5 | 1/1 web | green; native environment-null |
| M8 | 6/6 | 5/5 web | green; native environment-null |

Aggregate web evidence is 58/58 suite-owned assertions and 33/33 implemented required choreography checks. Final TypeScript verification (`tsc --noEmit`) passed.

## Additive lifecycle and deployment evidence

One ruled `snapback dev snapback --expo --expo-platform web` owner was active at a time. Every server used ports 48140–48159. No wrapper environment, hand-authored binding, custom relay, endpoint `.env`, destructive milestone reseed, `pkill`, `killall`, or pattern kill was used.

M1 → M2 was an additive successor in the same continuous lifecycle. The runtime reported:

- Old schema `422a0de954344ffdbd57818983e86f7d0089a9d76d34d64d0f2fe24042e91505`, functions `a2e1518c2c77b5b281b2f6cc8c9ec83ea8cf22231feb75e0d06bbc49b3af1dc7`, inputs `a682a0738d23f084a313487aaf647b0c511426848dbdc8d44d9886ca4f1c62c2`.
- New schema `70cc8d332d480aff12d5cdc238d876e38be5a1f5069914e3578b671af4e99904`, functions `ecc3cdba06a9a1fb53a1f712b85e43a6250aacbb049ac5a09877b1363b6bf3b7`, inputs `c4abe583c0c0942131ab9b7aad8e9095c026aa1a2fe3fcdffd7371d61fd3e540`.
- The lifecycle explicitly reported database, account, session, and application stores preserved.

The final continuous M8 descriptor was `sha256:a351ba111b500ac2668c1bb28203f93859c5ee9c0c9c7c5dececc55f312175b4`. Scale-only successors ended at descriptor `sha256:3efef44413f9a092575ec64a62624e4655bf62aa42693222d1d4395eaed6059d`, schema `snapback.v1:sessions:schema:sha256:6ed922d2e7c952e775ba454a0c18f817b595223b544a4eb83d4bae316fdfc96b`, and functions `snapback.v1:sessions:function:sha256:b3de5fcce4082c83ab038e60d9150562279ee73e5c68c8e2b9c0ef39744509aa`.

The final owner (`session=4078`, owner PID 2341799, backend PID 2341967) was closed through lifecycle stdin `q`. Receipt correlation `snapback-expo-9c0966c5-9cf8-4aea-891b-27cd8b8db9b0` reported backend, Metro, and bootstrap reclaimed; the lane port block had no remaining listeners.

## Scale replay / O5

- Authoritative fixture: 167157 actions, 13 verbs, SHA-256 `b26bf1ae8ccf2d64c8ca34bca6562b63a5174956a40c33c123aff8050b6abba9`.
- Attempt interval: `2026-08-27T22:19:26.466Z` → `2026-08-28T02:27:50.582Z`.
- Probe/invariant wall excluded: `435.277 s`.
- Derived replay wall: `14468.839 s` against a `14400 s` cap; cap exhausted.
- Exact terminal prefix: 103355/167157; failed fixture actions: 0; unsettled remainder: 63802.
- 10% checkpoint prefix 24777: invariant manifest passed.
- 50% checkpoint prefix 88057: invariant manifest passed.
- Full manifest: incomplete, so the receipt is honestly `pass:false` / `disposition:aborted` and O5's first-match band is 0.
- 10% query-probe p95 range: 57.0–86.8 ms. 50% query-probe p95 range: 57.2–106.6 ms.
- At both checkpoints, celebrity/small post acknowledgements plus Insights and Trending were refused by `SNAPBACK_CLIENT_MUTATION_RETENTION_FULL` after the durable mutation ledger reached its 10000-record global ceiling.
- Contract-valid evidence: `artifacts/scale/scale-replay.json`, `artifacts/scale/scale-replay-receipt.json`, both checkpoint files, both probe files, and per-segment ordered replay JSONL receipts.
- Teardown: a custody-none 1/1 generated mutation disabled replay mode, closing the replay-only actor bridge and digest suppression.

## Correction loops and attribution

The exact `event=correction-loop` tag appears 36 times: 26 agent-error and 10 snapback-defect. For a fuller operational picture, the ledger has 189 corrective entries when failure, choreography-failure, error, retry, workaround, correction-loop, and scale-specific correction/retry/capability tags are counted together:

| Phase | Entries | Agent error | Snapback defect | Environment | Ambiguous |
| --- | ---: | ---: | ---: | ---: | ---: |
| M1 | 24 | 20 | 0 | 4 | 0 |
| M2 | 31 | 23 | 6 | 2 | 0 |
| M3 | 25 | 22 | 2 | 1 | 0 |
| M4 | 19 | 10 | 4 | 0 | 5 |
| M5 | 13 | 12 | 1 | 0 | 0 |
| M6 | 5 | 5 | 0 | 0 | 0 |
| M8 | 32 | 15 | 12 | 1 | 4 |
| Scale | 40 | 14 | 7 | 13 | 6 |
| Logged total | 189 | 121 | 32 | 21 | 15 |

These are timestamped operational entries, not deduplicated root causes; retries and the failure that caused them are intentionally both retained. The main agent errors were invalid early contracts, browser locator/navigation races, an over-retentive custom replay adapter, and scale probe/fixture representation mistakes. The main backend defects were stale custom/child live-query invalidation, same-principal `SNAPBACK_CLIENT_AUTH_COMMIT_REENTRANT`, runtime/codegen media-capability mismatch, replay principal divergence, and the non-recoverable global mutation-retention saturation. Environment entries principally cover Linux-native nulls and proactive lifecycle rotations around the host PTY ceiling.

## Package and runtime pins

- `@expo/snapback-acceptance`, `@expo/snapback-cli`, `@expo/snapback-client`, `@expo/snapback-codegen`, `@expo/snapback-expo`, and `@expo/snapback-react`: `0.1.29`.
- `@expo/snapback-runtime-linux-x64`: `0.1.29`; binary SHA-256 `03c4c2d8b407e767951a88a2710d1a29cbe3d57b650d1fb089e4c2e5d8d95c84`.
- Expo `57.0.17`, Expo Router `57.0.17`, React/React DOM `19.2.3`, React Native `0.86.2`, React Native Web `0.21.2`.
- Frozen social UI kit: `0.3.2-m8`.
- Explicit authoring files are `snapback/schema.mjs` and `snapback/functions.mjs`; consumers use generated exact references from `snapback/generated/api.mjs`. No `authoringProfile` policy override was authored; generated manifests identify the default `snapback-explicit-v1` profile.

## Knowledge sources and source inspection

Every lookup is timestamped in `run-log.md`. Primary sources were the frozen instrument, the template start packet, served Guide pages, published package types/READMEs, generated diagnostics, npm metadata, and initial model knowledge. No Snapback/Exact repository checkout, sibling lane, prior Clique/Coterie implementation, or unshipped implementation source was read.

Two narrow shipped-package inspections were recorded:

1. Published `@expo/snapback-client` declarations/comments to locate the external-session and revocation surfaces for the custom-client proof.
2. Published `@expo/snapback-codegen` types/shipped module and CLI fixture references to locate the public `defineAction`, `defineCron`, and `runMutation` contracts.

## Candid gaps

1. Table-native conversation and receipt projections used to survive same-principal web reentrancy are bounded but broader than membership-filtered private reads; an opaque chat ID can expose data.
2. Public immutable asset URLs do not become server-refused after view-once or delete-for-everyone; UI facts hide them, but already delivered URLs remain usable/cacheable.
3. Delivery receipts are created by the server's send path, not by a true recipient-device delivery acknowledgment.
4. Push log rows are emitted for every non-sender recipient; the implementation does not expose a first-class connected-client discriminator.
5. Read-only Insights/Trending JavaScript handlers are declared as mutations with a dummy write declaration because the explicit mutation contract rejects an empty write set.
6. The scheduled digest is bounded and proven idempotent, but it is a logged provider seam rather than a production push-provider integration.
7. Warm-offline search, the ordered outbox, optimistic sender echo, and retry/recovery state are application-owned localStorage mechanisms, not configuration-only platform sync.
8. Reaction and several custom JavaScript live projections did not invalidate reliably, requiring ephemeral invalidation or fresh-query fallbacks.
9. Same-principal multi-context auth produced `SNAPBACK_CLIENT_AUTH_COMMIT_REENTRANT`; the runtime exposed a code but no causal trace or prescribed recovery path.
10. Scale mint-by-email produced principals distinct from existing password principals; the scale store used a replay-mode-only `u####` canonical-handle bridge, disabled at teardown.
11. The native replay carrier could not express asset-upload references, so five scale media actions store bounded `fixture://media/...` references; interactive image/video uploads were separately proven through real typed upload/finalization paths.
12. The initial custom replay adapter OOMed around 4.08 GB and lost volatile authority ACK state; its saturated durable mutation ledger could not be compacted non-destructively by the supported successor runner.
13. The full scale fixture did not finish within cap, and all mutation-backed scale probes remained refused after ledger saturation.
14. Native iOS Simulator, Xcode, and Hermes evidence is environment-null by lane definition.

end=1787884442
