import { after } from "node:test";
import { configureRealOwner } from "./owner-harness.ts";

const owner = await configureRealOwner();
await import("./client.test.ts");
await import("./assets.test.ts");
await import("./auth-ownership.test.ts");
await import("./typing.test.ts");
await import("./real-owner.test.ts");
await import("./native-assets.test.ts");
await import("./offline-protocol.test.ts");
await import("./offline-store.test.ts");
await import("./offline-bytes.test.ts");
await import("./offline-view-once.test.ts");
await import("./offline-resume-tail.test.ts");

after(async () => owner.close());
