import { capability, defineContractModule, pure } from '@exact/contract/exports';

export default defineContractModule('./helpers.ts', {
  unreadForRoom: pure({ params: ['rows', 'roomId'], result: 'number', depends: 'args' }),
  shortRoomId: pure({ params: ['roomId'], result: 'string', depends: 'args' }),
  navigateToRoom: capability({
    params: { roomId: 'string' },
    effects: ['device.url.open'],
  }),
  navigateHome: capability({
    params: {},
    effects: ['device.url.open'],
  }),
});
