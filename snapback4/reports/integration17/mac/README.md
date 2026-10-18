# Integration 17 Mac verification

Assigned host: `ccheever@macstudio-charlie-apt101-a`; assigned scratch checkout:
`~/sb4-ws-integ17`. No publication host or publication tree was used.
Xcode 27.0 (27A266a), pinned Node 24.13.1, 36 logical CPUs.

Source preparation used `git archive 999598649f5323f14ff43fb577e54650352416e3`
for the fenced source (excluding retained reports), all LLP 3000 documents and
the two benchmark schemas compiled by the core. The resulting source tree was
committed locally in the assigned scratch directory. Overlay 1 imports all
changed paths through integration commit `c588ed5f0c`. Source bindings and
completed raw logs will be retained with the final results.

Every local shell invocation has an outer `timeout`; the remote host has no
`timeout`/`gtimeout`, so every remote subprocess additionally has a Python
`subprocess` timeout. Cargo subprocesses inherit `CARGO_INCREMENTAL=0`,
`CARGO_PROFILE_DEV_DEBUG=0`, `CARGO_PROFILE_TEST_DEBUG=0` in their environment.
Build concurrency is 8; native framework/build concurrency is 6; client pool
concurrency is 3. Native and clients are scheduled separately.

Reproducible orchestration scripts are `setup.py`, `tests.py`, and `native.py`.
Commands are recorded as structured `args`/`cwd` in each results JSON. The
client file/target selection is `scope.json`: 45 changed or platform-sensitive
client files, all touched Cargo integration targets, and crate unit tests.
The published 0.2.33 package helper verifies pinned npm integrity before running
the Darwin capability and F2 legacy-store fences. Optional older-publication
RX witnesses retain their explicit opt-in skips.

The initial setup attempt used Python 3.12 tar extraction's `filter` argument;
this host has an older Python, so it stopped before extraction. The corrected
setup removes that unsupported option on the trusted local Git archive.
