# Snapback 4 0.4.2 publication — attempt 3 passed

All three packages are published. Registry metadata, and the tarballs
downloaded back from the registry, match the exact qualified local bytes.
Attempt 3's first dry run stopped on one timing-sensitive client test while
other sessions loaded the host. A retried dry run passed, then the resume.
The supervisor ran every step by hand, because the lane's codex session could
not authenticate. Evidence from attempts 1 and 2 is preserved.

Qualified source: `b22d59d65e59d20a57d2d3ff1632bac00dadfb4d` on
`sb4-intent/publish-042`, merging main `7706ab656` (the published-0.2.33 fence
fix). Published on September 25, 2026, Pacific time (September 26 UTC).

## Registry bytes

| Package | Tarball bytes | Integrity |
|---|---:|---|
| `snapback4-darwin-arm64@0.4.2` | 5,895,636 | `sha512-8xdEcltsy84cZa9qO5LK0aAVeYXS6hqFzQ+X7ZSeGhYda4a0ngHy9icG893JA/qR/wtLqOtvLEpqZuJ5Fg7MYg==` |
| `snapback4@0.4.2` | 753,909 | `sha512-C0yc76nbskRoBuzva3sZc7dENfA7d3uXtHTwgHg13vTeOanxx5+vQ67Z0+4MCOAopvAbbFuPZQy3uNFDecmgYg==` |
| `snapback4-expo@0.4.2` | 5,016,004 | `sha512-JCn0b5xe2u6nfk7G9qy9szMSFFs6ifO45oGJDJO6OaGoW+ylUr8ugJULsbb9ik0MHuEj1O3LwC1dAQWFXVwhiw==` |

Evidence:

- [CLI and platform registry evidence](./registry-cli-verified.json)
- [Expo registry evidence](./registry-expo-verified.json)
- [Expo pack and file proof](./expo-staged.json)

The verification downloaded each tarball from the registry, checked its
SHA-512, and compared every byte with the staged file. All 18 Expo package
files match the natively qualified package, including both rebuilt framework
slices.

## Qualification and publication

- **Full suite: 0 failures in 2,163 s.**
  - Rust: 3,214 passed, 0 failed, 19 ignored, across 919 result summaries.
  - Node tests, clients and models together: 2,069 tests, 2,064 passed, 0
    failed, 0 cancelled, and 5 skips inherited unchanged.
  - The client stage ran its files serially, as the suite chooses at host load
    25.
- **All published-0.2.33 capability fences passed**, with
  `SNAPBACK4_FENCE_PUBLISHED=/Users/ccheever/sb4-03-lanes/published-0.2.33`.
  These are the fences that stopped attempt 1. The fix in `7706ab656` keeps a
  false `speculative` off the wire.
- **`publish.mjs --dry-run` passed** in 2,311.704 s: the suite, the production
  build, signing, packing and the installed-consumer proof.
- **`--resume` passed** in 204.330 s. It revalidated the durable stage and
  repeated the installed-consumer proof, then published the platform package
  and then the client. Both proofs reported `consumer ok: query complete+fresh,
  online write sent, offline write pending`.
- **Production binary:** 11,960,272 bytes, SHA-256
  **`4bea81bfc08ec6be0051acc26ba40dbf231bb8d81fe29673bc4d1e58030cc7e8`**,
  version `snapback4 0.4.2`.
- **Signing:** signed by the same unchanged launchd relay as 0.4.0 and 0.4.1,
  and not notarized, matching that path. No keychain setting or credential
  changed. The publisher's environment matched 0.4.1's attempt 3, with no
  scheduler or binary override.
- **Expo:** packed once and verified against every file of the natively
  qualified package. The exact tarball was published once. The registry made
  it readable after 203 s.

## Native Release witness

Attempt 3 rebuilt, in 0.4.1's order:

- the framework (8.874 s);
- the CLI (4.569 s);
- wasm (15.806 s);
- the client package (1.057 s);
- the Release chat-expo app (16.749 s). Metro rebundled after an empty cache,
  and `main.jsbundle` postdates the rebuilt client.

The linked simulator archive matches the framework, and the installed
executable and bundle match the Release build.

The witness ran on the dedicated iPhone 17 Pro simulator (iOS 26.5,
`81961F7D-DF85-4A7A-B376-20D9073AC101`), port 44441:

| Segment | Options | Seconds | Result |
|---|---|---:|---|
| offline | `--prime` | 8.677 | passed |
| restart | `--prime --relaunch` | 12.186 | passed |

Both segments used the public CLI witness verb through this worktree's fresh
debug CLI. Every manifest artifact's size and SHA-256 checked out.

| Artifact | SHA-256 |
|---|---|
| iOS arm64 archive | `811bbc14dfd4caa1357e17894dbebb657baeeb8229a982c68df94c2da06da66a` |
| iOS simulator archive | `e26a0fe7e6fd1fc16ef071ef36f1f042af76839270cf929ade2d127661703aac` |
| Installed Release executable | `f7f7b908b004d20c1ab23c6bea1bc978c3967912767ee7bad906af49899cf29b` |
| Release JS bundle | `b051bc9103d634a3e607ad1d27537676679586ef166ff5ef4bc185a9ff2e8c40` |
| Witness CLI, before the suite rebuilt it | `bd1452cbe6d5394c32810a00261505cc04de3e145fa2d28059dbf0c6fc4bcc88` |

Source trees:

- core `ed1d60397c2a34e8dc31041784334f683f60753f`;
- device `de78af098e10f4e6af5b4a16f6c47269014625a5`.

The native qualification, framework and file hashes, and the witnesses are in
[`qualified.json`](../20260925-expo-0.4.2/qualified.json).

## Every earlier stop

1. **Attempt 1 stopped at its full-suite gate.** Three published-0.2.33
   capability fences failed: a current binary wrote `speculative: false`,
   which the published 0.2.33 client does not accept. The fence fix in
   `3c472374f` was merged to main as `7706ab656`, then into this branch. See
   the [attempt 1 report](./attempt-1/REPORT.md).
2. **Attempt 2 stopped before qualification.** Its witness ran a CLI built at
   14:27 and a client built at 14:19, both before the fence fix, because
   attempt 2 had skipped the CLI, wasm and client-package builds. Nothing was
   published. See the [stop note](./attempt-2/STOP.md), with its records,
   artifacts and the two witness metric lines it removed.
3. **Attempt 3's first dry run failed one client test** in 1,049.518 s:
   `W8R1a native server-run observations retain nothing during a replacing
   fetch`. The test's last 10 s wait timed out while other sessions' cargo and
   Xcode builds held the host's load average at 78–126 on 18 CPUs. The online
   and web tiers passed. Ten isolated runs at load 18–19 passed, in 0.26–1.07 s
   ([log](./attempt-3-w8r1a-isolation.log)). The retried dry run passed with
   no change. `issues/20260926-snapback4-w8r1a-native-load.md` asks whether a
   timer that load delays gates the native tier.

## Environment

- Hardware and toolchain: Apple M5 Max; macOS 26.6.2; Xcode 27.0 (27A266a);
  Node 24.18.0; Bun 1.4.2; Rust 1.97.0.
- npm identity: `ccheever`.
- All six version-bearing files are at 0.4.2.
- No implementation or test changed after source `b22d59d65`. This delivery
  adds only reports, native artifacts, two witness metric lines and a journal
  entry.

## Every timed attempt-3 command

| Command | Seconds | Exit |
|---|---:|---:|
| bun-install | 0.173 | 0 |
| xcframework-build | 8.874 | 0 |
| native-prepare | 0.305 | 0 |
| cargo-build | 4.569 | 0 |
| wasm-build | 15.806 | 0 |
| client-package-build | 1.057 | 0 |
| npm-identity | 0.759 | 0 |
| simulator-boot | 0.405 | 0 |
| simulator-ready | 3.118 | 0 |
| chat-backend-check | 1.684 | 0 |
| expo-release-build | 16.749 | 0 |
| root-hook-dependencies | 4.714 | 0 |
| simulator-install | 4.045 | 0 |
| native-link-verification | 0.255 | 0 |
| native-witness | 23.145 | 0 |
| native-qualification-verification | 0.082 | 0 |
| simulator-shutdown | 3.174 | 0 |
| publication-dry-run | 1049.518 | 1 |
| publication-dry-run-2 | 2311.704 | 0 |
| publication-resume | 204.330 | 0 |
| registry-cli | 3.612 | 0 |
| expo-pack | 0.779 | 0 |
| expo-pack-verification | 0.076 | 0 |
| expo-publish | 5.694 | 0 |
| expo-registry-wait | 203.339 | 0 |
| registry-expo | 0.998 | 0 |

Each `attempt-3-<command>.json` records the command, its working directory
and its start and finish times; each has a matching `.log`. The helpers are in
`attempt-3-helpers/`.
