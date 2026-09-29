# Snapback 4: evaluating a Node 26 pin, and the guard that currently blocks it

**Opened:** 2026-09-29, from provisioning the Apartment 101 M5 Pro mini (`100.64.36.16`) for Snapback 4 work at Charlie's request ("use volta ... or upgrade this project to node 26 or both")
**Severity:** Low: the project stays pinned to Node 24.18.0; this records what a bump needs
**Area:** `.node-version` (24.18.0), `snapback4/package.json` (`engines.node >=24`, `packageManager bun@1.3.12`), `snapback4/packages/snapback4/test/routes.test.mjs`
**Status:** Open; no owner until a bump is wanted

The mini now carries both Node majors through volta (24.18.0 default, 26.10.0
available as `volta run --node 26 …`), bun 1.3.12 beside 1.4.2, the codex
CLI, wasm-bindgen 0.2.127, Playwright Chromium and Xcode 27.0, with
`~/.snapback-env.sh` putting the pinned toolchain first (sourced from
`~/.zshrc`). The full `snapback4/scripts/test.sh` ran there twice on the
presence branch at `1c48df2d88`:

| Node | Result | Failures |
|---|---|---|
| 24.18.0 | `== 1 failure(s) in 4280 s` | `snapback4-lang::clique_03` only |
| 26.10.0 | `== 2 failure(s) in 3968 s` | `clique_03` and the client tests (13 in `routes.test.mjs`) |

Both runs shared the host with the office session's native-proof builds
(load 36 to 95). Rerun quiet (load under 3):

- `clique_03` passes (3 of 3). Its two failures were ratio measurements
  (`measure.rs:38` reader ratios, `:204` celebrity write ratio 5.5 over 3),
  the class of test that host contention breaks and that lane MT made
  host-tolerant for the suite's wall-clock cases; the ratio cases are not
  yet tolerant. Not a Node issue.
- `routes.test.mjs` passes 13 of 13 under Node 24 and fails 13 of 13 under
  Node 26 on a single explicit assertion, `run route HTTP witnesses with
  pinned Node 24` (`expected: /^24\./`). It is a pin guard, not an
  incompatibility, and it prevents the suite from saying anything else
  about Node 26.

What a bump to 26 needs, in order: change the guard's expectation and the
three pins together (`.node-version`, `engines`, the volta images on the
black M5 and the office M1 that publication and qualification use); run the
full suite under 26 on a quiet host (the mini is set up for it); then the
publication kit on the M1, whose `pubstep.sh` puts volta's 24.18.0 image
first on `PATH`. Until then every host must keep 24.18.0 as the default,
which the mini does.

Separately, the `clique_03` ratio cases could take the same host-tolerance
treatment as MT's wall-clock cases, so a loaded host reports a skip with the
measured ratios rather than a failure.
