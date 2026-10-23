# Provenance

Product revision: `69ab3076b97bab9d0affc6022e7598cb81fd7545`, fetched
from `origin sb4-pg/main-mirror` and switched to `sb4-pg/s1-pg3`.
This includes RT3b and RT4. Product/app/harness source is unchanged by PG3.

Host aliases: 450b = `expose-builder-pixel-a`, 450a =
`expose-builder-nothing`. Shared PG17 remains at 450a:55440, postmaster
2735539. Only `sb4_snapback_s1pg3` / `s1pg3_app` and explicitly recorded
private/runtime directories belong to this lane.

All measured binaries are release builds in the requested worktree-owned
`snapback4/target`. PATH prepends `$HOME/.cargo/bin:$HOME/.local/bin`.
Builds retain `LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT`.

| Binary | SHA-256 |
|---|---|
| snapback4 | `e20851319adaba621ce1aac19d515b66cc2b1a71952cb7f1a188e963b6c166aa` |
| native seed helper | `b12311846e58379bebfa308c7403e0f1a90c76cb726d9879154d279da3b48639` |
| load/proxy harness | `7618879a6762d49092c34aa2de9ec1ef784f0d569ac1906459b4a35ed693bb45` |

The load binary matches S1-PG2 exactly. The app hash remains
`d81afc50e1ead9ba3c8fd245fc2fd84f2ed1b179e03d3382fccf18b2bef9c65f`.
[All input hashes](./source-hashes.json) include the current RFC snapshot,
original scripts, helper source and both helper lockfiles/manifests.

The helper's original `--locked` build refused solely because its lockfile
still named core 0.4.37. An ignored source/manifest/lockfile copy changes the
core path to this checkout's absolute path; `cargo build --release --offline`
updates only the local core package version to 0.4.38. Source bytes match
exactly. The repository lockfile is untouched. No failed binary was measured.
Product and load builds use `--release --locked`.

The ignored external controller calls the original PG2 methods. Its source
substitutions are database/role/path/observer labels and 20261023 date names;
module constants select the new release-binary paths. The requested order
and host/RTT stop checks sit outside the unchanged trial/search methods.
Six setup-controller launches are retained. Before provisioning, revisions
added executable/parent-runner recognition and a final read-only counter
observation; an overbroad test-text recognizer was corrected. The last
launch permits unmeasured setup during host contention while retaining the
per-cell quiet gate. Earlier launches ran no fixture, probe or load. Their
source/logs/exit records are retained; no measured cell was substituted.

Raw custody retains build commands/logs/PIDs, original and adapted source
snapshots, host waits, every interrupted attempt and later measurement
artifacts. Database URLs/passwords and native session tokens remain in private
environment/mode-600 files outside that evidence tree and are never emitted.
No push, stash, clone, Git configuration change or sub-agent was used.
