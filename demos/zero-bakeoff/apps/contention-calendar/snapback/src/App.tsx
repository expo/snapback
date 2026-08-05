// @ref LLP 0155#identity-model — provisional rows expose an intent identity,
// never a forged generated Id<'reservations'>; settlement swaps in the typed
// canonical row delivered by the schedule query.
// @ref LLP 0155#outcome — provisional and canonical reservations share this
// one filter/order/count/relationship projection.
import { useEffect, useRef, useState } from 'react';
import type {
  FunctionResult,
  OptimisticMutationView,
  OptimisticMutationViewSnapshot,
  SnapbackClient,
} from '@expo/snapback-client';
import api from '../generated/api';

type Reservations = FunctionResult<typeof api.schedule>;
type Reservation = Reservations[number];
type Resources = FunctionResult<typeof api.resourceList>;
type ReservationFields = Pick<
  Reservation,
  'idempotencyKey' | 'resourceKey' | 'slotKey' | 'resourceSlotKey' | 'ownerId' | 'title' | 'createdAt'
>;

type VisibleReservation = Readonly<{
  identity:
    | Readonly<{ kind: 'provisional'; intentId: string }>
    | Readonly<{ kind: 'canonical'; id: Reservation['_id'] }>;
  fields: ReservationFields;
  resourceTitle: string;
}>;

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
);

function requiredString(row: Readonly<Record<string, unknown>>, key: string): string {
  const value = row[key];
  if (typeof value !== 'string') throw new TypeError(`reservation.${key} must be a string`);
  return value;
}

function requiredInteger(row: Readonly<Record<string, unknown>>, key: string): number {
  const value = row[key];
  if (!Number.isSafeInteger(value)) throw new TypeError(`reservation.${key} must be an integer`);
  return value as number;
}

function provisionalIntentByMint(snapshot: OptimisticMutationViewSnapshot): Map<string, string> {
  const intents = new Map<string, string>();
  for (const entry of snapshot.layers) {
    const intentId = entry.clientMutationId;
    const layer = entry.layer;
    if (typeof intentId !== 'string' || !isRecord(layer) || !Array.isArray(layer.writes)) continue;
    for (const write of layer.writes) {
      if (!isRecord(write) || write.operation !== 'insert' || write.table !== 'reservations') continue;
      if (typeof write.id === 'string') intents.set(write.id, intentId);
    }
  }
  return intents;
}

function projectCalendar(
  snapshot: OptimisticMutationViewSnapshot,
  canonical: Reservations,
  resources: Resources,
): readonly VisibleReservation[] {
  const canonicalById = new Map<string, Reservation>(canonical.map((row) => [row._id, row]));
  const resourceTitles = new Map(resources.map((row) => [row.key, row.title]));
  const intentByMint = provisionalIntentByMint(snapshot);
  const rows = snapshot.visibleRows.reservations ?? [];
  const projected: VisibleReservation[] = rows.map((row) => {
    const opaqueId = requiredString(row, '_id');
    const authoritative = canonicalById.get(opaqueId);
    if (authoritative) {
      return {
        identity: { kind: 'canonical', id: authoritative._id },
        fields: authoritative,
        resourceTitle: resourceTitles.get(authoritative.resourceKey) ?? authoritative.resourceKey,
      };
    }
    const intentId = intentByMint.get(opaqueId);
    if (!intentId) throw new TypeError('provisional reservation has no generated intent identity');
    const fields: ReservationFields = {
      idempotencyKey: requiredString(row, 'idempotencyKey'),
      resourceKey: requiredString(row, 'resourceKey'),
      slotKey: requiredString(row, 'slotKey'),
      resourceSlotKey: requiredString(row, 'resourceSlotKey'),
      ownerId: requiredString(row, 'ownerId'),
      title: requiredString(row, 'title'),
      createdAt: requiredInteger(row, 'createdAt'),
    };
    return {
      identity: { kind: 'provisional', intentId },
      fields,
      resourceTitle: resourceTitles.get(fields.resourceKey) ?? fields.resourceKey,
    };
  });
  return projected.sort((left, right) => (
    left.fields.slotKey.localeCompare(right.fields.slotKey)
    || left.fields.resourceKey.localeCompare(right.fields.resourceKey)
    || left.fields.ownerId.localeCompare(right.fields.ownerId)
  ));
}

export function App({ client }: { client: SnapbackClient }) {
  const [visible, setVisible] = useState<readonly VisibleReservation[]>([]);
  const [status, setStatus] = useState('Opening the canonical schedule…');
  const [error, setError] = useState('');
  const viewRef = useRef<OptimisticMutationView | null>(null);
  const canonicalRef = useRef<Reservations>([]);
  const resourcesRef = useRef<Resources>([]);

  const publish = () => {
    const view = viewRef.current;
    if (!view) return;
    setVisible(projectCalendar(view.getSnapshot(), canonicalRef.current, resourcesRef.current));
  };

  useEffect(() => {
    let disposed = false;
    let stopView = () => {};
    const handles: Array<{ dispose(): void | Promise<void> }> = [];
    void (async () => {
      const [resourceRows, scheduleRows] = await Promise.all([
        client.query(api.resourceList),
        client.query(api.schedule),
      ]);
      resourcesRef.current = resourceRows.rows;
      canonicalRef.current = scheduleRows.rows;
      const view = await client.createOptimisticMutationView({
        authoritativeRows: { reservations: scheduleRows.rows },
        connected: true,
      });
      if (disposed) {
        view.close();
        return;
      }
      viewRef.current = view;
      stopView = view.subscribe(publish);
      publish();
      const [resourceHandle, scheduleHandle] = await Promise.all([
        client.liveQuery(api.resourceList, {
          connectionId: 'contention-calendar-resources',
          onUpdate(rows) {
            resourcesRef.current = rows;
            publish();
          },
        }),
        client.liveQuery(api.schedule, {
          connectionId: 'contention-calendar-schedule',
          onUpdate(rows) {
            canonicalRef.current = rows;
            // Do not render a canonical row beside its still-pending local
            // mint. The settlement identity, not content equality or call
            // order, retires that private layer below.
            if (view.getSnapshot().layers.length === 0) {
              void view.rebase({
                authoritativeRows: { reservations: rows },
                connected: true,
                cause: 'schedule-live-delivery',
              });
            }
          },
        }),
      ]);
      if (disposed) {
        await Promise.all([resourceHandle.dispose(), scheduleHandle.dispose()]);
        return;
      }
      handles.push(resourceHandle, scheduleHandle);
      resourcesRef.current = resourceHandle.rows;
      canonicalRef.current = scheduleHandle.rows;
      await view.rebase({
        authoritativeRows: { reservations: scheduleHandle.rows },
        connected: true,
        cause: 'calendar-live-handles-ready',
      });
      setStatus('Ready — creates paint from generated Insert IR.');
    })().catch((cause) => {
      setError(String((cause as { code?: string })?.code ?? (cause as Error)?.message ?? cause));
    });
    return () => {
      disposed = true;
      stopView();
      viewRef.current?.close();
      viewRef.current = null;
      for (const handle of handles) void handle.dispose();
    };
  }, [client]);

  const reserve = async (resourceKey: string, slotKey: string) => {
    setError('');
    setStatus(`Predicting ${resourceKey}|${slotKey}…`);
    try {
      const settlement = await client.mutate(api.reserve, {
        args: {
          idempotencyKey: `ui:${resourceKey}:${slotKey}`,
          resourceKey,
          slotKey,
          ownerId: 'alice',
          title: 'Planning',
          now: 1_787_000_000_000,
        },
      });
      const schedule = await client.query(api.schedule);
      canonicalRef.current = schedule.rows;
      await viewRef.current?.rebase({
        authoritativeRows: { reservations: schedule.rows },
        retiredSettlementIdentities: settlement.clientMutationId
          ? [settlement.clientMutationId]
          : [],
        connected: true,
        cause: 'reservation-authoritative-delivery',
      });
      setStatus(`Canonical reservation ${settlement.result} settled.`);
    } catch (cause) {
      await viewRef.current?.refresh({
        authoritativeRows: { reservations: canonicalRef.current },
        connected: true,
        cause: 'reservation-refused',
      });
      setError(String((cause as { diagnostic?: { code?: string }; code?: string })?.diagnostic?.code
        ?? (cause as { code?: string })?.code
        ?? 'SNAPBACK_RESERVATION_REFUSED'));
      setStatus('The provisional reservation was retired; choose the alternative.');
    }
  };

  return <main data-testid="cc-calendar">
    <output data-testid="cc-status">{status}</output>
    <output data-testid="cc-error">{error}</output>
    <output data-testid="cc-alternative">room-01|slot-a</output>
    {['room-00', 'room-01'].map((resourceKey) => {
      const rows = visible.filter((row) => (
        row.fields.resourceKey === resourceKey && row.fields.slotKey === 'slot-a'
      ));
      return <section key={resourceKey} data-testid={`cc-slot-${resourceKey}|slot-a`}>
        <strong>{rows[0]?.resourceTitle ?? resourceKey}</strong>
        <output>{rows.length}</output>
        {rows.map((row) => <span key={row.identity.kind === 'canonical'
          ? `canonical:${row.identity.id}`
          : `intent:${row.identity.intentId}`}>
          {row.fields.title} ({row.identity.kind})
        </span>)}
        <button data-testid={`cc-book-${resourceKey}|slot-a`}
          onClick={() => void reserve(resourceKey, 'slot-a')}>Book</button>
      </section>;
    })}
  </main>;
}
