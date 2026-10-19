# Snapback 4 behavior changes

## 0.4.34

- Declare conditional, derived, split and enum-rename historical backfills in Quarry. Deploy previews exact transformed-row counts and commits data, indexes, rules and the release atomically. Rollback restores untouched preimages, refuses conflicting edits, and forward catches up older writes. `guide deploy` includes a repeatable real-user recipe against one persistent production store, qualified from the packed package.
- `serve --clock-offset` accepts only `deploy --staging` stores. Staging clock advance/status require a full service token; production refuses every clock control. `startServe` accepts `clockOffset` and exposes `now()`/`advance()` without opening fixture or persona doors.
