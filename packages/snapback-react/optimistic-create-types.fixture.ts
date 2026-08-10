import api from '../../demos/zero-bakeoff/apps/contention-calendar/snapback/generated/api';
import type {
  Id,
  ProvisionalId,
} from '../../demos/todo/snapback/generated/api';
import { useSnapbackOptimisticCreate } from './index.mjs';

const calendar = useSnapbackOptimisticCreate(api.reserve, {
  query: api.schedule,
  args: {},
  select: (entities) => entities
    .filter((entity) => entity.fields.slotKey === 'slot-a')
    .sort((left, right) => left.fields.resourceKey.localeCompare(right.fields.resourceKey)),
});

declare function requireCanonicalReservation(id: Id<'reservations'>): void;

if (calendar.query.status === 'ready' || calendar.query.status === 'refreshing') {
  for (const entity of calendar.query.data) {
    if (entity.kind === 'canonical') {
      requireCanonicalReservation(entity.identity.id);
      entity.fields._version.toFixed();
    } else {
      const provisional: ProvisionalId<'reservations'> = entity.identity.id;
      provisional.toUpperCase();
      entity.fields.title.toUpperCase();
      // @ts-expect-error provisional intent identity cannot flow as a canonical row id.
      requireCanonicalReservation(provisional);
      // @ts-expect-error server-authored row version is absent on provisional fields.
      entity.fields._version;
    }
  }
}

calendar.create({
  idempotencyKey: 'typed-fixture',
  resourceKey: 'room-00',
  slotKey: 'slot-a',
  ownerId: 'alice',
  title: 'Planning',
  now: 1_787_000_000_000,
}).then((id) => requireCanonicalReservation(id));

// @ts-expect-error generated mutation args remain exact.
calendar.create({ title: 'missing required fields' });
