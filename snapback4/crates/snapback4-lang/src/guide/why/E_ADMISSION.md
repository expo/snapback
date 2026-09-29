# Writes

A browser call that cannot synchronously keep its intent refuses `E_ADMISSION`
with a site and rewrite: no new intent is accepted. Use `webDevice()` and
`localStorageSessionStore()`, restore the session or repair storage, then retry
the original id. Browser storage clearing after admission can still erase the
journal. Session readiness is required; acquisition readiness is not.

Writes need no acquisition gate. A fresh replica accepts custody before store
identification; its pending-write view says “waiting for backend identification”.
It retains input, write/row IDs, order, backend binding and a 30-second wall-clock
deadline through reload. Once identified, the ordinary outbox admits and predicts
where eligible, then sends in order. `onWrite` reports terminal outcomes.
An incompatible backend refuses `E_ADMISSION_STORE`; no identity by the deadline
refuses `E_ADMISSION_TIMEOUT`, without sending. A suspended/closed runtime checks
the deadline when it resumes/reopens. Reconnect or reload the current backend,
review the draft and submit a new id. `createApp`'s online journal likewise takes
custody before its first identity probe. These deadlines never expire a write
whose dispatch may already have executed.

`E_ADMISSION_STORE` means the backend changed before admission. The write was
not sent. Reload the current backend, review the draft and submit with a new id.
`E_ADMISSION_TIMEOUT` means identity did not arrive within 30 seconds. The write
was not sent. Check the connection and backend URL, then submit with a new id.
