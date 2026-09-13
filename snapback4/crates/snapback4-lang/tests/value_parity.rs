//! R16: the same authored IR, inputs and confirmed rows on both real hosts.
use serde_json::{Value as Json, json};
use snapback4_core::{Context, Engine, WriteState, ir::ProgramKind, value::I53_MAX, wire};
use snapback4_lang::{Bound, compile};
use std::{collections::BTreeMap, path::PathBuf, process::Command};

fn bound(source: &str) -> Bound {
    let bound = compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    bound
}

fn state(engine: &Engine) -> Json {
    Json::Object(engine.schema().tables.keys().map(|table| {
        let rows = engine.store().rows(table).unwrap().into_iter().map(|row| {
            (row.field("id").unwrap().as_str().unwrap().to_owned(), wire::to_json(&row))
        }).collect();
        (table.clone(), Json::Object(rows))
    }).collect())
}

fn vector(bound: &Bound, seeds: &[(&str, Json)], name: &str, args: Json) -> Json {
    let program = bound.programs.iter().find(|p| p.program.name == name).unwrap().program.clone();
    let mut engine = Engine::memory(bound.schema.clone(), bound.programs.iter().map(|p| p.program.clone())).unwrap();
    engine.seed(seeds.iter().map(|(table, row)| {
        ((*table).to_owned(), wire::row_from_json(bound.schema.table(table).unwrap(), row).unwrap())
    })).unwrap();
    // A replica begins with the same confirmed rows, including server-maintained
    // targets. Test execution, not a second seeding implementation, is compared.
    let before = state(&engine);
    let inputs = args.as_object().unwrap().iter().map(|(name, value)| {
        (name.clone(), wire::from_json(&program.args[name], value).unwrap())
    }).collect::<BTreeMap<_, _>>();
    let context = Context::new("dev:alice", inputs).at(1).with_ids(["minted-id".to_owned()]);
    let outcome = if program.kind == ProgramKind::Query {
        match engine.query(name, context) {
            Ok(out) => json!({"result": wire::to_json(&out.data), "complete": out.complete, "next": out.next}),
            Err(why) => json!({"error": why.code}),
        }
    } else {
        match engine.mutate(name, None, context).unwrap().state {
            WriteState::Sent { result, .. } => json!({"result": wire::to_json(&result)}),
            WriteState::Failed { why, .. } => json!({"error": why.code}),
            other => panic!("{other:?}"),
        }
    };
    json!({"name": name, "schema": bound.schema, "program": program, "args": args, "before": before,
        "expected": {"outcome": outcome, "after": state(&engine)}})
}

struct Scratch(PathBuf);
impl Drop for Scratch {
    fn drop(&mut self) { let _ = std::fs::remove_dir_all(&self.0); }
}

fn compare_typescript(vectors: &[Json]) {
    let nonce = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
    let scratch = Scratch(std::env::temp_dir().join(format!("sb4-values-{}-{nonce}", std::process::id())));
    std::fs::create_dir(&scratch.0).unwrap();
    std::fs::write(scratch.0.join("vectors.json"), serde_json::to_vec(vectors).unwrap()).unwrap();
    let result = Command::new("bun").args(["--eval", r#"
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Interpreter, Refused } from './packages/snapback4/src/replica/interpreter.ts';
import { MemoryStore } from './packages/snapback4/src/replica/store.ts';
for (const v of JSON.parse(readFileSync(process.env.SB4_VALUE_VECTORS, 'utf8'))) {
  const store = new MemoryStore(v.schema);
  await store.write(async tx => {
    for (const [table, rows] of Object.entries(v.before)) for (const row of Object.values(rows)) await tx.put(table, row);
  });
  const mode = v.program.kind === 'Query' ? 'query' : 'mutation';
  const ctx = {viewer: 'dev:alice', args: v.args, now: 1, newIds: [], mint: () => 'minted-id'};
  let outcome;
  try {
    const out = await store[mode === 'query' ? 'read' : 'write'](tx => new Interpreter(tx, v.schema, ctx, mode).run(v.program));
    outcome = mode === 'query' ? {result: out.data, complete: out.complete, next: out.next} : {result: out.data};
  } catch (error) {
    if (!(error instanceof Refused)) throw error;
    outcome = {error: error.refusal.code};
  }
  const after = await store.read(async tx => {
    const tables = {};
    for (const table of Object.keys(v.schema.tables)) {
      const rows = await tx.scan(table, 'byId', [], {}, 'asc', 1000);
      tables[table] = Object.fromEntries(rows.map(({row}) => {
        // Pending is the device's write-state annotation, not a stored value
        // disagreement. Keep every schema field and canonical row id intact.
        const {pending, ...confirmed} = row;
        return [row.id, confirmed];
      }));
    }
    return tables;
  });
  assert.deepEqual({outcome, after}, v.expected, `${v.name} ${JSON.stringify(v.args)}`);
  await store.close();
}
"#]).env("SB4_VALUE_VECTORS", scratch.0.join("vectors.json"))
        .current_dir(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")).output().unwrap();
    assert!(result.status.success(), "{}{}", String::from_utf8_lossy(&result.stdout), String::from_utf8_lossy(&result.stderr));
}

const ORDERING: &str = r#"
table words:
  lane: text <=8
  word: text <=16
  nested: json <=1000
  by byWord: word, id
  by byLaneWord: lane, word, id
  read <- allow
  sync public
query sorted():
  return sort(words[] first 10 by byId, 'nested')
query shaped():
  return sort([{key: [{text: '𐀀'}], label: 'astral'}, {key: [{text: ''}], label: 'bmp'}, {key: [{text: 'z'}], label: 'ascii'}], 'key')
query compare(a: json <=1000, b: json <=1000):
  return { less: a < b, minimum: min(a, b), maximum: max(a, b) }
query page(c: cursor ?):
  return words[] after c first 1 by byWord
query merged(c: cursor ?):
  return merge words after c first 1 by byLaneWord:
    ['a']
    ['b']
"#;

#[test]
fn nested_unicode_sorting_and_scan_merge_cursors_match_rust() {
    let bound = bound(ORDERING);
    let seeds = [
        ("words", json!({"id":"astral", "lane":"a", "word":"\u{10000}", "nested":{"a":[{"x":"\u{10000}"}]}})),
        ("words", json!({"id":"bmp", "lane":"b", "word":"\u{e000}", "nested":{"a":[{"x":"\u{e000}"}]}})),
        ("words", json!({"id":"ascii", "lane":"a", "word":"z", "nested":{"a":[{"x":"z"}]}})),
    ];
    let mut vectors = Vec::new();
    for name in ["sorted", "shaped"] {
        let v = vector(&bound, &seeds, name, json!({}));
        let field = if name == "sorted" { "id" } else { "label" };
        assert_eq!(v["expected"]["outcome"]["result"].as_array().unwrap().iter().map(|row| row[field].as_str().unwrap()).collect::<Vec<_>>(), ["ascii", "bmp", "astral"]);
        vectors.push(v);
    }
    let a = json!([{"\u{10000}": [0]}]);
    let b = json!([{"\u{e000}": [1]}]);
    let v = vector(&bound, &seeds, "compare", json!({"a":a, "b":b}));
    assert_eq!(v["expected"]["outcome"]["result"], json!({"less":false,"minimum":b,"maximum":a}));
    vectors.push(v);
    for name in ["page", "merged"] {
        let mut cursor = Json::Null;
        for (position, id) in ["ascii", "bmp", "astral"].iter().enumerate() {
            let v = vector(&bound, &seeds, name, json!({"c":cursor}));
            assert_eq!(v["expected"]["outcome"]["result"][0]["id"], *id);
            cursor = v["expected"]["outcome"]["next"].clone();
            assert_eq!(cursor.is_null(), position == 2);
            vectors.push(v);
        }
    }
    compare_typescript(&vectors);
}

const MAINTAINS: &str = r#"
table groups:
  read <- allow
  sync public
table items:
  category: text <=10
  owner: ref groups
  amount: int
  read <- allow
  insert <- allow
  update <- allow
  sync public
maintain textCounts: count items by category
  read <- allow
maintain refCounts: count items by owner
  read <- allow
maintain pairCounts: count items by category, owner
  read <- allow
maintain sums: sum items of amount by category
  read <- allow
mutation add(category: text <=10, owner: ref groups, amount: int):
  insert items {id: 'new-item', category, owner, amount}
  return 0
mutation move():
  update items['old-item'] {category: 'other', owner: 'other', amount: 2}
  return 0
"#;

#[test]
fn typed_maintained_ids_and_sum_overflow_match_rust_and_rollback() {
    let bound = bound(MAINTAINS);
    let mut seeds = vec![("groups", json!({"id":"g"})), ("groups", json!({"id":"other"})),
        ("items", json!({"id":"old-item","category":"g","owner":"g","amount":1}))];
    let mut vectors = Vec::new();
    let added = vector(&bound, &seeds, "add", json!({"category":"g","owner":"g","amount":2}));
    assert_eq!(added["expected"]["outcome"], json!({"result":0}));
    for (table, id) in [("textCounts", r#"[{"String":"g"}]"#), ("refCounts", r#"[{"Id":"g"}]"#), ("pairCounts", r#"[{"String":"g"},{"Id":"g"}]"#)] {
        let rows = added["expected"]["after"][table].as_object().unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[id]["value"], 2);
    }
    assert_eq!(added["expected"]["after"]["sums"][r#"[{"String":"g"}]"#]["value"], 3);
    vectors.push(added);
    let moved = vector(&bound, &seeds, "move", json!({}));
    assert_eq!(moved["expected"]["outcome"], json!({"result":0}));
    assert_eq!(moved["expected"]["after"]["pairCounts"][r#"[{"String":"other"},{"Id":"other"}]"#]["value"], 1);
    vectors.push(moved);
    for (initial, amount) in [(I53_MAX - 1, 1), (I53_MAX, 1), (-I53_MAX, -1)] {
        seeds[2].1["amount"] = json!(initial);
        let v = vector(&bound, &seeds, "add", json!({"category":"g","owner":"g","amount":amount}));
        if initial == I53_MAX - 1 {
            assert_eq!(v["expected"]["outcome"], json!({"result":0}));
            assert_eq!(v["expected"]["after"]["sums"][r#"[{"String":"g"}]"#]["value"], I53_MAX);
        } else {
            assert_eq!(v["expected"]["outcome"], json!({"error":"E_OVERFLOW"}));
            assert_eq!(v["expected"]["after"], v["before"], "all source and aggregate writes roll back");
        }
        vectors.push(v);
    }
    compare_typescript(&vectors);
}

#[test]
fn checked_nested_sums_arithmetic_and_negative_divisors_match_rust() {
    let bound = bound("query add(a: int, b: int):\n  return a + b\nquery subtract(a: int, b: int):\n  return a - b\nquery multiply(a: int, b: int):\n  return a * b\nquery summed(values: [int] <=4):\n  return sum(values)\nquery divided(a: int, b: int):\n  (quotient, remainder) = divmod(a, b)\n  return {quotient, remainder}\n");
    let mut vectors = Vec::new();
    for (name, a, b) in [("add", I53_MAX, 1), ("subtract", -I53_MAX, 1), ("multiply", I53_MAX, 2)] {
        let v = vector(&bound, &[], name, json!({"a":a,"b":b}));
        assert_eq!(v["expected"]["outcome"], json!({"error":"E_OVERFLOW"}));
        vectors.push(v);
    }
    let v = vector(&bound, &[], "add", json!({"a":I53_MAX-1,"b":1}));
    assert_eq!(v["expected"]["outcome"]["result"], I53_MAX);
    vectors.push(v);
    for values in [json!([I53_MAX, 1]), json!([-I53_MAX, -1]), json!([I53_MAX, 1, -1])] {
        let v = vector(&bound, &[], "summed", json!({"values":values}));
        if values.as_array().unwrap().len() == 3 { assert_eq!(v["expected"]["outcome"]["result"], I53_MAX); }
        else { assert_eq!(v["expected"]["outcome"], json!({"error":"E_OVERFLOW"})); }
        vectors.push(v);
    }
    for (a, b, quotient, remainder) in [(-7, -3, 3, 2), (7, -3, -2, 1), (-7, 3, -3, 2)] {
        let v = vector(&bound, &[], "divided", json!({"a":a,"b":b}));
        assert_eq!(v["expected"]["outcome"]["result"], json!({"quotient":quotient,"remainder":remainder}));
        vectors.push(v);
    }
    compare_typescript(&vectors);
}

#[test]
fn list_maintained_groups_are_rejected_at_the_authored_schema_boundary() {
    // A maintain needs a unique index over its group, and list columns are
    // deliberately not indexable. Do not prove parity using an invalid schema.
    for kind in ["text <=10", "ref groups"] {
        let source = format!("table groups:\n  read <- allow\ntable items:\n  labels: [{kind}] <=4\n  read <- allow\nmaintain counts: count items by labels\n  read <- allow\n");
        let rejected = compile(&[("schema.q".into(), source)]);
        assert!(rejected.diagnostics.iter().any(|d| d.message.contains("cannot be indexed")), "{:?}", rejected.diagnostics);
    }
}
