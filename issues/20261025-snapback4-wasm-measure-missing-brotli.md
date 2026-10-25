# Snapback 4 Wasm measurement can silently record missing Brotli as zero

Status: Open
Date: 2026-10-25
Scope: snapback4/scripts/measure-wasm.sh

Integration25 observed a missing Brotli executable during a no-record probe.
The command substitution inside sizes() prints command-not-found but printf
returns success; the script exits0 and emits brotli:0 for both Wasm and glue.
With the recording mode this could append an incomplete measurement. Gzip
was valid, but the probe is not accepted as complete evidence.

Reproduction evidence: `snapback4/reports/integration25/wasm-invalid-no-brotli.log.gz`.
The actual0.4.41 measurement restores Brotli1.1.0 on a stable private PATH and
records raw2415524 / gzip738108 / Brotli555805, dirty=false, budget738608.
No zero-Brotli record was appended.

Follow-up: fail before append when the compressor is unavailable or fails;
add a meaningful negative control verifying nonzero exit and unchanged JSONL,
then confirm the ordinary complete measurement still passes. Do not change
the artifact budget or substitute a zero measurement.
