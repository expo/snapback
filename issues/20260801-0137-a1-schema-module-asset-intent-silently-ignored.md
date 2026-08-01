# A1 sweep: a defineAssetUpload intent exported from the schema module is silently dropped

**Opened:** 2026-08-01
**Systems:** Codegen, Assets
**Related:** LLP 0137 (A1 arm), LLP 0044, demos/improvement-sweep/arms/a1-snapback-web/findings/0137-a1-f8-schema-module-asset-intent-silently-ignored.json

Exporting a `defineAssetUpload` intent from the SCHEMA module generates
cleanly with the intent absent everywhere (no upload reference in api.mjs, no
intent in the manifests), and a handler's
`ctx.assets.attach(id, { upload: 'name' })` naming the missing intent also
passes generation. The guide's asset authoring snippets show the intent
exported beside `defineSchema` in one module, so colocation is the natural
reading. Moving the export to the functions module makes everything appear.

Fix shape: collect intents from the schema module too, or refuse generation
(named diagnostic) when an intent export is found where it cannot be
collected and when attach references an undeclared intent.
