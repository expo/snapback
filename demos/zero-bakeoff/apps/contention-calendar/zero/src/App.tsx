import { useQuery, useZero } from '@rocicorp/zero/react';
import { mutators } from '../mutators.ts';
import { queries } from '../queries.ts';

export function App() {
  const zero = useZero();
  const [rows, state] = useQuery(queries.schedule());
  return <main data-testid="cc-calendar">
    <output data-testid="cc-status">{state.type}</output><output data-testid="cc-error" />
    <output data-testid="cc-alternative">room-01|slot-a</output>
    {['room-00', 'room-01'].map((resourceID) => <section key={resourceID} data-testid={`cc-slot-${resourceID}|slot-a`}>
      {rows.filter((row) => row.resourceID === resourceID && row.slotKey === 'slot-a').length}
      <button data-testid={`cc-book-${resourceID}|slot-a`} onClick={() => {
        const idempotencyKey = `ui:${resourceID}:slot-a`;
        const mutation = zero.mutate(mutators.reservation.reserve({
          id: `reservation:${idempotencyKey}`, idempotencyKey, resourceID, slotKey: 'slot-a',
          ownerID: 'alice', title: 'Planning', createdAt: 1_787_000_000_000,
        }));
        void mutation.server.catch(() => {});
      }}>Book</button>
    </section>)}
  </main>;
}
