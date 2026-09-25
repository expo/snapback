## 2026-09-24 — 0.4.1 publication stopped on five client failures

Publication lane on the black M5 Max, requested base
`6540600116efa5ff3993a60082de2edb2f32663f`, worktree
`~/projects/snapback-pub-041`, branch `sb4-intent/publish-041`.
Version commit `8e35a19f0e370cc3dd063da288d5750820b18c40` aligns the CLI,
platform and Expo packages, optional dependency, Cargo workspace and both
lockfiles at 0.4.1. Both frozen installs passed.

Both iOS slices rebuilt in 91.668 s; Release chat-expo built in 92.698 s.
The linked simulator archive and installed app/JS bundle match their builds.
Dedicated simulator `9A88E5C4-9F5B-4FE5-B8D0-F2199FE6E63B`, iOS 26.5,
port 44441: offline `--prime` passed in 8.578 s and restart
`--prime --relaunch` passed in 12.117 s through this worktree's built public
CLI witness verb. Artifact sizes and hashes verified; simulator shut down.
Native archive SHA-256: iOS arm64
`b62074ec881a6546f34ae14782d3f8741244d32f3205053198d09bb9ea13d5be`;
simulator `b607a5b5834dce605e750beac22bd445ee033dcd2446b188f7f5f1c1f3e7557a`.
The witness CLI's pre-suite SHA-256 was
`d214293cb01822e9b3db3761dd922d918b9dd370ba90391ee576e4d55783db7d`.
All framework/source/app hashes and native artifacts are under
`reports/20260924-expo-0.4.1/qualified.json`.

The only `node scripts/publish.mjs --dry-run` attempt exited 1 in
1,360.462 s: `== 1 failure(s) in 1360 s`, client tests. Node 24.18.0,
Bun 1.4.2, Rust 1.97.0 and Xcode 27.0; published-0.2.33 fences enabled,
unchanged packaged SQLite flags and launchd signing relay selected.
Clients: 1,512 tests, 1,502 passed, 5 failed, 0 cancelled, 5 existing skips.
Rust: 2,964 passed, 0 failed, 16 ignored, 679 s; fixture wrapper 9/0.
Builds/typechecks/docs/release guard passed. WASM 1,766,024 B raw /
491,468 B gzip under the inherited 492,000 B budget; README 300/300.

Exact blockers:
- `app-local-receipts.test.mjs:15:3`, native known-sent receipt with close=true:
  `Error: setTypeOfService EINVAL`, at Node's Socket.setTypeOfService through
  Undici. No isolated rerun or baseline/environmental attribution.
- All three capability fences at `schema-capabilities.test.mjs:206:10`
  (timeline-v2, recorded-attribution, maintained-column) fail old-store
  preservation: an empty `_cap_counts` table and `_meta.cap_counts_schema`
  marker are added. Captured comparisons show no changes to existing rows.
- The capability-free canonical control at line 330 is 2,942 bytes versus
  the pinned 2,950; the displayed diff removes four `[]` pairs.

Stopped under the explicit lane rule. The already-running report-all-failures
suite finished; no retries, fixes, weakened tests, changed pins or new skips.
No production build/signing, stage, installed-consumer proof, `--resume`,
Expo pack/publication or branch push followed. No package was published;
there are no staged/registry integrities or production-binary digest to claim.
No keychain or credential setting changed. Every timed command and the
complete failure output are in `reports/20260924-publication-0.4.1/REPORT.md`,
including corrected read-only preparation probes. Version commit retained
locally; failure report/journal/evidence left uncommitted for the supervisor.
