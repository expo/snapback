# Offline

Offline storage is explicit. Pass a durable carrier through the client's
`offline.store` option. React web exports the IndexedDB carrier; journeys and
Node tests export the file carrier from `snapback2/test`.

The store is partitioned by principal. A terminal session expiry seals the
partition until that principal authenticates again. Sign-out or replacement by
another principal wipes it. A browser permits one writer per principal; close
the other tab if `E_OFFLINE_LOCK` reports that the account is already open.

`drain: true` follows cursor pages to the end, records a watermark, and watches
the tail. Held answers remain readable beyond `fenceDays`; the fence limits
offline trust, not reading.

`E_OFFLINE_CARRIER` means the configured durable carrier could not open. Fix or
install that carrier; Snapback never substitutes memory while claiming durable
offline storage.
