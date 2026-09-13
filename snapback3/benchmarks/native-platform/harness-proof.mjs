import { createHash } from "node:crypto";

export const offlineBodies = [
  "Offline FIFO alpha survives OS process death",
  "Offline FIFO beta survives OS process death",
];

export const offlineArguments = offlineBodies.map((body, index) => ({ body,
  clientTag: index === 0 ? "offline-alpha" : "offline-beta", conversationId: "native-room" }));

export const acquisitionIdentityFields = ["id", "declarationHash", "principal", "authEpoch", "generation",
  "schemaHash", "rootKeys", "resourceKeys", "pages", "pending", "derivedDeclarations", "phase", "seq"];

export const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort()
    .map(key => [key, canonical(value[key])]));
  return value;
}

export function assertDeepEqual(actual, expected, label) {
  const actualJson = JSON.stringify(canonical(actual));
  const expectedJson = JSON.stringify(canonical(expected));
  assert(actualJson === expectedJson, `${label} changed: expected ${expectedJson}, found ${actualJson}`);
}

export function parseJsonColumn(value, label) {
  assert(typeof value === "string", `${label} is not a SQLite JSON text column`);
  try { return JSON.parse(value); }
  catch (error) { throw new Error(`${label} is invalid JSON: ${error instanceof Error ? error.message : error}`); }
}

export function queryData(envelope, label) {
  assert(envelope && typeof envelope === "object" && Array.isArray(envelope.data),
    `${label} did not return a query envelope with array data: ${JSON.stringify(envelope)}`);
  return envelope.data;
}

export function assertBodies(rows, expected, label) {
  assert(Array.isArray(rows), `${label} is not an array`);
  for (const body of expected) {
    const matches = rows.filter(row => row?.body === body);
    assert(matches.length === 1, `${label} expected exactly one row for ${JSON.stringify(body)}, found ${matches.length}`);
  }
}

export function assertOperations(actual, expectedIds, expectedBodies, expectedStatus, label) {
  assert(Array.isArray(actual) && actual.length === expectedIds.length,
    `${label} expected ${expectedIds.length} operations, found ${JSON.stringify(actual)}`);
  actual.forEach((operation, index) => {
    assert(operation?.id === expectedIds[index],
      `${label} operation ${index} identity changed: ${JSON.stringify(operation?.id)}`);
    assert(operation?.op === "messages.send", `${label} operation ${index} op changed: ${JSON.stringify(operation)}`);
    assertDeepEqual(operation?.args, { ...offlineArguments[index], body: expectedBodies[index] },
      `${label} operation ${index} complete args`);
    assert(operation?.status === expectedStatus,
      `${label} operation ${index} expected ${expectedStatus}, found ${JSON.stringify(operation?.status)}`);
    if (expectedStatus === "committed") validateReceipt(operation.receipt, {
      intent: expectedIds[index], op: operation.op, args: operation.args,
      planHash: operation.receipt?.program?.planHash, schemaHash: operation.receipt?.program?.schemaHash,
    }, `${label} operation ${index}`);
    else assert(operation?.receipt === null || operation?.receipt === undefined,
      `${label} queued operation ${index} already has a receipt`);
  });
}

export function assertOfflineProbes(probes, label) {
  assert(Array.isArray(probes) && probes.length === 2, `${label} did not report both content/auth probes`);
  assert(probes.map(probe => probe?.name).join("\n") === "content\nauth",
    `${label} probe order or identity changed: ${JSON.stringify(probes)}`);
  for (const probe of probes) {
    assert(probe.failed === true, `${label} ${probe.name} probe unexpectedly succeeded`);
    assert(probe.status === 503 || typeof probe.transportError === "string",
      `${label} ${probe.name} was not unavailable: ${JSON.stringify(probe)}`);
  }
}

export function decodedRows(rows, label) {
  assert(Array.isArray(rows), `${label} is not an array`);
  return rows.map((row, index) => ({ ...row, value: parseJsonColumn(row.value, `${label}[${index}].value`) }));
}

function validateRequest(request, expectedId, expectedArgs, authority, label) {
  assertDeepEqual(Object.keys(request).sort(), ["args", "intent", "op", "planHash", "schemaHash"],
    `${label} OperationRequest fields`);
  assert(request.intent === expectedId && request.op === "messages.send", `${label} identity/op changed`);
  assertDeepEqual(request.args, expectedArgs, `${label} complete args`);
  assert(request.schemaHash === authority.frame.schemaHash, `${label} schemaHash differs from persisted frame`);
  assert(request.planHash === authority.manifest.programs?.[request.op]?.planHash,
    `${label} planHash differs from persisted manifest`);
}

function validateReceipt(receipt, request, label) {
  assert(receipt?.intent === request.intent && receipt?.state === "committed"
    && Number.isSafeInteger(receipt?.seq), `${label} has an invalid committed receipt: ${JSON.stringify(receipt)}`);
  assert(receipt.program?.planHash === request.planHash && receipt.program?.schemaHash === request.schemaHash,
    `${label} receipt program identity differs from its immutable request`);
  assert(receipt.data?.clientTag === request.args.clientTag && Number.isSafeInteger(receipt.data?.ordinal)
    && typeof receipt.data?.id === "string", `${label} receipt data differs from request: ${JSON.stringify(receipt)}`);
}

function validateAcquisition(database, authority, label) {
  const acquisitions = decodedRows(database.acquisitions, `${label} acquisitions`);
  const matches = acquisitions.filter(row => row.key === "native-room-history" && row.value.id === row.key);
  assert(matches.length === 1, `${label} needs exactly one native-room-history checkpoint`);
  const acquisition = matches[0].value;
  for (const field of acquisitionIdentityFields) assert(Object.hasOwn(acquisition, field),
    `${label} acquisition omitted ${field}`);
  assert(acquisition.principal === authority.frame.principal && acquisition.authEpoch === authority.frame.authEpoch
    && acquisition.generation === authority.frame.generation && acquisition.schemaHash === authority.frame.schemaHash,
    `${label} acquisition authority differs from persisted frame`);
  assert(authority.manifest.generation === acquisition.generation
    && authority.manifest.schemaHash === acquisition.schemaHash, `${label} manifest/acquisition authority differs`);
  assert(Array.isArray(acquisition.rootKeys) && Array.isArray(acquisition.resourceKeys)
    && acquisition.rootKeys.length > 0 && new Set(acquisition.resourceKeys).size === acquisition.resourceKeys.length,
    `${label} acquisition resource identity is invalid`);

  const acquisitionResources = decodedRows(database.acquisitionResources, `${label} acquisition resources`);
  const acquisitionRows = new Map(decodedRows(database.acquisitionRows, `${label} acquisition rows`)
    .map(row => [row.key, row.value]));
  const resources = new Map(decodedRows(database.resources, `${label} resources`).map(row => [row.key, row.value]));
  const rows = new Map(decodedRows(database.rows, `${label} rows`).map(row => [row.key, row.value]));
  const linkedResources = [];
  const linkedRows = new Map();
  for (const key of acquisition.resourceKeys) {
    const links = acquisitionResources.filter(row => row.key === `${acquisition.id}:${key}`
      && row.value.acquisitionId === acquisition.id && row.value.chainKey === key && row.value.key === key);
    assert(links.length === 1, `${label} acquisition resource ${key} does not resolve exactly once`);
    const linked = links[0].value;
    assert(linked.envelope?.authority?.principal === acquisition.principal
      && linked.envelope?.authority?.authEpoch === acquisition.authEpoch
      && linked.envelope?.generation === acquisition.generation
      && linked.envelope?.schemaHash === acquisition.schemaHash,
    `${label} acquisition resource ${key} has stale authority/schema/generation`);
    const storedResource = resources.get(key);
    assert(storedResource, `${label} acquisition resource ${key} has no exact s3_resources record`);
    assertDeepEqual({ args: linked.args, key: linked.key, op: linked.op },
      { args: storedResource.args, key: storedResource.key, op: storedResource.op },
      `${label} acquisition resource ${key} live resource identity`);
    assert(storedResource.envelope?.authority?.principal === acquisition.principal
      && storedResource.envelope?.authority?.authEpoch === acquisition.authEpoch
      && storedResource.envelope?.generation === acquisition.generation
      && storedResource.envelope?.schemaHash === acquisition.schemaHash,
    `${label} live resource ${key} has stale authority/schema/generation`);
    assert(Array.isArray(linked.rowVersionKeys) && linked.rowVersionKeys.length > 0,
      `${label} acquisition resource ${key} has no rowVersionKeys`);
    for (const versionKey of linked.rowVersionKeys) {
      const version = acquisitionRows.get(versionKey);
      assert(version?.versionKey === versionKey, `${label} rowVersionKey ${versionKey} does not resolve exactly`);
      const rowKey = JSON.stringify([version.row?.table, version.row?.id]);
      assert(storedResource.rowKeys?.includes(rowKey), `${label} rowVersionKey ${versionKey} is detached from resource ${key}`);
      assertDeepEqual(version.row, rows.get(rowKey), `${label} rowVersionKey ${versionKey} exact stored row`);
      linkedRows.set(versionKey, version);
    }
    linkedResources.push(linked);
  }
  assert(acquisitionResources.filter(row => row.value.acquisitionId === acquisition.id).length === linkedResources.length,
    `${label} has detached resources for acquisition ${acquisition.id}`);
  assert(acquisitionRows.size === linkedRows.size, `${label} has detached acquisition row versions`);
  return { acquisition, linkedResources, linkedRows: [...linkedRows].sort(([left], [right]) => left.localeCompare(right)) };
}

export function assertClientDatabase(database, expectedIds, expectedBodies, expectedStatus, label,
  expectedAcquisitionStatuses = ["ready"], expectedRequests = null) {
  const state = new Map(decodedRows(database.state, `${label} state`).map(row => [row.key, row.value]));
  const authority = { frame: state.get("frame"), manifest: state.get("manifest") };
  assert(state.get("session")?.principal?.id === "dev:alice", `${label} did not persist the authenticated principal`);
  assert(authority.frame?.principal === "dev:alice" && authority.frame?.generation && authority.frame?.schemaHash,
    `${label} did not persist complete frame authority`);
  assertBodies(decodedRows(database.rows, `${label} rows`).map(row => row.value.row),
    ["Known durable row one", "Known durable row two"], `${label} durable cached rows`);
  const operations = decodedRows(database.operations, `${label} operations`);
  assert(operations.length === expectedIds.length, `${label} expected ${expectedIds.length} SQLite operations`);
  const requests = operations.map((row, index) => {
    const stored = row.value;
    assert(row.id === expectedIds[index] && stored.id === expectedIds[index], `${label} SQLite identity ${index} changed`);
    assert(index === 0 || Number(operations[index - 1].ordinal) < Number(row.ordinal), `${label} FIFO ordinal changed`);
    const request = parseJsonColumn(stored.body, `${label} stored request ${index}`);
    validateRequest(request, expectedIds[index], { ...offlineArguments[index], body: expectedBodies[index] },
      authority, `${label} request ${index}`);
    if (expectedRequests) assertDeepEqual(request, expectedRequests[index], `${label} immutable request ${index}`);
    assert(stored.principal === "dev:alice" && stored.status === expectedStatus,
      `${label} SQLite status/principal ${index} changed`);
    if (expectedStatus === "committed") validateReceipt(stored.receipt, request, `${label} SQLite operation ${index}`);
    else assert(stored.receipt === undefined, `${label} queued row ${index} already has a receipt`);
    return request;
  });
  const acquisitionProof = validateAcquisition(database, authority, label);
  assert(expectedAcquisitionStatuses.includes(acquisitionProof.acquisition.status),
    `${label} acquisition status changed: ${acquisitionProof.acquisition.status}`);
  if (acquisitionProof.acquisition.status === "acquiring") assert(acquisitionProof.acquisition.phase === "validate"
    && acquisitionProof.acquisition.pending.length === 0,
  `${label} restored acquisition is not a bounded offline validation checkpoint`);
  return { label, operations, requests, authority, ...acquisitionProof };
}

export function assertAcquisitionSequence(proofs) {
  assert(proofs.length >= 2, "acquisition comparison needs at least two ordered captures");
  const anchor = proofs[0];
  assert(anchor.acquisition.status === "ready", "queued acquisition was not ready before first process death");
  for (let index = 1; index < proofs.length; index++) {
    const proof = proofs[index];
    assert(proof.acquisition.status === "ready" || (proof.acquisition.status === "acquiring"
      && proof.acquisition.phase === "validate" && proof.acquisition.pending.length === 0),
    `${proof.label} is neither unchanged ready nor the sole allowed acquiring/validate restart state`);
    for (const field of acquisitionIdentityFields) assertDeepEqual(proof.acquisition[field], anchor.acquisition[field],
      `${proof.label} acquisition ${field}`);
    assertDeepEqual(proof.linkedResources, anchor.linkedResources, `${proof.label} exact linked acquisition resources`);
    assertDeepEqual(proof.linkedRows, anchor.linkedRows, `${proof.label} exact linked acquisition rows`);
  }
  return { fields: acquisitionIdentityFields, statuses: proofs.map(proof => proof.acquisition.status),
    resources: anchor.linkedResources.length, rows: anchor.linkedRows.length };
}

export function operationRequestDigest(request) {
  const rustRequest = { intent: request.intent, op: request.op, args: canonical(request.args),
    planHash: request.planHash, schemaHash: request.schemaHash,
    trace: request.trace ?? { points: [], verdicts: [] } };
  return createHash("sha256").update(JSON.stringify(rustRequest)).digest("hex");
}

export function assertRequestChain({ proofs, replayRequests, serverAudit, settledOperations, finalOperations }) {
  assert(proofs.length >= 4, "request chain needs queued, reopened, settled, and final databases");
  const expected = proofs[0].requests;
  proofs.slice(1).forEach(proof => assertDeepEqual(proof.requests, expected, `${proof.label} complete request set`));
  assertDeepEqual(replayRequests, expected, "actual replay POST complete request set");
  const terminals = expected.map((request, index) => {
    const matches = serverAudit.terminals.filter(row => row.intent === request.intent);
    assert(matches.length === 1, `server terminal ${request.intent} did not resolve exactly once by intent`);
    const terminal = matches[0];
    assert(terminal.principal === "dev:alice" && terminal.request_digest === operationRequestDigest(request),
      `server terminal ${request.intent} principal or exact Rust OperationRequest digest changed`);
    const settledReceipt = proofs.at(-2).operations[index].value.receipt;
    const finalReceipt = proofs.at(-1).operations[index].value.receipt;
    assertDeepEqual(finalReceipt, settledReceipt, `final receipt ${request.intent}`);
    assertDeepEqual(terminal.response, settledReceipt, `server/client receipt ${request.intent}`);
    assertDeepEqual(settledOperations[index].receipt, settledReceipt, `settled report receipt ${request.intent}`);
    assertDeepEqual(finalOperations[index].receipt, settledReceipt, `final report receipt ${request.intent}`);
    return terminal;
  });
  assert(terminals.every((terminal, index) => index === 0 || Number(terminals[index - 1].seq) < Number(terminal.seq)),
    `server terminal FIFO sequence changed: ${JSON.stringify(terminals)}`);
  assertBodies(serverAudit.messages, offlineBodies, "final authoritative server rows");
  return terminals;
}

export function assertProcessSequence(processes) {
  assert(processes.length === 3 && new Set(processes.map(record => record.pid)).size === 3
    && processes.every(record => record.startedAt && record.endedAt),
  `the two restart assertions did not cross three distinct terminated OS processes: ${JSON.stringify(processes)}`);
  for (let index = 1; index < processes.length; index++) assert(
    Date.parse(processes[index - 1].endedAt) <= Date.parse(processes[index].startedAt),
    `Expo process ${index} launched before the prior process ended: ${JSON.stringify(processes)}`);
}
