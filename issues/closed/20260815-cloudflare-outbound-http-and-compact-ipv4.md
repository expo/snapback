# Cloudflare outbound still admits cleartext HTTP and compact IPv4 literals

**Status:** Open
**Impact:** 3
**Urgency:** 3
**Ease:** 4
**Confidence:** 5
**Systems:** Cloudflare coordinator, Outbound policy
**Date:** 2026-08-15
**Governing:** LLP 0251 (Cloudflare row is HTTPS-only; classify every literal)
**Related:** `issues/closed/20260812-host-fetch-ssrf-parity-with-webhooks.md`,
`issues/20260815-host-fetch-forwards-caller-host-header.md`,
`issues/20260815-outbound-ipv6-6to4-teredo-ssrf.md`
**Found while:** Whole-codebase security/correctness review (2026-08-15)

## Problem

The JS destination port (`cloudflare/src/outbound-destination.js`) is
weaker than the Rust floor in two literal ways. Neither is the
documented DNS-pin residual.

### Cleartext HTTP

```121:122:cloudflare/src/outbound-destination.js
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, code: 'SNAPBACK_HOST_FETCH_DESTINATION_INVALID', reason: 'unsupported-scheme' };
```

Local `ctx.fetch` is public-HTTPS-only (`src/outbound_policy.rs:143-145`).
LLP 0251’s Cloudflare row is the same. This port still admits `http:`.
Secret slots can still land in query params
(`cloudflare/src/coordinator.js:3348-3349`) and then go out in the clear.

### Compact IPv4 literals

`parseIpv4` requires exactly four decimal octets. `127.1`,
`2130706433`, and `0x7f000001` fail that parse, miss the 4-part
invalid-literal regex (`:147-149`), and are admitted as hostnames.

Local `prepare_http_target` resolves then classifies every address, so
`127.1` → `127.0.0.1` is refused. Workers `fetch` can treat those
spellings as addresses without a DNS step. That is a **literal** bypass
of the JS IP floor.

## Desired outcome

- Refuse `http:` on this profile (HTTPS only).
- Parse and classify the same IPv4 literal forms the platform `fetch`
  will treat as addresses (dotted-decimal shorthand, decimal, hex).
  Non-public answers refuse.

## Acceptance

- `http://example.com/` refuses as destination-invalid.
- `http://1.1.1.1/` refuses the same way (scheme, not just IP).
- `https://127.1/` and `https://2130706433/` refuse as non-public.
- Ordinary `https://93.184.216.34/` still admits.
- The documented hostname DNS-rebinding residual is unchanged.

## Resolution (2026-08-15)

The Cloudflare destination profile now admits only HTTPS and classifies the
WHATWG/platform IPv4 number forms that can denote an address: one-to-four-part
decimal, octal components, and hexadecimal components. `127.1`, `2130706433`,
and `0x7f000001` all normalize to loopback and refuse as
`non-public-ip-literal`; `https://93.184.216.34/` remains admitted. The
documented hostname/DNS-pinning residual is unchanged.

Files changed: `cloudflare/src/outbound-destination.js` and
`cloudflare/test/outbound-destination.test.mjs`.

Tests added: HTTPS-only scheme cases for hostname and public IPv4, all three
compact-loopback spellings with exact refusal classification, and a public
IPv4 positive control.

Evidence:

```text
✔ Cloudflare destination admission is HTTPS-only and classifies compact IPv4 literals (1.169084ms)
ℹ tests 3
ℹ pass 3
ℹ fail 0
cloudflare proof-surface hardening: 25/25 checks passed
cloudflare security-hardening acceptance: seed, actions, grants, redaction, admin status, and WebSocket ownership passed
test result: ok. 2694 passed; 0 failed; 2 ignored; 0 measured; 6 filtered out; finished in 60.86s
```

The six broad-run exclusions all reproduce independently at exact base
`a93a11235`; they are unrelated frozen-record/runtime reds, including the
base stack-overflow abort that otherwise prevents a full-suite summary.
