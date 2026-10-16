use super::cases::Sources;
use snapback4_core::{Ceilings, Context, Engine, Value};
use snapback4_core::ir::{ArgType, Program, ProgramKind};
use snapback4_lang::{ast, bind::{catalog::Catalog, program::Binder}, Diagnostic};
use serde::{Deserialize, Serialize};
use serde_json::{Value as Json, json};
use std::collections::BTreeMap;

// NL deliberately refuses four historical programs that probe a nonunique
// role index without a unique key. Keep the old digests; pin refusal instead.
pub const NL_REFUSED: [&str; 4] = ["addMember", "send", "sendPhoto", "thread"];
pub const NL_SOURCE: &str = "df0100e9f8126097acd9ae5074a7758f8f9f5668bb5bae7a9e2ef192a6d52a68";

type Bind = fn(&Catalog, &str, &ast::ProgramDecl, &mut Vec<Diagnostic>) -> Option<snapback4_lang::BoundProgram>;

#[derive(Debug, Serialize, Deserialize, PartialEq)]
pub struct Record {
    // Keep the serializer's bytes, not a reparsed/reordered JSON object.
    pub ir: String,
    pub admission: Vec<Json>,
    pub observations: Vec<Json>,
}

pub fn baseline(catalog: &Catalog, module: &str, decl: &ast::ProgramDecl, diagnostics: &mut Vec<Diagnostic>) -> Option<snapback4_lang::BoundProgram> {
    let schema = snapback4_lang::bind::schema::bind_schema(catalog, diagnostics);
    Binder::bind(catalog, &schema, module, decl, diagnostics)
}

pub fn snapshot(inputs: BTreeMap<String, Sources>, binder: Bind, measure: bool) -> BTreeMap<String, Record> {
    // The golden census has eight ordinary test shards. Two workers per shard
    // keep its nested concurrency bounded while still using sixteen workers
    // when all shards are scheduled together.
    let worker_limit = 2;
    let workers = std::thread::available_parallelism().map_or(1, usize::from).min(worker_limit).min(inputs.len());
    if workers <= 1 {
        return snapshot_shard(inputs, binder, measure);
    }

    // Each source bundle builds an independent catalog and engine. Shard the
    // expensive golden census without changing the deterministic BTreeMap
    // result or the paired enabled/disabled observations.
    let mut shards: Vec<BTreeMap<String, Sources>> = (0..workers).map(|_| BTreeMap::new()).collect();
    for (index, (key, sources)) in inputs.into_iter().enumerate() {
        shards[index % workers].insert(key, sources);
    }
    std::thread::scope(|scope| {
        let handles: Vec<_> = shards.into_iter().map(|shard| scope.spawn(move || snapshot_shard(shard, binder, measure))).collect();
        let mut records = BTreeMap::new();
        for handle in handles {
            records.extend(handle.join().expect("lowering snapshot worker panicked"));
        }
        records
    })
}

fn snapshot_shard(inputs: BTreeMap<String, Sources>, binder: Bind, measure: bool) -> BTreeMap<String, Record> {
    let mut records = BTreeMap::new();
    for (key, sources) in inputs {
        let mut diagnostics = Vec::new();
        let documents = sources.iter().map(|(name, source)| {
            let (document, errors) = snapback4_lang::parse_document(name, source);
            diagnostics.extend(errors);
            document
        }).collect();
        if !diagnostics.is_empty() { assert!(!key.starts_with("generated-"), "{key}: {diagnostics:?}"); continue; }
        let catalog = Catalog::build(documents, &mut diagnostics);
        let schema = snapback4_lang::bind::schema::bind_schema(&catalog, &mut diagnostics);
        if !diagnostics.is_empty() { assert!(!key.starts_with("generated-"), "{key}: {diagnostics:?}"); }
        for doc in &catalog.documents {
            let module = std::path::Path::new(&doc.file).file_stem().unwrap().to_string_lossy();
            for decl in &doc.programs {
                let before = diagnostics.len();
                let bound = binder(&catalog, &module, decl, &mut diagnostics);
                if key == NL_SOURCE && NL_REFUSED.contains(&decl.name.as_str()) {
                    assert!(bound.is_none() && diagnostics[before..].iter().any(|d| d.code == "E_QUARRY_POINT_KEY"), "{key}/{}: {:?}", decl.name, &diagnostics[before..]);
                }
                let Some(bound) = bound else {
                    assert!(!key.starts_with("generated-"), "{key}: {diagnostics:?}");
                    // P18 changes source admission, not historical runtime IR.
                    // Retain the census key and compare the precise refusal in
                    // both ownership arms instead of erasing the old golden.
                    if matches!(decl.kind, snapback4_lang::ast::ProgramKind::Mutation | snapback4_lang::ast::ProgramKind::Query)
                        && diagnostics[before..].iter().any(|d|d.code == "E_QUARRY_IMMUTABLE") {
                        records.insert(format!("{key}:{}", decl.name), Record { ir: format!("source-refused:{}",serde_json::to_string(&diagnostics[before..]).unwrap()), admission: vec![], observations: vec![] });
                    }
                    continue;
                };
                let program = bound.program;
                if program.native || program.kind == ProgramKind::Job { continue; }
                let name = format!("{key}:{}", program.name);
                if !measure {
                    records.insert(name, Record { ir: serde_json::to_string(&program).unwrap(), admission: Vec::new(), observations: Vec::new() });
                    continue;
                }
                let mut schema = schema.clone();
                // Deliberately freeze residency policy. Its intended change
                // does not count as a lowering/admission difference.
                let mut fact = snapback4_lang::bind::residency::execution(&schema, &program);
                fact.connected_effects_only = false;
                fact.prediction_guards.clear();
                let mut admission = Vec::new();
                for policy in ["eligible", "never"] {
                    fact.predicts = Some(policy.into());
                    schema.operations.insert(program.name.clone(), fact.clone());
                    admission.push(serde_json::to_value(snapback4_core::engine::admission::check(&schema, &program).err().map(|e| e.refusal())).unwrap());
                }
                let mut observations = Vec::new();
                let worlds = if key.starts_with("generated-") || key == "gpt-pick" { 6 } else { 1 };
                // Replay the same deterministic calls on the same initial
                // fixture in each compiler arm. Generated cases start with
                // two rows; census programs start empty. Reusing the engine
                // also compares the effects of successful earlier calls.
                let seed = key.starts_with("generated-");
                let mut shared = Engine::memory(schema.clone(), [program.clone()]).ok();
                if seed && let Some(engine) = shared.as_mut() {
                    engine.seed((0..2).map(|n| ("notes".into(), snapback4_core::value::object([
                        ("id", Value::Id(format!("seed{n}"))), ("n", Value::Int(n)),
                    ])))).unwrap();
                }
                for world in 0..worlds {
                    for steps in [10, 28, 34, 2000] {
                        observations.push(observe(&schema, &program, world, steps, shared.as_mut()));
                    }
                }
                records.insert(name, Record { ir: serde_json::to_string(&program).unwrap(), admission, observations });
            }
        }
    }
    records
}

fn observe(schema: &snapback4_core::Schema, program: &Program, world: usize, steps: u64, shared: Option<&mut Engine>) -> Json {
    let mut fresh;
    let engine = if let Some(engine) = shared { engine } else {
        fresh = match Engine::memory(schema.clone(), [program.clone()]) {
            Ok(engine) => engine,
            Err(error) => return json!({"engine": error.refusal()}),
        };
        &mut fresh
    };
    engine.set_ceilings(Ceilings { steps, ..Ceilings::default() });
    let args = program.args.iter().map(|(name, kind)| (name.clone(), value(kind, world))).collect();
    let context = Context::new("A", args).at(1000).with_entropy(1).with_ids((0..2048).map(|n| format!("{n:026}")));
    match program.kind {
        ProgramKind::Mutation => match engine.mutate(&program.name, None, context) {
            Ok(outcome) => serde_json::to_value(outcome).unwrap(),
            Err(error) => json!({"error":error.refusal()}),
        },
        ProgramKind::Query => match engine.query(&program.name, context) {
            Ok(outcome) => serde_json::to_value(outcome).unwrap(),
            Err(error) => json!({"error":error}),
        },
        _ => unreachable!(),
    }
}

fn value(kind: &ArgType, world: usize) -> Value {
    match kind {
        ArgType::Bool => Value::Bool(world % 2 != 0),
        ArgType::Int => Value::Int(world as i64 - 1),
        ArgType::Text { min, .. } => Value::String("x".repeat((*min).max(1) as usize)),
        ArgType::Id | ArgType::Principal | ArgType::Ref { .. } => Value::Id("A".into()),
        ArgType::Time => Value::Int(1000),
        ArgType::Optional(inner) => if world % 3 == 0 { Value::Null } else { value(inner, world) },
        ArgType::List { .. } => Value::Array(Vec::new()),
        ArgType::Enum { variants } => Value::String(variants[0].clone()),
        _ => Value::Null,
    }
}
