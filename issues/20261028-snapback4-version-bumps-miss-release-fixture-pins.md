# snapback4 version bumps miss the release fixture pins

Status: Open
Date: 2026-10-28
Scope: the snapback4 release bump commits; `packages/snapback4/test/{device-version,sync-generation}.test.mjs`
and `native-fixtures/following/Cargo.lock`.

The 0.4.46, 0.4.47 and 0.4.48 bump commits (`2ffe2911d7`, `541ff6a12d`, `618b59468b`) changed only
`Cargo.lock` and the four `package.json` files. The 0.4.45 bump (`f8df5d7b8e`) also advanced the fixture
pins. Two kinds of pin went stale:

- The bump tripwires `assert.equal(packageVersion, '<x.y.z>', 'release fixture pin follows the package bump')`
  in device-version and sync-generation. These are deliberate: both files carry version-shaped fixture
  bytes. 0.4.47 advanced them in a follow-up (`a66f4cb330`). 0.4.48 never did, so both files failed at
  module load on main until `21ad8f53d9`.
- `native-fixtures/following/Cargo.lock` stayed at snapback4-native 0.4.45. native_following builds the
  fixture in place, so cargo rewrote the tracked lock on every run. In a publication worktree that dirty
  source makes `publish.mjs` refuse the receipt and stage. `21ad8f53d9` advanced the lock to 0.4.48 and
  made the test restore the tracked lock bytes after its build, so this one cannot recur.

Publication red checks caught both long after the bumps landed: the lock from 0.4.46 on, and the 0.4.48 pins
at `1e9a50c8a7`. The bump commits never ran these files.

Expected: a bump changes everything that names the version in one commit. Either add a
`scripts/bump-version.mjs <x.y.z>` that rewrites the package manifests, the workspace version, both locks
and the tripwire pins, or have the affected-tests path run device-version and sync-generation whenever
`packages/snapback4/package.json` changes, so the bump commit itself goes red.

Immediate: the 0.4.49 bump (Integration 33) must advance both tripwires to 0.4.49.
