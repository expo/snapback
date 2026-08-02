import React from 'react';
import {useSnapbackQuery} from '@expo/snapback-react';
import api from './generated/api.mjs';

export type FleetFilters = {fleetKey: string; severity?: string; region?: string; deviceStatus?: string};

export function FleetObservatorySnapback({filters}: {filters: FleetFilters}) {
  const query = useSnapbackQuery(api.latestEvents, filters);
  return <main data-testid="fleet-snapback-root">
    <output data-testid="fleet-completeness">{query.status}:{query.connection}</output>
    <ol data-testid="fleet-events">{(query.data ?? []).map((event) => <li key={event.eventKey} data-testid={`event-${event.eventKey}`}>
      <strong>{event.severity}</strong> {event.message} · {event.deviceName} · {event.ownerName}
    </li>)}</ol>
  </main>;
}
