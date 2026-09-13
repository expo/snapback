# Snapback 4: serve binds all interfaces over cleartext HTTP

Status: Closed
Resolved: 2026-09-13
Priority: P1
Observed: 2026-09-13
Review finding: S02
Evidence: Code-traced; journal records TLS as a proxy's job in slice one
Baseline: `6918cccbc264cf000982b03a5a11a2cf5563f885` / Snapback 4 0.1.15
Related: [security review](../../llp/reviews/3000-security-review-20260913.md), `snapback4/JOURNAL.md` (TLS left to a proxy)

## Problem and reproduction

`snapback4 serve <dir>` defaults to `--bind 0.0.0.0 --port 4400` and speaks HTTP. `/auth/signup`, `/auth/login` and every authenticated route send passwords and bearer tokens on that socket. The help string advertises this as the release verb.

Slice one leaves TLS to a reverse proxy. The binary does not require a proxy, does not refuse to bind a public address without one, and does not print that passwords will be sent in the clear. A VPS operator who runs the documented command exposes the identity table and every partition to the network.

The client and local replica trust `/schema` and `/sync` with no response authenticity, so a network MITM can steal tokens and poison the device store.

## Acceptance

- Default bind for `serve` should not be all interfaces without an explicit flag, **or** refuse to listen unless a documented TLS terminator / `--i-understand-cleartext` posture is set.
- Print a loud warning when the listener is not loopback and the connection is not TLS.
- Document the proxy contract (preserve `Authorization`, do not forward `x-snapback-persona`, do not make the proxy's loopback address the client).
- Do not treat this ticket as a request to implement TLS inside the binary unless that is the chosen design.

## Implementation locations

- [crates/snapback4/src/verbs/releases.rs](../../snapback4/crates/snapback4/src/verbs/releases.rs) (`serve_release`)
- [crates/snapback4/src/main.rs](../../snapback4/crates/snapback4/src/main.rs) (help text)

## Resolution — 2026-09-13

serve defaults to 127.0.0.1. A non-loopback literal bind requires --i-understand-cleartext and prints the cleartext warning. The README and identity guide state the TLS proxy contract: preserve Authorization, strip persona headers, and enforce client-address rate limits at the proxy; forwarded headers do not confer identity. Bind-policy tests cover the default, refusal, and explicit opt-in. TLS termination remains external.

Delivery validation and independent review for the current-main port are in
the [remediation record](../../llp/reviews/3000-security-remediation-20260913.md).
