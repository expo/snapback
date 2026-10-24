# Snapback 4 managed-relation fence: temporary relations and SQLite name case

**Status:** Closed
**Opened:** 2026-10-24
**Area:** `engine/postgres/managed_relations.rs`, `store/managed_relations.rs`, activation/evolution
**Related:** LLP 3000.009.001.000.002 §6 (FF1 managed-relation admission); FF1 commits `420626a9c9`, `0b353789fb`, `f4ddf6dff8`

FF1 refuses foreign triggers, rewrite rules, RLS and foreign constraints on
Snapback-managed relations at open, reconnect, doctor and twice per
activation. The final blind review (Sol, on `f4ddf6dff8`; Grok approved)
found two remaining corners. Both need a privileged role to tamper with the
database deliberately; they are fix-forward hardening, not a regression.

1. **Temporary activation relations (Postgres).** The catalog filter covers
   only listed relations in `current_schema()`. Activation creates
   `pg_temp._evolution_restored` (and other TEMP scratch tables) after the
   check, so a pre-existing `ddl_command_end` event trigger can attach an
   `AFTER INSERT` trigger to it that deletes the restored live row; the
   dormant source is then deleted and activation commits with neither copy.
   Fix: include TEMP authority relations, and run the interception check
   after their creation and before first use (and in the pre-COMMIT check).
2. **SQLite identifier case.** `store/managed_relations.rs` (~24) matches
   `tbl_name` exactly against the lowercase registry, but SQLite resolves
   identifiers case-insensitively. Renaming `r` → `R` and adding
   `BEFORE INSERT ON R ... RAISE(IGNORE)` escapes the check. Fix: compare
   with SQLite identifier semantics (`lower()` / `COLLATE NOCASE`) or refuse
   noncanonical physical names.

Witness each with the reviewer's scenario.


## Resolution — FF2, 2026-10-24

The Postgres catalog admission includes this connection's TEMP
`_evolution_restored`, `_adopt_groups` and `_adopt_conflicts`. Both creation
sites check immediately after DDL and before any use; lifecycle's existing
pre-COMMIT admission checks the same TEMP inventory. SQLite matches the
managed-name registry with ASCII case folding, as SQLite identifiers do;
installer exceptions still require their exact canonical definitions.

Failing-before witnesses: `sqlite_identifier_case_cannot_hide_managed_trigger`
and `activation_precommit_checks_every_temp_authority_relation` both accept
foreign interception on the base; each fails 0/1. The corrected
`activation_temp_event_trigger_refuses_before_restoration` reproduces the
reviewer's AFTER INSERT attack and fails 0/1 because activation succeeds.
Independent inspection confirms its probe advanced and live/dormant counts
became 0/0 (two qualified repetitions).
`activation_temp_group_tables_checked_before_first_use` fails 0/1 with E_ADOPT
instead of interception refusal; its movement probe also advanced. Fixed witnesses assert unchanged generation
and dormant/live rows, unadvanced nontransactional movement probes before first
use, and final admission on all three TEMP names. Benign event-trigger and
legal lifecycle witnesses remain in the affected suite.


Admission uses separate UNION ALL namespace arms and name-typed index keys.
The initial combined OR caused a global pg_class scan as the evaluation catalog
grew; the final query preserves namespace/name index lookup. Static EXPLAIN
records the plan change without a throughput measurement. The indexed form passes
focused witnesses 14/0, complete managed-relation tests 15/0, parallel HTTP
generation-boundary tests 64/0 and the exact corpus rerun 22/0.
