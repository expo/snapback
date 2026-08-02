import React from 'react';
import {useQuery} from '@rocicorp/zero/react';
import {queries, type EventFilters} from './queries.ts';

export function FleetObservatoryZero({filters}: {filters: EventFilters}) {
  const [events, result] = useQuery(queries.events.latest(filters));
  return <main data-testid="fleet-zero-root">
    <output data-testid="fleet-completeness">{result.type}</output>
    <ol data-testid="fleet-events">{events.map((event) => <li key={event.id} data-testid={`event-${event.id}`}>
      <strong>{event.severity}</strong> {event.message} · {event.device?.name} · {event.owner?.name}
    </li>)}</ol>
  </main>;
}

