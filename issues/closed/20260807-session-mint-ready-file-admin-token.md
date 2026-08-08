# session mint --ready-file still demands SNAPBACK_ADMIN_TOKEN env

**Status:** Closed (2026-08-08)
**Impact:** 2
**Urgency:** 2
**Ease:** 4
**Confidence:** 4
**Systems:** CLI, Auth, Developer experience
**Date:** 2026-08-07
**Related:** Diary 0068 (four-lane measurement, 0.1.13)

`snapback session mint --ready-file <path>` refuses without
`SNAPBACK_ADMIN_TOKEN` in the environment even though the ready-file's
sibling admin-token discovery (the 20260803-ready-file-admin-token ticket's
convenience path) could supply it. Extend the same discovery to `session
mint`. Acceptance: minting works from a ready file alone in a dev loop.

- **Claimed 2026-08-08:** session 86767887 (the diary-0068 orchestrator) is executing this ticket now; sibling sessions should not duplicate.

## Resolution (2026-08-08)

Root cause: generic ready-file host-op targeting (`post_host_op` →
`resolve_http_target_for_operation`) discovered the minted admin token only
at the READY-FILE-named sibling (`admin_token_sibling(ready_file)`), but a
file-database server persists it at the DATABASE-named sibling
(`<db>.admin-token`, which the descriptor's `adminTokenFile` declares). So
`session mint --ready-file` — and every other ready-file host op, e.g.
`inspect` — went out tokenless and the server refused with
`SNAPBACK_ADMIN_TOKEN_REQUIRED`.

Fix (src/cli.rs): the per-database-mode expectation the admin-console
discovery already established (`discover_admin_console_token`) is now the
single shared `expected_minted_admin_token_path` helper — `file` mode →
database-named sibling, `memory` mode → ready-file-named sibling, anything
else refused — and `discover_minted_token` /
`discover_minted_token_pinned` ride it. The pinned variant keeps the
console path's read posture exactly: descriptor-pinned
`read_owner_only_sibling` when the token is a ready-file-parent sibling,
`secure_file::read_owner_only` (validated inode, owner-only repair)
otherwise. Precedence is unchanged: explicit `--token`, then
`SNAPBACK_ADMIN_TOKEN`, then discovery.

Evidence:

- Unit/regression tests (src/cli.rs):
  `session_mint_ready_file_attaches_file_database_minted_admin_token` (the
  outgoing host-op carries the discovered token header),
  `minted_token_discovery_uses_file_database_sibling_across_and_within_directories`,
  `minted_token_discovery_refuses_nonmechanical_file_database_path`,
  `minted_token_discovery_repairs_permissive_file_database_sibling_like_the_console_path`,
  `minted_token_discovery_keeps_memory_ready_file_sibling`.
- Live acceptance, `SNAPBACK_ADMIN_TOKEN` unset and no `--token`: a
  sessions-mode server (rbac startup artifacts) minted a real Bearer
  session via `snapback session mint --ready-file <path> --email
  dev@example.com` → `ok: true`, `issuedBy: admin`; and the previously
  refused `snapback inspect --ready-file <path>` baseline
  (`SNAPBACK_ADMIN_TOKEN_REQUIRED`) now succeeds.

This also lands the close conditions of
issues/20260803-ready-file-admin-token-discovery.md (closed together).
