
## Mechanism, from the independent grade of the astra-snapback2 lane (2026-09-07, blocker d-01)

The grader reproduced the exhaustion and isolated it to **retries**: 26 distinct uploads are fine,
but the same media send retried with an identical client mutation id fails on the seventh retry
with `E_ASSET_TOO_LARGE: the owner has reached the 536870912 byte or 40 object staging ceiling`,
after which ordinary media sends fail for every account on the instance while text sends still
commit. Cause: the app stages the upload, then calls a mutation whose idempotent early return
(`if exists messages[id]: return { id }`, and the same shape on the intents table) never attaches
the staged object, and nothing releases an unattached staged object at commit or later. A backend
restart does not clear it. The lane's own view-once path re-uploads once per conversation member,
which multiplies the leak.

So the platform-side fix is narrower than a sweep verb: **a staged object that the committing
mutation did not attach must be released at commit** (or at least be subject to a short TTL), and
the idempotent-retry recipe in the guide must say that a retry re-stages nothing. The sweep and
discard verbs above remain the recovery path for state that already leaked.
