//! LLP 3000.036.001 §7: a merged page runs the same plan on a device, over
//! both stores, with the existing per-scan coverage rules. Each test compares
//! the device's answer, walked to its end by cursor, with the server's.
mod common;
use common::*;
use serde_json::{Value as Json, json};
use snapback4_core::{Value, value::object};

fn row(table: &str, fields: Vec<(&str, Value)>) -> (String, Value) { (table.to_owned(), object(fields)) }

/// Every page by cursor: ids, and whether each page was complete; the device
/// side also reports whether any page was unknown.
fn walk_server(engine: &mut snapback4_core::Engine, op: &str, viewer: &str, extra: &[(&str, Value)]) -> (Vec<String>, bool) {
    let mut cursor = Value::Null;
    let (mut ids, mut complete) = (Vec::new(), true);
    loop {
        let mut pairs: Vec<(&str, Value)> = extra.to_vec();
        pairs.push(("c", cursor.clone()));
        let out = engine.query(op, context(viewer, &pairs)).unwrap();
        ids.extend(out.data.as_array().unwrap().iter().map(|r| r.field("id").unwrap().as_str().unwrap().to_owned()));
        complete &= out.complete;
        match out.next { Some(next) => cursor = Value::String(next), None => return (ids, complete) }
    }
}

fn walk_device<S: snapback4_device::store::DeviceStore>(device: &mut snapback4_device::device::Device<S>, op: &str, viewer: &str, extra: Json) -> (Vec<String>, bool, bool) {
    let mut cursor = Json::Null;
    let (mut ids, mut complete, mut unknown) = (Vec::new(), true, false);
    loop {
        let mut args = extra.clone();
        args["c"] = cursor.clone();
        let (out, missing, _) = device.query_with_coverage(op, viewer, &args, 1_000);
        let out = out.unwrap();
        ids.extend(out.data.as_array().unwrap().iter().map(|r| r.field("id").unwrap().as_str().unwrap().to_owned()));
        complete &= out.complete;
        unknown |= missing;
        match out.next { Some(next) => cursor = Json::String(next), None => return (ids, complete, unknown) }
    }
}

const BOARDS: &str = "table members:
  board: int
  principal: principal
  unique board, principal
  read <- .principal = viewer
  insert <- deny
  sync to .principal

table cards:
  board: int
  at: int
  read <- exists members[.board, viewer]
  insert <- exists members[.board, viewer]
  sync to members[.board]

query two(a: int, b: int, c: cursor ?):
  return cards where .board = a or .board = b last 2 by .at after c
query one(a: int, c: cursor ?):
  return cards where .board = a last 2 by .at after c
";

fn boards<H: Host>(host: &mut H) {
    let (mut engine, backend) = compile(BOARDS);
    let bound = snapback4_lang::compile(&[("schema.q".into(), BOARDS.into())]);
    let two = bound.programs.iter().find(|p| p.program.name == "two").unwrap();
    assert!(snapback4_core::search_plan::merges(&two.program.body).iter().any(|m| m.branches()), "the page is a branch merge");
    let mut rows = vec![row("members", vec![("id", id("m1")), ("board", Value::Int(1)), ("principal", id("ann"))]),
        row("members", vec![("id", id("m2")), ("board", Value::Int(2)), ("principal", id("ann"))])];
    for n in 0..9i64 { rows.push(row("cards", vec![("id", id(&format!("c{n}"))), ("board", Value::Int(n % 3 + 1)), ("at", Value::Int(n))])); }
    engine.seed(rows).unwrap();
    let mut device = host.open("boards", Some(backend)).unwrap();
    for (n, page) in snapshot_pages(&mut engine, "ann", 4).iter().enumerate() { device.apply(page, n == 0).unwrap(); }
    host.close("boards", device);
    let mut device = host.open("boards", None).unwrap();
    // Two held groups: the device answers the server's rows, complete, without asking.
    let server = walk_server(&mut engine, "two", "ann", &[("a", Value::Int(1)), ("b", Value::Int(2))]);
    assert_eq!(server, (vec!["c7".into(), "c6".into(), "c4".into(), "c3".into(), "c1".into(), "c0".into()], true));
    let held = walk_device(&mut device, "two", "ann", json!({"a": 1, "b": 2}));
    assert_eq!((held.0.clone(), held.1, held.2), (server.0.clone(), true, false), "{}", host.label());
    // A group the caller is not in: the merged page's branch answers as the
    // direct page on that group does, on the server and on the device.
    let server = walk_server(&mut engine, "two", "ann", &[("a", Value::Int(1)), ("b", Value::Int(3))]);
    let direct = walk_device(&mut device, "one", "ann", json!({"a": 3}));
    let merged = walk_device(&mut device, "two", "ann", json!({"a": 1, "b": 3}));
    assert_eq!(server.0, vec!["c6", "c3", "c0"]);
    assert_eq!(merged.0, server.0, "{}", host.label());
    assert_eq!((merged.1, merged.2), (direct.1 && server.1, direct.2), "{}: the merge keeps the direct page's coverage", host.label());
}

#[test]
fn sqlite_branch_merge_over_held_groups() { boards(&mut Sqlite::new("branch-boards")); }
#[test]
fn memory_branch_merge_over_held_groups() { boards(&mut Memory::new()); }

const SEATS: &str = "table tickets:
  owner: principal
  at: int
  read <- .owner = viewer or viewer = 'service:audit'
  insert <- .owner = viewer
  sync to .owner

query tickets(c: cursor ?):
  return tickets last 2 by .at after c
";

/// A seat (`viewer = 'service:x'`) is decided on a device: the owner branch
/// reads the held partition and the page is complete there too.
fn seats<H: Host>(host: &mut H) {
    let (mut engine, backend) = compile(SEATS);
    let bound = snapback4_lang::compile(&[("schema.q".into(), SEATS.into())]);
    let p = bound.programs.iter().find(|p| p.program.name == "tickets").unwrap();
    assert!(snapback4_core::search_plan::merges(&p.program.body).iter().any(|m| m.branches() && m.lanes.iter().any(|l| l.grant())));
    let mut rows = Vec::new();
    for n in 0..7i64 { rows.push(row("tickets", vec![("id", id(&format!("k{n}"))), ("owner", id(if n % 2 == 0 { "ann" } else { "bob" })), ("at", Value::Int(n))])); }
    engine.seed(rows).unwrap();
    let mut device = host.open("seats", Some(backend)).unwrap();
    for (n, page) in snapshot_pages(&mut engine, "ann", 3).iter().enumerate() { device.apply(page, n == 0).unwrap(); }
    let server = walk_server(&mut engine, "tickets", "ann", &[]);
    assert_eq!(server, (vec!["k6".into(), "k4".into(), "k2".into(), "k0".into()], true));
    let held = walk_device(&mut device, "tickets", "ann", json!({}));
    assert_eq!((held.0, held.1, held.2), (server.0, true, false), "{}", host.label());
    let audit = walk_server(&mut engine, "tickets", "service:audit", &[]);
    assert_eq!(audit.0.len(), 7);
    assert!(audit.1);
}

#[test]
fn sqlite_a_seat_branch_is_decided_on_a_device() { seats(&mut Sqlite::new("branch-seats")); }
#[test]
fn memory_a_seat_branch_is_decided_on_a_device() { seats(&mut Memory::new()); }

const ONLINE: &str = "table staff:
  principal: principal
  unique principal
  read <- .principal = viewer
  insert <- deny
  online only

table tickets:
  owner: principal
  helper: principal ?
  at: int
  read <- .owner = viewer or .helper = viewer or exists staff[viewer]
  insert <- .owner = viewer
  online only

query tickets(c: cursor ?):
  return tickets last 2 by .at after c
";

/// An online-only table and a role grant: the device does not answer either;
/// the read is unknown and the client asks the server (LLP 3000.028).
fn online<H: Host>(host: &mut H) {
    let (mut engine, backend) = compile(ONLINE);
    engine.seed(vec![row("tickets", vec![("id", id("k1")), ("owner", id("ann")), ("helper", Value::Null), ("at", Value::Int(1))])]).unwrap();
    let mut device = host.open("online", Some(backend)).unwrap();
    for (n, page) in snapshot_pages(&mut engine, "ann", 3).iter().enumerate() { device.apply(page, n == 0).unwrap(); }
    let (out, unknown, _) = device.query_with_coverage("tickets", "ann", &json!({"c": null}), 1_000);
    let out = out.unwrap();
    assert!(unknown && !out.complete, "{}: {out:?}", host.label());
    let server = walk_server(&mut engine, "tickets", "ann", &[]);
    assert_eq!(server, (vec!["k1".into()], true));
}

#[test]
fn sqlite_online_branches_ask_the_server() { online(&mut Sqlite::new("branch-online")); }
#[test]
fn memory_online_branches_ask_the_server() { online(&mut Memory::new()); }

const OWNER_MEMBERSHIP: &str = "table memberships:
  parent: text <=40
  principal: principal
  unique parent, principal
  cap 16 by principal
  read <- .principal = viewer
  insert <- .principal = viewer and exists memberships[.parent, viewer]
  sync to .principal

table documents:
  owner: principal
  parent: text <=40
  at: int
  read <- .owner = viewer or exists memberships[.parent, viewer]
  insert <- .owner = viewer
  sync to .owner or memberships[.parent]

query documents(c: cursor ?):
  return documents last 2 by .at after c
";

// @ref LLP 3000.036.001#14 — acquired source and union target ranges run the same dynamic merge on both device stores.
fn owner_membership<H: Host>(host: &mut H) {
    let (mut engine, backend) = compile(OWNER_MEMBERSHIP);
    let bound = snapback4_lang::compile(&[("schema.q".into(), OWNER_MEMBERSHIP.into())]);
    let program = &bound.programs.iter().find(|p| p.program.name == "documents").unwrap().program;
    assert!(snapback4_core::ir::body_merges(&program.body).iter().any(|merge| merge.lanes.iter().any(|lane| lane.membership())));
    engine.seed(vec![
        row("memberships", vec![("id", id("m1")), ("parent", Value::String("p1".into())), ("principal", id("ann"))]),
        row("memberships", vec![("id", id("m2")), ("parent", Value::String("p2".into())), ("principal", id("ann"))]),
        row("documents", vec![("id", id("d1")), ("owner", id("ann")), ("parent", Value::String("p0".into())), ("at", Value::Int(1))]),
        row("documents", vec![("id", id("d2")), ("owner", id("bob")), ("parent", Value::String("p9".into())), ("at", Value::Int(2))]),
        row("documents", vec![("id", id("d3")), ("owner", id("ann")), ("parent", Value::String("p1".into())), ("at", Value::Int(3))]),
        row("documents", vec![("id", id("d4")), ("owner", id("bob")), ("parent", Value::String("p1".into())), ("at", Value::Int(4))]),
        row("documents", vec![("id", id("d5")), ("owner", id("bob")), ("parent", Value::String("p2".into())), ("at", Value::Int(5))]),
    ]).unwrap();
    let server = walk_server(&mut engine, "documents", "ann", &[]);
    assert_eq!(server, (vec!["d5".into(), "d4".into(), "d3".into(), "d1".into()], true));

    let mut missing = host.open("owner-membership-missing", Some(backend.clone())).unwrap();
    let (out, unknown, _) = missing.query_with_coverage("documents", "ann", &json!({"c": null}), 1_000);
    assert_eq!(out.unwrap_err().code, "E_PREDICT", "{}: {unknown}", host.label());

    let mut device = host.open("owner-membership", Some(backend)).unwrap();
    for (n, page) in snapshot_pages(&mut engine, "ann", 2).iter().enumerate() { device.apply(page, n == 0).unwrap(); }
    let held = walk_device(&mut device, "documents", "ann", json!({}));
    assert_eq!((held.0, held.1, held.2), (server.0, true, false), "{}", host.label());
}

#[test]
fn sqlite_owner_membership_pages_use_acquired_groups() { owner_membership(&mut Sqlite::new("branch-owner-membership")); }
#[test]
fn memory_owner_membership_pages_use_acquired_groups() { owner_membership(&mut Memory::new()); }

const SINGLE_OWNER_MEMBERSHIP: &str = "table groups:
  principal: principal
  unique principal
  cap 16 by principal
  read <- .principal = viewer
  online only

table documents:
  owner: principal
  parent: groups
  at: int
  read <- .owner = viewer or exists groups[id = .parent, principal = viewer]
  online only

query documents(c: cursor ?):
  return documents last 2 by .at after c
";

// @ref LLP 3000.036.001#14 — a fully pinned total-unique online source remains incomplete on both device stores.
fn single_owner_membership<H: Host>(host: &mut H) {
    let (mut engine, backend) = compile(SINGLE_OWNER_MEMBERSHIP);
    let bound = snapback4_lang::compile(&[("schema.q".into(), SINGLE_OWNER_MEMBERSHIP.into())]);
    assert!(snapback4_core::ir::body_merges(&bound.programs[0].program.body)
        .into_iter().any(|merge| merge.lanes.iter().any(|lane| lane.membership())));
    engine.seed(vec![
        row("groups", vec![("id", id("g0")), ("principal", id("bob"))]),
        row("groups", vec![("id", id("g1")), ("principal", id("ann"))]),
        row("documents", vec![("id", id("owned")), ("owner", id("ann")), ("parent", id("g0")), ("at", Value::Int(1))]),
        row("documents", vec![("id", id("shared")), ("owner", id("bob")), ("parent", id("g1")), ("at", Value::Int(2))]),
        row("documents", vec![("id", id("hidden")), ("owner", id("bob")), ("parent", id("g0")), ("at", Value::Int(3))]),
    ]).unwrap();
    let server = walk_server(&mut engine, "documents", "ann", &[]);
    assert_eq!(server, (vec!["shared".into(), "owned".into()], true));

    let mut missing = host.open("single-owner-membership-missing", Some(backend.clone())).unwrap();
    let (out, unknown, _) = missing.query_with_coverage("documents", "ann", &json!({"c": null}), 1_000);
    let out = out.unwrap();
    assert!(unknown && !out.complete && out.next.is_none() && out.data.as_array().unwrap().is_empty());

    let mut device = host.open("single-owner-membership", Some(backend)).unwrap();
    for (n, page) in snapshot_pages(&mut engine, "ann", 2).iter().enumerate() { device.apply(page, n == 0).unwrap(); }
    let (out, unknown, _) = device.query_with_coverage("documents", "ann", &json!({"c": null}), 1_000);
    let out = out.unwrap();
    assert!(unknown && !out.complete && out.data.as_array().unwrap().is_empty(), "{}: {out:?}", host.label());
}

#[test]
fn sqlite_total_unique_membership_source_uses_implicit_id() { single_owner_membership(&mut Sqlite::new("single-owner-membership")); }
#[test]
fn memory_total_unique_membership_source_uses_implicit_id() { single_owner_membership(&mut Memory::new()); }

fn owner_membership_rows(expired: bool) -> Vec<(String, Value)> {
    let membership = |name: &str, parent: &str, until: Value| {
        row(
            "memberships",
            vec![
                ("id", id(name)),
                ("parent", Value::String(parent.into())),
                ("principal", id("ann")),
                ("until", until),
            ],
        )
    };
    vec![
        membership(
            "m1",
            "p1",
            if expired { Value::Int(1) } else { Value::Null },
        ),
        membership("m2", "p2", Value::Null),
        row(
            "documents",
            vec![
                ("id", id("d1")),
                ("owner", id("ann")),
                ("parent", Value::String("p0".into())),
                ("at", Value::Int(1)),
            ],
        ),
        row(
            "documents",
            vec![
                ("id", id("d3")),
                ("owner", id("ann")),
                ("parent", Value::String("p1".into())),
                ("at", Value::Int(3)),
            ],
        ),
        row(
            "documents",
            vec![
                ("id", id("d4")),
                ("owner", id("bob")),
                ("parent", Value::String("p1".into())),
                ("at", Value::Int(4)),
            ],
        ),
        row(
            "documents",
            vec![
                ("id", id("d5")),
                ("owner", id("bob")),
                ("parent", Value::String("p2".into())),
                ("at", Value::Int(5)),
            ],
        ),
    ]
}

fn owner_membership_rows_without_expiry() -> Vec<(String, Value)> {
    owner_membership_rows(false)
        .into_iter()
        .map(|(table, mut value)| {
            if table == "memberships"
                && let Value::Row(fields) = &mut value
            {
                fields.remove("until");
            }
            (table, value)
        })
        .collect()
}

fn apply_snapshot<S: snapback4_device::store::DeviceStore>(
    device: &mut snapback4_device::device::Device<S>,
    pages: &[snapback4_device::device::StreamPage],
) {
    for (n, page) in pages.iter().enumerate() {
        device.apply(page, n == 0).unwrap();
    }
}

/// Expired, unswept membership rows cannot create target lanes. A partial
/// source discovery returns no local prefix. PAGE target sync is necessarily
/// a horizon-free union (the compiler refuses a window or retained history on
/// a union), so its device fallback is the existing all-unacquired case.
// @ref LLP 3000.036.001#14 — PAGE uses live memberships and a complete source discovery.
fn owner_membership_boundaries<H: Host>(host: &mut H) {
    let expiring = OWNER_MEMBERSHIP
        .replace("  principal: principal\n  unique", "  principal: principal\n  until: time ?\n  by byExpiry: until\n  expire at .until\n  unique")
        .replace("read <- .owner = viewer or exists memberships[.parent, viewer]",
            "read <- .owner = viewer or exists memberships[id = 'm1', parent = .parent, principal = viewer]")
        .replace("  sync to .principal", "  online only")
        .replace("  sync to .owner or memberships[.parent]", "  online only");
    let (mut engine, backend) = compile(&expiring);
    engine.seed(owner_membership_rows(true)).unwrap();
    let server = walk_server(&mut engine, "documents", "ann", &[]);
    assert_eq!(server, (vec!["d3".into(), "d1".into()], true));
    let pages = snapshot_pages(&mut engine, "ann", 2);
    assert!(
        pages
            .iter()
            .flat_map(|page| &page.events)
            .all(|event| event.table != "memberships" && event.table != "documents")
    );
    let mut device = host.open("owner-membership-expiry", Some(backend)).unwrap();
    apply_snapshot(&mut device, &pages);
    let (out, unknown, _) =
        device.query_with_coverage("documents", "ann", &json!({"c": null}), 1_000);
    let out = out.unwrap();
    assert!(
        unknown && !out.complete && out.data.as_array().unwrap().is_empty(),
        "{}: an expiring online membership source falls back: {out:?}",
        host.label()
    );

    let source_horizon = OWNER_MEMBERSHIP
        .replace(
            "  unique parent, principal",
            "  unique parent, principal\n  by byPrincipalParent: principal, parent, id",
        )
        .replace("read <- .owner = viewer or exists memberships[.parent, viewer]",
            "read <- .owner = viewer or exists memberships[id = 'm1', parent = .parent, principal = viewer]")
        .replace(
            "  sync to .principal",
            "  sync to .principal last 1 by byPrincipalParent",
        )
        .replace("  sync to .owner or memberships[.parent]", "  online only");
    let (mut engine, backend) = compile(&source_horizon);
    engine.seed(owner_membership_rows_without_expiry()).unwrap();
    let pages = snapshot_pages(&mut engine, "ann", 2);
    assert!(
        pages
            .iter()
            .flat_map(|page| &page.acquisitions)
            .any(|marker| marker.table == "memberships"
                && marker
                    .floor
                    .as_deref()
                    .is_some_and(|floor| floor != "whole"))
    );
    let mut device = host
        .open("owner-membership-source-horizon", Some(backend))
        .unwrap();
    apply_snapshot(&mut device, &pages);
    let (out, unknown, _) =
        device.query_with_coverage("documents", "ann", &json!({"c": null}), 1_000);
    let out = out.unwrap();
    assert!(
        unknown && !out.complete && out.next.is_none() && out.data.as_array().unwrap().is_empty(),
        "{}: discovery must finish before PAGE emits: {out:?}",
        host.label()
    );
}

#[test]
fn sqlite_owner_membership_expiry_and_source_horizon() {
    owner_membership_boundaries(&mut Sqlite::new("branch-owner-membership-boundaries"));
}
#[test]
fn memory_owner_membership_expiry_and_source_horizon() {
    owner_membership_boundaries(&mut Memory::new());
}

const PAGE3_ROLE_UNION: &str = "table staff:
  principal: principal
  unique principal
  read <- .principal = viewer
  insert <- deny
  delete <- deny
  online only
table tickets:
  owner: principal
  at: int
  read <- .owner = viewer or exists staff[viewer]
  sync
query tickets(c: cursor ?):
  return tickets first 1 by .at after c
";
fn page3_role_union<H: Host>(host: &mut H) {
    for viewer in ["ann", "sam", "erin"] {
        let (mut engine, backend) = compile(PAGE3_ROLE_UNION);
        engine.seed(vec![row("staff", vec![("id", id("s")), ("principal", id("sam"))]),
            row("tickets", vec![("id", id("a")), ("owner", id("ann")), ("at", Value::Int(1))]),
            row("tickets", vec![("id", id("b")), ("owner", id("bob")), ("at", Value::Int(2))]),
            row("tickets", vec![("id", id("c")), ("owner", id("ann")), ("at", Value::Int(3))])]).unwrap();
        assert!(backend.schema.required_capabilities().contains("branch-pages-v2"));
        let key = format!("page3-{viewer}");
        let mut device = host.open(&key, Some(backend)).unwrap();
        let (_, missing, _) = device.query_with_coverage("tickets", viewer, &json!({"c": null}), 1_000);
        assert!(missing, "{}: unacquired union is unknown", host.label());
        for (n, page) in snapshot_pages(&mut engine, viewer, 2).iter().enumerate() { device.apply(page, n == 0).unwrap(); }
        let server = walk_server(&mut engine, "tickets", viewer, &[]);
        let held = walk_device(&mut device, "tickets", viewer, json!({}));
        assert_eq!((held.0, held.1, held.2), (server.0.clone(), true, false), "{} {viewer}", host.label());
        // The grant roster is online only: completeness came from the acquired
        // union, without a device role probe. Server/device cursors interoperate.
        let first = engine.query("tickets", context(viewer, &[("c", Value::Null)])).unwrap();
        if let Some(next) = first.next {
            let (continued, missing, _) = device.query_with_coverage("tickets", viewer, &json!({"c": next}), 1_000);
            assert!(!missing); assert!(continued.unwrap().complete);
        }
        host.close(&key, device);
        let mut device = host.open(&key, None).unwrap();
        let again = walk_device(&mut device, "tickets", viewer, json!({}));
        assert_eq!((again.0, again.1, again.2), (server.0, true, false));
        host.close(&key, device);
    }
}
#[test]
fn memory_page3_role_union_keeps_complete_acquired_pages() { page3_role_union(&mut Memory::new()); }
#[test]
fn sqlite_page3_role_union_keeps_complete_acquired_pages() { page3_role_union(&mut Sqlite::new("page3-role-union")); }

#[test]
fn memory_page3_pure_membership_keeps_source_acquisition_fence() {
    let source = OWNER_MEMBERSHIP.replace(".owner = viewer or exists memberships[.parent, viewer]", "exists memberships[.parent, viewer]").replace("sync to .owner or memberships[.parent]", "sync to memberships[.parent]");
    let (mut engine, backend) = compile(&source);
    engine.seed(vec![row("memberships", vec![("id", id("m")), ("parent", Value::String("p1".into())), ("principal", id("ann"))]),
        row("documents", vec![("id", id("d")), ("parent", Value::String("p1".into())), ("owner", id("bob")), ("at", Value::Int(1))])]).unwrap();
    let mut host = Memory::new(); let mut device = host.open("page3-pure", Some(backend)).unwrap();
    for (n, page) in snapshot_pages(&mut engine, "ann", 2).iter().enumerate() { device.apply(page, n == 0).unwrap(); }
    assert_eq!(walk_device(&mut device, "documents", "ann", json!({})), (vec!["d".into()], true, false));
}

// @ref LLP 3000.036.001#17 — exact W narrows a union to its membership
// audience; acquired sources/targets and both stores keep the shared cursor.
fn page4_scoped<H: Host>(host: &mut H) {
    let source=include_str!("../../snapback4-lang/tests/fixtures/page4-union.q")
        .replace("  online only\ntable docs:","  sync to .principal\ntable docs:")
        .replace(".owner = viewer or .open = true or exists members[.group, viewer]", ".owner = viewer or exists members[.group, viewer]")
        .replace("  online only\nquery list", "  sync to .owner or members[.group]\nquery list");
    for viewer in ["ann","bob","erin"] {
        let (mut engine,backend)=compile(&source);
        engine.seed(vec![row("members",vec![("id",id("m")),("group",Value::Int(2)),("principal",id("ann"))]),
            row("docs",vec![("id",id("a")),("group",Value::Int(1)),("owner",id("ann")),("open",Value::Bool(false)),("at",Value::Int(1))]),
            row("docs",vec![("id",id("b")),("group",Value::Int(2)),("owner",id("bob")),("open",Value::Bool(false)),("at",Value::Int(2))]),
            row("docs",vec![("id",id("c")),("group",Value::Int(2)),("owner",id("ann")),("open",Value::Bool(false)),("at",Value::Int(3))])]).unwrap();
        let key=format!("page4-{viewer}");let mut device=host.open(&key,Some(backend)).unwrap();
        let (_,missing,_)=device.query_with_coverage("scoped",viewer,&json!({"c":null}),1000);assert!(missing);
        for (n,page) in snapshot_pages(&mut engine,viewer,2).iter().enumerate() {device.apply(page,n==0).unwrap();}
        let expected=walk_server(&mut engine,"scoped",viewer,&[]);
        let actual=walk_device(&mut device,"scoped",viewer,json!({}));
        assert_eq!(actual,(expected.0.clone(),true,false),"{} {viewer}",host.label());
        let first=engine.query("scoped",context(viewer,&[("c",Value::Null)])).unwrap();
        if let Some(cursor)=first.next {let (page,missing,_)=device.query_with_coverage("scoped",viewer,&json!({"c":cursor}),1000);assert!(!missing&&page.unwrap().complete);}
        host.close(&key,device);let mut device=host.open(&key,None).unwrap();
        assert_eq!(walk_device(&mut device,"scoped",viewer,json!({})),(expected.0,true,false));host.close(&key,device);
    }
}
#[test]
fn memory_page4_exact_scope_uses_complete_acquired_discovery() {page4_scoped(&mut Memory::new());}
#[test]
fn sqlite_page4_exact_scope_uses_complete_acquired_discovery() {page4_scoped(&mut Sqlite::new("page4-scoped"));}

fn page4_online<H: Host>(host: &mut H) {
    let source=include_str!("../../snapback4-lang/tests/fixtures/page4-union.q");
    let (_,backend)=compile(source);let mut device=host.open("page4-online",Some(backend)).unwrap();
    for query in ["list","scoped"] {let (out,unknown,_)=device.query_with_coverage(query,"ann",&json!({"c":null}),1000);
        let out=out.unwrap();assert!(unknown&&!out.complete&&out.next.is_none(),"{} {query}: {out:?}",host.label());}
}
#[test]
fn memory_page4_public_member_union_does_not_invent_offline_coverage() {page4_online(&mut Memory::new());}
#[test]
fn sqlite_page4_public_member_union_does_not_invent_offline_coverage() {page4_online(&mut Sqlite::new("page4-online"));}
