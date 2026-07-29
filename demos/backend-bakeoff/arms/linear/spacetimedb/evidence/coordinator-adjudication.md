# Coordinator evidence adjudication

**Date:** 2026-07-28
**Scope:** Linear / SpacetimeDB cleanup evidence

The raw cleanup receipt is preserved unchanged. Its post-delete `describe`
command exited with status 2, but the retained diagnostic is the CLI usage
screen caused by invalid argument ordering; it is not a direct
database-not-found response. Therefore `postCleanup.exactTargetAbsent` is not
accepted as a direct negative database probe.

The remaining evidence is internally consistent: the target-bound plan names
the exact fresh database identity; `spacetime delete --yes` exited successfully
against that identity; only validated arm processes were stopped; both assigned
ports were observed closed; worktree-local data, CLI, log, and credential state
were removed; and the unrelated baseline was preserved.

The cleanup scenario remains PASS because the scoped delete and environment
cleanup completed, but cleanup-isolation confidence is reduced from 2 to 1.
This is an evidence-quality defect, not a Stop-class destructive-cleanup
defect.
