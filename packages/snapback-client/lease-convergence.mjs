// Carrier-neutral orchestration for the only admitted v1 lease-family
// convergence arm. Durable state remains entirely inside the two owners: this
// coordinator owns no journal and cannot open a transaction spanning them.

export const SNAPBACK_LEASE_CONVERGENCE_CONNECTION_REQUIRED =
  'SNAPBACK_LEASE_CONVERGENCE_CONNECTION_REQUIRED';
export const SNAPBACK_LEASE_CONVERGENCE_PENDING_INTENT =
  'SNAPBACK_LEASE_CONVERGENCE_PENDING_INTENT';

function convergenceError(code, message, details = {}) {
  const diagnostic = Object.freeze({
    schemaVersion: 'snapback.client-diagnostic.v1',
    code,
    severity: 'error',
    subsystem: 'client-store',
    message,
    details: Object.freeze({ ...details }),
  });
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  error.diagnostic = diagnostic;
  return error;
}

function operation(owner, name, side) {
  const candidate = owner?.[name];
  if (typeof candidate !== 'function') {
    throw new TypeError(`lease convergence requires ${side}.${name}`);
  }
  return candidate.bind(owner);
}

// @ref LLP 0166#successor-and-migration-rules — close the predecessor first,
// establish a fresh qmk1 successor second, then finalize owner retirement.
export function createLeaseConvergenceCoordinator({ leaseOwner, successorOwner } = {}) {
  const hasDependentPendingIntent = operation(
    leaseOwner,
    'hasDependentPendingIntent',
    'leaseOwner',
  );
  const beginTerminalRetirement = operation(
    leaseOwner,
    'beginTerminalRetirement',
    'leaseOwner',
  );
  const finalizeRetirement = operation(
    leaseOwner,
    'finalizeRetirement',
    'leaseOwner',
  );
  const establishFreshSuccessor = operation(
    successorOwner,
    'establishFreshSuccessor',
    'successorOwner',
  );

  return Object.freeze({
    async converge({ connected, predecessor, successor }) {
      if (connected !== true) {
        // diagnostics-registry: emission SNAPBACK_LEASE_CONVERGENCE_CONNECTION_REQUIRED
        throw convergenceError(
          SNAPBACK_LEASE_CONVERGENCE_CONNECTION_REQUIRED,
          'lease convergence may begin only during a connected attempt',
          { retry: 'when-connected' },
        );
      }

      // This read-only owner precondition must precede every durable step. The
      // owner operation decides dependency identity; the coordinator never
      // inspects, rewrites, settles, or discards an intent.
      if (await hasDependentPendingIntent(predecessor)) {
        // diagnostics-registry: emission SNAPBACK_LEASE_CONVERGENCE_PENDING_INTENT
        throw convergenceError(
          SNAPBACK_LEASE_CONVERGENCE_PENDING_INTENT,
          'a pending outbox intent depends on the predecessor instance',
          { retry: 'after-settlement-or-explicit-discard' },
        );
      }

      // Each awaited call is a separate owner commit boundary. Owner methods
      // must return their already-durable result and be safe to repeat, which
      // makes a coordinator restart resume monotonically from every cut.
      const retirement = await beginTerminalRetirement(predecessor);
      const established = await establishFreshSuccessor({
        predecessor,
        successor,
        retirement,
      });
      const finalized = await finalizeRetirement({
        predecessor,
        retirement,
        successor: established,
      });

      return Object.freeze({
        status: 'converged',
        retirement,
        successor: established,
        finalized,
      });
    },
  });
}
