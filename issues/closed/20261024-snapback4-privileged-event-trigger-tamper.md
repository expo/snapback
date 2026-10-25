# Snapback 4 fence: privileged event-trigger tampering during activation

**Status:** Closed
**Closed:** 2026-10-25
**Opened:** 2026-10-24
**Area:** `engine/postgres/managed_relations.rs`, activation/evolution, `engine/postgres/pipeline_tests.rs`
**Related:** closed `20261024-snapback4-managed-relation-fence-corners.md`; FF1/FF2 (`ec032939d9`, `adbb3cd178`)

## Original finding

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

Original decision question: catalog inspection cannot close the class against a role
that runs event triggers. Options: (a) refuse activation while any enabled
`ddl_command_start`/`ddl_command_end`/`sql_drop`/`table_rewrite` event trigger
exists unless allowlisted by the operator (`SNAPBACK4_...` or doctor
acknowledgement); (b) disable event triggers for the activation session
(`SET session_replication_role` needs superuser); (c) document privileged
event triggers as outside the fence, like runtime DDL. Item 1 also needs a
cheap fix regardless: reject non-heap (`relkind <> 'r'`) scratch relations.

## Resolution — FF3 panel disposition, 2026-10-25

The orchestrator chose the privileged-code boundary with positive outcome
checks. Enabled event triggers remain legal. Doctor warns with each enabled
trigger's name, event, tags, owner, qualified function and enabled mode;
activation emits the same inventory once. Privileged event triggers and
superuser DDL hooks that rewrite activation DDL/movement semantics are outside
the supported contract, documented in the deploy guide and RFC §6.

For the observable class, activation admits managed and TEMP movement relations
after installer/scratch DDL and immediately before COMMIT: captured OIDs must
remain plain heaps owned by the activation role, with no foreign interception
under the existing predicate. Managed-name TEMP shadows refuse too. Retained
movement on SQLite and Postgres verifies expected destination counts and exact
payloads before removing a source; mismatch aborts the transaction.

P1: `activation_temp_view_redirection_refuses_without_movement` fails against
the base (0 passed / 1 failed: activation accepts the view). With the fix it
refuses before the redirected heap is used, the nontransactional movement
probe stays unadvanced, and generation/live/dormant copies stay unchanged.
The benign event-trigger regression still passes. Missing-destination and
same-count corrupted-payload witnesses cover retirement, restoration and cells
on both stores, plus narrowed rows on SQLite. Late destination erasure after a
successful first copy check refuses at retained-cell destruction on both stores.
An ICU casefold/schema-local-C witness requires byte-exact payload rejection;
Postgres uses the catalog-qualified C collation. Expected counts are retained
across marker writes rather than recomputed from potentially changed copies. Disabling destination verification
makes the two store witnesses fail (0/2), and the mutation is restored.

P2: the wire relay now exercises both `independent` and warmed
`independent_cached`, with no preparation on the measured cached path. All
three Execute/Sync units must reach Postgres while the first query remains
blocked, before release or backend termination. It checks independent snapshots,
statement-error isolation and loss of every pending reply. Making only cached
custody exclusive fails the witness (0/1); the mutation is restored. The fixed
witness passes all four uncached/cached × release/termination arms.

Public CLI witnesses verify actual G5/G6 startup and doctor lines (including
different doctor/owner environments), and the identical benign event-trigger
inventory once in activation and doctor. See the FF3 JOURNAL entry for complete
check counts and owned-cluster cleanup. No throughput measurements were run.
