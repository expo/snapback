// @ref LLP 0138#the-six-application-contracts — retain the frozen A6 scale
// lineage while generating a fresh provider-native successor fixture.

const REGIONS = Object.freeze(['iad', 'sfo', 'fra', 'sin', 'syd']);
const STATUSES = Object.freeze(['healthy', 'degraded', 'offline']);
const ACTIVE_EVENT_MAX = 49_990;

export const FLEET_WORKLOAD = Object.freeze({
  devices: 25_000,
  events: 250_000,
  updateBurst: 1_000,
  activeMatches: 100,
  queryChanges: 20,
  pageSize: 100,
});

export function generateVehicleBatch(start, count, {
  deviceCount = FLEET_WORKLOAD.devices,
} = {}) {
  const end = Math.min(deviceCount, start + count);
  return Array.from({ length: Math.max(0, end - start) }, (_, offset) => {
    const index = start + offset;
    const ownerIndex = index % 500;
    return {
      deviceKey: `device-${String(index).padStart(5, '0')}`,
      fleetKey: `fleet-${Math.floor(index / 5_000)}`,
      ownerKey: `owner-${String(ownerIndex).padStart(3, '0')}`,
      ownerName: `Owner ${ownerIndex}`,
      deviceName: `Device ${String(index).padStart(5, '0')}`,
      region: REGIONS[index % REGIONS.length],
      status: STATUSES[index % STATUSES.length],
    };
  });
}

export function* vehicleBatches({ batchSize = 900 } = {}) {
  for (let start = 0; start < FLEET_WORKLOAD.devices; start += batchSize) {
    yield generateVehicleBatch(start, batchSize);
  }
}

export function generateEventBatch(start, count, {
  eventCount = FLEET_WORKLOAD.events,
} = {}) {
  const end = Math.min(eventCount, start + count);
  return Array.from({ length: Math.max(0, end - start) }, (_, offset) => {
    const index = start + offset;
    const deviceIndex = Math.floor(index / 10);
    const activeForOwner = deviceIndex < 5_000 && index % 10 === 0;
    return {
      eventKey: `event-${String(index).padStart(6, '0')}`,
      deviceKey: `device-${String(deviceIndex).padStart(5, '0')}`,
      fleetKey: `fleet-${Math.floor(deviceIndex / 5_000)}`,
      severity: index % 10 === 0 ? 'critical' : (index % 10 === 1 ? 'warning' : 'info'),
      message: `Telemetry event ${String(index).padStart(6, '0')}`,
      fixtureRank: index,
      queryRank: activeForOwner ? (ACTIVE_EVENT_MAX - index) / 10 : 1_000_000 + index,
      occurredAt: 1_720_000_000_000 + index,
      activeForOwner,
    };
  });
}

export function* eventBatches({ batchSize = 900 } = {}) {
  for (let start = 0; start < FLEET_WORKLOAD.events; start += batchSize) {
    yield generateEventBatch(start, batchSize);
  }
}

export function mainViewRollups() {
  return Array.from({ length: FLEET_WORKLOAD.activeMatches }, (_, rank) => {
    const eventIndex = ACTIVE_EVENT_MAX - rank * 10;
    const deviceIndex = Math.floor(eventIndex / 10);
    return {
      eventKey: `event-${String(eventIndex).padStart(6, '0')}`,
      deviceKey: `device-${String(deviceIndex).padStart(5, '0')}`,
      rank,
      ownerName: `Owner ${deviceIndex % 500}`,
      currentMessage: `Telemetry event ${String(eventIndex).padStart(6, '0')}`,
      activeMatch: false,
    };
  });
}

export function switchViewRollup(ordinal) {
  return {
    eventKey: `switch-${String(ordinal).padStart(2, '0')}`,
    deviceKey: `switch-device-${String(ordinal).padStart(2, '0')}`,
    rank: 0,
    ownerName: `Switch owner ${ordinal}`,
    currentMessage: `Switch result ${ordinal}`,
    activeMatch: false,
  };
}

export function telemetryBurst() {
  const active = Array.from({ length: FLEET_WORKLOAD.activeMatches }, (_, offset) => (
    ACTIVE_EVENT_MAX - offset * 10
  ));
  const nonmatching = Array.from({ length: 900 }, (_, offset) => 100_000 + offset);
  return active.concat(nonmatching).map((index, ordinal) => ({
    eventKey: `event-${String(index).padStart(6, '0')}`,
    message: `Burst-updated ${String(index).padStart(6, '0')}`,
    ...(ordinal < FLEET_WORKLOAD.activeMatches ? { activeRank: ordinal } : {}),
  }));
}

export function batches(rows, size = 100) {
  return Array.from(
    { length: Math.ceil(rows.length / size) },
    (_, index) => rows.slice(index * size, (index + 1) * size),
  );
}
