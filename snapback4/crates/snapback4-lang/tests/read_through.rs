use snapback4_core::{
    engine::{Context, Engine, WriteState},
    value::{object, Value},
};
mod read_through_support {
    include!("read_through/scenarios.rs");
}

struct SqliteBackend {
    engine: Engine,
    queries: std::collections::BTreeSet<String>,
}
impl read_through_support::Backend for SqliteBackend {
    fn run(&mut self, operation: &str, context: Context) -> Result<Value, String> {
        if self.queries.contains(operation) {
            self.engine
                .query(operation, context)
                .map(|r| r.data)
                .map_err(|e| e.to_string())
        } else {
            match self
                .engine
                .mutate(operation, None, context)
                .map_err(|e| e.to_string())?
                .state
            {
                WriteState::Sent { result, .. } => Ok(result),
                other => Err(format!("{other:?}")),
            }
        }
    }
}
fn sqlite(source: &str) -> Box<dyn read_through_support::Backend> {
    let b = bound(source);
    assert!(b.notes.is_empty(), "{:?}", b.notes);
    sqlite_bound(b)
}
fn sqlite_with_maintain_note(source: &str) -> Box<dyn read_through_support::Backend> {
    let b = bound(source);
    assert_maintain_note(&b);
    sqlite_bound(b)
}
fn sqlite_bound(b: snapback4_lang::Bound) -> Box<dyn read_through_support::Backend> {
    let queries = b
        .programs
        .iter()
        .filter(|p| p.program.kind == snapback4_core::ir::ProgramKind::Query)
        .map(|p| p.program.name.clone())
        .collect();
    Box::new(SqliteBackend {
        engine: Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap(),
        queries,
    })
}
struct MemoryBackend {
    store: snapback4_device::memory::MemoryStore,
    schema: snapback4_core::Schema,
    programs: std::collections::BTreeMap<String, snapback4_core::Program>,
}
impl read_through_support::Backend for MemoryBackend {
    fn run(&mut self, operation: &str, context: Context) -> Result<Value, String> {
        use snapback4_core::{
            engine::runner::Runner,
            meter::{Ceilings, Cut, Meter},
        };
        use snapback4_device::store::{DeviceStore, DeviceTx};
        let tx = self.store.transaction().unwrap();
        let mut runner = Runner::new(
            &tx,
            &self.schema,
            context,
            Meter::new(Ceilings::default(), Cut::Abort),
            0,
        );
        let result = runner
            .run(&self.programs[operation])
            .map_err(|e| format!("{}: {e}", e.code()));
        drop(runner);
        if result.is_ok() {
            tx.commit().unwrap();
        } else {
            tx.rollback().unwrap();
        }
        result
    }
}
fn memory(source: &str) -> Box<dyn read_through_support::Backend> {
    memory_bound(bound(source))
}
fn memory_with_maintain_note(source: &str) -> Box<dyn read_through_support::Backend> {
    let b = bound(source);
    assert_maintain_note(&b);
    memory_bound(b)
}
fn memory_bound(mut b: snapback4_lang::Bound) -> Box<dyn read_through_support::Backend> {
    use snapback4_device::store::DeviceStore;
    b.schema.prepare_contribution_indexes();
    let mut store = snapback4_device::memory::MemoryStore::new();
    store
        .install(&b.schema, &Default::default(), false)
        .unwrap();
    Box::new(MemoryBackend {
        store,
        schema: b.schema,
        programs: b
            .programs
            .into_iter()
            .map(|p| (p.program.name.clone(), p.program))
            .collect(),
    })
}
#[test]
fn four_level_chains_sqlite_and_memory() {
    for factory in [sqlite, memory] {
        read_through_support::chain(factory);
    }
}
#[test]
fn clique_sqlite_and_memory() {
    for factory in [sqlite_with_maintain_note, memory_with_maintain_note] {
        read_through_support::clique(factory);
    }
}
#[test]
fn issue_tracker_sqlite_and_memory() {
    for factory in [sqlite, memory] {
        read_through_support::issues(factory);
    }
}

#[test]
fn recursive_expiry_sqlite_and_memory() {
    for factory in [sqlite, memory] {
        read_through_support::recursive_expiry(factory);
    }
}

const MODEL: &str = include_str!("read_through/lifetime.q");

fn bound(source: &str) -> snapback4_lang::Bound {
    let b = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    b
}
fn assert_maintain_note(bound: &snapback4_lang::Bound) {
    assert_eq!(bound.notes.len(), 1, "{:?}", bound.notes);
    let note = &bound.notes[0];
    assert_eq!(note.code, "N_MAINTAIN_AUTHORIZATION", "{note}");
    assert!(note.message.contains("hidden hit or miss returns null"), "{note}");
}
fn id(x: &str) -> Value {
    Value::Id(x.into())
}
fn context(viewer: &str, now: i64, args: &[(&str, Value)]) -> Context {
    Context::new(
        viewer,
        args.iter()
            .map(|(n, v)| (n.to_string(), v.clone()))
            .collect(),
    )
    .at(now)
}
fn engine() -> Engine {
    let b = bound(MODEL);
    Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap()
}
fn sent(e: &mut Engine, op: &str, args: &[(&str, Value)]) {
    let out = e.mutate(op, None, context("alice", 100, args)).unwrap();
    assert!(matches!(out.state, WriteState::Sent { .. }), "{out:?}");
}

#[test]
fn capture_authority_expiry_and_delete() {
    let mut e = engine();
    sent(
        &mut e,
        "parent",
        &[
            ("id", id("p")),
            ("owner", id("alice")),
            ("until", Value::Int(200)),
        ],
    );
    sent(
        &mut e,
        "child",
        &[("id", id("c")), ("parent", id("p")), ("until", Value::Null)],
    );
    let row = e
        .query("childRow", context("alice", 100, &[("id", id("c"))]))
        .unwrap()
        .data;
    assert_eq!(row.field("body").unwrap(), &Value::String("hello".into()));
    assert!(row.as_object().unwrap().keys().all(|k| !k.starts_with('$')));
    assert_eq!(
        e.query("childRow", context("bob", 100, &[("id", id("c"))]))
            .unwrap()
            .data,
        Value::Null
    );
    let page = e
        .query(
            "page",
            context("alice", 100, &[("id", id("p")), ("c", Value::Null)]),
        )
        .unwrap();
    assert!(page.complete, "{page:?}");
    let out = e
        .mutate("erase", None, context("alice", 100, &[("id", id("p"))]))
        .unwrap();
    assert!(
        format!("{out:?}").contains("E_PARENT_HAS_CHILDREN"),
        "{out:?}"
    );
    sent(
        &mut e,
        "extend",
        &[("id", id("c")), ("until", Value::Int(999))],
    );
    assert_eq!(
        e.query("childRow", context("alice", 200, &[("id", id("c"))]))
            .unwrap()
            .data,
        Value::Null
    );
    assert_eq!(e.sweep_expired(200, 1).unwrap(), 1);
    assert_eq!(e.sweep_expired(200, 1).unwrap(), 1);
}

#[test]
fn form_refusals() {
    for (from, to, code) in [
        ("parent: parents", "parent: parents ?", "E_READ_THROUGH"),
        ("immutable parent", "-- mutable parent", "E_READ_THROUGH"),
        (
            "immutable owner, until",
            "immutable until",
            "E_READ_THROUGH",
        ),
        (
            "read through .parent",
            "read through .parent or viewer = 'service:search'",
            "E_READ_THROUGH",
        ),
    ] {
        let b = snapback4_lang::compile(&[("schema.q".into(), MODEL.replace(from, to))]);
        assert!(
            b.diagnostics.iter().any(|d| d.code == code),
            "{to}: {:?}",
            b.diagnostics
        );
    }
}

#[test]
fn keyed_counts_and_private_inherited_path() {
    let source = format!(
        "{MODEL}\nview counts: count children by .parent\nquery total(id: parents):\n  return counts[id]\nview unread: count children by .parent.owner\nquery unreadFor(owner: principal):\n  return unread[owner]\n"
    );
    let b = bound(&source);
    assert_maintain_note(&b);
    let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    sent(
        &mut e,
        "parent",
        &[
            ("id", id("p")),
            ("owner", id("alice")),
            ("until", Value::Int(200)),
        ],
    );
    sent(
        &mut e,
        "child",
        &[("id", id("c")), ("parent", id("p")), ("until", Value::Null)],
    );
    assert_eq!(
        e.query("total", context("alice", 100, &[("id", id("p"))]))
            .unwrap()
            .data,
        Value::Int(1)
    );
    assert_eq!(
        e.query("total", context("bob", 100, &[("id", id("p"))]))
            .unwrap()
            .data,
        Value::Null
    );
    assert_eq!(
        e.query(
            "unreadFor",
            context("alice", 100, &[("owner", id("alice"))])
        )
        .unwrap()
        .data,
        Value::Int(1)
    );
    assert_eq!(
        e.query(
            "unreadFor",
            context("alice", 200, &[("owner", id("alice"))])
        )
        .unwrap()
        .data,
        Value::Int(0)
    );
    let b = snapback4_lang::compile(&[(
        "schema.q".into(),
        format!("{source}\nquery all():\n  return counts first 20\n"),
    )]);
    assert!(
        b.diagnostics
            .iter()
            .any(|d| d.code == "E_READ_THROUGH_SCAN"),
        "{:?}",
        b.diagnostics
    );
}

#[test]
fn adoption_checks_old_correspondence_before_projection() {
    let old = MODEL.replace(
        "read through .parent",
        "ownerCopy: principal\n  read <- .ownerCopy = viewer",
    );
    let old = old.replace(
        "body: 'hello', until",
        "body: 'hello', until, ownerCopy: viewer",
    );
    let b = bound(&old);
    let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    sent(
        &mut e,
        "parent",
        &[
            ("id", id("p")),
            ("owner", id("alice")),
            ("until", Value::Null),
        ],
    );
    sent(
        &mut e,
        "child",
        &[("id", id("c")), ("parent", id("p")), ("until", Value::Null)],
    );
    let b = bound(MODEL);
    e.adopt_at(b.schema, b.programs.into_iter().map(|p| p.program), 100)
        .unwrap();
    assert!(
        e.query("childRow", context("alice", 100, &[("id", id("c"))]))
            .unwrap()
            .data
            .field("ownerCopy")
            .is_err()
    );
}

#[test]
fn parent_missing_hidden_and_upsert_target_refusals_have_equal_meters() {
    let source = format!(
        "{MODEL}\nmutation put(id: id, parent: parents):\n  upsert children[id] {{ parent, body: 'hello', until: null }}\n"
    );
    let b = bound(&source);
    let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    sent(
        &mut e,
        "parent",
        &[
            ("id", id("p")),
            ("owner", id("alice")),
            ("until", Value::Null),
        ],
    );
    sent(
        &mut e,
        "child",
        &[("id", id("c")), ("parent", id("p")), ("until", Value::Null)],
    );
    for parent in ["p", "q"] {
        let a = e
            .mutate(
                "child",
                None,
                context(
                    "bob",
                    100,
                    &[
                        ("id", id("x")),
                        ("parent", id(parent)),
                        ("until", Value::Null),
                    ],
                ),
            )
            .unwrap();
        let b = e
            .mutate(
                "child",
                None,
                context(
                    "bob",
                    100,
                    &[("id", id("x")), ("parent", id("q")), ("until", Value::Null)],
                ),
            )
            .unwrap();
        assert_eq!(format!("{:?}", a.state), format!("{:?}", b.state));
        assert_eq!(a.metered, b.metered);
    }
}

// Integration: T's inherited expiry uses Q's indexed unswept-backlog path.
#[test]
fn inherited_aggregate_cost_depends_on_backlog_not_live_population() {
    let source = "table parents:\n  owner: principal\n  until: time\n  immutable owner, until\n  expire at .until\n  read <- .owner = viewer\n  insert <- allow\ntable children:\n  parent: parents\n  immutable parent\n  read through .parent\n  insert <- allow\nview totals: count children by .parent.owner\nquery total(owner: principal):\n  return totals[owner]\n";
    for live in [100, 10_000] {
        for backlog in [0, 50] {
            let b = bound(source);
            assert_maintain_note(&b);
            let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
            let mut rows = Vec::new();
            for (parent, until, count) in [("live", 500, live), ("expired", 150, backlog)] {
                rows.push(("parents".into(), object([
                    ("id", id(parent)), ("owner", id("alice")), ("until", Value::Int(until)),
                ])));
                for n in 0..count {
                    rows.push(("children".into(), object([
                        ("id", id(&format!("{parent}-{n}"))), ("parent", id(parent)),
                    ])));
                }
            }
            e.seed_at(rows, 100).unwrap();
            let result = e.query("total", context("alice", 200, &[("owner", id("alice"))])).unwrap();
            assert_eq!(result.data, Value::Int(live));
            assert!(result.complete, "{result:?}");
            assert_eq!(result.next_expiry, Some(500));
            assert_eq!(result.metered.examined, backlog as u64 + 2, "{result:?}");
            let denied = e.query("total", context("bob", 200, &[("owner", id("alice"))])).unwrap();
            assert_eq!(denied.data, Value::Null);
            assert_eq!(denied.next_expiry, None);
            assert_eq!(denied.metered.examined, 1, "hidden backlog must not be inspected");
        }
    }
}
