# Absence

Ordinary table point reads yield a row or absence; absent shapes and optional
members stay absent in objects, updates, and calls. Bases evaluate once per
branch. `! else CODE` names a refusal; `??` handles absence. Missing update/delete
is `NOT_FOUND`. Upsert retains insertion on absence, including alternate-key lookup.
Read and write authority are independent. When the same owner predicate denies
read and update/delete, the existence oracle remains: by-id → `E_RULE`,
alternate-key → `NOT_FOUND`.
Maintained point reads yield typed zero if missing/unreadable.

See `guide quarry` for related topics.
