# Complete admission-effect-guard commit-proof coverage

Status: Open
Date: 2026-08-21
Systems: snapback-auth, snapback-engine, snapback-server
Related: LLP 0058#gate-algorithm, lane/fenceproof

## Why this exists

The `lane/fenceproof` removal-mutation harness is deliberately focused. After
the review repair it directly proves eleven engine commits plus the server's
agent-invitation commit; its `AdmissionEffectSite` enum is not a repository
inventory.

A repository-wide source scan on 2026-08-21 found 152 production
`effect_guard` acquisition expressions after excluding unit-test-only calls.
Manual call-site review classifies 84 expressions as directly enclosing a
durable write. They represent the 89 named operations below because generic
mutation, authorization-retry, and password-issuance helpers each accept more
than one closed effect name. The other acquisitions fence response, live,
connection, WebSocket, ephemeral, secret-lease, or other in-memory/network
publication, or delegate guard acquisition without performing a write at that
source location.

## Complete durable-write inventory

### Engine auth, integration, and durable product catalogs

- OAuth dynamic registration, consent request, consent denial, consent
  approval, and authorization-code issuance.
- Pending-effect inbox expiry/pruning, lookup expiry/pruning, refusal,
  approval, settlement, denial, and creation.
- Capability-link mint, use consumption, use settlement, and revocation.
- Grant-request inbox expiry/pruning and grant-listing expiry/pruning.
- Integration-principal retirement, integration suspension, password-lockout
  clearing, declared-client status change, and declared-client deletion.
- Push batch claim, transmitting marker, settlement, token registration, token
  unregistration, and durable send reservation.
- Protected-record erasure and operation-coverage activation.
- Client-mutation acknowledgement and operation-identity range issuance.
- Authorized-lease reservation.
- Watch creation, state transition, and anchor renewal.
- Authorization manual-retry reservation, plus the shared retry-transaction
  helper's initial reservation, automatic reservation, and failure record.

### Engine mutations, jobs, and cron

- Media-command mutation, host-child mutation, idempotent mutation, ordinary
  mutation, media-command Ibex transaction, host-child Ibex mutation, and
  ordinary Ibex mutation.
- Branch mutation, branch Ibex mutation, nested host-plan transaction, and
  detached nested mutation; the branch path also has its idempotent and
  ordinary mutation transaction variants.
- Empty cron-scheduler-state persistence, cron claim persistence, manual cron
  claim persistence, job-result commit, and cron-result-ledger persistence.

### Server auth catalog

- Authenticated finite-session use and authenticated connection use.
- Step-up challenge creation.
- Agent-invitation mint, pairing-code mint, pairing-code presentation, and
  agent registration.
- Grant approval, denial, revocation, and bulk revocation.
- Email-code session mint.
- Password signup, signin, reset, change, and set; recovery-code consumption
  and rotation.
- Auth-exchange rejection, issuance, unknown-exchange handling, and request-code
  persistence.
- Refresh rotation, refresh-reuse handling, logout, family alarm, and
  family-alarm revocation.
- App reset.

## Focused proof coverage on this branch

The removal-mutation harness covers exactly these twelve durable sites:

1. OAuth dynamic registration.
2. Capability-link mint.
3. Capability-link use consumption.
4. Capability-link use settlement.
5. Capability-link revocation.
6. Client-mutation acknowledgement.
7. Push durable reservation.
8. Push batch claim.
9. Push transmitting marker.
10. Push batch settlement.
11. Watch creation.
12. Agent-invitation mint.

Each has a pre-guard retirement/refusal observation, an immediate post-guard
ownership observation, and a successful-commit ownership observation. The
five mandatory mutations (`V`, `E`, `_`, deletion, and a drop after the
post-guard hook but before the write) are exercised against all twelve.

## Deferred scope

The remaining 77 named durable operations are deferred from this focused
branch because proving them requires subsystem-specific fixtures and commit
hooks across mutation execution, auth-provider choreography, retry state,
cron/job persistence, and the remaining catalogs. The production guards are
unchanged; what is deferred is repository-complete *removal-mutation proof*,
not the guard requirement itself. Close this ticket only after every durable
inventory item has a direct successful-commit ownership observation and the
same five-mutation audit, or after a shared lower-level transaction seam makes
that proof repository-complete without per-site hooks.
