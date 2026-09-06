# snapback2: abandoned uploads exhaust an account's asset staging quota with no published recovery path

**Date:** 2026-09-06 · **Area:** snapback2 assets (LLP 1006) / operator surface · **Source:** Clique full run, astra-snapback2 lane (diary "Continued session and final accumulated-state limitation", final report)

Distinct from `20260906-snapback2-owner-asset-staging-ceiling-refuses-reseeds.md` (the ceiling is
too small for the fixture pack). This ticket is about the ceiling being **unrecoverable**.

## What happened

Repeated proof runs accumulated failed and abandoned uploads against one persona's staging
allowance (the builder reports hitting a 20-object ceiling for that account). After that:

- media-dependent writes **timed out** on the client rather than refusing fast with a diagnostic;
  the intents never committed;
- a normal owner restart did not reclaim the abandoned staging objects;
- the published surface offers no discard, sweep, or list-staging verb, so the builder could not
  reclaim quota without editing internal storage (which it correctly refused to do);
- the lane therefore aborted final validation of four milestones (M1/M2/M5/M6) even though its
  historical receipts were green. Its words: "an operational recovery gap as well as a reminder
  that repeated proof attempts can create state a small initial build never reaches."

## Proposed

1. Sweep abandoned staging on owner start (anything staged but not attached within a TTL).
2. A published verb to list and discard staged objects for an account (`snapback2 data assets
   staging --discard` or equivalent), and a client-side discard for a failed upload.
3. A fast refusal with a stable code when staging is full instead of a write that never settles.
4. A test: fill staging with abandoned uploads, restart the owner, assert the quota is reclaimed.
