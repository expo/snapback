# Integration 8 codec repair — muse independent review

Date: 2026-10-13. Model: muse-spark-1.3-contributor; reasoning effort: high.
Reviewed immutable commit: 2a82fb7cd8; parent: 3e0f0c3bfc.
Invocation: `~/sb4-loop/muse-exec.sh --yolo --model muse-spark-1.3-contributor --reasoning-effort high --prompt-file snapback4/reports/20261013-integration8/review-brief.txt`.
Fresh independent session; neither reviewer received the other review.
Brief, invocation stdout and stderr retained under snapback4/reports/20261013-integration8/.
No author acceptance or execution qualification inferred from this verdict.

## Verbatim received output

muse: workspace root: /home/ccheever/projects/snapback-sb4loop (cwd default)
muse: workspace trust: trusted source=run-flag
READY

Material findings: none. The repair is a two-line, funnel-only change with no behavior delta:

- Canonical bytes preserved. [engine.rs](/home/ccheever/projects/snapback-sb4loop/snapback4/crates/snapback4-device/src/engine.rs:19) and [web.rs](/home/ccheever/projects/snapback-sb4loop/snapback4/crates/snapback4-device/src/web.rs:16) now call `snapback4_core::json_codec::to_text`, whose body at this commit is exactly `serde_json::to_string(value)`. Compact form, BTreeMap key order, and escaping are unchanged; the repo's own differential (`codec.rs` `encode()`) asserts `to_string`/`to_text` agreement.
- Pre-open header identity preserved. Key `"x-snapback-device"`, single-entry map shape, `info()` → `DeviceEngine::current()` (untouched), and both `expect()` messages unchanged. `engine_info()` already used the funnel, so the two call sites are now consistent.
- Native/wasm build behavior preserved. No manifest change (confirmed empty diff on `Cargo.toml`), no new dependency (`snapback4_core` already used in both files), no `cfg` change, and `to_text` is target-independent. Remaining `serde_json::to_string` hits are out of census scope: `ffi.rs:166` sits in a `#[cfg(test)]` item the census skips, and `web.rs` `.to_string()` calls are on `json!` Values, not the `serde_json::` typed family.
- No allowlist widening. Single parent `3e0f0c3bfc` confirmed; diff touches only the two code lines plus [JOURNAL.md](/home/ccheever/projects/snapback-sb4loop/snapback4/JOURNAL.md); `wasm-codec-census.mjs` is untouched, so the previously failing census now passes on substance rather than exception.

Minor observations: none material. `engine.rs` uses fully qualified paths so no import cleanup was needed; `web.rs` still needs its `serde_json::json` import. Verification of the fixed census and rebuilt qualification remains with the integrator, as stated.
