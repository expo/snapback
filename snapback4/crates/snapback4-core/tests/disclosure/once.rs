use crate as snapback4_core;
// Each row pays a pre-used meter, not a post-query empty unit allowance.
// @ref LLP 3000.023#12 — price disclosed projections under a nonempty caller meter.
use snapback4_core::{Context, Engine, Value, meter::{Ceilings, Cut, Meter}, engine::{runner::Runner, local}, rows::Rows, wire};
use serde_json::json;

#[test]
fn entire_query_pipeline_is_independent_of_unavailable_once_payloads() {
    let source = "table docs:\n  photos: [image <=10000 once] <=1000 ?\n  body: text <=20\n  public\n  sync public\nquery page():\n  return docs[] first 100 by byId\n";
    let bound = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let program: crate::ir::Program = serde_json::from_value(serde_json::to_value(&bound.programs[0].program).unwrap()).unwrap();
    let schema: crate::Schema = serde_json::from_value(serde_json::to_value(&bound.schema).unwrap()).unwrap();
    let mut engine = Engine::memory(schema.clone(), [program.clone()]).unwrap();
    let mut observations = Vec::new();
    for filled in [false, true] {
        let photos = if filled { json!((0..1000).map(|i| json!({"id":format!("missing{i:024}")})).collect::<Vec<_>>()) } else { json!(null) };
        let rows: Vec<_> = (0..30).map(|i| ("docs".into(), wire::row_from_json(&schema.tables["docs"], &json!({"id":format!("row{i:02}"),"body":"same visible text","photos":photos})).unwrap())).collect();
        engine.seed_at(rows.clone(), 1).unwrap();
        let tx = engine.store_mut().read_transaction().unwrap();
        let mut meter = Meter::new(Ceilings::default(), Cut::Cap);
        meter.heap(512 * 1024).unwrap(); meter.step(500).unwrap();
        let mut runner = Runner::new(&tx, &schema, Context::new("bob", Default::default()).at(2), meter, 1);
        let data = runner.run(&program).unwrap(); runner.charge_output(&data).unwrap();
        assert_eq!(data.as_array().unwrap().len(), 30);
        assert!(runner.meter.capped_at.is_none());
        observations.push((data, runner.meter.used, runner.meter.heap_peak));
        drop(runner); tx.rollback().unwrap();
        let memory = snapback4_core::rows::MemoryRows::default();
        for (name, row) in rows { memory.put(&name, &schema.tables[&name], &row, None).unwrap(); }
        let device = local::query(&memory, &schema, &program, Context::new("bob", Default::default()).at(2), Ceilings::default()).unwrap();
        assert!(device.complete && !device.unavailable);
        assert_eq!(device.data, observations.last().unwrap().0);
    }
    assert_eq!(observations[0], observations[1], "payload shape must change neither answer nor remaining meter");
}

#[test]
fn every_leaf_and_exact_column_home_are_required() {
    let source = "table docs:\n  photo: image <=10000 once ?\n  other: image <=10000 once ?\n  photos: [[image <=10000 once] <=2] <=2 ?\n  public\n  sync public\nquery point():\n  return docs['a']\n";
    let bound = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let schema: crate::Schema = serde_json::from_value(serde_json::to_value(&bound.schema).unwrap()).unwrap();
    let programs: Vec<crate::ir::Program> = bound.programs.iter().map(|p| serde_json::from_value(serde_json::to_value(&p.program).unwrap()).unwrap()).collect();
    let mut e = Engine::memory(schema, programs).unwrap();
    for (id, column) in [("scalar", "photo"), ("viewed", "photos"), ("live", "photos")] {
        e.store().record_asset(&snapback4_core::assets::Asset { id:id.into(), owner:"alice".into(), kind:snapback4_core::assets::AssetKind::Image, content_type:"image/png".into(), bytes:68, width:Some(1), height:Some(1), duration:None, created_at:0, home:Some(("docs".into(),"a".into(),column.into())), released_at:None }).unwrap();
    }
    let table = e.schema().tables["docs"].clone();
    let row = wire::row_from_json(&table, &json!({"id":"a","photo":{"id":"scalar"},"other":{"id":"scalar"},"photos":[[{"id":"viewed"},{"id":"live"}]]})).unwrap();
    let tx = e.store_mut().transaction().unwrap();
    for (id, column) in [("scalar", "photo"), ("viewed", "photos"), ("live", "photos")] { tx.claim_asset(id, "alice", "docs", "a", column).unwrap(); }
    tx.put("docs", &table, &row, None).unwrap(); tx.commit().unwrap();
    e.record_asset_view("bob", "viewed", 1).unwrap();
    let data = e.query("point", Context::new("bob", Default::default()).at(2)).unwrap().data;
    assert_eq!(data.field("photo").unwrap().field("id").unwrap().as_str().unwrap(), "scalar");
    assert_eq!(data.field("other").unwrap(), &Value::Null);
    assert_eq!(data.field("photos").unwrap(), &Value::Null);
}
