// The stations screen: a dark sheet over the artwork — search, match rows
// (current station highlighted), Done.

import { searchStations } from '../../../../snapback/shared/model.mjs';
import { distanceLabel } from '../lib.ts';
import type { Station } from '../lib.ts';
import type { LatLng } from '../store.ts';
import { Press, column, mono, palette, pill, row } from '../ui.tsx';

export function StationsPicker(props: {
  query: string;
  location: LatLng;
  nowMs: number;
  currentStationId: string;
  onSetQuery: (value: string) => void;
  onGoToStation: (id: string) => void;
  onGoHome: () => void;
}) {
  const matches: Station[] = searchStations(props.query, props.location);

  return (
    <div
      data-testid="stations-screen"
      style={{ position: 'absolute', inset: 0, background: palette.sheet, overflowY: 'auto' }}
    >
      <div
        style={{ ...column, gap: 10, padding: '22px 20px 20px', maxWidth: 620, margin: '0 auto', width: '100%' }}
      >
        <div style={{ ...row, justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800, color: palette.ink }}>Stations</h1>
          <Press onPress={props.onGoHome} label="Back" testId="stations-back" style={pill()}>
            <div style={{ fontSize: 12, fontWeight: 700, color: palette.inkStrong }}>Done</div>
          </Press>
        </div>
        <input
          value={props.query}
          onChange={(event) => props.onSetQuery(event.target.value)}
          placeholder="Search stations"
          aria-label="Search stations"
          data-testid="station-search"
          style={{
            font: 'inherit',
            padding: 12,
            borderRadius: 12,
            background: '#ffffff14',
            border: '1px solid #ffffff26',
            color: palette.ink,
            fontSize: 14,
          }}
        />
        <div style={{ ...column, gap: 2 }}>
          {matches.map((s) => (
            <Press
              key={s.id}
              onPress={() => props.onGoToStation(s.id)}
              label={s.name}
              testId={`station-${s.id}`}
              style={{ width: '100%' }}
            >
              <div
                style={{
                  ...row,
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 12,
                  padding: '11px 12px',
                  borderRadius: 12,
                  background: s.id === props.currentStationId ? '#ffffff17' : 'transparent',
                  width: '100%',
                }}
              >
                <div style={{ ...column, gap: 2, alignItems: 'flex-start' }}>
                  <div
                    style={{ fontSize: 15, fontWeight: s.id === props.currentStationId ? 700 : 600, color: palette.ink }}
                  >
                    {s.name}
                  </div>
                  <div style={{ fontSize: 11.5, color: palette.inkFaint }}>{`Zone ${s.zone}`}</div>
                </div>
                <div style={{ fontSize: 12, fontFamily: mono, color: palette.inkDim }}>
                  {distanceLabel(s, props.location)}
                </div>
              </div>
            </Press>
          ))}
        </div>
      </div>
    </div>
  );
}
