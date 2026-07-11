// Contract-facing data helpers for the All Aboard surface.
//
// These are the pure helpers the app.contract `use`s. The transit math lives in
// the shared model (imported unchanged). Live Snapback data (delays + the
// freshness marker) arrives as ARGUMENTS — the .contract's `query` bindings
// over the generated liveTrainStatus/feedState descriptors (LLP 0034 §6
// ownership row 3; Exact LLP 0284 §5.3) — so these helpers are genuinely
// pure-by-args for the live data. The store.mjs seam and its poll pump are
// gone: server push drives the bindings, and the bindings drive the derives.
//
// Device location is the one remaining piece of module state: it is a device
// capability (navigator.geolocation), not transport glue, so it lives here as
// explicit device glue behind `setDeviceLocation`. Location-reading helpers
// keep the ticking `nowMs` cache-buster so the 1s clock re-derives them (the
// clock is UI — countdowns tick — not transport).

import {
  PATTERNS,
  computePosition,
  getAdjacentStation as modelAdjacent,
  assumedDirection as modelAssumedDirection,
  directionTitle as modelDirectionTitle,
  estimateBikeMinutes,
  estimateDistanceMiles,
  estimateWalkMinutes,
  formatClockTime as modelFormatClockTime,
  formatCountdownMinutes as modelFormatCountdown,
  getDirectionBoard as modelDirectionBoard,
  getNearestStation,
  getSelectedStation as modelSelectedStation,
  getStationById,
  getStations as modelStations,
  getTrainRun as modelTrainRun,
  getUpcomingDepartures as modelUpcomingDepartures,
  searchStations as modelSearch,
  serviceColor as modelServiceColor,
  stationPhoto as modelStationPhoto,
  stationPhotoCredit as modelStationPhotoCredit,
} from '../../snapback/shared/model.mjs';
import { STATION_ART_SCENES } from '../../snapback/shared/station-art.gen.mjs';
const DEFAULT_LOCATION = { lat: 37.3894, lng: -122.0819 }; // Mountain View fallback

// --- Device location (device-capability glue, set by main.ts) -----------------

type LatLng = { lat: number; lng: number };
type RouteMode = 'walk' | 'bike';
type RouteStation = { id?: string; lat: number; lng: number };
type RouteEstimateArgs = {
  fromLat: number;
  fromLng: number;
  toLat: number;
  toLng: number;
  mode: RouteMode;
};
type RouteEstimateResult = {
  mode?: string;
  minutes?: number;
  distanceMiles?: number;
  source?: string;
  cacheTtlMs?: number;
  error?: string;
};

const ROUTE_CACHE_TTL_MS = 5 * 60 * 1000;
let deviceLocation: LatLng | null = null;
let deviceLocationSource = 'default'; // 'device' | 'default' | 'denied' | 'unavailable'

// --- Maps-app preference (device-capability glue, like location) ---------------
//
// ENG-23795: which maps app the directions affordances open. The value lives
// here (not contract state) because the web glue both writes it (the Settings
// press cycles it, persisted to localStorage) and reads it (to build the URL a
// tap opens); the .contract renders it through `mapsAppLabel(nowMs)` so the 1s
// clock re-derives the label after a cycle. On native hosts without the glue
// the label stays on the platform default — a declared gap, not a fake toggle.

export type MapsApp = 'default' | 'apple' | 'google';
const MAPS_APPS: MapsApp[] = ['default', 'apple', 'google'];
let mapsApp: MapsApp = 'default';

export function getMapsApp(): MapsApp {
  return mapsApp;
}

export function setMapsApp(next: string | null): void {
  mapsApp = MAPS_APPS.includes(next as MapsApp) ? (next as MapsApp) : 'default';
}

export function cycleMapsApp(): MapsApp {
  mapsApp = MAPS_APPS[(MAPS_APPS.indexOf(mapsApp) + 1) % MAPS_APPS.length];
  return mapsApp;
}

export function mapsAppLabel(_tick?: number): string {
  if (mapsApp === 'apple') return 'Apple Maps';
  if (mapsApp === 'google') return 'Google Maps';
  return 'Platform default';
}

// City-level postal addresses for the copy-address action. The model has no
// street addresses; a "<name> Caltrain Station, <city>, CA" string is
// unambiguous for every maps app without inventing house numbers.
const STATION_CITIES: Record<string, string> = {
  'san-francisco': 'San Francisco',
  'twenty-second-st': 'San Francisco',
  'bayshore': 'San Francisco',
  'south-sf': 'South San Francisco',
  'san-bruno': 'San Bruno',
  'millbrae': 'Millbrae',
  'burlingame': 'Burlingame',
  'san-mateo': 'San Mateo',
  'hayward-park': 'San Mateo',
  'hillsdale': 'San Mateo',
  'belmont': 'Belmont',
  'san-carlos': 'San Carlos',
  'redwood-city': 'Redwood City',
  'menlo-park': 'Menlo Park',
  'palo-alto': 'Palo Alto',
  'california-ave': 'Palo Alto',
  'mountain-view': 'Mountain View',
  'sunnyvale': 'Sunnyvale',
  'lawrence': 'Sunnyvale',
  'santa-clara': 'Santa Clara',
  'san-jose': 'San Jose',
};

export function stationAddress(stationId: string): string {
  const station = getStationById(stationId);
  if (!station) return '';
  const city = STATION_CITIES[stationId] ?? '';
  return city ? `${station.name} Caltrain Station, ${city}, CA` : `${station.name} Caltrain Station, CA`;
}

// The URL a directions affordance opens, per resolved app. Apple's dirflg
// cycling flag degrades to a plain destination view on clients that predate
// it; Google's travelmode is first-class.
export function directionsUrl(stationId: string, app: 'apple' | 'google', mode: RouteMode): string {
  const station = getStationById(stationId);
  if (!station) return '';
  const dest = `${station.lat},${station.lng}`;
  if (app === 'google') {
    const travelmode = mode === 'bike' ? 'bicycling' : 'walking';
    return `https://www.google.com/maps/dir/?api=1&destination=${dest}&travelmode=${travelmode}`;
  }
  return `https://maps.apple.com/?daddr=${dest}&dirflg=${mode === 'bike' ? 'c' : 'w'}`;
}
let routeEstimateInvoker: ((args: RouteEstimateArgs) => Promise<RouteEstimateResult>) | null = null;
const routeCache = new Map<string, { estimate: RouteEstimateResult; storedAt: number }>();
const routeInFlight = new Set<string>();

export function setDeviceLocation(location: LatLng | null, source?: string): void {
  deviceLocation = location ?? null;
  deviceLocationSource = source ?? (location ? 'device' : 'default');
}

export function setRouteEstimateInvoker(invoker: ((args: RouteEstimateArgs) => Promise<RouteEstimateResult>) | null): void {
  routeEstimateInvoker = invoker;
  routeCache.clear();
  routeInFlight.clear();
}

// --- Appearance (device-capability glue, like location) ------------------------
//
// Dark mode. The scheme is module state written by the web glue (main.ts:
// prefers-color-scheme media query + change listener, with a ?appearance=
// URL override for tests and debugging) and read by themePalette, which the
// .contract derives off the ticking clock — so an OS appearance flip restyles
// the board within a second, no reload. The Caltrain-red header and the NEXT
// TRAIN pill deliberately keep their brand red + white in both schemes; the
// board surfaces, text, and accents swap. On native hosts without the glue
// the app stays light — a declared gap (ENG-24056 territory), not a bug.

export type ColorScheme = 'light' | 'dark';
let colorScheme: ColorScheme = 'light';

export function setColorScheme(next: string | null): void {
  colorScheme = next === 'dark' ? 'dark' : 'light';
}

export function getColorScheme(): ColorScheme {
  return colorScheme;
}

function isDark(): boolean {
  return colorScheme === 'dark';
}

// Every layout color the .contract uses, as one derive-friendly token object.
// Light is the shipped ENG-23719 palette verbatim; dark keeps the same
// relationships (warm near-black board, soft raised cards, warm hairlines,
// a lifted Caltrain red for text accents — pure #C8102E fails contrast as
// text on the dark board).
//
// @ref LLP 0052#motivation — interim update-economy mitigation: reference-
// stable derive results; D3/D4 (value-based dirtiness, derive memoization)
// are the framework-side closure.
// IDENTITY MATTERS: the two palettes are module singletons, not fresh
// objects per call. The renderer's change detection is props-REFERENCE
// based (dom-mirror.ts "same props reference means nothing to apply",
// ENG-23260): a derive that returns a value-equal but fresh object marks
// every node reading it dirty, and the UI thread re-applies the whole
// themed tree on every clock tick — the main-thread stall behind the
// scroll jank. Stable identity per scheme means a tick that changes no
// color contributes no theme-driven work to the patch.
const LIGHT_PALETTE = buildLightPalette();
const DARK_PALETTE = buildDarkPalette();

export function themePalette(_tick?: number) {
  return isDark() ? DARK_PALETTE : LIGHT_PALETTE;
}

function buildLightPalette() {
  return {
      scheme: 'light',
      bg: '#ffffff',
      card: '#ffffff',
      ink: '#1A1F27',
      body: '#2A313B',
      secondary: '#57606C',
      muted: '#8A93A0',
      hairline: '#E7E2DB',
      soft: '#F7F5F2',
      chip: '#F2EFEA',
      iconBtn: '#F5F3F0',
      heroBg: '#FDF7F5',
      heroBorder: '#C8102E3D',
      accent: '#C8102E',
      accentSoftBg: '#C8102E14',
      accentSoftBorder: '#C8102E3D',
      accentFaintBg: '#C8102E0D',
      accentFaintBorder: '#C8102E4D',
      warnText: '#92400E',
      warnBg: '#B4530914',
      warnBorder: '#B4530936',
      noteText: '#5B6470',
      noteBg: '#8A93A014',
      noteBorder: '#8A93A036',
      dotIdle: '#D8D2C9',
      scrim: '#00000055',
    };
}

function buildDarkPalette() {
  return {
    scheme: 'dark',
    bg: '#14171C',
    card: '#1E232B',
    ink: '#F2F4F7',
    body: '#D5DAE1',
    secondary: '#A6ADBA',
    muted: '#7A828E',
    hairline: '#2A2F37',
    soft: '#1A1F26',
    chip: '#252B34',
    iconBtn: '#232932',
    heroBg: '#261B1E',
    heroBorder: '#C8102E80',
    accent: '#F06478',
    accentSoftBg: '#F0647824',
    accentSoftBorder: '#F0647852',
    accentFaintBg: '#F0647817',
    accentFaintBorder: '#F0647860',
    warnText: '#FBBF24',
    warnBg: '#B4530926',
    warnBorder: '#B4530955',
    noteText: '#A6ADBA',
    noteBg: '#8A93A01F',
    noteBorder: '#8A93A03D',
    dotIdle: '#3A4048',
    scrim: '#00000088',
  };
}

// --- Safe area (device-capability glue, like location and appearance) ---------
//
// The app draws its own full-bleed chrome (absolute sticky header/footer), so
// it must consume the device safe area itself: the red header extends under
// the iOS status bar / notch with its content pushed down, and the footer
// keeps its controls above the home indicator. The native Exact host
// publishes the real insets as `globalThis.exact.safeAreaInsets` (the
// renderer-level safe-area system never engages for this surface: the
// contract native startup does not register the window-management
// __exactSafeAreaRegionsChanged hook, so window-state stays zero). Reading
// the host global live on each derive — off the ticking clock, like every
// other device-glue helper here — adopts inset changes (rotation, dynamic
// island) within a second. On web the browser owns the safe area and the
// host global is absent, so everything stays zero; setSafeAreaInsets is the
// explicit override seam for tests and any host without the global.

export type SafeAreaInsetsValue = { top: number; right: number; bottom: number; left: number };
let safeAreaOverride: SafeAreaInsetsValue | null = null;

export function setSafeAreaInsets(next: Partial<SafeAreaInsetsValue> | null): void {
  safeAreaOverride = next
    ? {
        top: clampInset(next.top),
        right: clampInset(next.right),
        bottom: clampInset(next.bottom),
        left: clampInset(next.left),
      }
    : null;
}

function clampInset(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

export function safeAreaInsets(_tick?: number): SafeAreaInsetsValue {
  if (safeAreaOverride) return safeAreaOverride;
  const host = (globalThis as { exact?: { safeAreaInsets?: Partial<SafeAreaInsetsValue> } })
    .exact?.safeAreaInsets;
  return {
    top: clampInset(host?.top),
    right: clampInset(host?.right),
    bottom: clampInset(host?.bottom),
    left: clampInset(host?.left),
  };
}

// --- Backend attach state (board-first startup, ENG-23727) --------------------
//
// The board mounts before the backend attaches, so the surface needs an
// honest, non-blocking answer to "is this live yet?". main.ts writes the
// phase here (transport glue, like device location); the ticking nowMs clock
// re-derives the note, so the board reflects a phase change within a second.

type BackendState = 'connecting' | 'connected' | 'offline';
let backendState: BackendState = 'connecting';

export function setBackendState(next: BackendState): void {
  backendState = next;
}

// The small status affordance shown with the schedule board while the live
// bindings are still pending; empty once the backend is attached (the live
// arms own freshness from then on).
export function backendStatusNote(_tick?: number): string {
  switch (backendState) {
    case 'connected': return '';
    case 'offline': return 'Offline — showing scheduled departures';
    default: return 'Connecting for live updates…';
  }
}

// The `loading` arm renders the same DirectionBoard as the live arms; this is
// its stand-in for the not-yet-delivered liveTrainStatus rows.
export function emptyDelayRows(): DelayRow[] {
  return [];
}

// --- Location + station selection --------------------------------------------

export function getUserLocation(_tick?: number) {
  return deviceLocation ?? DEFAULT_LOCATION;
}

export function locationSource(_tick?: number): string {
  return deviceLocationSource;
}

// A friendly signal of whether the nearest station came from the device or a
// fallback — so a denied/dismissed permission prompt is legible, not silent.
// Shown in Settings only; the home board communicates location state through
// the footer icon color alone (locationIndicatorColor). The denied line says
// what to do about it: once the user re-allows access (the Settings press
// re-prompts; a site-settings flip fires the permission change event main.ts
// listens for), the board adopts the real location without a reload.
export function locationHint(_tick?: number): string {
  switch (deviceLocationSource) {
    case 'device': return '📍 Using your location';
    case 'denied': return 'Location blocked — allow location for this site, then tap here';
    case 'unavailable': return 'Location unavailable — showing a default stop';
    default: return 'Allow location for your nearest stop';
  }
}

// The sticky-footer location indicator (ENG-23795): blue while the board is
// on the real device location and gray on any fallback. The icon is the ONLY
// home-board location signal — the old hint-text line under the board is
// gone; the full explanation (and the retry affordance) lives in Settings.
export function locationIndicatorColor(_tick?: number): string {
  if (deviceLocationSource === 'device') return '#0A84FF';
  return isDark() ? '#8A93A0' : '#9CA3AF';
}

// --- Sticky-footer icons -------------------------------------------------------
//
// Proper stroke icons (24-unit grid, 2px round strokes) rendered through the
// contract `image svgSource=` inline-SVG host, replacing the mismatched text
// glyphs (⬉ ↻ ⚙) that drew at different weights and optical sizes per
// platform font. The stroke color is baked into the markup so the same string
// renders identically on the web mirror and native hosts.

function strokeIconSvg(color: string, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}

// Navigation arrow; takes the live locationIndicatorColor so the icon itself
// says device fix (blue) vs fallback (gray).
export function locationIconSvg(color: string): string {
  return strokeIconSvg(color, '<polygon points="3 11 22 2 13 21 11 13 3 11"/>');
}

// Ticket icon for the Clipper affordance (get / refill a Clipper card). The
// press is web glue in main.ts — device-aware: the Clipper app store listing
// on iOS/Android, clippercard.com elsewhere. Like the other footer icons it
// takes its stroke color from the theme (theme.secondary).
export function ticketIconSvg(color: string): string {
  return strokeIconSvg(color, '<path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2z"/><path d="M13 5v2"/><path d="M13 11v2"/><path d="M13 17v2"/>');
}

export function refreshIconSvg(color: string): string {
  return strokeIconSvg(color, '<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>');
}

export function settingsIconSvg(color: string): string {
  return strokeIconSvg(color, '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>');
}

export function getSelectedStation(stationId: string | null, _tick?: number) {
  return modelSelectedStation(stationId, getUserLocation());
}

export function getStations() {
  return modelStations();
}

export function searchStations(query: string, _tick?: number) {
  return modelSearch(query, getUserLocation());
}

export function adjacentStationId(stationId: string, delta: number): string {
  const next = modelAdjacent(stationId, delta);
  return next ? next.id : stationId;
}

export function stationPhoto(stationId: string): string {
  return modelStationPhoto(stationId) ?? '';
}

export function stationPhotoCredit(stationId: string): string {
  return modelStationPhotoCredit(stationId) ?? '';
}

// The hand-drawn header scene (ENG-23719). Each station has three original
// scenes (ENG-23684); the pick rotates by epoch day — day-of-epoch mod the
// scene count — so the whole app flips to the next scene at midnight UTC and
// the choice stays deterministic (no per-render randomness to break tests).
const DAY_MS = 24 * 60 * 60 * 1000;

export function stationArt(stationId: string, nowMs: number): string {
  const scenes = (STATION_ART_SCENES as Record<string, string[]>)[stationId] ?? [];
  if (scenes.length === 0) return '';
  const day = Math.max(0, Math.floor(nowMs / DAY_MS));
  return scenes[day % scenes.length] ?? '';
}

// --- Direction ----------------------------------------------------------------

export function assumedDirection(station: { orderIndex: number } | null): string {
  return modelAssumedDirection(station);
}

export function activeDirection(override: string | null, station: { orderIndex: number } | null): string {
  return override === 'north' || override === 'south' ? override : modelAssumedDirection(station);
}

export function oppositeDirection(direction: string): string {
  return direction === 'north' ? 'south' : 'north';
}

export function directionTitle(direction: string): string {
  return modelDirectionTitle(direction);
}

// --- Boards + trips (live delays arrive as liveTrainStatus rows) --------------

type DelayRow = { patternId: string; delaySeconds: number };
type FeedRow = { lastSource?: string };
type LiveDepartureRow = {
  _id?: string;
  departureId?: string;
  stationId: string;
  direction: string;
  service: string;
  patternId?: string;
  trainNumber?: string;
  headsign?: string;
  scheduledDepartureMs: number;
  predictedDepartureMs: number;
  delaySeconds?: number;
  status?: string;
};

const LIVE_FEED_SOURCE = '511-siri-stop-monitoring';
const DEPARTED_GRACE_MS = 60 * 1000;

// liveTrainStatus rows -> the patternId -> delaySeconds map the model expects.
function delaysFrom(delayRows: readonly DelayRow[] | null | undefined): Record<string, number> {
  const delays: Record<string, number> = {};
  for (const row of delayRows ?? []) delays[row.patternId] = row.delaySeconds;
  return delays;
}

function isLiveFeed(feedRows: readonly FeedRow[] | null | undefined): boolean {
  return (feedRows?.[0]?.lastSource ?? '') === LIVE_FEED_SOURCE;
}

function liveDepartureId(row: LiveDepartureRow): string {
  return `live:${row._id ?? row.departureId ?? `${row.stationId}:${row.predictedDepartureMs}:${row.trainNumber ?? ''}`}`;
}

function departureFromLiveRow(row: LiveDepartureRow) {
  return {
    id: liveDepartureId(row),
    source: '511-siri-stop-monitoring',
    patternId: row.patternId ?? '',
    direction: row.direction,
    service: row.service || 'Local',
    trainNumber: row.trainNumber || '',
    headsign: row.headsign || (row.direction === 'north' ? 'San Francisco' : 'San Jose Diridon'),
    stationId: row.stationId,
    scheduledDepartureMs: row.scheduledDepartureMs,
    predictedDepartureMs: row.predictedDepartureMs,
    delaySeconds: row.delaySeconds ?? 0,
  };
}

function liveDeparturesFor(stationId: string, direction: string, nowMs: number, departureRows: readonly LiveDepartureRow[] | null | undefined, limit: number) {
  return (departureRows ?? [])
    .filter((row) => row.stationId === stationId && row.direction === direction)
    .filter((row) => Number(row.predictedDepartureMs) > nowMs - DEPARTED_GRACE_MS)
    .sort((a, b) => Number(a.predictedDepartureMs) - Number(b.predictedDepartureMs))
    .slice(0, limit)
    .map(departureFromLiveRow);
}

export function getDirectionBoard(
  stationId: string,
  direction: string,
  nowMs: number,
  limit: number,
  delayRows: DelayRow[],
  departureRows: LiveDepartureRow[],
  feedRows: FeedRow[],
) {
  if (isLiveFeed(feedRows)) {
    const departures = liveDeparturesFor(stationId, direction, nowMs, departureRows, limit);
    return {
      direction,
      stationId,
      primary: departures[0] ?? null,
      secondary: departures.slice(1),
    };
  }
  return modelDirectionBoard(stationId, direction, nowMs, delaysFrom(delayRows), limit);
}

// The hero-selection board (ENG-23795 paging model): `heroOffset` walks the
// upcoming trains. The offset is clamped to the rows that exist, so an offset
// stranded by time passing (the selected train departs) degrades to the last
// remaining train. Alongside the hero the board carries:
//   - heroPrev/heroNext: the physically adjacent cards for the paging strip
//     (visible mid-gesture, exactly the native contiguous-page model);
//   - before: ALL the sooner trains already paged past, in compact rows above
//     the hero, so paging to a later train never makes earlier trains vanish.
//     No cap: the list can only grow to the day's remaining departures, and a
//     selection far in the future SHOULD read as "many trains from now" — the
//     user scrolls; the primary use case is the next few trains anyway;
//   - rest: ALL the trains after the hero for the rest of the day. The rows
//     more than three past the selected train gradually fade (the `fade`
//     opacity, floored so the last trains stay legible) — the full day is
//     scannable, but the eye stays on the next few departures.
// Every before/rest row carries its absolute offset (press = select that
// train) and a precomputed testId: the rows adjacent to the hero are
// 'train-prev'/'train-next', so the keyboard/gesture/native press paths keep
// one stable handle for "walk one train" now that the arrow buttons are gone.
export function boardTrains(
  stationId: string,
  direction: string,
  nowMs: number,
  heroOffset: number,
  delayRows: DelayRow[],
  departureRows: LiveDepartureRow[],
  feedRows: FeedRow[],
) {
  const wanted = Math.max(0, heroOffset ?? 0);
  // A full weekday of one-direction Caltrain departures is well under this;
  // the board shows the whole rest of the day, not a moving window.
  const dayLimit = Math.max(96, wanted + 2);
  const rows = isLiveFeed(feedRows)
    ? liveDeparturesFor(stationId, direction, nowMs, departureRows, dayLimit)
    : modelUpcomingDepartures(stationId, direction, nowMs, delaysFrom(delayRows), dayLimit);
  const offset = rows.length === 0 ? 0 : Math.min(wanted, rows.length - 1);
  // Rows more than 3 past the hero fade by 0.12 per step, floored at 0.38.
  const fadeFor = (absolute: number) =>
    absolute <= offset + 3 ? 1 : Math.max(0.38, 1 - (absolute - offset - 3) * 0.12);
  const withMeta = (row: (typeof rows)[number], absolute: number) => ({
    ...row,
    offset: absolute,
    fade: fadeFor(absolute),
    testId:
      absolute === offset - 1 ? 'train-prev' : absolute === offset + 1 ? 'train-next' : `train-at-${absolute}`,
  });
  return {
    hero: rows[offset] ?? null,
    heroPrev: offset > 0 ? rows[offset - 1] : null,
    heroNext: rows[offset + 1] ?? null,
    before: rows.slice(0, offset).map((row, i) => withMeta(row, i)),
    rest: rows.slice(offset + 1).map((row, i) => withMeta(row, offset + 1 + i)),
    hasPrev: offset > 0,
    hasNext: rows.length > offset + 1,
    offset,
  };
}

// The end-of-line hint for a stations-list row (ENG-23795): the next train in
// the active direction from that station, projected to its own final stop —
// "… San Francisco 8:42" — so "does this get me to SF, and when?" is
// answerable from the list without opening every stop.
export function terminalHint(
  stationId: string,
  direction: string,
  nowMs: number,
  delayRows: DelayRow[],
  departureRows: LiveDepartureRow[],
  feedRows: FeedRow[],
): string {
  const board = getDirectionBoard(stationId, direction, nowMs, 1, delayRows, departureRows, feedRows);
  const primary = board?.primary;
  if (!primary) return '';
  const run = getTrainRun(primary.id, nowMs, delayRows, departureRows);
  const last = run?.stops?.[run.stops.length - 1];
  if (!last) return '';
  return `… ${last.station.name} ${modelFormatClockTime(last.predictedTimeMs)}`;
}

// On-time / late marker for a departure (or a trip; both carry delaySeconds).
export function delayLabel(dep: { delaySeconds?: number } | null): string {
  if (!dep) return '';
  const s = dep.delaySeconds ?? 0;
  return s >= 45 ? `${Math.max(1, Math.round(s / 60))} min late` : 'on time';
}

// Scheme-aware on-time/late hues: dark ink-ish hues on the white board
// (ENG-23719 — the light tints failed contrast there), lifted variants on
// the dark board where the deep hues disappear.
export function delayColor(dep: { delaySeconds?: number } | null): string {
  const late = (dep?.delaySeconds ?? 0) >= 45;
  if (isDark()) return late ? '#FBBF24' : '#34D399';
  return late ? '#B45309' : '#047857';
}

// Compact destination for the departure rows ("Diridon", not "San Jose
// Diridon") — headsign is the destination station's full name.
export function shortHeadsign(dep: { headsign?: string } | null): string {
  const headsign = dep?.headsign ?? '';
  const match = modelStations().find((s: { name: string; shortName: string }) => s.name === headsign);
  return match ? match.shortName : headsign;
}

function liveRowByRunId(runId: string, departureRows: readonly LiveDepartureRow[] | null | undefined): LiveDepartureRow | null {
  if (!String(runId || '').startsWith('live:')) return null;
  const key = String(runId).slice(5);
  return (departureRows ?? []).find((row) =>
    row._id === key ||
    row.departureId === key ||
    `${row.stationId}:${row.predictedDepartureMs}:${row.trainNumber ?? ''}` === key
  ) ?? null;
}

function stationByName(name: string | null | undefined) {
  const normalized = String(name || '').toLowerCase();
  return modelStations().find((s: { id: string; name: string; shortName: string }) =>
    normalized.includes(s.name.toLowerCase()) || normalized.includes(s.shortName.toLowerCase())
  ) ?? null;
}

function realTrainNumber(row: LiveDepartureRow): string | null {
  const value = String(row.trainNumber ?? '');
  return /^\d+$/.test(value) ? value : null;
}

// All liveDepartures rows that belong to the same physical journey as `live`.
// 511 StopMonitoring is stop-centric: one journey surfaces as one row per
// monitored station, joined by DatedVehicleJourneyRef (departureId), with the
// real train number as the fallback join key when the ref is absent.
function liveJourneyRows(live: LiveDepartureRow, departureRows: readonly LiveDepartureRow[] | null | undefined): LiveDepartureRow[] {
  const trainNumber = realTrainNumber(live);
  return (departureRows ?? []).filter((row) => {
    if (row.direction !== live.direction) return false;
    if (live.departureId && row.departureId === live.departureId) return true;
    return trainNumber !== null && realTrainNumber(row) === trainNumber;
  });
}

function liveSpeedFactor(patternId: string, service: string): number {
  const pattern = PATTERNS.find((p: { id: string }) => p.id === patternId);
  if (pattern) return pattern.speedFactor;
  if (service === 'Baby Bullet') return 0.66;
  if (service === 'Limited') return 0.82;
  return 1.0;
}

// Rebuild the full trip for a live 511 run (ENG-23729). The stop sequence comes
// from the service pattern (from the boarding station to the destination); each
// stop's time is the journey's own StopMonitoring row where the feed has one,
// and otherwise the pattern's corridor travel time anchored at the boarding
// stop's live times, marked `estimated`. This is what keeps a multi-station run
// from ever rendering as "0 min · 2 stops" with duplicated endpoint timestamps
// unless the feed itself says exactly that.
function buildLiveTrainRun(runId: string, live: LiveDepartureRow, departureRows: readonly LiveDepartureRow[] | null | undefined, nowMs: number) {
  const boarding = getStationById(live.stationId);
  if (!boarding) return null;
  const towardSouth = live.direction !== 'north';
  const destination = stationByName(live.headsign) ?? getStationById(towardSouth ? 'san-jose' : 'san-francisco');

  // The freshest live row per station for this journey (the feed can carry
  // more than one visit per stop; keep the earliest upcoming one).
  const rowsByStation = new Map<string, LiveDepartureRow>();
  for (const row of liveJourneyRows(live, departureRows)) {
    const existing = rowsByStation.get(row.stationId);
    if (!existing || Number(row.predictedDepartureMs) < Number(existing.predictedDepartureMs)) {
      rowsByStation.set(row.stationId, row);
    }
  }

  // Stop sequence: the service pattern's stop list from the boarding station to
  // the destination when the pattern serves the boarding stop; otherwise just
  // the journey's own observed stations, corridor-ordered.
  const pattern = PATTERNS.find((p: { id: string; stopIds: string[] }) => p.id === (live.patternId ?? ''));
  let stationIds: string[];
  if (pattern && pattern.stopIds.includes(boarding.id)) {
    const from = pattern.stopIds.indexOf(boarding.id);
    const destIndex = destination ? pattern.stopIds.indexOf(destination.id) : -1;
    stationIds = pattern.stopIds.slice(from, (destIndex > from ? destIndex : pattern.stopIds.length - 1) + 1);
  } else {
    const bounds = destination ?? boarding;
    stationIds = [...rowsByStation.keys(), boarding.id, ...(destination ? [destination.id] : [])]
      .map((id) => getStationById(id))
      .filter((station) => station !== null)
      .filter((station) => towardSouth
        ? station.orderIndex >= boarding.orderIndex && station.orderIndex <= Math.max(bounds.orderIndex, boarding.orderIndex)
        : station.orderIndex <= boarding.orderIndex && station.orderIndex >= Math.min(bounds.orderIndex, boarding.orderIndex))
      .sort((a, b) => (towardSouth ? a.orderIndex - b.orderIndex : b.orderIndex - a.orderIndex))
      .map((station) => station.id)
      .filter((id, index, ids) => ids.indexOf(id) === index);
  }
  if (stationIds.length === 0) stationIds = [boarding.id];

  const speedFactor = liveSpeedFactor(live.patternId ?? '', live.service || 'Local');
  const stops = stationIds.map((stationId, sequence) => {
    const station = getStationById(stationId);
    const row = rowsByStation.get(stationId);
    if (row) {
      return {
        station,
        sequence,
        scheduledTimeMs: Number(row.scheduledDepartureMs),
        predictedTimeMs: Number(row.predictedDepartureMs),
        estimated: false,
      };
    }
    const offsetMs = Math.round(Math.abs(station.minutesFromSf - boarding.minutesFromSf) * speedFactor) * 60_000;
    return {
      station,
      sequence,
      scheduledTimeMs: Number(live.scheduledDepartureMs) + offsetMs,
      predictedTimeMs: Number(live.predictedDepartureMs) + offsetMs,
      estimated: true,
    };
  });

  const durationMinutes = stops.length > 1
    ? Math.round((stops[stops.length - 1].scheduledTimeMs - stops[0].scheduledTimeMs) / 60_000)
    : 0;

  return {
    id: runId,
    patternId: live.patternId ?? '',
    direction: live.direction,
    service: live.service || 'Local',
    trainNumber: live.trainNumber || '',
    delaySeconds: live.delaySeconds ?? 0,
    origin: boarding,
    destination,
    headsign: live.headsign || destination?.name || '',
    stopCount: stops.length,
    durationMinutes,
    stops,
    position: computePosition(stops, nowMs),
  };
}

export function getTrainRun(runId: string, nowMs: number, delayRows: DelayRow[], departureRows: LiveDepartureRow[]) {
  const live = liveRowByRunId(runId, departureRows);
  if (live) return buildLiveTrainRun(runId, live, departureRows, nowMs);
  return modelTrainRun(runId, nowMs, delaysFrom(delayRows));
}

// The hero card's stop chips: the boarding stop, then the END of the run —
// an ellipsis marker and the last two stops — not the next few intermediate
// stops. The card answers "when does it leave here" and "when does it get
// where it's going"; the full stop list is one tap away on the trip detail.
// Fewer than four stops from boarding need no ellipsis: everything fits.
export function heroStops(runId: string, stationId: string, nowMs: number, delayRows: DelayRow[], departureRows: LiveDepartureRow[]) {
  const trip = getTrainRun(runId, nowMs, delayRows, departureRows);
  if (!trip) return [];
  const boardingIndex = trip.stops.findIndex((stop: { station: { id: string } }) => stop.station.id === stationId);
  const from = boardingIndex >= 0 ? boardingIndex : 0;
  const stops = trip.stops.slice(from);
  if (stops.length === 0) return [];
  const chip = (stop: { station: { id: string; shortName: string }; predictedTimeMs: number; estimated?: boolean }) => ({
    id: stop.station.id,
    gap: false,
    name: stop.station.shortName,
    time: stopClockLabel(stop),
    isBoarding: stop.station.id === stationId,
  });
  const rest = stops.slice(1);
  if (rest.length <= 3) return [chip(stops[0]), ...rest.map(chip)];
  return [
    chip(stops[0]),
    { id: 'gap', gap: true, name: '', time: '', isBoarding: false },
    ...rest.slice(-2).map(chip),
  ];
}

// The trip screen's headline number: minutes until this train reaches the
// boarding station — the primary question of the whole app, so the detail
// screen answers it too instead of only listing per-stop clock times. Null
// when the trip does not serve the boarding station; `departed` once the
// train's own call there is in the past (beyond the same grace the board
// rows use).
export function boardingCall(
  trip: { stops?: Array<{ station: { id: string; shortName: string }; predictedTimeMs: number; estimated?: boolean }> } | null,
  stationId: string,
  nowMs: number,
) {
  const stop = trip?.stops?.find((s) => s.station.id === stationId);
  if (!stop) return null;
  return {
    departed: Number(stop.predictedTimeMs) < nowMs - DEPARTED_GRACE_MS,
    minutes: modelFormatCountdown(stop.predictedTimeMs, nowMs),
    name: stop.station.shortName,
    time: stopClockLabel(stop),
  };
}

// The served stops from the boarding station onward — the hero chips'
// predecessor, kept for the live-run reconstruction checks
// (trip-detail-live.mjs) that assert per-stop estimated markers.
export function upcomingStops(runId: string, stationId: string, nowMs: number, limit: number, delayRows: DelayRow[], departureRows: LiveDepartureRow[]) {
  const trip = getTrainRun(runId, nowMs, delayRows, departureRows);
  if (!trip) return [];
  const boardingIndex = trip.stops.findIndex((stop: { station: { id: string } }) => stop.station.id === stationId);
  const from = boardingIndex >= 0 ? boardingIndex : 0;
  return trip.stops.slice(from, from + (limit || 6)).map((stop: { station: { id: string; shortName: string }; predictedTimeMs: number; estimated?: boolean }) => ({
    id: stop.station.id,
    name: stop.station.shortName,
    time: stopClockLabel(stop),
    isBoarding: stop.station.id === stationId,
  }));
}

// Clock label for a stop row: real times (model schedule or live 511 rows)
// render plain; times interpolated from the pattern for stations the live feed
// did not cover are marked approximate.
export function stopClockLabel(stop: { predictedTimeMs: number; estimated?: boolean }): string {
  return `${stop.estimated ? '~' : ''}${modelFormatClockTime(stop.predictedTimeMs)}`;
}

// --- Formatting ---------------------------------------------------------------

export function formatClockTime(timestampMs: number): string {
  return modelFormatClockTime(timestampMs);
}

export function formatCountdownMinutes(targetMs: number, nowMs: number): number {
  return modelFormatCountdown(targetMs, nowMs);
}

export function serviceColor(service: string): string {
  return modelServiceColor(service);
}

export function serviceTint(service: string): string {
  // ~13% alpha pill background on light; a touch stronger on the dark board
  // where 13% of a mid hue vanishes into the surface.
  return `${modelServiceColor(service)}${isDark() ? '30' : '22'}`;
}

// --- Walk / bike (haversine over the seed coordinates) ------------------------
//
// E4 / ENG-23795: the app-wide ETA mode is 'auto' | 'walk' | 'bike'. 'auto'
// (the default) resolves per station: beyond an 18-minute walk the app
// defaults to biking directions; an explicit toggle in Settings pins the mode.

const AUTO_BIKE_OVER_WALK_MINUTES = 18;

export function effectiveEtaMode(station: RouteStation, mode: string, _tick?: number): RouteMode {
  if (mode === 'walk' || mode === 'bike') return mode;
  const walkMinutes = estimateWalkMinutes(getUserLocation(), station);
  return walkMinutes > AUTO_BIKE_OVER_WALK_MINUTES ? 'bike' : 'walk';
}

export function etaModeLabel(mode: string): string {
  if (mode === 'bike') return '🚴 Bike';
  if (mode === 'walk') return '🚶 Walk';
  return 'Auto';
}

// The accessible label on the header directions affordance. It doubles as the
// web glue's channel for the resolved travel mode (the glue builds the maps
// URL from it), so the wording must keep the literal words walking/biking.
export function directionsLabel(station: RouteStation, mode: string, _tick?: number): string {
  return effectiveEtaMode(station, mode) === 'bike' ? 'Get biking directions' : 'Get walking directions';
}

function normalizedRouteMode(mode: string): RouteMode {
  return mode === 'bike' ? 'bike' : 'walk';
}

function routeCacheKey(location: LatLng, station: RouteStation, mode: RouteMode): string {
  const stationKey = station.id ?? `${station.lat.toFixed(5)},${station.lng.toFixed(5)}`;
  return `${mode}:${location.lat.toFixed(4)},${location.lng.toFixed(4)}:${stationKey}`;
}

function fallbackRouteEstimate(station: RouteStation, mode: RouteMode, location: LatLng): RouteEstimateResult {
  const miles = estimateDistanceMiles(location, station);
  const minutes = mode === 'bike' ? estimateBikeMinutes(location, station) : estimateWalkMinutes(location, station);
  return { mode, minutes, distanceMiles: miles, source: 'haversine' };
}

function cachedRouteEstimate(station: RouteStation, modeInput: string, location: LatLng): RouteEstimateResult {
  const mode = normalizedRouteMode(modeInput);
  const key = routeCacheKey(location, station, mode);
  const now = Date.now();
  const cached = routeCache.get(key);
  const maxAge = cached?.estimate.cacheTtlMs ?? ROUTE_CACHE_TTL_MS;
  if (cached && now - cached.storedAt < maxAge) return cached.estimate;

  if (routeEstimateInvoker && !routeInFlight.has(key)) {
    routeInFlight.add(key);
    routeEstimateInvoker({
      fromLat: location.lat,
      fromLng: location.lng,
      toLat: station.lat,
      toLng: station.lng,
      mode,
    }).then((estimate) => {
      if (estimate && typeof estimate === 'object') {
        routeCache.set(key, { estimate, storedAt: Date.now() });
      }
    }).catch(() => {
      // The server action already has a fallback path. If the transport itself
      // fails, keep rendering the deterministic local estimate.
    }).finally(() => {
      routeInFlight.delete(key);
    });
  }

  return fallbackRouteEstimate(station, mode, location);
}

export function walkBikeSummary(station: RouteStation, mode: string, _tick?: number): string {
  const location = getUserLocation();
  const effective = effectiveEtaMode(station, mode);
  const estimate = cachedRouteEstimate(station, effective, location);
  const minutes = Math.max(1, Math.round(Number(estimate.minutes) || 1));
  const miles = Number(estimate.distanceMiles) || 0;
  const label = effective === 'bike' ? 'bike' : 'walk';
  // A routed ETA (openrouteservice) shows plain; the straight-line haversine
  // fallback is marked approximate so estimated numbers never pose as routed.
  const approx = estimate.source === 'openrouteservice' ? '' : '~';
  return `${approx}${minutes} min ${label} · ${miles.toFixed(miles < 10 ? 1 : 0)} mi`;
}

// The header directions line: mode glyph + summary + an explicit directions
// symbol, one tap/press affordance (ENG-23795).
export function walkBikeLine(station: RouteStation, mode: string, _tick?: number): string {
  const glyph = effectiveEtaMode(station, mode) === 'bike' ? '🚴' : '🚶';
  return `${glyph} ${walkBikeSummary(station, mode)} ⬈`;
}

// Compact ETA for the stations-list rows: the mode's minutes plus distance
// (the full summary is too wide there).
export function distanceLabel(station: RouteStation, mode: string, _tick?: number): string {
  const location = getUserLocation();
  const estimate = fallbackRouteEstimate(station, effectiveEtaMode(station, mode), location);
  const minutes = Math.max(1, Math.round(Number(estimate.minutes) || 1));
  const miles = Number(estimate.distanceMiles) || 0;
  return `${minutes} min · ${miles.toFixed(miles < 10 ? 1 : 0)} mi`;
}

// --- Freshness marker (feedState rows from the live query binding) ------------

export function feedFreshness(nowMs: number, feedRows: Array<{ fetchedAt?: number }>): string {
  const feed = feedRows?.[0] ?? null;
  // Board-first startup (ENG-23727): before the backend has attached, the
  // board shows deterministic schedule times — say so, instead of implying a
  // feed is on its way that may never arrive.
  if (!feed || !feed.fetchedAt) return backendState === 'connected' ? 'Waiting for feed…' : 'Scheduled times';
  const ageSeconds = Math.max(0, Math.floor((nowMs - feed.fetchedAt) / 1000));
  if (ageSeconds < 60) return 'Updated a few seconds ago';
  return `Updated ${Math.max(1, Math.floor(ageSeconds / 60))}m ago`;
}

// --- Data-source badge (live 511 feed vs the recorded demo feed) ---------------
//
// feedRefreshState.lastSource records where the last committed refresh came
// from (handlers.mjs): '511-siri-stop-monitoring' only when a real 511 fetch
// landed; 'seed' / 'recorded' / 'recorded-fallback' / 'reset' all mean the
// board is showing the canned demo feed. The badge makes that distinction
// visible on the board instead of leaving demo data to pose as live data.

// Why the board is NOT on live 511 data, when there is a recorded reason.
// refreshFeed commits an actionable lastError on every fallback (ENG-22751);
// an intentional demo run (seed/recorded, no error) stays quiet.
export function feedProblem(feedRows: Array<{ lastSource?: string; lastError?: string }>): string {
  const feed = feedRows?.[0] ?? null;
  if (!feed || (feed.lastSource ?? '') === LIVE_FEED_SOURCE) return '';
  const error = (feed.lastError ?? '').trim();
  if (!error) return '';
  return error.length > 180 ? `${error.slice(0, 177)}…` : error;
}

// Fallback freshness window when the committed row predates the field; matches
// seed.gen.mjs (two 180s warm-poll cycles + 30s grace, ENG-23642).
const DEFAULT_STALE_AFTER_MS = 390_000;

// LIVE only when the last committed refresh was a real 511 snapshot AND it is
// younger than the freshness window. A live source whose rows have aged out is
// STALE (marked non-live), never LIVE — an advancing feed marker can no longer
// dress old rows up as live data (ENG-23642). The rows themselves stay on
// screen (they are real observed departures, self-expiring per departure via
// DEPARTED_GRACE_MS) rather than being swapped for synthetic demo trains.
// `dot` is the sticky-footer status dot (ENG-23795): green only when live,
// gray otherwise — the LIVE text is gone, but the non-live labels stay
// rendered next to the dot so demo/schedule data never poses as live
// (the ENG-23642 honesty requirement).
export function feedSourceBadge(
  feedRows: Array<{ lastSource?: string; fetchedAt?: number; staleAfterMs?: number }>,
  nowMs?: number,
): {
  live: boolean;
  label: string;
  color: string;
  tint: string;
  border: string;
  dot: string;
} {
  const feed = feedRows?.[0] ?? null;
  const dark = isDark();
  const grayDot = dark ? '#6B7280' : '#9CA3AF';
  // No feed row yet (board-first startup, before the live bindings deliver):
  // the board is on the deterministic schedule — its own honest category,
  // neither a committed demo feed nor live 511 (ENG-23727).
  if (!feed) {
    const blue = dark ? '#60A5FA' : '#1D4ED8';
    return { live: false, label: 'SCHEDULE', color: blue, tint: `${blue}12`, border: `${blue}36`, dot: grayDot };
  }
  const liveSource = (feed?.lastSource ?? '') === LIVE_FEED_SOURCE;
  // Badge colors sit on the board surface: the deep light-scheme hues
  // (ENG-23719) disappear on the dark board, so dark lifts each hue.
  if (!liveSource) {
    const amber = dark ? '#FBBF24' : '#92400E';
    return { live: false, label: 'DEMO DATA', color: amber, tint: '#B4530914', border: '#B4530936', dot: grayDot };
  }
  const fetchedAt = Number(feed?.fetchedAt) || 0;
  const staleAfterMs = Number(feed?.staleAfterMs) > 0 ? Number(feed?.staleAfterMs) : DEFAULT_STALE_AFTER_MS;
  const fresh = typeof nowMs !== 'number' || fetchedAt <= 0 || nowMs - fetchedAt <= staleAfterMs;
  if (fresh) {
    const green = dark ? '#34D399' : '#047857';
    return { live: true, label: 'LIVE', color: green, tint: `${green}12`, border: `${green}36`, dot: '#059669' };
  }
  const red = dark ? '#F87171' : '#B91C1C';
  return { live: false, label: 'STALE', color: red, tint: `${red}12`, border: `${red}36`, dot: grayDot };
}

// --- Position indicator (for the train detail continuum) ----------------------

export function positionFraction(trip: { position?: { corridorFraction: number } | null }): number {
  return trip && trip.position ? trip.position.corridorFraction : 0;
}

export function positionLabel(trip: {
  position?: { state: string; prevStationId: string | null; nextStationId: string | null } | null;
}): string {
  const position = trip?.position;
  if (!position) return '';
  const prev = position.prevStationId ? getStationById(position.prevStationId)?.name : null;
  const next = position.nextStationId ? getStationById(position.nextStationId)?.name : null;
  if (position.state === 'before') return `Departs ${next ?? ''}`;
  if (position.state === 'after') return `Arrived ${prev ?? ''}`;
  return `Between ${prev ?? ''} and ${next ?? ''}`;
}

// --- Percent string for the position bar width --------------------------------

export function fractionPercent(fraction: number): string {
  return `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%`;
}

export { getNearestStation };
