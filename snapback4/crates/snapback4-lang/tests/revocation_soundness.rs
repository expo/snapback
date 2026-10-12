//! Row and field authority model over compiled, published schemas. Authorization is evaluated
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
        ColumnType::IntRange { min, max } => Value::Int((if n % 2 == 0 { 10000 } else { 50 }).clamp(*min, *max)),
        ColumnType::Optional(t) => if n % 3 == 0 { Value::Null } else { scalar(t,n) },
        ColumnType::List { .. } => Value::Array(vec![]),
        ColumnType::ListRange { of, min, .. } => Value::Array(vec![scalar(of, n); *min as usize]),
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
const VIEWERS: [&str; 6] = ["a", "b", "dev:alice", "dev:bob", "outsider", "service:auditor"];
const IDS: [&str; 4] = ["a", "b", "c", "d"];
const SEEDS: [u64; 4] = [0x52560001, 0x52560002, 0x5256cafe, 0x5256beef];
#[derive(Debug)]
struct Disclosure { fields: BTreeSet<String>, deadline: Option<i64> }
type Answers = BTreeMap<(String,String), BTreeMap<String,Disclosure>>;
fn answer(engine: &mut Engine, tables: &[String], now: i64) -> Answers {
    let mut out = BTreeMap::new();
    for table in tables { for viewer in VIEWERS {
        let mut rows = BTreeMap::new();
        for id in IDS {
            let result = engine.query(&format!("rv_{table}"),Context::new(viewer,[("id".into(),Value::Id(id.into()))].into()).at(now));
            if let Ok(result) = result { if result.data != Value::Null {
                rows.insert(id.into(), Disclosure { fields: result.data.as_object().unwrap().keys().cloned().collect(), deadline: result.next_expiry });
            } }
        }
        out.insert((table.clone(),viewer.into()),rows);
    } }
    out
}
#[derive(Default)]
struct Counts { certified: usize, rows: usize, fields: usize, row_losses: usize, field_losses: usize, timed_losses: usize }
impl Counts {
    fn check(&mut self, before: &Answers, after: &Answers, preserved: &[String], label: &str) {
        for ((table,viewer), rows) in before {
            let remaining = &after[&(table.clone(),viewer.clone())];
            let safe = preserved.contains(table);
            self.certified += usize::from(safe);
            for (id, disclosed) in rows {
                let next = remaining.get(id);
                self.row_losses += usize::from(next.is_none());
                if let Some(next) = next { self.field_losses += disclosed.fields.difference(&next.fields).count(); }
                if safe {
                    self.rows += 1; self.fields += disclosed.fields.len();
                    let next = next.unwrap_or_else(|| panic!("row disclosure lost: {label} table={table} viewer={viewer} id={id}"));
                    assert!(disclosed.fields.is_subset(&next.fields),"field disclosure lost: {label} table={table} viewer={viewer} id={id} before={:?} after={:?}",disclosed.fields,next.fields);
                }
            }
        }
    }
    fn clock(&mut self, before: &Answers, after: &Answers, now: i64) {
        // Time has its own hard fence. A lost held answer must have published
        // a deadline; compare the following commit at the same advanced clock.
        for (key, rows) in before { for (id, old) in rows {
            if after[key].get(id).is_none_or(|new| !old.fields.is_subset(&new.fields)) {
                assert!(old.deadline.is_some_and(|d| d <= now),"unfenced clock loss: {key:?} {id} {old:?} now={now}");
                self.timed_losses += 1;
            }
        } }
    }
}
fn next(state: &mut u64) -> u64 { *state ^= *state << 13; *state ^= *state >> 7; *state ^= *state << 17; *state }

#[test]
fn certified_commits_preserve_rows_and_fields_across_the_corpus() {
    let mut sources = BTreeSet::new();
    for name in guide::KEYWORDS { for block in quarry(card(name).unwrap()) { sources.insert(guide_context::source(&block)); } }
    for source in [include_str!("fixtures/intent-clique.q"), include_str!("fixtures/read-through-clique.q"),
        include_str!("../../snapback4-core/tests/fixtures/expired-birth-cap.q"), OWNERS] { sources.insert(source.into()); }
    let seeds = SEEDS;
    let (mut schemas,mut commits,mut empty) = (0,0,0);
    let mut counts = Counts::default();
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
            let mut now = 25;
            for step in 0..32 {
                let previous = answer(&mut engine,&tables,now);
                now += [0, 25, 100, 10000][step % 4];
                let before = answer(&mut engine,&tables,now);
                counts.clock(&previous,&before,now);
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
                tx.record_commit(seq,now,"rv","system","model",&[table.clone()],1).unwrap();
                tx.commit().unwrap();
                let preserved = preserved_between(engine.store().conn(),&schema,seq-1,seq);
                // The shared codec must classify the persisted summary identically
                // to ordinary serde; no codec-specific authority may be invented.
                let stored: String = engine.store().conn().query_row("SELECT footprint FROM _change_evidence WHERE seq=?1",[seq as i64],|r|r.get(0)).unwrap();
                let ordinary: snapback4_core::revocation::Footprint = serde_json::from_str(&stored).unwrap();
                assert_eq!(preserved,ordinary.preserved(&schema),"summary decoder: seed={seed:#x} step={step}");
                let after = answer(&mut engine,&tables,now);
                commits += 1;
                counts.check(&before,&after,&preserved,&format!("seed={seed:#x} schema={schemas} step={step}"));
            }
        }
    }
    assert!(schemas > 30 && counts.rows > 1000 && counts.row_losses > 100 && counts.timed_losses > 100);
    println!("RV corpus: seeds={seeds:x?}; viewers={VIEWERS:?}; schemas={schemas}; no-durable-table schemas={empty}; commits={commits}; certified checks={}; retained rows={}; retained fields={}; row losses={}; field losses={}; deadline losses={}; failures=0",counts.certified,counts.rows,counts.fields,counts.row_losses,counts.field_losses,counts.timed_losses);
}

const OWNERS: &str = r#"
use personas alice, bob
table docs:
  owner: principal
  secret: int default 0 written by .owner
  public
  update <- allow
  sync public
query selected():
  row = docs['a']
  return row if row.secret = 42 else null
mutation transfer():
  update docs['a'] { owner: 'dev:bob' }
"#;
fn engine(source: &str) -> Engine {
    let bound = snapback4_lang::compile(&[("schema.q".into(),source.into())]);
    assert!(bound.diagnostics.is_empty(),"{:?}",bound.diagnostics);
    let points: Vec<_> = bound.schema.visible_tables().map(|(t,_)|program(t)).collect();
    Engine::memory(bound.schema,bound.programs.into_iter().map(|p|p.program).chain(points)).unwrap()
}
fn mutate(e: &mut Engine, op: &str, args: BTreeMap<String,Value>, now: i64) {
    let result = e.mutate(op,None,Context::new("dev:alice",args).at(now)).unwrap();
    assert!(matches!(result.state,snapback4_core::WriteState::Sent {..}),"{result:?}");
}
#[test]
fn ownership_transfer_cannot_certify_previously_disclosed_fields() {
    let mut e = engine(OWNERS);
    e.load_trusted([("docs".into(), snapback4_core::value::object([
        ("id",Value::Id("a".into())),("owner",Value::Id("dev:alice".into())),("secret",Value::Int(42))]))]).unwrap();
    let tables = vec!["docs".into()];
    let before = answer(&mut e,&tables,100);
    assert!(before[&("docs".into(),"dev:alice".into())]["a"].fields.contains("secret"));
    assert!(!before[&("docs".into(),"outsider".into())]["a"].fields.contains("secret"));
    let seq = e.seq().unwrap();
    mutate(&mut e,"transfer",BTreeMap::new(),100);
    let after = answer(&mut e,&tables,100);
    let preserved = preserved_between(e.store().conn(),e.schema(),seq,e.seq().unwrap());
    let mut counts = Counts::default();
    counts.check(&before,&after,&preserved,"P1 real mutation");
    assert_eq!(counts.field_losses,1);
    assert!(!preserved.contains(&"docs".into()));
    assert_eq!(e.query("selected",Context::new("dev:alice",BTreeMap::new()).at(100)).unwrap().data,Value::Null);
}

const MUTATIONS: &str = r#"
use personas alice, bob
table docs:
  owner: principal
  secret: int default 0 written by .owner
  rank: int
  active: bool
  until: time
  public
  insert <- allow
  update <- allow
  delete <- allow
  expire at .until
  sync public
query ranked():
  return docs where .active = true first 1 by .rank
mutation create(rank: int, until: time):
  insert docs { owner: viewer, rank, active: true, until }
mutation rank(id: docs, rank: int):
  update docs[id] { rank }
mutation active(id: docs, active: bool):
  update docs[id] { active }
mutation transfer(id: docs, owner: principal):
  update docs[id] { owner }
mutation lifetime(id: docs, until: time):
  update docs[id] { until }
mutation erase(id: docs):
  delete docs[id]
"#;
fn create(e: &mut Engine, id: &str, rank: i64, until: i64, now: i64) {
    let out = e.mutate("create",None,Context::new("dev:alice",[("rank".into(),Value::Int(rank)),("until".into(),Value::Int(until))].into()).with_ids([id.into()]).at(now)).unwrap();
    assert!(matches!(out.state,snapback4_core::WriteState::Sent {..}),"{out:?}");
}
fn ranked(e: &mut Engine, now: i64) -> Vec<String> {
    e.query("ranked",Context::new("dev:alice",BTreeMap::new()).at(now)).unwrap().data.as_array().unwrap().iter().map(|r|r.field("id").unwrap().as_str().unwrap().into()).collect()
}
#[test]
fn real_mutations_maintenance_and_ordered_limit_model() {
    let mut counts = Counts::default();
    let (mut commits,mut sweeps,mut displaced) = (0,0,0);
    for seed in SEEDS {
        let mut rng = seed;
        let mut e = engine(MUTATIONS);
        let tables = vec!["docs".into()];
        let mut now = 100;
        for (n,id) in IDS.iter().enumerate() { create(&mut e,id,n as i64,500,now); }
        for step in 0..128 {
            let previous = answer(&mut e,&tables,now);
            now += (next(&mut rng) % 80) as i64;
            let before = answer(&mut e,&tables,now);
            counts.clock(&previous,&before,now);
            let seq = e.seq().unwrap();
            let old_rank = ranked(&mut e,now);
            if step % 8 == 0 {
                e.sweep_expired(now,2).unwrap(); sweeps += 1;
            } else {
                let id = IDS[next(&mut rng) as usize % IDS.len()];
                if !before[&("docs".into(),"dev:alice".into())].contains_key(id) {
                    // Retire expired physical rows before reusing their ids.
                    e.sweep_expired(now,100).unwrap(); sweeps += 1;
                    create(&mut e,id,(next(&mut rng)%20) as i64,now+200,now);
                } else {
                    let (op,arg,value) = match next(&mut rng)%5 {
                        0 => ("rank","rank",Value::Int((next(&mut rng)%20) as i64)),
                        1 => ("active","active",Value::Bool(next(&mut rng)%2==0)),
                        2 => ("transfer","owner",Value::Id(if next(&mut rng)%2==0 {"dev:alice"} else {"dev:bob"}.into())),
                        3 => ("lifetime","until",Value::Int(now+200)),
                        _ => ("erase","id",Value::Id(id.into())),
                    };
                    mutate(&mut e,op,[("id".into(),Value::Id(id.into())),(arg.into(),value)].into(),now);
                }
            }
            let through = e.seq().unwrap(); commits += (through-seq) as usize;
            let preserved = preserved_between(e.store().conn(),e.schema(),seq,through);
            counts.check(&before,&answer(&mut e,&tables,now),&preserved,&format!("mutation seed={seed:#x} step={step}"));
            if preserved.contains(&"docs".into()) && old_rank != ranked(&mut e,now) { displaced += 1; }
        }
    }
    assert!(counts.fields > 100 && counts.field_losses > 0 && counts.timed_losses > 0 && displaced > 0);
    println!("RV mutations: seeds={SEEDS:x?}; steps=512; commits={commits}; maintenance_calls={sweeps}; preserving_limit_changes={displaced}; certified checks={}; retained rows={}; retained fields={}; row losses={}; field losses={}; deadline losses={}; failures=0",counts.certified,counts.rows,counts.fields,counts.row_losses,counts.field_losses,counts.timed_losses);
}

#[test]
fn filter_exit_limit_displacement_and_private_value_edits_preserve_disclosure() {
    let mut e = engine(MUTATIONS);
    let tables = vec!["docs".into()];
    create(&mut e,"a",10,10000,100); create(&mut e,"b",20,10000,100);
    for (op,args,want) in [
        ("rank",[("id".into(),Value::Id("b".into())),("rank".into(),Value::Int(0))].into(),vec!["b"]),
        ("active",[("id".into(),Value::Id("b".into())),("active".into(),Value::Bool(false))].into(),vec!["a"]),
    ] {
        let before = answer(&mut e,&tables,100); let seq = e.seq().unwrap();
        mutate(&mut e,op,args,100);
        let preserved = preserved_between(e.store().conn(),e.schema(),seq,e.seq().unwrap());
        assert!(preserved.contains(&"docs".into()),"{op}");
        Counts::default().check(&before,&answer(&mut e,&tables,100),&preserved,op);
        assert_eq!(ranked(&mut e,100),want);
    }
    for audience in [false,true] {
        let source = format!("{}\nmutation editSecret():\n  update docs['a'] {{ secret: 43 }}\n",if audience { OWNERS.replace("written by .owner","written by .owner readable by audience") } else { OWNERS.into() });
        let mut e = engine(&source);
        e.load_trusted([("docs".into(),snapback4_core::value::object([("id",Value::Id("a".into())),("owner",Value::Id("dev:alice".into())),("secret",Value::Int(42))]))]).unwrap();
        for op in if audience { vec!["editSecret","transfer"] } else { vec!["editSecret"] } {
            let before = answer(&mut e,&tables,100); let seq = e.seq().unwrap();
            mutate(&mut e,op,BTreeMap::new(),100);
            let preserved = preserved_between(e.store().conn(),e.schema(),seq,e.seq().unwrap());
            assert!(preserved.contains(&"docs".into()));
            Counts::default().check(&before,&answer(&mut e,&tables,100),&preserved,op);
        }
    }
}

#[test]
fn asset_and_once_consumption_cover_every_viewer() {
    use snapback4_core::assets::{Asset,AssetKind};
    let (mut commits,mut consumptions,mut access_checks) = (0,0,0);
    for seed in SEEDS { for kind in ["image <=1000 ?","video <=1000 ?","[[image <=1000] <=2] <=2 ?","[[image <=1000 once] <=2] <=2 ?","image <=1000 once"] {
        // A required image cannot be set to null; remove its home instead.
        let clear = if kind.ends_with(" ?") { "update docs['a'] { photo: null }" } else { "delete docs['a']" };
        let source = format!("use server\ntable docs:\n  photo: {kind}\n  public\n  insert <- allow\n  update <- allow\n  delete <- allow\nmutation place(photo: {argument}):\n  insert docs {{ photo }}\nmutation clear():\n  {clear}\n", argument=kind.replace(" once", ""));
        let mut e = engine(&source);
        let id = format!("asset-{seed:x}");
        e.store().record_asset(&Asset { id:id.clone(),owner:"dev:alice".into(),kind:if kind.starts_with("video") {AssetKind::Video} else {AssetKind::Image},content_type:"image/png".into(),bytes:24,width:Some(10),height:Some(10),duration:None,created_at:0,home:None,released_at:None }).unwrap();
        let asset = Value::Map(BTreeMap::from([("id".into(),Value::Id(id.clone()))]).into());
        let photo = if kind.starts_with("[[") {Value::Array(vec![Value::Array(vec![asset])])} else {asset};
        let out = e.mutate("place",None,Context::new("dev:alice",[("photo".into(),photo)].into()).with_ids(["a".into()]).at(100)).unwrap();
        assert!(matches!(out.state,snapback4_core::WriteState::Sent {..}),"{out:?}"); commits += 1;
        let mut rng = seed;
        let consumer = VIEWERS[next(&mut rng) as usize % VIEWERS.len()];
        for viewer in VIEWERS { assert!(e.asset_access(viewer,&id,100).is_ok()); access_checks += 1; }
        if kind.contains("once") {
            let tables = vec!["docs".into()];
            let before = answer(&mut e,&tables,100);
            let handles: Vec<_> = VIEWERS.iter().map(|viewer| e.query("rv_docs",Context::new(*viewer,[("id".into(),Value::Id("a".into()))].into()).at(100)).unwrap().data).collect();
            let seq = e.seq().unwrap();
            e.record_asset_view(consumer,&id,101).unwrap(); consumptions += 1;
            assert_eq!(e.seq().unwrap(),seq,"once consumption has no public row commit");
            let preserved = preserved_between(e.store().conn(),e.schema(),seq,seq);
            assert!(preserved.contains(&"docs".into()), "once consumption protects bytes, not row/field disclosure");
            let after = answer(&mut e,&tables,101);
            Counts::default().check(&before,&after,&preserved,"once consumption");
            for (viewer, handle) in VIEWERS.iter().zip(handles) {
                assert_eq!(e.query("rv_docs",Context::new(*viewer,[("id".into(),Value::Id("a".into()))].into()).at(101)).unwrap().data,handle,"consumption keeps handles and metadata");
                let result = e.asset_access(viewer,&id,101); access_checks += 1;
                if *viewer == consumer { assert_eq!(result.unwrap_err().code(),"E_ASSET_VIEWED"); } else { assert!(result.is_ok()); }
            }
        }
        let tables = vec!["docs".into()]; let before = answer(&mut e,&tables,101); let seq = e.seq().unwrap();
        mutate(&mut e,"clear",BTreeMap::new(),102); commits += 1;
        let preserved = preserved_between(e.store().conn(),e.schema(),seq,e.seq().unwrap());
        assert!(!preserved.contains(&"docs".into()));
        Counts::default().check(&before,&answer(&mut e,&tables,102),&preserved,"asset removal");
        for viewer in VIEWERS { assert_eq!(e.asset_access(viewer,&id,102).unwrap_err().code(),"E_ASSET_UNKNOWN"); access_checks += 1; }
        e.sweep_assets(1_000_000_000).unwrap();
    } }
    println!("RV assets: seeds={SEEDS:x?}; shapes=5; real_mutations={commits}; once_consumptions={consumptions}; access_checks={access_checks}; asset_sweeps=20; failures=0");
}
