// All Aboard — live train-detail trip reconstruction acceptance (ENG-23729).
//
// Pure-helper checks over the Contract surface's getTrainRun/heroStops/upcomingStops for
// live 511 runs. 511 StopMonitoring is stop-centric — one journey shows up as
// one liveDepartures row per monitored station — and the train detail screen
// must join those rows back into a real trip: the full served stop sequence,
// per-station times (real 511 rows verbatim, pattern-derived fills marked
// estimated), and a nonzero duration. Guards the ENG-23729 failure where a
// San Carlos -> San Jose Diridon run rendered as "0 min · 2 stops" with both
// endpoints stamped with the boarding stop's time.
//
// Run: node demos/all-aboard/tests/acceptance/trip-detail-live.mjs
// (node >= 22.18 strips the .ts types on import)

import { assert, assertEqual, createSuite, runAcceptance } from '../../../_kit/harness.mjs';

const { getTrainRun, heroStops, boardingCall, upcomingStops, stopClockLabel } = await import('../../surfaces/contract/data.ts');

const suite = createSuite('all-aboard live trip detail');

const NOW = 1_800_000_000_000;
const MIN = 60_000;

let nextId = 0;
function liveRow(overrides = {}) {
  nextId += 1;
  return {
    _id: `row-${nextId}`,
    departureId: 'CT:154:20260708',
    stationId: 'san-carlos',
    direction: 'south',
    service: 'Local',
    patternId: 'sb-local',
    trainNumber: '154',
    headsign: 'San Jose Diridon',
    scheduledDepartureMs: NOW + 5 * MIN,
    predictedDepartureMs: NOW + 5 * MIN,
    delaySeconds: 0,
    status: 'on-time',
    ...overrides,
  };
}

await runAcceptance(suite, async () => {
  await suite.check('a single monitored stop still yields the full served stop sequence with a real duration', async () => {
    // The ENG-23729 screenshot: the feed only carried the San Carlos call for
    // Train 154. The detail must walk the sb-local pattern to San Jose, not
    // render two stops that both claim the San Carlos departure time.
    const boarding = liveRow();
    const trip = getTrainRun(`live:${boarding._id}`, NOW, [], [boarding]);
    assert(trip, 'trip resolves');
    assertEqual(trip.origin.id, 'san-carlos', 'origin is the boarding station');
    assertEqual(trip.destination.id, 'san-jose', 'destination from the headsign');
    assertEqual(trip.stops.length, 10, 'sb-local serves 10 stations from San Carlos to San Jose');
    assertEqual(trip.stopCount, trip.stops.length, 'stopCount matches the stop list');
    assertEqual(trip.durationMinutes, 45, 'San Carlos -> San Jose local takes the corridor travel time, not 0');
    const first = trip.stops[0];
    const last = trip.stops[trip.stops.length - 1];
    assert(last.predictedTimeMs > first.predictedTimeMs, 'endpoint times are distinct and ordered');
    assertEqual(first.estimated, false, 'the boarding stop carries the real 511 time');
    assert(trip.stops.slice(1).every((stop) => stop.estimated === true), 'unmonitored stops are marked estimated');
    const times = trip.stops.map((stop) => stop.predictedTimeMs);
    assert(times.every((t, i) => i === 0 || t > times[i - 1]), 'stop times strictly increase along the run');
  });

  await suite.check('journey rows at other stations override estimates with real 511 times', async () => {
    const boarding = liveRow();
    const paloAlto = liveRow({ stationId: 'palo-alto', scheduledDepartureMs: NOW + 20 * MIN, predictedDepartureMs: NOW + 21 * MIN });
    const sanJose = liveRow({ stationId: 'san-jose', scheduledDepartureMs: NOW + 52 * MIN, predictedDepartureMs: NOW + 53 * MIN });
    const otherTrain = liveRow({ departureId: 'CT:158:20260708', trainNumber: '158', stationId: 'palo-alto', predictedDepartureMs: NOW + 90 * MIN });
    const trip = getTrainRun(`live:${boarding._id}`, NOW, [], [boarding, paloAlto, sanJose, otherTrain]);
    const byStation = new Map(trip.stops.map((stop) => [stop.station.id, stop]));
    assertEqual(byStation.get('palo-alto').predictedTimeMs, NOW + 21 * MIN, 'Palo Alto uses its own 511 row');
    assertEqual(byStation.get('palo-alto').estimated, false, 'Palo Alto time is real, not estimated');
    assertEqual(byStation.get('san-jose').predictedTimeMs, NOW + 53 * MIN, 'San Jose uses its own 511 row, not the boarding time');
    assertEqual(trip.durationMinutes, 47, 'duration spans the real scheduled endpoint times');
    assert(byStation.get('redwood-city').estimated, 'stations without a 511 row stay estimated');
  });

  await suite.check('duplicate visits for one station keep the earliest upcoming call', async () => {
    const boarding = liveRow();
    const laterVisit = liveRow({ stationId: 'palo-alto', predictedDepartureMs: NOW + 40 * MIN, scheduledDepartureMs: NOW + 40 * MIN });
    const earlierVisit = liveRow({ stationId: 'palo-alto', predictedDepartureMs: NOW + 20 * MIN, scheduledDepartureMs: NOW + 20 * MIN });
    const trip = getTrainRun(`live:${boarding._id}`, NOW, [], [boarding, laterVisit, earlierVisit]);
    const paloAlto = trip.stops.find((stop) => stop.station.id === 'palo-alto');
    assertEqual(paloAlto.predictedTimeMs, NOW + 20 * MIN, 'the earlier visit wins');
  });

  await suite.check('an unknown pattern falls back to the journey\'s observed stations, corridor-ordered', async () => {
    const boarding = liveRow({ stationId: 'hillsdale', direction: 'north', patternId: '', headsign: 'San Francisco' });
    const millbrae = liveRow({ stationId: 'millbrae', direction: 'north', patternId: '', headsign: 'San Francisco', scheduledDepartureMs: NOW + 18 * MIN, predictedDepartureMs: NOW + 18 * MIN });
    const trip = getTrainRun(`live:${boarding._id}`, NOW, [], [boarding, millbrae]);
    assertEqual(trip.stops.map((stop) => stop.station.id).join(','), 'hillsdale,millbrae,san-francisco', 'observed stations plus the destination, northbound order');
    assertEqual(trip.stops[1].estimated, false, 'the Millbrae row is real');
    assertEqual(trip.stops[2].estimated, true, 'the terminus without a row is estimated');
    assert(trip.durationMinutes > 0, 'duration is nonzero');
  });

  await suite.check('upcomingStops and stopClockLabel mark estimated times approximate', async () => {
    const boarding = liveRow();
    const rows = [boarding];
    const stops = upcomingStops(`live:${boarding._id}`, 'san-carlos', NOW, 4, [], rows);
    assertEqual(stops.length, 4, 'expanded hero lists the requested window');
    assert(!stops[0].time.startsWith('~'), 'the boarding stop time is real, no approx marker');
    assert(stops[1].time.startsWith('~'), 'pattern-derived times carry the approx marker');
    assertEqual(stopClockLabel({ predictedTimeMs: NOW, estimated: false }), stopClockLabel({ predictedTimeMs: NOW }), 'absent flag renders plain');
  });

  await suite.check('heroStops chips are boarding + ellipsis + the last two stops; short runs skip the ellipsis', async () => {
    // sb-local from San Carlos serves many more stops: boarding, gap, last 2.
    const boarding = liveRow();
    const chips = heroStops(`live:${boarding._id}`, 'san-carlos', NOW, [], [boarding]);
    assertEqual(chips.length, 4, 'boarding + gap + last two');
    assert(chips[0].isBoarding && chips[0].id === 'san-carlos', 'first chip is the boarding stop');
    assert(chips[1].gap === true, 'second chip is the ellipsis marker');
    assertEqual(chips[3].id, 'san-jose', 'last chip is the end of the line');
    assert(chips[3].time.length > 0, 'terminal chip carries its arrival time');
    // Three stops or fewer from boarding: everything fits, no ellipsis.
    const short = liveRow({ stationId: 'hillsdale', direction: 'north', patternId: '', headsign: 'San Francisco' });
    const shortChips = heroStops(`live:${short._id}`, 'hillsdale', NOW, [], [short]);
    assert(shortChips.every((chip) => !chip.gap), 'short runs render every stop, no gap');
    assertEqual(shortChips[shortChips.length - 1].id, 'san-francisco', 'short run still ends at the terminal');
  });

  await suite.check('boardingCall answers minutes-to-boarding on the trip screen', async () => {
    const boarding = liveRow(); // departs san-carlos at NOW + 5 min
    const trip = getTrainRun(`live:${boarding._id}`, NOW, [], [boarding]);
    const call = boardingCall(trip, 'san-carlos', NOW);
    assert(call, 'boarding stop resolves');
    assertEqual(call.minutes, 5, 'countdown is minutes until the boarding call');
    assertEqual(call.departed, false, 'upcoming call is not departed');
    const gone = boardingCall(trip, 'san-carlos', NOW + 10 * MIN);
    assertEqual(gone.departed, true, 'a past call reads as departed');
    assertEqual(boardingCall(trip, 'hillsdale', NOW), null, 'stations behind the boarding stop return null');
  });

  await suite.check('demo-schedule runs still resolve through the model unchanged', async () => {
    const originMs = NOW + 7 * MIN;
    const trip = getTrainRun(`sb-local|${originMs}`, NOW, [], []);
    assert(trip, 'model run resolves');
    assertEqual(trip.stops.length, 21, 'sb-local full run serves all 21 stations');
    assert(trip.durationMinutes > 0, 'model duration nonzero');
    assert(trip.stops.every((stop) => !stop.estimated), 'model stops carry no estimated flag');
  });
});
