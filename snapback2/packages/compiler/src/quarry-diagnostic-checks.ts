import { deepStrictEqual } from "node:assert";
import { readdir } from "node:fs/promises";
import { lowerProject } from "./project";
import type { FrontendDiagnostic } from "./ir";
import { assert, occurrences, withProject, type Test } from "./quarry-check-helpers";

// @ref LLP 1002#3-the-compiler-worker-and-the-project-json — independent
// refusals survive frontend recovery; failed bindings do not acquire a type.
export const diagnosticSchema = `use identity

table todos:
  title: text <=200
  done: bool
  ownerId: principal
  by ownerId
  read <- .ownerId = viewer
  insert <- .ownerId = viewer
  update <- .ownerId = viewer
  delete <- .ownerId = viewer
`;
const mergeDiagnosticSchema = diagnosticSchema.replace("  by ownerId", "  by byOwner: ownerId, id");
const originalPrefix = `query list():
  return todos[viewer] first 50

mutation add(title: text <=200):
  row = insert todos { title, done: false, ownerId: viewer }
  return { id: row.id }

`;
type Expected = { code: string; message: string; site?: string; absence?: boolean; boolean?: boolean };
export const quarryDiagnosticCases: Array<{
  name: string; source: string; expected: Expected[]; schema?: string; irCounts?: Record<string, number>;
}> = [
  { name: "independent write mismatch and unknown return", source: originalPrefix + `mutation complete(todoId: todos):
  update todos[todoId] { done: "yes" }
  return missingValue
`, expected: [
    { code: "E_QUARRY_UNKNOWN", message: "unknown name missingValue", site: "10:10" },
    { code: "E_OPAQUE", message: "Type 'string' is not assignable to type 'boolean | undefined'", site: "9:3", absence: false, boolean: true },
  ] },
  { name: "nonnullable mismatch is not absence", source: originalPrefix + `mutation complete(todoId: todos):
  update todos[todoId] { done: "yes" }
  return true
`, expected: [{ code: "E_OPAQUE", message: "Type 'string' is not assignable to type 'boolean | undefined'", site: "9:3", absence: false, boolean: true }] },
  { name: "unknown statement before independent mismatch", source: `mutation complete(todoId: todos):
  lost = missingValue
  update todos[todoId] { done: "yes" }
  return true
`, expected: [{ code: "E_QUARRY_UNKNOWN", message: "unknown name missingValue", site: "2:10" }, { code: "E_OPAQUE", message: "Type 'string'", site: "3:3", absence: false }] },
  { name: "failed binding and aliases suppress dependent cascades", source: `mutation complete(todoId: todos):
  lost = missingValue
  alias = lost
  update todos[todoId] { done: alias }
  return anotherMissing
`, expected: [{ code: "E_QUARRY_UNKNOWN", message: "unknown name missingValue" }, { code: "E_QUARRY_UNKNOWN", message: "unknown name anotherMissing" }] },
  { name: "failed read key never borrows inferred index facts", source: `query probe():
  key = missingValue
  row = todos[key]
  return anotherMissing
`, expected: [{ code: "E_QUARRY_UNKNOWN", message: "unknown name missingValue" }, { code: "E_QUARRY_UNKNOWN", message: "unknown name anotherMissing" }] },
  { name: "nested branch refusals keep independent type checks", source: `mutation complete(todoId: todos, flag: bool):
  if flag:
    lost = missingThen
    update todos[todoId] { done: "yes" }
  else:
    lost = missingElse
  return true
`, expected: [{ code: "E_QUARRY_UNKNOWN", message: "unknown name missingThen" }, { code: "E_QUARRY_UNKNOWN", message: "unknown name missingElse" }, { code: "E_OPAQUE", message: "Type 'string'", site: "4:5", absence: false }] },
  { name: "unresolved condition does not pretend to check its dependants", source: `query probe():
  if missingCondition:
    return missingInside
  return missingAfter
`, expected: [{ code: "E_QUARRY_UNKNOWN", message: "unknown name missingCondition" }, { code: "E_QUARRY_UNKNOWN", message: "unknown name missingAfter" }] },
  { name: "failed binding invalidates a same-name argument", source: `mutation probe(done: bool, todoId: todos):
  done = missingValue
  update todos[todoId] { done }
  return missingAfter
`, expected: [{ code: "E_QUARRY_UNKNOWN", message: "unknown name missingValue" }, { code: "E_QUARRY_UNKNOWN", message: "unknown name missingAfter" }] },
  { name: "nullable wrong primitive still needs a type repair", source: `mutation complete(todoId: todos, value: text <=10 ?):
  update todos[todoId] { done: value }
  return true
`, expected: [{ code: "E_OPAQUE", message: "Type 'string | undefined' is not assignable", absence: false, boolean: true }] },
  { name: "nullable matching insert value retains presence advice", source: `mutation add(done: bool ?):
  row = insert todos { title: "hi", done, ownerId: viewer }
  return true
`, expected: [{ code: "E_OPAQUE", message: "undefined", absence: true }] },
  { name: "null-only insert needs a value instead of an assertion", source: `mutation add():
  row = insert todos { title: "hi", done: null, ownerId: viewer }
  return true
`, expected: [{ code: "E_OPAQUE", message: "null", absence: false, boolean: true }] },
  { name: "possibly absent dereference retains presence advice", schema: "table authors:\n  name: text <=50\n  public\n\ntable posts:\n  author: authors\n  public\n  by author\n\ntable copies:\n  name: text <=50\n  public\n", source: "mutation copy():\n  for post in posts[] first 5 by byAuthor { *, author: .author }:\n    insert copies { name: post.author.name }\n  null\n", expected: [{ code: "E_OPAQUE", message: "undefined", absence: true }] },
  { name: "corrected original keeps all three operations", source: originalPrefix + `mutation complete(todoId: todos):
  update todos[todoId] { done: true }
  return true
`, expected: [] },
  { name: "presence assertion corrects the optional insert", source: `mutation add(done: bool ?):
  row = insert todos { title: "hi", done: done! else MISSING_DONE, ownerId: viewer }
  return { row, next: new }
`, expected: [] },
  { name: "generated declaration errors do not become type mismatch advice", source: `query probe():
  x = 1
  x = 2
  return x
`, expected: [
    { code: "E_QUARRY_UNKNOWN", message: "duplicate local x", site: "3:3" },
  ] },
  { name: "lexical loop-shadow", source: `mutation complete(todoId: todos):
  done = missingValue
  for done in ["yes"]:
    update todos[todoId] { done }
  return true
`, expected: [{"code": "E_QUARRY_UNKNOWN", "message": "unknown name missingValue", "site": "2:10"}, {"code": "E_OPAQUE", "message": "Type 'string' is not assignable to type 'boolean | undefined'", "site": "4:5", "absence": false, "boolean": true}], },
  { name: "lexical match-shadow", source: `mutation complete(todoId: todos):
  item = missingValue
  match todos[todoId]:
    some item:
      update todos[todoId] { done: item.title }
    none:
      return false
  return true
`, expected: [{"code": "E_QUARRY_UNKNOWN", "message": "unknown name missingValue", "site": "2:10"}, {"code": "E_OPAQUE", "message": "Type 'string' is not assignable to type 'boolean | undefined'", "site": "5:7", "absence": false, "boolean": true}], },
  { name: "lexical loop-capture", source: `mutation complete(todoId: todos):
  item = missingValue
  for item in ["yes"]:
    box = { original: item }
    update todos[todoId] { done: box.original }
  return true
`, expected: [{"code": "E_QUARRY_UNKNOWN", "message": "unknown name missingValue", "site": "2:10"}, {"code": "E_OPAQUE", "message": "Type 'string' is not assignable to type 'boolean | undefined'", "site": "5:5", "absence": false, "boolean": true}], },
  { name: "lexical match-capture-isolation", source: `mutation complete(todoId: todos):
  item = missingValue
  match todos[todoId]:
    some item:
      box = { original: item }
      update todos[todoId] { done: box.original.title }
    none:
      update todos[todoId] { done: item }
  update todos[todoId] { done: item }
  return true
`, expected: [{"code": "E_QUARRY_UNKNOWN", "message": "unknown name missingValue", "site": "2:10"}, {"code": "E_OPAQUE", "message": "Type 'string' is not assignable to type 'boolean | undefined'", "site": "6:7", "absence": false, "boolean": true}], },
  { name: "lexical nested-loop-isolation", source: `mutation complete(todoId: todos):
  item = missingValue
  for item in ["yes"]:
    for item in [true]:
      update todos[todoId] { done: item }
    box = { original: item }
    update todos[todoId] { done: box.original }
  update todos[todoId] { done: item }
  return true
`, expected: [{"code": "E_QUARRY_UNKNOWN", "message": "unknown name missingValue", "site": "2:10"}, {"code": "E_OPAQUE", "message": "Type 'string' is not assignable to type 'boolean | undefined'", "site": "7:5", "absence": false, "boolean": true}], },
  { name: "lexical failed-loop-domain", source: `mutation complete(todoId: todos):
  item = missingValue
  for item in item:
    update todos[todoId] { done: "yes" }
  return missingAfter
`, expected: [{"code": "E_QUARRY_UNKNOWN", "message": "unknown name missingValue", "site": "2:10"}, {"code": "E_QUARRY_UNKNOWN", "message": "unknown name missingAfter", "site": "5:10"}], },
  { name: "lexical failed-match-key", source: `mutation complete(todoId: todos):
  todoId = missingValue
  match todos[todoId]:
    some todoId:
      update todos[todoId.id] { done: "yes" }
    none:
      return missingInside
  return missingAfter
`, expected: [{"code": "E_QUARRY_UNKNOWN", "message": "unknown name missingValue", "site": "2:12"}, {"code": "E_QUARRY_UNKNOWN", "message": "unknown name missingAfter", "site": "8:10"}], },
  { name: "lexical failed-tuple-initializer", source: `mutation complete(todoId: todos):
  item = missingValue
  (item, other) = sorted(true, item)
  update todos[todoId] { done: other }
  return missingAfter
`, expected: [{"code": "E_QUARRY_UNKNOWN", "message": "unknown name missingValue", "site": "2:10"}, {"code": "E_QUARRY_UNKNOWN", "message": "unknown name missingAfter", "site": "5:10"}], },
  { name: "lexical fresh-divmod-binding", source: `mutation complete(todoId: todos):
  item = missingValue
  (item, other) = divmod(3, 2)
  update todos[todoId] { done: item }
  return true
`, expected: [{"code": "E_QUARRY_UNKNOWN", "message": "unknown name missingValue", "site": "2:10"}, {"code": "E_OPAQUE", "message": "Type 'number' is not assignable to type 'boolean | undefined'", "site": "4:3", "absence": false, "boolean": true}], },
  { name: "lexical failed-inner-shadow-restores-outer", source: `mutation complete(todoId: todos):
  item = "yes"
  for item in [true]:
    item = missingValue
    box = { original: item }
    update todos[todoId] { done: box.original }
  update todos[todoId] { done: item }
  return true
`, expected: [{"code": "E_QUARRY_UNKNOWN", "message": "unknown name missingValue", "site": "4:12"}, {"code": "E_OPAQUE", "message": "Type 'string' is not assignable to type 'boolean | undefined'", "site": "7:3", "absence": false, "boolean": true}], },
  { name: "lexical fresh-capture-rollback", source: `mutation complete(todoId: todos):
  item = missingOuter
  for item in ["yes"]:
    broken = { first: new, row: insert todos { title: "hi", done: false, ownerId: viewer }, bad: missingInner }
    box = { original: broken }
    update todos[todoId] { done: box.original }
    update todos[todoId] { done: item }
  return true
`, expected: [{"code": "E_QUARRY_UNKNOWN", "message": "unknown name missingOuter", "site": "2:10"}, {"code": "E_QUARRY_UNKNOWN", "message": "unknown name missingInner", "site": "4:98"}, {"code": "E_OPAQUE", "message": "Type 'string' is not assignable to type 'boolean | undefined'", "site": "7:5", "absence": false, "boolean": true}], },
  { name: "lexical merge-binder-independent", source: `mutation complete(todoId: todos):
  item = missingValue
  page = merge todos first 3 by byOwner:
    [item.ownerId] for item in todos[viewer] first 2 by byOwner
  update todos[todoId] { done: count(page) }
  return true
`, expected: [{"code": "E_QUARRY_UNKNOWN", "message": "unknown name missingValue", "site": "2:10"}, {"code": "E_OPAQUE", "message": "Type 'number' is not assignable to type 'boolean | undefined'", "site": "5:3", "absence": false, "boolean": true}], schema: `use identity

table todos:
  title: text <=200
  done: bool
  ownerId: principal
  by byOwner: ownerId, id
  read <- .ownerId = viewer
  insert <- .ownerId = viewer
  update <- .ownerId = viewer
  delete <- .ownerId = viewer
`, },
  { name: "lexical merge-binder-mismatch", source: `query probe():
  item = missingValue
  page = merge todos first 3 by byOwner:
    [item.title] for item in todos[viewer] first 2 by byOwner
  return true
`, expected: [{"code": "E_QUARRY_UNKNOWN", "message": "unknown name missingValue", "site": "2:10"}, {"code": "E_QUARRY_TYPE", "message": "merge lane key 1 is text; todos.byOwner.ownerId is principal", "site": "4:5"}], schema: `use identity

table todos:
  title: text <=200
  done: bool
  ownerId: principal
  by byOwner: ownerId, id
  read <- .ownerId = viewer
  insert <- .ownerId = viewer
  update <- .ownerId = viewer
  delete <- .ownerId = viewer
`, },
  { name: "lexical fresh-sorted-type-fact", source: `mutation complete(todoId: todos):
  item = missingValue
  (item, other) = sorted("yes", "no")
  require item else INVALID
  return true
`, expected: [{"code": "E_QUARRY_UNKNOWN", "message": "unknown name missingValue", "site": "2:10"}, {"code": "E_QUARRY_TYPE", "message": "condition requires bool, got text", "site": "4:11"}], },
  { name: "lexical failed-merge-domain", source: `query probe():
  item = missingValue
  page = merge todos first 3 by byOwner:
    [item.ownerId] for item in todos[item] first 2 by byOwner
  return missingAfter
`, expected: [{"code": "E_QUARRY_UNKNOWN", "message": "unknown name missingValue", "site": "2:10"}, {"code": "E_QUARRY_UNKNOWN", "message": "unknown name missingAfter", "site": "5:10"}], schema: `use identity

table todos:
  title: text <=200
  done: bool
  ownerId: principal
  by byOwner: ownerId, id
  read <- .ownerId = viewer
  insert <- .ownerId = viewer
  update <- .ownerId = viewer
  delete <- .ownerId = viewer
`, },
  { name: "merge domain merge-failed-domain-wrong-prefix", schema: mergeDiagnosticSchema, source: `query probe():
  item = missingValue
  page = merge todos first 3 by byOwner:
    [item.title] for item in todos[item] first 2 by byOwner
  return missingAfter
`, expected: [{"code": "E_QUARRY_UNKNOWN", "message": "unknown name missingValue", "site": "2:10"}, {"code": "E_QUARRY_UNKNOWN", "message": "unknown name missingAfter", "site": "5:10"}] },
  { name: "merge domain merge-missing-domain-wrong-prefix", schema: mergeDiagnosticSchema, source: `query probe():
  item = missingValue
  page = merge todos first 3 by byOwner:
    [item.title] for item in todos[missingDomain] first 2 by byOwner
  return missingAfter
`, expected: [{"code": "E_QUARRY_UNKNOWN", "message": "unknown name missingValue", "site": "2:10"}, {"code": "E_QUARRY_UNKNOWN", "message": "unknown name missingDomain", "site": "4:36"}, {"code": "E_QUARRY_UNKNOWN", "message": "unknown name missingAfter", "site": "5:10"}] },
  { name: "merge domain merge-missing-domain-renamed", schema: mergeDiagnosticSchema, source: `query probe():
  item = missingValue
  page = merge todos first 3 by byOwner:
    [fresh.title] for fresh in todos[missingDomain] first 2 by byOwner
  return missingAfter
`, expected: [{"code": "E_QUARRY_UNKNOWN", "message": "unknown name missingValue", "site": "2:10"}, {"code": "E_QUARRY_UNKNOWN", "message": "unknown name missingDomain", "site": "4:38"}, {"code": "E_QUARRY_UNKNOWN", "message": "unknown name missingAfter", "site": "5:10"}] },
  { name: "merge domain merge-valid-prefix-failed-domain", schema: mergeDiagnosticSchema, source: `query probe():
  item = missingValue
  page = merge todos first 3 by byOwner:
    [item.ownerId] for item in todos[item] first 2 by byOwner
  update todos["t"] { done: count(page) }
  return missingAfter
`, expected: [{"code": "E_QUARRY_UNKNOWN", "message": "unknown name missingValue", "site": "2:10"}, {"code": "E_QUARRY_UNKNOWN", "message": "queries cannot write", "site": "5:3"}, {"code": "E_QUARRY_UNKNOWN", "message": "unknown name missingAfter", "site": "6:10"}] },
  { name: "merge domain failed-domain-captured-outer", schema: mergeDiagnosticSchema, source: `query probe():
  item = missingValue
  box = { item }
  page = merge todos first 3 by byOwner:
    [item.title] for item in todos[box.item] first 2 by byOwner
  return missingAfter
`, expected: [{"code": "E_QUARRY_UNKNOWN", "message": "unknown name missingValue", "site": "2:10"}, {"code": "E_QUARRY_UNKNOWN", "message": "unknown name missingAfter", "site": "6:10"}] },
  { name: "merge domain unknown-domain-table", schema: mergeDiagnosticSchema, source: `query probe():
  page = merge todos first 3 by byOwner:
    [item.title] for item in absentTable[viewer] first 2 by byOwner
  return missingAfter
`, expected: [{"code": "E_QUARRY_UNKNOWN", "message": "unknown table absentTable", "site": "3:30"}, {"code": "E_QUARRY_UNKNOWN", "message": "unknown name missingAfter", "site": "4:10"}] },
  { name: "merge domain domain-key-type-before-prefix", schema: mergeDiagnosticSchema, source: `query probe(key: int):
  page = merge todos first 3 by byOwner:
    [item.title] for item in todos[key] first 2 by byOwner
  return missingAfter
`, expected: [{"code": "E_QUARRY_UNKNOWN", "message": "todos.byOwner expects principal for ownerId, got int", "site": "3:36"}, {"code": "E_QUARRY_UNKNOWN", "message": "unknown name missingAfter", "site": "4:10"}] },
  { name: "merge domain effectful-domain-prefix-fails", schema: mergeDiagnosticSchema, source: `query probe():
  page = merge todos first 3 by byOwner:
    [item.title] for item in todos[(todos[id = "seed"] ! else DOMAIN).ownerId] first 2 by byOwner
  return missingAfter
`, expected: [{"code": "E_QUARRY_TYPE", "message": "merge lane key 1 is text; todos.byOwner.ownerId is principal", "site": "3:5"}, {"code": "E_QUARRY_UNKNOWN", "message": "unknown name missingAfter", "site": "4:10"}] },
  { name: "merge domain second-lane-domain-fails-rollback", schema: mergeDiagnosticSchema, source: `mutation probe(todoId: todos):
  item = missingValue
  page = merge todos first 3 by byOwner:
    [a.ownerId] for a in todos[(todos[id = "seed"] ! else DOMAIN).ownerId] first 2 by byOwner
    [item.title] for item in todos[item] first 2 by byOwner
  update todos[todoId] { done: count(page) }
  update todos[todoId] { done: "yes" }
  return missingAfter
`, expected: [{"code": "E_QUARRY_UNKNOWN", "message": "unknown name missingValue", "site": "2:10"}, {"code": "E_OPAQUE", "message": "Type 'string' is not assignable to type 'boolean | undefined'", "site": "7:3", "absence": false, "boolean": true}, {"code": "E_QUARRY_UNKNOWN", "message": "unknown name missingAfter", "site": "8:10"}] },
  { name: "merge domain nested-failed-merge-restores-item", schema: mergeDiagnosticSchema, source: `mutation probe(todoId: todos):
  item = missingOuter
  for item in ["yes"]:
    page = merge todos first 3 by byOwner:
      [item.title] for item in todos[missingDomain] first 2 by byOwner
    update todos[todoId] { done: item }
  update todos[todoId] { done: item }
  return missingAfter
`, expected: [{"code": "E_QUARRY_UNKNOWN", "message": "unknown name missingOuter", "site": "2:10"}, {"code": "E_QUARRY_UNKNOWN", "message": "unknown name missingDomain", "site": "5:38"}, {"code": "E_OPAQUE", "message": "Type 'string' is not assignable to type 'boolean | undefined'", "site": "6:5", "absence": false, "boolean": true}, {"code": "E_QUARRY_UNKNOWN", "message": "unknown name missingAfter", "site": "8:10"}] },
  { name: "merge domain literal-prefix-mismatch", schema: mergeDiagnosticSchema, source: `query probe():
  page = merge todos first 3 by byOwner:
    [2]
  return missingAfter
`, expected: [{"code": "E_QUARRY_TYPE", "message": "merge lane key 1 is int; todos.byOwner.ownerId is principal", "site": "3:5"}, {"code": "E_QUARRY_UNKNOWN", "message": "unknown name missingAfter", "site": "4:10"}] },
  { name: "merge domain fresh-lane-not-in-domain", schema: mergeDiagnosticSchema, source: `query probe():
  page = merge todos first 3 by byOwner:
    [item.ownerId] for item in todos[item.ownerId] first 2 by byOwner
  return missingAfter
`, expected: [{"code": "E_QUARRY_UNKNOWN", "message": "unknown name item", "site": "3:38"}, {"code": "E_QUARRY_UNKNOWN", "message": "unknown name missingAfter", "site": "4:10"}] },
  { name: "merge domain lawful-shadow-domain", schema: mergeDiagnosticSchema, source: `query probe(item: principal):
  page = merge todos first 3 by byOwner:
    [item.ownerId] for item in todos[item] first 2 by byOwner
  return page
`, expected: [], irCounts: { '"Merge":': 1, '"table":"todos"': 2 } },
  { name: "merge domain lawful-multiple-named-cursor", schema: mergeDiagnosticSchema, source: `query probe(c: cursor ?, other: principal):
  page = merge todos after c last 3 by byOwner:
    [ownerId = viewer]
    [ownerId = item.ownerId] for item in todos[other] first 2 by byOwner
  return page { id, title }
`, expected: [], irCounts: { '"Merge":': 1, '"table":"todos"': 3, '"opaque_cursor":true': 2 } },
  { name: "merge domain lawful-domain-guard-once", schema: mergeDiagnosticSchema, source: `query probe():
  page = merge todos first 3 by byOwner:
    [item.ownerId] for item in todos[(todos[id = "seed"] ! else DOMAIN).ownerId] first 2 by byOwner
  return page
`, expected: [], irCounts: { '"Merge":': 1, '"Get":': 1, '"Require":': 1, '"table":"todos"': 3 } },
  { name: "merge domain lawful-domain-allocation-once", schema: mergeDiagnosticSchema, source: `mutation probe():
  page = merge todos first 3 by byOwner:
    [item.ownerId] for item in todos[new] first 2 by byId
  return { page, next: new }
`, expected: [], irCounts: { '"Merge":': 1, '"Input":"NewId"': 2, '"table":"todos"': 2 } },
  { name: "merge domain lawful-nullable-prefix", schema: mergeDiagnosticSchema, source: `query probe():
  page = merge todos first 3 by byOwner:
    [todos[item.id]!.ownerId] for item in todos[viewer] first 2 by byOwner
  return page
`, expected: [], irCounts: { '"Merge":': 1, '"Get":': 1, '"Require":': 1, '"table":"todos"': 3 } },
  { name: "merge domain lawful-two-discovered-lanes", schema: mergeDiagnosticSchema, source: `query probe(other: principal):
  page = merge todos first 3 by byOwner:
    [a.ownerId] for a in todos[viewer] first 2 by byOwner
    [b.ownerId] for b in todos[other] first 2 by byOwner
  return page
`, expected: [], irCounts: { '"Merge":': 1, '"table":"todos"': 4 } },
];

export function registerQuarryDiagnosticChecks(test: Test): void {
  registerDiagnosticFixChecks(test);
  for (const c of quarryDiagnosticCases) test(`Quarry diagnostic recovery: ${c.name}`, async () => {
    await withProject({ "snapback/schema.q": c.schema ?? diagnosticSchema, "snapback/todos.q": c.source }, async root => {
      const result = await lowerProject(root);
      if (!c.expected.length) {
        assert(result.ok, JSON.stringify(result));
        const ir = JSON.stringify(result.project.programs);
        for (const [needle, count] of Object.entries(c.irCounts ?? {})) {
          deepStrictEqual(occurrences(ir, needle), count, `${c.name}: ${ir}`);
        }
        return;
      }
      assert(!result.ok, "invalid project acquired executable output");
      deepStrictEqual(Object.keys(result).sort(), ["diagnostics", "ms", "ok"], "partial emission escaped the diagnostic path");
      assert(!(await readdir(root, { recursive: true })).some(path => path.startsWith(".snapback")), "refusal wrote executable artifacts");
      deepStrictEqual(result.diagnostics.length, c.expected.length, JSON.stringify(result));
      for (const wanted of c.expected) {
        const diagnostic: FrontendDiagnostic | undefined = result.diagnostics.find(item => diagnosticMatches(item, wanted));
        assert(diagnostic, JSON.stringify(result));
        if (wanted.absence !== undefined) deepStrictEqual(diagnostic.rewrite.includes("! else CODE"), wanted.absence, JSON.stringify(diagnostic));
        if (wanted.boolean) assert(diagnostic.rewrite.includes("true or false"), JSON.stringify(diagnostic));
        assert(!!diagnostic.family && !!diagnostic.guide && !!diagnostic.rewrite, "incomplete refusal envelope");
      }
    });
  });
  for (const operations of [1, 3]) test(`Quarry diagnostic recovery: ${operations} operation refusal bounds count omitted failures`, async () => {
    const source = Array.from({ length: operations }, (_, op) => `query bad${op}():\n${Array.from({ length: 26 }, (_, i) => `  x${i} = missing${i}`).join("\n")}\n  return true\n`).join("\n");
    await withProject({ "snapback/schema.q": diagnosticSchema, "snapback/todos.q": source }, async root => {
      const result = await lowerProject(root); assert(!result.ok, "unknown names compiled");
      deepStrictEqual(result.diagnostics.length, operations === 1 ? 20 : 50);
      deepStrictEqual(result.diagnostics.at(-1)?.code, "E_DIAG_TRUNCATED");
      assert(result.diagnostics.at(-1)?.message.startsWith(`…and ${operations === 1 ? 7 : 17} more`), JSON.stringify(result));
    });
  });
}

function diagnosticMatches(item: FrontendDiagnostic, wanted: Expected): boolean {
  const code = wanted.code === "E_OPAQUE" ? "E_QUARRY_TYPE" : wanted.code;
  if (item.code !== code) return false;
  if (wanted.site) {
    const line = wanted.site.split(":")[0];
    if (!item.site.startsWith(`snapback/todos.q:${line}:`)) return false;
  }
  if (wanted.code !== "E_OPAQUE") return item.message.includes(wanted.message);
  if (wanted.message.includes("string")) return item.message.includes("got text");
  if (wanted.message.includes("number")) return item.message.includes("got int");
  if (wanted.message.includes("null")) return item.message.includes("got null");
  return item.message.includes("expects");
}

// @ref LLP 1002#diagnostics-say-the-fix — fixes use the declared catalog and never hide a missing bound.
export function registerDiagnosticFixChecks(test: Test): void {
  const schema = `use identity
table conversations:
  title: text <=80
  public
table memberships:
  conversationId: conversations
  principal: principal
  unique byConversationPrincipal: conversationId, principal
  by byPrincipalConversation: principal, conversationId
  public
table posts:
  authorId: principal
  body: text <=100
  at: time
  status: enum('open', 'closed')
  by byTime: at, id
  by byAuthorTime: authorId, at, id
  public
`;
  const cases = [
    { name: "empty range needs a bound", source: "query all():\n  return posts[]", message: "`posts[]` reads a range; name its bound", fixes: ["posts[] first 50 by byTime", "posts[] first 50 by byAuthorTime"], code: "E_UNBOUND_SCAN" },
    { name: "principal prefix needs a bound", source: "query any(p: principal):\n  return memberships[p]", message: "`memberships[p]` reads a range; name its bound", fixes: ["memberships[p] first 50 by byPrincipalConversation", "principal: principal"], code: "E_UNBOUND_SCAN" },
    { name: "explicit nonunique prefix needs a bound", source: "query any(p: principal):\n  return memberships[p] by byPrincipalConversation", message: "reads a range; name its bound", fixes: ["first 50 by byPrincipalConversation"], code: "E_UNBOUND_SCAN" },
    { name: "unknown keys keep declared types", source: "query any(p: principal, flag: bool):\n  return memberships[p, flag]", message: "matches [principal, bool]", fixes: ["conversationId: conversations", "principal: principal"], code: "E_QUARRY_UNKNOWN" },
    { name: "column case typo", source: "mutation add():\n  insert posts { authorid: viewer }", message: "unknown posts field `authorid`", fixes: ["did you mean `authorId`?"], code: "E_QUARRY_TYPE" },
    { name: "index transposition", source: "query all():\n  return posts[] first 50 by byTmie", message: "has no index", fixes: ["did you mean `byTime`?"], code: "E_QUARRY_UNKNOWN" },
    { name: "enum transposition", source: "mutation add():\n  insert posts { authorId: viewer, body: 'Hi', at: now, status: 'opne' }", message: "enum literal", fixes: ["did you mean `open`?"], code: "E_QUARRY_TYPE" },
    { name: "named key column spelling", source: "query all(p: principal):\n  return posts[authorid = p] first 5 by byAuthorTime", message: "unknown posts field", fixes: ["did you mean `authorId`?"], code: "E_QUARRY_UNKNOWN" },
    { name: "table transposition", source: "query all():\n  return psots[] first 5 by byTime", message: "unknown table", fixes: ["did you mean `posts`?"], code: "E_QUARRY_UNKNOWN" },
    { name: "row column spelling", source: "query one(p: posts):\n  return posts[p].authorid", message: "unknown posts field", fixes: ["did you mean `authorId`?"], code: "E_QUARRY_TYPE" },
    { name: "fn spelling", source: "fn idnetity from access\nquery one():\n  return idnetity(1)", message: "unknown fn", fixes: ["did you mean `identity`?"], code: "E_QUARRY_UNKNOWN" },
    { name: "proc spelling", source: "proc stroe from access\nmutation one():\n  stroe()", message: "unknown proc", fixes: ["did you mean `store`?"], code: "E_QUARRY_UNKNOWN" },
    { name: "shape spelling", source: "shape crad from access\nquery one(p: posts):\n  return posts[p] crad", message: "unknown shape", fixes: ["did you mean `card`?"], code: "E_QUARRY_UNKNOWN" },
    { name: "module spelling", source: "fn identity from acceess\nquery one():\n  return identity(1)", message: "unknown fn module", fixes: ["did you mean `access`?"], code: "E_QUARRY_UNKNOWN" },
    { name: "op spelling", source: "mutation store():\n  return null\nschedule sweep every 1m:\n  stroe", message: "schedule target", fixes: ["did you mean `store`?"], code: "E_SCHEDULE_TARGET" },
    { name: "intrinsic-only range needs a bound", source: "query all():\n  return conversations[]", message: "reads a range; name its bound", fixes: ["conversations[] first 50 by byId"], code: "E_UNBOUND_SCAN" },
    { name: "distant column lists names", source: "mutation add():\n  insert posts { unrelated: viewer }", message: "unknown posts field", fixes: ["authorId", "body", "status"], code: "E_QUARRY_TYPE" },
  ];
  for (const item of cases) test(`diagnostic fix: ${item.name}`, async () => {
    await withProject({ "snapback/schema.q": schema, "snapback/posts.q": item.source + "\n",
      "snapback/access.q": "fn identity(v: int) = v\nshape card = { * }\nproc store():\n  insert posts { authorId: viewer, body: 'Hi', at: now, status: 'open' }\n",
    }, async root => {
      const result = await lowerProject(root);
      assert(!result.ok, "invalid source escaped");
      const diagnostic = result.diagnostics.find(d => d.code === item.code && d.message.includes(item.message));
      assert(diagnostic && item.fixes.every(fix => diagnostic.rewrite.includes(fix)), JSON.stringify(result));
      assert(!diagnostic.message.includes("[?]"), JSON.stringify(diagnostic));
      if (item.name.startsWith("distant")) assert(!diagnostic.rewrite.includes("did you mean"), JSON.stringify(diagnostic));
    });
  });

  test("diagnostic fix: named range lists matching ranges before exact unique choices", async () => {
    await withProject({ "snapback/schema.q": schema.replace("  by byPrincipalConversation:", "  unique byPrincipal: principal\n  by byPrincipalConversation:"),
      "snapback/posts.q": "query one(p: principal):\n  return memberships[p] by byPrincipalConversation\n" }, async root => {
      const result = await lowerProject(root);
      assert(!result.ok, "nonunique point escaped");
      const rewrite = result.diagnostics[0]!.rewrite;
      assert(rewrite.includes("memberships[p] first 50 by byPrincipalConversation; memberships[p] by byPrincipal"), rewrite);
      assert(!rewrite.includes("byConversationPrincipal"), rewrite);
    });
  });
  for (const clause of ["by byOwner: authorid", "immutable authorid", "read <- .authorid = viewer"]) {
    test(`diagnostic fix: schema column in ${clause}`, async () => {
      await withProject({ "snapback/schema.q": schema.replace("  by byTime:", `  ${clause}\n  by byTime:`).replace(/  public\n$/, ""),
        "snapback/posts.q": "query one():\n  return null\n" }, async root => {
        const result = await lowerProject(root);
        assert(!result.ok && result.diagnostics.some(d => d.rewrite.includes("did you mean `authorId`?")), JSON.stringify(result));
      });
    });
  }

}
