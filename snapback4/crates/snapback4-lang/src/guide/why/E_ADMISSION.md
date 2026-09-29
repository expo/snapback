# Writes

A browser call that cannot synchronously keep its intent refuses `E_ADMISSION`
with a site and rewrite: no new intent is accepted. Use `webDevice()` and
`localStorageSessionStore()`, restore the session or repair storage, then retry
the original id. Browser storage clearing after admission can still erase the
journal. Session readiness is required; acquisition readiness is not.

Writes need no acquisition gate after session readiness. Before identification,
`mutate()` waits up to 15 seconds, even with `waitSeconds: 0`. Its promise stays
pending. `usePendingWrites()` says “waiting for backend identification; not yet
admitted”. No durable custody exists yet: reload loses this call. Keep the draft during submission. Once identified, calls enter ordinary admission
in call order, predict where eligible and use ordinary durable delivery.
`onWrite` reports terminal outcomes.
`E_ADMISSION_STORE` means the backend changed before admission. The write was
not sent. Reload the current backend, review the draft and submit with a new id.
`E_ADMISSION_TIMEOUT` means identity did not arrive within 15 seconds. The write
was not admitted or sent. Check the connection and backend URL, then submit with
a new id. A suspended runtime checks the original deadline when it resumes.
`createApp`'s online client also waits before journaling new intent. Admitted writes retain ordinary custody and recovery.
