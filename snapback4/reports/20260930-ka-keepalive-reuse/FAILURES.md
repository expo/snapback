# KA round 0 — complete failure ledger

Full scripts/test.sh run: zero failures. The table records every earlier or additional
failed case and each compiler diagnostic, without counting the runner’s repeated
failure-detail block twice. Original assertions and stacks remain in the logs.
Logs normalize trailing whitespace and EOF blank lines. The initial staged
whitespace check is a separate corrected **ours** failure, recorded in
[staged-whitespace-initial.log](./staged-whitespace-initial.log).

| Classification | Log line | Failure | Disposition |
| --- | --- | --- | --- |
| ours | [await-boundary-initial.log:1](./await-boundary-initial.log#L1) | every delivery await is explicitly classified (153.766679ms) | Reviewed and regenerated await classification; final classification passes. |
| baseline | [baseline-descheduled.log:6](./baseline-descheduled.log#L6) | descheduled dev: idle pooled SDK socket (0) (5691.880054ms) | Expected detecting control against starting implementation; corresponding fixed case passes. |
| baseline | [baseline-headers.log:1](./baseline-headers.log#L1) | dev: keep-alive headers agree with HTTP connection policy (152.915278ms) | Expected detecting control against starting implementation; corresponding fixed case passes. |
| baseline | [baseline-headers.log:2](./baseline-headers.log#L2) | serve: keep-alive headers agree with HTTP connection policy (85.070226ms) | Expected detecting control against starting implementation; corresponding fixed case passes. |
| baseline | [baseline-large-body.log:6](./baseline-large-body.log#L6) | Node SDK query survives a client pause across the dev idle deadline (0) (5506.052988ms) | Expected detecting control against starting implementation; corresponding fixed case passes. |
| baseline | [baseline-large-body.log:10](./baseline-large-body.log#L10) | Node SDK query survives a client pause across the dev idle deadline (2) (5795.738816ms) | Expected detecting control against starting implementation; corresponding fixed case passes. |
| baseline | [baseline-large-body.log:12](./baseline-large-body.log#L12) | Node SDK query survives a client pause across the dev idle deadline (3) (5986.571631ms) | Expected detecting control against starting implementation; corresponding fixed case passes. |
| baseline | [baseline-load-8.log:6](./baseline-load-8.log#L6) | Node SDK query survives a client pause across the dev idle deadline (0) (6899.593422ms) | Expected detecting control against starting implementation; corresponding fixed case passes. |
| baseline | [baseline-load-8.log:8](./baseline-load-8.log#L8) | Node SDK query survives a client pause across the dev idle deadline (1) (6678.283857ms) | Expected detecting control against starting implementation; corresponding fixed case passes. |
| baseline | [baseline-load-8.log:10](./baseline-load-8.log#L10) | Node SDK query survives a client pause across the dev idle deadline (2) (6682.347002ms) | Expected detecting control against starting implementation; corresponding fixed case passes. |
| baseline | [baseline-load-8.log:16](./baseline-load-8.log#L16) | Node SDK query survives a client pause across the dev idle deadline (5) (6704.711102ms) | Expected detecting control against starting implementation; corresponding fixed case passes. |
| baseline | [baseline-load-8.log:18](./baseline-load-8.log#L18) | Node SDK query survives a client pause across the dev idle deadline (6) (6788.033513ms) | Expected detecting control against starting implementation; corresponding fixed case passes. |
| baseline | [baseline-load-8.log:20](./baseline-load-8.log#L20) | Node SDK query survives a client pause across the dev idle deadline (7) (6944.066038ms) | Expected detecting control against starting implementation; corresponding fixed case passes. |
| baseline | [baseline-load.log:2](./baseline-load.log#L2) | Node SDK query survives a client pause across the dev idle deadline (6819.425096ms) | Expected detecting control against starting implementation; corresponding fixed case passes. |
| baseline | [baseline-repro.log:2](./baseline-repro.log#L2) | Node SDK query survives a client pause across the dev idle deadline (5969.341212ms) | Expected detecting control against starting implementation; corresponding fixed case passes. |
| baseline | [baseline-reset-boundary.log:6](./baseline-reset-boundary.log#L6) | Node SDK query survives a client pause across the dev idle deadline (0) (6011.198781ms) | Expected detecting control against starting implementation; corresponding fixed case passes. |
| baseline | [baseline-reset-boundary.log:8](./baseline-reset-boundary.log#L8) | Node SDK query survives a client pause across the dev idle deadline (1) (5880.698825ms) | Expected detecting control against starting implementation; corresponding fixed case passes. |
| baseline | [baseline-reset-boundary.log:10](./baseline-reset-boundary.log#L10) | Node SDK query survives a client pause across the dev idle deadline (2) (5977.552315ms) | Expected detecting control against starting implementation; corresponding fixed case passes. |
| baseline | [baseline-reset-boundary.log:12](./baseline-reset-boundary.log#L12) | Node SDK query survives a client pause across the dev idle deadline (3) (5464.383182ms) | Expected detecting control against starting implementation; corresponding fixed case passes. |
| baseline | [baseline-reset-boundary.log:20](./baseline-reset-boundary.log#L20) | Node SDK query survives a client pause across the dev idle deadline (7) (5394.804834ms) | Expected detecting control against starting implementation; corresponding fixed case passes. |
| baseline | [baseline-reset-control.log:6](./baseline-reset-control.log#L6) | socket reset: reused=true, reset again=false (51.702654ms) | Expected detecting control against starting implementation; corresponding fixed case passes. |
| baseline | [baseline-reset-control.log:8](./baseline-reset-control.log#L8) | a reset retry preserves one real durable mutation and its write ID (573.102778ms) | Expected detecting control against starting implementation; corresponding fixed case passes. |
| environmental | [baseline-sdk-build.log:2](./baseline-sdk-build.log#L2) | src/web-wasm.ts(1,18): error TS2307: Cannot find module './wasm/snapback4_device.js' or its corresponding type declarations. | Generated missing wasm glue and rebuilt SDK; cold-tree prerequisite resolved. |
| environmental | [baseline-sdk-build.log:3](./baseline-sdk-build.log#L3) | src/web-worker-runtime.ts(2,27): error TS2307: Cannot find module './wasm/snapback4_device.js' or its corresponding type declarations. | Generated missing wasm glue and rebuilt SDK; cold-tree prerequisite resolved. |
| environmental | [baseline-sdk-build.log:4](./baseline-sdk-build.log#L4) | src/web.ts(24,27): error TS2307: Cannot find module './wasm/snapback4_device.js' or its corresponding type declarations. | Generated missing wasm glue and rebuilt SDK; cold-tree prerequisite resolved. |
| ours | [browser-headers.log:2](./browser-headers.log#L2) | Chromium SDK reads survive a blocked renderer across the server idle timeout (17008.052107ms) | Qualified the fixture query as media.keepalivePing; browser witness passes. |
| ours | [retry-initial.log:3](./retry-initial.log#L3) | socket reset: reused=true, reset again=false (29.842267ms) | Corrected request correlation; final retry suite passes. |
| ours | [retry-initial.log:4](./retry-initial.log#L4) | socket reset: reused=true, reset again=true (25.383593ms) | Corrected request correlation; final retry suite passes. |
| ours | [retry-initial.log:14](./retry-initial.log#L14) | a reset retry preserves one real durable mutation and its write ID (224.654221ms) | Corrected request correlation; final retry suite passes. |
| ours | [snapshot-before.log:1](./snapshot-before.log#L1) | a reused-socket retry retains the original URL, body, write ID and headers (52.374219ms) | Snapshotted URL, options and headers after the full run; final affected suite passes. |
