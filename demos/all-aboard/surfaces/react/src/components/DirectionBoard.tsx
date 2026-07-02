// The home screen: direction toggle, the expanded hero departure with its
// upcoming stops, the next few departures, and the opposite-direction line.

import { directionTitle, formatCountdownMinutes, serviceColor } from '../../../../snapback/shared/model.mjs';
import { URGENT_RED, URGENT_TINT, formatTime, isUrgent, serviceTint, upcomingStops } from '../lib.ts';
import { Press, ServicePill, chip, column, hairlineCard, mono, palette, row } from '../ui.tsx';

export interface Departure {
  id: string;
  service: string;
  trainNumber: string;
  headsign: string;
  predictedDepartureMs: number;
}

export interface Board {
  primary: Departure | null;
  secondary: Departure[];
}

export function DirectionBoard(props: {
  stationId: string;
  nowMs: number;
  activeDir: string;
  oppositeDir: string;
  primaryBoard: Board;
  oppositeBoard: Board;
  delays: Record<string, number>;
  use24h: boolean;
  onToggleDirection: (next: string) => void;
  onOpenTrip: (id: string) => void;
}) {
  const { primaryBoard, oppositeBoard, nowMs } = props;
  const hero = primaryBoard.primary;
  const heroUrgent = hero != null && isUrgent(hero.predictedDepartureMs, nowMs);

  return (
    <div data-testid="home-screen" style={{ ...column, gap: 12, width: '100%' }}>
      <div
        data-testid="direction-toggle"
        style={{ ...row, gap: 8, alignItems: 'center', justifyContent: 'space-between' }}
      >
        <div data-testid="active-direction" style={{ fontSize: 16, fontWeight: 800, color: palette.ink }}>
          {directionTitle(props.activeDir)}
        </div>
        <Press
          onPress={() => props.onToggleDirection(props.oppositeDir)}
          label="Flip direction"
          testId="flip-direction"
          style={chip()}
        >
          <div style={{ fontSize: 12, fontWeight: 700, color: palette.accent }}>
            {`Show ${directionTitle(props.oppositeDir)}`}
          </div>
        </Press>
      </div>

      {hero ? (
        <div style={{ ...column, gap: 10, width: '100%' }}>
          {/* Hero: the next train in the assumed direction, expanded with stops. */}
          <Press
            onPress={() => props.onOpenTrip(hero.id)}
            label="Open next train"
            testId="hero-departure"
            style={{ width: '100%' }}
          >
            <div style={hairlineCard({ borderRadius: 16, padding: 16, gap: 12, width: '100%' })}>
              <div style={{ ...row, gap: 10, alignItems: 'flex-end' }}>
                <div
                  data-testid="hero-minutes"
                  style={{ fontSize: 60, fontWeight: 800, fontFamily: mono, color: heroUrgent ? URGENT_RED : palette.ink }}
                >
                  {formatCountdownMinutes(hero.predictedDepartureMs, nowMs)}
                </div>
                <div style={{ fontSize: 16, color: palette.inkFaint, paddingBottom: 10 }}>min</div>
                <div style={{ ...column, flex: 1, alignItems: 'flex-end', gap: 4 }}>
                  {heroUrgent && (
                    <div style={{ borderRadius: 6, padding: '3px 8px', background: URGENT_TINT }}>
                      <div
                        data-testid="hero-leaving-soon"
                        style={{ fontSize: 12, fontWeight: 700, color: URGENT_RED }}
                      >
                        Leaving soon
                      </div>
                    </div>
                  )}
                  <ServicePill
                    service={hero.service}
                    color={serviceColor(hero.service)}
                    tint={serviceTint(hero.service)}
                    testId="hero-service"
                  />
                  <div style={{ fontSize: 12, color: palette.inkFaint }}>
                    {`${formatTime(hero.predictedDepartureMs, props.use24h)} · #${hero.trainNumber}`}
                  </div>
                </div>
              </div>
              <div style={{ fontSize: 14, fontWeight: 600, color: palette.inkSoft }}>{`to ${hero.headsign}`}</div>
              <div style={{ ...column, width: '100%' }}>
                {upcomingStops(hero.id, props.stationId, nowMs, props.delays, props.use24h, 6).map((stop) => (
                  <div key={stop.id} style={{ ...row, gap: 10, alignItems: 'center', padding: '4px 0' }}>
                    <div style={{ fontSize: 12, fontFamily: mono, color: palette.inkFaint, width: 52 }}>
                      {stop.time}
                    </div>
                    <div
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: 4,
                        background: stop.isBoarding ? palette.accent : palette.track,
                      }}
                    />
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: stop.isBoarding ? 700 : 500,
                        color: stop.isBoarding ? palette.accent : palette.ink,
                      }}
                    >
                      {stop.name}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </Press>

          {/* Next three trains in the assumed direction. */}
          {primaryBoard.secondary.map((d) => (
            <Press
              key={d.id}
              onPress={() => props.onOpenTrip(d.id)}
              label="Open train"
              testId={`departure-${d.id}`}
              style={{ width: '100%' }}
            >
              <div
                style={hairlineCard({
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  borderRadius: 12,
                  padding: '12px 14px',
                  width: '100%',
                })}
              >
                <div style={{ ...row, gap: 10, alignItems: 'center' }}>
                  <div
                    style={{
                      fontSize: 16,
                      fontWeight: 700,
                      fontFamily: mono,
                      color: isUrgent(d.predictedDepartureMs, nowMs) ? URGENT_RED : palette.ink,
                      width: 64,
                    }}
                  >
                    {`${formatCountdownMinutes(d.predictedDepartureMs, nowMs)} min`}
                  </div>
                  <ServicePill
                    service={d.service}
                    color={serviceColor(d.service)}
                    tint={serviceTint(d.service)}
                    size={11}
                  />
                </div>
                <div style={{ fontSize: 12, color: palette.inkFaint }}>
                  {`${formatTime(d.predictedDepartureMs, props.use24h)} · ${d.headsign}`}
                </div>
              </div>
            </Press>
          ))}
        </div>
      ) : (
        <div style={hairlineCard({ borderRadius: 14, padding: 16 })}>
          <div data-testid="no-trains" style={{ fontSize: 14, color: palette.inkSoft }}>
            No more trains today in this direction.
          </div>
        </div>
      )}

      {/* Opposite direction, minimal (next train only). */}
      {oppositeBoard.primary && (
        <div
          data-testid="opposite-line"
          style={hairlineCard({
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            borderRadius: 12,
            padding: '10px 14px',
          })}
        >
          <div style={{ fontSize: 13, fontWeight: 700, color: palette.inkSoft }}>
            {directionTitle(props.oppositeDir)}
          </div>
          <div
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: isUrgent(oppositeBoard.primary.predictedDepartureMs, nowMs) ? URGENT_RED : palette.ink,
              fontFamily: mono,
            }}
          >
            {`${formatCountdownMinutes(oppositeBoard.primary.predictedDepartureMs, nowMs)} min`}
          </div>
        </div>
      )}
    </div>
  );
}
