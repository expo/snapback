# Bound and validate Cloudflare WebSocket frames before parsing

**Status:** Open
**Severity:** P2
**Systems:** Cloudflare target, WebSockets, Protocol validation, Resource limits
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-16
**Related:** LLP 0013 §Protocol and limits
**Marker:** security, resource-bounds

`webSocketMessage` in `cloudflare/src/coordinator.js` decodes and `JSON.parse`s
arbitrary text/binary input without the specified 64 KiB pre-parse bound. It
then reads `parsed.type` without first proving that the top-level JSON value is
a non-null object.

A large valid JSON frame is fully decoded and parsed instead of being refused
at the boundary. Literal `null` parses successfully and then throws on
`parsed.type`; arrays and malformed variants likewise lack a stable closed
protocol response. The local server already enforces
`MAX_LIVE_SOCKET_FRAME_BYTES = 64 * 1024` at its WebSocket boundary.

**Done when:**

- Check UTF-8 byte size before decoding/parsing both text and binary frames.
- Validate a non-null object and the exact closed shape of subscribe,
  unsubscribe, and ping variants before any field access or storage effect.
- Oversized, malformed, or unknown messages receive a stable close/refusal and
  cannot escape as an uncaught hibernation handler exception.
- Tests cover oversized text and binary, invalid UTF-8, `null`, arrays,
  unknown/cross-variant fields, and a boundary-sized valid frame.
