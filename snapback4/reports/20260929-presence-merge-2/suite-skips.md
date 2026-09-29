# Inherited suite skips and ignores

No skip or ignore was added by this merge. The required command keeps the
suite's existing optional external-fixture checks and ignored Rust cases.

## Client: 9 skipped

```text
﹣ managed organization and invitation policy runs in the shared interpreter (0.034625ms) # set SNAPBACK4_B1D_MANAGED_BIN, SNAPBACK4_B1D_MANAGED_BIN_SHA256, SNAPBACK4_B1D_MANAGED_SCRATCH_PARENT to the pinned parent binary and a private scratch parent
﹣ managed OIDC profile binding orders and expires trusted email evidence (0.240042ms) # set SNAPBACK4_IDENTITY_PROFILE_SCRATCH_PARENT to an existing private directory
﹣ published 0.2.27 reference: four tasks with one and two search cursors (0.068666ms) # set BOUNDS_BINARY to the published 0.2.27 binary
﹣ published 0.2.33 rejects F2 stores, serving, backend opening and device adoption (0.284541ms) # set SNAPBACK4_F2_LEGACY_BIN to the published 0.2.33 platform binary
﹣ published 0.2.33 capability fence: timeline-v2 (0.291042ms) # set SNAPBACK4_FENCE_PUBLISHED to an npm tarball cache directory
﹣ published 0.2.33 capability fence: recorded-attribution (0.04475ms) # set SNAPBACK4_FENCE_PUBLISHED to an npm tarball cache directory
﹣ published 0.2.33 capability fence: maintained-column (0.0345ms) # set SNAPBACK4_FENCE_PUBLISHED to an npm tarball cache directory
﹣ published 0.2.33 control: capability-free bytes and stores stay compatible (0.398917ms) # set SNAPBACK4_FENCE_PUBLISHED to an npm tarball cache directory
﹣ new client syncs against the actual 0.2.32 server's deny_unknown_fields request contract (0.030208ms) # set SNAPBACK4_LEGACY_BIN to the published 0.2.32 binary
```

## Rust: 33 ignored

```text
-- rust target: snapback4-core::adoption_scale (0.0 s): test result: ok. 0 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out; finished in 0.00s
-- rust target: snapback4-core::snapback4_core (7.7 s): test result: ok. 167 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out; finished in 7.67s
-- rust target: snapback4-device::device::presence::w15a_necessary_absence_server_fits_prediction_reservation_on_both_stores (0.0 s): test result: ok. 0 passed; 0 failed; 1 ignored; 0 measured; 436 filtered out; finished in 0.00s
-- rust target: snapback4-device::diet_timing (2.2 s): test result: ok. 0 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out; finished in 0.00s
-- rust target: snapback4-device::expiring_counts (9.8 s): test result: ok. 9 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out; finished in 6.25s
-- rust target: snapback4-device::own_keys_cost (26.1 s): test result: ok. 0 passed; 0 failed; 2 ignored; 0 measured; 0 filtered out; finished in 0.00s
-- rust target: snapback4-lang::aggregate_copies (51.2 s): test result: ok. 64 passed; 0 failed; 4 ignored; 0 measured; 0 filtered out; finished in 0.25s
-- rust target: snapback4-lang::audience_bounds_runtime (45.9 s): test result: ok. 2 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out; finished in 2.32s
-- rust target: snapback4-lang::delivery_replay_conversion (13.3 s): test result: ok. 2 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out; finished in 0.05s
-- rust target: snapback4-lang::expiring_mutations (15.3 s): test result: ok. 19 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out; finished in 0.54s
-- rust target: snapback4-lang::following_adoption_research (16.7 s): test result: ok. 4 passed; 0 failed; 2 ignored; 0 measured; 0 filtered out; finished in 0.76s
-- rust target: snapback4-lang::following_atomic_launch (17.9 s): test result: ok. 9 passed; 0 failed; 2 ignored; 0 measured; 0 filtered out; finished in 1.70s
-- rust target: snapback4-sim::clique::following::following_candidates_at_scale (0.0 s): test result: ok. 0 passed; 0 failed; 1 ignored; 0 measured; 253 filtered out; finished in 0.00s
-- rust target: snapback4-sim::exhaustive (21.4 s): test result: ok. 1 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out; finished in 3.70s
-- rust target: snapback4-sim::maintain_measurement (35.8 s): test result: ok. 0 passed; 0 failed; 2 ignored; 0 measured; 0 filtered out; finished in 0.00s
-- rust target: snapback4-sim::native (28.5 s): test result: ok. 11 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out; finished in 1.27s
-- rust target: snapback4::maintenance_latency (17.7 s): test result: ok. 0 passed; 0 failed; 4 ignored; 0 measured; 0 filtered out; finished in 0.00s
-- rust target: snapback4::read_latency (15.6 s): test result: ok. 0 passed; 0 failed; 2 ignored; 0 measured; 0 filtered out; finished in 0.00s
-- rust target: snapback4::snapback4 (48.9 s): test result: ok. 212 passed; 0 failed; 4 ignored; 0 measured; 0 filtered out; finished in 30.36s
```
