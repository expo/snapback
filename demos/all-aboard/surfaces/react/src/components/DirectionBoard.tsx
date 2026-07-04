// The board: direction row, the giant hero countdown expanded with its stops,
// the ▲▼ train-selection arrows, the three departures after it, the opposite
// direction line, and the freshness / refresh / credit footer.

import { directionTitle, formatClockTime, formatCountdownMinutes, serviceColor } from '../../../../snapback/shared/model.mjs';
import { delayColor, delayLabel, serviceFilterOptions, serviceTint, shortHeadsign, upcomingStops } from '../lib.ts';
import type { Departure, FeedSourceBadge, HeroBoard } from '../lib.ts';
import type { DelayRow } from '../store.ts';
import { Press, ServicePill, column, mono, palette, pill, row } from '../ui.tsx';

export interface OppositeBoard {
  primary: Departure | null;
  secondary: Departure[];
}

const tabular: React.CSSProperties = { fontFamily: mono, fontVariantNumeric: 'tabular-nums' };

export function DirectionBoard(props: {
  stationId: string;
  nowMs: number;
  activeDir: string;
  oppositeDir: string;
  board: HeroBoard;
  oppositeBoard: OppositeBoard;
  serviceFilter: string;
  freshness: string;
  feedIssue: string;
  feedSource: FeedSourceBadge;
  photoCredit: string;
  delayRows: readonly DelayRow[];
  onToggleDirection: (next: string) => void;
  onOpenTrip: (id: string) => void;
  onTrainPrev: () => void;
  onTrainNext: () => void;
  onSetServiceFilter: (value: string) => void;
  onRefresh: () => void;
}) {
  const { board, oppositeBoard, nowMs } = props;
  const hero = board.hero;

  const arrow = (label: string, testId: string, glyph: string, enabled: boolean, onPress: () => void) => (
    <Press
      onPress={onPress}
      label={label}
      testId={testId}
      disabled={!enabled}
      style={{
        width: 38,
        height: 38,
        borderRadius: 19,
        background: '#ffffff17',
        border: '1px solid #ffffff21',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: enabled ? 1 : 0.35,
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 800, color: palette.inkBody }}>{glyph}</div>
    </Press>
  );

  return (
    <div
      data-testid="home-screen"
      style={{
        ...column,
        gap: 9,
        padding: '0 20px 10px',
        width: '100%',
        maxWidth: 620,
        alignSelf: 'center',
      }}
    >
      <div
        data-testid="direction-toggle"
        style={{ ...row, justifyContent: 'space-between', alignItems: 'center', width: '100%' }}
      >
        <div data-testid="active-direction" style={{ fontSize: 16, fontWeight: 800, letterSpacing: 0.4, color: palette.ink }}>
          {directionTitle(props.activeDir)}
        </div>
        <Press
          onPress={() => props.onToggleDirection(props.oppositeDir)}
          label="Flip direction"
          testId="flip-direction"
          style={pill()}
        >
          <div style={{ fontSize: 12, fontWeight: 700, color: palette.inkStrong }}>
            {`⇄ ${directionTitle(props.oppositeDir)}`}
          </div>
        </Press>
      </div>

      {/* Service-filter chips (E3): the whole board — hero included — shows
          only the selected service class; 'All' restores everything. */}
      <div data-testid="service-filter" style={{ ...row, gap: 6, width: '100%' }}>
        {serviceFilterOptions().map((f) => {
          const selected = props.serviceFilter === f.id;
          return (
            <Press
              key={f.id}
              onPress={() => props.onSetServiceFilter(f.id)}
              label={`Show ${f.label} trains`}
              testId={`service-filter-${f.label}`}
              style={{
                padding: '5px 12px',
                borderRadius: 999,
                background: selected ? '#ffffff2b' : '#ffffff12',
                border: `1px solid ${selected ? '#ffffff42' : '#ffffff1a'}`,
              }}
            >
              <div style={{ fontSize: 12, fontWeight: selected ? 700 : 500, color: selected ? palette.ink : palette.inkSoft }}>
                {f.label}
              </div>
            </Press>
          );
        })}
      </div>

      {hero ? (
        <div style={{ ...column, gap: 9, width: '100%' }}>
          <div style={{ ...row, gap: 12, alignItems: 'center', width: '100%' }}>
            {/* Hero: the next train, expanded — tap opens its detail. */}
            <Press
              onPress={() => props.onOpenTrip(hero.id)}
              label="Open next train"
              testId="hero-departure"
              style={{ flex: 1, minWidth: 0 }}
            >
              <div style={{ ...column, gap: 7, width: '100%', alignItems: 'flex-start' }}>
                <div style={{ ...row, alignItems: 'flex-end', gap: 9, width: '100%' }}>
                  <div
                    data-testid="hero-minutes"
                    style={{ fontSize: 98, fontWeight: 800, lineHeight: '92px', ...tabular, color: palette.ink }}
                  >
                    {formatCountdownMinutes(hero.predictedDepartureMs, nowMs)}
                  </div>
                  <div style={{ fontSize: 17, fontWeight: 600, color: palette.inkMeta, paddingBottom: 12 }}>min</div>
                  <div style={{ flex: 1 }} />
                  <div style={{ ...column, gap: 6, alignItems: 'flex-end', paddingBottom: 10 }}>
                    <ServicePill
                      service={hero.service}
                      color={serviceColor(hero.service)}
                      tint={serviceTint(hero.service)}
                      testId="hero-service"
                    />
                    <div data-testid="hero-meta" style={{ fontSize: 12, fontFamily: mono, color: palette.inkMono }}>
                      {`${formatClockTime(hero.predictedDepartureMs)} · #${hero.trainNumber}`}
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: delayColor(hero) }}>{delayLabel(hero)}</div>
                  </div>
                </div>
                <div style={{ fontSize: 15, fontWeight: 600, color: palette.inkBody }}>{`to ${hero.headsign}`}</div>
                <div style={{ ...row, gap: 6, flexWrap: 'wrap', width: '100%' }}>
                  {upcomingStops(hero.id, props.stationId, nowMs, 4, props.delayRows).map((stop) => (
                    <div
                      key={stop.id}
                      style={{
                        ...row,
                        borderRadius: 999,
                        padding: '4px 10px',
                        background: stop.isBoarding ? '#ffffff2b' : '#ffffff14',
                      }}
                    >
                      <div
                        style={{
                          fontSize: 11,
                          fontWeight: stop.isBoarding ? 700 : 500,
                          fontFamily: mono,
                          color: stop.isBoarding ? palette.ink : palette.inkSoft,
                        }}
                      >
                        {`${stop.time} ${stop.name}`}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </Press>
            {/* Walk the upcoming trains (swipe up/down drives these same arrows). */}
            <div style={{ ...column, gap: 8 }}>
              {arrow('Earlier train', 'train-prev', '▲', board.hasPrev, props.onTrainPrev)}
              {arrow('Later train', 'train-next', '▼', board.hasNext, props.onTrainNext)}
            </div>
          </div>

          {/* The three departures after the hero. */}
          <div style={{ ...column, gap: 7, width: '100%' }}>
            {board.rest.map((d) => (
              <Press
                key={d.id}
                onPress={() => props.onOpenTrip(d.id)}
                label="Open train"
                testId={`departure-${d.id}`}
                style={{ width: '100%' }}
              >
                <div
                  style={{
                    ...row,
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    borderRadius: 14,
                    padding: '10px 14px',
                    background: palette.glassRow,
                    border: `1px solid ${palette.hairlineRow}`,
                    width: '100%',
                  }}
                >
                  <div style={{ ...row, gap: 8, alignItems: 'center' }}>
                    <div
                      style={{ fontSize: 17, fontWeight: 800, ...tabular, color: palette.ink, width: 36, textAlign: 'right' }}
                    >
                      {formatCountdownMinutes(d.predictedDepartureMs, nowMs)}
                    </div>
                    <div style={{ fontSize: 11, color: palette.inkFaint }}>min</div>
                    <ServicePill
                      service={d.service}
                      color={serviceColor(d.service)}
                      tint={serviceTint(d.service)}
                      size={10}
                      paddingX={8}
                      paddingY={2}
                    />
                  </div>
                  <div style={{ fontSize: 12, fontFamily: mono, color: palette.inkDim }}>
                    {`${formatClockTime(d.predictedDepartureMs)} · ${shortHeadsign(d)}`}
                  </div>
                </div>
              </Press>
            ))}
          </div>
        </div>
      ) : (
        <div
          style={{
            ...column,
            borderRadius: 16,
            padding: 18,
            background: palette.glass,
            border: `1px solid ${palette.hairline}`,
          }}
        >
          <div data-testid="no-trains" style={{ fontSize: 14, color: palette.inkSoft }}>
            No more trains today in this direction.
          </div>
        </div>
      )}

      {/* Opposite direction, minimal — and itself a flip affordance. */}
      {oppositeBoard.primary && (
        <Press
          onPress={() => props.onToggleDirection(props.oppositeDir)}
          label={`Show ${directionTitle(props.oppositeDir)}`}
          testId="opposite-line"
          style={{ width: '100%' }}
        >
          <div
            style={{
              ...row,
              justifyContent: 'space-between',
              alignItems: 'center',
              borderRadius: 14,
              padding: '9px 14px',
              background: palette.glassFaint,
              border: `1px solid ${palette.hairlineFaint}`,
              width: '100%',
            }}
          >
            <div style={{ ...row, gap: 8, alignItems: 'center' }}>
              <div style={{ fontSize: 13, color: palette.inkDim }}>⇅</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: palette.inkSoft }}>
                {directionTitle(props.oppositeDir)}
              </div>
            </div>
            <div style={{ ...row, gap: 5, alignItems: 'center' }}>
              <div style={{ fontSize: 15, fontWeight: 800, ...tabular, color: palette.ink }}>
                {formatCountdownMinutes(oppositeBoard.primary.predictedDepartureMs, nowMs)}
              </div>
              <div style={{ fontSize: 11, color: palette.inkFaint }}>min</div>
            </div>
          </div>
        </Press>
      )}

      <div style={{ ...row, justifyContent: 'space-between', alignItems: 'center', width: '100%', paddingTop: 2 }}>
        {/* The data-source badge: amber "DEMO DATA" on the recorded/seed feed,
            green "LIVE" only after a real 511 snapshot commits (lastSource). */}
        <div style={{ ...row, gap: 7, alignItems: 'center' }}>
          <div
            data-testid="data-source"
            title={
              props.feedSource.live
                ? 'Live delays from the 511.org Caltrain feed'
                : 'Simulated delays from the recorded demo feed — add a 511.org key for live data'
            }
            style={{
              fontSize: 10,
              fontWeight: 800,
              letterSpacing: 1,
              color: props.feedSource.color,
              background: props.feedSource.tint,
              border: `1px solid ${props.feedSource.border}`,
              borderRadius: 999,
              padding: '3px 8px',
            }}
          >
            {props.feedSource.label}
          </div>
          <div data-testid="freshness" style={{ fontSize: 12, color: palette.inkFaint }}>
            {props.freshness}
          </div>
        </div>
        <Press onPress={props.onRefresh} label="Refresh" testId="refresh" style={pill({ padding: '5px 12px' })}>
          <div style={{ fontSize: 12, fontWeight: 700, color: palette.inkStrong }}>Refresh</div>
        </Press>
      </div>
      {/* Why the board is on the recorded feed instead of live 511 — the
          actionable lastError refreshFeed commits on fallback (ENG-22751). */}
      {props.feedIssue !== '' && (
        <div data-testid="feed-problem" style={{ fontSize: 11, color: '#fbbf24', width: '100%' }}>
          {props.feedIssue}
        </div>
      )}
      {props.photoCredit !== '' && (
        <div
          data-testid="photo-credit"
          style={{ fontSize: 10, color: palette.inkCredit, textAlign: 'center', width: '100%' }}
        >
          {props.photoCredit}
        </div>
      )}
    </div>
  );
}
