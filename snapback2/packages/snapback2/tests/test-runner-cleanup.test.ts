import assert from "node:assert/strict";
import test from "node:test";
import { cleanupJourney, journeyFailureMessage } from "../src/test-cleanup.ts";

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("journey cleanup awaits every client close before removing the store root", async () => {
  const delayed = deferred();
  const order: string[] = [];
  const cleanup = cleanupJourney({
    clients: [
      {
        async close() {
          order.push("delayed-close-start");
          await delayed.promise;
          order.push("delayed-close-end");
        },
      },
      {
        close() {
          order.push("other-close");
          throw new Error("other close failed");
        },
      },
    ],
    epochClosed: Promise.resolve(),
    providers: [],
    async removeStoreRoot() {
      order.push("remove-root");
    },
  });

  await Promise.resolve();
  assert.deepEqual(order, ["delayed-close-start", "other-close"]);
  delayed.resolve();
  const errors = await cleanup;
  assert.deepEqual(order, [
    "delayed-close-start",
    "other-close",
    "delayed-close-end",
    "remove-root",
  ]);
  assert.deepEqual(errors.map((error) => (error as Error).message), ["other close failed"]);
});

test("journey cleanup reporting preserves primary and cleanup failures", () => {
  assert.equal(
    journeyFailureMessage(new Error("check failed"), [new Error("close failed")]),
    "check failed; cleanup failed: close failed",
  );
  assert.equal(
    journeyFailureMessage(undefined, [new Error("close failed")]),
    "cleanup failed: close failed",
  );
});
