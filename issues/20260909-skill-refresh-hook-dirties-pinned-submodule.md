# Skill refresh hook dirties an otherwise clean checkout

Status: Open
Date: 2026-09-09
Scope: repository checkout/merge hooks; follow-up discovered during Clique correction landing

## Reproduction

On 2026-09-10 at approximately 02:40 UTC, a clean control `main` fast-forwarded
from `78b9b7762` to `fe80a59e7`. The incoming commit only updates scheduled
backstop tickets. Its recorded `vendor/llp` gitlink remains
`384e8f32383db2dd5b02098e3838974f7de695a4`.

The active `.githooks/post-merge` invokes `scripts/sync-agent-skills --quiet`.
That script defaults to `fetch=1` and uses `git submodule update --init --remote`.
The hook checked out upstream LLP `5dd8a033c125e95ccc2536e734afdc924de7d094`,
leaving ` M vendor/llp` in the otherwise clean root checkout. The submodule
itself had no edits. Restoring its recorded gitlink with a non-forced detached
switch returned `main` to a clean state, exactly equal to `origin/main`.

## Proposed correction and verification

Automatic checkout/merge synchronization should initialize the recorded pins
(the existing `--no-fetch` mode), leaving upstream upgrades to an explicit
update workflow that intentionally commits the new gitlinks. Verify both hooks
with a remote submodule branch ahead of the superproject pin and preserve dirty
submodule edits rather than resetting them.

No hook implementation is changed by the Clique correction program. This is a
separate workflow follow-up, not one of its eight product findings.
