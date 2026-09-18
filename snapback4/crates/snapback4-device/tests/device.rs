//! The device against a real server engine, on both hosts: SQLite as a
//! native host keeps it, and memory as the web keeps it (each commit's
//! changes handed back on the next open). One scenario, two runs.

mod common;
mod papercuts;
mod language;
mod membership;
mod search_merge;
mod search_global;
mod read_cut;
mod presence;
mod upsert;
mod following;
mod maintains;
mod merge_cursor;
mod merge_continuation;
mod store_reset;
mod acquisition;
mod trending;
mod receipt_history;
mod guide_examples;
mod prefix_reads;
mod lane_domains;
mod time_indexes;

use common::*;
use snapback4_core::engine::WriteState;
use snapback4_core::value::Value;
use snapback4_device::call::call;
use snapback4_device::device::Queued;

fn on_both(scenario: impl Fn(&mut dyn HostDyn)) {
    scenario(&mut Sqlite::new("suite"));
    scenario(&mut Memory::new());
}

/// The scenarios are written once over this object-safe view of a host:
/// open, close, and the calls a test makes through one JSON dispatcher.
pub trait HostDyn {
    fn label(&self) -> &'static str;
    fn open(&mut self, name: &str, backend: Option<snapback4_device::device::Backend>) -> Result<Box<dyn AnyDevice + '_>, snapback4_core::error::RuntimeError>;
}

/// A device of either store, reached through the dispatcher and a few
/// typed doors the scenarios lean on.
pub trait AnyDevice {
    fn call(&mut self, request: serde_json::Value) -> serde_json::Value;
    fn close(self: Box<Self>);
}

struct Held<'a, H: Host> {
    host: &'a mut H,
    name: String,
    device: Option<snapback4_device::device::Device<H::Store>>,
}

impl<H: Host> AnyDevice for Held<'_, H> {
    fn call(&mut self, request: serde_json::Value) -> serde_json::Value {
        let device = self.device.as_mut().expect("open");
        if request["op"] == "query" && let Some(name) = request["name"].as_str()
            && device.schema().operations.get(name).is_some_and(|fact| !fact.components.is_empty()) {
            let viewer = request["viewer"].as_str().unwrap();
            let now = request["now"].as_i64().unwrap_or(0);
            let (framed, unknown, retained, _) = device.query_with_components(name, viewer, &request["args"], now);
            let whole = device.query_with_coverage(name, viewer, &request["args"], now);
            assert_eq!((framed, unknown, retained), whole, "{name}: full outcome and meter with and without component observation");
            println!("component differential device: {name}: whole outcome and meter equal");
        }
        if matches!(request["op"].as_str(), Some("apply" | "observe_store")) {
            snapback4_device::call::call_text(device, &request.to_string())
        } else { call(device, request) }
    }
    fn close(mut self: Box<Self>) {
        let device = self.device.take().expect("open");
        self.host.close(&self.name, device);
    }
}

impl<H: Host> Drop for Held<'_, H> {
    fn drop(&mut self) {
        if let Some(device) = self.device.take() {
            self.host.close(&self.name, device);
        }
    }
}

impl<H: Host> HostDyn for H {
    fn label(&self) -> &'static str {
        Host::label(self)
    }
    fn open(&mut self, name: &str, backend: Option<snapback4_device::device::Backend>) -> Result<Box<dyn AnyDevice + '_>, snapback4_core::error::RuntimeError> {
        let device = Host::open(self, name, backend)?;
        Ok(Box::new(Held { host: self, name: name.to_owned(), device: Some(device) }))
    }
}

#[track_caller]
fn ok(answer: serde_json::Value) -> serde_json::Value {
    assert!(answer.get("denied").is_none(), "{answer}");
    answer["ok"].clone()
}

fn query(device: &mut dyn AnyDevice, name: &str, viewer: &str, args: serde_json::Value, now: i64) -> serde_json::Value {
    ok(device.call(serde_json::json!({ "op": "query", "name": name, "viewer": viewer, "args": args, "now": now })))
}

#[track_caller]
fn rows(read: &serde_json::Value) -> &Vec<serde_json::Value> {
    match read["data"].as_array() {
        Some(rows) => rows,
        None => panic!("{read}"),
    }
}

fn apply(device: &mut dyn AnyDevice, page: &snapback4_device::device::StreamPage, first: bool) -> serde_json::Value {
    // Serialization-only apply fixture. The caller supplies the page and its
    // receipts; this does not simulate a sync request or invent a declaration.
    let page = page_json(page);
    device.call(serde_json::json!({ "op": "apply", "page": page, "first": first }))
}

fn snapshot_pages_at(
    engine: &mut snapback4_core::Engine,
    principal: &str,
    limit: usize,
    now: i64,
) -> Vec<snapback4_device::device::StreamPage> {
    let mut pages = Vec::new();
    let mut after: Option<String> = None;
    loop {
        let page = engine.snapshot_acquisition_page_at(principal, after.as_deref(), limit, now).unwrap();
        let (events, watermark, next) = (page.events, page.watermark, page.next.map(|next| next.encode()));
        let more = next.is_some();
        pages.push(
            serde_json::from_value(serde_json::json!({
                "snapshot": true, "after": after, "acquisitions": page.acquisitions,
                "events": events.iter().map(|event| serde_json::json!({
                    "table": event.table,
                    "kind": event.kind.word(),
                    "id": event.id,
                    "data": event.data.as_ref().map(snapback4_core::wire::to_json),
                })).collect::<Vec<_>>(),
                "watermark": watermark,
                "more": more,
                "next": next,
                "generation": engine.generation(),
            }))
            .unwrap(),
        );
        match next {
            Some(next) => after = Some(next),
            None => return pages,
        }
    }
}

fn stream_page_at(
    engine: &mut snapback4_core::Engine,
    principal: &str,
    watermark: u64,
    now: i64,
) -> snapback4_device::device::StreamPage {
    let page = engine.stream_at(principal, watermark, 1_000, now).unwrap();
    serde_json::from_value(serde_json::json!({
        "snapshot": false, "images_at": page.images_at, "acquisitions": page.acquisitions,
        "events": page.events.iter().map(|event| serde_json::json!({
            "table": event.table,
            "kind": event.kind,
            "id": event.id,
            "data": event.data.as_ref().map(snapback4_core::wire::to_json),
        })).collect::<Vec<_>>(),
        "watermark": page.watermark,
        "more": page.more,
        "generation": engine.generation(),
    }))
    .unwrap()
}

fn state(device: &mut dyn AnyDevice) -> (u64, u64) {
    let state = ok(device.call(serde_json::json!({ "op": "state" })));
    (state["watermark"].as_u64().unwrap(), state["generation"].as_u64().unwrap())
}

#[test]
fn query_reports_the_next_expiry_to_the_host() {
    on_both(|host| {
        let label = host.label();
        let source = "table notes:\n  until: time ?\n  by byExpiry: until\n  expire at .until\n  read <- allow\n  sync public\nquery notes():\n  return notes[] first 10 by byId\n";
        let (mut engine, backend) = compile(source);
        engine.seed([
            ("notes".into(), snapback4_core::value::object([("id", id("soon")), ("until", Value::Int(4_000_000_000_000))])),
            ("notes".into(), snapback4_core::value::object([("id", id("later")), ("until", Value::Int(4_000_000_001_000))])),
            ("notes".into(), snapback4_core::value::object([("id", id("never")), ("until", Value::Null)])),
        ]).unwrap();
        let backend = snapback4_device::device::Backend { generation: engine.generation(), ..backend };
        let mut device = host.open("expiry", Some(backend)).unwrap();
        for (index, page) in snapshot_pages(&mut engine, "dev:alice", 10).iter().enumerate() { ok(apply(&mut *device, page, index == 0)); }
        let before = query(&mut *device, "notes", "dev:alice", serde_json::json!({}), 3_000_000_000_000);
        assert_eq!(before["nextExpiry"], 4_000_000_000_000_i64, "{label}: the earliest visible expiry schedules a refresh");
        let after = query(&mut *device, "notes", "dev:alice", serde_json::json!({}), 4_000_000_001_000);
        assert_eq!(after["nextExpiry"], serde_json::Value::Null, "{label}: no future expiry is encoded as null");
        device.close();
    });
}

#[test]
fn a_zero_sum_can_become_nonzero_on_the_device_clock() {
    on_both(|host| {
        let label = host.label();
        let source = "table items:\n  group: text <=10\n  amount: int\n  until: time ?\n  by byGroup: group, id\n  by byExpiry: until\n  expire at .until\n  read <- allow\n  sync public\nmaintain sums: sum items of amount by group\n  read <- allow\nquery total():\n  return sums['g'] by byGroup\n";
        let (mut engine, backend) = compile(source);
        engine.seed([
            ("items".into(), snapback4_core::value::object([("id", id("live")), ("group", Value::String("g".into())), ("amount", Value::Int(5)), ("until", Value::Null)])),
            ("items".into(), snapback4_core::value::object([("id", id("expired")), ("group", Value::String("g".into())), ("amount", Value::Int(-5)), ("until", Value::Int(2_000))])),
        ]).unwrap();
        assert_eq!(engine.query("total", context("dev:alice", &[]).at(1_000)).unwrap().data, Value::Int(0));
        let backend = snapback4_device::device::Backend { generation: engine.generation(), ..backend };
        let mut device = host.open("zero-sum", Some(backend)).unwrap();
        for (index, page) in snapshot_pages_at(&mut engine, "dev:alice", 100, 1_000).iter().enumerate() {
            ok(apply(&mut *device, page, index == 0));
        }

        let before = query(&mut *device, "total", "dev:alice", serde_json::json!({}), 1_000);
        assert_eq!(before["data"], 0, "{label}: the zero-valued candidate reaches the device");
        assert_eq!(before["nextExpiry"], 2_000, "{label}");
        let after = query(&mut *device, "total", "dev:alice", serde_json::json!({}), 3_000);
        assert_eq!(after["data"], 5, "{label}: expiry recomputes the sum without another commit");
        device.close();
    });
}

#[test]
// @ref LLP 3000#7-decisions-during-execution — an expiring audience is a device-clock revocation; retention decides what survives it.
fn expiring_membership_revokes_until_revoked_rows_offline_and_on_catch_up() {
    on_both(|host| {
        let label = host.label();
        let source = "table members:\n  group: text <=10\n  person: principal\n  until: time ?\n  unique byGroupPerson: group, person\n  by byPerson: person, group\n  by byExpiry: until\n  expire at .until\n  immutable group, person\n  read <- .person = viewer\n  insert <- exists members[.group, viewer]\n  sync to .person\ntable temporary:\n  group: text <=10\n  body: text <=10\n  by byGroup: group, id\n  read <- exists members[.group, viewer]\n  insert <- allow\n  sync to members[.group]\ntable history:\n  group: text <=10\n  body: text <=10\n  by byGroup: group, id\n  read <- exists members[.group, viewer]\n  insert <- allow\n  retain delivered-history\n  sync to members[.group]\nquery temporaryRows():\n  return temporary[] first 10 by byId\nquery historyRows():\n  return history[] first 10 by byId\nmutation join(person: principal):\n  insert members {group: 'g', person, until: 10}\nmutation add(body: text <=10):\n  insert temporary {group: 'g', body}\n  insert history {group: 'g', body}\n";
        let (mut engine, backend) = compile(source);
        let write = |engine: &mut snapback4_core::Engine,
                     op: &str,
                     op_id: &str,
                     now: i64,
                     arguments: &[(&str, Value)]| {
            let outcome = engine
                .mutate(
                    op,
                    Some(op_id),
                    context("dev:alice", arguments)
                        .at(now)
                        .with_ids([format!("{op_id}-temporary"), format!("{op_id}-history")]),
                )
                .unwrap();
            assert!(matches!(outcome.state, WriteState::Sent { .. }));
        };
        write(
            &mut engine,
            "add",
            "old",
            1,
            &[("body", Value::String("old".into()))],
        );
        let before_membership = engine.seq().unwrap();
        let joined = engine.mutate(
            "join",
            Some("member"),
            context(snapback4_core::SYSTEM_PRINCIPAL, &[("person", id("dev:alice"))])
                .at(2)
                .with_ids(["member".to_owned()]),
        ).unwrap();
        assert!(matches!(joined.state, WriteState::Sent { .. }));
        write(
            &mut engine,
            "add",
            "live",
            4,
            &[("body", Value::String("live".into()))],
        );

        let backend = snapback4_device::device::Backend {
            generation: engine.generation(),
            ..backend
        };
        let mut offline = host.open("expiry-offline", Some(backend.clone())).unwrap();
        for (index, page) in snapshot_pages_at(&mut engine, "dev:alice", 100, 5)
            .iter()
            .enumerate()
        {
            ok(apply(&mut *offline, page, index == 0));
        }
        let temporary_at_five = query(
            &mut *offline,
            "temporaryRows",
            "dev:alice",
            serde_json::json!({}),
            5,
        );
        assert_eq!(
            rows(&temporary_at_five).len(),
            2,
            "{label}: the active membership exposes both delivered rows"
        );
        assert_eq!(
            temporary_at_five["nextExpiry"], 10,
            "{label}: the audience lifetime schedules an offline refresh"
        );
        assert_eq!(
            temporary_at_five["complete"], true,
            "{label}: a fully held membership makes the local result complete"
        );

        write(
            &mut engine,
            "add",
            "hidden",
            10,
            &[("body", Value::String("hidden".into()))],
        );
        let temporary_offline = query(
            &mut *offline,
            "temporaryRows",
            "dev:alice",
            serde_json::json!({}),
            20,
        );
        assert!(
            rows(&temporary_offline).is_empty(),
            "{label}: until-revoked rows disappear on the device clock without a sync"
        );
        assert_eq!(
            temporary_offline["nextExpiry"],
            serde_json::Value::Null,
            "{label}"
        );
        let history_offline = query(
            &mut *offline,
            "historyRows",
            "dev:alice",
            serde_json::json!({}),
            20,
        );
        let history_ids = rows(&history_offline)
            .iter()
            .map(|row| row["id"].as_str().unwrap())
            .collect::<std::collections::BTreeSet<_>>();
        assert_eq!(
            history_ids,
            std::collections::BTreeSet::from(["old-history", "live-history"]),
            "{label}: delivered history remains readable after the audience expires"
        );
        offline.close();

        let catch_up = stream_page_at(&mut engine, "dev:alice", before_membership, 20);
        assert!(
            !catch_up.more,
            "{label}: this catch-up reaches the stream head"
        );
        assert_eq!(
            catch_up.events.last().map(|event| event.kind.as_str()),
            Some("scope"),
            "{label}: logical expiry closes the drained catch-up"
        );
        assert!(
            catch_up
                .events
                .iter()
                .any(|event| event.table == "temporary" && event.kind == "scope"),
            "{label}: until-revoked content receives a terminal scope"
        );
        assert!(
            catch_up
                .events
                .iter()
                .all(|event| event.id != "hidden-temporary"),
            "{label}: a commit at the expiry boundary was never authorized"
        );

        let mut caught_up = host.open("expiry-catch-up", Some(backend.clone())).unwrap();
        ok(apply(&mut *caught_up, &catch_up, false));
        let caught_up_query = query(
            &mut *caught_up,
            "temporaryRows",
            "dev:alice",
            serde_json::json!({}),
            20,
        );
        caught_up.close();

        let mut empty_snapshot = host.open("expiry-empty-snapshot", Some(backend)).unwrap();
        for (index, page) in snapshot_pages_at(&mut engine, "dev:alice", 100, 20)
            .iter()
            .enumerate()
        {
            ok(apply(&mut *empty_snapshot, page, index == 0));
        }
        let empty_snapshot_query = query(
            &mut *empty_snapshot,
            "temporaryRows",
            "dev:alice",
            serde_json::json!({}),
            20,
        );
        assert_eq!(
            caught_up_query, empty_snapshot_query,
            "{label}: drained catch-up and a post-expiry snapshot expose the same current rows"
        );
        empty_snapshot.close();
    });
}

#[test]
// @ref LLP 3000#7-decisions-during-execution — a later grant reacquires current rows only after an expired interval revokes rows retained on the device.
fn a_rejoin_after_an_expired_gap_revokes_stale_device_rows_before_reacquiring_live_rows() {
    on_both(|host| {
        let label = host.label();
        let source = "table members:\n  group: text <=10\n  person: principal\n  until: time ?\n  unique byGroupPerson: group, person\n  by byPerson: person, group\n  by byExpiry: until\n  expire at .until\n  immutable group, person\n  read <- .person = viewer\n  insert <- exists members[.group, viewer]\n  sync to .person\ntable notes:\n  group: text <=10\n  body: text <=10\n  by byGroup: group, id\n  read <- exists members[.group, viewer]\n  insert <- allow\n  delete <- allow\n  sync to members[.group]\nquery notes():\n  return notes[] first 10 by byId\nmutation join(person: principal, until: time):\n  insert members {group: 'g', person, until}\nmutation add(body: text <=10):\n  insert notes {group: 'g', body}\nmutation remove():\n  delete notes['n1']\n";
        let (mut engine, backend) = compile(source);
        let before_any_join = engine.seq().unwrap();
        let write = |engine: &mut snapback4_core::Engine,
                     op: &str,
                     op_id: &str,
                     viewer: &str,
                     now: i64,
                     arguments: &[(&str, Value)]| {
            let context = context(viewer, arguments).at(now);
            let context = if op == "remove" {
                context
            } else {
                context.with_ids([op_id.to_owned()])
            };
            let outcome = engine
                .mutate(
                    op,
                    Some(op_id),
                    context,
                )
                .unwrap();
            assert!(matches!(outcome.state, WriteState::Sent { .. }), "{outcome:?}");
        };
        write(
            &mut engine,
            "join",
            "member-a",
            snapback4_core::SYSTEM_PRINCIPAL,
            1,
            &[("person", id("dev:alice")), ("until", Value::Int(10))],
        );
        write(
            &mut engine,
            "add",
            "n1",
            "dev:alice",
            2,
            &[("body", Value::String("stale".into()))],
        );

        let backend = snapback4_device::device::Backend {
            generation: engine.generation(),
            ..backend
        };
        let mut held = host.open("rejoin-gap-held", Some(backend.clone())).unwrap();
        for (index, page) in snapshot_pages_at(&mut engine, "dev:alice", 100, 2)
            .iter()
            .enumerate()
        {
            ok(apply(&mut *held, page, index == 0));
        }
        let held_watermark = state(&mut *held).0;
        assert_eq!(
            rows(&query(&mut *held, "notes", "dev:alice", serde_json::json!({}), 2))
                .iter()
                .map(|row| row["id"].as_str().unwrap())
                .collect::<Vec<_>>(),
            vec!["n1"],
            "{label}: the device starts with n1 under membership A"
        );

        write(&mut engine, "remove", "remove-n1", "dev:alice", 11, &[]);
        write(
            &mut engine,
            "add",
            "n2",
            "dev:alice",
            15,
            &[("body", Value::String("current".into()))],
        );
        write(
            &mut engine,
            "join",
            "member-b",
            snapback4_core::SYSTEM_PRINCIPAL,
            20,
            &[("person", id("dev:alice")), ("until", Value::Int(100))],
        );

        let from_start = stream_page_at(&mut engine, "dev:alice", before_any_join, 22);
        assert!(!from_start.events.iter().any(|event| event.table == "notes" && event.id == "n1" && event.kind == "put"), "{label}: a fresh cursor cannot acquire deleted history: {:#?}", from_start.events);
        assert!(from_start.events.iter().any(|event| event.table == "notes" && event.id == "n2" && event.kind == "put"), "{label}: a fresh cursor acquires the current row under membership B: {:#?}", from_start.events);

        let catch_up = stream_page_at(&mut engine, "dev:alice", held_watermark, 22);
        let scope = catch_up
            .events
            .iter()
            .position(|event| event.table == "notes" && event.kind == "scope")
            .unwrap_or_else(|| panic!("{label}: the expired gap must revoke held n1 before the rejoin: {:#?}", catch_up.events));
        let reacquired = catch_up
            .events
            .iter()
            .position(|event| event.table == "notes" && event.id == "n2" && event.kind == "put")
            .unwrap_or_else(|| panic!("{label}: membership B must acquire the current n2 row: {:#?}", catch_up.events));
        assert!(scope < reacquired, "{label}: revocation must precede replacement-grant expansion: {:#?}", catch_up.events);
        assert!(!catch_up.events.iter().any(|event| event.table == "notes" && event.id == "n1" && event.kind == "put"), "{label}: deleted n1 cannot be reacquired: {:#?}", catch_up.events);
        ok(apply(&mut *held, &catch_up, false));
        let held_read = query(&mut *held, "notes", "dev:alice", serde_json::json!({}), 22);
        let held_ids = rows(&held_read)
            .iter()
            .map(|row| row["id"].as_str().unwrap())
            .collect::<Vec<_>>();
        assert_eq!(held_ids, vec!["n2"], "{label}: the gap drops stale n1 while B retains current n2");
        held.close();

        let mut fresh = host.open("rejoin-gap-fresh", Some(backend)).unwrap();
        ok(apply(&mut *fresh, &from_start, false));
        let fresh_read = query(&mut *fresh, "notes", "dev:alice", serde_json::json!({}), 22);
        let fresh_ids = rows(&fresh_read)
            .iter()
            .map(|row| row["id"].as_str().unwrap())
            .collect::<Vec<_>>();
        assert_eq!(fresh_ids, vec!["n2"], "{label}: the fresh and already-held devices converge");
        fresh.close();
    });
}

#[test]
// @ref LLP 3000#7-decisions-during-execution — extending a still-live audience is continuous authority and must preserve held rows.
fn renewing_a_live_membership_does_not_prematurely_revoke_held_rows() {
    on_both(|host| {
        let label = host.label();
        let source = "table members:\n  group: text <=10\n  person: principal\n  until: time ?\n  unique byGroupPerson: group, person\n  by byPerson: person, group\n  by byExpiry: until\n  expire at .until\n  immutable group, person\n  read <- .person = viewer\n  insert <- exists members[.group, viewer]\n  update <- .person = viewer\n  sync to .person\ntable notes:\n  group: text <=10\n  body: text <=10\n  by byGroup: group, id\n  read <- exists members[.group, viewer]\n  insert <- allow\n  sync to members[.group]\nquery notes():\n  return notes[] first 10 by byId\nmutation join(person: principal, until: time):\n  insert members {group: 'g', person, until}\nmutation renew(m: members, until: time):\n  update members[m] {until}\nmutation add(body: text <=10):\n  insert notes {group: 'g', body}\n";
        let (mut engine, backend) = compile(source);
        let joined = engine
            .mutate(
                "join",
                Some("member-a"),
                context(
                    snapback4_core::SYSTEM_PRINCIPAL,
                    &[("person", id("dev:alice")), ("until", Value::Int(10))],
                )
                .at(1)
                .with_ids(["member-a".to_owned()]),
            )
            .unwrap();
        assert!(matches!(joined.state, WriteState::Sent { .. }), "{joined:?}");
        let first = engine
            .mutate(
                "add",
                Some("n1"),
                context("dev:alice", &[("body", Value::String("held".into()))])
                    .at(2)
                    .with_ids(["n1".to_owned()]),
            )
            .unwrap();
        assert!(matches!(first.state, WriteState::Sent { .. }), "{first:?}");

        let backend = snapback4_device::device::Backend {
            generation: engine.generation(),
            ..backend
        };
        let mut device = host.open("live-renewal", Some(backend)).unwrap();
        for (index, page) in snapshot_pages_at(&mut engine, "dev:alice", 100, 2)
            .iter()
            .enumerate()
        {
            ok(apply(&mut *device, page, index == 0));
        }
        let watermark = state(&mut *device).0;

        let renewed = engine
            .mutate(
                "renew",
                Some("renew-member-a"),
                context(
                    "dev:alice",
                    &[("m", id("member-a")), ("until", Value::Int(100))],
                )
                .at(9),
            )
            .unwrap();
        assert!(matches!(renewed.state, WriteState::Sent { .. }), "{renewed:?}");
        let second = engine
            .mutate(
                "add",
                Some("n2"),
                context("dev:alice", &[("body", Value::String("later".into()))])
                    .at(20)
                    .with_ids(["n2".to_owned()]),
            )
            .unwrap();
        assert!(matches!(second.state, WriteState::Sent { .. }), "{second:?}");

        let catch_up = stream_page_at(&mut engine, "dev:alice", watermark, 22);
        assert!(!catch_up.events.iter().any(|event| event.table == "notes" && event.kind == "scope"), "{label}: a renewal before the old horizon cannot evict held n1: {:#?}", catch_up.events);
        assert!(catch_up.events.iter().any(|event| event.table == "notes" && event.id == "n2" && event.kind == "put"), "{label}: live authority continues through the renewed horizon: {:#?}", catch_up.events);
        ok(apply(&mut *device, &catch_up, false));
        let read = query(&mut *device, "notes", "dev:alice", serde_json::json!({}), 22);
        let ids = rows(&read)
            .iter()
            .map(|row| row["id"].as_str().unwrap())
            .collect::<Vec<_>>();
        assert_eq!(ids, vec!["n1", "n2"], "{label}: continuous authority retains both rows");
        device.close();
    });
}

#[test]
// @ref LLP 3000#7-decisions-during-execution — delivered history retains pages received under authority; later pages recheck the audience.
fn delivered_history_survives_membership_expiry_during_a_paged_snapshot() {
    on_both(|host| {
        let label = host.label();
        let source = "table subscriptions:\n  group: text <=10\n  person: principal\n  until: time ?\n  unique byGroupPerson: group, person\n  by byPerson: person, group\n  by byExpiry: until\n  expire at .until\n  immutable group, person\n  read <- .person = viewer\n  insert <- exists subscriptions[.group, viewer]\n  sync to .person\ntable notes:\n  group: text <=10\n  body: text <=10\n  by byGroup: group, id\n  read <- exists subscriptions[.group, viewer]\n  insert <- allow\n  update <- allow\n  retain delivered-history\n  sync to subscriptions[.group]\nquery notes():\n  return notes[] first 10 by byId\nmutation join(person: principal):\n  insert subscriptions {group: 'g', person, until: 10}\nmutation add(body: text <=10):\n  insert notes {group: 'g', body}\nmutation edit():\n  update notes['n1'] {body: 'changed'}\n";
        let (mut engine, backend) = compile(source);
        for (number, now) in [(1, 1), (2, 2), (3, 3)] {
            let outcome = engine
                .mutate(
                    "add",
                    Some(&format!("add-{number}")),
                    context(
                        "dev:alice",
                        &[("body", Value::String(format!("note-{number}")))],
                    )
                    .at(now)
                    .with_ids([format!("n{number}")]),
                )
                .unwrap();
            assert!(matches!(outcome.state, WriteState::Sent { .. }));
        }
        let joined = engine
            .mutate(
                "join",
                Some("join"),
                context(snapback4_core::SYSTEM_PRINCIPAL, &[("person", id("dev:alice"))])
                    .at(4)
                    .with_ids(["subscription".to_owned()]),
            )
            .unwrap();
        assert!(matches!(joined.state, WriteState::Sent { .. }));

        let backend = snapback4_device::device::Backend {
            generation: engine.generation(),
            ..backend
        };
        let mut device = host.open("paged-history-expiry", Some(backend)).unwrap();

        let (events, pinned_watermark, next) = engine
            .snapshot_page_at("dev:alice", None, 1, 9)
            .unwrap();
        let first: snapback4_device::device::StreamPage =
            serde_json::from_value(serde_json::json!({
                "snapshot": true,
                "events": events.iter().map(|event| serde_json::json!({
                    "table": event.table,
                    "kind": event.kind.word(),
                    "id": event.id,
                    "data": event.data.as_ref().map(snapback4_core::wire::to_json),
                })).collect::<Vec<_>>(),
                "watermark": pinned_watermark,
                "more": next.is_some(),
                "next": next,
                "generation": engine.generation(),
            }))
            .unwrap();
        assert!(first.more, "{label}: the snapshot spans pages");
        assert_eq!(
            first
                .events
                .iter()
                .map(|event| (event.table.as_str(), event.id.as_str()))
                .collect::<Vec<_>>(),
            [("notes", "n1")],
            "{label}: the first page delivers one history row before expiry"
        );
        ok(apply(&mut *device, &first, true));

        let edited = engine
            .mutate("edit", Some("edit"), context("dev:bob", &[]).at(11))
            .unwrap();
        assert!(matches!(edited.state, WriteState::Sent { .. }));
        let added = engine
            .mutate(
                "add",
                Some("late-add"),
                context(
                    "dev:bob",
                    &[("body", Value::String("late".into()))],
                )
                .at(11)
                .with_ids(["n4".to_owned()]),
            )
            .unwrap();
        assert!(matches!(added.state, WriteState::Sent { .. }));

        let mut cursor = first.next.clone();
        while let Some(after) = cursor {
            let (events, watermark, next) = engine
                .snapshot_page_at("dev:alice", Some(&after), 1, 11)
                .unwrap();
            assert_eq!(
                watermark, pinned_watermark,
                "{label}: every page retains the first page's watermark"
            );
            let page: snapback4_device::device::StreamPage =
                serde_json::from_value(serde_json::json!({
                    "snapshot": true,
                    "after": after,
                    "events": events.iter().map(|event| serde_json::json!({
                        "table": event.table,
                        "kind": event.kind.word(),
                        "id": event.id,
                        "data": event.data.as_ref().map(snapback4_core::wire::to_json),
                    })).collect::<Vec<_>>(),
                    "watermark": watermark,
                    "more": next.is_some(),
                    "next": next,
                    "generation": engine.generation(),
                }))
                .unwrap();
            cursor = page.next.clone();
            ok(apply(&mut *device, &page, false));
        }

        let catch_up = stream_page_at(&mut engine, "dev:alice", pinned_watermark, 11);
        assert!(!catch_up.more, "{label}: catch-up reaches the stream head");
        ok(apply(&mut *device, &catch_up, false));

        let answer = query(
            &mut *device,
            "notes",
            "dev:alice",
            serde_json::json!({}),
            11,
        );
        let notes = rows(&answer)
            .iter()
            .map(|row| {
                (
                    row["id"].as_str().unwrap().to_owned(),
                    row["body"].as_str().unwrap().to_owned(),
                )
            })
            .collect::<std::collections::BTreeMap<_, _>>();
        assert_eq!(
            notes,
            std::collections::BTreeMap::from([("n1".to_owned(), "note-1".to_owned())]),
            "{label}: only history delivered before expiry remains, without the later edit or insert"
        );
        device.close();
    });
}

#[test]
// @ref LLP 3000#7-decisions-during-execution — an expiring source is absent from a maintained value on every host before sweep.
fn expiring_maintain_sources_recompute_held_rows_without_inventing_online_counts() {
    on_both(|host| {
        let label = host.label();
        let source = "table items:\n  group: text <=10\n  at: time\n  until: time ?\n  by byTime: group, at, id\n  by byExpiry: until\n  expire at .until\n  read <- allow\n  sync public last 50 by byTime\nmaintain counts: count items by group\n  read <- allow\ntable onlineItems:\n  group: text <=10\n  until: time ?\n  by byGroup: group, id\n  by byExpiry: until\n  expire at .until\n  read <- allow\nmaintain onlineCounts: count onlineItems by group\n  read <- allow\nquery count():\n  return counts['g'] by byGroup\nquery onlineCount():\n  return onlineCounts['g'] by byGroup\n";
        let (mut engine, backend) = compile(source);
        engine
            .seed([
                (
                    "items".into(),
                    snapback4_core::value::object([
                        ("id", id("live")),
                        ("group", Value::String("g".into())),
                        ("at", Value::Int(1)),
                        ("until", Value::Null),
                    ]),
                ),
                (
                    "items".into(),
                    snapback4_core::value::object([
                        ("id", id("dead")),
                        ("group", Value::String("g".into())),
                        ("at", Value::Int(2)),
                        ("until", Value::Int(10)),
                    ]),
                ),
                (
                    "onlineItems".into(),
                    snapback4_core::value::object([
                        ("id", id("online-live")),
                        ("group", Value::String("g".into())),
                        ("until", Value::Null),
                    ]),
                ),
                (
                    "onlineItems".into(),
                    snapback4_core::value::object([
                        ("id", id("online-dead")),
                        ("group", Value::String("g".into())),
                        ("until", Value::Int(10)),
                    ]),
                ),
            ])
            .unwrap();
        let backend = snapback4_device::device::Backend {
            generation: engine.generation(),
            ..backend
        };
        let mut device = host.open("maintain-expiry", Some(backend)).unwrap();
        for (index, page) in snapshot_pages_at(&mut engine, "dev:alice", 100, 5)
            .iter()
            .enumerate()
        {
            ok(apply(&mut *device, page, index == 0));
        }

        let at_five = query(&mut *device, "count", "dev:alice", serde_json::json!({}), 5);
        assert_eq!(
            at_five["data"], 2,
            "{label}: both held source rows are live"
        );
        assert_eq!(
            at_five["nextExpiry"], 10,
            "{label}: the expiring source schedules recomputation"
        );
        let at_twenty = query(
            &mut *device,
            "count",
            "dev:alice",
            serde_json::json!({}),
            20,
        );
        assert_eq!(
            at_twenty["data"], 1,
            "{label}: the held expired source cannot keep the count at two"
        );
        assert_ne!(
            at_twenty["data"], 2,
            "{label}: a stored aggregate is not the current value"
        );

        let stale_online_count: snapback4_device::device::StreamPage = serde_json::from_value(serde_json::json!({
            "snapshot": false,
            "events": [{"table": "onlineCounts", "kind": "put", "id": "stale", "data": {"id": "stale", "group": "g", "value": 2}}],
            "watermark": state(&mut *device).0,
            "more": false,
            "generation": engine.generation(),
        })).unwrap();
        ok(apply(&mut *device, &stale_online_count, false));
        let online = query(
            &mut *device,
            "onlineCount",
            "dev:alice",
            serde_json::json!({}),
            20,
        );
        assert_ne!(
            online["data"], 2,
            "{label}: an unavailable online-only source cannot turn a stored count into a current value"
        );
        assert_eq!(
            online["complete"], false,
            "{label}: the missing source coverage stays explicit"
        );
        assert_eq!(
            online["unknown"], true,
            "{label}: the host must ask the server while online"
        );
        device.close();
    });
}

#[test]
fn omitted_apply_first_continues_the_staged_snapshot() {
    on_both(|host| {
        let label = host.label();
        let (mut engine, backend) = server();
        let mut device = host.open("apply-default", Some(backend)).unwrap();
        let pages = snapshot_pages(&mut engine, "dev:bob", 50);
        assert!(pages.len() >= 3);
        for (index, page) in pages.iter().enumerate() {
            let mut request = serde_json::json!({ "op": "apply", "page": page_json(page) });
            if index == 0 { request["first"] = serde_json::Value::Bool(true); }
            ok(device.call(request));
        }
        let thread = query(&mut *device, "thread", "dev:bob", serde_json::json!({ "conversationId": "c1" }), 2_000);
        assert_eq!(rows(&thread).len(), 50, "{label}: an omitted marker on a continuation must not clear earlier pages");
        assert_eq!(rows(&query(&mut *device, "inbox", "dev:bob", serde_json::json!({}), 2_000))[0]["count"], 120, "{label}");
        device.close();
    });
}

#[test]
fn withdrawing_one_prediction_replays_the_remaining_outbox() {
    on_both(|host| {
        let label = host.label();
        let source = "table items:\n  group: text <=10\n  value: int\n  read <- allow\n  update <- allow\n  delete <- allow\n  sync public\nquery row(id: id):\n  return items[id] by byId\nmutation first():\n  update items['a'] {value: 99}\n  delete items['b']\nmutation later():\n  old = items['a'] by byId\n  require old != null else MISSING\n  update items['a'] {value: old.value + 1}\n";
        let (mut engine, backend) = compile(source);
        engine.seed([
            ("items".into(), snapback4_core::value::object([("id", id("a")), ("group", Value::String("g".into())), ("value", Value::Int(1))])),
            ("items".into(), snapback4_core::value::object([("id", id("b")), ("group", Value::String("g".into())), ("value", Value::Int(20))])),
        ]).unwrap();
        let backend = snapback4_device::device::Backend { generation: engine.generation(), ..backend };
        let mut device = host.open("withdraw", Some(backend)).unwrap();
        for (index, page) in snapshot_pages(&mut engine, "dev:alice", 100).iter().enumerate() { ok(apply(&mut *device, page, index == 0)); }
        let queue = |op: &str, seq: u64| Queued { id: format!("w{seq}"), seq, op: op.into(), args: serde_json::json!({}), new_ids: vec![], predicted: vec![], viewer: "dev:alice".into(), now: 2_000, predictable: true, sent_seq: None, observed_seq: None };
        let first = ok(device.call(serde_json::json!({ "op": "admit", "entry": queue("first", 1) })));
        ok(device.call(serde_json::json!({ "op": "admit", "entry": queue("later", 2) })));
        assert_eq!(query(&mut *device, "row", "dev:alice", serde_json::json!({ "id": "a" }), 2_000)["data"]["value"], 100, "{label}");
        ok(device.call(serde_json::json!({ "op": "dequeue", "id": "w1" })));
        ok(device.call(serde_json::json!({ "op": "withdraw", "predicted": first["predicted"] })));
        assert_eq!(ok(device.call(serde_json::json!({ "op": "queued" }))).as_array().unwrap().len(), 1, "{label}");
        assert_eq!(query(&mut *device, "row", "dev:alice", serde_json::json!({ "id": "a" }), 2_000)["data"]["value"], 2, "{label}: the surviving prediction is replayed over the confirmed image");
        assert_eq!(query(&mut *device, "row", "dev:alice", serde_json::json!({ "id": "b" }), 2_000)["data"]["value"], 20, "{label}");
        device.close();
    });
}

#[test]
fn the_unified_device_shares_search_value_and_output_bound_semantics() {
    on_both(|host| {
        let label = host.label();
        let source = "table documents:\n  body: text <=4096\n  by byWords: words(body), id\n  read <- allow\n  sync public\ntable guarded:\n  data: json <=4096\n  read <- .data = viewer\nquery huge():\n  return documents[] first 300 by byId\nquery search(q: text <=20):\n  return documents matching q first 10 by byWords\nquery mixed(input: json <=100):\n  return input = viewer\nquery guardedRows():\n  return guarded[] first 10 by byId\n";
        let (mut engine, backend) = compile(source);
        let body = format!("needle {}", "x".repeat(4_089));
        let mut seeded = (0..300).map(|n| ("documents".to_owned(), snapback4_core::value::object([("id", id(&format!("d{n:03}"))), ("body", Value::String(body.clone()))]))).collect::<Vec<_>>();
        seeded.push(("guarded".into(), snapback4_core::value::object([("id", id("g1")), ("data", Value::String("dev:alice".into()))])));
        engine.seed(seeded).unwrap();
        let backend = snapback4_device::device::Backend { generation: engine.generation(), ..backend };
        let mut device = host.open("shared-semantics", Some(backend.clone())).unwrap();
        for (index, page) in snapshot_pages(&mut engine, "dev:alice", 400).iter().enumerate() { ok(apply(&mut *device, page, index == 0)); }
        assert_eq!(query(&mut *device, "mixed", "dev:alice", serde_json::json!({ "input": "dev:alice" }), 1)["data"], false, "{label}: JSON text and viewer identity keep distinct tags");
        assert_eq!(rows(&query(&mut *device, "search", "dev:alice", serde_json::json!({ "q": "nee" }), 1)).len(), 10, "{label}: word-prefix indexes are served on the device");
        let local = query(&mut *device, "huge", "dev:alice", serde_json::json!({}), 1);
        assert_eq!(local["denied"]["code"], "E_BOUND", "{label}: device output uses the shared 1 MiB ceiling: {local}");
        assert_eq!(engine.query("huge", context("dev:alice", &[])).unwrap_err().code, "E_BOUND", "{label}: server and device refuse the same oversized result");

        // Install a row this online-only table would never legitimately
        // receive to exercise the rule: JSON text is not viewer identity.
        let watermark = state(&mut *device).0;
        let page: snapback4_device::device::StreamPage = serde_json::from_value(serde_json::json!({
            "snapshot": false,
            "events": [{ "table": "guarded", "kind": "put", "id": "g1", "data": { "id": "g1", "data": "dev:alice" } }],
            "watermark": watermark,
            "more": false,
            "generation": backend.generation,
        })).unwrap();
        ok(apply(&mut *device, &page, false));
        let guarded = query(&mut *device, "guardedRows", "dev:alice", serde_json::json!({}), 1);
        assert!(rows(&guarded).is_empty(), "{label}: the mixed-tag rule must deny the row");
        assert_eq!(guarded["complete"], false, "{label}: the online-only read remains honestly incomplete");
        device.close();
    });
}

#[path = "device_scenarios/mod.rs"]
mod device_scenarios;
