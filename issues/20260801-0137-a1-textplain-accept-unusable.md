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

---

**2026-08-01 (A5 arm workaround confirmation):** declaring
`application/octet-stream` in the accept list makes text-shaped research
files (markdown bytes) upload and finalize cleanly — the A5 arm's
`sourceUpload` intent used
`mediaTypes: ['application/pdf', 'application/octet-stream']` and both a
built PDF and raw `.md` bytes published `ready`
(`demos/improvement-sweep/arms/a5-snapback-web/evidence/scenario-evidence.json`
A5-02). The a1-f10 hazard is specifically a `text/plain` accept entry;
the octet-stream spelling is a usable documented-detector workaround
until sniffing lands.
