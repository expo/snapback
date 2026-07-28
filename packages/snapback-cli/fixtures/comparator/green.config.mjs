// Packaged comparator fixture and copyable configuration example. The tests
// supply fixture-target.mjs as the lifecycle seam; real applications keep this
// shape and point target.backendDirectory at their generated Snapback backend.

import { defineComparatorProfile } from '../../comparator-profile.mjs';
import { fileURLToPath } from 'node:url';
import api, { ephemeral } from './app/snapback/generated/api.mjs';

export default defineComparatorProfile({
  id: 'package-green-fixture',
  title: 'package comparator green fixture',
  target: {
    backendDirectory: fileURLToPath(new URL('./app/snapback', import.meta.url)),
  },
  refs: {
    liveQuery: api.liveRows,
    liveMutation: api.publishLiveRow,
    atomicMutation: api.writePrimaryAndActivity,
    rejectedMutation: api.rejectInvalidWrite,
    presence: ephemeral.fixturePresence,
  },
  fixtures: {
    identities: {
      observerUserId: 'fixture_observer',
      actorUserId: 'fixture_actor',
    },
    live: {
      queryArgs: {},
      mutationArgs: { body: 'native push witness' },
      matches(rows) {
        return rows.some((row) => row.body === 'native push witness');
      },
    },
    atomic: {
      mutationArgs: { primary: 'primary witness', activity: 'activity witness' },
      declaredWrites: ['primary', 'activity'],
      async snapshot(client) {
        const [primary, activity] = await Promise.all([
          client.query('primaryRows'),
          client.query('activityRows'),
        ]);
        return { primary: primary.rows, activity: activity.rows };
      },
    },
    rejection: {
      mutationArgs: { value: 'invalid' },
      async snapshot(client) {
        return (await client.query('rejectionRows')).rows;
      },
    },
    presence: {
      scope: { roomId: 'fixture-room' },
      value: { state: 'present' },
      ttlMs: 5,
      matches(entry) {
        return entry.value?.state === 'present';
      },
    },
  },
});
