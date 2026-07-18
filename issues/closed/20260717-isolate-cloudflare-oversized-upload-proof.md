# Isolate Cloudflare oversized-upload proof transport

**Status:** Closed
**Severity:** P1
**Systems:** Cloudflare target, Acceptance testing, CI
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-17
**Related:** LLP 0040 §Proof-runtime preflight
**Marker:** cloudflare, miniflare, node, transport, acceptance

The canonical local proof intermittently failed inside the Cloudflare
protocol-hardening matrix on pinned Node 24.18.0. The parser correctly rejects
the declared 4.1 MB body from `Content-Length` before draining it, but Node can
still be writing the loopback upload when Miniflare/workerd returns 413.
Reading that response then failed with `EPIPE` or `ECONNRESET` instead of
exposing its JSON diagnostic. Direct instrumentation localized the failure to
the oversized-body case. A header-only `Expect: 100-continue` exchange passed
repeatedly without workerd ever asking the client to start the upload.

**Done when:**

- Oversized-body cases prove the real-loopback Content-Length fast path without
  starting a reset-prone uploader.
- Every non-oversized body and function-kind case retains real-loopback
  coverage.
- The harness does not retry a POST or weaken any status, diagnostic, or
  side-effect assertion.
- The narrow protocol-hardening suite and canonical local proof pass on the
  pinned Node runtime.

## Resolution

Only the oversized-body row now uses Node's HTTP client with its exact
`Content-Length` and `Expect: 100-continue`. It flushes headers, fails if the
server emits `100 Continue`, and accepts only the final JSON 413 response, so
no upload starts. The other seven failure classes continue through Fetch for
all 12 real-loopback routes. Production retains the bounded early rejection,
no POST is retried, and any first transport failure still fails the proof. The
direct suite passes with all 96 exact body-rejection cases and all 40
proof/kit/live/cron/nested function-kind cases.
