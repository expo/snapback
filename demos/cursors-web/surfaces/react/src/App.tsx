// Cursor presence — React control-arm view (ENG-22531).
//
// Same product, same testIds, same visual treatment as the Contract arm
// (surfaces/contract/app.contract): a full-viewport stage publishing this
// window's pointer, every subscribed window's cursors rendered live from the
// room's ephemeral map, the self entry styled distinctly, and a zero-latency
// self dot that never rides the React render path.

import { useEffect, useRef, useState, type CSSProperties } from 'react';

import type { SnapbackClient, KitReceipt } from '../../../../_kit/client.mjs';
import { CURSOR_PALETTE } from './palette';
import { IDLE_FADE_MS, useCursorRoom, type CursorRoom, type PublishFacts } from './useCursorRoom';

export interface Identity {
  name: string;
  color: string;
}

interface AppProps {
  client: SnapbackClient;
  roomId: string;
  identity: Identity;
}

interface CursorsWebDebug {
  room: string;
  identity: Identity;
  connection: string;
  publishFacts: () => PublishFacts;
  receipts: () => KitReceipt[];
  forceGhost: () => boolean;
  disposeGhost: () => void;
}

export function App({ client, roomId, identity }: AppProps) {
  // E5: the chosen color is ordinary React state riding the publish payload;
  // selecting a swatch re-publishes at the last known position so the room
  // sees the change without waiting for movement.
  const [color, setColor] = useState(identity.color);
  const room = useCursorRoom({
    client,
    roomId,
    name: identity.name,
    color,
  });

  // E6: a 1s clock drives the idle-fade computation. A cursor whose last
  // MOVEMENT (value.updatedAt) is older than IDLE_FADE_MS renders at low
  // opacity in every client; a fresh move restores it.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Re-publish AFTER the color commit (an effect, not inline after setColor):
  // the publish payload reads the identity ref, which only carries the new
  // color once this render commits — calling republishIdentity inside the
  // click handler would publish the stale color. (Stale-state footgun caught
  // in review; recorded in diary 0011.)
  const firstColorRender = useRef(true);
  useEffect(() => {
    if (firstColorRender.current) {
      firstColorRender.current = false;
      return;
    }
    room.republishIdentity();
  }, [color, room.republishIdentity]);

  useDebugSurface({ client, roomId, name: identity.name, color, room });

  return (
    <main data-testid="cursor-room" style={styles.root}>
      <div
        data-testid="cursor-stage"
        ref={room.stageRef}
        onPointerMove={room.onPointerMove}
        style={styles.stage}
      >
        <div style={styles.header}>
          <h1 style={styles.title}>Cursor presence — React surface</h1>
          <div data-testid="map-status" style={styles.meta}>
            {`room: ${roomId} · map: ${room.status} · connection: ${room.connection}`}
          </div>
          <div data-testid="cursor-count" style={styles.meta}>
            {`${room.entries.length} cursors`}
          </div>
          <div style={styles.hint}>Move your pointer — other windows in this room see it live.</div>
          <div data-testid="color-picker" style={styles.picker}>
            {CURSOR_PALETTE.map((swatch, index) => (
              <button
                key={swatch}
                type="button"
                data-testid={`color-swatch-${index}`}
                aria-label={`Use cursor color ${swatch}`}
                onClick={() => setColor(swatch)}
                style={{
                  ...styles.swatch,
                  background: swatch,
                  border: swatch === color ? '2px solid #ffffff' : '2px solid transparent',
                }}
              />
            ))}
          </div>
        </div>
        {room.entries.map((cursor) => (
          <div
            key={cursor.key}
            data-testid={`cursor-${cursor.key}`}
            style={{
              ...styles.cursor,
              left: cursor.value.x,
              top: cursor.value.y,
              opacity: nowMs - (cursor.value.updatedAt ?? cursor.updatedAt) > IDLE_FADE_MS ? 0.25 : 1,
            }}
          >
            <div
              style={{
                ...styles.cursorDot,
                background: cursor.value.color,
                border: cursor.self ? '2px solid #ffffff' : undefined,
              }}
            />
            <div
              data-testid={`cursor-name-${cursor.key}`}
              style={{
                ...styles.cursorName,
                fontWeight: cursor.self ? 800 : 500,
                color: cursor.self ? '#ffffff' : '#c8cede',
              }}
            >
              {cursor.value.name}
            </div>
          </div>
        ))}
        <div data-testid="self-dot" ref={room.selfDotRef} style={styles.selfDot} />
      </div>
    </main>
  );
}

// The test/debug facts the acceptance suite drives — the same product claims
// the Contract arm exposes (forced-map LOCAL-ONLY + dispose-restores, publish
// facts, kit receipts), assembled by hand here.
function useDebugSurface({
  client,
  roomId,
  name,
  color,
  room,
}: {
  client: SnapbackClient;
  roomId: string;
  name: string;
  color: string;
  room: CursorRoom;
}) {
  const ghostRef = useRef<{ dispose: () => void } | null>(null);
  const connectionId = room.connectionId;
  useEffect(() => {
    // The debug surface appears once the room's connection identity is
    // established — the acceptance suite polls for it, so "cursorsWeb exists"
    // means "subscribed under this connection id".
    if (connectionId === null) return;
    const debug: CursorsWebDebug = {
      room: roomId,
      identity: { name, color },
      connection: connectionId,
      publishFacts: room.publishFacts,
      receipts: () => client.receipts(),
      forceGhost: () => {
        ghostRef.current?.dispose();
        ghostRef.current = room.forceCursors({
          status: 'ready',
          entries: [
            {
              key: 'ghost',
              value: { x: 80, y: 140, name: 'Ghost (forced)', color: '#f012be' },
              updatedAt: 1,
              sourceClientId: 'ghost',
              self: false,
            },
          ],
        });
        return Boolean(ghostRef.current);
      },
      disposeGhost: () => {
        ghostRef.current?.dispose();
        ghostRef.current = null;
      },
    };
    (globalThis as { cursorsWeb?: CursorsWebDebug }).cursorsWeb = debug;
    return () => {
      ghostRef.current?.dispose();
      ghostRef.current = null;
      if ((globalThis as { cursorsWeb?: CursorsWebDebug }).cursorsWeb === debug) {
        delete (globalThis as { cursorsWeb?: CursorsWebDebug }).cursorsWeb;
      }
    };
    // The debug surface re-wires only when the room identity changes, not per
    // render — publishFacts/forceCursors are stable references from the hook.
  }, [client, connectionId, roomId, name, color, room.publishFacts, room.forceCursors]);
}

const styles = {
  root: {
    background: '#05070f',
    width: '100%',
    minHeight: '100vh',
  },
  stage: {
    position: 'relative',
    width: '100%',
    height: '100vh',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    flexDirection: 'column',
    padding: 20,
    gap: 6,
  },
  title: {
    margin: 0,
    fontSize: 18,
    fontWeight: 700,
    color: '#e6e9f2',
  },
  meta: {
    fontSize: 12,
    color: '#8b93a7',
  },
  hint: {
    fontSize: 12,
    color: '#5f6579',
  },
  picker: {
    display: 'flex',
    flexDirection: 'row',
    gap: 6,
    marginTop: 4,
  },
  swatch: {
    width: 18,
    height: 18,
    borderRadius: 9,
    padding: 0,
    cursor: 'pointer',
  },
  cursor: {
    position: 'absolute',
    display: 'flex',
    flexDirection: 'column',
    gap: 3,
    alignItems: 'flex-start',
  },
  cursorDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  cursorName: {
    fontSize: 10,
  },
  selfDot: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: 16,
    height: 16,
    borderRadius: 8,
    border: '2px solid #ffffff',
    background: 'transparent',
    opacity: 0,
  },
} satisfies Record<string, CSSProperties>;
