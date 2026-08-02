# 0137 G1: clean `snapback dev` shutdown orphans the dev.ready.json.secret-read-root sidecar

**Status:** Resolved
**Date:** 2026-08-01
**Resolved:** 2026-08-01
**Source:** LLP 0137 Stage 1 (G1 package qualification), external-consumer smoke arm
**Finding record:** `demos/improvement-sweep/arms/g1-public-package-qualification/findings/0137-g1-f5-orphaned-secret-read-root-sidecar.json`
**Governing:** LLP 0017

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

## Resolution (2026-08-01, 0137 between-arms fix lane)

Took the ticket's first option: the secret-read proof root is
descriptor-scoped custody and is now removed with the descriptor rather than
moved into the reattach family. `ReadyFileTarget` (src/cli.rs) adopts the
resolved `P.secret-read-root` sibling's identity at startup
(`adopt_secret_read_root_sibling`) and removes it identity-guarded
(`remove_secret_read_root`) at the explicit serve-shutdown site — alongside
the impersonation sidecar and the descriptor — and in the `Drop` guard so a
startup failure or task abort cannot orphan it either. A foreign inode
swapped in at the sidecar path is never removed (same custody rule as the
impersonation sidecar).

Regression tests:

- `tests/host_ops_v0.rs` `p6_secret_read_root_sidecar_does_not_survive_descriptor_custody`
  (serves in-process with a ready file, confirms the sidecar appears, then
  drops the serve future and asserts the sidecar is gone). Verified to FAIL
  against the pre-fix teardown (with the Drop-guard removal absent, the
  sidecar survives and the assertion trips).
- `src/cli.rs` `secret_read_root_cleanup_removes_only_the_adopted_identity`
  (identity-guarded custody semantics, foreign-inode survival).

LLP 0017 (§the serve/mint bridge bullet) now documents the custody split:
`P.*` sidecars are descriptor-scoped and removed at teardown; `<db>.*`
(admin token, resume keyring) remain reattach-by-design. The packaged-CLI
lifecycle rerun (this ticket's acceptance witness) remains with the G1 arm's
next pass — the packaged closure picks the fix up at the next release cut
(0.1.7 stays the arms' pinned baseline).

### 2026-08-02 CI follow-on

The four-thread Linux suite exposed immediate inode-number reuse in the unit
witness: unlinking the adopted sidecar and creating a replacement could assign
the replacement the same `(device, inode)` pair, making an identity-only guard
delete the foreign file. `ReadyFileTarget` now retains an open handle to the
adopted sidecar until teardown, so its inode cannot be reused while cleanup
custody is live. The exact foreign-replacement unit witness and the higher-level
G1 lifecycle witness both pass; LLP 0017 records the strengthened mechanism.
