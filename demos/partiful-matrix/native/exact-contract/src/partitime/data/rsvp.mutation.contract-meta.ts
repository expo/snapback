import { defineContractModule, mutation } from '@exact/contract/exports';

export default defineContractModule('./rsvp.mutation.ts', {
  rsvp: mutation({ effects: ['rsvps.write'], invalidates: ['rsvps'] }),
});
