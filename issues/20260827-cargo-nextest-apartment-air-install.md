# Install cargo-nextest 0.9.143 on the offline Apartment MacBook Air

**Status:** Open
**Opened:** 2026-08-27
**Systems:** Build fleet, Verification, Developer experience

## Problem

LLP 0316 Phase 5 adopted cargo-nextest 0.9.143 as the canonical Rust test
runner and installed that exact version on every fleet machine reachable on
2026-08-27. The Apartment MacBook Air at `100.70.173.122` did not answer three
Tailscale pings or a passwordless SSH connection to TCP/22. Its LAN address
presented a changed host key and was correctly not trusted as the same machine.

The host therefore could not be provisioned. `scripts/run-cargo-nextest` will
refuse with `SNAPBACK_CARGO_NEXTEST_MISSING` rather than silently fall back to
`cargo test`, so this is explicit fleet readiness debt rather than hidden proof
drift.

## Resolution

After the Air is back online and its Tailscale identity is verified, install
and prove the pinned runner before assigning Rust proof work:

```sh
ssh ccheever@100.70.173.122 \
  'mkdir -p "$HOME/.cargo/bin" && curl -LsSf https://get.nexte.st/0.9.143/mac | tar zxf - -C "$HOME/.cargo/bin" && "$HOME/.cargo/bin/cargo-nextest" --version'
```

Acceptance: the command reports cargo-nextest 0.9.143 for
`aarch64-apple-darwin`; then close this ticket with the observed version and
date. Do not bypass SSH host verification through the stale LAN address.
