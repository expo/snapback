// The stations screen: search input, match rows, and Back.

import { searchStations } from '../../../../snapback/shared/model.mjs';
import { walkBikeSummary } from '../lib.ts';
import type { LatLng } from '../store.ts';
import type { Station } from './StationCard.tsx';
import { Press, chip, column, hairlineCard, mono, palette, row } from '../ui.tsx';

export function StationsPicker(props: {
  query: string;
  location: LatLng;
  onSetQuery: (value: string) => void;
  onGoToStation: (id: string) => void;
  onGoHome: () => void;
}) {
  const matches: Station[] = searchStations(props.query, props.location);

  return (
    <div data-testid="stations-screen" style={{ ...column, gap: 10, width: '100%' }}>
      <input
        value={props.query}
        onChange={(event) => props.onSetQuery(event.target.value)}
        placeholder="Search stations"
        aria-label="Search stations"
        data-testid="station-search"
        style={{
          font: 'inherit',
          padding: 12,
          borderRadius: 10,
          background: palette.card,
          border: `1px solid ${palette.hairlineStrong}`,
          color: palette.ink,
          fontSize: 14,
        }}
      />
      <div style={{ ...column, gap: 6 }}>
        {matches.map((s) => (
          <Press
            key={s.id}
            onPress={() => props.onGoToStation(s.id)}
            label={s.name}
            testId={`station-${s.id}`}
            style={{ width: '100%' }}
          >
            <div
              style={hairlineCard({
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '12px 14px',
                borderRadius: 10,
                width: '100%',
              })}
            >
              <div style={{ ...column, gap: 2, alignItems: 'flex-start' }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: palette.ink }}>{s.name}</div>
                <div style={{ fontSize: 12, color: palette.inkFaint }}>{`Zone ${s.zone}`}</div>
              </div>
              <div style={{ fontSize: 11, fontFamily: mono, color: palette.inkFaint }}>
                {walkBikeSummary(s, props.location)}
              </div>
            </div>
          </Press>
        ))}
      </div>
      <Press
        onPress={props.onGoHome}
        label="Back"
        testId="stations-back"
        style={chip({ padding: '10px 14px', borderRadius: 10 })}
      >
        <div style={{ fontSize: 13, fontWeight: 700, color: palette.accent }}>Back</div>
      </Press>
    </div>
  );
}
