//! Generated device/server parity for commit-end lifetime retirement. Each
//! source runs through the public sync wire and both device stores, so an
//! offline prediction cannot silently omit a cascade, set-null or restrict
//! action performed by the server.

#[path = "../../snapback4-device/tests/common/mod.rs"]
mod device_common;

use device_common::{
    BoundaryMetadata, Host, Memory, Sqlite, args, compile, id, snapshot_pages, stream_page,
};
use serde_json::json;
use snapback4_core::{Context, Engine, Value, WriteState};
use snapback4_device::device::Device;

const NOW: i64 = 4_000_000_000_000;
const GENERATED_SOURCES: usize = 18;
const GENERATED_NEGATIVE_SOURCES: usize = 9;
const RUNTIME_CASES: usize = GENERATED_SOURCES * 2;

#[derive(Clone, Copy, Debug)]
enum Action {
    Cascade,
    SetNull,
    Restrict,
}

impl Action {
    fn word(self) -> &'static str {
        match self {
            Self::Cascade => "cascade",
            Self::SetNull => "set null",
            Self::Restrict => "restrict",
        }
    }

    fn optional(self) -> &'static str {
        if matches!(self, Self::SetNull) {
            " ?"
        } else {
            ""
        }
    }
}

#[derive(Clone, Copy, Debug)]
enum Prelude {
    Snapshot,
    Stream,
}

#[derive(Clone, Copy, Debug)]
enum Target {
    ExpiredWithInbound,
    FutureWithInbound,
    ExpiredWithoutInbound,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum IncompleteCoverage {
    MissingChild,
    AudienceHidden,
    PartiallyAcquired,
}

impl Target {
    fn has_inbound(self) -> bool {
        !matches!(self, Self::ExpiredWithoutInbound)
    }

    fn requested_expiry(self) -> i64 {
        if matches!(self, Self::FutureWithInbound) {
            NOW + 10_000
        } else {
            NOW
        }
    }
}

#[derive(Clone, Debug)]
struct Generated {
    seed: u64,
    action: Action,
    prelude: Prelude,
    target: Target,
    viewer: &'static str,
    decoys: usize,
    source: String,
}

fn generated_sources() -> Vec<Generated> {
    let mut generated = Vec::new();
    let mut seed = 0_u64;
    for action in [Action::Cascade, Action::SetNull, Action::Restrict] {
        for target in [
            Target::ExpiredWithInbound,
            Target::FutureWithInbound,
            Target::ExpiredWithoutInbound,
        ] {
            for prelude in [Prelude::Snapshot, Prelude::Stream] {
                let viewer = ["alice", "bob", "carol"][(seed as usize) % 3];
                let decoys = 1 + (seed as usize % 2);
                let cap = decoys + 2;
                let source = format!(
                    r#"use personas alice, bob, carol
table parents:
  until: time
  token: int
  expire at .until
  public 'generated expiry parents seed {seed}'
  insert <- allow
  update <- allow
  sync public
table children:
  parent: parents{optional} on delete {action}
  marker: int
  cap {cap} by parent
  public 'generated expiry children seed {seed}'
  insert <- allow
  sync public
mutation addChild(id: id, parent: parents, marker: int):
  insert children {{ id, parent, marker }}
mutation setExpiry(parent: parents, until: time):
  update parents[parent] {{ until }}
"#,
                    optional = action.optional(),
                    action = action.word(),
                );
                generated.push(Generated {
                    seed,
                    action,
                    prelude,
                    target,
                    viewer,
                    decoys,
                    source,
                });
                seed += 1;
            }
        }
    }
    assert_eq!(generated.len(), GENERATED_SOURCES);
    generated
}

fn row(fields: impl IntoIterator<Item = (&'static str, Value)>) -> Value {
    snapback4_core::value::object(fields)
}

fn target_parent() -> Value {
    row([
        ("id", id("target")),
        ("until", Value::Int(NOW + 5_000)),
        ("token", Value::Int(7)),
    ])
}

fn target_child(seed: u64) -> Value {
    row([
        ("id", id("target-child")),
        ("parent", id("target")),
        ("marker", Value::Int(seed as i64)),
    ])
}

fn decoy_parent(index: usize) -> Value {
    row([
        ("id", id(&format!("decoy-parent-{index}"))),
        ("until", Value::Int(NOW + 20_000 + index as i64)),
        ("token", Value::Int(100 + index as i64)),
    ])
}

fn decoy_child(index: usize) -> Value {
    row([
        ("id", id(&format!("decoy-child-{index}"))),
        ("parent", id(&format!("decoy-parent-{index}"))),
        ("marker", Value::Int(200 + index as i64)),
    ])
}

fn seed_rows(case: &Generated) -> Vec<(String, Value)> {
    let mut rows = vec![("parents".to_owned(), target_parent())];
    for index in 0..case.decoys {
        rows.push(("parents".to_owned(), decoy_parent(index)));
        let streamed_decoy =
            matches!(case.prelude, Prelude::Stream) && !case.target.has_inbound() && index == 0;
        if !streamed_decoy {
            rows.push(("children".to_owned(), decoy_child(index)));
        }
    }
    if case.target.has_inbound() && matches!(case.prelude, Prelude::Snapshot) {
        rows.push(("children".to_owned(), target_child(case.seed)));
    }
    rows
}

fn canonical(rows: Vec<Value>) -> Vec<String> {
    let mut rows = rows
        .into_iter()
        .map(|row| {
            let mut row = snapback4_core::wire::to_json(&row);
            // `pending` is device settlement metadata, not an authored field;
            // parity below compares the predicted data image with the server's
            // committed data image.
            if let Some(object) = row.as_object_mut() {
                object.remove("pending");
            }
            serde_json::to_string(&row).unwrap()
        })
        .collect::<Vec<_>>();
    rows.sort();
    rows
}

fn device_rows<S: BoundaryMetadata>(device: &Device<S>, table: &str) -> Vec<Value> {
    device.store().raw_rows(table)
}

fn server_rows(server: &Engine, table: &str) -> Vec<Value> {
    server.store().rows(table).unwrap()
}

fn row_by_id<'a>(rows: &'a [Value], wanted: &str) -> Option<&'a Value> {
    rows.iter()
        .find(|row| row.field("id").ok() == Some(&id(wanted)))
}

fn apply_snapshot<S: BoundaryMetadata>(
    server: &mut Engine,
    device: &mut Device<S>,
    viewer: &str,
) -> (u64, usize) {
    let pages = snapshot_pages(server, viewer, 2);
    let watermark = pages.last().expect("a snapshot has a final page").watermark;
    for (index, page) in pages.iter().enumerate() {
        device.apply(page, index == 0).unwrap();
    }
    (watermark, pages.len())
}

fn server_write(
    server: &mut Engine,
    op: &str,
    viewer: &str,
    values: &[(&str, Value)],
    now: i64,
) -> Result<(), String> {
    let outcome = server
        .mutate(op, None, Context::new(viewer, args(values)).at(now))
        .unwrap();
    match outcome.state {
        WriteState::Sent { .. } => Ok(()),
        WriteState::Failed { why, .. } => Err(why.code),
    }
}

fn prelude<S: BoundaryMetadata>(
    case: &Generated,
    server: &mut Engine,
    device: &mut Device<S>,
) -> (usize, usize) {
    let (watermark, snapshot_count) = apply_snapshot(server, device, case.viewer);
    let mut stream_count = 0;
    if matches!(case.prelude, Prelude::Stream) {
        let (child, parent, marker) = if case.target.has_inbound() {
            (
                "target-child".to_owned(),
                "target".to_owned(),
                case.seed as i64,
            )
        } else {
            ("decoy-child-0".to_owned(), "decoy-parent-0".to_owned(), 200)
        };
        server_write(
            server,
            "addChild",
            case.viewer,
            &[
                ("id", id(&child)),
                ("parent", id(&parent)),
                ("marker", Value::Int(marker)),
            ],
            NOW - 1,
        )
        .unwrap();
        device
            .apply(&stream_page(server, case.viewer, watermark), false)
            .unwrap();
        stream_count += 1;
    }

    for table in ["parents", "children"] {
        assert_eq!(
            canonical(device_rows(device, table)),
            canonical(server_rows(server, table)),
            "seed {} {:?}/{:?}: prelude sync differs for {table}",
            case.seed,
            case.action,
            case.prelude,
        );
    }
    (snapshot_count, stream_count)
}

fn assert_expected<S: BoundaryMetadata>(case: &Generated, server: &Engine, device: &Device<S>) {
    let device_parents = device_rows(device, "parents");
    let device_children = device_rows(device, "children");
    let server_parents = server_rows(server, "parents");
    let server_children = server_rows(server, "children");
    let label = format!(
        "seed {} {:?}/{:?}/{:?}",
        case.seed, case.action, case.target, case.prelude
    );

    assert_eq!(
        canonical(device_parents.clone()),
        canonical(server_parents.clone()),
        "{label}: parent parity"
    );
    assert_eq!(
        canonical(device_children.clone()),
        canonical(server_children.clone()),
        "{label}: child parity"
    );

    let target_parent = row_by_id(&device_parents, "target");
    let target_child = row_by_id(&device_children, "target-child");
    match (case.action, case.target) {
        (Action::Restrict, Target::ExpiredWithInbound) => {
            let parent = target_parent.expect("restrict refusal preserves its parent");
            assert_eq!(
                parent.field("until").unwrap(),
                &Value::Int(NOW + 5_000),
                "{label}"
            );
            assert_eq!(
                target_child.map(|row| row.field("parent").unwrap()),
                Some(&id("target")),
                "{label}"
            );
        }
        (_, Target::FutureWithInbound) => {
            let parent = target_parent.expect("future expiry preserves its parent");
            assert_eq!(
                parent.field("until").unwrap(),
                &Value::Int(NOW + 10_000),
                "{label}"
            );
            assert_eq!(
                target_child.map(|row| row.field("parent").unwrap()),
                Some(&id("target")),
                "{label}"
            );
        }
        (Action::Cascade, Target::ExpiredWithInbound) => {
            assert!(target_parent.is_none(), "{label}: expired parent retires");
            assert!(target_child.is_none(), "{label}: cascade retires the child");
        }
        (Action::SetNull, Target::ExpiredWithInbound) => {
            assert!(target_parent.is_none(), "{label}: expired parent retires");
            assert_eq!(
                target_child.map(|row| row.field("parent").unwrap()),
                Some(&Value::Null),
                "{label}"
            );
        }
        (_, Target::ExpiredWithoutInbound) => {
            assert!(
                target_parent.is_none(),
                "{label}: an unreferenced expired parent retires"
            );
            assert!(
                target_child.is_none(),
                "{label}: the source generated no inbound reference"
            );
        }
    }

    let target_remains = matches!(case.target, Target::FutureWithInbound)
        || matches!(
            (case.action, case.target),
            (Action::Restrict, Target::ExpiredWithInbound)
        );
    assert_eq!(
        device_parents.len(),
        case.decoys + if target_remains { 1 } else { 0 },
        "{label}: every decoy parent remains and only the expected target image survives"
    );
    assert_eq!(
        device_children
            .iter()
            .filter(|row| row.field("id").ok() != Some(&id("target-child")))
            .count(),
        case.decoys,
        "{label}: every unrelated child remains",
    );
}

fn run_case<H: Host>(host: &mut H, case: &Generated) -> (usize, usize) {
    let (mut server, backend) = compile(&case.source);
    server.seed_at(seed_rows(case), NOW - 100).unwrap();
    let store_name = format!("w12-expiry-generated-{}", case.seed);
    let mut device = host.open(&store_name, Some(backend)).unwrap();
    let counts = prelude(case, &mut server, &mut device);
    let input = json!({"parent":"target", "until":case.target.requested_expiry()});
    let predicted = device.predict("setExpiry", case.viewer, &input, NOW, vec![], 1);
    let committed = server_write(
        &mut server,
        "setExpiry",
        case.viewer,
        &[
            ("parent", id("target")),
            ("until", Value::Int(case.target.requested_expiry())),
        ],
        NOW,
    );

    if matches!(
        (case.action, case.target),
        (Action::Restrict, Target::ExpiredWithInbound)
    ) {
        assert_eq!(
            predicted.unwrap_err().code(),
            "E_REFERENCED",
            "seed {} {}",
            case.seed,
            host.label()
        );
        assert_eq!(
            committed.unwrap_err(),
            "E_REFERENCED",
            "seed {} {}",
            case.seed,
            host.label()
        );
    } else {
        assert!(
            predicted.is_ok(),
            "seed {} {}: {predicted:?}",
            case.seed,
            host.label()
        );
        assert_eq!(committed, Ok(()), "seed {} {}", case.seed, host.label());
    }
    assert_expected(case, &server, &device);
    host.close(&store_name, device);
    counts
}

fn incomplete_source(seed: u64, action: Action) -> String {
    let cap = 3 + seed as usize % 2;
    format!(
        r#"use personas alice, bob, carol
table parents:
  until: time
  expire at .until
  public 'incomplete expiry parents seed {seed}'
  update <- allow
  sync public
table children:
  parent: parents{optional} on delete {action}
  owner: principal
  cap {cap} by parent
  read <- .owner = viewer
  insert <- .owner = viewer
  sync to .owner
mutation setExpiry(parent: parents, until: time):
  update parents[parent] {{ until }}
"#,
        optional = action.optional(),
        action = action.word(),
    )
}

fn incomplete_rows(mode: IncompleteCoverage, viewer: &str) -> Vec<(String, Value)> {
    let mut rows = vec![(
        "parents".to_owned(),
        row([("id", id("target")), ("until", Value::Int(NOW + 5_000))]),
    )];
    let hidden = if viewer == "alice" { "bob" } else { "alice" };
    if matches!(
        mode,
        IncompleteCoverage::AudienceHidden | IncompleteCoverage::PartiallyAcquired
    ) {
        rows.push((
            "children".to_owned(),
            row([
                ("id", id("hidden")),
                ("parent", id("target")),
                ("owner", id(hidden)),
            ]),
        ));
    }
    if matches!(mode, IncompleteCoverage::PartiallyAcquired) {
        rows.push((
            "children".to_owned(),
            row([
                ("id", id("visible")),
                ("parent", id("target")),
                ("owner", id(viewer)),
            ]),
        ));
    }
    rows
}

fn run_incomplete_case<H: Host>(
    host: &mut H,
    seed: u64,
    action: Action,
    mode: IncompleteCoverage,
) -> usize {
    let source = incomplete_source(seed, action);
    let (mut server, backend) = compile(&source);
    let viewer = ["alice", "bob", "carol"][(seed as usize) % 3];
    server
        .seed_at(incomplete_rows(mode, viewer), NOW - 100)
        .unwrap();
    let store_name = format!("w12-expiry-incomplete-{seed}");
    let mut device = host.open(&store_name, Some(backend)).unwrap();
    let (_, pages) = apply_snapshot(&mut server, &mut device, viewer);
    let parents_before = canonical(device_rows(&device, "parents"));
    let children_before = canonical(device_rows(&device, "children"));

    let predicted = device
        .predict(
            "setExpiry",
            viewer,
            &json!({"parent":"target", "until":NOW}),
            NOW,
            vec![],
            1,
        )
        .unwrap_err();
    assert_eq!(
        predicted.code(),
        "E_PREDICT",
        "seed {seed} {action:?}/{mode:?} {} must queue an unprovable action group",
        host.label()
    );
    assert_eq!(
        canonical(device_rows(&device, "parents")),
        parents_before,
        "seed {seed} {action:?}/{mode:?}: a queued mutation changes no parent"
    );
    assert_eq!(
        canonical(device_rows(&device, "children")),
        children_before,
        "seed {seed} {action:?}/{mode:?}: a queued mutation changes no visible child"
    );

    let committed = server_write(
        &mut server,
        "setExpiry",
        viewer,
        &[("parent", id("target")), ("until", Value::Int(NOW))],
        NOW,
    );
    let has_child = mode != IncompleteCoverage::MissingChild;
    if matches!(action, Action::Restrict) && has_child {
        assert_eq!(
            committed,
            Err("E_REFERENCED".to_owned()),
            "seed {seed} {mode:?}"
        );
        assert!(row_by_id(&server_rows(&server, "parents"), "target").is_some());
    } else {
        assert_eq!(committed, Ok(()), "seed {seed} {action:?}/{mode:?}");
        assert!(row_by_id(&server_rows(&server, "parents"), "target").is_none());
        let children = server_rows(&server, "children");
        match action {
            Action::Cascade => assert!(children.is_empty(), "seed {seed} {mode:?}"),
            Action::SetNull => assert!(
                children
                    .iter()
                    .all(|row| row.field("parent").ok() == Some(&Value::Null)),
                "seed {seed} {mode:?}"
            ),
            Action::Restrict => assert!(
                children.is_empty(),
                "the missing-child control has no child"
            ),
        }
    }
    host.close(&store_name, device);
    pages
}

#[test]
fn generated_commit_end_expiry_actions_match_server_on_both_device_stores() {
    let generated = generated_sources();
    let mut memory = Memory::new();
    let mut sqlite = Sqlite::new("w12-expiry-generated");
    let mut runtime_cases = 0;
    let mut snapshot_pages_seen = 0;
    let mut stream_pages_seen = 0;
    for case in &generated {
        for counts in [run_case(&mut memory, case), run_case(&mut sqlite, case)] {
            runtime_cases += 1;
            snapshot_pages_seen += counts.0;
            stream_pages_seen += counts.1;
        }
    }
    assert_eq!(runtime_cases, RUNTIME_CASES);
    assert_eq!(
        stream_pages_seen, 18,
        "nine stream-prelude sources run on two stores"
    );
    assert!(
        snapshot_pages_seen >= runtime_cases,
        "every runtime starts from a real public-sync snapshot"
    );
    println!(
        "generated {GENERATED_SOURCES} sources; {runtime_cases} Memory/SQLite cases; {snapshot_pages_seen} snapshot pages; {stream_pages_seen} prelude stream pages; 72 independently asserted target outcomes"
    );
}

#[test]
fn generated_incomplete_action_groups_queue_without_predicted_rows() {
    let mut memory = Memory::new();
    let mut sqlite = Sqlite::new("w12-expiry-incomplete");
    let mut seed = 100_u64;
    let mut sources = 0;
    let mut runtime_cases = 0;
    let mut snapshot_pages_seen = 0;
    for action in [Action::Cascade, Action::SetNull, Action::Restrict] {
        for mode in [
            IncompleteCoverage::MissingChild,
            IncompleteCoverage::AudienceHidden,
            IncompleteCoverage::PartiallyAcquired,
        ] {
            snapshot_pages_seen += run_incomplete_case(&mut memory, seed, action, mode);
            snapshot_pages_seen += run_incomplete_case(&mut sqlite, seed, action, mode);
            sources += 1;
            runtime_cases += 2;
            seed += 1;
        }
    }
    assert_eq!(sources, GENERATED_NEGATIVE_SOURCES);
    assert_eq!(runtime_cases, GENERATED_NEGATIVE_SOURCES * 2);
    assert!(snapshot_pages_seen >= runtime_cases);
    println!(
        "generated {sources} incomplete-coverage sources; {runtime_cases} Memory/SQLite queue cases; {snapshot_pages_seen} snapshot pages; all 18 device outcomes were exact E_PREDICT with zero local changes"
    );
}
