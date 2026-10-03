# Round-4 commands and custody

Run from `snapback4/`, Node 24.13.1, pinned dependencies, `ulimit -n 4096`.
`qualify.sh` records the affected checks and packaged production build with
`LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT`. After timing confirms the final pacing design, run the full suite
**once**, on that unchanged source:

```
LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT bash scripts/test.sh > reports/20261001-ct-contended-reads/round4/qualification/test-sh.log 2>&1
```

Record the exit beside the log. `scripts/test.sh` builds and measures wasm;
there is no ratchet edit. `doctor-diagnostics.mjs target/ct-round4/paced` probes
the actual doctor output with controlled nice-only setter failures and both
startup-readback states. The real syscall and watchdog propagation have Rust
regressions. Deliberate failure controls must exit 1; the harness exits 0.

After all affected tests/builds finish, run `bash reports/20261001-ct-contended-reads/round4/inputs/measure.sh`.
The 144-process combined cell runs first to test the corrected pacing tail;
the other combined cells run separately, with unchanged fixtures and assertions.
The complete suite follows timing. No synthetic load overlaps this lane's tests. Other host tenants are
observed, never stopped. The mixed fixture, probe client, endpoints, cohort
sizes, query arguments, successful-sample rules and backlog observer are
unchanged from round 3. Each small mixed cell lasts 125 seconds; the combined
Following fixture keeps busy workers alive through its drain tail.

`target/ct-round4/paced` is this source. `target/ct-round3/{split,ordinary,demoted}`
are round 3's retained exact executables; SHA-256 values must match that round's
custody. Split is commit 3ed1e1c2c4. The controls preserve round-2 fixes; ordinary
and demoted differ only by the retained demotion patch. See round3/inputs for
rebuild commands. No production scheduler switch is introduced.

Every real-backlog trial copies the identical stopped `target/ct-round3/pristine`
checkpoint, including committed WAL: 88,143 replayed actions and 6,507 pending
delivery tasks. Never start the pristine copy. Two repetitions reverse design
order at 0 and 96 busy processes; ordinary/demoted controls are included.
Every raw sample and answer digest is retained. During-drain ranks exclude the
first three calls of each 23-call cohort and responses ending after the last
positive backlog observation. Settled endpoint hashes and initial DB/WAL
manifests must agree across all trials and with round 3. Pooling weights samples,
so longer drains contribute more cohorts and more intermediate feed states.

`archive.py` retains generated projects/stores under ignored `target/ct-round4/`,
then losslessly compresses raw observations. Credentials and generated stores
are not report artifacts. `summarize.py` regenerates the Markdown tables and
checks final hashes/manifests, accepting plain or gzip raw records.

The earlier wall-time pacing candidate is archived in `wall-paced-candidate/`,
including its own complete-suite invocation, completed measurements and aborted
144-process drain. It is excluded from the final timing tables. Its replacement
charges consumed thread CPU and removes the minimum pause. The final source
receives one full-suite invocation; there were two total across the two sources.

The inherited round-3 archived-main checkout linked its Cargo target into this
lane. Cargo subsequently reused its web output, as proved by the preserved
`.d` and matching artifact hashes. The archived candidate's `post-suite.sh` ran after its suite, cleaned only the two
wasm-profile packages, rebuilt this lane's wasm and client, and repeated client
files/models against the corrected artifact. That repair preceded final-source
qualification; it is not a repeated full suite or an unreported source change.
Future control rebuilds must use their own Cargo target directory; copy only
finished executables into the comparison directory. The measured server binary
has its own lane-source dependency record and the four measured binary hashes
are fixed before any timing run.

Additional affected commands (same SQLite flag/descriptor limit):

```
cargo test -p snapback4-lang --test row_keyed_views --test timeline_background --test schedule_durations
cargo test -p snapback4 --bin snapback4 maintenance
cargo test -p snapback4-lang --test guide
cargo test -p snapback4-sim --test native -- --ignored
```

The root reference check is `./ref-check --verbose`, run from the repository
root. No Snapback 1/2 inventory, Ibex bootstrap, publication or fleet mutation
is part of this fence. The operator owns the Apartment mini timing rerun.
