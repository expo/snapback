/// <reference types="bun-types" />
// @ref LLP 0052#acceptance-gates — All Aboard's app-specific D1/D2/D4 migration gates.

import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import * as data from '../../surfaces/contract/data.ts';

const repoRoot = resolve(import.meta.dir, '..', '..', '..', '..');
const appPath = resolve(repoRoot, 'demos/all-aboard/surfaces/contract/app.contract');
const exactPin = JSON.parse(readFileSync(
  resolve(repoRoot, 'demos/all-aboard/exact-source.json'),
  'utf8',
)) as { commit: string; repository: string };
const exactSourceRoot = process.env.EXACT_ALL_ABOARD_SOURCE_ROOT;
if (!exactSourceRoot) {
  throw new Error(
    'EXACT_ALL_ABOARD_SOURCE_ROOT must point at the Exact checkout pinned by demos/all-aboard/exact-source.json',
  );
}
const exactRoot = resolve(exactSourceRoot);

const pinCheck = spawnSync(
  'git',
  ['-C', exactRoot, 'merge-base', '--is-ancestor', exactPin.commit, 'HEAD'],
  { encoding: 'utf8' },
);
if (pinCheck.status !== 0) {
  throw new Error(
    `Exact source ${exactRoot} must contain pinned revision ${exactPin.commit} (${exactPin.repository})`,
  );
}

async function exactModule(relativePath: string): Promise<Record<string, unknown>> {
  return import(pathToFileURL(resolve(exactRoot, relativePath)).href);
}

describe('All Aboard update-economy migration', () => {
  it('compiles the composed host + temporal + memo surface', async () => {
    const compiler = await exactModule('packages/exact-contract/src/compiler/index.ts') as {
      parseContractSource(source: string, path: string): unknown;
      compileContractSource(source: string, path: string, options: Record<string, unknown>): {
        file: {
          runtimeExtensions?: string[];
          components: Array<{
            hosts?: Array<{ name: string }>;
            derives: Array<{ name: string; memo?: { kind: string; key?: string } }>;
          }>;
        };
        diagnostics: Array<{ code: string; severity: string; message: string }>;
      };
    };
    const descriptors = await exactModule(
      'packages/exact-contract/src/compiler/import-descriptors.ts',
    ) as {
      resolveStaticContractImportSemantics(file: unknown): {
        descriptors: unknown;
        inferenceSources: unknown;
        diagnostics: Array<{ code: string; severity: string; message: string }>;
      };
    };
    const vite = await exactModule('packages/exact-contract/src/vite-plugin.ts') as {
      compileContractModule(source: string, path: string): { code: string };
    };
    const source = readFileSync(appPath, 'utf8');
    const preparsedFile = compiler.parseContractSource(source, appPath);
    const staticSemantics = descriptors.resolveStaticContractImportSemantics(preparsedFile);
    const compiled = compiler.compileContractSource(source, appPath, {
      importSemantics: staticSemantics.descriptors,
      importInferenceSources: staticSemantics.inferenceSources,
      preparsedFile,
    });
    const file = compiled.file;
    const diagnostics = [...staticSemantics.diagnostics, ...compiled.diagnostics];
    const root = file.components[0];

    expect(
      diagnostics.filter((diagnostic) => diagnostic.code === 'declared_pure_hidden_dependency'),
    ).toEqual([]);
    expect(
      diagnostics.filter((diagnostic) => diagnostic.severity === 'error' || diagnostic.severity === 'warning'),
    ).toEqual([]);

    expect(root.hosts?.map((host) => host.name)).toEqual([
      'scheme',
      'insets',
      'location',
      'backend',
    ]);
    expect(file.runtimeExtensions).toContain('temporal');
    expect(root.derives.find((derive) => derive.name === 'board')?.memo).toEqual({
      kind: 'rows',
      key: 'id',
    });
    expect(root.derives.find((derive) => derive.name === 'oppositeBoard')?.memo).toEqual({
      kind: 'rows',
      key: 'id',
    });

    const generated = vite.compileContractModule(source, appPath).code;
    expect(generated).toContain('@exact/contract/runtime/host-bindings');
    expect(generated).toContain('@exact/contract/runtime/temporal');
    expect(generated).toContain('@exact/contract/runtime/memo');
  });

  it('retains equal board identity and shares unchanged rows after one row changes', async () => {
    const memo = await exactModule('packages/exact-contract/src/runtime/memo.ts') as {
      createDeriveMemoStabilizer(policy: {
        kind: 'rows'; key: string; label: string;
      }): (value: unknown) => unknown;
    };
    const stabilize = memo.createDeriveMemoStabilizer({
      kind: 'rows',
      key: 'id',
      label: 'AllAboard.board',
    }) as (value: ReturnType<typeof data.boardTrains>) => ReturnType<typeof data.boardTrains>;
    const args = ['mountain-view', 'north', 1_783_802_532_412, 0, [], [], []] as const;
    const first = stabilize(data.boardTrains(...args));
    const equal = stabilize(data.boardTrains(...args));
    expect(equal).toBe(first);
    expect(equal.hero).toBe(first.hero);

    const fresh = data.boardTrains(...args);
    const changed = {
      ...fresh,
      rest: fresh.rest.map((row, index) => index === 0 ? { ...row, fade: 0.77 } : row),
    };
    const reconciled = stabilize(changed);
    expect(reconciled).not.toBe(equal);
    expect(reconciled.rest[0]).not.toBe(equal.rest[0]);
    expect(reconciled.rest[1]).toBe(equal.rest[1]);

    const runtime = await exactModule('packages/exact-contract/src/runtime/signals.ts') as {
      signal<T>(value: T): { get(): T; set(value: T): void; dispose(): void };
      computed<T>(read: () => T): { get(): T; dispose(): void };
      effect(run: () => void): { dispose(): void };
      reactiveChurn(): {
        computedRecomputes: number;
        effectRuns: number;
        skippedEffects: number;
      };
    };
    const inputs = runtime.signal({ delayRows: [], departureRows: [], feedRows: [] });
    const reactiveBoard = runtime.computed(() => {
      const rows = inputs.get();
      return stabilize(data.boardTrains(
        args[0], args[1], args[2], args[3],
        rows.delayRows, rows.departureRows, rows.feedRows,
      ));
    });
    let downstreamRuns = 0;
    const downstream = runtime.effect(() => {
      reactiveBoard.get();
      downstreamRuns += 1;
    });
    const beforeEqualInput = runtime.reactiveChurn();
    inputs.set({ delayRows: [], departureRows: [], feedRows: [] });
    await new Promise<void>((resolveFlush) => queueMicrotask(resolveFlush));
    const afterEqualInput = runtime.reactiveChurn();
    expect(downstreamRuns).toBe(1);
    expect(afterEqualInput.computedRecomputes - beforeEqualInput.computedRecomputes).toBe(1);
    expect(afterEqualInput.effectRuns - beforeEqualInput.effectRuns).toBe(0);
    expect(afterEqualInput.skippedEffects - beforeEqualInput.skippedEffects).toBe(1);
    downstream.dispose();
    reactiveBoard.dispose();
    inputs.dispose();
  });

  it('updates every migrated host reader from explicit scheme, location, and backend inputs', async () => {
    const unavailable = {
      status: 'unavailable' as const,
      coords: null,
      source: 'host',
    };
    const sanFranciscoLocation = {
      status: 'available' as const,
      coords: { latitude: 37.776, longitude: -122.394 },
      source: 'acceptance',
    };
    const mountainView = data.getSelectedStation('mountain-view', unavailable);
    const sanFrancisco = data.getSelectedStation('san-francisco', unavailable);

    expect(data.themePalette('dark')).not.toBe(data.themePalette('light'));
    expect(data.serviceTint('Local', 'dark')).not.toBe(data.serviceTint('Local', 'light'));
    expect(data.delayColor({ delaySeconds: 0 }, 'dark'))
      .not.toBe(data.delayColor({ delaySeconds: 0 }, 'light'));
    expect(data.locationIndicatorColor(unavailable, 'dark'))
      .not.toBe(data.locationIndicatorColor(unavailable, 'light'));
    expect(data.locationIndicatorColor(sanFranciscoLocation, 'dark'))
      .not.toBe(data.locationIndicatorColor(unavailable, 'dark'));
    expect(data.feedSourceBadge([{ lastSource: 'recorded' }], 1_000, 'dark').color)
      .not.toBe(data.feedSourceBadge([{ lastSource: 'recorded' }], 1_000, 'light').color);

    expect(data.getSelectedStation(null, unavailable).id).toBe('mountain-view');
    expect(data.getSelectedStation(null, sanFranciscoLocation).id).toBe('san-francisco');
    expect(data.searchStations('', unavailable)[0]?.id).toBe('mountain-view');
    expect(data.searchStations('', sanFranciscoLocation)[0]?.id).toBe('san-francisco');
    expect(data.locationHint(unavailable)).not.toBe(data.locationHint(sanFranciscoLocation));
    expect(data.directionsLabel(sanFrancisco, 'auto', unavailable)).toBe('Get biking directions');
    expect(data.directionsLabel(sanFrancisco, 'auto', sanFranciscoLocation)).toBe('Get walking directions');
    expect(data.distanceLabel(sanFrancisco, 'auto', unavailable))
      .not.toBe(data.distanceLabel(sanFrancisco, 'auto', sanFranciscoLocation));
    expect(data.walkBikeLine(sanFrancisco, 'auto', unavailable, null))
      .not.toBe(data.walkBikeLine(sanFrancisco, 'auto', sanFranciscoLocation, null));
    expect(data.walkBikeLine(mountainView, 'auto', unavailable, null)).toContain('walk');

    let transportCalls = 0;
    data.setRouteEstimateTransport(async () => {
      transportCalls += 1;
      return { mode: 'walk', minutes: 1, distanceMiles: 0.1, source: 'acceptance' };
    });
    try {
      const offline = await data.loadRouteEstimate(
        sanFrancisco,
        'walk',
        sanFranciscoLocation,
        { status: 'offline' },
        1_000,
      );
      expect(transportCalls).toBe(0);
      expect(offline.estimate.source).toBe('haversine');
      const connected = await data.loadRouteEstimate(
        sanFrancisco,
        'walk',
        sanFranciscoLocation,
        { status: 'connected' },
        2_000,
      );
      expect(transportCalls).toBe(1);
      expect(connected.estimate.source).toBe('acceptance');
    } finally {
      data.setRouteEstimateTransport(null);
    }
  });

  it('pins target-relative boundaries and deterministic route fallback', async () => {
    expect(data.countdownTemporal(100_000, 39_999)).toEqual({
      value: 2,
      nextChangeAt: 40_000,
    });
    expect(data.countdownTemporal(100_000, 40_000)).toEqual({
      value: 1,
      nextChangeAt: 100_000,
    });
    expect(data.feedStaleDeadline([
      { lastSource: '511-siri-stop-monitoring', fetchedAt: 1_000, staleAfterMs: 5_000 },
    ], 5_999)).toBe(6_001);
    expect(data.feedFreshnessTemporal([{ fetchedAt: 1_000 }], { status: 'connected' }, 61_000))
      .toEqual({ value: 'Updated 1m ago', nextChangeAt: 121_000 });
    expect(data.backendStatusNote({ status: 'connecting' })).toBe('Connecting for live updates…');
    expect(data.backendStatusNote({ status: 'offline' })).toBe('Offline — showing scheduled departures');
    expect(data.backendStatusNote({ status: 'connected' })).toBe('');
    expect(data.feedFreshnessTemporal([], { status: 'connected' }, 61_000))
      .toEqual({ value: 'Waiting for feed…', nextChangeAt: null });
    expect(data.feedFreshnessTemporal([], { status: 'offline' }, 61_000))
      .toEqual({ value: 'Scheduled times', nextChangeAt: null });
    const liveDeparture = {
      _id: 'expiry-row',
      stationId: 'mountain-view',
      direction: 'north',
      service: 'Local',
      scheduledDepartureMs: 10_000,
      predictedDepartureMs: 10_000,
    };
    expect(data.nextDepartureExpiry(
      'home',
      'mountain-view',
      [],
      'north',
      1_000,
      [],
      [liveDeparture],
      [{ lastSource: '511-siri-stop-monitoring' }],
    )).toBe(70_000);
    expect(data.nextDepartureExpiry(
      'home',
      'mountain-view',
      [],
      'north',
      70_000,
      [],
      [liveDeparture],
      [{ lastSource: '511-siri-stop-monitoring' }],
    )).toBeNull();

    data.setRouteEstimateTransport(null);
    const location = {
      status: 'available' as const,
      coords: { latitude: 37.3894, longitude: -122.0819 },
      source: 'device',
    };
    const route = await data.loadRouteEstimate(
      { id: 'palo-alto', lat: 37.443, lng: -122.165 },
      'walk',
      location,
      { status: 'connected' },
      50_000,
    );
    expect(route.estimate.source).toBe('haversine');
    expect(route.requestedAt).toBe(50_000);
    expect(data.routeEstimateRefreshDeadline(route.requestedAt)).toBe(350_000);
  });
});
