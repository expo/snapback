# Explain and simplify scaffold proof scripts

**Status:** Open
**Impact:** 3
**Urgency:** 4
**Ease:** 4
**Confidence:** 5
**Systems:** Templates, CLI, Guide, Developer experience
**Date:** 2026-08-19
**Governing:** LLP 0041 Templates, LLP 0196 T3/T4, LLP 0259, LLP 0294 W1

## Problem

Fresh scaffolds expose `prove`, `test`, `test:static`, `test:live`, and several
`carry:*` scripts. The start packet explains `prove` and the carriers, but does
not give the whole taxonomy beside the actual script list. A user reasonably
read “prove” as formal verification and could not determine whether `test`,
`prove`, or a carrier was the strongest or most ordinary command.

The current semantics are non-obvious:

- `prove` is the authoritative aggregate `snapback verify` command;
- `test` runs the raw runtime starter acceptance;
- `test:static` checks no-server source/generated coherence;
- `test:live` is an alias for `test`; and
- `carry:*` first accepts the `prove` receipt, then drives a carrier and writes
  non-authoritative artifacts.

## Required change

- Put a compact, generated-or-checked glossary in every scaffold README and
  start packet, derived from the real `package.json` scripts.
- State explicitly that “prove” means acceptance evidence, not formal proof.
- Decide under LLP 0196 whether `test` and `test:live` remain top-level public
  starter scripts or move behind a clearly named debugging namespace.
- Ensure `--help`, create output, README, start packet, and package scripts do
  not disagree.

## Acceptance

- A cold-agent test answers which command to run for ordinary completion,
  static checking, raw acceptance debugging, browser observation, and simulator
  observation without opening package source.
- A drift test fails when a documented script is missing or its command class
  changes.
- No carrier log or raw test output is described as a second proof authority.
- Existing automation receives a documented migration if public script names
  change.
