import {readFile} from 'node:fs/promises';
import {basename, join, resolve} from 'node:path';

type Row = Record<string, unknown>;

const EFFECT_TRIGGERS = new Set([
  'issue.create',
  'issue.update',
  'issue.addLabel',
  'issue.removeLabel',
  'emoji.addToIssue',
  'emoji.addToComment',
  'comment.add',
  'comment.edit',
]);

function number(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function string(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function array<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

async function readJsonl(path: string): Promise<Row[]> {
  const contents = await readFile(path, 'utf8');
  return contents
    .split('\n')
    .filter(line => line.trim().length > 0)
    .map((line, index) => {
      try {
        return JSON.parse(line) as Row;
      } catch (error) {
        throw new Error(`${path}:${index + 1}: invalid JSONL: ${String(error)}`);
      }
    });
}

function percentile(values: number[], fraction: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor((sorted.length - 1) * fraction)];
}

function distribution(values: number[]): Row {
  return {
    count: values.length,
    min: percentile(values, 0),
    p50: percentile(values, 0.5),
    p90: percentile(values, 0.9),
    max: percentile(values, 1),
  };
}

function increment(target: Record<string, number>, key: unknown, by = 1): void {
  const normalized = string(key) ?? 'unknown';
  target[normalized] = (target[normalized] ?? 0) + by;
}

function nestedIncrement(
  matrix: Record<string, Record<string, Record<string, number>>>,
  mutation: string,
  observer: string,
  decision: string,
): void {
  matrix[mutation] ??= {};
  matrix[mutation][observer] ??= {};
  increment(matrix[mutation][observer], decision);
}

function mutationVersion(row: Row): number | null {
  return number(row.committedVersion) ?? number(row.commit_version);
}

function mutationIdentity(row: Row): string | null {
  return string(row.clientMutationId) ?? string(row.client_mutation_id);
}

function aggregateClientLedgers(summaries: Row[]): Row {
  const totals = {
    initialSnapshots: 0,
    updateCallbacksByKind: {} as Record<string, number>,
    authorizationBoundaryCallbacksByKind: {} as Record<string, number>,
    subscriptionEventsByEvent: {} as Record<string, number>,
    pollStarts: 0,
    pollSucceeded: 0,
    pollFailed: 0,
  };
  for (const summary of summaries) {
    const observers = summary.observers && typeof summary.observers === 'object'
      ? summary.observers as Row
      : {};
    for (const observer of Object.values(observers)) {
      const ledger = observer && typeof observer === 'object'
        ? (observer as Row).frameLedger as Row | undefined
        : undefined;
      if (!ledger) continue;
      totals.initialSnapshots += number(ledger.initialSnapshots) ?? 0;
      totals.pollStarts += number(ledger.pollStarts) ?? 0;
      totals.pollSucceeded += number(ledger.pollSucceeded) ?? 0;
      totals.pollFailed += number(ledger.pollFailed) ?? 0;
      for (const field of [
        'updateCallbacksByKind',
        'authorizationBoundaryCallbacksByKind',
        'subscriptionEventsByEvent',
      ] as const) {
        const counts = ledger[field] && typeof ledger[field] === 'object'
          ? ledger[field] as Record<string, unknown>
          : {};
        for (const [key, value] of Object.entries(counts)) {
          totals[field][key] = (totals[field][key] ?? 0) + (number(value) ?? 0);
        }
      }
    }
  }
  return totals;
}

async function analyzeArm(directoryArgument: string): Promise<Row> {
  const directory = resolve(directoryArgument);
  const [server, client] = await Promise.all([
    readJsonl(join(directory, 'server-trace.jsonl')),
    readJsonl(join(directory, 'client-trace.jsonl')),
  ]);
  const configuration = client.find(row => row.kind === 'configuration') ?? {};
  const connectionObservers = new Map<string, string>();
  for (const row of client) {
    const connection = string(row.connectionId);
    const observer = string(row.actor) ?? string(row.observer);
    if (connection && observer) connectionObservers.set(connection, observer);
  }

  const commitsByIdentity = new Map<string, Row>();
  const commitsByVersion = new Map<number, Row[]>();
  for (const row of server.filter(event => event.event === 'commit')) {
    const identity = mutationIdentity(row);
    const version = mutationVersion(row);
    if (identity) commitsByIdentity.set(identity, row);
    if (version !== null) {
      const commits = commitsByVersion.get(version) ?? [];
      commits.push(row);
      commitsByVersion.set(version, commits);
    }
  }

  const settleByIdentity = new Map<string, Map<string, Row>>();
  for (const row of server.filter(event => event.event === 'mutate_settle')) {
    const identity = mutationIdentity(row);
    const phase = string(row.phase);
    if (!identity || !phase) continue;
    const phases = settleByIdentity.get(identity) ?? new Map<string, Row>();
    phases.set(phase, row);
    settleByIdentity.set(identity, phases);
  }
  const convergenceByIdentity = new Map(
    client
      .filter(row => row.kind === 'mutation_convergence')
      .flatMap(row => {
        const identity = mutationIdentity(row);
        return identity ? [[identity, row] as const] : [];
      }),
  );

  const mutations: Row[] = [];
  for (const result of client.filter(row => row.kind === 'mutation_result')) {
    const identity = mutationIdentity(result);
    if (!identity) continue;
    const commit = commitsByIdentity.get(identity);
    const phases = settleByIdentity.get(identity);
    const convergence = convergenceByIdentity.get(identity);
    const commitMs = number(commit?.timestamp_ms);
    const resultReadyMs = number(phases?.get('handler_result_ready')?.timestamp_ms);
    const responseWrittenMs = number(phases?.get('http_response_written')?.timestamp_ms);
    mutations.push({
      name: result.name,
      effectClass: result.effectClass,
      clientMutationId: identity,
      outcome: result.outcome,
      committedVersion: mutationVersion(result) ?? mutationVersion(commit ?? {}),
      changedRowCount: number(commit?.changed_row_count),
      clientSettleLatencyMs: number(result.latencyMs),
      commitAckTimestampMs: commitMs,
      durableToHandlerResultMs: commitMs !== null && resultReadyMs !== null
        ? resultReadyMs - commitMs
        : null,
      durableToHttpResponseMs: commitMs !== null && responseWrittenMs !== null
        ? responseWrittenMs - commitMs
        : null,
      firstObserverConvergenceMs: number(convergence?.firstObserverLatencyMs),
      lastObserverConvergenceMs: number(convergence?.lastObserverLatencyMs),
      fullyConverged: convergence?.fullyConverged ?? null,
    });
  }

  const settlementByEffect: Row = {};
  for (const effectClass of ['trigger', 'non-trigger']) {
    const rows = mutations.filter(row => row.effectClass === effectClass && row.outcome === 'applied');
    settlementByEffect[effectClass] = {
      mutations: rows.length,
      clientSettleLatencyMs: distribution(rows.flatMap(row => {
        const value = number(row.clientSettleLatencyMs);
        return value === null ? [] : [value];
      })),
      durableToHandlerResultMs: distribution(rows.flatMap(row => {
        const value = number(row.durableToHandlerResultMs);
        return value === null ? [] : [value];
      })),
      durableToHttpResponseMs: distribution(rows.flatMap(row => {
        const value = number(row.durableToHttpResponseMs);
        return value === null ? [] : [value];
      })),
      firstObserverConvergenceMs: distribution(rows.flatMap(row => {
        const value = number(row.firstObserverConvergenceMs);
        return value === null ? [] : [value];
      })),
      lastObserverConvergenceMs: distribution(rows.flatMap(row => {
        const value = number(row.lastObserverConvergenceMs);
        return value === null ? [] : [value];
      })),
    };
  }

  const evaluations = server.filter(row => row.event === 'eval');
  const evalsPerObserver: Record<string, number> = {};
  const framesByWireKind: Record<string, number> = {};
  const bytesByWireKind: Record<string, number> = {};
  for (const evaluation of evaluations) {
    const connection = string(evaluation.connection_id) ?? 'unknown';
    const observer = connectionObservers.get(connection) ?? connection;
    increment(evalsPerObserver, observer);
    const kind = string(evaluation.frame_kind) ?? 'none';
    increment(framesByWireKind, kind);
    bytesByWireKind[kind] = (bytesByWireKind[kind] ?? 0)
      + (number(evaluation.delivered_frame_bytes) ?? 0);
  }
  const evaluationSummary = {
    total: evaluations.length,
    finished: evaluations.filter(row => row.outcome === 'finish').length,
    canceled: evaluations.filter(row => row.outcome === 'cancel').length,
    perObserver: evalsPerObserver,
    durationMs: distribution(evaluations.flatMap(row => {
      const value = number(row.duration_ms);
      return value === null ? [] : [value];
    })),
    deliveredFrameBytes: distribution(evaluations.flatMap(row => {
      const value = number(row.delivered_frame_bytes);
      return value === null ? [] : [value];
    })),
    framesByWireKind,
    bytesByWireKind,
  };

  const mutationByVersion = new Map<number, Row>();
  for (const mutation of mutations) {
    const version = number(mutation.committedVersion);
    if (version !== null) mutationByVersion.set(version, mutation);
  }
  const matcherMatrix: Record<string, Record<string, Record<string, number>>> = {};
  const matcherDisagreements: Row[] = [];
  for (const decision of server.filter(row => row.event === 'matcher_decision')) {
    const versions = array<number>(decision.commit_versions).filter(version => number(version) !== null);
    const observer = connectionObservers.get(string(decision.connection_id) ?? '')
      ?? string(decision.connection_id)
      ?? string(decision.subscription_id)
      ?? 'unknown';
    const outcome = string(decision.decision) ?? 'unknown';
    for (const version of versions) {
      const mutation = mutationByVersion.get(version);
      const name = string(mutation?.name)
        ?? string(commitsByVersion.get(version)?.[0]?.mutation)
        ?? `version-${version}`;
      nestedIncrement(matcherMatrix, name, observer, outcome);
      const expectedRelevant = EFFECT_TRIGGERS.has(name);
      const actualRelevant = outcome !== 'skip';
      if (expectedRelevant !== actualRelevant) {
        matcherDisagreements.push({
          mutation: name,
          observer,
          version,
          expected: expectedRelevant ? 'match' : 'skip',
          actual: outcome,
          coalescedFrame: versions.length > 1,
          frameVersions: versions,
        });
      }
    }
  }

  const coalesceEvents = server.filter(row => row.event === 'coalesce');
  const flushes = coalesceEvents.filter(row => row.action === 'flush');
  const flushesByPath: Record<string, number> = {};
  for (const flush of flushes) increment(flushesByPath, flush.flush_path);
  const coalescer = {
    deferredCommits: coalesceEvents.filter(row => row.action === 'defer').length,
    flushes: flushes.length,
    flushesByPath,
    mergedFrames: distribution(flushes.flatMap(row => {
      const value = number(row.merged_frame_count);
      return value === null ? [] : [value];
    })),
    changedRowsPerFlush: distribution(flushes.flatMap(row => {
      const value = number(row.changed_row_count);
      return value === null ? [] : [value];
    })),
  };

  // LLP 0200 Phase-2 authority-lane decomposition. Fence "applied" events
  // carry the cumulative marking latency for their transition (§2.4's fence
  // bound covers the whole marking step); "restored" marks the subscription's
  // post-transition re-resolution delivery. Restoration latency is measured
  // per (transition epoch, subscription) as restored-time minus that epoch's
  // first applied-time for the subscription. The Phase-1 stage-3 landing note
  // is honored: fence p95 comes from trace events, not the coarse counter.
  const fenceEvents = server.filter(row => row.event === 'fence');
  const fenceAppliedLatencies: number[] = [];
  const appliedAt = new Map<string, number>();
  const restorationLatencies: number[] = [];
  const staleDiscards = fenceEvents.filter(row => row.action === 'stale_discard').length;
  for (const event of fenceEvents) {
    const action = string(event.action);
    const subscription = string(event.subscription_id) ?? 'unknown';
    const epoch = number(event.authorization_epoch);
    const timestamp = number(event.timestamp_ms);
    const key = `${subscription}#${epoch}`;
    if (action === 'applied') {
      const latency = number(event.latency_ms);
      if (latency !== null) fenceAppliedLatencies.push(latency);
      if (timestamp !== null && !appliedAt.has(key)) appliedAt.set(key, timestamp);
    } else if (action === 'restored' && timestamp !== null) {
      const started = appliedAt.get(key);
      if (started !== undefined) {
        restorationLatencies.push(timestamp - started);
        appliedAt.delete(key);
      }
    }
  }
  const clientAuthorityTransitions = client.filter(
    row => row.kind === 'authority_transition',
  );
  const authorityLane = {
    fenceAppliedEvents: fenceEvents.filter(row => row.action === 'applied').length,
    fenceAppliedLatencyMs: {
      ...distribution(fenceAppliedLatencies),
      p95: percentile(fenceAppliedLatencies, 0.95),
    },
    restorationsObserved: restorationLatencies.length,
    restorationLatencyMs: {
      ...distribution(restorationLatencies),
      p95: percentile(restorationLatencies, 0.95),
    },
    unrestoredFences: appliedAt.size,
    staleAuthorityFrameDiscards: staleDiscards,
    clientAuthorityTransitions: clientAuthorityTransitions.length,
  };

  const clientLedger = aggregateClientLedgers(
    client.filter(row => row.kind === 'summary'),
  );
  const clientCallbackKinds: Record<string, number> = {
    snapshot: number(clientLedger.initialSnapshots) ?? 0,
  };
  for (const [kind, count] of Object.entries(
    clientLedger.updateCallbacksByKind as Record<string, number>,
  )) increment(clientCallbackKinds, kind, count);
  const frameKindDelta: Record<string, number> = {};
  for (const kind of new Set([
    ...Object.keys(framesByWireKind),
    ...Object.keys(clientCallbackKinds),
  ])) {
    frameKindDelta[kind] = (framesByWireKind[kind] ?? 0) - (clientCallbackKinds[kind] ?? 0);
  }

  // Unit reconciliation for LLP 0191's 521-vs-12 discrepancy:
  // `tests/acceptance/gates/zb5-hot.mjs` increments `counter.deliveries` only
  // in liveQuery's `onUpdate` callback (lines 428-433). It opens a fresh set of
  // six observers for every cycle. The diagnostic's 12 is also an `onUpdate`
  // callback count, but for one persistent observer set after the
  // supersession fix. Neither number is "server evaluations": an
  // authorization_invalidation can produce one update callback plus a
  // separately counted authorization-boundary callback, while initial
  // snapshots and explicit polls are separate ledger units. Keeping all four
  // categories below makes the lifecycle and callback-unit difference
  // explicit instead of treating 521/12 as competing measurements.
  const frameLedgerReconciliation = {
    serverEvalFramesByWireKind: framesByWireKind,
    clientOnUpdateAndInitialByKind: clientCallbackKinds,
    serverMinusClientByKind: frameKindDelta,
    clientLedger,
    custodyUnit: 'one liveQuery onUpdate callback; initial snapshots, authorization-boundary callbacks, subscription events, and polls excluded',
    diagnosticUnit: 'same onUpdate callback unit, with one persistent observer set; the expanded ledger reports excluded categories separately',
  };

  return {
    arm: basename(directory),
    directory,
    configuration,
    mutations,
    settlementByEffect,
    evaluations: evaluationSummary,
    matcher: {
      matrix: matcherMatrix,
      expectedTriggerNames: [...EFFECT_TRIGGERS],
      disagreements: matcherDisagreements,
      disagreementCount: matcherDisagreements.length,
    },
    coalescer,
    authorityLane,
    frameLedgerReconciliation,
  };
}

function cell(value: unknown): string {
  return value === null || value === undefined ? '—' : String(value);
}

function markdown(arms: Row[]): string {
  const lines = [
    '## OQ4 arm comparison',
    '',
    '| arm | coalesce | arrival | observers | partition | trigger settle p50 ms | non-trigger settle p50 ms | evals | frame bytes | matcher disagreements | deferred | flushes |',
    '|---|---:|---|---:|---|---:|---:|---:|---:|---:|---:|---:|',
  ];
  for (const arm of arms) {
    const configuration = arm.configuration as Row;
    const settlements = arm.settlementByEffect as Row;
    const trigger = settlements.trigger as Row;
    const nonTrigger = settlements['non-trigger'] as Row;
    const evaluations = arm.evaluations as Row;
    const bytes = evaluations.deliveredFrameBytes as Row;
    const matcher = arm.matcher as Row;
    const coalescer = arm.coalescer as Row;
    lines.push([
      `| ${cell(arm.arm)}`,
      cell(configuration.coalescing),
      cell(configuration.arrivalMode),
      cell(configuration.observerCount),
      cell(configuration.observerPartition),
      cell((trigger.clientSettleLatencyMs as Row).p50),
      cell((nonTrigger.clientSettleLatencyMs as Row).p50),
      cell(evaluations.total),
      cell(bytes.max === null ? null : Object.values(evaluations.bytesByWireKind as Row)
        .reduce<number>((sum, value) => sum + (number(value) ?? 0), 0)),
      cell(matcher.disagreementCount),
      cell(coalescer.deferredCommits),
      `${cell(coalescer.flushes)} |`,
    ].join(' | '));
  }
  return lines.join('\n');
}

async function main(): Promise<void> {
  const directories = process.argv.slice(2);
  if (directories.length === 0 || directories.includes('--help')) {
    process.stdout.write('Usage: bun scripts/analyze-oq4.mts <arm-dir> [arm-dir ...]\n');
    return;
  }
  const arms = await Promise.all(directories.map(analyzeArm));
  const summary = {
    schemaVersion: 'snapback.oq4-analysis.v1',
    generatedAt: new Date().toISOString(),
    arms,
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n\n${markdown(arms)}\n`);
}

await main();
