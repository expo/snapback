

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


## 2026-09-24 — 0.4.1 publication second attempt stopped during version preparation

Created `~/projects/snapback-pub-041b` at requested base
`0af449bb757b5a89f4df24a88f60cba681bf8b7d`, branch
`sb4-intent/publish-041`. The old branch was renamed to
`sb4-intent/publish-041-attempt-1`, retaining its commit and worktree.
Preserved its report directory byte-for-byte under
`reports/20260924-publication-0.4.1/attempt-1/`, its linked native evidence
beside that directory, and its journal entry unchanged above.

Frozen Bun install passed in 0.964 s. The next command attempted the exact
six-file version diff from `8e35a19f0e` with `git apply`; it failed in
0.014 s at `packages/snapback4/package.json:64`. The historical optional-
dependency hunk expected the old sole `openid-client` dependency, while the
fix lane added pinned Undici 8.8.0. This is the publication lane's patch-
application error, not a product-test failure. Verified that all six version
files remain unchanged. Stopped without retry under the explicit lane rule.

No build, native witness, suite, consumer proof, signing, packing or publication
ran, so there are no second-attempt witness timings, binary digest or integrities.
No test, keychain setting or credential changed. No version commit, report commit
or push was made. All attempted-command logs and the exact patch are retained in
`reports/20260924-publication-0.4.1/REPORT.md`; report and journal remain uncommitted.


## 2026-09-24 — 0.4.1 publication second attempt resumed, then stopped on session models

The author authorized editing the six version-bearing files after the historical
patch failed. In `~/projects/snapback-pub-041b`, version commit
`e1d7a6fb56828344c206dae229f4f8ec69126170` changes exactly 15 version fields
on base `0af449bb757b5a89f4df24a88f60cba681bf8b7d`; Undici stays pinned at
8.8.0. Frozen install passed in 0.224 s without additional lockfile changes.
The earlier preparation-stop report and journal are preserved unchanged, as are
all first-attempt evidence and its journal entry.

Both xcframework slices rebuilt in 146.463 s; Release chat-expo built in
96.364 s with zero errors and three warnings. The linked simulator archive and
installed executable/JS bundle match their build outputs. Dedicated iOS 26.5
simulator `81961F7D-DF85-4A7A-B376-20D9073AC101`, port 44441: offline
`--prime` passed in 8.925 s; restart `--prime --relaunch` in 12.164 s.
The public witness ran through this worktree's fresh debug CLI, as in 0.4.0.
Every manifest artifact hash and size verified; simulator shut down.
Native archive SHA-256: iOS arm64
`f1b1ae8cfe7729feaae315ced8050eed3900e1906202bd5851b483abc0579c07`;
simulator `aa44801e4fbb3520f8c1031d5cebaae8c793acf52f6b9333ab570928e1c20b4c`.
Witness CLI pre-suite SHA-256:
`c9ba678b89fa86c823b6465b53ee622c2b6deb699286370ca633867925eb445b`.
Native source/app/framework hashes and artifacts are under
`reports/20260924-expo-0.4.1/qualified.json`.

The only resumed `publish.mjs --dry-run` exited 1 after 1,515.094 s:
`== 1 failure(s) in 1515 s`, client tests. Clients: 1,591 tests,
1,584 passed, 1 failed, 1 cancelled, 5 unchanged inherited skips.
Both non-passing cases are at `app-session-model.test.mjs:5:41`:
- Online 5,000-sequence model: `test timed out after 240000ms`, observed
  240,009.072 ms; recorded as a cancellation.
- Local 5,000-sequence model: `tier=local seed=11: model fair recovery did not
  finish within 100 clock steps`, 12,350.402 ms; ERR_ASSERTION at line 12:14.
  The full reported minimal sequence is retained in the failure evidence.

All four requested published-0.2.33 fences/control passed. Rust: 2,976 passed,
0 failed, 16 unchanged ignores, 1,059 s; fixture wrapper 9/9. Builds,
typechecks, documentation budget and release guard passed. WASM 1,767,852 B raw /
492,086 B gzip under the pinned checkout's unchanged 493,000 B budget;
README 300/300. Node 24.18.0, Bun 1.4.2, Rust 1.97.0, Xcode 27.0.
Existing suite scheduling controls selected four Rust processes and serial
client files. Cold Rust test compilation overlapped the client run; no cause,
baseline waiver or environmental exemption is asserted. No rerun, retry,
assertion/timeout change or reduced sequence count followed the failures.

Stopped the release sequence and let the already-running report-all-failures
suite finish. The unchanged publisher refused before production CLI build,
signing, packing, stage or installed-consumer proof. No --resume, Expo pack or
publication, registry verification or push occurred. There are no staged/registry
integrities or production CLI digest to claim. No keychain setting or credential
changed. Version commit remains local; report, metrics and this journal update
are retained uncommitted. Exact errors, all command timings and preserved earlier
attempts: `reports/20260924-publication-0.4.1/REPORT.md`.
