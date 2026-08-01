# A1 sweep: an assetRef field makes its table unqueryable on the packaged closure

**Opened:** 2026-08-01
**Systems:** Codegen, Assets
**Related:** LLP 0137 (A1 arm), LLP 0044, demos/improvement-sweep/arms/a1-snapback-web/findings/0137-a1-f1-assetref-field-makes-table-unqueryable.json

On @expo/snapback-codegen 0.1.7 the result-contract compiler has no AssetRef
mapping, so any table with a `v.assetRef` field refuses generation for every
query shape over it — declarative `defineLiveQuery({table})` and JS
`results.documents(table)` alike — with
`SNAPBACK_HANDLER_RESULT_CONTRACT_INVALID: unsupported result validator
{"AssetRef":{}}`. The assets guide teaches `v.assetRef` on ordinary tables;
querying such a table is the very next thing any app does.

Fix shape: add the AssetRef result-contract mapping plus a packaged-closure
conformance test that live-queries an assetRef-bearing table. The A1 arm's
workaround (side table no query returns + plain-string id on the queryable
row) is in the finding.
