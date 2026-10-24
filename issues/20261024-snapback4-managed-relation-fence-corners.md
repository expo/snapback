# Snapback 4 managed-relation fence: temporary relations and SQLite name case

**Status:** Open
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
