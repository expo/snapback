# A1 sweep: a text/plain accept entry can never finalize (bytes detect as octet-stream)

**Opened:** 2026-08-01
**Systems:** Assets
**Related:** LLP 0137 (A1 arm), LLP 0044, demos/improvement-sweep/arms/a1-snapback-web/findings/0137-a1-f10-textplain-accept-unusable.json

Finalization detects content type from bytes; plain text detects as
`application/octet-stream`, so any upload under a
`{ mediaTypes: ['text/plain'] }` intent refuses at finalize with
`SNAPBACK_ASSET_MEDIA_TYPE_UNSUPPORTED`, and the intent authoring layer
accepts the impossible declaration without warning. The A1 arm switched its
fixture to a PDF (magic-detectable) to proceed.

Fix shape: bounded text sniffing (valid UTF-8/ASCII -> text/plain), or refuse
at generation any accept entry the detector can never produce.
