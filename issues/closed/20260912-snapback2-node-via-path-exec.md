# snapback2 owner execs node via PATH lookup

**Status:** Resolved
**Priority:** P2
**Date:** 2026-09-12
**Source:** snapback2 comprehensive review workflow (2026-09-11 sweep)
**Location:** `snapback2/crates/.../project.rs:157` (`Command::new("node")`)

## What was reported

The owner spawns `node` resolved via `PATH`. A tampered `PATH` turns a
direct-binary invocation into owner-privilege code execution. (Daemon +
doctor paths that pin or resolve the toolchain may already be safe — check
before fixing.)

## Suggested fix

- Resolve to an absolute node path at startup (or hermetic toolchain
  resolution) and exec that; fail closed when unresolvable.
- Audit sibling `Command::new` sites for the same pattern while in there.

## Acceptance

- Owner never execs `node` (or siblings) via ambient `PATH`; PATH-tamper
  test fails closed.

## Resolution (2026-09-12)

The package launcher pins its own `process.execPath` as SNAPBACK2_NODE; compiler and journey children require an absolute executable path and never fall back to PATH. Direct-binary users receive an actionable refusal when the pin is absent. The sibling process probe uses /bin/ps. Existing direct-binary test launchers now set the pin.

Validation: toolchain refusal tests passed in the integrated native owner suite (263 tests); changed JavaScript launchers passed `node --check`. A real direct-binary `check --project` invocation with a fake node at the front of PATH and SNAPBACK2_NODE absent returned E_OWNER_NO_COMPILER, and the fake executable's marker was never created.
