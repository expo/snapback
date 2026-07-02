// The trip screen: a dark sheet over the artwork — service + train header,
// live position bar (service-colored), the ordered stop list with the boarding
// station highlighted, and Back.

import { formatClockTime, serviceColor } from '../../../../snapback/shared/model.mjs';
import { delayLabel, fractionPercent, positionFraction, positionLabel, serviceTint } from '../lib.ts';
import type { TripPosition } from '../lib.ts';
import { Press, ServicePill, column, mono, palette, pill, row } from '../ui.tsx';

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
  delaySeconds?: number;
  stops: TripStop[];
  position?: TripPosition | null;
}

export function TripDetail(props: { trip: Trip | null; stationId: string; onGoHome: () => void }) {
  const { trip } = props;

  return (
    <div
      data-testid="trip-screen"
      style={{ position: 'absolute', inset: 0, background: palette.sheet, overflowY: 'auto' }}
    >
      <div
        style={{ ...column, gap: 12, padding: '22px 20px 20px', maxWidth: 620, margin: '0 auto', width: '100%' }}
      >
        <div style={{ ...row, justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
          <Press onPress={props.onGoHome} label="Back" testId="trip-back" style={pill()}>
            <div style={{ fontSize: 12, fontWeight: 700, color: palette.inkStrong }}>‹ Board</div>
          </Press>
          {trip && (
            <ServicePill service={trip.service} color={serviceColor(trip.service)} tint={serviceTint(trip.service)} />
          )}
        </div>
        {trip ? (
          <div style={{ ...column, gap: 12, width: '100%' }}>
            <div style={{ ...column, gap: 3 }}>
              <h1 style={{ margin: 0, fontSize: 28, fontWeight: 800, color: palette.ink }}>
                {`Train ${trip.trainNumber}`}
              </h1>
              <div style={{ fontSize: 14, color: palette.inkSoft }}>
                {`${trip.origin.name} → ${trip.destination.name}`}
              </div>
              <div style={{ fontSize: 12, color: palette.inkDim }}>
                {`${trip.durationMinutes} min · ${trip.stopCount} stops · ${delayLabel(trip)}`}
              </div>
            </div>
            <div
              style={{
                ...column,
                gap: 8,
                borderRadius: 16,
                padding: 14,
                background: palette.glass,
                border: `1px solid ${palette.hairline}`,
              }}
            >
              <div data-testid="position-label" style={{ fontSize: 13, fontWeight: 600, color: palette.inkBody }}>
                {positionLabel(trip)}
              </div>
              <div style={{ height: 6, borderRadius: 3, background: '#ffffff1f', width: '100%' }}>
                <div
                  data-testid="position-bar"
                  style={{
                    height: 6,
                    borderRadius: 3,
                    background: serviceColor(trip.service),
                    width: fractionPercent(positionFraction(trip)),
                  }}
                />
              </div>
            </div>
            <div
              style={{
                ...column,
                borderRadius: 16,
                padding: 8,
                background: palette.glass,
                border: `1px solid ${palette.hairline}`,
              }}
            >
              {trip.stops.map((stop) => {
                const isBoarding = stop.station.id === props.stationId;
                return (
                  <div
                    key={stop.station.id}
                    style={{
                      ...row,
                      gap: 12,
                      alignItems: 'center',
                      padding: '7px 10px',
                      borderRadius: 10,
                      background: isBoarding ? '#ffffff14' : 'transparent',
                    }}
                  >
                    <div style={{ fontSize: 13, fontFamily: mono, color: palette.inkDim, width: 56 }}>
                      {formatClockTime(stop.predictedTimeMs)}
                    </div>
                    <div
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: 4,
                        background: isBoarding ? palette.ink : '#ffffff42',
                        flexShrink: 0,
                      }}
                    />
                    <div
                      style={{
                        fontSize: 14,
                        fontWeight: isBoarding ? 700 : 400,
                        color: isBoarding ? palette.ink : palette.inkBody,
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
      </div>
    </div>
  );
}
