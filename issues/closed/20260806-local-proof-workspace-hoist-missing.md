# Canonical local proof omitted its root workspace hoist

**Status:** Closed — fixed forward 2026-08-06
**Opened:** 2026-08-06
**Systems:** CI, JavaScript workspaces, Drift-gate fixtures
**Related:** LLP 0010, LLP 0175, GitHub Actions run `31142327486`, PR #18

## Failure

The keep-going proof reported two failures in `drift-prone-gate-fixtures`.
Both stopped before their assertions because the disposable-clone setup tried
to enumerate `node_modules/@expo`, which was absent after the canonical
runner's ordinary Bun install.

## Attribution

The committed-history drift fixtures landed in `a18a1556e6` and correctly
classify missing prepared dependencies as infrastructure rather than stale
records. Their setup assumed the root workspace links already existed. Bun
1.3 installs workspace links in dependent package directories, while the
repository's coded `scripts/ensure-workspace-hoist.mjs` step had only been
invoked later by individual React and Expo package suites.

## Resolution

Canonical CI now runs the idempotent workspace-hoist script immediately after
the frozen Bun install. The drift fixtures still fail closed when dependencies
are genuinely unavailable; the proof runner now supplies the repository's
declared root workspace layout before those fixtures execute.
