# Fixture and reproduction

Baseline is AQ's final main tree, aedd35615ad54901a481a01481e5d8f6110c69b4.
Read `../20260929-aq-fast-acquisition/` including round 1 and all four tools.
PF's ignored `~/sb4-intent/lane-pf/target/pf/full/` was copied with its program,
database and WAL into this lane's ignored `target/hv/store` and `store-after`.
Only these copies were made writable and served. PF's copy was never modified.
`dev --replay --no-watch` suppresses fixture mutation/maintenance. Private servers
use ports 49761 (preserved baseline binary) and 49762 (production after build).

Host: eb1000 / expose-builder-pixel, Linux x86_64, AMD EPYC 9454, 96 logical CPUs;
Rust 1.97.0, wasm-bindgen 0.2.127, Node 24.13.1, Bun 1.3.14. Browser version and
host load/CPU pressure/free memory are retained in every browser sample.
No reported paired timing overlaps this lane's builds. Other lanes share the host.

`tools/browser.mjs`, `measure.py`, `summarize.py`, `cpu.py` derive from AQ's
harness. Each sample uses a fresh Chromium context and empty durable store.
The same login, application, inbox subscription and `client.acquired` boundary
are used. Every acquired row is compared to its canonical server response;
the harness checks the complete offline inbox. The before and after builds
alternate AB/BA across five runs, for both u0500 and u0001 and both devices.
Timing files contain counts and byte sizes, not fixture row payloads.
The six aggregate raw sample files, logs and CPU profiles are retained gzip
compressed under `evidence/`; the summary tools accept those gzip files too.
`paired-summary.json` preserves per-sample scalar phases and five-run medians.
`artifacts.json` binds the measured browser wasm and server binaries. The final
single-row server heap fallback was added after timing; this fixture uses the
unchanged 32-row branch, and the final canonical wasm has identical size.

From repository root, after stopping builds:

```
python3 snapback4/reports/20260929-hv-heavy-acquisition/tools/measure.py \
  http://127.0.0.1:49761 http://127.0.0.1:49762 \
  target/hv/paired target/hv/before-sdk snapback4/packages/snapback4/dist
python3 snapback4/reports/20260929-hv-heavy-acquisition/tools/summarize.py target/hv/paired
```

`AQ_DIAGNOSTIC=1` captures wasm calls (including linear-memory size after each),
strict save transactions, bucket/page request counts, header/body/JSON phases.
These instrumented medians are comparable on both sides, not bare throughput.
`AQ_PROFILE=1 AQ_MODES=default` adds a Chrome CPU profile; preserve wasm symbols
with `CARGO_PROFILE_WASM_STRIP=false` for attribution only. That artifact is not
used for shipping or ordinary paired timing. `tools/server-profile.patch` is
the temporary per-table attribution probe; no timer is left in product code.

`HV_CAPTURE=1` saves the exact default-device apply/sync_state requests and backend
locally to `OUTPUT.commands.json`. These ~45 MB captures stay ignored. The
`heavy_acquisition` Rust test replays the same requests when `HV_CAPTURE` names
that absolute path. Its allocator prints live, peak and cumulative Rust allocation
per phase. `HV_NATIVE_ONLY=1` runs only the native SQLite device; wrap the compiled
test binary with `/usr/bin/time -v` to include SQLite/libc RSS. `HV_SERVER_STORE`
selects read-only server snapshot profiling and requires `HV_PRINCIPAL` from the
private fixture. No account token or capture is committed.

Without these environment variables, the regression generates 6,000 rows,
ordinary and word indexes, compares peak allocation against the old representation
of those same keys/rows, bounds each drain string, and restores a complete offline
partition. It asserts an allocation proportion rather than elapsed time.
