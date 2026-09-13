# Snapback 3 native platform witness

This focused fixture exercises the real Expo 57 / Hermes boundary on one owned
iOS simulator. It is deliberately smaller than the full Clique M6/M8 journeys
and does not replace them.

The original [2026-09-13 behavioral result](results/20260913-ios-hermes-restart.json) passed on
iOS 26.5 with Expo Go 57.0.9 and the default `createExpoClient({ url })`.
Three distinct Expo/Hermes process lifetimes established durable offline FIFO
admission, identical request replay, exactly-once server application, and
restored committed receipts. The record binds package, source, harness and
SQLite hashes. The later [integrity-bound result](results/20260913-ios-hermes-restart-bound.json)
repeats that scoped behavior while additionally binding all acquisition
identity fields and linked records, complete immutable requests and Rust-style
server request digests, and the package archive through the installed payload
and Metro source map to the exact bundle. The original 147-line result remains
unchanged; each record names its own ignored raw-evidence directory.

The outage denied every backend route while Metro and instrumentation remained
reachable. It qualifies this small native persistence case, not airplane-mode
bundle startup, acquisition speed, Android or the full Clique native journeys.
An acquisition can remain `ready` while the reopened offline process is alive,
then persist as `acquiring/validate` for restart validation. The harness allows
only those status forms after the initial ready capture. It compares `id`,
declaration and schema hashes, principal/auth epoch, generation, root/resource
keys, pages, pending and derived declarations, phase and sequence across every
capture. Each acquisition resource and row-version key must resolve to its
exact acquisition-owned record and match the persisted frame authority.

The application imports `createExpoClient` from `snapback3/expo` and constructs
it with only `{ url }`. The harness keeps the Snapback backend behind a separate
loopback proxy so it can deny every backend route while a distinct instrumentation
server remains reachable. The app never substitutes a client, storage adapter,
fetch implementation, identity source, or host-global shim.

`remote-run.mjs` is a foreground owner for the backend, proxy, instrumentation
server, Metro, simulator launches, phase waits, screenshots, receipts, and exact
PID teardown. Pass the run root and a run-specific JSON config containing
`runId`, exact `device` UDID, `hostAddress`, and the backend/Metro/proxy/control
ports. `harness-proof.mjs` holds the shared response, SQLite, FIFO, terminal,
Rust-compatible request-digest, acquisition-link, and three-process-lifetime
assertions. `package-binding.mjs` compares every archived package file to the
app dependency graph immediately before Metro, verifies the source-map content
for every loaded Snapback module, and repeats the installed-payload comparison
afterward. `integrity-audit.mjs` checks retained actual records plus corrupted
authority, row-link, non-body argument, plan-hash, terminal, and installed
package controls before a device run. Run-specific inputs and outputs belong
under `.llp/ship-runs/`, not here.

// @ref LLP 2000#17-completing-the-full-clique-product — native restart proof
// must cross actual process death and SQLite, while remaining scoped evidence.
