import { useSnapbackConnection, useSnapbackMutation, useSnapbackQueries } from '@expo/snapback-react';
import { useState } from 'react';
import api from '../generated/api.mjs';

export function App() {
  const result = useSnapbackQueries({ schedule: { ref: api.schedule, args: {} } });
  const reserve = useSnapbackMutation(api.reserve);
  const [pending, setPending] = useState<string[]>([]);
  const connection = useSnapbackConnection();
  const schedule = result.queries.schedule.status === 'ready'
    || result.queries.schedule.status === 'refreshing' ? result.queries.schedule.data : [];
  return <main data-testid="cc-calendar">
    <output data-testid="cc-status">{connection.status}:{result.queries.schedule.status}</output>
    <output data-testid="cc-error">{result.queries.schedule.status === 'error'
      ? result.queries.schedule.error.code : ''}</output>
    <output data-testid="cc-alternative">room-01|slot-a</output>
    {['room-00', 'room-01'].map((resourceKey) => <section key={resourceKey}
      data-testid={`cc-slot-${resourceKey}|slot-a`}>
      {schedule.filter((row) => row.resourceKey === resourceKey && row.slotKey === 'slot-a').length
        + pending.filter((key) => key === `${resourceKey}|slot-a`).length}
      <button data-testid={`cc-book-${resourceKey}|slot-a`} onClick={() => {
        const pendingKey = `${resourceKey}|slot-a`;
        setPending((current) => [...current, pendingKey]);
        void reserve({ idempotencyKey: `ui:${resourceKey}:slot-a`, resourceKey, slotKey: 'slot-a',
          ownerId: 'alice', title: 'Planning', now: 1_787_000_000_000 })
          .finally(() => setPending((current) => current.filter((key) => key !== pendingKey)));
      }}>Book</button>
    </section>)}
  </main>;
}
