const runtimeProjectId = (
  globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> };
  }
).process?.env?.PARTY_PROJECT_ID;
export const PROJECT_ID = runtimeProjectId ?? "llp0102-partiful-firebase-w1";
export const PRIMARY_EVENT = "event-01";
export const GUEST_EVENT = "event-02";
export const CONTENDED_EVENT = "event-capacity";
export const REGION = "us-west1";
export const EMULATORS = {
  auth: { host: "127.0.0.1", port: 9331 },
  firestore: { host: "127.0.0.1", port: 8331 },
  functions: { host: "127.0.0.1", port: 5331 },
  storage: { host: "127.0.0.1", port: 9431 },
  ui: { host: "127.0.0.1", port: 4331 },
  fakeProvider: { host: "127.0.0.1", port: 4332 },
  hub: { host: "127.0.0.1", port: 4531 },
  logging: { host: "127.0.0.1", port: 4532 },
  eventarc: { host: "127.0.0.1", port: 4533 },
  tasks: { host: "127.0.0.1", port: 4534 },
  firestoreWebsocket: { host: "127.0.0.1", port: 4535 },
  pubsub: { host: "127.0.0.1", port: 4536 }
} as const;
export const ARM_START_MONOTONIC_MS = 258_039_414;
