# `ctx.fetch` / `ctx.fetchStream` forward caller `Host` / hop-by-hop headers

**Status:** Open
**Impact:** 3
**Urgency:** 3
**Ease:** 4
**Confidence:** 5
**Systems:** Actions, Outbound fetch, Cloudflare coordinator
**Date:** 2026-08-15
**Governing:** LLP 0251 §Canonical admission algorithm step 3
**Related:** `issues/closed/20260812-host-fetch-ssrf-parity-with-webhooks.md` (destination floor landed; this header step did not),
`llp/0251-outbound-destination-policy.rfc.md`
**Found while:** Whole-codebase security/correctness review (2026-08-15)

## Problem

LLP 0251 step 3: “Reject caller-supplied `Host` or `:authority` headers.”
After the 2026-08-12 destination-floor landing, both local lanes still copy
handler headers onto the pinned request:

```1872:1874:src/server.rs
        for (name, value) in &request.headers {
            outbound = outbound.set(name, value);
        }
```

The streamed sibling does the same (`src/server.rs:1604-1606`). Cloudflare
`hostActionFetch` likewise assigns every `request.headers` entry
(`cloudflare/src/coordinator.js:3329-3332`).

The TCP/TLS destination is the pinned authored URL, so this is not classic
SSRF. It is still:

- vhost confusion on a shared IP / reverse proxy
- hop-by-hop smuggling (`Transfer-Encoding`, `Content-Length`, `Connection`)
- `X-Forwarded-*` / `Forwarded` spoofing toward the admitted host

Header shape checks only bound size and ban CR/LF. They do not ban
authority or hop-by-hop names.

## Desired outcome

Refuse (or strip) `Host`, `:authority`, `Transfer-Encoding`, `Content-Length`,
`Connection`, `Keep-Alive`, `Upgrade`, `TE`, `Trailer`, `Proxy-Authorization`,
and `X-Forwarded-*` / `Forwarded` from handler-supplied headers. Let the
transport emit `Host` from the prepared authority. Secret-slot header
placement may still set non-authority headers after admission.

## Acceptance

- A handler `Host: 169.254.169.254` (or `:authority`) is refused with a
  closed diagnostic; the request is not sent.
- Hop-by-hop names above are refused the same way.
- Ordinary `Authorization` / `Accept` / custom headers still go through.
- Cloudflare `hostActionFetch` matches the Rust refusal set.

## Resolution (2026-08-15)

Implemented the LLP 0251 authority/hop-by-hop refusal before either Rust
action-fetch lane constructs its outbound request and before either Cloudflare
lane calls platform `fetch()`. The shared, case-insensitive set covers `Host`,
`:authority`, the named hop-by-hop/framing fields, `Proxy-Authorization`,
`Forwarded`, and the complete `X-Forwarded-*` prefix. Non-authority secret-slot
headers remain supported; authority/hop-by-hop secret placements are also
refused before credential resolution on Cloudflare.

Files changed: `src/outbound_policy.rs`, `src/server.rs`,
`src/server/tests.rs`, `cloudflare/src/outbound-destination.js`,
`cloudflare/src/coordinator.js`, and
`cloudflare/test/outbound-destination.test.mjs`. The deterministic source-site
refresh also updated `guide/reference/diagnostics-registry.json` and
`guide/reference/diagnostics.md`; no code or HTTP classification was added.

Tests added: shared refusal-set unit vectors; both real Rust action-fetch lanes
refuse every forbidden name with a nonblocking listener proving no send; both
lanes forward `Authorization`, `Accept`, and a custom header; the Cloudflare
unit suite locks the identical refusal set used by both coordinator lanes.

Evidence:

```text
test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 2695 filtered out; finished in 0.02s
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 2698 filtered out; finished in 0.10s
ℹ tests 3
ℹ pass 3
ℹ fail 0
cloudflare proof-surface hardening: 25/25 checks passed
cloudflare security-hardening acceptance: seed, actions, grants, redaction, admin status, and WebSocket ownership passed
[diagnostics-registry] ok — 3210 codes, 10981 sites, 995 HTTP-classified
test result: ok. 2694 passed; 0 failed; 2 ignored; 0 measured; 6 filtered out; finished in 60.86s
```

The six broad-run exclusions all reproduce independently at exact base
`a93a11235`; they are unrelated frozen-record/runtime reds, including the
base stack-overflow abort that otherwise prevents a full-suite summary.
