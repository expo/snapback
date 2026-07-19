# Server start without a controlling terminal fails obscurely unless --ready-file is passed

**Status:** Closed
**Severity:** P3
**Systems:** CLI, Auth, Testing, DX
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-18
**Related:** src/cli.rs (emit_impersonation_capability_to_controlling_terminal); demos/_kit/server-process.mjs; demos/cursors-web/tests/acceptance/react-browser.mjs; demos/shindig/tests/acceptance/react-browser.mjs (diary 0015)
**Marker:** impersonation-capability, ready-file, tty, spawn, acceptance-harness

`cargo run -- --port N --memory` spawned with `stdio: 'ignore'` (no
controlling terminal) dies at startup with:

    Error: failed to emit impersonation capability to the controlling terminal
    Caused by: Device not configured (os error 6)

because without `--ready-file` the process-bound impersonation capability has
nowhere safe to go. That fail-closed choice is right; the failure mode is
not discoverable. The kit's `startServer` always passes a ready-file so
harness users never see it, but any suite or script that hand-spawns the
binary hits it cold — shindig's browser acceptance did, and
`demos/cursors-web/tests/acceptance/react-browser.mjs` `spawnApi()` uses the
same ready-file-less spawn shape and looks like it would now fail the same
way on a fresh checkout (worth re-running/fixing alongside).

**Done when:**

- The error text tells the operator what to do: pass `--ready-file <path>`
  (capability goes to the owner-only sidecar) or run with a terminal; ideally
  it also names the third option if one exists (an explicit opt-out flag for
  environments that do not need impersonation).
- `cursors-web`'s browser-acceptance `spawnApi` is audited/fixed to pass a
  ready-file (shindig's already does).
- A doc line lands wherever hand-spawning is taught (guide operating page or
  demo READMEs that show `cargo run -- --port ...`).

## Resolution

Closed 2026-07-18. The fail-closed startup error now tells non-terminal
launchers to pass `--ready-file <path>` and explains the owner-only capability
sidecar. Both cursors-web browser launchers now create a private temporary
ready-file location and clean it up, and the acceptance guide records the
requirement. A direct no-TTY smoke test pins the actionable error text.
