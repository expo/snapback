# Snapback 4 fence: privileged event-trigger tampering during activation

**Status:** Open (design question)
**Opened:** 2026-10-24
**Area:** `engine/postgres/managed_relations.rs`, activation/evolution, `engine/postgres/pipeline_tests.rs`
**Related:** closed `20261024-snapback4-managed-relation-fence-corners.md`; FF1/FF2 (`ec032939d9`, `adbb3cd178`)

FF1/FF2 refuse foreign triggers, rules, RLS and constraints on managed and
TEMP activation relations at open, reconnect, doctor and twice per
activation. Each review round since has found one more corner reachable only
by a role that installs a `ddl_command_end` event trigger which rewrites
Snapback's activation DDL as it runs. The latest (Sol, on `adbb3cd178`):

1. **TEMP view redirection (P1).** The TEMP selector admits views and their
   `_RETURN` rule. An event trigger can replace `_evolution_restored` with an
   auto-updatable TEMP view over a differently named TEMP heap and attach the
   deleting trigger to that heap, which neither check inspects. Restoration
   can again lose both live and dormant copies.
2. **Cached-path wire witness (P2).** The PIPE overlap witness drives
   `independent`; composed reads use `independent_cached` with a separate
   custody lock. Run the relay scenario through warmed cached statements.

Decision needed: catalog inspection cannot close the class against a role
that runs event triggers. Options: (a) refuse activation while any enabled
`ddl_command_start`/`ddl_command_end`/`sql_drop`/`table_rewrite` event trigger
exists unless allowlisted by the operator (`SNAPBACK4_...` or doctor
acknowledgement); (b) disable event triggers for the activation session
(`SET session_replication_role` needs superuser); (c) document privileged
event triggers as outside the fence, like runtime DDL. Item 1 also needs a
cheap fix regardless: reject non-heap (`relkind <> 'r'`) scratch relations.
