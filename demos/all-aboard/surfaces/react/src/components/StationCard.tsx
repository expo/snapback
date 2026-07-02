// The station identity block, typeset on the artwork: wordmark + change-station
// pill, the station name, and the zone / walk / bike / location lines.

import { etaModeLabel } from '../lib.ts';
import type { EtaMode, Station } from '../lib.ts';
import { Press, column, palette, pill, row } from '../ui.tsx';

export function StationCard(props: {
  station: Station;
  walkBike: string;
  locHint: string;
  etaMode: EtaMode;
  onOpenStations: () => void;
  onToggleEtaMode: () => void;
}) {
  const { station } = props;

  return (
    <div
      data-testid="station-card"
      style={{
        ...column,
        gap: 4,
        padding: '20px 22px 0',
        width: '100%',
        maxWidth: 620,
        alignSelf: 'center',
      }}
    >
      <div style={{ ...row, justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
        <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 2.6, color: '#ffffffc9' }}>CALTRAIN</div>
        <Press onPress={props.onOpenStations} label="Change station" testId="change-station" style={pill()}>
          <div style={{ fontSize: 12, fontWeight: 600, color: palette.inkStrong }}>Change station</div>
        </Press>
      </div>
      <h1
        data-testid="station-name"
        style={{ margin: 0, fontSize: 38, fontWeight: 800, lineHeight: '42px', color: palette.ink }}
      >
        {station.name}
      </h1>
      {/* E4: the ETA mode control — the summary (and the stations-list rows)
          follow the selected mode app-wide. */}
      <div style={{ ...row, justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
        <div data-testid="walk-bike" style={{ fontSize: 13, color: palette.inkSoft }}>
          {`Zone ${station.zone} · ${props.walkBike}`}
        </div>
        <Press
          onPress={props.onToggleEtaMode}
          label="Toggle ETA mode"
          testId="eta-mode"
          style={{ padding: '4px 10px', borderRadius: 999, background: '#ffffff12', border: '1px solid #ffffff1a' }}
        >
          <div style={{ fontSize: 11, fontWeight: 700, color: palette.inkStrong }}>{etaModeLabel(props.etaMode)}</div>
        </Press>
      </div>
      <div data-testid="location-hint" style={{ fontSize: 12, color: palette.inkFaint }}>
        {props.locHint}
      </div>
    </div>
  );
}
