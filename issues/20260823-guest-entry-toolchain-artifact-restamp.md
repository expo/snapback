# Guest-entry toolchain artifact re-stamp

Status: Open

The guest-entry codegen change alters repo-owned toolchain bytes whose isolated
evaluation is bound into each application's `inputsHash`. Under LLP 0157's
toolchain-stable activation-identity amendment, authored-source identity can
remain stable while the current toolchain still derives different generated
artifact bytes. In this change, that rotation also changes generated
`authorization-review.json` facts and the associated manifests and artifact
inventory across the roughly 27-app demo fleet.

Author ruling 2026-08-23: land guest entry now and defer this cross-application
re-stamp. The guest-entry landing therefore restores all incidental
`demos/**/generated*` changes to `origin/main` while retaining the generated
guide, diagnostics, client-lifecycle, codegen, and package outputs intrinsic to
the guest surface. `scripts/check-generated-artifacts` is intentionally red on
`main` until this follow-up regenerates the complete app projections and
updates any Rust or other served-artifact pins coherently with the regenerated
fixtures. A pin must never be advanced independently of the fixture it serves.

Affected demo roots in the 2026-08-23 inventory are:

- `access-desk`
- `all-aboard` (including `tests/egress-probe`)
- `browser-local-first` (both `snapback` and `snapback-sessions`)
- `campfire`
- `card-game`
- `catalog-lens`
- `chirp`
- `competitive-checkpoint`
- `cursors-web`
- `dispatch-board`
- `file-drop`
- `fleet-observatory-move1`
- `graffiti`
- `knockoff`
- `latency-kanban`
- `messaging-snapback`
- `partiful-matrix`
- `party-wall`
- `pointing-room`
- `public-dashboard`
- `pulse-monitor`
- `rbac`
- `shindig`
- `signal-desk`
- `team-chat`
- `todo`
- `todo-v2` (both local and `generated-remote-service` projections)
- `triage-graph`
- `zero-bakeoff/apps/contention-calendar`

The follow-up must use a qualified binary from its checkout, regenerate every
affected app projection as one coherent toolchain rotation, update all served
artifact pins from those exact regenerated fixtures, and make
`scripts/check-generated-artifacts` green without modifying guest security
semantics. It must land before any publication or promotion whose qualification
depends on generated-artifact freshness; ordinary landing deferral does not
weaken the LLP 0189 publication/promotion gates.
