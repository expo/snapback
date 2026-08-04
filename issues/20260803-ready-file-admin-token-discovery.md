# Ready-file host ops miss database-named admin-token siblings

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
