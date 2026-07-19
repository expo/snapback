// Helper boundary descriptors for the Shindig Contract surface. Every export
// the .contract files import must appear here or the verifier reports an
// opaque-import diagnostic.

import { capability, defineContractModule, pure, shape } from '@exact/contract/exports';

export default defineContractModule('./data.ts', {
  fmtWhen: pure({ params: ['ms'], result: 'string', depends: 'args' }),
  statusLabel: pure({ params: ['status'], result: 'string', depends: 'args' }),
  guestLine: pure({ params: ['guest'], result: 'string', depends: 'args' }),
  sortGuests: pure({ params: ['rows'], result: 'InviteRow[]', depends: 'args' }),
  goingCount: pure({ params: ['rows'], result: 'number', depends: 'args' }),
  isHost: pure({ params: ['rows', 'userId'], result: 'boolean', depends: 'args' }),
  inviteCandidates: pure({ params: ['rows'], result: 'Persona[]', depends: 'args' }),
  startsFor: pure({ params: ['choice', 'nowMs'], result: 'number', depends: 'args' }),
  whenChipLabel: pure({ params: ['choice'], result: 'string', depends: 'args' }),
  openEvent: capability({ params: { eventId: 'string' }, effects: ['device.url.open'] }),
  openFeed: capability({ params: {}, effects: ['device.url.open'] }),
  Persona: shape({ fields: { id: 'string', userId: 'string', name: 'string' } }),
  InviteRow: shape({
    fields: {
      _id: 'string',
      _createdAt: 'number',
      eventId: 'string',
      userId: 'string',
      guestName: 'string',
      status: 'string',
      note: { type: 'string', optional: true },
      eventTitle: 'string',
      eventEmoji: 'string',
      eventStartsAt: 'number',
      hostName: 'string',
    },
  }),
});
