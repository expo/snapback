# Inputs and custody

Worktree: `/home/ccheever/projects/sb4-s1sk` on expo-build-450b
(`expose-builder-pixel-a`). Result branch: `sb4-pg/s1-pg4`, created from
`e76a77549ee63c2b9ddff01aaad99bcac1665f71` as instructed.

| Measured input | Revision / SHA-256 |
|---|---|
| pre-RT product source | `45416b150c8900594ed1e65ed557d7178b2dcb07` |
| B1(+RT3c) product source | `e76a77549ee63c2b9ddff01aaad99bcac1665f71` |
| `target-pre/release/snapback4` | `8d4146ba9c3de355e7215c429a20513f4fdab1dd406ce250dc6d95f1703f70a3` |
| `target-b1/release/snapback4` | `e3940d13f2ec0caff39e3f58bba131aab966109c26594b9837cd8381e0580d33` |
| Existing S1-PG2 Rust harness | `7618879a6762d49092c34aa2de9ec1ef784f0d569ac1906459b4a35ed693bb45` |
| Unchanged app schema | `d81afc50e1ead9ba3c8fd245fc2fd84f2ed1b179e03d3382fccf18b2bef9c65f` |

Build commands are `cargo build --release --locked -p snapback4 --features
postgres --target-dir <worktree>/target-pre` at the baseline and the same
command with `target-b1` at the tip, run from `snapback4/`. Both use
`LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT` and six build jobs;
`~/.cargo/bin` and `~/.local/bin` precede the ambient PATH. Source remained
unchanged during each build. The worktree returned to the result branch after
the baseline build. [Build provenance](./build-provenance.json) and
[input provenance](./input-provenance.json) include helper and controller hashes.

The native seed helper is the exact `postgres-seed/src/main.rs` snapshot from
the pinned tip, compiled once against each product core. It is an isolated
experiment crate; only its Cargo path is absolute inside the raw setup directory.
The baseline predates the helper's directory, which is why the source snapshot
is needed. For B1, an initial locked helper build refused the local package
version mismatch. Offline resolution changes only `snapback4-core` 0.4.37 to
0.4.38 in that isolated lockfile; no dependency version changes. Both lockfiles
and build logs are retained. The measured product builds remain locked and
their binaries unchanged. No helper or product source is committed by this lane.
Each seed imports the full deterministic fixture and creates the same 256 native
`account` sessions as PG2. The service drain seat is also created through the
native owned engine, outside measurement.

The controller imports frozen copies of PG2's Python modules. Its subclass
changes local provisioning, paths/identifiers, affinities, link selection and
the requested environment gates. `Run.cell`, `Snapback.trial`, the search,
native barriers, scheduler, repetitions, latency/error criteria and counter
qualification execute from the inherited modules. Clean probe shapes and
statistics filtering are inherited. `onehost-at-launch.py` is the running
controller snapshot; a later cleanup-only edit to `onehost.py` is retained
separately and does not change the already-running process. Final credential
cleanup is independently checked after exit.

Three setup interruptions are retained before timed load:

- The first build controller completed the baseline product, then could not
  enter the seed-helper directory absent from that revision. Its unchanged
  helper was subsequently compiled from the pinned snapshot; both product
  release builds completed.
- `setup-attempt-1` saw the PG socket before startup completed. The first SQL
  command refused with “database system is starting up”. The private cluster
  stopped and its data directory was removed; no deploy or timed trial ran.
- `setup-attempt-2` used a stale computed harness path after relocating the
  imported module. The proxy commands exited and the source-hash lookup failed.
  The private cluster stopped and its data directory was removed; no timed
  trial ran. The corrected controller explicitly binds the original harness
  path and checks proxy liveness.

These are setup/controller failures. They neither count as product overload
nor qualify a replacement trial. Their logs, exit evidence and PID ledgers are
kept alongside the campaign in the raw archive. No password is used by this
local socket cluster; session-bearing files remain private and outside Git.

After all six priority baseline cells completed, the first B1 open/query
succeeded on the existing account session and preserved the complete application
row digest and stored backend record. B1 installed its ordinary dormant-evolution
metadata: 21 columns across six new tables, with seven indexes. No existing
column was removed or modified. The controller's exact full-schema comparison
was too strict and raised before B1 timed load. It then stopped and removed its
private cluster as designed; the baseline's independently audited cells remain.
The baseline shutdown witness totals 37,191 counter increments with zero
unassigned increments. Its cleanup audit finds 1,204 recorded PIDs absent and
zero known-session leaks; credential files were removed.

The recovery creates a second private PG16 cluster, checks that its settings
text is byte-identical to the first, and seeds B1 natively using its own core.
No baseline cell is rerun or silently replaced. `b1-campaign-at-launch.py`
preserves that controller, which still calls the same inherited search/trial
methods. The original reuse evidence remains `store-compatibility.json` with
`exact: false`; it is not rewritten into a passing physical-equality claim.
Separate counter domains prevent the two clusters' totals from being conflated.

The reference S1-PG3 report was read from `sb4-pg/s1-pg3` without integrating
its branch. No connection to 450a or action on its unrelated workload is needed.
No push, stash, Git configuration change or product modification is performed.
