# LLP 0036 secret placement and redaction on ctx.fetchStream

**Status:** Open — local arm landed 2026-07-24. Done: value-mode parity with
ordinary local fetch (staged `ctx.secrets` values + the LLP 0036 staged-value
redactor on every stream error envelope), witnessed through the real HTTP
action path in both directions (rethrown-leak scrubbed to `[REDACTED]`;
untouched structured refusal value-free with the secret in URL and headers);
`secretSlots` placement parity on the bridge with a typed refusal for
descriptor slots the value-mode profile cannot resolve (same posture as local
`ctx.fetch`). `cargo test --lib` 1139; envelope suite 5/5. Remaining before
close: the hosted/Workerd descriptor-resolution seam for stream open (blocked
on the unlanded Workerd streaming baseline) and secret/private-data scans
over retained durable stream receipts (acceptance-receipts work).
**Severity:** P1
**Systems:** Actions, Outbound fetch, Security, Testing
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-23
**Related:** LLP 0076 §Surface + Evidence-status gaps, LLP 0036 (opaque handles, host-boundary placement, value-aware redaction), packages/snapback-harness/ctx-bootstrap.js (fetchStream forwards raw fields), cloudflare/src/coordinator.js (ordinary fetch descriptor resolution vs stream open), issues/20260723-llp0076-streaming-program.md
**Marker:** llp-0076, streaming, secrets

`ctx.fetchStream` forwards raw URL/headers/body/key and performs none of the LLP
0036 opaque-descriptor resolution and value-aware redaction that ordinary
`ctx.fetch` does. This is on the critical path: the fixture's owner-private AI
chat and open question 6 both assume authenticated secret-bearing provider
streams, so a stream cannot yet place an API key the way an ordinary action can.

**Done when:**

- The same per-function opaque placement seam and staged-value redactor used by
  ordinary fetch are applied to stream open on both hosts.
- Redaction is witnessed across action envelopes, receipts, response errors,
  URLs, and private response bytes (secret/private-data scans over stream
  receipts).
- The secret-scrubbing gap row moves to closed; the §Surface "same secret
  redaction as ordinary fetch" claim becomes true (or, if v1 instead excludes
  secret-bearing streams, that narrowing is stated explicitly and the AI-provider
  use case is re-scoped).
