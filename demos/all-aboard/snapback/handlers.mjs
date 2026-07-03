// All Aboard JavaScript ctx.db handlers (bundled as source into the function
// manifest). Queries/mutations avoid ambient powers; actions are the only place
// this file uses fetch/secrets, and they commit durable state through mutations.
//
// @ref LLP 0027#feed-refresh-and-cron — applyFeedTick is the single durable write
//   path: it advances the recorded feed one tick and upserts trainStatus +
//   feedRefreshState, so the realtime fan-out (mutation commit -> live delta)
//   runs for free. refreshFeed is the ACTION cron invokes; it fetches only in
//   the action class, then commits via a mutation.

const PATTERN_IDS = ['sb-local', 'sb-limited', 'sb-bullet', 'nb-local', 'nb-limited', 'nb-bullet'];
const ROUTE_CACHE_TTL_MS = 5 * 60 * 1000;
const METERS_PER_MILE = 1609.344;

function nowMs(ctx) {
  return ctx.runtime && ctx.runtime.now ? ctx.runtime.now() : 0;
}

function errorMessage(error) {
  return error && error.message ? error.message : String(error);
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function scalar(value) {
  if (Array.isArray(value)) return scalar(value[0]);
  if (value && typeof value === 'object') {
    if (Object.prototype.hasOwnProperty.call(value, 'value')) return scalar(value.value);
    if (Object.prototype.hasOwnProperty.call(value, '#text')) return scalar(value['#text']);
    if (Object.prototype.hasOwnProperty.call(value, '_text')) return scalar(value._text);
    if (Object.prototype.hasOwnProperty.call(value, '0')) return scalar(value[0]);
  }
  return value;
}

function textOf(value) {
  const out = scalar(value);
  return out == null ? '' : String(out);
}

function dateMs(value) {
  const text = textOf(value);
  if (!text) return null;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseSiriDurationSeconds(value) {
  const text = textOf(value).trim();
  if (!text) return null;
  const match = text.match(/^(-)?P(?:T)?(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?$/i);
  if (!match) return null;
  const sign = match[1] ? -1 : 1;
  const hours = Number(match[2] || 0);
  const minutes = Number(match[3] || 0);
  const seconds = Number(match[4] || 0);
  return sign * Math.round(hours * 3600 + minutes * 60 + seconds);
}

function findValues(root, key, out) {
  if (root == null) return;
  if (Array.isArray(root)) {
    for (const item of root) findValues(item, key, out);
    return;
  }
  if (typeof root !== 'object') return;
  for (const [k, value] of Object.entries(root)) {
    if (k === key) out.push(value);
    findValues(value, key, out);
  }
}

function flattenVisits(json) {
  const values = [];
  findValues(json, 'MonitoredStopVisit', values);
  return values.flatMap((value) => asArray(value));
}

function classifyDirection(mvj, call) {
  const text = [
    textOf(mvj.DirectionName),
    textOf(mvj.DirectionRef),
    textOf(mvj.DestinationName),
    textOf(mvj.DestinationRef),
    textOf(call.DestinationDisplay),
    textOf(call.StopPointName),
  ].join(' ').toLowerCase();

  if (/san francisco|4th|king|sf caltrain|sf$/.test(text)) return 'north';
  if (/san jose|diridon|tamien|gilroy/.test(text)) return 'south';
  if (/\b(nb|north|northbound)\b/.test(text)) return 'north';
  if (/\b(sb|south|southbound)\b/.test(text)) return 'south';
  return null;
}

function classifyService(mvj) {
  const text = [
    textOf(mvj.LineRef),
    textOf(mvj.PublishedLineName),
    textOf(mvj.JourneyPatternRef),
    textOf(mvj.VehicleRef),
    textOf(mvj.FramedVehicleJourneyRef && mvj.FramedVehicleJourneyRef.DatedVehicleJourneyRef),
  ].join(' ').toLowerCase();

  if (/bullet|baby\s*bullet|\b5\d\d\b/.test(text)) return 'bullet';
  if (/limited|express|\b3\d\d\b/.test(text)) return 'limited';
  return 'local';
}

function delaySecondsFromVisit(visit) {
  const mvj = visit && visit.MonitoredVehicleJourney ? scalar(visit.MonitoredVehicleJourney) : null;
  const call = mvj && mvj.MonitoredCall ? scalar(mvj.MonitoredCall) : {};
  if (!mvj || !call) return null;

  const expected =
    dateMs(call.ExpectedDepartureTime) ??
    dateMs(call.ExpectedArrivalTime) ??
    dateMs(call.ExpectedAimedDepartureTime) ??
    dateMs(call.ExpectedAimedArrivalTime);
  const aimed =
    dateMs(call.AimedDepartureTime) ??
    dateMs(call.AimedArrivalTime) ??
    dateMs(mvj.OriginAimedDepartureTime) ??
    dateMs(mvj.DestinationAimedArrivalTime);
  if (expected != null && aimed != null) return Math.round((expected - aimed) / 1000);

  return parseSiriDurationSeconds(mvj.Delay) ?? parseSiriDurationSeconds(call.Delay);
}

function aggregateCaltrainDelays(json) {
  const buckets = {};
  let visited = 0;
  for (const visit of flattenVisits(json)) {
    const mvj = visit && visit.MonitoredVehicleJourney ? scalar(visit.MonitoredVehicleJourney) : null;
    const call = mvj && mvj.MonitoredCall ? scalar(mvj.MonitoredCall) : {};
    if (!mvj || !call) continue;
    visited += 1;

    const direction = classifyDirection(mvj, call);
    if (!direction) continue;
    const service = classifyService(mvj);
    const patternId = `${direction === 'south' ? 'sb' : 'nb'}-${service}`;
    if (!PATTERN_IDS.includes(patternId)) continue;

    const delay = delaySecondsFromVisit(visit);
    if (!Number.isFinite(delay)) continue;
    (buckets[patternId] ||= []).push(Math.max(-300, Math.min(3600, Math.round(delay))));
  }

  const delays = {};
  for (const [patternId, values] of Object.entries(buckets)) {
    const average = values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
    delays[patternId] = Math.round(average);
  }
  if (Object.keys(delays).length === 0) {
    throw new Error(`511 StopMonitoring returned ${visited} visits but no mappable Caltrain delays`);
  }
  return { delays, visitCount: visited };
}

function loopbackUrl(value) {
  if (typeof value !== 'string' || value.length === 0) return null;
  if (/^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?\//.test(value)) return value;
  return null;
}

function caltrainFeedUrl(args, apiKey) {
  const override = loopbackUrl(args && args.feedUrl);
  const base = override || 'https://api.511.org/transit/StopMonitoring';
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}api_key=${encodeURIComponent(apiKey)}&agency=CT&format=json`;
}

async function fetchJson(url, init) {
  const response = await fetch(url, init || {});
  const text = await response.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch (error) {
    throw new Error(`HTTP ${response.status} from ${url} returned non-JSON: ${text.slice(0, 120)}`);
  }
  if (!response.ok) {
    const detail = json && (json.error || json.message || json.Message || json.Error);
    throw new Error(`HTTP ${response.status} from ${url}${detail ? `: ${detail}` : ''}`);
  }
  return json;
}

async function fetchCaltrainDelays(ctx, args) {
  const key = ctx.secrets.rotating('caltrainFeed').expose();
  const url = caltrainFeedUrl(args, key);
  const json = await fetchJson(url, { headers: { Accept: 'application/json' }, timeout: 15_000 });
  return aggregateCaltrainDelays(json);
}

function routeModeLabel(mode) {
  return mode === 'bike' ? 'bike' : 'walk';
}

function routeProfile(mode) {
  return mode === 'bike' ? 'cycling-regular' : 'foot-walking';
}

function routeBaseUrls(args) {
  const override = loopbackUrl(args && args.baseUrl);
  if (override) return [override.replace(/\/$/, '')];
  return [
    'https://api.heigit.org/openrouteservice',
    'https://api.openrouteservice.org',
  ];
}

function routeSummary(json) {
  const geoSummary = json && json.features && json.features[0] && json.features[0].properties && json.features[0].properties.summary;
  const routeSummaryValue = json && json.routes && json.routes[0] && json.routes[0].summary;
  const summary = geoSummary || routeSummaryValue;
  if (!summary) throw new Error('directions response did not include a route summary');
  const distanceMeters = finiteNumber(summary.distance);
  const durationSeconds = finiteNumber(summary.duration);
  if (distanceMeters == null || durationSeconds == null) {
    throw new Error('directions response summary did not include distance and duration');
  }
  return { distanceMeters, durationSeconds };
}

function haversineMiles(from, to) {
  const earthMiles = 3958.8;
  const rad = (deg) => (deg * Math.PI) / 180;
  const dLat = rad(to.lat - from.lat);
  const dLng = rad(to.lng - from.lng);
  const lat1 = rad(from.lat);
  const lat2 = rad(to.lat);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return earthMiles * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function fallbackRouteEstimate(args, source, error) {
  const mode = routeModeLabel(args && args.mode);
  const from = { lat: Number(args && args.fromLat), lng: Number(args && args.fromLng) };
  const to = { lat: Number(args && args.toLat), lng: Number(args && args.toLng) };
  const miles = haversineMiles(from, to);
  const mph = mode === 'bike' ? 9 : 3;
  return {
    mode,
    minutes: Math.max(1, Math.round((miles / mph) * 60)),
    distanceMiles: miles,
    source,
    cacheTtlMs: ROUTE_CACHE_TTL_MS,
    error: error || '',
  };
}

function validateRouteArgs(args) {
  const fromLat = finiteNumber(args && args.fromLat);
  const fromLng = finiteNumber(args && args.fromLng);
  const toLat = finiteNumber(args && args.toLat);
  const toLng = finiteNumber(args && args.toLng);
  if (fromLat == null || fromLng == null || toLat == null || toLng == null) {
    throw new Error('routeEstimate requires finite from/to coordinates');
  }
  return {
    fromLat,
    fromLng,
    toLat,
    toLng,
    mode: routeModeLabel(args.mode),
    baseUrl: args.baseUrl,
  };
}

globalThis.__snapbackHandlers = {
  async applyFeedTick(ctx, args) {
    // Committed schedule patterns (stable seed ids). The refresh sets each
    // pattern's delay from the current recorded tick; absent => on time.
    const observedAt = nowMs(ctx);
    const trigger = (args && args.trigger) || 'manual';
    const source = (args && args.source) || 'recorded';

    const state = await ctx.db.get('feedRefreshState', 'caltrain');
    const tickCount = state && state.tickCount ? state.tickCount : 1;
    const currentIndex = state && Number.isInteger(state.tickIndex) ? state.tickIndex : 0;
    const nextIndex = (currentIndex + 1) % Math.max(1, tickCount);

    const tick = await ctx.db.get('feedTicks', `tick-${nextIndex}`);
    const delays = (tick && tick.delays) || {};

    for (const patternId of PATTERN_IDS) {
      const delaySeconds = Number(delays[patternId]) || 0;
      const status = delaySeconds >= 120 ? 'delayed' : 'on-time';
      await ctx.db.patch('trainStatus', patternId, { delaySeconds, status, observedAt });
    }

    await ctx.db.patch('feedRefreshState', 'caltrain', {
      fetchedAt: observedAt,
      tickIndex: nextIndex,
      lastSource: source,
      lastRunTrigger: trigger,
      lastError: (args && args.lastError) || '',
    });

    return { tickIndex: nextIndex, note: (tick && tick.note) || '' };
  },

  async applyLiveFeedSnapshot(ctx, args) {
    const observedAt = nowMs(ctx);
    const trigger = (args && args.trigger) || 'manual';
    const delays = (args && args.delays) || {};
    const touched = [];

    for (const patternId of PATTERN_IDS) {
      if (!Object.prototype.hasOwnProperty.call(delays, patternId)) continue;
      const delaySeconds = Math.max(-300, Math.min(3600, Math.round(Number(delays[patternId]) || 0)));
      const status = delaySeconds >= 120 ? 'delayed' : 'on-time';
      await ctx.db.patch('trainStatus', patternId, { delaySeconds, status, observedAt });
      touched.push(patternId);
    }

    await ctx.db.patch('feedRefreshState', 'caltrain', {
      fetchedAt: observedAt,
      lastSource: (args && args.source) || '511-siri-stop-monitoring',
      lastRunTrigger: trigger,
      lastError: (args && args.lastError) || '',
    });

    return {
      source: (args && args.source) || '511-siri-stop-monitoring',
      patterns: touched,
      note: (args && args.note) || '',
    };
  },

  async resetFeed(ctx) {
    const observedAt = nowMs(ctx);
    for (const patternId of PATTERN_IDS) {
      await ctx.db.patch('trainStatus', patternId, { delaySeconds: 0, status: 'on-time', observedAt });
    }
    await ctx.db.patch('feedRefreshState', 'caltrain', {
      fetchedAt: observedAt,
      tickIndex: 0,
      lastSource: 'reset',
      lastRunTrigger: 'reset',
      lastError: '',
    });
    return { tickIndex: 0 };
  },

  // The cron-invoked action. With egress/config it fetches 511 StopMonitoring;
  // without them it advances the recorded feed and records why it fell back.
  async refreshFeed(ctx, args) {
    const trigger = (args && args.trigger) || 'cron';
    if (args && args.source === 'recorded') {
      return await ctx.runMutation('applyFeedTick', { trigger, source: 'recorded' });
    }
    try {
      const snapshot = await fetchCaltrainDelays(ctx, args || {});
      return await ctx.runMutation('applyLiveFeedSnapshot', {
        trigger,
        source: '511-siri-stop-monitoring',
        delays: snapshot.delays,
        note: `mapped ${snapshot.visitCount} 511 visits`,
        lastError: '',
      });
    } catch (error) {
      return await ctx.runMutation('applyFeedTick', {
        trigger,
        source: 'recorded-fallback',
        lastError: errorMessage(error),
      });
    }
  },

  async routeEstimate(ctx, args) {
    let input;
    try {
      input = validateRouteArgs(args || {});
    } catch (error) {
      return fallbackRouteEstimate(args || {}, 'haversine-fallback', errorMessage(error));
    }

    let key;
    try {
      key = ctx.secrets.rotating('directions').expose();
    } catch (error) {
      return fallbackRouteEstimate(input, 'haversine-fallback', errorMessage(error));
    }

    const profile = routeProfile(input.mode);
    const start = `${input.fromLng},${input.fromLat}`;
    const end = `${input.toLng},${input.toLat}`;
    let lastError = '';
    for (const base of routeBaseUrls(input)) {
      const url = `${base}/v2/directions/${profile}?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`;
      try {
        const json = await fetchJson(url, {
          headers: { Authorization: key, Accept: 'application/json' },
          timeout: 15_000,
        });
        const summary = routeSummary(json);
        return {
          mode: input.mode,
          minutes: Math.max(1, Math.round(summary.durationSeconds / 60)),
          distanceMiles: summary.distanceMeters / METERS_PER_MILE,
          source: 'openrouteservice',
          profile,
          cacheTtlMs: ROUTE_CACHE_TTL_MS,
        };
      } catch (error) {
        lastError = errorMessage(error);
      }
    }
    return fallbackRouteEstimate(input, 'haversine-fallback', lastError);
  },
};
