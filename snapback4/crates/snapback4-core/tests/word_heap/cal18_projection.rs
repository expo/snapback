//! Store-boundary projection experiment, deliberately not an interpreter path.
//! @ref LLP 3000.011.001.001#5 — avoid allocating unused payload before deciding whether capacity improved.
use super::*;
use serde::de::{self, DeserializeSeed, EnumAccess, MapAccess, VariantAccess, Visitor};
use snapback4_core::{Context, Engine, Value, wire};
use std::{collections::BTreeMap, fmt, time::Instant};

const FIELDS: &[&str] = &["id","conversationId","senderId","at","expiresAt","tombstone"];
struct Project;
struct Fields;
struct Name;
impl<'de> DeserializeSeed<'de> for Project {
    type Value = Value;
    fn deserialize<D: de::Deserializer<'de>>(self,d: D) -> Result<Value,D::Error> { d.deserialize_enum("Value",&["Row"],self) }
}
impl<'de> Visitor<'de> for Project {
    type Value = Value;
    fn expecting(&self,f: &mut fmt::Formatter) -> fmt::Result { f.write_str("a stored Row") }
    fn visit_enum<A: EnumAccess<'de>>(self,data: A) -> Result<Value,A::Error> {
        let (tag,value) = data.variant::<String>()?;
        if tag != "Row" { return Err(de::Error::custom("expected stored Row")); }
        value.newtype_variant_seed(Fields)
    }
}
impl<'de> DeserializeSeed<'de> for Fields {
    type Value = Value;
    fn deserialize<D: de::Deserializer<'de>>(self,d: D) -> Result<Value,D::Error> { d.deserialize_map(self) }
}
impl<'de> Visitor<'de> for Fields {
    type Value = Value;
    fn expecting(&self,f: &mut fmt::Formatter) -> fmt::Result { f.write_str("stored row fields") }
    fn visit_map<A: MapAccess<'de>>(self,mut map: A) -> Result<Value,A::Error> {
        let mut fields = BTreeMap::new();
        while let Some(name) = map.next_key_seed(Name)? {
            if let Some(name) = name { fields.insert(name.to_owned(),map.next_value::<Value>()?); }
            else { map.next_value::<de::IgnoredAny>()?; }
        }
        Ok(Value::Row(fields.into()))
    }
}
impl<'de> DeserializeSeed<'de> for Name {
    type Value = Option<&'static str>;
    fn deserialize<D: de::Deserializer<'de>>(self,d: D) -> Result<Self::Value,D::Error> { d.deserialize_str(self) }
}
impl Visitor<'_> for Name {
    type Value = Option<&'static str>;
    fn expecting(&self,f: &mut fmt::Formatter) -> fmt::Result { f.write_str("a column name") }
    fn visit_str<E: de::Error>(self,name: &str) -> Result<Self::Value,E> { Ok(FIELDS.iter().find(|field|**field == name).copied()) }
}

fn projected(tx: &snapback4_core::store::Tx<'_>,prefix: &[Value],bounds: &rows::Bounds,limit: usize) -> Vec<(Value,Vec<u8>)> {
    let (lo,hi) = rows::scan_range(prefix,bounds,rows::Dir::Asc).unwrap();
    let num = |name: &str| tx.conn().query_row("SELECT num FROM _catalog WHERE name = ?1",[name],|row|row.get::<_,i64>(0)).unwrap();
    let mut statement = tx.conn().prepare_cached(SQL).unwrap();
    let mut cursor = statement.query(rusqlite::params![num("messages"),num("messages.byConversation"),lo,hi,limit as i64]).unwrap();
    let mut rows = Vec::new();
    while let Some(row) = cursor.next().unwrap() {
        // Borrow SQLite's image. Ignored fields are parsed/skipped, never
        // allocated as Values and never copied into an intermediate String.
        let raw = row.get_ref(0).unwrap().as_str().unwrap();
        let mut parser = serde_json::Deserializer::from_str(raw);
        let value = Project.deserialize(&mut parser).unwrap(); parser.end().unwrap();
        rows.push((value,row.get::<_,Vec<u8>>(1).unwrap()));
    }
    rows
}

fn result(rows: Vec<(Value,Vec<u8>)>) -> (usize,u64) {
    let own = "a".repeat(31);
    let eligible = rows.iter().filter(|(r,_)|r.field("senderId").unwrap().as_str().unwrap() != own
        && r.field("at").unwrap().as_int().unwrap() > 0 && r.field("tombstone").unwrap() == &Value::Bool(false)
        && r.field("expiresAt").unwrap() == &Value::Null).count();
    (eligible,rows.iter().map(|(r,_)|fixture_heap(&r)).sum())
}

#[test]
#[ignore = "async lane: 41 paired store projection allocation samples"]
fn matched_period_projection_avoids_rust_payload_but_does_not_prove_engine_capacity() {
    configure_sqlite_probe();
    // Reuse the retained experiment's exact schema/expression, not a new count
    // language or adapter. The named workload has 5,000 candidates/4,900 hits.
    let source = include_str!("../../../snapback4-sim/tests/digest_count.q");
    let b = snapback4_lang::compile(&[("schema.q".into(),source.into())]);
    assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
    let mut e = Engine::memory(b.schema,b.programs.into_iter().map(|p|p.program)).unwrap();
    e.set_ceilings(meter::Ceilings::job());
    let seed: Vec<_> = (0..5000).map(|n|("messages".into(),wire::row_from_json(e.schema().table("messages").unwrap(),&serde_json::json!({
        "id":format!("m{n:011}"),"conversationId":"chat0","senderId":if n%50==0 {"a".repeat(31)} else {"b".repeat(31)},"body":"x".repeat(31),
        "expiresAt":null,"edited":false,"tombstone":false,"replyTo":null,"at":15000,
        "recipients":(0..50).map(|i|match i { 0=>"a".repeat(31),1=>"b".repeat(31),_=>format!("recipient{i:022}") }).collect::<Vec<_>>()
    })).unwrap())).collect();
    let min = seed.iter().map(|(_,row)|value::canonical_json(row).len()).min().unwrap();
    let max = seed.iter().map(|(_,row)|value::canonical_json(row).len()).max().unwrap();
    let raw_bytes = seed.iter().map(|(_,row)|value::canonical_json(row).len()).sum::<usize>();
    e.load(seed).unwrap();
    let args = [("conversationId".into(),Value::Id("chat0".into())),("principal".into(),Value::Id("a".repeat(31))),
        ("periodStart".into(),Value::Int(10000)),("periodEnd".into(),Value::Int(20000)),("readAt".into(),Value::Int(0))].into();
    let control = e.query("countPeriod",Context::new(&"a".repeat(31),args).at(20000)).unwrap();
    assert_eq!(control.data,Value::Null); assert!(!control.complete);
    assert!(control.metered.heap_bytes > meter::Ceilings::job().heap_bytes);
    println!("CAL18 projection engine control: {:?}, rawJsonBytes={raw_bytes}",control.metered);
    let tx = e.store_mut().read_transaction().unwrap();
    let prefix = [Value::Id("chat0".into())];
    let bounds = rows::Bounds {gte:Some(Value::Int(10000)),lt:Some(Value::Int(20000)),..Default::default()};
    let control = ||tx.scan("messages","byConversation",&prefix,&bounds,rows::Dir::Asc,5001).unwrap();
    let candidate = ||projected(&tx,&prefix,&bounds,5001);
    let full = control(); let reduced = candidate();
    assert_eq!(full.len(),5000); assert_eq!(reduced.len(),5000);
    for ((row,key),(small,small_key)) in full.iter().zip(&reduced) {
        assert_eq!(key,small_key);
        for name in FIELDS { assert_eq!(row.field(name),small.field(name)); }
        assert!(small.field("body").is_err() && small.field("recipients").is_err());
    }
    drop(full); drop(reduced);
    // Predeclared: 41 samples per arm, nearest-rank p95 = sorted sample 39.
    // Alternate AB/BA within every pair after one warm validation per arm;
    // keep every observation, including slow trials. No timed assertion/gate.
    const N: usize = 41;
    let mut times: [Vec<u128>;2] = [Vec::new(),Vec::new()];
    for sample in 0..N {
        for arm in if sample%2==0 {[0,1]} else {[1,0]} {
            let start = Instant::now();
            let ((eligible,heap),rust,native,payload) = measured_sqlite_range(min,max,||result(if arm==0 {control()} else {candidate()}));
            let micros = start.elapsed().as_micros(); times[arm].push(micros);
            assert_eq!(eligible,4900);
            println!("CAL18 projection sample={sample} arm={} eligible={eligible} decodedHeap={heap} rustAllocated={rust} sqliteAllocated={native} sqlitePayloadAllocated={payload} micros={micros}",if arm==0 {"full"} else {"projected"});
        }
    }
    for (arm,times) in times.iter_mut().enumerate() {
        times.sort_unstable();
        println!("CAL18 projection summary arm={arm} n={N} median_us={} p95_nearest_rank_us={} max_us={}",times[N/2],times[(95*N).div_ceil(100)-1],times[N-1]);
    }
    // This candidate has no rule/dependency/coverage proof or complete meter.
    // Reusing the existing conservative SQLite payload allowance still costs
    // two row/key payload copies per visit, before projected Values or filters.
    // A smaller decoded result alone cannot justify waiving that allowance.
    let raw_keys: usize = control().iter().map(|(_,key)|key.len()).sum();
    let storage_allowance = 2*(raw_bytes+raw_keys)+64*5000;
    println!("CAL18 projection store_payload_allowance={storage_allowance} job_heap_ceiling={}",meter::Ceilings::job().heap_bytes);
    assert!(storage_allowance as u64 > meter::Ceilings::job().heap_bytes);
    tx.rollback().unwrap();
}

// Test-only sizing of public fixture/expression results; no raw pricing API is
// available to interpreter callers.
fn fixture_heap(value: &Value) -> u64 {
    match value {
        Value::String(s) | Value::Id(s) => s.capacity() as u64,
        Value::Bytes(b) => b.capacity() as u64,
        Value::Array(a) => a.capacity() as u64 * std::mem::size_of::<Value>() as u64 + a.iter().map(fixture_heap).sum::<u64>(),
        Value::Row(m) | Value::Map(m) => 40 + m.iter().map(|(k,v)| 80 + k.capacity() as u64 + fixture_heap(v)).sum::<u64>(),
        _ => 0,
    }
}
