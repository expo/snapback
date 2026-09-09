import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

// Exercise the private helper without asking raw Node to resolve the source
// tree's emitted-JS specifiers before TypeScript has been bundled.
const bundled = await build({ stdin: { contents: "export { tombstonesFor } from './src/tombstones.ts';",
  resolveDir: new URL("..", import.meta.url).pathname, loader: "ts" },
  bundle: true, write: false, format: "esm", platform: "node" });
const { tombstonesFor }: typeof import("../src/tombstones.ts") =
  await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0]!.contents).toString("base64")}`);

// @ref LLP 1012#5-retention-revocation-and-the-fence — rule 3 evaluated from the
// delivered row alone, over the exact schema JSON the compiler emits.

const kindIs = (value: string) => ({ Eq: [{ Field: "kind" }, { Literal: { String: value } }] });
const removedOrExpired = { Or: [kindIs("removed"), kindIs("expired")] };

const schema = {
  tables: {
    messages: { columns: { id: "Id", body: { Text: { max: 4000 } } }, retain: "delivered-history" },
    deliveries: {
      columns: { id: "Id", messageId: { Ref: { table: "messages" } }, kind: { Enum: { variants: ["message", "edit", "removed", "expired"] } } },
      retain: "until-revoked",
      tombstones: [{ table: "messages", column: "messageId", when: removedOrExpired }],
    },
  },
  maintains: [],
};

const delivery = (row: Record<string, unknown>) => ({ table: "deliveries", row: { id: "d1", recipient: "alice", at: 5, ...row } });

test("a removed or expired delivery tombstones the message it names", () => {
  assert.deepEqual(tombstonesFor(schema, delivery({ messageId: "m1", kind: "removed" })), [{ table: "messages", id: "m1" }]);
  assert.deepEqual(tombstonesFor(schema, delivery({ messageId: "m2", kind: "expired" })), [{ table: "messages", id: "m2" }]);
});

test("a message or edit delivery tombstones nothing", () => {
  assert.deepEqual(tombstonesFor(schema, delivery({ messageId: "m1", kind: "message" })), []);
  assert.deepEqual(tombstonesFor(schema, delivery({ messageId: "m1", kind: "edit" })), []);
});

test("a null, absent, empty, or non-string reference tombstones nothing", () => {
  for (const messageId of [null, undefined, "", 7, { Id: "m1" }, ["m1"]]) {
    assert.deepEqual(tombstonesFor(schema, delivery({ messageId, kind: "removed" })), [], JSON.stringify(messageId));
  }
});

test("a null or absent predicate column is false for = and !=", () => {
  const negated = { tables: { deliveries: { tombstones: [{ table: "messages", column: "messageId", when: { Ne: [{ Field: "kind" }, { Literal: { String: "message" } }] } }] } } };
  assert.deepEqual(tombstonesFor(schema, delivery({ messageId: "m1", kind: null })), []);
  assert.deepEqual(tombstonesFor(schema, { table: "deliveries", row: { messageId: "m1" } }), []);
  assert.deepEqual(tombstonesFor(negated, delivery({ messageId: "m1", kind: null })), []);
  assert.deepEqual(tombstonesFor(negated, delivery({ messageId: "m1", kind: "removed" })), [{ table: "messages", id: "m1" }]);
});

test("bool and text columns compare by their own type; not, and, and or compose", () => {
  const when = { And: [{ Eq: [{ Field: "final" }, { Literal: { Bool: true } }] }, { Not: kindIs("edit") }, { Or: [{ Ne: [{ Field: "note" }, { Literal: { String: "keep" } }] }, kindIs("expired")] }] };
  const composed = { tables: { deliveries: { tombstones: [{ table: "messages", column: "messageId", when }] } } };
  assert.deepEqual(tombstonesFor(composed, delivery({ messageId: "m1", kind: "removed", final: true, note: "gone" })), [{ table: "messages", id: "m1" }]);
  assert.deepEqual(tombstonesFor(composed, delivery({ messageId: "m1", kind: "removed", final: "true", note: "gone" })), [], "a string is not a bool");
  assert.deepEqual(tombstonesFor(composed, delivery({ messageId: "m1", kind: "edit", final: true, note: "gone" })), [], "not excludes edits");
  assert.deepEqual(tombstonesFor(composed, delivery({ messageId: "m1", kind: "removed", final: true, note: "keep" })), [], "the or needs an arm");
  assert.deepEqual(tombstonesFor(composed, delivery({ messageId: "m1", kind: "expired", final: true, note: "keep" })), [{ table: "messages", id: "m1" }]);
  assert.deepEqual(tombstonesFor(composed, delivery({ messageId: "m1", kind: "removed", final: true, note: null })), [], "a null text column fails its comparison");
});

test("several declarations union and repeated targets collapse", () => {
  const union = { tables: { deliveries: { tombstones: [
    { table: "messages", column: "messageId", when: kindIs("removed") },
    { table: "messages", column: "messageId", when: kindIs("removed") },
    { table: "messages", column: "editOf", when: kindIs("removed") },
    { table: "reactions", column: "reactionId", when: { Eq: [{ Field: "final" }, { Literal: { Bool: true } }] } },
  ] } } };
  assert.deepEqual(
    tombstonesFor(union, delivery({ messageId: "m1", editOf: "m0", reactionId: "r1", kind: "removed", final: true })),
    [{ table: "messages", id: "m1" }, { table: "messages", id: "m0" }, { table: "reactions", id: "r1" }],
  );
  assert.deepEqual(tombstonesFor(union, delivery({ messageId: "m1", editOf: "m1", kind: "removed", final: false })), [{ table: "messages", id: "m1" }]);
});

test("tables without a declaration, unknown tables, and malformed schemas tombstone nothing", () => {
  assert.deepEqual(tombstonesFor(schema, { table: "messages", row: { id: "m1", body: "hi", kind: "removed", messageId: "m2" } }), []);
  assert.deepEqual(tombstonesFor(schema, { table: "reactions", row: { messageId: "m1", kind: "removed" } }), []);
  for (const bad of [null, undefined, "schema", 4, [], {}, { tables: null }, { tables: { deliveries: null } }, { tables: { deliveries: { tombstones: "yes" } } }, { tables: { deliveries: { tombstones: [null, 1, { table: "messages" }, { column: "messageId", when: kindIs("removed") }] } } }]) {
    assert.deepEqual(tombstonesFor(bad, delivery({ messageId: "m1", kind: "removed" })), [], JSON.stringify(bad));
  }
});

test("predicate shapes outside the row-local vocabulary never evict", () => {
  const shapes = [
    "Allow",
    "Deny",
    { Public: { reason: "x" } },
    { Eq: [{ Field: "recipient" }, "Viewer"] },
    { Eq: [{ OldField: "kind" }, { Literal: { String: "removed" } }] },
    { Eq: [{ Field: "kind" }, { Literal: { Int: 1 } }] },
    { Eq: [{ Field: "kind" }] },
    { Exists: { table: "messages", index: "byId", key: [{ Field: "messageId" }], provenance: "Shape" } },
    { Within: { of: "kind" } },
    null,
    { Not: "Allow" },
  ];
  for (const when of shapes) {
    const odd = { tables: { deliveries: { tombstones: [{ table: "messages", column: "messageId", when }] } } };
    assert.deepEqual(tombstonesFor(odd, delivery({ messageId: "m1", kind: "removed", recipient: "alice" })), [], `${JSON.stringify(when)}: an unknown predicate never evicts, negated or not`);
  }
});

test("prototype names are not columns", () => {
  const proto = { tables: { deliveries: { tombstones: [{ table: "messages", column: "constructor", when: kindIs("removed") }] } } };
  assert.deepEqual(tombstonesFor(proto, delivery({ messageId: "m1", kind: "removed" })), []);
  const viaField = { tables: { deliveries: { tombstones: [{ table: "messages", column: "messageId", when: { Eq: [{ Field: "toString" }, { Field: "toString" }] } }] } } };
  assert.deepEqual(tombstonesFor(viaField, delivery({ messageId: "m1", kind: "removed" })), []);
});
