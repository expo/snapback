# Publication: snapback4 0.4.28 (2026-10-15)

Published `snapback4`, `snapback4-darwin-arm64`, `snapback4-linux-x64` and
`snapback4-expo` at **0.4.28** from `af4b256a31f5266577d5c014bd96b7827386c9db`
(Integration 12 + FIX28 + PUBFIX28 `1f963c6ccc` + PUBFIX28b fence `af4b256a31`).
All four `latest` = 0.4.28.

## Registry

| Package | Bytes | Registry integrity |
|---|---:|---|
| `snapback4` | 1,243,400 | `sha512-jYtgDRhJ5cY8NlzWiDP7R0nhAV6gzWIiqQhaKnPueI5OiP7/ZMH1xDMRQpbHJJ+0pwuOoaR6N6R7rtIRG17Mkw==` |
| `snapback4-darwin-arm64` | 10,384,953 | `sha512-RiIekl+ApZNpfyIAq1ZHOMkbMkLohaDws0nTlyExJ44iFCGIIVSqHMA4AfBjBsxKdcvefG48ZSCuEXVjmbh3EA==` |
| `snapback4-linux-x64` | 11,784,484 | `sha512-Zj9UCQh1d+4XX0GceI5KUAZYLAjhLjeMPHb6+ieYws3gdAV2lAhfWaNJS4EAl4dor5w/00uQfbH9gMx+ayEzZA==` |
| `snapback4-expo` | 6,281,284 | `sha512-7OqmBc3iBw0PdT8fqL5GZqMr9s7rfMJx9umKjXE8IVeVvE+pskK0uEpZVvqKhIwbSqgZUNFtLUmvhRT2KvBifg==` |

Registry metadata and downloaded tarballs equal the staged bytes
(`registry-cli-verified.json`, `registry-expo-verified.json`). The Expo bytes are
the ones the Ubuntu/Alpine/Darwin starter and frontend proofs exercised
(prepared on the M5 after the native build; `attempt-5-expo-proof-bytes.*`).

## Binaries

- Darwin production binary: 21,317,056 B, SHA-256
  `708116c3ddc1d66db8212a636ee3dee45fd86d5db16218744256b3578724714b`, Developer ID
  `UD2ZVW5WU5` via the launchd codesign relay; not notarized.
- Linux static musl binary: SHA-256
  `1b8d4a75feea9be7b2f03a83b139b9c3e23b139fd123c7ab4deb477a6fde78a3`.
- Expo native archives: ios-arm64
  `55bca50d1b6f83c6d9d1dd672e324a490f83c7bd407cf9fc56310d89577620f3`, simulator
  `73e341ce4c0100ad6ad7ea7d620f088925f21ab5342036aaae482ff6a4c50164`.

## Final qualification (af4b256a31)

Lean oracle required on both hosts (smoke 24/24, lean 41/41, no skips). Pinned
Playwright 1.55.1 headless shell (revision 1193) installed on both hosts as
setup for the new `proof.test.mjs` and generated `frontend:proof` runs.

- **Linux** (`linux/attempt-3-*`): `== 0 failure(s) in 2546 s` (qualify 3,457 s);
  cargo test 621 s; client 388/388 (7,445 passed, 56 skipped); models 81/81;
  Ubuntu 24.04 (292 s) and Alpine (414 s) consumer + starter proofs; 12 frontend
  and 6 starter proofs (`linux/frontend-proofs.json`, `linux/starter-proofs.json`).
- **Mac** (M5 Max, default `/var/folders` TMPDIR, `ulimit -n 65536`, serial client
  files, published-0.2.33 fences, `caffeinate -ims` inside `nohup`): native witness
  offline 9.8 s / restart 14.2 s (owned simulator, shut down); prepare 26 s; warm
  468 s. Dry run 5: `== 0 failure(s) in 8765 s` (step 9,101 s); cargo test 1,648 s
  with `snapback4::snapback4` 420/0 (includes the blocking release-control
  regression); client 388/388 (7,480 passed, 20 skipped) including
  `release-activation`, `schema-capabilities` (0.2.33 fences) and `proof`; models
  81/81. One `--resume` (755 s) published darwin-arm64, linux-x64, then the client;
  Expo published (75 s) and readable after 215 s.

## Attempt history

1. `c22dfefc9c` (`linux/superseded-c22dfe/`, `superseded-c22dfe-mac/`): Linux red —
   `release-activation` REL test 26 (rollback preview counted 0 dormant cells vs 20;
   fixed by PUBFIX28 `1f963c6ccc`); Playwright headless shell missing on Linux.
2. `daccc512f5` (`linux/superseded-daccc5/`, `superseded-daccc5-mac/`): Linux green;
   Mac dry run red — darwin-only 0.2.33 control fence: published 0.2.33 leaves an
   empty `serve.lock` after refusing, which NARR's `clear_address()` now exposes
   (ruled and fixed by the fence change `af4b256a31`, evidence in `pubfix28b/`);
   Playwright headless shell missing on the Mac.
3. `af4b256a31` dry run 3: the M5 entered clamshell sleep for ~10 h mid-run; its
   Rust stage had one failure, `verbs::witness::recovery::tests::recovery_drains_a_
   live_preparation_descendant_before_finishing_even_with_a_live_wrapper`, which
   passed alone three times (`isolated-3/`) and in the daccc5 and dry-run-5 full
   pools. Run stopped; dry run 4 refused a dirty tree (an interrupted test's temp
   directory, removed); dry run 5 passed.
