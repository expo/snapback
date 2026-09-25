use super::*;

const NESTED: &str = r#"
table permits:
  roomId: id
  principal: principal
  unique byRoomPrincipal: roomId, principal
  read <- deny
table messages:
  roomId: id
  principal: principal
  body: text <=100
  by byRoom: roomId, id
  by byWords: roomId, words(body), id
  read <- exists permits[.roomId, viewer] and .principal = viewer and .body = 'coffee'
query plain(c: cursor ?):
  return messages['r'] after c first 10 by byRoom
query matching(c: cursor ?):
  return messages['r'] matching 'cof' after c first 10 by byWords
query merged(c: cursor ?):
  return merge messages matching 'cof' after c first 10 by byWords:
    ['r']
    ['visible']
"#;

fn compiled(source: &str) -> (Schema, Vec<Program>) {
    let bound = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    // This unit suite can inspect private runner state. The compiler uses
    // the library crate; round-trip its actual output into the test crate.
    let schema = serde_json::from_value(serde_json::to_value(bound.schema).unwrap()).unwrap();
    let programs = bound.programs.into_iter().map(|p| serde_json::from_value(serde_json::to_value(p.program).unwrap()).unwrap()).collect();
    (schema, programs)
}

fn observe(schema: &Schema, program: &Program, seed: Vec<(String, Value)>, cut: Cut, ceilings: Ceilings) -> Json {
    let mut engine = Engine::memory(schema.clone(), []).unwrap();
    engine.seed(seed).unwrap();
    let tx = engine.store_mut().transaction().unwrap();
    let mut runner = Runner::new(&tx, schema, Context::new("alice", BTreeMap::from([("c".into(), Value::Null)])).at(100), Meter::new(ceilings, cut), 0);
    let result = runner.run(program).and_then(|data| { runner.charge_output(&data)?; Ok(data) });
    let (data, error) = match result { Ok(data) => (crate::wire::to_json(&data), Json::Null), Err(error) => (Json::Null, json!(error.refusal())) };
    json!({"data":data,"error":error,"complete":runner.meter.capped_at.is_none() && runner.word_cut_at.is_none() && !runner.non_uniform && !runner.page_overflow && !runner.beyond_horizon,
        "next":runner.next_cursor().unwrap(),"capped_at":runner.meter.capped_at,"word_cut_at":runner.word_cut_at,"metered":runner.meter.used,"tables":runner.read_tables,"nextExpiry":runner.next_expiry})
}

fn nested_pair(merged: bool, boundary: bool) {
    let (schema, programs) = compiled(NESTED);
    assert!(matches!(&schema.tables["messages"].rules.read, RuleExpr::And(terms) if matches!(&terms[0], RuleExpr::And(_))), "exercise compiler-produced nesting");
    let mut failures = Vec::new();
    for program in programs.iter().filter(|p| (p.name == "merged") == merged) { for cut in [Cut::Cap, Cut::Abort] {
        let mut worlds = Vec::new();
        for population in [0, if merged { 33 } else { 1 }] {
            let mut seed = Vec::new();
            if merged {
                seed.push(("permits".into(), object([("id", Value::Id("permit".into())), ("roomId", Value::Id("visible".into())), ("principal", Value::Id("alice".into()))])));
                seed.push(("messages".into(), row("shown", "visible", "alice", "coffee")));
            }
            for n in 0..population { seed.push(("messages".into(), row(&format!("hidden{n}"), "r", "bob", &if merged { format!("cof{n:02}") } else { "coffee".into() }))); }
            let ceilings = Ceilings { examined: if boundary { if cut == Cut::Cap { 0 } else { 1 } } else { 8192 }, ..Ceilings::default() };
            worlds.push(observe(&schema, program, seed, cut, ceilings));
        }
        println!("R3 nested {} cut={cut:?} boundary={boundary}: W0={} W1={}", program.name, worlds[0], worlds[1]);
        if worlds[0] != worlds[1] { failures.push(format!("{} {cut:?}: W0={} W1={}", program.name, worlds[0], worlds[1])); }
        if !boundary {
            assert_eq!(worlds[0]["error"], Json::Null);
            assert_eq!(worlds[0]["data"].as_array().unwrap().len(), usize::from(merged));
            assert_eq!(worlds[0]["complete"], false);
            if merged { assert_eq!(worlds[0]["data"][0]["id"], "shown"); assert!(worlds[0]["next"].is_null()); }
        }
    }}
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

#[test]
fn r3_nested_conjunction_complete_observation() { nested_pair(false, false); }
#[test]
fn r3_nested_conjunction_examined_boundary() { nested_pair(false, true); }
#[test]
fn r3_nested_conjunction_33_words_preserve_later_row_without_shared_cursor() { nested_pair(true, false); }

#[test]
fn r3_admitted_word_bound_both_cuts_and_real_meter_ceiling() {
    let (schema, programs) = compiled(include_str!("../../../snapback4-sim/tests/search_merge/round3.q"));
    for cut in [Cut::Cap, Cut::Abort] { for budget in ["ample", "examined", "index_entries"] {
        let mut worlds = Vec::new();
        for population in [0, 33] {
            let mut seed = ["r1", "r2"].map(|room| ("members".into(), object([("id", Value::Id(room.into())), ("roomId", Value::Id(room.into())), ("principal", Value::Id("alice".into()))]))).to_vec();
            let message = |name: &str, room: &str, author: &str, body: &str| object([("id", Value::Id(name.into())), ("roomId", Value::Id(room.into())), ("authorId", Value::Id(author.into())), ("body", Value::String(body.into()))]);
            seed.push(("messages".into(), message("shown", "r2", "alice", "coffee")));
            for n in 0..population { seed.push(("messages".into(), message(&format!("hidden{n}"), "r1", "bob", &format!("cof{n:02}")))); }
            let ceilings = match budget { "examined" => Ceilings { examined: 10, ..Ceilings::default() }, "index_entries" => Ceilings { index_entries: 10, ..Ceilings::default() }, _ => Ceilings::default() };
            worlds.push(observe(&schema, &programs[0], seed, cut, ceilings));
        }
        println!("R3 admitted cut={cut:?} budget={budget}: W0={} W1={}", worlds[0], worlds[1]);
        assert_eq!(worlds[0], worlds[1], "hidden words cannot change any logical channel");
        if budget != "index_entries" {
            assert_eq!(worlds[0]["data"][0]["id"], "shown");
            assert_eq!(worlds[0]["complete"], false);
            assert!(worlds[0]["next"].is_null());
        } else if cut == Cut::Abort { assert_eq!(worlds[0]["error"]["code"], "E_BOUND"); }
        else { assert!(worlds[0]["capped_at"].is_array()); assert_eq!(worlds[0]["data"], json!([])); }

    }}
}
