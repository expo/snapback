# IPv6 6to4 / Teredo slip the public-address SSRF floor

**Status:** Open
**Impact:** 2
**Urgency:** 2
**Ease:** 5
**Confidence:** 5
**Systems:** Outbound policy, Actions, Webhooks
**Date:** 2026-08-15
**Governing:** LLP 0251 (mapped/translated/scoped forms)
**Related:** `src/outbound_policy.rs` `is_public_v6`,
`cloudflare/src/outbound-destination.js` `isPublicIpv6Literal`,
`issues/20260812-0249-egress-admission-v1-design.md` (broader classifier
versioning; this ticket is the specific hole)
**Found while:** Whole-codebase security/correctness review (2026-08-15)

## Problem

```213:225:src/outbound_policy.rs
fn is_public_v6(ip: Ipv6Addr) -> bool {
    if let Some(mapped) = ip.to_ipv4_mapped() {
        return is_public_v4(mapped);
    }
    let segments = ip.segments();
    !ip.is_loopback()
        && !ip.is_unspecified()
        && !ip.is_multicast()
        && (segments[0] & 0xe000) == 0x2000
        && (segments[0] & 0xfe00) != 0xfc00
        && (segments[0] & 0xffc0) != 0xfe80
        && !(segments[0] == 0x2001 && segments[1] == 0x0db8)
}
```

Mapped IPv4, ULA, link-local, CGNAT v4, `169.254.169.254`, and
`metadata` names are blocked. **`2002::/16` (6to4)** and **`2001:0::/32`
(Teredo)** sit in `2000::/3` and are treated as public.
`https://[2002:0a01:0203::1]/` is 6to4 of `10.1.2.3`.

The Cloudflare JS port has the same predicate
(`cloudflare/src/outbound-destination.js:84-99`). Tests cover
`::ffff:169.254.169.254` but not 6to4/Teredo.

Also missing from the documentation/reserved set: `3fff::/20` (RFC 9637).
Lower exploitability; fold into the same classifier update.

Exploitation needs a host that still routes 6to4/Teredo (uncommon on
many clouds; still present on some networks). Hence P3, not P1.

## Desired outcome

Treat 6to4, Teredo, and the RFC 9637 documentation prefix as
non-public. Decode 6to4/Teredo's embedded IPv4 and run `is_public_v4`.
Mirror the change in the Cloudflare hostname/IP-literal port. Add
vectors next to the existing mapped-IPv4 cases.

## Acceptance

- `2002:0a01:0203::1`, `2001:0:c0a8:1::`, and `3fff::1` refuse as
  `SsrfRefused` on Rust and as `non-public-ip-literal` on Cloudflare.
- Ordinary `2001:4860:4860::8888` still admits.
- Existing mapped / ULA / link-local cases stay refused.

## Resolution (2026-08-15)

The Rust and Cloudflare classifiers now decode 6to4's embedded IPv4 and
Teredo's direct server plus complemented client IPv4 endpoints through the
same public-IPv4 floor. RFC 9637 `3fff::/20` is classified as documentation/
reserved. The two implementations carry matching refusal and admission
vectors, including the ticket's exact private transition examples, mapped
IPv4, ULA, link-local, public transition endpoints, and ordinary Google DNS
IPv6.

Files changed: `src/outbound_policy.rs`,
`cloudflare/src/outbound-destination.js`, and
`cloudflare/test/outbound-destination.test.mjs`.

Tests added: Rust resolver-address vectors beside the mapped-IPv4 cases and a
Cloudflare unit corpus that checks both the literal classifier and the public
`non-public-ip-literal` refusal envelope.

Evidence:

```text
test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 2695 filtered out; finished in 0.02s
ℹ tests 3
ℹ pass 3
ℹ fail 0
test result: ok. 2694 passed; 0 failed; 2 ignored; 0 measured; 6 filtered out; finished in 60.86s
```

The six broad-run exclusions all reproduce independently at exact base
`a93a11235`; they are unrelated frozen-record/runtime reds, including the
base stack-overflow abort that otherwise prevents a full-suite summary.
