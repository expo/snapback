// @ref LLP 0138#the-six-application-contracts — deterministic A6 scale facts
// remain shared while each arm keeps a provider-native backend implementation.
const REGIONS = ['iad', 'sfo', 'fra', 'sin', 'syd'];
const STATUSES = ['healthy', 'degraded', 'offline'];
const SEVERITIES = ['critical', 'warning', 'info', 'info', 'info', 'info', 'info', 'info', 'info', 'info'];

export function generateFleetDimensions({deviceCount = 25_000} = {}) {
  const fleets = Array.from({length: 5}, (_, index) => ({fleetKey: `fleet-${index}`, name: `Fleet ${index}`}));
  const memberships = [
    {membershipKey: 'fleet-0:alice', fleetKey: 'fleet-0', userKey: 'alice'},
    ...fleets.map((fleet) => ({membershipKey: `${fleet.fleetKey}:bob`, fleetKey: fleet.fleetKey, userKey: 'bob'})),
  ];
  const owners = Array.from({length: 500}, (_, index) => ({ownerKey: `owner-${String(index).padStart(3, '0')}`, name: `Owner ${index}`}));
  const devices = Array.from({length: deviceCount}, (_, index) => ({
    deviceKey: `device-${String(index).padStart(5, '0')}`,
    fleetKey: `fleet-${Math.floor(index / 5_000)}`,
    ownerKey: `owner-${String(index % owners.length).padStart(3, '0')}`,
    name: `Device ${String(index).padStart(5, '0')}`,
    region: REGIONS[index % REGIONS.length],
    status: STATUSES[index % STATUSES.length],
    updatedAt: 1_710_000_000_000 + index,
  }));
  return {fleets, memberships, owners, devices};
}

export function generateEventBatch(start, count, {eventCount = 250_000} = {}) {
  const end = Math.min(eventCount, start + count);
  return Array.from({length: Math.max(0, end - start)}, (_, offset) => {
    const index = start + offset;
    const deviceIndex = Math.floor(index / 10);
    return {
      eventKey: `event-${String(index).padStart(6, '0')}`,
      deviceKey: `device-${String(deviceIndex).padStart(5, '0')}`,
      fleetKey: `fleet-${Math.floor(deviceIndex / 5_000)}`,
      ownerKey: `owner-${String(deviceIndex % 500).padStart(3, '0')}`,
      deviceStatus: STATUSES[deviceIndex % STATUSES.length],
      region: REGIONS[deviceIndex % REGIONS.length],
      severity: SEVERITIES[index % SEVERITIES.length],
      message: `Telemetry event ${String(index).padStart(6, '0')}`,
      pageKey: String(index).padStart(9, '0'),
      occurredAt: 1_720_000_000_000 + index,
    };
  });
}

export function* eventBatches({eventCount = 250_000, batchSize = 900} = {}) {
  for (let start = 0; start < eventCount; start += batchSize) {
    yield generateEventBatch(start, batchSize, {eventCount});
  }
}

export function telemetryBurst() {
  const active = Array.from({length: 100}, (_, offset) => 49_990 - offset * 10);
  const nonmatching = Array.from({length: 900}, (_, offset) => 100_000 + offset);
  return active.concat(nonmatching).map((index) => ({
    eventKey: `event-${String(index).padStart(6, '0')}`,
    message: `Burst-updated ${String(index).padStart(6, '0')}`,
  }));
}

export function batches(rows, size = 900) {
  return Array.from({length: Math.ceil(rows.length / size)}, (_, index) => rows.slice(index * size, (index + 1) * size));
}
