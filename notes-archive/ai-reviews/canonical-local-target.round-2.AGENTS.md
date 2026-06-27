# Review: LLP 0002 Canonical Local Dev/Test Target, Round 2

**Reviewed:** 2026-06-25
**Reviewer:** Codex
**Target:** `llp/0002-canonical-local-target.decision.md`

## Overall Assessment

LLP 0002 remains a sound Decision LLP. The canonical local target is the right
default for agent build-run-validate loops, especially now that LLP 0003 defines
the local Rust server core and LLP 0004 defines the app-facing data API to
exercise there first.

## Strengths

- The decision prevents environment drift for early agents and reference apps.
- It correctly treats local success as necessary but not sufficient for
  Postgres, Cloudflare, or other deployment profiles.
- It keeps room for additional standard targets.
- It ties the local target to Valet's empirical risk.

## Concerns

1. `Status: Draft` is still appropriate unless Charlie formally ratifies the
   decision.
2. The exact one-command bootstrap and CI/headless target are still undefined.
3. The local target must validate the app-facing API, not just server startup.

## Suggestions

- Keep `Status: Draft` until ratified.
- Define the start/reset/seed command soon after the first server crate exists.
- Make CI exercise schema load, function load, `ctx.db`, generated client calls,
  and live query delivery.

## Open Questions

- What exact command starts the canonical local target?
- Which host OSes must CI support?
- How should the local target represent auth, assets, and notifications before
  those subsystems exist?
- Which Cloudflare profile becomes the second standard target?

## Revisions Applied

- Added LLP 0004 to `Related`.
- Added a consequence that the application data API should be validated on this
  target first.

The LLP process also recommends a GPT review unless this Codex review is the GPT
review wanted for this round.
