# Exact native text-format null boundary

Observed against committed native source `26c9fd5e0d3922ce7680493c0e8f7371f4793d59` and frozen owner SHA-256 `4d0f8f0176921b56305e9969da0fcb2dd5ecedae1f65d983f537e613d0c6e46e` on 2026-09-06. Six tiny `check --ir --json` controls used the retained final format certificate fixture, with a 20-second per-command limit. No source change, build, server, input-admission replay, or suite rerun occurred.

| Boundary | Actual result |
| --- | --- |
| Argument `format: "handle"` / `"url"` | Decodes and certifies |
| Argument format omitted, recursively under Optional/List | Decodes and certifies |
| Program argument `format: null` | Exit 1; `E_CHECK_IR_UNSUPPORTED`; no certificate |
| Channel argument `format: null` | Exit 1 at schema decode; no certificate or program admission |
| Existing column `Constraint::Text.format: null` | Decodes and certifies |
| Existing column constraint format omitted | Decodes and certifies; identical certificate to the preceding null case |

The argument descriptor boundary is deliberate in this exact source. `snapback2/crates/snapback2-core/src/ir.rs:41` gives the optional field a default and an explicit `deserialize_text_format` hook. At `ir.rs:454`, the hook first calls `String::deserialize`; therefore a present null or non-string never becomes `Option::None`. Only `handle` and `url` strings are accepted. Absence becomes native None, and native None serializes as an omitted field. `snapback2/crates/snapback2/src/check.rs:203` decodes `Program` and `Schema` before certification, so these malformed descriptors do not reach argument value validation. The schema channel uses the same ArgType.

The unchanged column constraint at `schema.rs:367` has ordinary Option serde without that hook; there null and omission both become None. This does not imply equivalent argument-descriptor decoding. Likewise, an authored Optional argument VALUE may still be null or omitted; that separate behavior is unchanged and is not exercised by this decode-only probe.

The approved argument-format root contract says to match native Option canonicalization, **including null if accepted**, and explicitly does not make null a supported authored descriptor. Treating that conditional sentence as unconditional native argument-null acceptance was inaccurate. The current twin refusal matches the native argument boundary; this audit does not request a source change or retroactively broaden old raw-IR decoder guarantees.

Full external evidence: `revisions/search-engine/null-format-boundary-26c9/` contains `probe.py`, six exact inputs, six stdout JSON outputs, empty stderr files, `result.json`, and compact `summary.json`. The prior twin witness remains unchanged at `lanes/search-twin/v5-null-format-native-{input.json,log}`. Source and owner identities were checked before execution. `summary.json` records input/output hashes and exact refusal messages.
