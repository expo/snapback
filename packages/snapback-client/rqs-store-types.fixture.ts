import { pendingAcknowledgementsFor } from './outbox-shared.mjs';
import type { RqsResumeStore } from './rqs-store.mjs';

declare const store: RqsResumeStore;

const quarantineCapability: Readonly<{
  schemaVersion: 'snapback.rqs-outbox-capabilities.v1';
  supportsLegacyQuarantine: true;
}> = store.outboxCapabilities;
void quarantineCapability;

type IsOptional<T, Key extends keyof T> = {} extends Pick<T, Key> ? true : false;
const pendingInsertionCompensationIsRequired: false = null as unknown as IsOptional<
  RqsResumeStore,
  'outboxDiscardPendingInsertion'
>;
void pendingInsertionCompensationIsRequired;

pendingAcknowledgementsFor(
  {} as Parameters<typeof pendingAcknowledgementsFor>[0],
  'user-a',
  64,
  { authorityInstanceId: 'authority-a' },
  { schemaVersion: 'snapback.outbox-enqueue-target.v1' },
);

async function reconcileLegacyRecords() {
  const result = await store.outboxReconcileCustodyRecords(
    ['cm-legacy'],
    { authMode: 'sessions', userId: 'user-successor' },
    { authorityInstanceId: 'authority-successor' },
    { authorityEpoch: 2, authorityKey: 'successor-key' },
    2,
    {
      disposition: 'quarantine',
      predecessorPrincipalScope: { authMode: 'sessions', userId: 'user-predecessor' },
    },
  );
  if (result !== false) {
    const quarantined: number = result.quarantined;
    const quarantinedIds: readonly string[] = result.quarantinedIds;
    void quarantined;
    void quarantinedIds;
  }
}

void reconcileLegacyRecords;
