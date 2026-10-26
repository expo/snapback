# DX12 measurements and verification

Source evidence is read-only under `~/sb4-loop/wave29/apps/`. Replays use owned
copies under `/tmp/dx12-replay/`; credentials and command payloads are excluded
from retained results. No provider preference or builder-time savings are inferred.

| Cluster | Replay | Result |
| --- | --- | --- |
| Serve-driver loops | unchanged `prod:serve` and `client:calls` in lanes 009, 010, 021, 031, 039, 041, 043, 050, through `withServeScript` | 8/8 pass; every lock released; 141.178 s total, median 2.410 s |
| Deploy output | fifty identical copied source sets, fresh production stores, published 0.4.42 versus immutable DX12 binary copy; each row records its binary SHA-256 | 50/50 pass in both arms; median complete stdout+stderr 33 → 5 lines |
| Expo text, 009 | original frontend journey, existing bundled UI; replace its `body.innerText` workaround with `renderedText`, reset scroll before assertion | baseline kit misses the fresh text; DX12 passes |
| Expo text, 015 | actual copied app, real login, unique below-fold leaf | baseline finds text while it is outside the viewport; DX12 scrolls it into view |
| Development accounts | all 23 Codex source sets; existing role enum and custom text provisioning arguments | 23/23 pass; 93 real password sign-ins |
| Partial form claims | trusted browser click, handler-owned extra arguments, and mismatched named arguments | subset claims receive a sent receipt; a named-value mismatch still fails explicitly |

`serve-measurements.json` retains exploratory failures: 031 first lacked the
copied Vite executable link, while 043/050 exceeded an exploratory 45-second
command guard. `serve-retry-measurements.json` records their successful replays
with dependency links restored and a 120-second command guard. The product's
default proof deadline was already 120 seconds. `serve-summary.json` uses the
successful final result for each lane. Legacy `client:calls` reads CALLS_USERS;
the callback provides a private 0600 bridge file, deleted with its copy.

The published controls are in `~/sb4-loop/dist/0.4.42/`. Reproduction requires
the commissioned Snapback 4 install/build setup. `replay.mjs --deploys` unpacks
the native control, snapshots the candidate binary, recreates every store, and
records digests and counts. Its workers all settle before exceptional cleanup.
The text helpers unpack their own client control; `replay-development.mjs`
exercises the existing provision plans. Run replay helpers sequentially because
they use fixed owned subtrees. `replay.mjs --serves` uses the built client and
native binary with copied production stores. Each helper awaits owned hosts and
cleans its copies; final cleanup also removes unpacked controls. `cleanup.json`
records that the complete temporary replay tree was removed.

`run-scoped.mjs` preserves the conservative `affected.mjs` plan and uses its
normal execution/receipt machinery for twelve disclosed steps. Shared await
support makes the conservative plan select seven Rust crates and 442 client
files. The brief explicitly forbids the complete crate battery and client pool,
so the receipt says `fullSelectorPlanExecuted:false` and `qualification:false`.
It is affected task verification, with no publication claim.

Ordinary group SIGTERM includes npm and its shell. The checker can observe npm
failure, group reaping and lock release; it cannot certify every descendant's
shutdown hook. Callback work must honor its AbortSignal or bound its resources.
Mac/native execution is skipped. Security and release semantics retain their
existing owners.
