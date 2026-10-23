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

## 2. Non-authorizing `/q` ingress

Ingress parses credentials and consults at most 1,024 carried ordinary
capabilities, bound to the serving store id. Entries are factual planning
hints only. No liveness, expiry, supervisor or allow bit is cached. The
query snapshot always resolves fresh facts through the shared Rust resolver,
compares the carried principal/kind/scope, and validates store binding before
returning metadata. A changed scope/kind returns retryable stale authority;
the freshly observed hint permits a subsequent freshly checked retry.
Action/custom credentials retain the complete resolver and are not cached.

A cache miss learns the credential after the existing bounded body intake,
using the existing projection/complete resolver, then executes the query with
its own final authority snapshot. Unknown tokens finish in that discovery
statement, still at one PG flight. Cold discovery is disclosed separately
from warm counts, and cannot produce a program result or metadata refusal.
Personas carry their parsed identity; the final snapshot checks the current
cast/auth policy. Cache invalidation/eviction changes work, never authority.

Both RT0 tables pass (five HTTP/publication cases): PG W1/account W1 3→2,
W2 2→1; SQLite W1/account W1/W2 6→5. Every other warm class stays unchanged,
including PG action 17, unknown token 1 and metadata refusals 2. A first
attempt used the ordinary preflight discovery for non-ordinary credentials,
adding redundant resolver work; retained red counts led to reusing the
existing one-statement discovery instead. No allowance was raised.

All 62 original RT3b HTTP cases pass, including upload, wait/queue, stale
scope/kind, store mismatch, duplicate authority and metadata order. Two added
cache-populated witnesses pass on both stores: revoked, changed scope and
changed kind at the intake/body boundary cannot reuse the hint, disclose
metadata or preserve a full-scope manifest. The scope/kind retry succeeds
only after another final check. The `rt4_` name filter matches zero binary
tests; full binary/core qualification will cover RT4's actual snapshot tests.

## 3. W3 RT0 baseline before composition

A separate W3-shaped HTTP class reads 32 memberships, room totals and unread
counts, with a 33rd excluded room. It executes the S1 expression/filter/order
shape over stored scalar totals; the existing RT0 write bodies stay unchanged.
The composed-path core/store oracle separately covers real maintained totals.
Exact baseline after ingress refinement, before any fact-collector code:
**Postgres 134 flights; SQLite 132 statements**, warm. Postgres first use 138;
SQLite first use 132. W1/W2 remain 2/1 PG and 5/5 SQLite. Both ratchets and all
five round-trip/publication cases pass. This is a new class, not an increased
allowance for any existing class, and not the old M1 harness's 136-statement
or PG2's 153-call measurement.
