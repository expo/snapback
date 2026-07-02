// The station header card: photo, name, prev/next + change-station nav,
// walk/bike summary, location hint, and the freshness row with Refresh.

import { stationPhoto, stationPhotoCredit } from '../../../../snapback/shared/model.mjs';
import { feedFreshness, locationHint, walkBikeSummary } from '../lib.ts';
import type { FeedRow, LatLng, LocationSource } from '../store.ts';
import { Press, chip, column, hairlineCard, palette, row } from '../ui.tsx';

export interface Station {
  id: string;
  name: string;
  shortName: string;
  orderIndex: number;
  zone: number;
  lat: number;
  lng: number;
}

export function StationCard(props: {
  station: Station;
  location: LatLng;
  locationSource: LocationSource;
  feed: FeedRow | null;
  nowMs: number;
  prevStationId: string;
  nextStationId: string;
  onGoToStation: (id: string) => void;
  onOpenStations: () => void;
  onRefresh: () => void;
  use24h: boolean;
  onToggleTimeFormat: () => void;
}) {
  const { station } = props;
  const photoSvg: string = stationPhoto(station.id);
  const credit: string = stationPhotoCredit(station.id);

  return (
    <section
      data-testid="station-card"
      style={hairlineCard({ borderRadius: 18, width: '100%', overflow: 'hidden' })}
    >
      {photoSvg === '' ? (
        <div
          style={{
            ...column,
            height: 120,
            width: '100%',
            background: palette.photoFallback,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 700, color: palette.photoFallbackInk }}>Caltrain</div>
        </div>
      ) : (
        <img
          src={`data:image/svg+xml;utf8,${encodeURIComponent(photoSvg)}`}
          alt={`${station.name} station`}
          style={{ width: '100%', height: 132, objectFit: 'cover', display: 'block' }}
        />
      )}
      {credit !== '' && (
        <div style={{ ...row, width: '100%', padding: '6px 16px 2px', background: palette.card }}>
          <div data-testid="photo-credit" style={{ fontSize: 10, color: palette.inkFaintest }}>
            {credit}
          </div>
        </div>
      )}
      <div style={{ ...column, gap: 8, padding: 16 }}>
        <div style={{ ...row, justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
          <div style={{ ...column, gap: 2 }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.4, color: palette.accent }}>CALTRAIN</div>
            <h1 data-testid="station-name" style={{ margin: 0, fontSize: 26, fontWeight: 800, color: palette.ink }}>
              {station.name}
            </h1>
          </div>
          <div style={{ ...column, gap: 6, alignItems: 'flex-end' }}>
            <div style={{ ...row, gap: 6 }}>
              <Press
                onPress={() => props.onGoToStation(props.prevStationId)}
                label="Previous station"
                testId="prev-station"
                style={chip()}
              >
                <div style={{ fontSize: 14, fontWeight: 800, color: palette.accent }}>◀</div>
              </Press>
              <Press
                onPress={() => props.onGoToStation(props.nextStationId)}
                label="Next station"
                testId="next-station"
                style={chip()}
              >
                <div style={{ fontSize: 14, fontWeight: 800, color: palette.accent }}>▶</div>
              </Press>
            </div>
            <Press
              onPress={props.onOpenStations}
              label="Change station"
              testId="change-station"
              style={chip({ background: palette.card, borderColor: palette.hairlineStrong })}
            >
              <div style={{ fontSize: 12, fontWeight: 600, color: palette.inkSoft }}>Change station</div>
            </Press>
            <Press
              onPress={props.onToggleTimeFormat}
              label="Toggle time format"
              testId="time-format"
              style={chip({ background: palette.card, borderColor: palette.hairlineStrong })}
            >
              <div style={{ fontSize: 12, fontWeight: 600, color: palette.inkSoft }}>
                {props.use24h ? '24h times' : '12h times'}
              </div>
            </Press>
          </div>
        </div>
        <div data-testid="walk-bike" style={{ fontSize: 13, color: palette.inkSoft }}>
          {walkBikeSummary(station, props.location)}
        </div>
        <div data-testid="location-hint" style={{ fontSize: 12, color: palette.inkFaint }}>
          {locationHint(props.locationSource)}
        </div>
        <div style={{ ...row, justifyContent: 'space-between', alignItems: 'center' }}>
          <div data-testid="freshness" style={{ fontSize: 12, color: palette.inkFaint }}>
            {feedFreshness(props.feed, props.nowMs)}
          </div>
          <Press
            onPress={props.onRefresh}
            label="Refresh"
            testId="refresh"
            style={{ padding: '5px 10px', borderRadius: 7, background: palette.accent }}
          >
            <div style={{ fontSize: 12, fontWeight: 700, color: '#ffffff' }}>Refresh</div>
          </Press>
        </div>
      </div>
    </section>
  );
}
