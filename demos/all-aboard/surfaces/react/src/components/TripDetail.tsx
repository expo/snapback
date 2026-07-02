// The trip screen: service + train header, live position bar, the ordered
// stop list (boarding station highlighted), and Back.

import { formatClockTime, serviceColor } from '../../../../snapback/shared/model.mjs';
import { fractionPercent, positionFraction, positionLabel, serviceTint } from '../lib.ts';
import { Press, ServicePill, chip, column, hairlineCard, mono, palette, row } from '../ui.tsx';

interface TripStop {
  station: { id: string; name: string };
  predictedTimeMs: number;
}

export interface Trip {
  id: string;
  service: string;
  trainNumber: string;
  origin: { name: string };
  destination: { name: string };
  durationMinutes: number;
  stopCount: number;
  stops: TripStop[];
  position?: { state: string; prevStationId: string | null; nextStationId: string | null; corridorFraction: number } | null;
}

export function TripDetail(props: { trip: Trip | null; stationId: string; onGoHome: () => void }) {
  const { trip } = props;

  return (
    <div data-testid="trip-screen" style={{ ...column, gap: 12, width: '100%' }}>
      {trip ? (
        <div style={{ ...column, gap: 12, width: '100%' }}>
          <div style={{ ...column, gap: 6 }}>
            <div style={{ ...row, gap: 8, alignItems: 'center' }}>
              <ServicePill
                service={trip.service}
                color={serviceColor(trip.service)}
                tint={serviceTint(trip.service)}
              />
              <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: palette.ink }}>
                {`Train ${trip.trainNumber}`}
              </h1>
            </div>
            <div style={{ fontSize: 14, color: palette.inkSoft }}>
              {`${trip.origin.name} → ${trip.destination.name}`}
            </div>
            <div style={{ fontSize: 12, color: palette.inkFaint }}>
              {`${trip.durationMinutes} min · ${trip.stopCount} stops`}
            </div>
          </div>
          <div style={hairlineCard({ gap: 6, borderRadius: 12, padding: 14 })}>
            <div data-testid="position-label" style={{ fontSize: 13, fontWeight: 600, color: palette.inkSoft }}>
              {positionLabel(trip)}
            </div>
            <div style={{ height: 8, borderRadius: 4, background: palette.hairline, width: '100%' }}>
              <div
                data-testid="position-bar"
                style={{
                  height: 8,
                  borderRadius: 4,
                  background: palette.accent,
                  width: fractionPercent(positionFraction(trip)),
                }}
              />
            </div>
          </div>
          <div style={hairlineCard({ borderRadius: 12, padding: 14 })}>
            {trip.stops.map((stop) => {
              const isBoarding = stop.station.id === props.stationId;
              return (
                <div key={stop.station.id} style={{ ...row, gap: 12, alignItems: 'center', padding: '6px 0' }}>
                  <div style={{ fontSize: 13, fontFamily: mono, color: palette.inkFaint, width: 56 }}>
                    {formatClockTime(stop.predictedTimeMs)}
                  </div>
                  <div
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: 5,
                      background: isBoarding ? palette.accent : palette.track,
                    }}
                  />
                  <div
                    style={{
                      fontSize: 14,
                      fontWeight: isBoarding ? 700 : 400,
                      color: isBoarding ? palette.accent : palette.ink,
                    }}
                  >
                    {stop.station.name}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div style={{ fontSize: 14, color: palette.inkSoft }}>Train not found</div>
      )}
      <Press
        onPress={props.onGoHome}
        label="Back"
        testId="trip-back"
        style={chip({ padding: '10px 14px', borderRadius: 10 })}
      >
        <div style={{ fontSize: 13, fontWeight: 700, color: palette.accent }}>Back</div>
      </Press>
    </div>
  );
}
