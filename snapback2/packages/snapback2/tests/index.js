import { after } from "node:test";
import { configureRealOwner } from "./owner-harness.ts";

const owner = await configureRealOwner();
await import("./client.test.ts");
await import("./typing.test.ts");
await import("./real-owner.test.ts");

after(async () => owner.close());
