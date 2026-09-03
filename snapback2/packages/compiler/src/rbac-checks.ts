import { typecheckSource } from "./compiler";
import { IR_CONTRACT } from "./ir";
import { lowerSchema } from "./lower/schema";
import { lowerProject as lowerAuthoredProject, lowerSeed } from "./project";

type Check = { name: string; run: () => void | Promise<void> };
type Register = (name: string, run: Check["run"]) => void;
type Canonical = (value: unknown) => string;
type WithProject = <T>(
  files: Record<string, string>,
  run: (root: string) => Promise<T>,
) => Promise<T>;
const lowerProject = (root: string) => lowerAuthoredProject(root, { authoring: "any" });

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export function registerPrincipalChecks(
  register: Register,
  canonical: Canonical,
  withProject: WithProject,
): void {
  register("Principal columns and arguments stay nominal across lowering and generated APIs", async () => {
    await withProject({
      "snapback/schema.ts": `import { schema, table, t } from "snapback2";
        export const profiles = table({ columns: { name: t.text(100) } });
        export const grants = table({ columns: { principal: t.principal(), profileId: t.ref(profiles) } });
        export default schema({ tables: { profiles, grants } });`,
      "snapback/grants.ts": `import { mutation, t } from "snapback2";
        import { grants, profiles } from "./schema";
        export const assign = mutation({ target: t.principal(), profileId: t.ref(profiles) }, ({ db, ctx, args }) => {
          const id = ctx.newId();
          db.insert(grants, { id, principal: ctx.viewer, profileId: args.profileId });
          db.update(grants, id, { principal: args.target });
          return { actor: ctx.viewer, target: args.target };
        });`,
      "snapback/seed.ts": `import { seed } from "snapback2";
        export default seed({ personas: ["alice"], rows: {
          profiles: [{ id: "p1", name: "Alice" }],
          grants: [{ id: "g1", principal: "dev:alice", profileId: "p1" }],
        } });`,
    }, async (root) => {
      const project = await lowerProject(root);
      assert(project.ok, `Principal project refused: ${project.ok ? "" : project.diagnostics.map((item) => `${item.code} ${item.message}`).join("; ")}`);
      const columns = (project.project.schema.tables.grants as any).columns;
      const assign = project.project.programs.find((item) => item.name === "grants.assign")!;
      assert(columns.principal === "Principal", `Principal column lowered as ${canonical(columns.principal)}`);
      assert(assign.args.target === "Principal", `Principal argument lowered as ${canonical(assign.args.target)}`);
      assert(canonical(assign.args.profileId) === canonical({ Ref: { table: "profiles" } }), "Ref argument lost its table beside Principal");
      assert(project.apiDts.includes("principal: Principal") && project.apiDts.includes("target: Principal")
        && project.apiDts.includes("profileId: string"), "generated declarations did not distinguish Principal from table IDs");
      assert(canonical(assign).includes('"Viewer"') && canonical(assign).includes('"Variable":"target"'),
        "ctx.viewer or the Principal argument did not reach the operation IR");
      const seed = await lowerSeed(root);
      assert(seed.ok && (seed.seed.rows.grants?.[0] as any)?.principal === "dev:alice",
        "schema-directed persona seed did not preserve its Principal wire value");
    });
  });

  register("ordinary strings and table refs cannot fill Principal insert, update, or argument values", async () => {
    await withProject({
      "snapback/schema.ts": `import { schema, table, t } from "snapback2";
        export const profiles = table({ columns: { name: t.text(100) } });
        export const grants = table({ columns: { principal: t.principal() } });
        export default schema({ tables: { profiles, grants } });`,
      "snapback/grants.ts": `import { mutation, t } from "snapback2";
        import { grants, profiles } from "./schema";
        export const insertRef = mutation({ profileId: t.ref(profiles) }, ({ db, ctx, args }) =>
          db.insert(grants, { id: ctx.newId(), principal: args.profileId }));
        export const insertString = mutation({}, ({ db, ctx }) =>
          db.insert(grants, { id: ctx.newId(), principal: "forged" }));
        export const updateRef = mutation({ grantId: t.ref(grants), profileId: t.ref(profiles) }, ({ db, args }) =>
          db.update(grants, args.grantId, { principal: args.profileId }));
        export const forgeArg = mutation({ target: t.principal() }, ({ args }) => {
          const forged: typeof args.target = "forged";
          return forged;
        });`,
    }, async (root) => {
      const project = await lowerProject(root);
      assert(!project.ok, "ordinary string/table Ref values unexpectedly inhabited Principal");
      const nominal = project.diagnostics.filter((item) =>
        item.message.includes("not assignable") && item.message.includes("Principal"));
      assert(nominal.length >= 4, `Principal negative paths were not all rejected: ${project.diagnostics.map((item) => item.message).join("; ")}`);
    });
  });
}

export function registerRbacRuleChecks(
  register: Register,
  canonical: Canonical,
  libText: string,
  withProject: WithProject,
): void {
  register("schema lowering refuses malformed constraints and every skipped authored shape", () => {
    const source = `import { schema, table, t, rule } from 'snapback2';
      export const source = table({ columns: { ownerId: t.id() },
        indexes: { byOwner: { columns: ['ownerId'], mystery: true } },
        rules: { read: rule.mystery() },
        constraints: [{ cap: { by: ['ownerId'], max: '2' } }, { mystery: true }] });
      export const target = table({ columns: { count: t.int() } });
      export default schema({ tables: { source, target }, maintains: [{ mystery: 'source', by: ['ownerId'], into: 'target' }] });`;
    const lowered = lowerSchema(source, "snapback/schema.ts");
    const codes = new Set(lowered.diagnostics.map((item) => item.code));
    for (const code of ["E_SCHEMA_CONSTRAINT", "E_SCHEMA_INDEX_OPTION", "E_RULE_INVALID", "E_SCHEMA_MAINTAIN"]) {
      assert(codes.has(code as any), `strict schema diagnostics omitted ${code}`);
    }
    assert(lowered.diagnostics.every((item) => item.site.startsWith("snapback/schema.ts:") && item.rewrite.length > 0), "schema refusal envelope is incomplete");
  });

  register("maintain lowering closes source, target, type, and ownership shapes", () => {
    const valid = lowerSchema(`import { schema, table, t } from "snapback2";
      export const events = table({ columns: { group: t.text(20), amount: t.int() } });
      export const eventCounts = table({ columns: { group: t.text(20), value: t.int() } });
      export const eventTotals = table({ columns: { group: t.text(20), value: t.int() } });
      export default schema({
        tables: { events, eventCounts, eventTotals },
        maintains: [
          { count: "events", by: ["group"], into: "eventCounts" },
          { sum: { source: "events", of: "amount" }, by: ["group"], into: "eventTotals" },
        ],
      });`, "snapback/schema.ts");
    assert(!valid.diagnostics.some((item) => item.code === "E_SCHEMA_MAINTAIN"),
      `valid maintains were refused: ${JSON.stringify(valid.diagnostics)}`);

    const malformed = lowerSchema(`import { schema, table, t } from "snapback2";
      export const events = table({ columns: {
        group: t.text(20), amount: t.int(), label: t.text(20), value: t.int(),
      } });
      export const duplicateGroup = table({ columns: { group: t.text(20), value: t.int() } });
      export const reservedId = table({ columns: { value: t.int() } });
      export const reservedValue = table({ columns: { value: t.int() } });
      export const missingSource = table({ columns: { value: t.int() } });
      export const missingSum = table({ columns: { group: t.text(20), value: t.int() } });
      export const textSum = table({ columns: { group: t.text(20), value: t.int() } });
      export const missingGroup = table({ columns: { value: t.int() } });
      export const wrongGroup = table({ columns: { group: t.text(10), value: t.int() } });
      export const wrongValue = table({ columns: { group: t.text(20), value: t.text(20) } });
      export const extraTarget = table({ columns: { group: t.text(20), value: t.int(), extra: t.bool() } });
      export const sharedTarget = table({ columns: { group: t.text(20), value: t.int() } });
      export const derivedSource = table({ columns: { group: t.text(20), value: t.int() } });
      export const derivedTarget = table({ columns: { group: t.text(20), value: t.int() } });
      export default schema({
        tables: {
          events, duplicateGroup, reservedId, reservedValue, missingSource, missingSum,
          textSum, missingGroup, wrongGroup, wrongValue, extraTarget, sharedTarget,
          derivedSource, derivedTarget,
        },
        maintains: [
          { count: "events", by: ["group", "group"], into: "duplicateGroup" },
          { count: "events", by: ["id"], into: "reservedId" },
          { count: "events", by: ["value"], into: "reservedValue" },
          { count: "events", by: ["missing"], into: "missingSource" },
          { sum: { source: "events", of: "missing" }, by: ["group"], into: "missingSum" },
          { sum: { source: "events", of: "label" }, by: ["group"], into: "textSum" },
          { count: "events", by: ["group"], into: "missingGroup" },
          { count: "events", by: ["group"], into: "wrongGroup" },
          { count: "events", by: ["group"], into: "wrongValue" },
          { count: "events", by: ["group"], into: "extraTarget" },
          { count: "events", by: ["group"], into: "sharedTarget" },
          { sum: { source: "events", of: "amount" }, by: ["group"], into: "sharedTarget" },
          { count: "events", by: ["group"], into: "derivedSource" },
          { count: "derivedSource", by: ["group"], into: "derivedTarget" },
        ],
      });`, "snapback/schema.ts");
    const refusals = malformed.diagnostics.filter((item) => item.code === "E_SCHEMA_MAINTAIN");
    const detail = refusals.map((item) => item.message).join("\n");
    for (const fragment of [
      "maintain.by repeats source column group",
      "maintain.by cannot use reserved source column id",
      "maintain.by cannot use reserved source column value",
      "unknown source column events.missing",
      "sum maintain names unknown source column events.missing",
      "sum maintain source column events.label must be Int, Decimal, or Money",
      "maintain target missingGroup.group must exactly match source events.group",
      "maintain target wrongGroup.group must exactly match source events.group",
      "maintain target wrongValue.value type Text",
      "maintain target extraTarget has non-aggregate columns extra",
      "maintain target sharedTarget is owned by both",
      "maintain target derivedSource cannot also be a maintain source",
    ]) {
      assert(detail.includes(fragment), `maintain shape refusal omitted ${fragment}: ${detail}`);
    }
    assert(refusals.every((item) => item.family === "schema"
      && item.site.startsWith("snapback/schema.ts:") && item.rewrite.length > 0),
    `maintain refusals lost their stable envelope: ${JSON.stringify(refusals)}`);
  });

  register("rule input visibility is derived and cannot be authored into the IR", () => {
    const source = `import { schema, table, t, rule } from 'snapback2';
      export const grants = table({ columns: { principal: t.id() },
        indexes: { byPrincipal: { columns: ['principal'], unique: true } },
        rules: { read: rule.deny(), insert: rule.allow(), update: rule.allow(), delete: rule.allow() } });
      export const docs = table({ columns: { title: t.text(20) },
        rules: { read: rule.exists(grants, 'byPrincipal', [rule.viewer], { hidden: false }), insert: rule.allow(), update: rule.allow(), delete: rule.allow() } });
      export default schema({ tables: { grants, docs } });`;
    const lowered = lowerSchema(source, "snapback/schema.ts");
    const visibility = lowered.diagnostics.find((item) =>
      item.code === "E_RULE_INVALID" && item.message.includes("visibility is derived"));
    assert(visibility, "authored rule-input visibility did not produce a sited refusal");
    assert(!canonical(lowered.schema).includes("input_visibility"), "authored rule-input visibility reached engine IR");
  });

  register("reciprocal table rules accept only the current row id as its nominal Ref", async () => {
    await withProject({
      "snapback/schema.ts": `import { rule, schema, table, t } from "snapback2";
        export const conversations = table({
          columns: { title: t.text(120) },
          rules: {
            read: rule.exists(memberships, "byConversationPrincipal", [rule.field("id"), rule.viewer]),
            insert: rule.deny(), update: rule.deny(), delete: rule.deny(),
          },
        });
        export var memberships = table({
          columns: { conversationId: t.ref(conversations), principal: t.principal() },
          indexes: { byConversationPrincipal: { columns: ["conversationId", "principal"], unique: true } },
          rules: {
            read: rule.exists(memberships, "byConversationPrincipal", [rule.field("conversationId"), rule.viewer]),
            insert: rule.deny(), update: rule.deny(), delete: rule.deny(),
          },
        });
        export default schema({ tables: { conversations, memberships } });`,
      "snapback/conversations.ts": `import { query, t } from "snapback2";
        import { conversations } from "./schema";
        export const byId = query({ id: t.ref(conversations) }, ({ db, args }) => db.get(conversations, args.id));`,
    }, async (root) => {
      const accepted = await lowerProject(root);
      assert(accepted.ok,
        `reciprocal membership rule refused: ${accepted.ok ? "" : accepted.diagnostics.map((item) => `${item.code} ${item.message}`).join("; ")}`);
      const read = (accepted.project.schema.tables.conversations as any).rules.read;
      assert(canonical(read) === canonical({ Exists: {
        table: "memberships",
        index: "byConversationPrincipal",
        key: [{ Field: "id" }, "Viewer"],
        provenance: "Shape",
      } }), `conversation membership rule lowered differently: ${canonical(read)}`);
    });

    const nominalControls = lowerSchema(`import { rule, schema, table, t } from "snapback2";
      export const conversations = table({
        columns: { aliasId: t.id() },
        rules: {
          read: rule.exists(memberships, "byConversationPrincipal", [rule.field("aliasId"), rule.viewer]),
          insert: rule.deny(), update: rule.deny(), delete: rule.deny(),
        },
      });
      export const profiles = table({
        columns: { name: t.text(40) },
        rules: {
          read: rule.exists(memberships, "byConversationPrincipal", [rule.field("id"), rule.viewer]),
          insert: rule.deny(), update: rule.deny(), delete: rule.deny(),
        },
      });
      export const memberships = table({
        columns: { conversationId: t.ref(conversations), principal: t.principal() },
        indexes: { byConversationPrincipal: { columns: ["conversationId", "principal"], unique: true } },
      });
      export default schema({ tables: { conversations, profiles, memberships } });`, "snapback/schema.ts");
    const nominalRefusals = nominalControls.diagnostics.filter((item) =>
      item.code === "E_RULE_INVALID" && item.message.includes("is Id; expected Ref<conversations>"));
    assert(nominalRefusals.length === 2,
      `unrelated or non-intrinsic Ids crossed the Ref boundary: ${nominalControls.diagnostics.map((item) => item.message).join("; ")}`);

    await withProject({
      "snapback/schema.ts": `import { rule, schema, table, t } from "snapback2";
        export const conversations = table({ columns: { title: t.text(120) }, rules: { read: futureRule } });
        export var futureRule = rule.allow();
        export default schema({ tables: { conversations } });`,
      "snapback/conversations.ts": `import { query, t } from "snapback2";
        import { conversations } from "./schema";
        export const byId = query({ id: t.ref(conversations) }, ({ db, args }) => db.get(conversations, args.id));`,
    }, async (root) => {
      const refused = await lowerProject(root);
      assert(!refused.ok && refused.diagnostics.some((item) =>
        item.message.includes("futureRule") && item.message.includes("used before being assigned")),
      `non-table used-before-assigned diagnostic was suppressed: ${refused.ok ? "accepted" : refused.diagnostics.map((item) => item.message).join("; ")}`);
    });
  });

  register("rule terms and exists keys are checked against nominal schema types", () => {
    const valid = `import { schema, table, t, rule } from "snapback2";
      export const profiles = table({ columns: { name: t.text(40) } });
      export const grants = table({ columns: { principal: t.principal() },
        indexes: { byPrincipal: { columns: ["principal"], unique: true } },
        rules: { read: rule.deny(), insert: rule.allow(), update: rule.allow(), delete: rule.allow() } });
      export const docs = table({ columns: { owner: t.principal(), backup: t.principal(), profileId: t.ref(profiles) },
        rules: {
          read: rule.viewerIs("owner"),
          insert: rule.eq(rule.field("owner"), rule.viewer),
          update: rule.and(
            rule.ne(rule.field("backup"), rule.viewer),
            rule.exists(grants, "byPrincipal", [rule.viewer]),
            rule.exists(profiles, "byId", [rule.field("profileId")]),
          ),
          delete: rule.system(),
        } });
      export default schema({ tables: { profiles, grants, docs } });`;
    const accepted = lowerSchema(valid, "snapback/schema.ts");
    assert(accepted.diagnostics.length === 0,
      `valid Principal rules refused: ${accepted.diagnostics.map((item) => item.message).join("; ")}`);
    assert(canonical((accepted.schema.tables.docs as any)?.rules?.delete)
      === canonical({ Eq: ["Viewer", { Literal: { Id: IR_CONTRACT.systemPrincipalId } }] }),
    "rule.system lost its reserved Principal lowering");

    const invalid = `import { schema, table, t, rule } from "snapback2";
      export const profiles = table({ columns: { name: t.text(40) } });
      export const legacy = table({
        columns: { ownerRef: t.ref(profiles), ownerId: t.id(), principal: t.principal(), label: t.text(40) },
        indexes: {
          byOwnerRef: { columns: ["ownerRef"] }, byOwnerId: { columns: ["ownerId"] },
          byPrincipal: { columns: ["principal"] }, byLabel: { columns: ["label"] },
        },
        rules: { read: rule.allow(), insert: rule.allow(), update: rule.allow(), delete: rule.allow() },
      });
      export const docs = table({
        columns: { ownerRef: t.ref(profiles), ownerId: t.id(), principal: t.principal(), label: t.text(40) },
        rules: {
          read: rule.viewerIs("ownerRef"),
          insert: rule.eq(rule.field("ownerId"), rule.viewer),
          update: rule.ne(rule.viewer, rule.field("label")),
          delete: rule.exists(legacy, "byOwnerRef", [rule.viewer]),
        },
      });
      export const malformed = table({
        columns: { ownerRef: t.ref(profiles), ownerId: t.id(), label: t.text(40) },
        rules: {
          read: rule.exists(legacy, "byPrincipal", [rule.field("ownerRef")]),
          insert: rule.exists(legacy, "byPrincipal", []),
          update: rule.exists(legacy, "missing", [rule.viewer]),
          delete: rule.and(
            rule.eq(rule.field("label"), rule.field("ownerId")),
            rule.exists(legacy, "byOwnerId", [rule.field("ownerRef")]),
          ),
        },
      });
      export const unresolved = table({ columns: { principal: t.principal() },
        rules: { read: rule.exists(missing, "byPrincipal", [rule.viewer]), insert: rule.allow(), update: rule.allow(), delete: rule.allow() } });
      export default schema({ tables: { profiles, legacy, docs, malformed, unresolved } });`;
    const refused = lowerSchema(invalid, "snapback/schema.ts");
    const messages = refused.diagnostics.filter((item) => item.code === "E_RULE_INVALID");
    for (const expected of [
      "fields compared with rule.viewer must be Principal",
      "rule.eq compares Id with Principal",
      "rule.ne compares Principal with Text",
      "is Principal; expected Ref<profiles>",
      "is Ref<profiles>; expected Principal",
      "has 0 terms; expected 1",
      "unresolved index legacy.missing",
      "rule.eq compares Text with Id",
      "is Ref<profiles>; expected Id",
      "unresolved table missing",
    ]) {
      assert(messages.some((item) => item.message.includes(expected)),
        `typed rule refusals omitted ${expected}: ${messages.map((item) => item.message).join("; ")}`);
    }
    assert(messages.every((item) => item.site.startsWith("snapback/schema.ts:") && item.rewrite.length > 0),
      "typed rule refusal lost its authored site or mechanical rewrite");
  });

  register("rule literals respect Enum, Decimal, Money, Json, Id, and Ref domains", () => {
    const valid = `import { schema, table, t, rule } from "snapback2";
      export const rows = table({
        columns: {
          role: t.enum(["member", "admin"]), metadata: t.json(1024),
          price: t.decimal(2), budget: t.money("USD"),
        },
        rules: {
          read: rule.and(
            rule.eq(rule.field("role"), rule.literal("member")),
            rule.eq(rule.field("price"), rule.literal(2)),
            rule.eq(rule.literal(2.50), rule.field("budget")),
            rule.ne(rule.field("metadata"), rule.literal(null)),
            rule.ne(rule.field("metadata"), rule.literal(true)),
            rule.ne(rule.field("metadata"), rule.literal(7)),
            rule.ne(rule.field("metadata"), rule.literal("ok")),
            rule.ne(rule.field("metadata"), rule.literal([null, "nested"])),
            rule.ne(rule.field("metadata"), rule.literal({ nested: [true, 1] })),
            rule.ne(rule.literal([1]), rule.literal([null, "nested"])),
          ),
          insert: rule.allow(), update: rule.allow(), delete: rule.allow(),
        },
      });
      export default schema({ tables: { rows } });`;
    const accepted = lowerSchema(valid, "snapback/schema.ts");
    assert(accepted.diagnostics.length === 0,
      `valid Enum/Json literals refused: ${accepted.diagnostics.map((item) => item.message).join("; ")}`);

    const invalid = `import { schema, table, t, rule } from "snapback2";
      export const profiles = table({ columns: { name: t.text(40) } });
      export const rows = table({
        columns: {
          role: t.enum(["member", "admin"]), price: t.decimal(2),
          budget: t.money("USD"), ownerId: t.id(), profileId: t.ref(profiles),
        },
        rules: {
          read: rule.ne(rule.field("role"), rule.literal("admn")),
          insert: rule.allow(),
          update: rule.allow(),
          delete: rule.eq(rule.field("ownerId"), rule.literal("row-1")),
        },
      });
      export const refRows = table({ columns: { profileId: t.ref(profiles) },
        rules: { read: rule.eq(rule.field("profileId"), rule.literal("profile-1")),
          insert: rule.allow(), update: rule.allow(), delete: rule.allow() } });
      export default schema({ tables: { profiles, rows, refRows } });`;
    const refused = lowerSchema(invalid, "snapback/schema.ts");
    const messages = refused.diagnostics.filter((item) => item.code === "E_RULE_INVALID").map((item) => item.message);
    for (const expected of [
      'Enum<member|admin> with text literal "admn"',
      'Id with text literal "row-1"',
      'Ref<profiles> with text literal "profile-1"',
    ]) {
      assert(messages.some((message) => message.includes(expected)),
        `rule literal refusals omitted ${expected}: ${messages.join("; ")}`);
    }
  });

  register("text constraints lower minimum, handle, and URL validation and reject invalid targets", () => {
    const valid = lowerSchema(`import { schema, table, t } from "snapback2";
      export const profiles = table({
        columns: { handle: t.text(20), link: t.optional(t.text(200)) },
        constraints: [
          { text: { field: "handle", min: 3, format: "handle" } },
          { text: { field: "link", format: "url" } },
        ],
      });
      export default schema({ tables: { profiles } });`, "snapback/schema.ts");
    assert(valid.diagnostics.length === 0, `valid text constraints refused: ${JSON.stringify(valid.diagnostics)}`);
    const constraints = (valid.schema.tables.profiles as any).constraints;
    assert(canonical(constraints) === canonical([
      { Text: { field: "handle", min: 3, format: "handle" } },
      { Text: { field: "link", min: 0, format: "url" } },
    ]), `text constraints lowered unexpectedly: ${JSON.stringify(constraints)}`);

    for (const [label, columns, constraint] of [
      ["non-text", `{ count: t.int() }`, `{ text: { field: "count", min: 1 } }`],
      ["too-large", `{ handle: t.text(2) }`, `{ text: { field: "handle", min: 3 } }`],
      ["format", `{ handle: t.text(20) }`, `{ text: { field: "handle", format: "slug" } }`],
      ["empty", `{ handle: t.text(20) }`, `{ text: { field: "handle" } }`],
    ] as const) {
      const invalid = lowerSchema(`import { schema, table, t } from "snapback2";
        export const rows = table({ columns: ${columns}, constraints: [${constraint}] });
        export default schema({ tables: { rows } });`, `snapback/${label}.ts`);
      assert(invalid.diagnostics.some((item) => item.code === "E_SCHEMA_CONSTRAINT"),
        `${label} text constraint did not produce E_SCHEMA_CONSTRAINT`);
    }
  });

  register("implicit id and byId cannot be overwritten, including by update patches", () => {
    const source = `import { schema, table, t } from 'snapback2';
      export const rows = table({ columns: { id: t.int(), value: t.int() }, indexes: { byId: { columns: ['value'] } } });
      export default schema({ tables: { rows } });`;
    const lowered = lowerSchema(source, "snapback/schema.ts");
    const reserved = lowered.diagnostics.filter((item) => item.code === "E_SCHEMA_ID_RESERVED");
    assert(reserved.length === 2, `expected reserved id and byId refusals, got ${reserved.length}`);
    assert((lowered.schema.tables.rows as any).columns.id === "Id", "authored id replaced the implicit Id column");
    assert(canonical((lowered.schema.tables.rows as any).indexes.byId) === canonical({ columns: ["id"], unique: true }), "authored byId replaced the implicit index");

    for (const patch of [
      `{ id: "row-2" }`,
      `(row: { id: string; value: number }) => ({ id: row.id })`,
    ]) {
      const authored = `import { mutation, table, t } from "snapback2";
        const records = table({ columns: { value: t.int() } });
        export const rewriteId = mutation({}, ({ db }) => db.update(records, "row-1", ${patch}));`;
      const diagnostics = typecheckSource(authored, "update-id.ts", libText);
      assert(diagnostics.length === 1, `update patch unexpectedly admitted id: ${patch}`);
    }
    const ordinaryPatch = typecheckSource(`import { mutation, table, t } from "snapback2";
      const records = table({ columns: { value: t.int() } });
      export const updateValue = mutation({}, ({ db }) => db.update(records, "row-1", { value: 2 }));`,
    "update-value.ts", libText);
    assert(ordinaryPatch.length === 0, "omitting id made an ordinary update patch ill-typed");
  });
}
