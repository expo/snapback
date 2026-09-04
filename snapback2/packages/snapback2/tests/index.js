import { after } from "node:test";
import { configureRealOwner } from "./owner-harness.ts";

const owner = await configureRealOwner();
await import("./client.test.ts");
await import("./assets.test.ts");
await import("./auth-ownership.test.ts");
await import("./typing.test.ts");
await import("./real-owner.test.ts");
await import("./native-assets.test.ts");
await import("./native-files.test.ts");
await import("./expo-witness.test.ts");
await import("./offline-protocol.test.ts");
await import("./offline-store.test.ts");
await import("./sqlite.test.ts");
await import("./expo.test.ts");
await import("./offline-bytes.test.ts");
await import("./offline-view-once.test.ts");
await import("./offline-resume-tail.test.ts");
await import("./outbox.test.ts");
await import("./outbox-custody.test.ts");
await import("./overlay-retirement.test.ts");
await import("./twin.test.ts");
await import("./supersession.test.ts");
await import("./readiness.test.ts");
await import("./chat-screens.test.ts");

after(async () => owner.close());
