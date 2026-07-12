// Contract helper boundary descriptors for the All Aboard surface.
//
// @ref LLP 0052#acceptance-gates — every helper declared pure depends only on
// explicit arguments. Host state enters through component `host` bindings;
// preference, sensor retry, URL opening, and route transport are named
// capabilities instead of hidden module reads.

import { capability, defineContractModule, pure } from '@exact/contract/exports';

export default defineContractModule('./data.ts', {
  getSelectedStation: pure({ params: ['stationId', 'location'], result: 'Station', depends: 'args' }),
  searchStations: pure({ params: ['query', 'location'], result: 'Station[]', depends: 'args' }),
  adjacentStationId: pure({ params: ['stationId', 'delta'], result: 'string', depends: 'args' }),
  stationArt: pure({ params: ['stationId', 'nowMs'], result: 'string', depends: 'args' }),
  locationHint: pure({ params: ['location'], result: 'string', depends: 'args' }),
  locationIndicatorColor: pure({ params: ['location', 'scheme'], result: 'string', depends: 'args' }),
  locationIconSvg: pure({ params: ['color'], result: 'string', depends: 'args' }),
  ticketIconSvg: pure({ params: ['color'], result: 'string', depends: 'args' }),
  refreshIconSvg: pure({ params: ['color'], result: 'string', depends: 'args' }),
  settingsIconSvg: pure({ params: ['color'], result: 'string', depends: 'args' }),
  themePalette: pure({ params: ['scheme'], result: 'ThemePalette', depends: 'args' }),
  activeDirection: pure({ params: ['override', 'station'], result: 'string', depends: 'args' }),
  oppositeDirection: pure({ params: ['direction'], result: 'string', depends: 'args' }),
  directionTitle: pure({ params: ['direction'], result: 'string', depends: 'args' }),
  getDirectionBoard: pure({ params: ['stationId', 'direction', 'nowMs', 'limit', 'delayRows', 'departureRows', 'feedRows'], result: 'DirectionBoard', depends: 'args' }),
  boardTrains: pure({ params: ['stationId', 'direction', 'nowMs', 'heroOffset', 'delayRows', 'departureRows', 'feedRows'], result: 'HeroBoard', depends: 'args' }),
  terminalHint: pure({ params: ['stationId', 'direction', 'nowMs', 'delayRows', 'departureRows', 'feedRows', 'timezoneGeneration'], result: 'string', depends: 'args' }),
  delayLabel: pure({ params: ['departure'], result: 'string', depends: 'args' }),
  delayColor: pure({ params: ['departure', 'scheme'], result: 'string', depends: 'args' }),
  shortHeadsign: pure({ params: ['departure'], result: 'string', depends: 'args' }),
  getTrainRun: pure({ params: ['runId', 'nowMs', 'delayRows', 'departureRows'], result: 'TrainRun', depends: 'args' }),
  boardingCall: pure({ params: ['trip', 'stationId', 'nowMs'], result: 'BoardingCall', depends: 'args' }),
  boardingCallDeadline: pure({ params: ['trip', 'stationId'], result: 'number', depends: 'args' }),
  heroStops: pure({ params: ['runId', 'stationId', 'nowMs', 'delayRows', 'departureRows', 'timezoneGeneration'], result: 'HeroStopChip[]', depends: 'args' }),
  stopClockLabel: pure({ params: ['stop', 'timezoneGeneration'], result: 'string', depends: 'args' }),
  formatClockTime: pure({ params: ['timestamp', 'timezoneGeneration'], result: 'string', depends: 'args' }),
  countdownTemporal: pure({ params: ['target', 'nowMs'], result: 'TemporalText', depends: 'args' }),
  serviceColor: pure({ params: ['service'], result: 'string', depends: 'args' }),
  serviceTint: pure({ params: ['service', 'scheme'], result: 'string', depends: 'args' }),
  etaModeLabel: pure({ params: ['mode'], result: 'string', depends: 'args' }),
  walkBikeLine: pure({ params: ['station', 'mode', 'location', 'routeEstimate'], result: 'string', depends: 'args' }),
  routeEstimateRefreshDeadline: pure({ params: ['nowMs'], result: 'number', depends: 'args' }),
  directionsLabel: pure({ params: ['station', 'mode', 'location'], result: 'string', depends: 'args' }),
  stationAddress: pure({ params: ['stationId'], result: 'string', depends: 'args' }),
  distanceLabel: pure({ params: ['station', 'mode', 'location'], result: 'string', depends: 'args' }),
  feedFreshnessTemporal: pure({ params: ['feedRows', 'backend', 'nowMs'], result: 'TemporalText', depends: 'args' }),
  feedProblem: pure({ params: ['feedRows'], result: 'string', depends: 'args' }),
  feedSourceBadge: pure({ params: ['feedRows', 'nowMs', 'scheme'], result: 'FeedSourceBadge', depends: 'args' }),
  feedStaleDeadline: pure({ params: ['feedRows', 'nowMs'], result: 'number', depends: 'args' }),
  backendStatusNote: pure({ params: ['backend'], result: 'string', depends: 'args' }),
  emptyDelayRows: pure({ params: [], result: 'DelayRow[]', depends: 'args' }),
  nextDepartureExpiry: pure({ params: ['screen', 'stationId', 'stations', 'direction', 'nowMs', 'delayRows', 'departureRows', 'feedRows'], result: 'number', depends: 'args' }),
  nextUtcDayDeadline: pure({ params: ['nowMs'], result: 'number', depends: 'args' }),
  positionFraction: pure({ params: ['trip'], result: 'number', depends: 'args' }),
  positionLabel: pure({ params: ['trip'], result: 'string', depends: 'args' }),
  fractionPercent: pure({ params: ['fraction'], result: 'string', depends: 'args' }),

  requestGeolocationRefresh: capability({ params: {}, effects: ['device.location.request'] }),
  openClipperLink: capability({ params: {}, effects: ['device.url.open'] }),
  loadRouteEstimate: capability({
    params: {
      station: 'object',
      mode: 'string',
      location: 'object',
      backend: 'object',
      requestedAt: 'number',
    },
    effects: ['network.route.read'],
  }),
});
