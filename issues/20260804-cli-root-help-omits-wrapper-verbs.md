# Packaged CLI help omits the wrapper surface and executes work for `--help`

**Status:** Open
**Impact:** 5
**Urgency:** 4
**Ease:** 3
**Confidence:** 5
**Systems:** CLI, Agent operation, Discoverability, Diagnostics
**Date:** 2026-08-04
**Governing:** LLP 0024, LLP 0041, LLP 0042

## Problem

`node packages/snapback-cli/cli.mjs --help` delegates to native help, exits 0,
and lists only the native verbs. It omits packaged verbs including `new`,
`generate`, `doctor`, `verify`, `dev`, `accept`, `mcp-control`, target/hosted
operations, backup/restore, and deploy.

The missing verbs do not have a reliable second-level help contract either:

- `new --help` treats `--help` as a project name;
- `generate --help` treats it as a backend path;
- `dev --help` reports an unknown option;
- `doctor --help` runs the doctor;
- `verify --help` starts a verification against a path named `--help`.

All behaviors were identical under PTY, closed-stdin, and held-stdin probes.
The defect is a successful but incomplete discovery surface: an agent cannot
enumerate the actual CLI from the CLI.

## Proposed fix

Generate one composed command inventory before dispatch. Root help must include
every wrapper and delegated native verb, mark intentionally hidden/deprecated
surfaces explicitly, and route `<verb> --help` without executing the verb.
Add a parity test that derives the dispatch inventory and fails when any
callable branch is absent from help.

Subcommand help should include flags, exit taxonomy, whether it is long-running
or one-shot, its machine-output schema, and its recovery channel.

## Acceptance

Run root and per-verb help under the A/B/C unattended harness. Every help
invocation exits 0, performs no operation, and the mechanically derived
dispatch set equals the documented set.
