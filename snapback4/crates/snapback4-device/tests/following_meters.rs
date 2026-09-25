//! Missing cards remain unavailable at a meter cut; only published bytes count as output.
mod common;
use common::{args, id};
use snapback4_core::{Ceilings, Context, Value, engine::local};
use snapback4_device::store::DeviceStore;

fn meters<S: DeviceStore>(mut store: S) {
    let source = include_str!("../../snapback4-lang/tests/fixtures/following-view.q")
        .replacen("sync public", "sync public last 3 by .at", 1) + r#"
query point(postId: posts):
  return { card: posts[postId] }
query oversized(postId: posts, payload: text <=600):
  card = posts[postId]
  padding = []
  for i in range(0, 2048):
    padding = padding + [payload]
  return { card, padding }
"#;
    let (_, backend) = common::compile(&source);
    store.install(&backend.schema, &Default::default(), false).unwrap();
    let tx = store.transaction().unwrap();
    let run = |name: &str, schema: &snapback4_core::Schema, ceilings: Ceilings| {
        let program = backend.programs.iter().find(|p| p.name == name).unwrap();
        let mut inputs = args(&[("postId", id("unheld"))]);
        if name == "oversized" { inputs.insert("payload".into(), Value::String("x".repeat(600))); }
        local::query_with_coverage(&tx, schema, program, Context::new("alice", inputs), ceilings)
    };
    let (cut, unknown, _) = run("point", &backend.schema, Ceilings { examined: 0, ..Default::default() });
    let cut = cut.unwrap();
    assert!(cut.unavailable && unknown, "{cut:?}");
    assert_eq!(cut.data, Value::Null);
    assert!(cut.next.is_none() && cut.capped_at.is_some());
    assert!(cut.metered.examined > 0, "the failed read still spends the meter");

    let (large, unknown, _) = run("oversized", &backend.schema, Ceilings::default());
    let large = large.unwrap();
    assert!(large.unavailable && unknown, "{large:?}");
    assert_eq!(large.data, Value::Null);
    assert!(large.metered.output_bytes < 100, "discarded data is not output");
    assert!(large.metered.steps > 2048 && large.metered.heap_bytes > 1 << 20, "materialization remains metered");

    // The identical known result still hits the output ceiling. Withholding
    // cannot increase the published-output limit or erase scalar/heap work.
    let mut full = backend.schema.clone();
    full.tables.get_mut("posts").unwrap().sync.as_mut().unwrap().horizon = None;
    let (known, unknown, _) = run("oversized", &full, Ceilings::default());
    assert!(!unknown);
    assert_eq!(known.unwrap_err().code, "E_BOUND");
}

#[test]
fn following_meters_memory() { meters(snapback4_device::memory::MemoryStore::new()); }

#[test]
fn following_meters_sqlite() { meters(snapback4_core::Store::memory().unwrap()); }
