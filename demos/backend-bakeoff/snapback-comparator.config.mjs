// Thin Signal Desk configuration for the package-owned backend comparator.
// Lifecycle, native-push attribution, deadlines, cleanup, and receipt
// validation remain owned by @snapback/cli.
import { defineComparatorProfile } from '@snapback/cli/comparator';
import api, { ephemeral } from './snapback/generated/api.mjs';

export default defineComparatorProfile({
  id: 'signal-desk-snapback',
  title: 'Signal Desk / Snapback comparator',
  target: {
    backendDirectory: new URL('./snapback', import.meta.url).pathname,
    projectRoot: new URL('../..', import.meta.url).pathname,
  },
  refs: {
    liveQuery: api.allComments,
    liveMutation: api.addComment,
    atomicMutation: api.addTask,
    rejectedMutation: api.setStatus,
    presence: ephemeral.incidentPresence,
  },
  fixtures: {
    identities: {
      observerUserId: 'comparator_observer',
      actorUserId: 'comparator_actor',
    },
    live: {
      queryArgs: {},
      mutationArgs: {
        incidentId: 'incident_api',
        body: 'Comparator native push witness',
        actorId: 'comparator_actor',
        now: 1785161000000,
      },
      matches(rows) {
        return rows.some((row) => row.body === 'Comparator native push witness');
      },
    },
    atomic: {
      mutationArgs: {
        incidentId: 'incident_api',
        body: 'Comparator atomic write witness',
        actorId: 'comparator_actor',
        now: 1785161100000,
      },
      declaredWrites: ['incidents', 'tasks', 'activity'],
      async snapshot(client) {
        const [incidents, tasks, activity] = await Promise.all([
          client.query(api.listIncidents, { args: {} }),
          client.query(api.allTasks, { args: {} }),
          client.query(api.allActivity, { args: {} }),
        ]);
        return {
          incidents: incidents.rows,
          tasks: tasks.rows,
          activity: activity.rows,
        };
      },
    },
    rejection: {
      mutationArgs: {
        incidentId: 'incident_api',
        status: 'on-fire',
        actorId: 'comparator_actor',
        now: 1785161200000,
      },
      async snapshot(client) {
        return (await client.query(api.listIncidents, { args: {} })).rows;
      },
    },
    presence: {
      scope: { incidentId: 'incident_api' },
      value: {
        userId: 'comparator_actor',
        name: 'Comparator Actor',
        color: '#f0544f',
        viewing: 'incident',
      },
      ttlMs: 25,
      matches(entry) {
        return entry.value?.userId === 'comparator_actor';
      },
    },
  },
});
