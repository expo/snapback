import { defineContractModule, pure } from '@exact/contract/exports';

export default defineContractModule('./helpers.ts', {
  backendName: pure({ params: [], result: 'string', depends: [] }),
  formatWhen: pure({ params: ['milliseconds'], result: 'string', depends: 'args' }),
  statusLabel: pure({ params: ['status'], result: 'string', depends: 'args' }),
  goingCount: pure({ params: ['rows'], result: 'number', depends: 'args' }),
  myStatus: pure({ params: ['rows', 'userId'], result: 'string', depends: 'args' }),
});
