# Watch creation preflight holds the managed writer across caller-controlled DNS

Status: Open — pre-existing; same family as the unbounded-Local-wait property
Created: 2026-08-22
Related: issues/shelved/20260822-permits-pin-logout-on-unbounded-local-wait.md

Both reviewers of the watch-creation fix raised this; they split on severity, and the split
resolves once you ask what is *introduced*.

## The path

`POST /watches` runs preflight inside `with_snapback`
(`crates/snapback-server/src/server.rs:26294`), which acquires the global writer mutex
(`crates/snapback-server/src/server/writer_gate.rs:78`). Inside it, preflight performs blocking
`ToSocketAddrs` on a caller-supplied webhook hostname with no application timeout
(`crates/snapback-engine/src/local/engine.rs:23640`, `crates/snapback-services/src/webhooks.rs:81`)
and the initial live-query JS handler (`engine.rs:23690`).

Production `/auth/logout` must itself take `with_snapback` to plan the logout
(`crates/snapback-server/src/server.rs:17289`) **before** it reaches terminal premark (`:17305`).
So a hung DNS lookup stalls logout on Local.

## Why it is not a regression

Before the split-phase migration, watch creation performed the same DNS and JS inside the same
single `with_snapback` turn. It held the managed writer then too. The migration briefly made things
worse by additionally holding the authority *permit* across that work; the follow-up fix removed
the permit hang by moving prework into preflight. What remains — the writer being held across
caller-controlled DNS — is the original behaviour.

The five-second reacquisition timeout added by the fix covers only the **second** writer
acquisition, after preflight, so it does not bound this path.

## Fix direction

Resolve DNS off the writer, or bound it with an application timeout. The permit-after-preflight
split introduced by the fix is correct and should be kept.

Bounding it interacts with the deadline-aware Local capsule in
`issues/shelved/20260822-permits-pin-logout-on-unbounded-local-wait.md`; both are about not letting
caller-controlled or unbounded work sit on a resource logout needs. They should be solved with one
approach rather than two.

## Note on severity

One reviewer called this High and blocking, the other a suggestion. Both were right about the
mechanism. The disagreement is whether a pre-existing hang path should block a change that
strictly reduces the hang surface. It should not — but it should be recorded rather than lost,
which is why this exists.
