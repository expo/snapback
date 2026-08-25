# Lane work must survive a build-host reboot

Status: open
Date: 2026-08-25
Systems: fleet operations
Related: issues/20260824-linux-build-hosts-for-snapback-crates.md,
  issues/20260824-lane-staleness-is-a-second-gate.md

## What happened

The EPYC build host (`expo-build-1000`) auto-rebooted for an unattended kernel upgrade,
6.8.0-136 → 6.8.0-138, while nine agent lanes were mid-round. Every codex process died and `/tmp`
was cleared, taking every lane log and every pending report with it. Uptime read `0 min`; this was a
scheduled upgrade, not a crash and not disk exhaustion.

It is worth distinguishing from the failure mode this fleet has seen before: `No space left on
device` kills lanes too, but leaves the machine up and the logs readable. A reboot takes the logs.

## What survived, and why

Git state lives on disk and survived intact. Two lanes had **committed before dying** and lost
nothing but their reports — five rows of finished work (F240, C013, F100, F101, F102) were recovered
directly from their commits. Three lanes had only working-tree changes: 58, 30 and 14 files. Those
were recoverable but were one power event away from gone.

Nothing was lost that mattered, but that was luck about *when* the reboot landed, not design.

## The two practices that made recovery cheap

1. **Commit lane work as soon as it exists, from the supervisor.** Codex lanes in this fleet cannot
   write git metadata (`index.lock: Operation not permitted`), so they accumulate uncommitted work
   indefinitely unless the supervisor commits it for them. A rescue commit should say plainly that
   it is unbuilt, ungated, and must not land as-is — otherwise it looks like reviewed work later.
2. **Keep every dispatch brief in local scratchpad, not only on the host.** All nine lanes were
   re-dispatched within a minute of diagnosis because their briefs existed locally. Had they lived
   only in the host's `/tmp`, each would have had to be rewritten from memory — and rewritten briefs
   are not the same briefs, which quietly changes what a lane was asked to do.

## What did not work

`Unattended-Upgrade::Automatic-Reboot` is already commented out in
`/etc/apt/apt.conf.d/50unattended-upgrades` (so it defaults to false), meaning the reboot came from
somewhere else — provider-initiated, or another mechanism acting on `/var/run/reboot-required`.
Pinning it explicitly needs root and there is no passwordless sudo for the agent account, so that
mitigation is unavailable from inside a session.

Since the reboot cannot be reliably prevented from where we sit, the design has to assume it. A
reboot should cost **one round**, not a session.

## An unexpected benefit worth noting

The reviewers dispatched after the reboot are reading their commits **cold**, because the lanes'
self-reports were destroyed. They are explicitly told to treat each commit message as a claim rather
than a record. That is arguably a stronger review than one primed by the implementer's own account
of what it did — and it is worth considering whether review briefs should withhold the lane's report
by default.
