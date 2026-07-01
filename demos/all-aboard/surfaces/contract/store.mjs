// The seam between Snapback live data and the Contract view.
//
// main.ts subscribes to the durable liveTrainStatus + feedState queries and to the
// device geolocation, and writes the latest values here. The .contract's pure
// derive helpers (data.ts) read this store on every clock tick, so a server-pushed
// delay change or a resolved location shows up on screen within one second without
// the view importing a client. This mirrors the Exact caltrain twin's data layer,
// except the "world" data is Snapback-authored rather than a hard-coded model.

const state = {
  delays: {},          // patternId -> delaySeconds (from liveTrainStatus)
  feed: null,          // feedRefreshState row (fetchedAt, tickIndex, lastSource, ...)
  location: null,      // { lat, lng } from the device, or null => default
  locationSource: 'default', // 'device' | 'default' | 'denied' | 'unavailable'
};

export function setDelays(rows) {
  const next = {};
  for (const row of rows ?? []) next[row.patternId] = row.delaySeconds;
  state.delays = next;
}

export function setFeed(row) {
  state.feed = row ?? null;
}

export function setLocation(location, source) {
  state.location = location ?? null;
  state.locationSource = source ?? (location ? 'device' : 'default');
}

export function getStoreState() {
  return state;
}
