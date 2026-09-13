# Snapback 4: deploy against a running `serve` splits `/schema` from the engine

Status: Closed
Priority: P1
Date: 2026-09-13
Systems: `deploy` / `rollback` / `serve`, store activation identity
Author: Grok 4.6 (comprehensive review of origin/main `f9bf18f0e`)
Related: [LLP 3000.000](../../llp/3000.000-atomic-schema-and-release-activation.research.md) (remaining: what `deploy` promises to an already-running `serve`)

## Problem and reproduction

`deploy` / `activate` write a new generation into the shared `store.sqlite` and print that `serve <dir>` runs it. They do not restart or signal an already-running `serve`. That process keeps the previous `bound` / `generation` in memory.

Probe: deploy 1, `serve`, deploy 2 with a new query. Live `GET /` and `GET /schema` still reported generation 1 and the old program list. `GET /changes` returned 500 `E_GENERATION: the store adopted another backend; reopen this engine` (`Store::transaction` identity check). Devices that bootstrap from `/schema` therefore get IR the engine will no longer run.

`dev` re-adopts on save. `serve` does not. `run` / `test` without `--fixture` open the same `.snapback4/` store, so a concurrent `dev` can desync the same way.

## Implementation locations

- [snapback4/crates/snapback4/src/verbs/releases.rs](../../snapback4/crates/snapback4/src/verbs/releases.rs)
- [snapback4/crates/snapback4/src/serve.rs](../../snapback4/crates/snapback4/src/serve.rs)
- [snapback4/crates/snapback4-core/src/store.rs](../../snapback4/crates/snapback4-core/src/store.rs) (`transaction` identity check)

## Suggestion

Refuse `deploy` if the store is live (lock/pid), or have `serve` reopen on `E_GENERATION` / the release pointer. The success line should name the next action: restart the running server.

## Resolution — 2026-09-13

`serve` now holds an advisory deployment lock for its process lifetime.
`deploy` and `rollback` acquire that same lock before inspecting or changing
activation state and refuse with an actionable message while the deployment
is live. This preserves the existing immutable-release process model and makes
a successful activation mean that no running server still advertises the old
generation.

The release-host regression starts release 1, attempts both deploy and
rollback, verifies both exit 1 and leave the metadata, rows, indexes and
generation history unchanged, then checks the live `/schema` still exposes
release 1. After the server exits, the same deploy succeeds and activates
release 2. The combined focused host run passes all 18 reported tests.
