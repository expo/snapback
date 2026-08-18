# LLP 0249 live isolation attestation needs a privileged launcher channel

**Status:** Open
**Severity:** P1
**Systems:** CLI, server, privileged launcher, worker attestation
**Date:** 2026-08-12
**Related:** LLP 0249 D3; `archive/spike-isolated-node-action/schemas-draft/isolation-profile.v1.json`

## Problem

The CLI/server entry around `packages/snapback-cli/index.mjs:2567` does not
split an unprivileged server from a privileged launcher. There is therefore no
independent authority able to attest that the running worker has the claimed
OS policy, broker, deny facts, executable, probe result, and session binding.

The spike's preload can report 16 absent JavaScript surfaces and refuse 12
runtime imports, but those facts are self-observations from the same Node
process. A copied static receipt would not establish live readiness.

## Required design

- Define the privileged-launcher/server split and the authenticated local
  channel between them.
- Specify a one-use server challenge, launcher/startup nonces, worker channel
  identity, generation/bundle/executable bindings, expiry, revocation
  generation, and replay refusal.
- Have the launcher sign a live `isolation-profile.v1` only after it has
  installed and probed the OS policy and broker for that worker instance.
- Fail closed when the channel is lost, the receipt expires, any bound digest
  changes, or the launcher's trust root is unavailable.

## Completion

A server cannot self-mint readiness, replay an old receipt, substitute a
worker/channel, or continue dispatch after attestation loss. Integration tests
exercise one-use challenges and session binding across restart and revocation.
