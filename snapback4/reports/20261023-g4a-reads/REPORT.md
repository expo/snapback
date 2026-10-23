# G4a: bounded read admission and fact collection

Lane `sb4-pg/g4a`, exact RT6 base `2fdab648822e60e7e4b5a6235aec1d6cebc9c522`.
Host expo-build-450a; build jobs 4, own target, line-tables-only dev/test.
Design read from accepted controls RFC revision 6 at `fcc2aa96ad` (the
requested RT6 base does not contain that document), especially §§2.2, 4.4,
6, 10.1, 10.3, 12; round-trip RFC §§3.1, 7, 11. The current store-port
LLP and root fence apply. `llp-orient` hand-off: none. No semantic SQL
executor, result cache, authority grant, extra database pool or publication.

Before code: expected warm PostgreSQL W1/W2 3/2 → 2/1 after non-authorizing
ingress, then W1 → 1 after full fact composition. W3 gets a separate measured
class. Unsupported closures retain ordinary execution. All existing classes
must stay at or below their RT6 ratchets. SQLite outcome/meter parity remains.

## 1. Short admission

Thirty executing short workers plus 98 waiting requests, disclosed constants.
Waiting requests hold no reader or database snapshot. Worker count decreased
from 32, preserving the matched 30-reader reservation; no connection cap was
raised. Queue capacity does not add to the HTTP connection cap. Original
intake age and the absolute HTTP body deadline survive dispatch. Expired
requests use the same non-draining `E_RATE_LIMIT` response as queue overflow.

Witness: all 128 burst requests accepted and drained with HTTP 200, only 30
entered handlers while held, the 129th received HTTP 503 `E_RATE_LIMIT`.
An expired request with an unfinished large body refused before body drain.
All eight overload tests pass. Initial deadline fixture used a small body
which tiny_http buffers before dispatch; corrected to a streaming body.

Both RT0 tables pass unchanged; five round-trip/publication tests pass.
Postgres W1/W2/increment/keyed/replay: 3/2/8/9/2. SQLite: 6/6/22/30/5.
These deterministic bursts establish bounded behavior, not a loaded S1 SLO
or arrival-sampled capacity claim. Private PG16 master 4057748 is owned by
this lane until final qualification/cleanup. Logs remain under /tmp/sb4-g4a.
