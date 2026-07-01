// Contract helper boundary descriptors for the All Aboard surface.
// Mirrors js/src/caltrain-contract/data.contract-meta.ts: every helper the
// app.contract `use`s is declared pure (depends on its args) so the compiler can
// type the derives without importing the implementation.

import { defineContractModule, pure } from '@exact/contract/exports';

export default defineContractModule('./data.ts', {
  getUserLocation: pure({ params: ['tick'], result: 'UserLocation', depends: 'args' }),
  locationSource: pure({ params: ['tick'], result: 'string', depends: 'args' }),
  getSelectedStation: pure({ params: ['stationId', 'tick'], result: 'Station', depends: 'args' }),
  getStations: pure({ params: [], result: 'Station[]', depends: 'args' }),
  searchStations: pure({ params: ['query', 'tick'], result: 'Station[]', depends: 'args' }),
  adjacentStationId: pure({ params: ['stationId', 'delta'], result: 'string', depends: 'args' }),
  stationPhoto: pure({ params: ['stationId'], result: 'string', depends: 'args' }),
  assumedDirection: pure({ params: ['station'], result: 'string', depends: 'args' }),
  activeDirection: pure({ params: ['override', 'station'], result: 'string', depends: 'args' }),
  oppositeDirection: pure({ params: ['direction'], result: 'string', depends: 'args' }),
  directionTitle: pure({ params: ['direction'], result: 'string', depends: 'args' }),
  getDirectionBoard: pure({ params: ['stationId', 'direction', 'nowMs', 'limit'], result: 'DirectionBoard', depends: 'args' }),
  getTrainRun: pure({ params: ['runId', 'nowMs'], result: 'TrainRun', depends: 'args' }),
  upcomingStops: pure({ params: ['runId', 'stationId', 'nowMs', 'limit'], result: 'TripStop[]', depends: 'args' }),
  formatClockTime: pure({ params: ['timestamp'], result: 'string', depends: 'args' }),
  formatCountdownMinutes: pure({ params: ['target', 'nowMs'], result: 'number', depends: 'args' }),
  serviceColor: pure({ params: ['service'], result: 'string', depends: 'args' }),
  serviceTint: pure({ params: ['service'], result: 'string', depends: 'args' }),
  walkBikeSummary: pure({ params: ['station', 'tick'], result: 'string', depends: 'args' }),
  feedFreshness: pure({ params: ['nowMs'], result: 'string', depends: 'args' }),
  positionFraction: pure({ params: ['trip'], result: 'number', depends: 'args' }),
  positionLabel: pure({ params: ['trip'], result: 'string', depends: 'args' }),
  fractionPercent: pure({ params: ['fraction'], result: 'string', depends: 'args' }),
});
