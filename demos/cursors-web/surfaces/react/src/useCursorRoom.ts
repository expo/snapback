// Cursor presence — the hand-wired React glue (ENG-22531 control arm).
//
// This hook is the React analog of what the Contract arm gets from two
// declarations (`ephemeral cursors = webCursors({...})` + the pointerChannel
// `use`): it subscribes the room's ephemeral overlay over the shared live
// socket, mirrors the kit's connection axis, prunes entries by server TTL,
// re-subscribes on resync boundaries, throttles pointer samples to a declared
// 15Hz publish (inside the generated sustainedHz=20 budget), drives the
// zero-latency self dot through direct ref writes (no React render on the
// pointer path), and exposes a LOCAL-ONLY force plane plus live-observable
// publish facts for the acceptance suite.
//
// Semantics deliberately mirror packages/snapback-contract's ephemeral wiring
// (toMapCell / scheduleExpiryReemit / resync re-subscribe) so the two arms
// make the same product claims:
// @ref LLP 0034#4 — the lease key IS the presence provenance; keyMode
//   Connection makes `self` = (entry.key === our connectionId).
// @ref LLP 0013#client-overlay-store — TTL pruning is local policy over
//   server-stamped expiry; frozen (stale/disconnected) maps stop pruning.

import { useEffect, useMemo, useRef, useState } from 'react';
import type * as React from 'react';

import type { SnapbackClient, EphemeralOverlay } from '../../../../_kit/client.mjs';
import { ephemeral as generatedEphemeral } from '../../../snapback/generated/api.mjs';
import schemaManifest from '../../../snapback/generated/schema.manifest.json';
import type { GeneratedEphemeral } from '../../../snapback/generated/api';

export type CursorValue = NonNullable<GeneratedEphemeral['webCursors']['__value']>;

export type ConnectionAxis = 'connecting' | 'live' | 'stale' | 'disconnected';
export type MapStatus = 'connecting' | 'ready' | 'error';

export interface CursorEntry {
  key: string;
  value: CursorValue;
  updatedAt: number;
  expiresAt: number;
  sourceClientId: string;
  self: boolean;
}

export interface ForcedCell {
  status?: MapStatus;
  entries: Array<{
    key: string;
    value: CursorValue;
    updatedAt?: number;
    sourceClientId?: string;
    self?: boolean;
  }>;
}

export interface PublishFacts {
  descriptor: string;
  declaredRateHz: number;
  budget: { sustainedHz: number; burst: number; maxValueBytes: number };
  writes: number;
  published: number;
  rejected: number;
  established: boolean;
  establishedAtMs: number | null;
}

export interface CursorRoom {
  status: MapStatus;
  connection: ConnectionAxis;
  connectionId: string | null;
  entries: CursorEntry[];
  onPointerMove: (event: React.PointerEvent<HTMLElement>) => void;
  stageRef: React.RefObject<HTMLDivElement | null>;
  selfDotRef: React.RefObject<HTMLDivElement | null>;
  publishFacts: () => PublishFacts;
  forceCursors: (cell: ForcedCell) => { dispose: () => void };
}

const cursorsRef = generatedEphemeral.webCursors;

// Generated publish budget facts (schema.manifest.json). The Contract arm's
// analyzer checks the channel's declared rate against these at compile time;
// the React arm checks at module init — a runtime assertion is the best a
// hand-wired throttle can do, which is itself a data point for ENG-22531.
const foundBudgetFacts = schemaManifest.ephemeralCollections.find(
  (collection) => collection.name === cursorsRef.name,
);
if (!foundBudgetFacts) {
  throw new Error(`generated schema manifest is missing the ${cursorsRef.name} collection`);
}
const budgetFacts = foundBudgetFacts;
export const DECLARED_PUBLISH_RATE_HZ = 15;
if (DECLARED_PUBLISH_RATE_HZ > budgetFacts.sustainedHz) {
  throw new Error(
    `declared publish rate ${DECLARED_PUBLISH_RATE_HZ}Hz exceeds the generated sustainedHz=${budgetFacts.sustainedHz} budget`,
  );
}
const PUBLISH_INTERVAL_MS = 1000 / DECLARED_PUBLISH_RATE_HZ;

// Resync re-subscribe backoff — mirrors the Contract adapter's policy shape,
// simplified (fixed base, capped) for the hand-wired arm.
const RESYNC_RETRY_MS = 500;
const SELF_DOT_HALF_PX = 8;

interface RoomOptions {
  client: SnapbackClient;
  roomId: string;
  name: string;
  color: string;
}

export function useCursorRoom({ client, roomId, name, color }: RoomOptions): CursorRoom {
  const [status, setStatus] = useState<MapStatus>('connecting');
  const [connection, setConnection] = useState<ConnectionAxis>('connecting');
  const [activeConnectionId, setActiveConnectionId] = useState<string | null>(null);
  const [entries, setEntries] = useState<CursorEntry[]>([]);

  const stageRef = useRef<HTMLDivElement | null>(null);
  const selfDotRef = useRef<HTMLDivElement | null>(null);

  // Mutable glue state lives in refs: the subscribe effect, the pointer
  // handler, and the force plane all need the CURRENT overlay/connection
  // without re-running effects or re-creating handlers per render.
  const overlayRef = useRef<EphemeralOverlay | null>(null);
  const connectionRef = useRef<ConnectionAxis>('connecting');
  const subscribedRef = useRef(true);
  const forcedRef = useRef<ForcedCell | null>(null);
  const recomputeRef = useRef<() => void>(() => {});
  const identityRef = useRef({ name, color });
  identityRef.current = { name, color };

  const publishState = useRef({
    writes: 0,
    published: 0,
    rejected: 0,
    establishedAtMs: null as number | null,
    lastPublishAtMs: 0,
    trailingTimer: null as ReturnType<typeof setTimeout> | null,
    pendingSample: null as { x: number; y: number } | null,
    disposed: false,
  });

  useEffect(() => {
    // Connection identity is PER SUBSCRIBE LIFECYCLE, not per page. The server
    // drops a connection's subscriptions and presence entries when its live
    // socket closes (Diary 0007: ws close → disconnect), so reusing one id
    // across React's mount/unmount/mount (StrictMode dev, HMR remounts) races
    // the old socket's server-side teardown against the new subscription —
    // the first live run of this arm lost one direction of convergence to
    // exactly that. A fresh id per effect instance makes each cycle's socket,
    // subscription, and presence entry independent by construction.
    const connectionId = `react_${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}_${Math.floor(Math.random() * 1e9)}`}`;
    let disposed = false;
    let offChange: (() => void) | null = null;
    let offState: (() => void) | null = null;
    let expiryTimer: ReturnType<typeof setTimeout> | null = null;
    let resyncTimer: ReturnType<typeof setTimeout> | null = null;
    let lostSinceSubscribe = false;
    setActiveConnectionId(connectionId);

    const presentedConnection = (): ConnectionAxis =>
      subscribedRef.current ? connectionRef.current : 'stale';

    const recompute = () => {
      if (disposed) return;
      const overlay = overlayRef.current;
      const forced = forcedRef.current;
      const axis = presentedConnection();
      setConnection(axis);
      if (forced) {
        setStatus(forced.status ?? 'ready');
        setEntries(
          forced.entries.map((entry) => ({
            key: entry.key,
            value: entry.value,
            updatedAt: entry.updatedAt ?? Date.now(),
            expiresAt: Number.MAX_SAFE_INTEGER,
            sourceClientId: entry.sourceClientId ?? entry.key,
            self: entry.self ?? false,
          })),
        );
        return;
      }
      if (!overlay) return;
      // Frozen semantics: past-TTL entries stay renderable while the
      // transport is degraded; on a healthy map they are pruned and never
      // exposed again (the Contract adapter's toMapCell rule).
      const frozen = axis === 'stale' || axis === 'disconnected';
      const now = Date.now();
      const next = overlay
        .currentEntries({ prune: false })
        .filter((entry) => frozen || entry.expiresAtMs > now)
        .map((entry) => ({
          key: entry.key,
          value: entry.value as CursorValue,
          updatedAt: entry.receivedAtMs,
          expiresAt: entry.expiresAtMs,
          sourceClientId: entry.key,
          self: entry.key === connectionId,
        }))
        .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
      setStatus('ready');
      setEntries(next);
      armExpiryTimer();
    };
    recomputeRef.current = recompute;

    // Pruning without a change event never re-renders: re-check at the
    // earliest future expiry so an idle room's departed cursor still ages out.
    const armExpiryTimer = () => {
      if (expiryTimer) {
        clearTimeout(expiryTimer);
        expiryTimer = null;
      }
      const overlay = overlayRef.current;
      if (!overlay || disposed || forcedRef.current) return;
      const now = Date.now();
      let earliest = Number.POSITIVE_INFINITY;
      for (const entry of overlay.currentEntries({ prune: false })) {
        if (entry.expiresAtMs > now && entry.expiresAtMs < earliest) earliest = entry.expiresAtMs;
      }
      if (!Number.isFinite(earliest)) return;
      expiryTimer = setTimeout(() => {
        expiryTimer = null;
        recompute();
      }, Math.max(16, earliest - now + 5));
    };

    const attemptResync = () => {
      if (disposed) return;
      void client
        .subscribeEphemeral(cursorsRef, { connectionId, scope: { roomId } })
        .then((fresh) => {
          if (disposed) {
            fresh.dispose();
            return;
          }
          const superseded = overlayRef.current;
          overlayRef.current = fresh;
          superseded?.dispose();
          subscribedRef.current = true;
          offChange?.();
          offChange = fresh.onChange(handleChange);
          recompute();
        })
        .catch(() => {
          if (disposed) return;
          resyncTimer = setTimeout(() => {
            resyncTimer = null;
            attemptResync();
          }, RESYNC_RETRY_MS);
        });
    };

    const handleChange = (result: string) => {
      if (result === 'needs_resync') {
        // Epoch boundary (collection replace / queue overflow): present the
        // honest degraded state and re-enter through a fresh
        // snapshot-with-subscribe, like the Contract adapter does.
        subscribedRef.current = false;
        recompute();
        attemptResync();
        return;
      }
      recompute();
    };

    // Connection axis: the shared live socket's state is the map's transport
    // truth (open → live, lost/budget-missed → stale, closed → disconnected).
    // Reconnect policy mirrors the kit's durable lane: an OPEN socket's loss
    // means the server dropped this connection's subscriptions, so a regained
    // socket must re-enter through a fresh snapshot-with-subscribe.
    const manager = client.liveStreamManager(connectionId);
    connectionRef.current = manager.isOpen() ? 'live' : 'connecting';
    offState = manager.onState((state, detail) => {
      if (state === 'lost' && detail?.wasOpen) lostSinceSubscribe = true;
      if (state === 'open' && overlayRef.current && lostSinceSubscribe) {
        lostSinceSubscribe = false;
        subscribedRef.current = false;
        attemptResync();
      }
      const next: ConnectionAxis =
        state === 'open'
          ? 'live'
          : state === 'budget-missed' || state === 'lost'
            ? 'stale'
            : state === 'closed'
              ? 'disconnected'
              : connectionRef.current;
      if (next !== connectionRef.current) {
        connectionRef.current = next;
        recompute();
      }
    });

    void client
      .subscribeEphemeral(cursorsRef, { connectionId, scope: { roomId } })
      .then((overlay) => {
        if (disposed) {
          // StrictMode double-mount: the first effect's subscribe may resolve
          // after its cleanup ran — never leak that overlay's lane consumer.
          overlay.dispose();
          return;
        }
        overlayRef.current = overlay;
        subscribedRef.current = true;
        offChange = overlay.onChange(handleChange);
        recompute();
      })
      .catch((error) => {
        if (disposed) return;
        console.error('[cursors-web react] ephemeral subscribe failed', error);
        setStatus('error');
      });

    return () => {
      disposed = true;
      offChange?.();
      offState?.();
      if (expiryTimer) clearTimeout(expiryTimer);
      if (resyncTimer) clearTimeout(resyncTimer);
      overlayRef.current?.dispose();
      overlayRef.current = null;
      recomputeRef.current = () => {};
      setActiveConnectionId(null);
    };
  }, [client, roomId]);

  // The publish path and the self dot never touch React state: pointer
  // samples throttle to the declared rate (leading + trailing edge, so the
  // final position always lands) and the dot is a direct style write.
  const room = useMemo<Pick<CursorRoom, 'onPointerMove' | 'publishFacts' | 'forceCursors'>>(() => {
    const publishSample = (sample: { x: number; y: number }) => {
      const overlay = overlayRef.current;
      const state = publishState.current;
      if (!overlay || state.disposed) return;
      const { name: currentName, color: currentColor } = identityRef.current;
      const value: CursorValue = {
        x: Math.round(sample.x),
        y: Math.round(sample.y),
        name: currentName,
        color: currentColor,
      };
      overlay
        .publish(value)
        .then(() => {
          state.published += 1;
          if (state.establishedAtMs === null) state.establishedAtMs = Date.now();
        })
        .catch(() => {
          state.rejected += 1;
        });
    };

    const throttledPublish = (sample: { x: number; y: number }) => {
      const state = publishState.current;
      state.pendingSample = sample;
      const now = Date.now();
      const since = now - state.lastPublishAtMs;
      if (since >= PUBLISH_INTERVAL_MS) {
        state.lastPublishAtMs = now;
        state.pendingSample = null;
        publishSample(sample);
        return;
      }
      if (state.trailingTimer === null) {
        state.trailingTimer = setTimeout(() => {
          state.trailingTimer = null;
          const pending = state.pendingSample;
          if (pending && !state.disposed) {
            state.lastPublishAtMs = Date.now();
            state.pendingSample = null;
            publishSample(pending);
          }
        }, PUBLISH_INTERVAL_MS - since);
      }
    };

    return {
      onPointerMove: (event: React.PointerEvent<HTMLElement>) => {
        const stage = stageRef.current;
        if (!stage) return;
        const rect = stage.getBoundingClientRect();
        const sample = { x: event.clientX - rect.left, y: event.clientY - rect.top };
        publishState.current.writes += 1;
        const dot = selfDotRef.current;
        if (dot) {
          dot.style.transform = `translate(${sample.x - SELF_DOT_HALF_PX}px, ${sample.y - SELF_DOT_HALF_PX}px)`;
          dot.style.opacity = '0.9';
        }
        throttledPublish(sample);
      },
      publishFacts: () => {
        const state = publishState.current;
        return {
          descriptor: cursorsRef.name,
          declaredRateHz: DECLARED_PUBLISH_RATE_HZ,
          budget: {
            sustainedHz: budgetFacts.sustainedHz,
            burst: budgetFacts.burst,
            maxValueBytes: budgetFacts.maxValueBytes,
          },
          writes: state.writes,
          published: state.published,
          rejected: state.rejected,
          established: state.establishedAtMs !== null,
          establishedAtMs: state.establishedAtMs,
        };
      },
      forceCursors: (cell: ForcedCell) => {
        // LOCAL-ONLY by construction: the forced cell swaps what THIS window
        // renders; nothing is published, and the live overlay keeps applying
        // socket frames underneath so dispose restores current live state.
        forcedRef.current = cell;
        recomputeRef.current();
        return {
          dispose: () => {
            if (forcedRef.current === cell) {
              forcedRef.current = null;
              recomputeRef.current();
            }
          },
        };
      },
    };
  }, []);

  useEffect(() => {
    const state = publishState.current;
    state.disposed = false;
    return () => {
      state.disposed = true;
      if (state.trailingTimer !== null) {
        clearTimeout(state.trailingTimer);
        state.trailingTimer = null;
      }
    };
  }, []);

  return {
    status,
    connection,
    connectionId: activeConnectionId,
    entries,
    onPointerMove: room.onPointerMove,
    stageRef,
    selfDotRef,
    publishFacts: room.publishFacts,
    forceCursors: room.forceCursors,
  };
}
