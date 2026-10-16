# E_QUARRY_IMMUTABLE

An update patch or an upsert conflict arm supplies an immutable column without proving the stored value. Omit it from the patch; insert it when creating the row. A value equal to the target key or from a current exact target snapshot is accepted. Intervening writes or uncertain control flow prevent snapshot proof. Spreads are checked too. External IR keeps the established privacy exception: an unreadable target ignores immutable patch fields without comparing hidden values. guide writes.
