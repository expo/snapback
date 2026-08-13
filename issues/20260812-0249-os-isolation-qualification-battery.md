# LLP 0249 OS-isolation enforcement and adversarial qualification battery

**Status:** Open
**Severity:** P0
**Systems:** Worker sandbox, macOS seatbelt, Linux Landlock/namespaces, CI
**Date:** 2026-08-12
**Related:** LLP 0249 D3; LLP 0189; `spike-isolated-node-action/RESULTS-20260812.md`

## Problem

The spike ran Node `v25.9.0` with `--permission`, `--no-addons`, exact file-read
grants, module hooks, and an empty environment. It observed all 16 named D3
surfaces absent, but its own result is explicitly
`CALIBRATION ONLY — NOT A CAPABILITY CLAIM`.

Node permission checks and JavaScript reachability are not an OS security
boundary. The spike does not test same-UID process access, inherited/open file
descriptors, `/proc`, Unix sockets, loopback, raw DNS/network paths, signals,
debug/inspector channels, shared memory, executable discovery, races, or
kernel-policy escape.

## Required work

- Implement the reviewed macOS seatbelt and Linux Landlock/namespaces/cgroup
  policies in the privileged launcher, including a clear unsupported-host
  refusal.
- Build an adversarial probe corpus covering filesystem, process, IPC,
  networking, environment, addon, VM/Wasm, inspector, signal, and same-UID
  attacks before and during execution.
- Digest-bind the policy, deny-fact corpus, probe corpus, and probe result into
  the live isolation receipt.
- Qualify startup, steady-state, restart, tamper, expiry, worker loss, and
  fail-closed behavior on supported OS/architecture pairs.

## Completion

The scoped LLP 0189 qualification record shows every adversarial probe denied
by the OS boundary, not merely hidden in JavaScript, and the capability remains
unmintable on an unqualified target or after live policy drift.
