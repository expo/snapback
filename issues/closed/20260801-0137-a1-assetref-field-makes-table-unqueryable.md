# A1 sweep: an assetRef field makes its table unqueryable on the packaged closure

**Opened:** 2026-08-01
**Closed:** 2026-08-01
**Systems:** Codegen, Assets
**Related:** LLP 0137 (A1 arm), LLP 0044, demos/improvement-sweep/arms/a1-snapback-web/findings/0137-a1-f1-assetref-field-makes-table-unqueryable.json

On @expo/snapback-codegen 0.1.7 the result-contract compiler had no AssetRef
mapping, so any table with a `v.assetRef` field refused generation for every
query shape over it — declarative `defineLiveQuery({table})` and JS
`results.documents(table)` alike — with
`SNAPBACK_HANDLER_RESULT_CONTRACT_INVALID: unsupported result validator
{"AssetRef":{}}`. The assets guide teaches `v.assetRef` on ordinary tables;
querying such a table is the very next thing any app does.

## Resolution

The recursive result-contract vocabulary now includes an `assetRef` leaf,
serialized and validated as a non-empty opaque asset-id string. Codegen maps
stored `v.assetRef` fields into that leaf for query and live-query document
contracts; Rust validates the same manifest vocabulary at handler egress.
Argument contracts remain intentionally unchanged. Party Wall now queries the
typed photo field directly and no longer maintains its former split table or
plain-string reference copy.

Evidence: codegen result-contract and provider-introspection tests, Rust result
contract and artifact-schema tests, Party Wall acceptance, guide checks, and
`./ref-check --verbose`.
