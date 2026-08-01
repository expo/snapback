# 0137 G1: clean `snapback dev` shutdown orphans the dev.ready.json.secret-read-root sidecar

**Date:** 2026-08-01
**Source:** LLP 0137 Stage 1 (G1 package qualification), external-consumer smoke arm
**Finding record:** `demos/improvement-sweep/arms/g1-public-package-qualification/findings/0137-g1-f5-orphaned-secret-read-root-sidecar.json`

## Observation

With the public 0.1.7 closure, a clean `snapback dev snapback` shutdown
(stdin close, exit 0) removed `.snapback/dev.ready.json` and its
`.impersonation` sidecar, released the port, and left no processes — but
orphaned `.snapback/dev.ready.json.secret-read-root`: a `0600` file holding
a 70-character token-like value (not a path, not JSON) named after and
bound to the now-deleted ready descriptor.

`dev.sqlite3.admin-token` and `resume-keyring.json` also persist, which is
defensible reattach-by-design custody (the attach path reads the managed
owner token). The secret-read-root sidecar is different: its identity is
the ready file's, so surviving the ready file looks like a missed teardown
step. Owner-only perms and app-local placement keep this out of Stop
territory (retention, not exposure).

## Proposed fix

Remove every `dev.ready.json.*` sidecar atomically with the descriptor on
shutdown. If secret-read-root must outlive a session, move it into the
reattach family (`dev.sqlite3.*`) and document its custody like the admin
token's.

## Acceptance witness

Rerun of the G1 lifecycle script
(`demos/improvement-sweep/arms/g1-public-package-qualification/evidence/lifecycle.json`
records the current behavior) shows no `dev.ready.json.*` files after clean
exit; a packaged-CLI test pins it.
