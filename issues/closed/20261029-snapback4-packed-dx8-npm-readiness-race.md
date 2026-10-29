# Packed DX8 operator proof races npm startup

Status: Closed
Date: 2026-10-29
Scope: Snapback 4 packed consumer fixture; no product implementation change.

TOK6's consumer-only Linux qualification on b827d8f287 failed in
scripts/dx8-operator-consumer.mjs: the 300 ms command timeout fired before npm
spawned hold.mjs, so npm-pids.json did not exist. This is inherited: origin/main
has the same 300 ms startup/timeout race. Original red transcript remains at
target/tok6/consumer via /tmp/tok6-consumer.log; it is not relabelled a pass.

Resolution: use the stable protocol already in packages/snapback4/test/proof.test.mjs.
Publish the two owned child PIDs atomically, establish both as live, then request
normal completion and verify descendant cleanup. Keep a separate timeout
control and a readiness-bound abrupt-caller-death control. Missing/malformed
receipts or live descendants fail explicitly. The installed-production operator
proof passed twice after repair against the unchanged client/platform bytes.
The complete qualify-linux --consumer-only chain is rerun separately.
