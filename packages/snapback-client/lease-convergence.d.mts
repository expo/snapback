export const SNAPBACK_LEASE_CONVERGENCE_CONNECTION_REQUIRED: 'SNAPBACK_LEASE_CONVERGENCE_CONNECTION_REQUIRED';
export const SNAPBACK_LEASE_CONVERGENCE_PENDING_INTENT: 'SNAPBACK_LEASE_CONVERGENCE_PENDING_INTENT';

export interface LeaseConvergenceOwner<Predecessor, Retirement, Established> {
  hasDependentPendingIntent(predecessor: Predecessor): boolean | Promise<boolean>;
  beginTerminalRetirement(predecessor: Predecessor): Retirement | Promise<Retirement>;
  finalizeRetirement(input: Readonly<{
    predecessor: Predecessor;
    retirement: Retirement;
    successor: Established;
  }>): unknown | Promise<unknown>;
}

export interface LeaseConvergenceSuccessorOwner<Predecessor, Successor, Retirement, Established> {
  establishFreshSuccessor(input: Readonly<{
    predecessor: Predecessor;
    successor: Successor;
    retirement: Retirement;
  }>): Established | Promise<Established>;
}

export interface LeaseConvergenceCoordinator<Predecessor, Successor, Retirement, Established> {
  converge(input: Readonly<{
    connected: boolean;
    predecessor: Predecessor;
    successor: Successor;
  }>): Promise<Readonly<{
    status: 'converged';
    retirement: Retirement;
    successor: Established;
    finalized: unknown;
  }>>;
}

export function createLeaseConvergenceCoordinator<Predecessor, Successor, Retirement, Established>(
  options: Readonly<{
    leaseOwner: LeaseConvergenceOwner<Predecessor, Retirement, Established>;
    successorOwner: LeaseConvergenceSuccessorOwner<Predecessor, Successor, Retirement, Established>;
  }>,
): LeaseConvergenceCoordinator<Predecessor, Successor, Retirement, Established>;
