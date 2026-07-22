import { capability, defineContractModule, pure } from '@exact/contract/exports';
export default defineContractModule('./helpers.ts', {
  fmtWhen: pure({ params: ['ms'], result: 'string', depends: 'args' }),
  statusLabel: pure({ params: ['status'], result: 'string', depends: 'args' }),
  goingCount: pure({ params: ['rows'], result: 'number', depends: 'args' }),
  myStatus: pure({ params: ['rows','userId'], result: 'string', depends: 'args' }),
  openEvent: capability({ params: { eventId: 'string' }, effects: ['device.url.open'] }),
  openCreateRoute: capability({ params: {}, effects: ['device.url.open'] }),
  openFeed: capability({ params: {}, effects: ['device.url.open'] }),
});
