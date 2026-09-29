# Final wasm artifact

- Raw: 2,040,727 B.
- SHA-256: `0ca4bf5d94abee4edfc69bb6594cd7995407604bcec8cae440c6c01b4d7a5ef6`.
- Build-script gzip (`gzip -9 -c`): 592,959 B.
- Unchanged cap: 593,719 B; headroom: 760 B.
- Built by `bash scripts/build-wasm.sh`; also rebuilt by the one full suite invocation.
- Baseline copied sibling artifact: 2,040,531 B raw / 592,979 B gzip; exact source binding not independently qualified (see REPORT.md).

Generated wasm/SDK output is ignored and not committed. `TRACE-SHA256.txt` records hashes of the complete uncompressed measurement traces; their gzip files preserve every event.

Some command logs are stored as `.log.gz` to preserve their exact output (including diagnostic whitespace) without adding whitespace errors to the source diff. Decompress them with `gzip -dc`.
