import type { Expr, Program, SchemaJson } from "./ir";
import { rustCheck } from "./rust-check";
import { bindQuarrySchema } from "./quarry/bound-schema";
import { bindQuarryProgram } from "./quarry/bound";
import { lowerBoundQuarryProgram } from "./quarry/direct";
import { prepareQuarry } from "./quarry/index";
import { assert, type Test } from "./quarry-check-helpers";

const schema = `table rooms:
  title: text <=50
  public

table memberships:
  room: rooms
  principal: principal
  role: text <=20
  unique byRoomPrincipal: room, principal
  by byPrincipal: principal, room, id
  by byPrincipalRole: principal, role, room, id
  cap 100 by principal
  read <- exists memberships[.room, viewer] by byRoomPrincipal

table docs:
  room: rooms
  body: text <=4000 ?
  at: time
  by bySearch: room, wordPrefixes(body), at, id
  read <- exists memberships[.room, viewer] by byRoomPrincipal
`;

const globalSearch = `query search(term: text <=2000, c: cursor ?):
  page = merge docs after c last 20 by bySearch:
    [m.room, term] for m in memberships[viewer] first 100 by byPrincipal
  return page
`;

export function registerQuarryDirectSearchEligibilityChecks(test: Test): void {
  test("direct held search preserves captured invariants and excludes every unproved lane", () => {
    const canonical = direct(globalSearch);
    const held = merge(canonical.program).held_search;
    assert(held?.table === "docs" && held.index === "bySearch" && held.suffix.join(",") === "at,id"
      && held.discovery.authorization_index === "byRoomPrincipal" && JSON.stringify(held.take) === '{"Literal":20}',
    `canonical direct held search lost its proof descriptor: ${JSON.stringify(held)}`);
    certify(canonical.program, canonical.schema, "canonical");

    const captured = direct(`query search(other: principal, term: text <=2000, c: cursor ?):
  originalViewer = viewer
  originalTerm = term
  if true:
    viewerShadow = other
    term = 'x'
    page = merge docs after c last 20 by bySearch:
      [m.room, originalTerm] for m in memberships[originalViewer] first 100 by byPrincipal
    return page
  return null
`);
    assert(merge(captured.program).held_search,
      `captured viewer/term identities lost direct held eligibility: ${JSON.stringify(captured.program)}`);
    certify(captured.program, captured.schema, "captured");

    const cases: Array<[string, string, string]> = [
      ["extra discovery pin", globalSearch.replace("memberships[viewer] first 100 by byPrincipal",
        "memberships[viewer, 'admin'] first 100 by byPrincipalRole"), schema],
      ["different principal", globalSearch.replace("term: text <=2000", "who: principal, term: text <=2000")
        .replace("memberships[viewer]", "memberships[who]"), schema],
      ["extra target rule", globalSearch, schema.replace(
        "  by bySearch: room, wordPrefixes(body), at, id\n  read <- exists memberships[.room, viewer] by byRoomPrincipal",
        "  by bySearch: room, wordPrefixes(body), at, id\n  read <- exists memberships[.room, viewer] by byRoomPrincipal and .body = 'x'")],
      ["unproved discovery authority", globalSearch, schema.replace(
        "read <- exists memberships[.room, viewer] by byRoomPrincipal",
        "read <- .role = 'admin'")],
      ["row-dependent term", globalSearch.replace("[m.room, term]", "[m.room, m.role]"), schema],
      ["lane setup read", globalSearch.replace("[m.room, term]", "[m.room, docs[term]!.body!]")
        .replace("term: text <=2000", "term: docs"), schema],
      ["extra fixed lane", globalSearch.replace("  return page", "    ['room-other', term]\n  return page"), schema],
      ["captured outer scope", `query search(member: memberships, term: text <=2000, c: cursor ?):
  outer = memberships[member]!
  room = outer.room
  page = merge docs after c last 20 by bySearch:
    [room, term] for m in memberships[viewer] first 100 by byPrincipal
  return page
`, schema],
    ];
    for (const [label, source, schemaSource] of cases) {
      const lowered = direct(source, schemaSource);
      assert(!merge(lowered.program).held_search,
        `${label} acquired a direct held-search proof: ${JSON.stringify(lowered.program)}`);
    }
  });
}

function direct(source: string, schemaSource = schema): { program: Program; schema: SchemaJson } {
  const prepared = prepareQuarry([
    { path: "/virtual/snapback/schema.q", fileName: "snapback/schema.q", source: schemaSource },
    { path: "/virtual/snapback/search.q", fileName: "snapback/search.q", source },
  ]);
  assert(prepared.ok, `direct held-search fixture did not prepare: ${JSON.stringify(prepared.ok ? [] : prepared.diagnostics)}`);
  const declaration = prepared.prepared.documents[1]!.programs[0]!;
  return {
    program: lowerBoundQuarryProgram(bindQuarryProgram(
      declaration, prepared.prepared.catalog, prepared.prepared.documents)),
    schema: bindQuarrySchema(prepared.prepared.documents, prepared.prepared.catalog),
  };
}

function merge(program: Program): Extract<Expr, { Merge: unknown }>["Merge"] {
  const found = find<Extract<Expr, { Merge: unknown }>["Merge"]>(program, "Merge")[0];
  assert(found, `direct search program has no Merge: ${JSON.stringify(program)}`);
  return found;
}

function find<T>(value: unknown, tag: string): T[] {
  if (!value || typeof value !== "object") return [];
  const object = value as Record<string, unknown>;
  return [...(tag in object ? [object[tag] as T] : []), ...Object.values(object).flatMap((item) => find<T>(item, tag))];
}

function certify(program: Program, schemaJson: SchemaJson, label: string): void {
  const checked = rustCheck([program], "synthetic", schemaJson)[0]!;
  assert(!checked.error && checked.certificate,
    `${label} direct held search did not certify: ${JSON.stringify(checked)}`);
}
