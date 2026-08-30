import { typecheckSource } from "./compiler";
import { lowerSchema } from "./lower/schema";

type Check = { name: string; run: () => void | Promise<void> };
type Register = (name: string, run: Check["run"]) => void;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function canonical(value: unknown): string {
  const normalize = (item: any): any => Array.isArray(item)
    ? item.map(normalize)
    : item && typeof item === "object"
      ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, normalize(item[key])]))
      : item;
  return JSON.stringify(normalize(value));
}

function messages(result: ReturnType<typeof lowerSchema>, code = "E_RULE_INVALID"): string[] {
  return result.diagnostics.filter((item) => item.code === code).map((item) => item.message);
}

export function registerRuleTransitionChecks(register: Register, libText: string): void {
  register("transition rules and final-exists constraints lower to the approved IR", () => {
    const result = lowerSchema(`import { channel, rule, schema, table, t } from "snapback2";
export const conversations = table({
  columns: { creatorId: t.principal() },
  indexes: { byCreator: { columns: ["creatorId"] } },
  rules: {
    read: rule.eq(rule.field("creatorId"), rule.viewer),
    insert: rule.allow(),
    update: rule.and(
      rule.eq(rule.oldField("creatorId"), rule.viewer),
      rule.eq(rule.nextField("creatorId"), rule.oldField("creatorId")),
    ),
    delete: rule.deny(),
  },
  constraints: [{
    finalExistsOnInsert: {
      table: "memberships",
      index: "byConversationPrincipalRole",
      key: [rule.field("id"), rule.field("creatorId"), rule.literal("admin")],
    },
  }],
});
export const memberships = table({
  columns: {
    conversationId: t.ref(conversations),
    principal: t.principal(),
    role: t.enum(["admin", "member"]),
  },
  indexes: {
    byConversationPrincipalRole: { columns: ["conversationId", "principal", "role"], unique: true },
  },
  rules: {
    read: rule.allow(),
    insert: rule.created(conversations, "byId", [rule.field("conversationId")]),
    update: rule.exists(memberships, "byConversationPrincipalRole", [
      rule.nextField("conversationId"), rule.nextField("principal"), rule.nextField("role"),
    ]),
    delete: rule.deny(),
  },
});
export const presence = channel({
  args: { conversationId: t.ref(conversations) },
  publish: rule.allow(), subscribe: rule.allow(), ttlMs: 10_000,
});
export default schema({ tables: { conversations, memberships }, channels: { presence } });`, "snapback/schema.ts");
    assert(result.diagnostics.length === 0, `valid transition schema was refused: ${JSON.stringify(result.diagnostics)}`);
    const conversations = result.schema.tables.conversations as any;
    const memberships = result.schema.tables.memberships as any;
    assert(canonical(conversations.rules.update) === canonical({ And: [
      { Eq: [{ OldField: "creatorId" }, "Viewer"] },
      { Eq: [{ NextField: "creatorId" }, { OldField: "creatorId" }] },
    ] }), `update image terms lowered incorrectly: ${JSON.stringify(conversations.rules.update)}`);
    assert(canonical(memberships.rules.insert) === canonical({ Created: {
      table: "conversations", index: "byId", key: [{ Field: "conversationId" }], provenance: "Shape",
    } }), `created probe lowered incorrectly: ${JSON.stringify(memberships.rules.insert)}`);
    assert(canonical(conversations.constraints) === canonical([{ FinalExistsOnInsert: {
      table: "memberships",
      index: "byConversationPrincipalRole",
      key: [{ Field: "id" }, { Field: "creatorId" }, { Literal: { String: "admin" } }],
    } }]), `final-exists constraint lowered incorrectly: ${JSON.stringify(conversations.constraints)}`);
  });

  register("transition-only rule terms are rejected outside their table effects", () => {
    const result = lowerSchema(`import { channel, rule, schema, table, t } from "snapback2";
export const records = table({
  columns: { principal: t.principal() },
  indexes: { byPrincipal: { columns: ["principal"], unique: true } },
  rules: {
    read: rule.eq(rule.oldField("principal"), rule.viewer),
    insert: rule.eq(rule.nextField("principal"), rule.viewer),
    update: rule.created(records, "byId", [rule.field("id")]),
    delete: rule.created(records, "byId", [rule.field("id")]),
  },
});
export const counts = table({
  columns: { principal: t.principal(), value: t.int() },
  rules: { read: rule.deny(), insert: rule.deny(), update: rule.deny(), delete: rule.deny() },
});
export const events = channel({
  args: { principal: t.principal() },
  publish: rule.eq(rule.oldField("principal"), rule.viewer),
  subscribe: rule.created(records, "byPrincipal", [rule.field("principal")]),
  ttlMs: 1_000,
});
export default schema({
  tables: { records, counts },
  channels: { events },
  maintains: [{
    count: "records", by: ["principal"], into: "counts",
    readable: rule.and(
      rule.eq(rule.nextField("principal"), rule.viewer),
      rule.created(records, "byPrincipal", [rule.field("principal")]),
    ),
  }],
});`, "snapback/schema.ts");
    const refused = result.diagnostics.filter((item) => item.code === "E_RULE_INVALID");
    const detail = refused.map((item) => item.message).join("\n");
    assert(refused.length === 8, `expected eight context refusals, got ${JSON.stringify(refused)}`);
    assert(detail.match(/old-row fields/g)?.length === 2, `old-field sites were not both refused: ${detail}`);
    assert(detail.match(/next-row fields/g)?.length === 2, `next-field sites were not both refused: ${detail}`);
    assert(detail.match(/created-row probes/g)?.length === 4, `created probes escaped context checks: ${detail}`);
    assert(refused.every((item) => item.site.startsWith("snapback/schema.ts:") && !item.rewrite.includes("rule.allow()")),
      `context refusals were unsited or suggested weaker authority: ${JSON.stringify(refused)}`);
  });

  register("created probes certify target, index, arity, and nominal key types", () => {
    const result = lowerSchema(`import { rule, schema, table, t } from "snapback2";
export const targets = table({
  columns: { principal: t.principal() },
  indexes: { byPrincipal: { columns: ["principal"], unique: true } },
  rules: { read: rule.deny(), insert: rule.deny(), update: rule.deny(), delete: rule.deny() },
});
export const sources = table({
  columns: { targetId: t.ref(targets), ordinaryId: t.id() },
  rules: {
    read: rule.deny(),
    insert: rule.and(
      rule.created(missing, "byId", [rule.field("targetId")]),
      rule.created(targets, "missing", [rule.field("targetId")]),
      rule.created(targets, "byId", []),
      rule.created(targets, "byPrincipal", [rule.field("ordinaryId")]),
    ),
    update: rule.deny(), delete: rule.deny(),
  },
});
export default schema({ tables: { targets, sources } });`, "snapback/schema.ts");
    const detail = messages(result).join("\n");
    assert(detail.includes("rule.created references unresolved table missing"), `missing created target was not refused: ${detail}`);
    assert(detail.includes("rule.created references unresolved index targets.missing"), `missing created index was not refused: ${detail}`);
    assert(detail.includes("rule.created key for targets.byId has 0 terms; expected 1"), `created arity was not certified: ${detail}`);
    assert(detail.includes("rule.created term for targets.byPrincipal.principal is Id; expected Principal"), `created nominal mismatch was accepted: ${detail}`);
  });

  register("final-exists constraints preserve malformed semantic shapes and certify them", () => {
    const result = lowerSchema(`import { rule, schema, table, t } from "snapback2";
export const conversations = table({
  columns: { creatorId: t.principal(), label: t.text(40) },
  rules: { read: rule.deny(), insert: rule.deny(), update: rule.deny(), delete: rule.deny() },
  constraints: [
    { finalExistsOnInsert: { table: "missing", index: "byId", key: [rule.field("id")] } },
    { finalExistsOnInsert: { table: "memberships", index: "missing", key: [rule.field("id")] } },
    { finalExistsOnInsert: { table: "memberships", index: "byConversationPrincipalRole", key: [] } },
    { finalExistsOnInsert: { table: "memberships", index: "byConversationPrincipalRole", key: [rule.field("id"), rule.field("id"), rule.literal("admin")] } },
    { finalExistsOnInsert: { table: "memberships", index: "byConversationPrincipalRole", key: [rule.field("id"), rule.field("creatorId"), rule.literal("owner")] } },
    { finalExistsOnInsert: { table: "memberships", index: "byConversationPrincipalRole", key: [rule.oldField("id"), rule.field("creatorId"), rule.literal("admin")] } },
    { finalExistsOnInsert: { table: memberships, index: "byId", key: [rule.field("id")] } },
    { finalExistsOnInsert: { table: "memberships", index: "byId", key: rule.field("id") } },
  ],
});
export const memberships = table({
  columns: {
    conversationId: t.ref(conversations), principal: t.principal(), role: t.enum(["admin", "member"]),
  },
  indexes: { byConversationPrincipalRole: { columns: ["conversationId", "principal", "role"], unique: true } },
  rules: { read: rule.deny(), insert: rule.deny(), update: rule.deny(), delete: rule.deny() },
});
export default schema({ tables: { conversations, memberships } });`, "snapback/schema.ts");
    const detail = messages(result).join("\n");
    assert(detail.includes("final-exists constraint references unknown table missing"), `final target was not certified: ${detail}`);
    assert(detail.includes("final-exists constraint references unknown index memberships.missing"), `final index was not certified: ${detail}`);
    assert(detail.includes("final-exists key for memberships.byConversationPrincipalRole has 0 terms; expected 3"), `final arity was not certified: ${detail}`);
    assert(detail.includes("final-exists term for memberships.byConversationPrincipalRole.principal is Id; expected Principal"), `final Principal mismatch was accepted: ${detail}`);
    assert(detail.includes("final-exists term for memberships.byConversationPrincipalRole.role is text literal \"owner\"; expected Enum<admin|member>"), `final enum mismatch was accepted: ${detail}`);
    assert(detail.includes("old-row fields are valid only in table update rules"), `oldField escaped final constraint restrictions: ${detail}`);
    const constraints = (result.schema.tables.conversations as any).constraints as unknown[];
    assert(constraints.length === 6, `semantic final constraints were dropped or malformed forms were emitted: ${JSON.stringify(constraints)}`);
    const shape = result.diagnostics.filter((item) => item.code === "E_SCHEMA_CONSTRAINT");
    assert(shape.length >= 2 && shape.every((item) => item.site.startsWith("snapback/schema.ts:")),
      `malformed final constraints lacked sited schema refusals: ${JSON.stringify(shape)}`);
  });

  register("transition authoring declarations distinguish created table identifiers from final table names", () => {
    const positive = typecheckSource(`import { rule, schema, table, t } from "snapback2";
export const parents = table({
  columns: {},
  rules: { read: rule.deny(), insert: rule.deny(), update: rule.deny(), delete: rule.deny() },
});
export const rows = table({
  columns: { principal: t.principal(), parentId: t.ref(parents) },
  rules: {
    read: rule.deny(), insert: rule.created(parents, "byId", [rule.field("parentId")]),
    update: rule.eq(rule.oldField("principal"), rule.nextField("principal")), delete: rule.deny(),
  },
  constraints: [{ finalExistsOnInsert: { table: "rows", index: "byId", key: [rule.field("id")] } }],
});
export default schema({ tables: { parents, rows } });`, "snapback/schema.ts", libText);
    assert(positive.length === 0, `valid transition declarations failed: ${positive.map((item) => item.messageText).join("\n")}`);
    const negative = typecheckSource(`import { rule, table, t } from "snapback2";
export const rows = table({
  columns: { principal: t.principal() },
  rules: { insert: rule.created("rows", "byId", [rule.field("id")]) },
});`, "snapback/schema.ts", libText);
    const detail = JSON.stringify(negative.map((item) => item.messageText));
    assert(negative.length === 1 && detail.includes("string") && detail.includes("Table"),
      `rule.created accepted a static table-name string or emitted the wrong type error: ${detail}`);
  });
}
