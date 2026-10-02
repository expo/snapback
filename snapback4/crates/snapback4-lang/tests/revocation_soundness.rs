//! Row-authority model over compiled, published schemas. Authorization is evaluated
//! by Engine::query before and after each generated storage commit, not by a twin.
use snapback4_core::{Context, Engine, Value, ir::{ArgType, Expr, KeyProvenance, Program, ProgramKind, Read, Stmt},
    schema::{ColumnType, Schema, Table, BY_ID}, revocation::preserved_between};
use snapback4_lang::guide::{self, card, quarry};
use std::collections::{BTreeMap, BTreeSet};
#[path = "guide/context.rs"] mod guide_context;

fn scalar(kind: &ColumnType, n: u64) -> Value {
    match kind {
        ColumnType::Id | ColumnType::Principal | ColumnType::Ref { .. } => Value::Id(if n % 2 == 0 { "a" } else { "b" }.into()),
        ColumnType::Text { .. } => Value::String(if n % 2 == 0 { "a" } else { "b" }.into()),
        ColumnType::Enum { variants } => Value::String(variants[n as usize % variants.len()].clone()),
        ColumnType::Bool => Value::Bool(n % 2 == 0),
        ColumnType::Int | ColumnType::Time | ColumnType::Decimal { .. } | ColumnType::Money { .. } => Value::Int(if n % 2 == 0 { 10000 } else { 50 }),
        ColumnType::Optional(t) => if n % 3 == 0 { Value::Null } else { scalar(t,n) },
        ColumnType::List { .. } => Value::Array(vec![]),
        ColumnType::Bytes { .. } => Value::Bytes(vec![]),
        ColumnType::Json { .. } => Value::Map(BTreeMap::new().into()),
        ColumnType::Image { .. } | ColumnType::Video { .. } => Value::Null,
    }
}
fn row(table: &Table, id: &str, n: u64) -> Value {
    let mut values: BTreeMap<_,_> = table.columns.iter().map(|(c,t)| (c.clone(),scalar(t,n))).collect();
    values.insert("id".into(),Value::Id(id.into()));
    Value::Row(values.into())
}
fn program(table: &str) -> Program {
    Program { name: format!("rv_{table}"), kind: ProgramKind::Query, args: [("id".into(),ArgType::Id)].into(),
        body: vec![Stmt::Return(Expr::Get(Read { table: table.into(), index: BY_ID.into(), site: "rv".into(),
            key: vec![Expr::Variable("id".into())], provenance: KeyProvenance::Shape }))],
        native: false, returned_shapes: BTreeMap::new(), read_time_granularity_ms: None }
}
fn answer(engine: &mut Engine, tables: &[String]) -> BTreeMap<(String,String),BTreeSet<String>> {
    let mut out = BTreeMap::new();
    for table in tables { for viewer in ["a","b","outsider"] {
        let mut ids = BTreeSet::new();
        for id in ["a","b","c","d"] {
            let result = engine.query(&format!("rv_{table}"),Context::new(viewer,[("id".into(),Value::Id(id.into()))].into()).at(100));
            if let Ok(result) = result { if result.data != Value::Null { ids.insert(id.to_string()); } }
        }
        out.insert((table.clone(),viewer.into()),ids);
    } }
    out
}
fn next(state: &mut u64) -> u64 { *state ^= *state << 13; *state ^= *state >> 7; *state ^= *state << 17; *state }

#[test]
fn certified_commits_preserve_authorized_row_ids_across_the_corpus() {
    let mut sources = BTreeSet::new();
    for name in guide::KEYWORDS { for block in quarry(card(name).unwrap()) { sources.insert(guide_context::source(&block)); } }
    for source in [include_str!("fixtures/intent-clique.q"), include_str!("fixtures/read-through-clique.q"),
        include_str!("../../snapback4-core/tests/fixtures/expired-birth-cap.q")] { sources.insert(source.into()); }
    let seeds = [0x52560001u64,0x52560002,0x5256cafe,0x5256beef];
    let (mut schemas,mut commits,mut certified,mut positive,mut losses,mut empty) = (0,0,0,0,0,0);
    for source in sources {
        let bound = snapback4_lang::compile(&[("schema.q".into(),source)]);
        assert!(bound.diagnostics.is_empty(),"{:?}",bound.diagnostics);
        let schema: Schema = bound.schema;
        let tables: Vec<_> = schema.visible_tables().filter(|(_,t)| t.ephemeral.is_none()).map(|(n,_)|n.clone()).collect();
        if tables.is_empty() { empty += 1; continue; }
        schemas += 1;
        for seed in seeds {
            let mut state = seed;
            let mut engine = Engine::memory(schema.clone(), bound.programs.iter().map(|p|p.program.clone()).chain(tables.iter().map(|t| program(t)))).unwrap();
            // This deliberately generates a superset of reachable physical states:
            // constraints, maintains and captures are not assumed by the classifier.
            // It exercises the compiled rules even when an input is missing/negative.
            let tx = engine.store_mut().transaction().unwrap();
            for table in &tables { for (n,id) in ["a","b"].into_iter().enumerate() {
                tx.put(table,&schema.tables[table],&row(&schema.tables[table],id,n as u64),None).unwrap();
            } }
            tx.commit().unwrap();
            for step in 0..32 {
                let before = answer(&mut engine,&tables);
                let table = &tables[next(&mut state) as usize % tables.len()];
                let id = ["a","b","c","d"][next(&mut state) as usize % 4];
                let tx = engine.store_mut().transaction().unwrap();
                let old = tx.get(table,id).unwrap();
                let deleting = next(&mut state) % 4 == 0 && old.is_some();
                if deleting { tx.delete(table,&schema.tables[table],old.as_ref().unwrap()).unwrap(); }
                else {
                    let mut new = old.clone().unwrap_or_else(|| row(&schema.tables[table],id,next(&mut state)));
                    let fields = &schema.tables[table].columns;
                    let column = fields.keys().nth(next(&mut state) as usize % fields.len()).unwrap();
                    if column != "id" { if let Value::Row(values) = &mut new { values.insert(column.clone(),scalar(&fields[column],next(&mut state))); } }
                    tx.put(table,&schema.tables[table],&new,old.as_ref()).unwrap();
                }
                let seq = tx.next_seq().unwrap();
                tx.record_commit(seq,100,"rv","system","model",&[table.clone()],1).unwrap();
                tx.commit().unwrap();
                let preserved = preserved_between(engine.store().conn(),&schema,seq-1,seq);
                // The shared codec must classify the persisted summary identically
                // to ordinary serde; no codec-specific authority may be invented.
                let stored: String = engine.store().conn().query_row("SELECT footprint FROM _change_evidence WHERE seq=?1",[seq as i64],|r|r.get(0)).unwrap();
                let ordinary: snapback4_core::revocation::Footprint = serde_json::from_str(&stored).unwrap();
                assert_eq!(preserved,ordinary.preserved(&schema),"summary decoder: seed={seed:#x} step={step}");
                let after = answer(&mut engine,&tables);
                commits += 1;
                for ((table,viewer), ids) in before {
                    let remaining = &after[&(table.clone(),viewer.clone())];
                    losses += ids.difference(remaining).count();
                    if preserved.contains(&table) {
                        certified += 1; positive += ids.len();
                        assert!(ids.is_subset(remaining),"seed={seed:#x} schema={schemas} step={step} table={table} viewer={viewer} before={ids:?} after={remaining:?}");
                    }
                }
            }
        }
    }
    assert!(schemas > 30 && positive > 1000 && losses > 100,"non-vacuity: {schemas}, {positive}, {losses}");
    println!("RV soundness: seeds={seeds:x?}; schemas={schemas}; no-durable-table schemas={empty}; commits={commits}; certified viewer/table checks={certified}; retained authorized ids={positive}; revoking losses covered={losses}; failures=0");
}
