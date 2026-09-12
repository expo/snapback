# Absence

Point reads yield a row or absence. `! else CODE` requires it; `??` supplies a
fallback. Missing update/delete is `NOT_FOUND`. For optional cleanup, point-read
without `!`, then guard `if row != null:` before `delete table[row]`.
Upsert inserts on absence, including alternate-key lookup.
Read and write authority are independent. When the same owner predicate denies
read and update/delete, the existence oracle remains: by-id → `E_RULE`,
alternate-key → `NOT_FOUND`.
Maintained point reads yield typed zero if missing/unreadable.

See `guide quarry` for related topics.
