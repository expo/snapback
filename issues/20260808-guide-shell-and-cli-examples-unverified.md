# guide: shell commands and CLI facts have no mechanical source of truth

**Status:** Open
**Impact:** 4
**Urgency:** 3
**Ease:** 3
**Confidence:** 5
**Systems:** Guide, CLI, generated reference, package templates
**Date:** 2026-08-08
**Related:** LLP 0061, LLP 0184, LLP 0194

## Summary

The guide deliberately verifies JavaScript, TypeScript, JSON, and Contract
fences, but `guide/conventions.md` exempts every `sh` fence as illustrative.
Several command-heavy, high-leverage pages consequently have no verified code
snippets at all:

- `getting-started/the-authoring-loop.md` — 7 shell fences;
- `clients/app-cli.md` — 9 shell fences;
- `operating/agent-controls.md` — 2 shell fences;
- `operating/observability.md` — 2 shell fences;
- `operating/error-tracking.md` — 3 shell fences; and
- `testing/verify.md` — 1 shell fence.

Their `examples:` metadata proves only that named paths exist. It does not tie
documented commands, subcommands, flags, package-manager choices, output
shapes, or publication-version statements to the CLI dispatch tree or another
authority. The current stale `latest` version and npm/Bun mismatch in the
authoring loop are concrete misses that all guide and CLI tests permit.

LLP 0194's generated API reference addresses programmatic symbols and call
shapes, but does not by itself cover the shell/CLI surface.

## Ask

Add a non-executing, source-bound verification class for shell and CLI examples.
It can validate commands against generated help/dispatch metadata, bind version
claims to `published-closure.json`, and bind starter commands to the template's
declared package manager. Commands that are intentionally schematic or unsafe
to execute should remain illustrative, but with an explicit reason rather than
an unchecked default.

## Acceptance

- A documented Snapback command, subcommand, or flag that does not exist makes
  the guide check fail.
- Publication-version and canonical package-manager examples are sourced from
  their authoritative records.
- Placeholder-bearing, destructive, credentialed, or long-running examples are
  validated structurally without being executed.
- Exceptions carry a machine-readable class and reason.
- Regression fixtures prove the checker catches a nonexistent flag and a stale
  closure/package-manager fact.

