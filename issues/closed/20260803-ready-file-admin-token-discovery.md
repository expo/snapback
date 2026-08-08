# Ready-file host ops miss database-named admin-token siblings

**Status:** Closed (2026-08-08)
**Opened:** 2026-08-03
**Source:** Diary 0054 F0b fleet dogfood
**Systems:** CLI, readiness, host operations

## Problem

A live server started before Todo was provisioned retained bind-time
`target.appId: local-app` in its readiness descriptor. Generic
`snapback run --ready-file <path>` did not discover the owner-only admin token
at the descriptor's database-named `adminTokenFile`; the same call succeeded
when given that token explicitly.

F0b does not rely on the failing convenience path: fork creation validates that
the ready descriptor's token path is the exact fork database sibling and reads
it owner-only for schema/function loads. The generic resolver should provide
the same safe behavior without weakening startup-nonce or sibling-path checks.

## Close when

- ready-file target resolution discovers the descriptor-declared owner-only
  admin-token sibling after live provisioning;
- a stale/mismatched descriptor or token path still refuses; and
- a regression test runs a post-start manifest load followed by a token-omitted
  ready-file host operation.

## Resolution (2026-08-08)

Landed with issues/20260807-session-mint-ready-file-admin-token.md (same
mechanism, same commit). `resolve_http_target_for_operation` /
`resolve_operator_ephemeral_target` / `mint_secret_read_via_http` now
discover the minted token through the shared
`expected_minted_admin_token_path` expectation (`file` mode →
database-named sibling, `memory` mode → ready-file sibling), with the
admin-console read posture (pinned sibling read in the ready-file parent,
validated owner-only read elsewhere). Condition by condition:

1. Discovery of the descriptor-declared database-named sibling: covered by
   `minted_token_discovery_uses_file_database_sibling_across_and_within_directories`.
2. Mismatched/non-mechanical paths still refuse: covered by
   `minted_token_discovery_refuses_nonmechanical_file_database_path` (and
   non-`file`/`memory` database modes refuse in the shared helper).
3. Post-start provisioning then token-omitted ready-file host op: the
   automated stand-in is
   `session_mint_ready_file_attaches_file_database_minted_admin_token`
   (token-omitted ready-file host op against a database-named minted
   sibling); the literal load-then-operate sequence was verified live —
   a `--startup-artifacts` sessions boot followed by token-omitted
   `session mint --ready-file` (real session minted) and token-omitted
   `inspect --ready-file` (previously `SNAPBACK_ADMIN_TOKEN_REQUIRED`,
   now `ok: true`).
