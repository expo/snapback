# Guide gap: generated default acceptance does not boot or drive Snapback

**Status:** Open
**Impact:** 5
**Urgency:** 4
**Ease:** 4
**Confidence:** 5
**Systems:** Guide, Scaffolds, Acceptance, Agent operation
**Date:** 2026-08-04
**Governing:** LLP 0010, LLP 0024, LLP 0041, LLP 0061

## Problem

The acceptance guide defines the required surface as a headless suite that
boots a real server, loads real generated artifacts, and drives a product
client. It also promises vacuous-pass protection.

Generated defaults do something weaker:

- `todo-contract` maps `test` to `acceptance.mjs`, which only checks two
  generated JSON facts.
- The paved React template maps `test` to a static `acceptance.mjs` that checks
  generated files and regexes the *source* of `acceptance.live.mjs`.
- React's real handler execution is a separate opt-in `test:live` script.

Both default tests exit 0 under PTY, closed stdin, and held stdin without ever
starting a server or invoking a function. The word "acceptance" and default
`test` script therefore provide a silent false done-oracle.

## Proposed fix

Make the default generated acceptance command run the live, isolated path and
emit a structured receipt that attests:

- owned server lifecycle and ready descriptor;
- loaded artifact identity;
- at least one real query and mutation/action as applicable;
- non-zero declared check count and cleanup result.

Keep static artifact/source checks, but name them `test:static` and do not let
them satisfy the guide's acceptance requirement. Add an explicit guide
sentence distinguishing static scaffold coherence from runtime acceptance.

The stronger long-term artifact is a common scripted verb/receipt rather than
per-template prose recipes.

## Evidence

- `guide/testing/acceptance.md` — required headless-first contract.
- `packages/snapback-cli/templates/todo-contract/acceptance.mjs`.
- `packages/snapback-cli/templates/react/acceptance.mjs` and
  `acceptance.live.mjs`.
- `/tmp/snapback-unattended-audit.7qbgiS/unattended-audit.md` — A/B/C results.
