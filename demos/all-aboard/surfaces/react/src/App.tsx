// All Aboard — React root component (redesign re-baseline, ENG-22450).
//
// FROZEN BASELINE (ENG-23821): this surface is the red-team control arm — a
// point-in-time paved-road comparison against the Contract surface (ENG-22435;
// re-baselined once under ENG-22450 for the LLP 0286 re-run). By decision it
// does NOT track product redesigns: the Contract surface has since shipped
// ENG-23719 (white board, red sticky header, hand-drawn art) and ENG-23795
// (contiguous paging strips, sticky footer, directions/maps), and this arm
// intentionally still renders the ENG-22450 design. Its comparison verdicts
// live in Diary 0008 and the gate issues. Do not port redesigns here
// piecemeal; a future comparison gate should file a fresh re-baseline issue.
//
// Owns the same state the Contract root owns (station, direction override,
// screen, trip, query, heroOffset) as useState hooks; the live Snapback data
// arrives via useLiveState() (server push into the store) and the 1s useNow()
// clock drives countdowns and the freshness age. Everything below the root is
// a plain presentational component taking data + callbacks, mirroring the
// Contract arm's action-threaded props.
//
// Design: full-bleed poster-stylized station artwork (model.mjs stationPhoto —
// legibility scrims are baked into its SVG wrapper) with the departure board
// typeset directly on it: station identity at the top, the answer — a giant
// countdown — at the bottom where thumbs live. `heroOffset` walks the upcoming
// trains in the active direction. Edge chevrons, the ▲▼ train arrows, and the
// flip pill are the visible, pressable stand-ins the gesture glue drives.

import { useLayoutEffect, useState } from 'react';

import {
  getAdjacentStation,
  getDirectionBoard,
  getSelectedStation,
  getTrainRun,
  stationPhoto,
  stationPhotoCredit,
} from '../../../snapback/shared/model.mjs';
import {
  DEFAULT_LOCATION,
  activeDirection,
  backendStatusNote,
  boardTrains,
  delaysFrom,
  feedFreshness,
  feedProblem,
  feedSourceBadge,
  locationHint,
  oppositeDirection,
  walkBikeSummary,
} from './lib.ts';
import type { EtaMode, Station } from './lib.ts';
import { useLiveState, useNow } from './store.ts';
import { DirectionBoard } from './components/DirectionBoard.tsx';
import type { OppositeBoard } from './components/DirectionBoard.tsx';
import { StationCard } from './components/StationCard.tsx';
import { StationsPicker } from './components/StationsPicker.tsx';
import { TripDetail } from './components/TripDetail.tsx';
import type { Trip } from './components/TripDetail.tsx';
import { column, palette } from './ui.tsx';

type Screen = 'home' | 'stations' | 'trip';

export function App(props: {
  onRefresh: () => void;
  onRequestLocation: () => void;
  onUsefulBoardCommit: () => void;
}) {
  const nowMs = useNow(1000);
  const live = useLiveState();
  const [stationId, setStationId] = useState<string | null>(null);
  const [directionOverride, setDirectionOverride] = useState<string | null>(null);
  const [screen, setScreen] = useState<Screen>('home');
  const [tripId, setTripId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [heroOffset, setHeroOffset] = useState(0);
  const [serviceFilter, setServiceFilterState] = useState('All');
  const [etaMode, setEtaMode] = useState<EtaMode>('walk');

  const location = live.location ?? DEFAULT_LOCATION;
  // The model types its lookups as nullable; selection falls back to the
  // nearest station and seeded runs always resolve — assert once here.
  const station = getSelectedStation(stationId, location) as Station;
  const art: string = stationPhoto(station.id) ?? '';
  const photoCredit: string = stationPhotoCredit(station.id) ?? '';
  const activeDir = activeDirection(directionOverride, station);
  const oppositeDir = oppositeDirection(activeDir);
  const board = boardTrains(station.id, activeDir, nowMs, heroOffset, live.delayRows, serviceFilter);
  const oppositeBoard = getDirectionBoard(station.id, oppositeDir, nowMs, delaysFrom(live.delayRows), 1) as OppositeBoard;
  const prevStationId = getAdjacentStation(station.id, -1)?.id ?? station.id;
  const nextStationId = getAdjacentStation(station.id, 1)?.id ?? station.id;
  const trip = tripId ? (getTrainRun(tripId, nowMs, delaysFrom(live.delayRows)) as Trip | null) : null;
  const freshness = feedFreshness(nowMs, live.feedRows, live.backendState);
  const feedIssue = feedProblem(live.feedRows);
  const feedSource = feedSourceBadge(live.feedRows, nowMs);
  const bootNote = backendStatusNote(live.backendState);

  // A root.render() call is only a scheduling event under concurrent React.
  // This layout effect is the commit witness: both useful-board branches
  // (station identity and numeric hero departure) have been reconciled into
  // the DOM before it fires. The bootstrap crosses a complete animation-frame
  // boundary and starts backend work only after that paint opportunity.
  useLayoutEffect(() => {
    if (screen === 'home' && station.name !== '' && board.hero) {
      props.onUsefulBoardCommit();
    }
  }, [board.hero, props.onUsefulBoardCommit, screen, station.name]);

  // The delays region dispatches on the live subscription the way the
  // Contract `async delayRows` block does: `stale` wins over `ready` while
  // the connection is degraded (kit values 'stale' | 'disconnected' — the
  // same mapping the Contract runtime's stale arm uses). The loading state
  // is the board too (ENG-23727): first paint renders scheduled departures
  // under an honest status note, never a blocking "connecting" placeholder.
  const delaysLoading = !live.delaysReady;
  const delaysStale =
    live.connections.liveTrainStatus === 'stale' || live.connections.liveTrainStatus === 'disconnected';

  const goToStation = (id: string) => {
    setStationId(id);
    setScreen('home');
    setQuery('');
    setHeroOffset(0);
  };
  const toggleDirection = (next: string) => {
    setDirectionOverride(next);
    setHeroOffset(0);
  };
  const trainPrev = () => setHeroOffset((current) => (current > 0 ? current - 1 : 0));
  const trainNext = () => setHeroOffset((current) => (current < 8 ? current + 1 : current));
  const setServiceFilter = (value: string) => {
    setServiceFilterState(value);
    setHeroOffset(0);
  };
  const toggleEtaMode = () => setEtaMode((current) => (current === 'walk' ? 'bike' : 'walk'));
  const openStations = () => {
    setScreen('stations');
    setQuery('');
  };
  const openTrip = (id: string) => {
    setTripId(id);
    setScreen('trip');
  };
  const goHome = () => {
    setScreen('home');
    setTripId(null);
  };

  const chevron = (side: 'left' | 'right', targetId: string, label: string, testId: string, glyph: string) => (
    <button
      type="button"
      onClick={() => goToStation(targetId)}
      aria-label={label}
      data-testid={testId}
      style={{
        appearance: 'none',
        border: 'none',
        margin: 0,
        padding: 0,
        cursor: 'pointer',
        position: 'absolute',
        [side]: 0,
        top: '17%',
        bottom: '58%',
        width: 42,
        background: 'transparent',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <span style={{ fontSize: 34, fontWeight: 700, color: targetId === station.id ? palette.inkDisabled : palette.inkGhost }}>
        {glyph}
      </span>
    </button>
  );

  return (
    <main
      data-testid="all-aboard-main"
      style={{ ...column, background: palette.page, flex: 1, width: '100%', minHeight: '100%', height: '100%' }}
    >
      <div style={{ position: 'relative', flex: 1, width: '100%', minHeight: '100%', overflow: 'hidden' }}>
        {/* Full-bleed station artwork behind everything. */}
        {art === '' ? (
          <div style={{ ...column, position: 'absolute', inset: 0, background: '#0b0e1a' }} />
        ) : (
          <img
            src={`data:image/svg+xml;utf8,${encodeURIComponent(art)}`}
            alt={`${station.name} station artwork`}
            data-testid="station-art"
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
          />
        )}

        {screen === 'home' && (
          <div
            data-testid="board-content"
            style={{ ...column, position: 'absolute', inset: 0, justifyContent: 'space-between' }}
          >
            <StationCard
              station={station}
              walkBike={walkBikeSummary(station, etaMode, location)}
              locHint={locationHint(live.locationSource)}
              etaMode={etaMode}
              onOpenStations={openStations}
              onToggleEtaMode={toggleEtaMode}
              onRequestLocation={props.onRequestLocation}
            />
            {delaysLoading ? (
              <div style={{ ...column, gap: 8, width: '100%' }}>
                {bootNote !== '' && (
                  <div style={{ ...column, alignItems: 'center', width: '100%' }}>
                    <div
                      style={{
                        borderRadius: 999,
                        padding: '5px 12px',
                        background: '#ffffff12',
                        border: '1px solid #ffffff1f',
                      }}
                    >
                      <div data-testid="delays-loading" style={{ fontSize: 11, fontWeight: 700, color: '#ffffff9e' }}>
                        {bootNote}
                      </div>
                    </div>
                  </div>
                )}
                <DirectionBoard
                  stationId={station.id}
                  nowMs={nowMs}
                  activeDir={activeDir}
                  oppositeDir={oppositeDir}
                  board={board}
                  oppositeBoard={oppositeBoard}
                  serviceFilter={serviceFilter}
                  freshness={freshness}
                  feedIssue={feedIssue}
                  feedSource={feedSource}
                  photoCredit={photoCredit}
                  delayRows={live.delayRows}
                  onToggleDirection={toggleDirection}
                  onOpenTrip={openTrip}
                  onTrainPrev={trainPrev}
                  onTrainNext={trainNext}
                  onSetServiceFilter={setServiceFilter}
                  onRefresh={props.onRefresh}
                />
              </div>
            ) : (
              <div style={{ ...column, gap: 8, width: '100%' }}>
                {delaysStale && (
                  <div style={{ ...column, alignItems: 'center', width: '100%' }}>
                    <div
                      style={{
                        borderRadius: 999,
                        padding: '5px 12px',
                        background: palette.amberTint,
                        border: `1px solid ${palette.amberBorder}`,
                      }}
                    >
                      <div data-testid="delays-stale" style={{ fontSize: 11, fontWeight: 700, color: palette.amber }}>
                        Reconnecting — showing last-known delays
                      </div>
                    </div>
                  </div>
                )}
                <DirectionBoard
                  stationId={station.id}
                  nowMs={nowMs}
                  activeDir={activeDir}
                  oppositeDir={oppositeDir}
                  board={board}
                  oppositeBoard={oppositeBoard}
                  serviceFilter={serviceFilter}
                  freshness={freshness}
                  feedIssue={feedIssue}
                  feedSource={feedSource}
                  photoCredit={photoCredit}
                  delayRows={live.delayRows}
                  onToggleDirection={toggleDirection}
                  onOpenTrip={openTrip}
                  onTrainPrev={trainPrev}
                  onTrainNext={trainNext}
                  onSetServiceFilter={setServiceFilter}
                  onRefresh={props.onRefresh}
                />
              </div>
            )}
          </div>
        )}
        {screen === 'stations' && (
          <StationsPicker
            query={query}
            location={location}
            nowMs={nowMs}
            currentStationId={station.id}
            etaMode={etaMode}
            onSetQuery={setQuery}
            onGoToStation={goToStation}
            onGoHome={goHome}
          />
        )}
        {screen === 'trip' && <TripDetail trip={trip} stationId={station.id} onGoHome={goHome} />}

        {/* Edge chevrons: the visible, pressable stand-in for the swipe. */}
        {screen === 'home' && (
          <>
            {chevron('left', prevStationId, 'Previous station', 'prev-station', '‹')}
            {chevron('right', nextStationId, 'Next station', 'next-station', '›')}
          </>
        )}
      </div>
    </main>
  );
}
