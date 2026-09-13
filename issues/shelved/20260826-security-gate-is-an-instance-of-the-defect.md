# The authority gate is an instance of the defect it exists to detect

**Status:** Open
**Impact:** 5
**Urgency:** 4
**Systems:** Testing, Security, CI
**Date:** 2026-08-26
**Related:** LLP 0283 F-1, LLP 0303, LLP 0284,
`issues/shelved/20260826-root-identity-mechanism-survey.md`

## The pattern

Five review rounds of the authority runtime gate have each found it forgeable,
each time somewhere new:

| Round | What the gate trusted | How it was forged |
|---|---|---|
| 1 | stdout sentinel strings | print them |
| 2 | exact fully-qualified libtest lines | print those |
| 3 | structural Cargo JSON + exit status | emit both |
| 4 | `cargo` resolved through `PATH` | a fake `cargo` first on `PATH` |
| 5 | `.cargo/config.toml`, `rust-toolchain.toml`, a cached helper's mtime, `NODE_OPTIONS`, `HOST_CC`/`TARGET_CC`/`PKG_CONFIG*`/`LIBRARY_PATH`/`CPATH` | four independent working forgeries |

Round 5's strongest reproduction installed a `[target.<triple>] runner` in the
repository's own `.cargo/config.toml`, **made the protected property false** —
the real mutation-bearing binary genuinely failed — and then had the unchanged
gate report `PASS 16/16` twice.

This is not five unrelated bugs. It is **one defect recurring**: the gate
derives its verdict from facts its caller can author. That is precisely the
class LLP 0303 exists to eliminate, and DERIVE-over-VERIFY applies to the gate
itself, not only to the product it guards.

## Why this matters beyond the gate

LLP 0303 revision (u) already says the rule applies to verification instruments
and that a structured channel is not an unauthorable one. Round 5 is the
empirical proof: every escalation in gate structure — sentinels, then exact
lines, then structural JSON, then absolute binary paths — was defeated by
authoring the next layer down. The regress terminates only at a root the caller
cannot author, which is the same wall both stalled F-1 workstreams hit.

## Two things that are NOT the same problem

Round 5 correctly rejected the previous round's residual framing. Four of the
five findings are ordinary and fixable here:

- Cargo configuration loading is controllable.
- Toolchain channel interpolation is input validation and containment.
  `path.resolve(rustupHome, 'toolchains', channel + '-' + host, 'bin')` discards
  the prefix when `channel` is absolute, so **no toolchain binary needs to be
  overwritten** — the "overwrite" residual did not cover this.
- The mtime-trusted AST helper is local cache integrity.
- Native compiler variables need an allowlist; the denylist has now failed twice.

Only `NODE_OPTIONS` preloading straddles the root problem: it cannot be fixed
inside an already-preloaded Node process and needs an externally rooted
entrypoint or a separately trusted compiled gate.

## What is genuinely closed

Round 5's negative results are evidence the surface is shrinking, not static.
Confirmed failing attacks: fake `cargo` on `PATH`; caller-supplied `CARGO_HOME`;
invalid `RUSTUP_HOME`/`RUSTUP_TOOLCHAIN`; `RUSTC_WRAPPER`, workspace wrapper,
rustflags, target runner/linker vars, loader injection, `DEVELOPER_DIR`,
`SDKROOT`; replacing the Cargo-built libtest artifact (relink defeats it).

The `cfg(test)` repair is sound: expanded production libraries are byte-identical
with and without all 20 mutation cfgs (`sha256` match). The narrow honest claim
is "no mutation activates while `cfg(test)` is false" — **not** a hard
production-artifact boundary, since forced `--cfg test` via `cargo rustc` can
still reach those branches.

## Decision

Fix the four fixable findings, and re-root the entrypoint rather than continuing
to patch evasion-by-evasion. Do not add a sixth structural layer that the caller
can author; that is what the previous four rounds did.
