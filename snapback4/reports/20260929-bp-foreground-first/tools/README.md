# BP live reproduction

Run from the repository root with Node 24, Python 3, and the local SDK built.
The private replay template is SQ/PF's `replay/`: `scripts/api-client.mjs`,
`scripts/verify-scale.mjs`, the builder's schema and generated API. Its stores
and private state are not copied. Fixtures come from this repository's frozen
`benchmarks/fixtures/social-messenger/`. No source fixture is edited.

Linux diagnostic reproduction:

```sh
python3 snapback4/reports/20260929-bp-foreground-first/tools/diagnostic.py
LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT CARGO_BUILD_JOBS=8 \
  cargo build --manifest-path snapback4/Cargo.toml --profile production --bin snapback4
cp snapback4/target/production/snapback4 /private/path/snapback4-bp-diagnostic
python3 snapback4/reports/20260929-bp-foreground-first/tools/diagnostic.py --remove
python3 snapback4/reports/20260929-bp-foreground-first/tools/prepare.py \
  /private/path/replay /private/path/new-run
python3 snapback4/reports/20260929-bp-foreground-first/tools/live.py \
  /private/path/snapback4-bp-diagnostic /private/path/new-run --cpus 0-9
python3 snapback4/reports/20260929-bp-foreground-first/tools/summarize.py /private/path/new-run
python3 snapback4/reports/20260929-bp-foreground-first/tools/attribute.py /private/path/new-run
```

`diagnostic.py` extends SQ's reversible, measurement-only hooks. It does not
change admission, time slices, priority, durability or charges. Its per-request
records include Linux TID, consumed thread CPU, wall time and query schedstat
deltas. Background records are cumulative per-kind counts/CPU/wall on the
maintenance TID, emitted about once a second. Their wall includes admission
deferral. This is not commit-to-delivery latency. Empty work attempts count.
The hooks add clock reads, query schedstat reads and numeric log writes; these
timings are instrumented measurements, not an uninstrumented speedup claim.

`monitor.py` samples each live server/replay thread every 250 ms and the host
and work queues about once a second. Observers retain host-wide affinity.
Short-lived request threads evade sampled `/proc` census; complete
`BP_REQUEST` records supply their lifetime CPU. `hostRunnableOnSet` counts
sampled R-state tasks last assigned to CPUs 0–9, including executing tasks;
it is not an atomic kernel runqueue-length trace. `/proc/stat`, CPU pressure
and load are also retained. Kernel scheduler-delay accounting was disabled
in the recorded run; zero schedstat wait must not be interpreted as no wait.
The first recorded run also used SQ's process monitor, launched after replay
began, to retain aggregate CPU including exited request threads. The final
monitor incorporates those process counters into the same samples.

`prepare.py` executes SQ's exact replay adapter transformation, substituting
only output path, binary and port (default 49671, overridable as `BP_PORT`).
Immediate reads use existing replay clients before verification or warmup;
warmed reads use SQ's separate process, three warmups and nine batches of ten.
All descendants of the confined replay inherit its affinity, including warm
probes and verifier processes. Checkpoints remain in replay order. Snapshots
are consistent SQLite backups after the original verifier, as in SQ.

`live.py` waits for three consecutive empty queue samples after the complete
replay. This final drain includes no new synthetic work. The earlier full-probe
timestamp and continuous queue samples capture drain progress during final
verification and snapshot too. Pending and parked work are distinguished.

Mac handoff (builds nothing):

```sh
snapback4/reports/20260929-bp-foreground-first/tools/macos-live-curve.sh \
  /private/path/before /private/path/after /private/path/replay /private/path/new-comparison
```

Both binaries get a fresh store and all 167,157 actions. Each prints the same
immediate/warmed table, frozen margins and nine-batch pass counts. Private
output directories must be new. `BP_CPUS=0-9` selects Linux affinity when
running that same script on Linux; leave it unset on macOS. The Mac script
records binary digests and per-batch host load, but does not claim Linux
thread diagnostics are available on Mac. It requires native binaries and the
repository's already-built SDK; it compiles and installs nothing.

`summarize.py` delegates the unchanged percentile/midpoint/ratio rules to SQ.
Every raw batch remains; failures are never replaced. SQ's live protocol does
not include deep-page probes. The original verifier independently retains its
deep-page, write-ratio and data checks. These are identified separately.

Only the explicit evidence allowlist is committed. Never commit the whole
output tree: it contains bearer credentials, stores and private replay state.
