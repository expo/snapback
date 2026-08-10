# Minted admin token on stdout: deliberate, with a capture residue worth naming

**Status:** Resolved
**Impact:** 2
**Urgency:** 1
**Ease:** 4
**Confidence:** 5
**Systems:** CLI, Admin authority, Developer experience
**Date:** 2026-08-04
**Related:** ENG-23443, `llp/reviews/0171-authoring-loop-parity.claude.md`
(round-1 concern #10)

## What was flagged, and what is actually true

A round-1 review of LLP 0171 flagged that the server's ready output "puts the
admin URL and token file path on a stream designed to be captured." Checked
against source: the behavior is real and **deliberate**.

`src/cli.rs:5163-5173` (and the parallel path at `:5468`):

```rust
} else if let Some(minted) = &minted_token {
    // The minted-token surfacing (ENG-23443): the value is printed on the
    // start that minted it; afterwards the 0600 file is the capability
    // hand-off — reading it as this user is what local admin means.
    println!("admin: writes require the minted local admin token (SNAPBACK_ADMIN_TOKEN unset)");
    if minted.fresh {
        println!("admin token: {}", minted.token);
    }
    if let Some(file) = &minted.file {
        println!("admin token file: {}", file.display());
    }
```

The exposure is already narrow by construction:

- the token value prints **only** when `minted.fresh` — the start that minted it;
- a **non-loopback** bind takes the other branch and disables admin entirely
  ("admin: DISABLED on this non-loopback bind");
- afterwards the 0600 file, readable as the owning user, is the hand-off.

So this ticket does **not** propose reverting ENG-23443. It records the residue
so the next reviewer does not re-litigate it from scratch.

## The residue

"The start that minted it" is exactly the start a developer or agent captures.
Observed in this session without trying: the token landed in
`/tmp/warble-backend.log` via an ordinary `nohup … > log 2>&1`, and from there
into an agent transcript. Log files, CI artifacts, tmux scrollback, and shared
agent sessions all retain it, and none of them inherit the 0600 protection the
design relies on.

The bound that makes this acceptable — loopback-only — is the same bind-derived
inference that
[`issues/20260804-tunnelled-loopback-server-keeps-dev-profile.md`](./20260804-tunnelled-loopback-server-keeps-dev-profile.md)
shows does not survive a front. A tunnelled loopback server is reachable
publicly while still on the loopback branch that prints the token.

## Options, cheapest first

1. **Do nothing; document it.** State in the guide that the first-start line
   contains a credential and should not be piped into retained logs.
2. **Print a pointer, not the value.** Emit only the token-file path on fresh
   mint; make the value available through an explicit read (`snapback admin
   token --show`). Costs one command in the first-run flow.
3. **Suppress the value when stdout is not a TTY.** Cheap, and directly targets
   the capture case, at the price of a less obvious first run in scripted
   environments.

Option 2 or 3 would also remove the interaction with the tunnel ticket above.

## Resolution (2026-08-10)

Implemented option 3 with the ticket's pointer preference. The ordinary serve
path and auth-collision recovery path now share one hand-off formatter. A fresh
token value remains visible when stdout is a TTY, preserving first-run
interactive DX. When stdout is captured, the value is never rendered: if an
owner-only token file exists, output points to the file line below; for a
memory-only start with no file, output says to restart from a TTY or configure
`SNAPBACK_ADMIN_TOKEN` explicitly.

Pure CLI tests exercise interactive, captured-with-file, and captured-without-
file rendering and assert that the secret is absent from both captured forms.
LLP 0017's security-defaults text now records the narrower surfacing rule.

## Resolution — 2026-08-10

Option 3 (suppress when stdout is not a TTY): fresh token values remain
visible on an interactive terminal; captured/piped stdout gets a pointer line
instead of the token, so logs, CI artifacts, and scrollback no longer retain
it. Decision + tests recorded; the tunnelled-exposure caveat is documented on
the serving-posture page (landed separately today).
