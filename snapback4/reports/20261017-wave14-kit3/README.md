# Wave 14 KIT3 verification

Branch `sb4-w14-kit3`, base `4ef9f77fb3`. No push or version bump.
The intended release is 0.4.31; these pre-integration packages still identify as
0.4.30, as requested.

## Packed consumer evidence

[consumer.json](./consumer.json) binds the successful `qualify-linux --consumer-only`
run to source **74ee49d4dff0733bf5b86cb9d75e2207d3a97ad2**, the prepared client/Expo
integrities and Linux platform binary. It is consumer evidence;
`publicationQualified:false` and `suite.status:not-run` are intentional. The full
qualifier invokes `scripts/test.sh`, which this workstream was told never to run;
the five requested crates and affected client files were tested separately.

The run passed the packed helper and literal HTTP-envelope checks, twelve
unaltered generated frontend proofs (six starters, twice each), sixteen further
starter/adaptation browser proofs including the custom Home writes, and Ubuntu
and Alpine toolchain qualification. Existing negative Home proofs must fail
without a business write; their expected assertion messages appear in the log.
The final consumer run exited **0**.

Client: **1276808 B**, integrity:
`sha512-mAy1cg+FV+arO47rb/VSH/0JuWfys7YgvRYfoO9kBzKFyhJjifVRWM7YzM6xGfBn3GwQgx//0n5BmUGlwU0ngw==`.
Linux binary SHA256:
`c0b76bef965d7964b794eaa14c665f8517fb9f9407bdb02979c52dad01f414f3`.
Inputs remain in `target/publication/kit3-release-client`; the platform tarball
and original consumer output remain in `target/kit3-linux-release`.

## Test outcomes

| Check | Result |
|---|---|
| Five-crate aggregate | Reached its one-hour guard during language revocation_soundness; exit 124. Completed targets recorded 5035 passed, 6 failed, 37 ignored. The six assertions belong to three older compiled targets, corrected and rerun below. No green aggregate exit is claimed. |
| Remaining language targets | All 54 targets from revocation_soundness onward passed: 581 passed, 1 ignored. |
| Complete simulator | 749 passed, 7 ignored; exit 0. |
| All-crate doc tests | 17 passed, zero failures. |
| Corrected affected Rust files | clock 43/43, init 50/50, init_dx3 7/7, readauth 88/88, guide 125/125; exit 0. |
| Clock-report / host units | 6/6 report tests; 2/2 host tests, including the isolated shutdown child and memory-only targeted retry. |
| Affected client files | 38/38 proof, proof-contract, wire-envelope and server-clock-wire tests. |
| Starter/typecheck cases | 9/9 on both Linux and Mac. |
| Older proof regressions | 28/28 on Linux; 27 passed on Mac with one explicit Linux /proc listener test skipped. |
| Mac affected Rust | clock 43/43, cli_friction 40/40, clock-report 6/6, host 2/2, init 50/50, init_dx3 7/7. |
| Mac affected client | 38/38 using the Playwright-pinned headless shell in the owned scratch directory. |
| Reference / documentation | ref-check and docs-budget passed; final rerun accompanies the closeout. Wasm 723097 B gzip, budget 723660 B. |
| Root inventories / guide | Run after root frozen install and ensure-workspace-hoist. Missing generated demo/Contract artifacts prevent the manifest check. Guide: 19 passed, 0 failed, 3 setup preconditions. |

The aggregate's failed targets were the old retained-search fixture (corrected
membership/retained search), the authoring census (new wire example and shifted
block), and guide tests (diagnostic definition, cursor-capable literal recipes,
filename mention, and the changed HTTP settlement contract). The affected files
all reran green. CLI/core/device complete coverage from the aggregate is retained;
language and simulator continuations plus doc tests complete all five crates.

The Mac runs stayed in `/Users/ccheever/sb4-ws-kit3` on
`macstudio-charlie-apt101-a`. Initial system-Chrome close timeouts are retained in
`mac-final4.log.gz`; the contract test had ignored `CHROME`. The committed harness
fix selects the configured pinned browser and the final 38-case run is green.
The black M5 was not used.

Root setup preconditions are outside the Snapback 4 fence:
`demos/competitive-checkpoint/snapback/generated/operations/startReply.args.schema.json`,
`demos/todo-v2/snapback/generated/contract/setCompleted.mutation.ts` and
`demos/todo-v2/snapback/generated/contract/runtime-links.ts`.

## Design reviews

The final amendments and semantic implementation at `c94694f263` received two
independent READY verdicts:
[Muse](../../../llp/reviews/3000.011.003.000.000-wave14-kit3-r8.muse.md),
[fresh Codex](../../../llp/reviews/3000.011.003.000.000-wave14-kit3-r8.codex.md).
The identical brief and every received earlier round are preserved beside them.
Later commits fix the Expo proof scope and qualification harness, align tests
with the public readiness contract, and record evidence; no semantic amendment
changed after the READY reviews.

## Reproduction

Commands run from `snapback4/`; every invocation was bounded. Cargo invocations
set `CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0`
in the same command. Representative complete commands:

```sh
timeout 3600 env CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 cargo test --no-fail-fast -p snapback4 -p snapback4-core -p snapback4-device -p snapback4-lang -p snapback4-sim -- --test-threads=4
timeout 3600 env CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 cargo test --no-fail-fast -p snapback4-sim -- --test-threads=4
timeout 1800 env CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 cargo test --doc -p snapback4 -p snapback4-core -p snapback4-device -p snapback4-lang -p snapback4-sim
timeout 1800 env CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 cargo test --no-fail-fast -p snapback4 --test init --test init_dx3 --test clock -p snapback4-device --test readauth -p snapback4-lang --test guide -- --test-threads=4
timeout 1800 env CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 node scripts/publish.mjs --prepare-client --prepare-directory target/publication/kit3-release-client
timeout 5400 env -u NPM_TOKEN -u NODE_AUTH_TOKEN CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 node scripts/qualify-linux.mjs --consumer-only --client target/publication/kit3-release-client/snapback4-0.4.30.tgz --expo target/publication/kit3-release-client/snapback4-expo-0.4.30.tgz --out target/kit3-linux-release
```

Compressed logs retain the original results, including failed attempts where
explicitly identified. No credentials were copied into these records.
