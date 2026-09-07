# snapback2: `reset` does not clear the template's static seed rows, and `dev`/`reset` have no `--help`

**Date:** 2026-09-07 · **Area:** snapback2 CLI / chat template · **Source:** Clique full run, muse-snapback2 lane (diary M1), grok-snapback2 (M1: dev seed personas occupy fixture handles)

- `snapback2 reset` did not clear the chat template's static seed rows; only deleting
  `store.sqlite` gave a fresh store. The builder called the dev/reset lifecycle "undiscovered
  (no --help; reset's actual effect unclear)" and there is "no documented fresh-instance story"
  (it used separate project directories for the scale replay).
- The template's dev personas occupy handles the fixture pack uses (`alice`), blocking real
  signup until renamed (grok M1).
- `snapback2 reset` semantics matter more than they look: the owner is the unit of isolation, the
  asset staging ceiling is per owner, and a reset that leaves rows behind makes "fresh" ambiguous.

## Proposed

1. `reset` clears everything the owner holds, including template seeds and staged assets, or
   documents exactly what it keeps; `--help` on every verb.
2. A fresh-instance recipe on the guide's dev-loop page (second project directory, or a
   `--store` flag) for scale replays and parallel proofs.
3. Namespace the template's dev personas so they cannot collide with an app's real handles.
