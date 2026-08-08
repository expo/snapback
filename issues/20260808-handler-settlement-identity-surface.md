# Handlers cannot see their protocol settlement identity; effect idempotency keys are reinvented per app

**Opened:** 2026-08-08 · **Severity:** P2 (platform seam; flagged independently twice by the Zerobugs control)

The client supplies `clientMutationId` and the server replays duplicates
without re-entering the handler — but the handler context never exposes
that identity. Two independent Zerobugs lanes hit the same wall
(PLAN "Guide gaps" 2026-08-06, twice): a transaction-coupled notification
intent needs a replay-stable unique key, and the frozen provider contract
needs exactly `clientID:mutationID:email`. The control worked around it
with a namespaced `ctx.runtime.id()` fallback plus composition-injected
identity arguments on eight generated calls — counted app complexity that a
read-only `ctx.mutation.settlementId` (or equivalent) would delete.

Ask: expose a read-only settlement identity on the mutation handler
context so downstream effect workers can correlate client settlement and
provider idempotency without app-owned identity plumbing. Owner seam:
D5 mutation semantics / D7 effect idempotency (the LLP 0183 review round
flagged this exact split as an unowned cross-cutting contract).
