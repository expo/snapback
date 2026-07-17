# Enforce private-by-default membership table reads

**Status:** Closed
**Severity:** P1
**Systems:** RBAC, Query authorization, Live queries, Retention, Codegen
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-16
**Related:** LLP 0056 §Declaring a membership table
**Marker:** security, privacy

The runtime recognizes membership tables for privileged semi-joins and closed
writes, but does not enforce the RFC's private-by-default policy when the
membership table itself is a query's primary table.

`query_on_with_storage_limit` in `src/storage.rs` validates generic query shape
and membership predicates but does not check whether `plan.table` carries a
membership declaration. The manifest has no row-visibility preset to opt into
roster exposure. A hand-built manifest can therefore declare a syncable live or
direct query over the roster and return all membership rows under only the
function's generic auth requirement. The same missing classification can flow
into retained/offline declarations.

The internal membership semi-join must continue to bypass roster visibility so
visibility rules cannot recursively disable authorization; that narrow
internal read is different from exposing the roster as application data.

**Done when:**

- An undeclared-visibility membership table is refused as the primary table of
  a syncable-live query, retained query, or generated direct reader.
- Any supported roster-visibility preset is explicit, closed, and validated at
  load time with tests for row-scoped exposure.
- Internal declaration-bound membership probes remain non-recursive and do not
  inherit application roster visibility.
- Tests prove a crafted manifest cannot enumerate another resource's roster by
  default through query, live subscribe, or retained/offline reads.
- Membership activation remains capability-gated until this default is
  enforceable on every public read surface.

## Resolution

Closed 2026-07-16. Commit `6b81e1a` made public membership reads private-by-default and
retained a separate non-recursive internal probe path in `src/storage.rs` and
`src/local.rs`; query/live/load refusal regressions are inline.
