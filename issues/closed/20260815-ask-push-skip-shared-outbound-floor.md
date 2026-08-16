# Ask provider HTTP and Expo push skip the shared outbound destination floor

**Status:** Open
**Impact:** 3
**Urgency:** 3
**Ease:** 3
**Confidence:** 5
**Systems:** Ask, Push, Outbound policy
**Date:** 2026-08-15
**Governing:** LLP 0251 (Ask + Expo push consumer rows), LLP 0204 D5
**Related:** `llp/0251-outbound-destination-policy.rfc.md`,
`issues/closed/20260812-host-fetch-ssrf-parity-with-webhooks.md`,
`issues/20260812-0249-egress-admission-v1-design.md`
**Found while:** Whole-codebase security/correctness review (2026-08-15)

## Problem

Webhooks and `ctx.fetch` now share `src/outbound_policy.rs` (public HTTPS,
DNS pin, `redirects(0)`, `try_proxy_from_env(false)`). Two remaining
credentialed egress consumers do not.

### Ask

`parse_provider` (`src/ask.rs:118-150`) admits any `https://` authority,
including literal `169.254.169.254` / RFC1918, and loopback HTTP. Then
`chat_completion` (`src/ask.rs:229-235`) builds a bare ureq agent with
only `redirects(0)` and sends the provider bearer. No public-IP
classification, no DNS pin, no env-proxy refusal.

A manifest `openai-compatible:https://169.254.169.254/latest/meta-data`
(or a hostname that resolves there) leaks the Ask key. Inherited
`HTTPS_PROXY` does the same.

LLP 0251 already assigns Ask the shared floor and refuses loopback to
served apps. That row was not implemented when R1 landed.

### Expo push

`post_expo_json` (`src/push.rs:161-165`) is a default ureq agent: follows
redirects (5), honors `HTTP(S)_PROXY`, no pin. Production base is
`https://exp.host` (`src/server.rs:547`), so the destination is not
handler-authored, but a 3xx or inherited proxy still forwards the Expo
access token.

## Desired outcome

Both consumers call `prepare_http_target` + `pinned_http_agent`. Ask
additionally rejects non-public literals at parse time and stops
admitting served-app loopback HTTP (test fixture keeps the internal
test-only capability LLP 0251 already named). Push pins `exp.host:443`
and refuses redirects/proxies.

## Acceptance

- `openai-compatible:https://169.254.169.254/` / `metadata` /
  RFC1918 literals refuse before any request.
- Ask send uses the pinned no-redirect no-env-proxy agent.
- Expo send/receipt uses the same agent against the exact Expo
  authority.
- `HTTPS_PROXY` in the process environment cannot observe either bearer.

## Non-goals

- Per-action destination grants (that remains
  `issues/20260812-0249-egress-admission-v1-design.md`).
- Changing the Expo production hostname.

## Resolution (2026-08-15)

Ask and Expo now prepare and pin their destinations with the shared LLP 0251
transport before attaching either bearer. Ask rejects metadata/RFC1918 and
other non-public IP literals during provider parsing, admits HTTPS public
destinations, and retains only its `cfg(test)` literal-loopback HTTP fixture.
Expo admits the exact production `exp.host:443` authority plus the existing
literal-loopback deterministic fixture path. Both transports have zero
redirects, DNS pinning, and inherited environment proxies disabled.

Files changed: `src/ask.rs`, `src/push.rs`, and
`src/outbound_policy.rs`.

Tests added: Ask parse-time non-public-literal refusal; exact Expo authority
and loopback-fixture policy; and a subprocess witness that sets every upper-
and lower-case HTTP(S)/ALL proxy variable, observes both bearers only at their
direct pinned listeners, and proves the proxy listener received no connection.

Evidence:

```text
test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 2695 filtered out; finished in 0.02s
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 2699 filtered out; finished in 0.04s
test result: ok. 20 passed; 0 failed; 0 ignored; 0 measured; 2682 filtered out; finished in 0.40s
test result: ok. 2694 passed; 0 failed; 2 ignored; 0 measured; 6 filtered out; finished in 60.86s
```

The six broad-run exclusions all reproduce independently at exact base
`a93a11235`; they are unrelated frozen-record/runtime reds, including the
base stack-overflow abort that otherwise prevents a full-suite summary.
