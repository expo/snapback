// All Aboard — React root component.
//
// Owns the same state the Contract root owns (station, direction override,
// screen, trip, query) as useState hooks; the live Snapback data arrives via
// useLiveState() (push, not tick-polled) and the 1s useNow() clock drives
// countdowns and the freshness age. Everything below the root is a plain
// presentational component taking data + callbacks, mirroring the Contract
// arm's action-threaded props.

import { useState } from 'react';

import {
  getAdjacentStation,
  getDirectionBoard,
  getSelectedStation,
  getTrainRun,
} from '../../../snapback/shared/model.mjs';
import { DEFAULT_LOCATION, activeDirection, oppositeDirection } from './lib.ts';
import { useLiveState, useNow } from './store.ts';
import { DirectionBoard } from './components/DirectionBoard.tsx';
import { StationCard } from './components/StationCard.tsx';
import { StationsPicker } from './components/StationsPicker.tsx';
import { TripDetail } from './components/TripDetail.tsx';
import { column } from './ui.tsx';

type Screen = 'home' | 'stations' | 'trip';

export function App(props: { onRefresh: () => void }) {
  const nowMs = useNow(1000);
  const live = useLiveState();
  const [stationId, setStationId] = useState<string | null>(null);
  const [directionOverride, setDirectionOverride] = useState<string | null>(null);
  const [screen, setScreen] = useState<Screen>('home');
  const [tripId, setTripId] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const location = live.location ?? DEFAULT_LOCATION;
  const station = getSelectedStation(stationId, location);
  const activeDir = activeDirection(directionOverride, station);
  const oppositeDir = oppositeDirection(activeDir);
  const primaryBoard = getDirectionBoard(station.id, activeDir, nowMs, live.delays, 4);
  const oppositeBoard = getDirectionBoard(station.id, oppositeDir, nowMs, live.delays, 1);
  const trip = tripId ? getTrainRun(tripId, nowMs, live.delays) : null;

  const goToStation = (id: string) => {
    setStationId(id);
    setScreen('home');
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
  const openStations = () => {
    setScreen('stations');
    setQuery('');
  };

  return (
    <main
      data-testid="all-aboard-main"
      style={{ ...column, background: '#f4f6fb', flex: 1, width: '100%', minHeight: '100vh' }}
    >
      <div style={{ ...column, gap: 14, padding: 18, maxWidth: 560, alignSelf: 'center', width: '100%' }}>
        <StationCard
          station={station}
          location={location}
          locationSource={live.locationSource}
          feed={live.feed}
          nowMs={nowMs}
          prevStationId={getAdjacentStation(station.id, -1)?.id ?? station.id}
          nextStationId={getAdjacentStation(station.id, 1)?.id ?? station.id}
          onGoToStation={goToStation}
          onOpenStations={openStations}
          onRefresh={props.onRefresh}
        />
        {screen === 'home' && (
          <DirectionBoard
            stationId={station.id}
            nowMs={nowMs}
            activeDir={activeDir}
            oppositeDir={oppositeDir}
            primaryBoard={primaryBoard}
            oppositeBoard={oppositeBoard}
            delays={live.delays}
            onToggleDirection={setDirectionOverride}
            onOpenTrip={openTrip}
          />
        )}
        {screen === 'stations' && (
          <StationsPicker
            query={query}
            location={location}
            onSetQuery={setQuery}
            onGoToStation={goToStation}
            onGoHome={goHome}
          />
        )}
        {screen === 'trip' && <TripDetail trip={trip} stationId={station.id} onGoHome={goHome} />}
      </div>
    </main>
  );
}
