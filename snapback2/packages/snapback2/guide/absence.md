# Absence

Point reads yield a row or absence. `! else CODE` requires it; `??` supplies a
fallback. Missing update/delete is `NOT_FOUND`. Read and write authority are
independent. With read authority, optional cleanup may point-read without `!`,
then guard `if row != null:` before `delete table[row]`. With delete-only
authority, keep direct by-id delete and handle expected `NOT_FOUND` at its
authorized caller; Quarry cannot guard an unreadable row without silently
skipping an existing one. Upsert inserts on absence, including alternate-key
lookup. When the same owner predicate denies read and update/delete, the
existence oracle remains: by-id → `E_RULE`, alternate-key → `NOT_FOUND`.
Maintained point reads yield typed zero if missing/unreadable.

See `guide quarry` for related topics.
