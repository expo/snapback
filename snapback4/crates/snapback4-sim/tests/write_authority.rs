//! LLP 3000.007 §15: paired hidden worlds, complete /m envelopes, durable
//! retries, effects and partition observations. Physical timing is not asserted.
#[path = "common/write_observation.rs"]
mod observation;
use observation::{Observation, observe};
use snapback4_core::{Context, Engine, MutationOutcome, Value, WriteState, wire};
use serde_json::{Value as Json, json};
use std::collections::BTreeMap;

const SOURCE: &str = r#"
table records:
  key: text <=80
  owner: principal
  secret: text <=80
  frozen: text <=80
  amount: int
  photo: image <=1000 ?
  unique byKey: key
  by byOwner: owner, id
  immutable frozen
  read <- .owner = viewer
  insert <- .owner = viewer
  update <- allow
  sync to .owner last 100 by byOwner
mutation edit(key: text <=80):
  return update records[key] {amount: 0}
mutation editId(target: records):
  return update records[target] {amount: 0}
mutation conditional(key: text <=80, expected: int):
  return update records[key] {amount: 0} if .amount = expected
mutation immutable(key: text <=80, guess: text <=80):
  return update records[key] {frozen: guess}
mutation put(key: text <=80):
  return upsert records[key] {amount: 0}
mutation full(key: text <=80):
  return upsert records[key] {owner: 'alice', secret: 'supplied', frozen: 'fixed', amount: 0}
mutation add(key: text <=80):
  return insert records {key, owner: viewer, secret: 'supplied', frozen: 'fixed', amount: 0}
mutation quiet(key: text <=80):
  return insert records {key, owner: viewer, secret: 'supplied', frozen: 'fixed', amount: 0} if absent
query one(key: text <=80):
  return records[key]
"#;
fn compile(source: &str) -> snapback4_lang::Bound {
    let b = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    b
}
fn engine(source: &str) -> Engine {
    let b = compile(source);
    Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap()
}
fn row(id: &str, key: &str, owner: &str, amount: i64, secret: &str) -> Json {
    json!({"id":id,"key":key,"owner":owner,"amount":amount,"secret":secret,"frozen":"fixed","photo":null})
}
fn seed(e: &mut Engine, table: &str, rows: Vec<Json>) {
    let rows = rows.iter().map(|r| (table.into(), wire::row_from_json(e.schema().table(table).unwrap(), r).unwrap())).collect::<Vec<_>>();
    e.seed(rows).unwrap();
}
fn world(source: &str, hidden: bool, amount: i64) -> Engine {
    let mut e = engine(source);
    // Same sequence and caller-readable state, including when the target is absent.
    seed(&mut e, "records", vec![if hidden { row("target", "lookup", "alice", amount, "PRIVATE") } else { row("decoy", "elsewhere", "alice", amount, "PRIVATE") }]);
    e
}
fn args(e: &Engine, name: &str, values: Json) -> BTreeMap<String, Value> {
    let program = e.programs().find(|p| p.name == name).unwrap();
    values.as_object().unwrap().iter().map(|(k,v)| (k.clone(), wire::from_json(&program.args[k], v).unwrap())).collect()
}
fn call(e: &mut Engine, name: &str, viewer: &str, values: Json, op: &str) -> MutationOutcome {
    let result = e.mutate(name, Some(op), Context::new(viewer, args(e, name, values)).at(1000).with_ids(["fresh".into(), "effect".into()])).unwrap();
    if !result.replayed {
        let receipt = result.receipt(Some(op));
        assert_eq!(recorded(e, viewer, op), receipt);
        assert_eq!(e.replay(viewer, op).unwrap().unwrap().reply(Some(op)), receipt);
    }
    result
}
fn value(e: &mut Engine, viewer: &str) -> Value {
    e.query("one", Context::new(viewer, args(e, "one", json!({"key":"lookup"}))).at(1000)).unwrap().data
}
fn recorded(e: &Engine, viewer: &str, op: &str) -> Json {
    let text = e.store().applied_outcome(viewer, op).unwrap().unwrap();
    serde_json::from_str(&text).unwrap()
}
fn observed(e: &mut Engine, name: &str, viewer: &str, values: Json, op: &str) -> (MutationOutcome, Observation) {
    let query = if e.programs().any(|p| p.name == "one") { ("one", json!({"key":"lookup"})) } else { ("page", json!({"owner":values["owner"],"c":null})) };
    observe(e, name, viewer, values, op, query)
}
fn equal_observations(observations: &[Observation]) {
    assert!(observations.len() >= 2);
    for pair in observations.windows(2) { pair[0].assert_same(&pair[1]); }
}
fn unchanged_pair(source: &str, name: &str, values: Json, hidden_amount: i64) -> Json {
    let mut observations = Vec::new();
    for mut e in [world(source, false, 7), world(source, true, hidden_amount)] {
        assert_eq!(value(&mut e, "bob"), Value::Null);
        let (_, observation) = observed(&mut e, name, "bob", values.clone(), "same");
        observation.assert_unchanged();
        assert_eq!(observation.body()["why"]["code"], "NOT_FOUND");
        assert!(observation.body().get("current").is_none());
        observations.push(observation);
    }
    equal_observations(&observations);
    observations[0].body()
}

#[test]
fn s05_insert_and_insert_if_absent_on_a_hidden_unique_clash_stay_e_rule() {
    for name in ["add", "quiet"] {
        let mut replies = Vec::new();
        for hidden_secret in ["FIRST", "SECOND"] {
            let mut e = engine(SOURCE);
            seed(&mut e, "records", vec![row("target", "lookup", "alice", 7, hidden_secret)]);
            let before = e.store().rows("records").unwrap();
            let (result, observation) = observed(&mut e, name, "bob", json!({"key":"lookup"}), "same");
            assert_eq!(result.reply(Some("same"))["why"]["code"], "E_RULE");
            assert_eq!(e.store().rows("records").unwrap(), before);
            replies.push(observation);
        }
        equal_observations(&replies);
        let mut e = engine(SOURCE);
        assert!(matches!(call(&mut e, name, "bob", json!({"key":"free"}), "positive").state, WriteState::Sent { .. }));
    }
}
#[test]
fn s05_a_readable_clash_still_names_the_index() {
    let mut observations = Vec::new();
    for clash in [true, false] {
        let mut e = world(SOURCE, clash, 7);
        let (_, observation) = observed(&mut e, "add", "alice", json!({"key":"lookup"}), "same");
        if clash {
            assert_eq!(observation.body()["why"]["code"], "E_CONSTRAINT");
            assert!(observation.body()["why"]["message"].as_str().unwrap().contains("records.byKey"));
            assert!(observation.body()["why"]["message"].as_str().unwrap().contains("lookup"));
            observation.assert_unchanged();
            assert!(matches!(call(&mut e, "quiet", "alice", json!({"key":"lookup"}), "quiet").state, WriteState::Sent { result: Value::Null, .. }));
        } else { assert_eq!(observation.body()["state"], "sent"); }
        observations.push(observation);
    }
    assert_ne!(observations[0].first_http_body, observations[1].first_http_body, "readable clash is a granted distinction");
}
#[test]
fn s05_upsert_on_a_hidden_row_succeeds_when_the_update_rule_admits_and_returns_no_row() {
    let mut replies = Vec::new();
    for amount in [7, 19] {
        let mut e = world(SOURCE, true, amount);
        let (result, observation) = observed(&mut e, "put", "bob", json!({"key":"lookup"}), "same");
        assert!(matches!(result.state, WriteState::Sent { result: Value::Null, .. }));
        assert_eq!(value(&mut e, "alice").field("amount"), Ok(&Value::Int(0)));
        assert_eq!(value(&mut e, "bob"), Value::Null);
        assert_eq!(e.store().rows("records").unwrap().len(), 1);
        replies.push(observation);
    }
    equal_observations(&replies);
}
#[test]
fn s05_upsert_on_a_hidden_row_is_not_found_when_the_update_rule_refuses() {
    unchanged_pair(&SOURCE.replace("update <- allow", "update (old, next) <- old.owner = viewer"), "put", json!({"key":"lookup"}), 7);
}
#[test]
fn w1_not_found_and_e_rule_are_one_word_on_an_unreadable_row() {
    let denied = SOURCE.replace("update <- allow", "update (old, next) <- old.owner = viewer");
    for (name, values) in [("edit", json!({"key":"lookup"})), ("editId", json!({"target":"target"}))] {
        unchanged_pair(&denied, name, values, 7);
    }
    let mut e = world(&denied, true, 7);
    assert!(matches!(call(&mut e, "edit", "alice", json!({"key":"lookup"}), "own").state, WriteState::Sent { .. }));
    let mut e = world(&SOURCE.replace("update <- allow", "update <- deny"), true, 7);
    assert_eq!(call(&mut e, "edit", "alice", json!({"key":"lookup"}), "deny").reply(Some("deny"))["why"]["code"], "E_RULE");
}
#[test]
fn w1_e_conflict_current_is_withheld_and_the_code_does_not_tell_hidden_from_absent() {
    unchanged_pair(SOURCE, "conditional", json!({"key":"lookup","expected":4}), 7);
    let mut e = world(SOURCE, true, 7);
    let body = call(&mut e, "conditional", "alice", json!({"key":"lookup","expected":4}), "conflict").reply(Some("conflict"));
    assert_eq!(body["why"]["code"], "E_CONFLICT");
    assert_eq!(body["current"]["amount"], 7);
    unchanged_pair(SOURCE, "conditional", json!({"key":"lookup","expected":7}), 7);
    assert!(matches!(call(&mut e, "conditional", "alice", json!({"key":"lookup","expected":7}), "readable").state, WriteState::Sent { .. }));
}
#[test]
fn w1_an_immutable_patch_on_a_hidden_row_ignores_matching_and_mismatching_guesses() {
    let mut observations = Vec::new();
    for frozen in ["fixed", "wrong"] {
        let mut e = engine(SOURCE);
        let mut r = row("target", "lookup", "alice", 7, "PRIVATE"); r["frozen"] = json!(frozen);
        seed(&mut e, "records", vec![r]);
        let (_, observation) = observed(&mut e, "immutable", "bob", json!({"key":"lookup","guess":"fixed"}), "same");
        assert_eq!(observation.body()["state"], "sent");
        assert_eq!(observation.body()["result"], Json::Null);
        assert_eq!(value(&mut e, "alice").field("frozen").unwrap().as_str().unwrap(), frozen);
        assert_eq!(observation.changes, json!({}));
        observations.push(observation);
    }
    equal_observations(&observations);
    let mut e = world(SOURCE, true, 7);
    assert!(matches!(call(&mut e, "immutable", "alice", json!({"key":"lookup","guess":"fixed"}), "yes").state, WriteState::Sent { .. }));
    let body = call(&mut e, "immutable", "alice", json!({"key":"lookup","guess":"different"}), "no").reply(Some("no"));
    assert_eq!(body["why"]["code"], "E_CONSTRAINT");
    assert!(body["why"]["message"].as_str().unwrap().contains("records.frozen"));
    unchanged_pair(SOURCE, "editId", json!({"target":"absent"}), 7);
}

#[test]
fn w1_incomplete_patch_upsert_does_not_tell_hidden_deny_from_absent() {
    unchanged_pair(&SOURCE.replace("update <- allow", "update <- deny"), "put", json!({"key":"lookup"}), 7);
    let source = format!("{}\nmutation incompleteAsset(key: text <=80, photo: image <=1000):\n  upsert records[key] {{amount: 0, photo}}\n", SOURCE.replace("update <- allow", "update <- deny"));
    unchanged_pair(&source, "incompleteAsset", json!({"key":"lookup","photo":{"id":"foreign-upload"}}), 7);
    let mut e = world(SOURCE, true, 7);
    assert!(matches!(call(&mut e, "put", "bob", json!({"key":"lookup"}), "yes").state, WriteState::Sent { .. }));
}
#[test]
fn w1_the_merged_image_is_not_in_result_current_or_the_program() {
    let source = format!("{SOURCE}\nmutation shape(key: text <=80):\n  written = upsert records[key] {{amount: 0}}\n  require written = null else LEAK\n  return {{written, read: records[key]}}\n");
    let mut observations = Vec::new();
    for amount in [7, 19] {
        let mut e = world(&source, true, amount);
        let (result, observation) = observed(&mut e, "shape", "bob", json!({"key":"lookup"}), "shape");
        let body = result.reply(Some("shape"));
        assert_eq!(body["result"], json!({"written":null,"read":null}));
        assert_eq!(body["state"], "sent");
        assert!(body.get("current").is_none());
        observations.push(observation);
    }
    equal_observations(&observations);
    let invalid = compile(SOURCE);
    let json = serde_json::to_string(&invalid.programs.iter().find(|p| p.program.name == "conditional").unwrap().program).unwrap();
    assert!(json.contains("WriteTarget"));
    assert!(!json.contains("\"Check\""));
}
#[test]
fn w1_the_writers_stream_and_snapshot_do_not_gain_the_row() {
    let mut observations = Vec::new();
    for amount in [7, 19] {
        let mut e = world(SOURCE, true, amount);
        let before = e.seq().unwrap();
        let (result, observation) = observed(&mut e, "put", "bob", json!({"key":"lookup"}), "same");
        let WriteState::Sent { seq, .. } = result.state else { panic!("{result:?}") };
        let page = e.stream_at("bob", before, 100, 1000).unwrap();
        assert!(page.events.is_empty());
        assert_eq!(page.watermark, seq);
        assert!(e.snapshot_at("bob", 1000).unwrap().0.is_empty());
        assert_eq!(e.snapshot_at("alice", 1000).unwrap().0.len(), 1);
        assert_eq!(e.acknowledged("bob", &["same".into()], seq).unwrap()["same"], seq);
        observations.push(observation);
    }
    equal_observations(&observations);
}
#[test]
fn w1_replayed_ops_returns_the_withheld_body() {
    let mut observations = Vec::new();
    for amount in [7, 19] {
        let mut e = world(SOURCE, true, amount);
        let (_, observation) = observed(&mut e, "put", "bob", json!({"key":"lookup"}), "same");
        assert_eq!(serde_json::from_slice::<Json>(&observation.retry_http_body).unwrap(), json!({"state":"sent","id":"same","seq":e.seq().unwrap(),"replayed":true}));
        observations.push(observation);
    }
    equal_observations(&observations);
}

#[test]
fn wa2_secondary_hidden_collision_does_not_borrow_target_authority() {
    let source = SOURCE.replace("  immutable frozen", "  unique byAmount: amount\n  immutable frozen");
    for name in ["edit", "put"] {
        for owner in ["bob", "alice"] {
            let mut replies = Vec::new();
            for secret in ["FIRST", "SECOND"] {
                let mut e = engine(&source);
                seed(&mut e, "records", vec![row("target", "lookup", owner, 7, "visible"), row("other", "other", "alice", 0, secret)]);
                let before = e.store().rows("records").unwrap();
                let (result, observation) = observed(&mut e, name, "bob", json!({"key":"lookup"}), "same");
                let body = result.reply(Some("same"));
                assert_eq!(body["why"]["code"], if owner == "bob" { "E_RULE" } else { "NOT_FOUND" });
                for private in ["byAmount", "FIRST", "SECOND"] { assert!(!body.to_string().contains(private)); }
                assert_eq!(e.store().rows("records").unwrap(), before);
                replies.push(observation);
            }
            equal_observations(&replies);
        }
    }
    let mut e = world(&source, true, 7);
    assert!(matches!(call(&mut e, "edit", "bob", json!({"key":"lookup"}), "positive").state, WriteState::Sent { .. }));
}
#[test]
fn wa2_retained_composite_key_never_enters_refusal() {
    let source = SOURCE.replace("  immutable frozen", "  unique bySecretAmount: secret, amount\n  immutable frozen");
    let mut replies = Vec::new();
    for secret in ["FIRST", "SECOND"] {
        let mut e = engine(&source);
        // The readable set is identical in both worlds; the target selects a different retained key.
        seed(&mut e, "records", vec![row("target", "lookup", "alice", 7, secret), row("one", "one", "bob", 0, "FIRST"), row("two", "two", "bob", 0, "SECOND")]);
        let (result, observation) = observed(&mut e, "edit", "bob", json!({"key":"lookup"}), "same");
        let body = result.reply(Some("same"));
        assert_eq!(body["why"]["code"], "NOT_FOUND");
        replies.push(observation);
    }
    equal_observations(&replies);
    let mut e = engine(&source);
    seed(&mut e, "records", vec![row("target", "lookup", "alice", 7, "THIRD"), row("one", "one", "bob", 0, "FIRST"), row("two", "two", "bob", 0, "SECOND")]);
    let (result, observation) = observed(&mut e, "edit", "bob", json!({"key":"lookup"}), "same");
    assert!(matches!(result.state, WriteState::Sent { result: Value::Null, .. }));
    assert_eq!(observation.changes, json!({"records/target":{"amount":0}}));
    // A retained unique-key match remains an explicit §17 outcome residual; its value never leaves.
    assert!(!observation.body().to_string().contains("THIRD"));
}
#[test]
fn wa3_hidden_patch_preserves_foreign_asset_without_disclosing_id() {
    let mut replies = Vec::new();
    for size in [1u32, 2] {
        let mut e = world(SOURCE, true, 7);
        let mut png = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR".to_vec(); png.extend(size.to_be_bytes()); png.extend(1u32.to_be_bytes());
        let asset = e.store_asset("alice", &png, 1000).unwrap();
        let mut r = row("target", "lookup", "alice", 7, "PRIVATE"); r["photo"] = wire::to_json(&asset.column_value());
        seed(&mut e, "records", vec![r]);
        let (result, observation) = observed(&mut e, "put", "bob", json!({"key":"lookup"}), "same");
        assert!(matches!(result.state, WriteState::Sent { result: Value::Null, .. }));
        assert_eq!(value(&mut e, "alice").field("photo"), Ok(&asset.column_value()));
        replies.push(observation);
    }
    equal_observations(&replies);
    let source = format!("{}\nmutation asset(key: text <=80, photo: image <=1000):\n  update records[key] {{amount: 0, photo}}\n", SOURCE.replace("update <- allow", "update <- deny"));
    unchanged_pair(&source, "asset", json!({"key":"lookup","photo":{"id":"foreign-upload"}}), 7);
}
#[test]
fn wa5_hidden_write_replay_returns_only_sanitized_receipt() {
    w1_replayed_ops_returns_the_withheld_body();
    let mut observations = Vec::new();
    for hidden in [false, true] {
        let mut e = world(SOURCE, hidden, 7);
        let (first, observation) = observed(&mut e, "conditional", "bob", json!({"key":"lookup","expected":0}), "same");
        let body: Json = serde_json::from_str(&observation.receipt).unwrap();
        assert_eq!(body, first.receipt(Some("same")));
        for field in ["current", "result", "metered", "tables", "events"] { assert!(body.get(field).is_none(), "{body}"); }
        observations.push(observation);
    }
    equal_observations(&observations);
}
#[test]
fn wa5_revoked_result_and_conflict_current_are_not_retrievable() {
    for (name, a) in [("edit", json!({"key":"lookup"})), ("conditional", json!({"key":"lookup","expected":0}))] {
        let mut observations = Vec::new();
        for secret in ["REVOKED1", "REVOKED2"] {
            let mut e = world(SOURCE, true, 7);
            let (_, observation) = observation::observe_with_intervention(&mut e, name, "alice", a.clone(), "lost", ("one", json!({"key":"lookup"})), |e| {
                seed(e, "records", vec![row("target", "lookup", "carol", 7, secret)]);
                assert_eq!(value(e, "alice"), Value::Null);
            });
            assert!((observation.body().get("result").is_some() || observation.body().get("current").is_some()));
            let replay: Json = serde_json::from_slice(&observation.retry_http_body).unwrap();
            for field in ["result", "current", "metered", "tables", "events"] { assert!(replay.get(field).is_none(), "{replay}"); }
            assert_eq!(replay["state"], observation.body()["state"]);
            assert!(e.replay("bob", "lost").unwrap().is_none());
            observations.push(observation);
        }
        equal_observations(&observations);
    }
    // Arbitrary scalars are withheld too, including after a real revocation.
    let source = format!("{SOURCE}\nmutation scalar(key: text <=80):\n  r = records[key] ! else NOT_FOUND\n  return r.secret\n");
    let mut observations = Vec::new();
    for secret in ["REVOKED1", "REVOKED2"] {
        let mut e = world(&source, true, 7);
        let (_, observation) = observation::observe_with_intervention(&mut e, "scalar", "alice", json!({"key":"lookup"}), "scalar", ("one", json!({"key":"lookup"})), |e| {
            seed(e, "records", vec![row("target", "lookup", "carol", 7, secret)]);
            assert_eq!(value(e, "alice"), Value::Null);
        });
        assert_eq!(observation.body()["result"], "PRIVATE");
        assert!(serde_json::from_slice::<Json>(&observation.retry_http_body).unwrap().get("result").is_none());
        for device in &observation.devices { assert_eq!(device["settled"]["query"]["data"], Json::Null); }
        observations.push(observation);
    }
    equal_observations(&observations);
}

const PAGE: &str = r#"
effect notify
table items:
  owner: principal
  amount: int
  by byOwner: owner, id
  read <- .owner = viewer
  update <- allow
  sync to .owner last 2000 by byOwner
mutation pass(owner: principal): server
  n = 0
  for row in items[owner] first 1100 by byOwner:
    update items[row] {amount: 1}
    n = n + 1
  return n
query page(owner: principal, c: cursor ?):
  return items[owner] after c first 1100 by byOwner
"#;
fn page_world(source: &str, visible: usize, hidden: usize) -> Engine {
    let mut e = engine(source);
    let rows = (0..visible).map(|n| json!({"id":format!("a{n:04}"),"owner":"bob","amount":0}))
        .chain((0..hidden).map(|n| json!({"id":format!("h{n:04}"),"owner":"alice","amount":0}))).collect();
    seed(&mut e, "items", rows);
    e
}
#[test]
fn m3_a_non_predicting_pass_over_a_hidden_prefix_does_not_abort_when_a_query_would_not() {
    // Uniform-only ruling: the non-uniform pass is rejected without consulting either world.
    let source = PAGE.replace("items[owner] first 1100 by byOwner", "items[] first 1100 by byOwner");
    let bound = snapback4_lang::compile(&[("schema.q".into(), source)]);
    assert!(bound.diagnostics.iter().any(|d| d.code == "E_STRUCTURAL_FANOUT"));
    let helper = format!("{SOURCE}\nfn countVisible():\n  n = 0\n  for r in records[viewer] first 10 by byOwner:\n    n = n + 1\n  return n\nmutation checked(key: text <=80): server\n  return update records[key] {{amount: 0}} if countVisible() = 1\n");
    let mut e = world(&helper, true, 7);
    assert_eq!(call(&mut e, "checked", "alice", json!({"key":"lookup"}), "helper").reply(Some("helper"))["state"], "sent");
    let unpinned = helper.replace("records[viewer] first 10", "records[] first 10");
    assert!(snapback4_lang::compile(&[("schema.q".into(), unpinned)]).diagnostics.iter().any(|d| d.code == "E_STRUCTURAL_FANOUT"));
    let mut bodies = Vec::new();
    for hidden in [0, 100, 10_000] {
        let mut e = page_world(PAGE, 1, hidden);
        let (result, observation) = observed(&mut e, "pass", "bob", json!({"owner":"alice"}), "same");
        assert!(matches!(result.state, WriteState::Sent { result: Value::Int(0), .. }));
        let query = e.query("page", Context::new("bob", args(&e, "page", json!({"owner":"alice","c":null})))).unwrap();
        assert_eq!(query.data, Value::Array(vec![]));
        assert_eq!(result.metered.rows_written, 0);
        bodies.push(observation);
    }
    equal_observations(&bodies);
}
#[test]
fn m3_visible_count_in_the_program_matches_a_query_of_the_same_prefix() {
    let mut bodies = Vec::new();
    for hidden in [0, 10_000] {
        let mut e = page_world(PAGE, 3, hidden);
        let query = e.query("page", Context::new("bob", args(&e, "page", json!({"owner":"bob","c":null})))).unwrap();
        let (result, observation) = observed(&mut e, "pass", "bob", json!({"owner":"bob"}), "same");
        assert!(matches!(result.state, WriteState::Sent { result: Value::Int(n), .. } if n == query.data.as_array().unwrap().len() as i64));
        assert_eq!(result.metered.rows_written, 3);
        assert_eq!(call(&mut e, "pass", "bob", json!({"owner":"bob"}), "same").reply(Some("same"))["replayed"], true);
        bodies.push(observation);
    }
    equal_observations(&bodies);
    // Lane R's inferred never class also admits the pass with no author marker.
    let online = PAGE.replace(": server", ":").replace("  sync to .owner last 2000 by byOwner\n", "");
    let mut e = page_world(&online, 3, 1);
    assert!(matches!(call(&mut e, "pass", "bob", json!({"owner":"bob"}), "online").state, WriteState::Sent { result: Value::Int(3), .. }));
}
#[test]
fn p2_a_predicting_mutation_still_refuses_e_structural_fanout() {
    let b = snapback4_lang::compile(&[("schema.q".into(), PAGE.replace(": server", ":"))]);
    assert!(b.diagnostics.iter().any(|d| d.code == "E_STRUCTURAL_FANOUT"));
    let capped = PAGE.replace(": server", ":").replace("  read <- .owner", "  cap 1100 by owner\n  read <- .owner");
    assert_eq!(compile(&capped).schema.operations["pass"].predicts.as_deref(), Some("eligible"));
}
#[test]
fn p2_rows_written_still_aborts_at_1024() {
    let mut failed = Vec::new();
    for hidden in [0, 5] {
        let mut positive = page_world(PAGE, 1024, hidden);
        let result = call(&mut positive, "pass", "bob", json!({"owner":"bob"}), "limit");
        assert!(matches!(result.state, WriteState::Sent { result: Value::Int(1024), .. }), "{result:?}");
        assert_eq!(result.metered.rows_written, 1024);
        let mut e = page_world(PAGE, 1025, hidden);
        let before = e.store().rows("items").unwrap();
        let (result, observation) = observed(&mut e, "pass", "bob", json!({"owner":"bob"}), "over");
        let body = result.reply(Some("over"));
        assert_eq!(body["why"]["code"], "E_BOUND", "{body}");
        assert!(body["why"]["message"].as_str().unwrap().contains("1024"));
        assert_eq!(result.metered.rows_written, 1025);
        assert_eq!(e.store().rows("items").unwrap(), before);
        failed.push(observation);
    }
    equal_observations(&failed);
}
#[test]
fn p2_the_pass_is_atomic() {
    let source = PAGE.replace("mutation pass", "maintain totals: sum items of amount by owner\n  read <- .owner = viewer\nmutation pass")
        .replace("    n = n + 1", "    emit notify {id: row.id}\n    require row.amount = 0 else STOP\n    n = n + 1");
    let mut replies = Vec::new();
    for hidden in [0, 5] {
        let mut e = page_world(&source, 3, hidden);
        seed(&mut e, "items", vec![json!({"id":"a0002","owner":"bob","amount":2})]);
        let rows = e.store().rows("items").unwrap();
        let totals = e.store().rows("totals").unwrap();
        let seq = e.seq().unwrap();
        let (result, observation) = observed(&mut e, "pass", "bob", json!({"owner":"bob"}), "same");
        let body = result.reply(Some("same"));
        assert_eq!(body["why"]["code"], "STOP");
        assert_eq!(e.store().rows("items").unwrap(), rows);
        assert_eq!(e.store().rows("totals").unwrap(), totals);
        assert_eq!(e.seq().unwrap(), seq);
        assert!(e.effects(None, 100).unwrap().is_empty());
        assert!(e.stream_at("bob", seq, 100, 1000).unwrap().events.is_empty());
        replies.push(observation);
    }
    equal_observations(&replies);
    let mut e = page_world(&source, 2, 5);
    assert!(matches!(call(&mut e, "pass", "bob", json!({"owner":"bob"}), "positive").state, WriteState::Sent { result: Value::Int(2), .. }));
    assert_eq!(e.effects(None, 100).unwrap().len(), 2);
    assert_eq!(e.store().rows("totals").unwrap()[0].field("value"), Ok(&Value::Int(2)));
}

#[test]
fn a_readable_maintain_notes_the_declared_hidden_delta_channel() {
    let source = format!("{SOURCE}\nmaintain totals: sum records of amount by owner\n  read <- allow\n  online only\nquery total(owner: principal):\n  return totals[owner]\n");
    let b = compile(&source);
    assert!(b.notes.iter().any(|n| n.code == "N_MAINTAIN_DELTA"));
    assert!(!compile(&source.replace("update <- allow", "update <- deny")).notes.iter().any(|n| n.code == "N_MAINTAIN_DELTA"));
    let mut deltas = Vec::new();
    for amount in [7, 19] {
        let mut e = world(&source, true, amount);
        seed(&mut e, "records", vec![row("balance", "balance", "alice", 30-amount, "BALANCE")]);
        let query = |e: &mut Engine| e.query("total", Context::new("bob", args(e, "total", json!({"owner":"alice"})))).unwrap().data;
        assert_eq!(query(&mut e), Value::Int(30));
        assert!(matches!(call(&mut e, "put", "bob", json!({"key":"lookup"}), "delta").state, WriteState::Sent { result: Value::Null, .. }));
        deltas.push(query(&mut e));
    }
    assert_eq!(deltas, vec![Value::Int(23), Value::Int(11)]);
}

#[test]
fn a_unique_upsert_evaluates_its_key_once_and_conditions_keep_helper_bindings_private() {
    let source = "table rows:\n  key: id\n  value: int\n  unique byKey: key\n  read <- allow\n  insert <- allow\nmutation one():\n  return upsert rows[key = new] {value: 1}\n";
    let mut e = engine(source);
    let result = call(&mut e, "one", "bob", json!({}), "one");
    let WriteState::Sent { result, .. } = result.state else { panic!("{result:?}") };
    assert_eq!(result.field("key"), Ok(&Value::Id("fresh".into())));
    assert_eq!(result.field("id"), Ok(&Value::Id("effect".into())));
    let source = format!("{SOURCE}\nfn matchesSecret(secret: text <=80):\n  normalized = lower(secret)\n  return normalized = 'private'\nmutation checked(key: text <=80):\n  sentinel = 'caller'\n  written = update records[key] {{amount: 0}} if matchesSecret(.secret)\n  return {{sentinel, written}}\n");
    let mut bodies = Vec::new();
    for amount in [7, 19] {
        let mut e = world(&source, true, amount);
        let body = call(&mut e, "checked", "bob", json!({"key":"lookup"}), "same").reply(Some("same"));
        assert_eq!(body["why"]["code"], "NOT_FOUND");
        let readable = call(&mut e, "checked", "alice", json!({"key":"lookup"}), "readable").reply(Some("readable"));
        assert_eq!(readable["result"]["sentinel"], "caller");
        assert_eq!(readable["result"]["written"]["amount"], 0);
        bodies.push(body);
    }
    assert_eq!(bodies[0], bodies[1]);
}

#[test]
fn w2_complete_patch_upsert_with_a_foreign_asset_is_one_word_absent_or_hidden() {
    let source = format!("{}\nmutation completeAsset(key: text <=80, photo: image <=1000):\n  upsert records[key] {{owner: 'alice', secret: 'supplied', frozen: 'fixed', amount: 0, photo}}\n", SOURCE.replace("update <- allow", "update <- deny"));
    unchanged_pair(&source, "completeAsset", json!({"key":"lookup","photo":{"id":"foreign-upload"}}), 7);
    let asset = snapback4_core::assets::Asset { id: "foreign-upload".into(), owner: "carol".into(), kind: snapback4_core::assets::AssetKind::Image, content_type: "image/png".into(), bytes: 24, width: Some(1), height: Some(1), duration: None, created_at: 1000, home: None, released_at: None };
    let mut pair = Vec::new();
    for hidden in [false, true] {
        let mut e = world(&source, hidden, 7);
        e.store().record_asset(&asset).unwrap();
        let (_, observation) = observed(&mut e, "completeAsset", "bob", json!({"key":"lookup","photo":{"id":"foreign-upload"}}), "same");
        assert_eq!(observation.body()["why"]["code"], "NOT_FOUND");
        assert_eq!(e.store().asset(&asset.id).unwrap(), Some(asset.clone()), "denied writes cannot claim the foreign asset");
        pair.push(observation);
    }
    equal_observations(&pair);
    // An admitted absent insert reaches asset validation, proving this patch is complete.
    let mut e = world(&source, false, 7);
    e.store().record_asset(&asset).unwrap();
    assert_eq!(call(&mut e, "completeAsset", "alice", json!({"key":"lookup","photo":{"id":"foreign-upload"}}), "allowed").reply(Some("allowed"))["why"]["code"], "E_ASSET_UNKNOWN");
    let mut owned = asset.clone(); owned.owner = "alice".into();
    let mut e = world(&source, false, 7);
    e.store().record_asset(&owned).unwrap();
    assert!(matches!(call(&mut e, "completeAsset", "alice", json!({"key":"lookup","photo":{"id":"foreign-upload"}}), "owned").state, WriteState::Sent { .. }));
    let mut e = world(SOURCE, false, 7);
    assert!(matches!(call(&mut e, "full", "alice", json!({"key":"lookup"}), "insert").state, WriteState::Sent { .. }));
}

#[test]
fn w2_cap_refusals_never_name_retained_group_values() {
    let source = SOURCE.replace("  immutable frozen", "  by bySecretAmount: secret, amount, id\n  cap 1 by secret, amount\n  immutable frozen");
    for owner in ["alice", "bob"] {
        let mut bodies = Vec::new();
        for secret in ["FIRST", "OTHER"] {
            let mut e = engine(&source);
            seed(&mut e, "records", vec![row("target", "lookup", owner, 7, secret), row("one", "one", "alice", 0, "FIRST"), row("two", "two", "alice", 0, "OTHER")]);
            let before = e.store().rows("records").unwrap();
            let (result, observation) = observed(&mut e, "edit", "bob", json!({"key":"lookup"}), "same");
        let body = result.reply(Some("same"));
            assert_eq!(body["why"]["code"], "E_CONSTRAINT");
            assert_eq!(body["why"]["message"], "records holds at most 1 rows per group by secret, amount");
            assert_eq!(e.store().rows("records").unwrap(), before);
            bodies.push(observation);
        }
        if owner == "alice" { equal_observations(&bodies); }
        else { assert_eq!(bodies[0].first_http_body, bodies[1].first_http_body, "cap text is value-free even on readable targets"); }
    }
    let mut e = world(&source, true, 7);
    assert!(matches!(call(&mut e, "edit", "bob", json!({"key":"lookup"}), "free").state, WriteState::Sent { .. }));
}

#[test]
fn w2_receipts_store_the_replay_body_before_revocation_including_diagnostics() {
    for named in [false, true] {
        let constraint = if named { " else DUPLICATE" } else { "" };
        let source = SOURCE.replace("  immutable frozen", &format!("  unique bySecretAmount: secret, amount{constraint}\n  immutable frozen"));
        let mut observations = Vec::new();
        for secret in ["REVOKED1", "REVOKED2"] {
            let mut e = world(&source, true, 7);
            seed(&mut e, "records", vec![row("other", "other", "alice", 0, "PRIVATE")]);
            let (_, observation) = observation::observe_with_intervention(&mut e, "edit", "alice", json!({"key":"lookup"}), "lost", ("one", json!({"key":"lookup"})), |e| {
                seed(e, "records", vec![row("target", "lookup", "carol", 7, secret), row("other", "other", "carol", 0, secret)]);
                assert_eq!(value(e, "alice"), Value::Null);
            });
            let first = observation.body();
            assert_eq!(first["why"]["code"], if named { "DUPLICATE" } else { "E_CONSTRAINT" });
            assert!(first["why"][if named { "detail" } else { "message" }].as_str().unwrap().contains("PRIVATE"));
            let receipt: Json = serde_json::from_str(&observation.receipt).unwrap();
            assert!(!receipt.to_string().contains("PRIVATE"));
            assert!(receipt["why"].get("detail").is_none());
            let retry: Json = serde_json::from_slice(&observation.retry_http_body).unwrap();
            assert_eq!(retry, receipt);
            for device in &observation.devices { assert_eq!(device["settled"]["query"]["data"], Json::Null); }
            for field in ["code", "site", "rewrite", "guide", "family", "rule", "retryable"] { assert_eq!(receipt["why"][field], first["why"][field]); }
            observations.push(observation);
        }
        equal_observations(&observations);
    }
}

#[test]
fn w2_hidden_refusal_restores_read_rule_probe_work_too() {
    exhausted_target_pairs();
    let source = format!("{}\ntable grants:\n  record: records\n  principal: principal\n  unique byPair: record, principal\n  read <- allow\n", SOURCE.replace("read <- .owner = viewer", "read <- exists grants[.id, viewer]").replace("  sync to .owner last 100 by byOwner\n", "").replace("update <- allow", "update <- deny"));
    for (name, input) in [("edit", json!({"key":"lookup"})), ("editId", json!({"target":"target"})), ("put", json!({"key":"lookup"}))] { unchanged_pair(&source, name, input, 7); }
    let mut e = world(&source.replace("update <- deny", "update <- allow"), true, 7);
    seed(&mut e, "grants", vec![json!({"id":"grant","record":"target","principal":"bob"})]);
    let result = call(&mut e, "edit", "bob", json!({"key":"lookup"}), "readable");
    assert!(matches!(result.state, WriteState::Sent { .. }));
    assert!(result.metered.rule_probes > 0);
}

fn exhausted_target_pairs() {
    for resource in ["probes", "heap"] {
        for address in ["id", "unique", "upsert"] {
            for guard in ["plain", "immutable", "conditional"] {
                if address == "upsert" && guard == "conditional" { continue; } // upsert conditions are a compiler-observation exception.
                let base = SOURCE.replace("secret: text <=80", "secret: text <=4000").replace("read <- .owner = viewer", "read <- exists grants[.id, viewer]")
                    .replace("  sync to .owner last 100 by byOwner\n", "").replace("update <- allow", "update <- exists grants[.id, viewer]");
                let prelude = if resource == "probes" { "  for i in range(0, 8192):\n    w = work[id = 'work']\n" } else { "  for i in range(0, 2000):\n    p = pad\n" };
                let statement = format!("{} records[{}] {{{}}}{}", if address == "upsert" {"upsert"} else {"update"}, if address == "id" {"target"} else {"key"},
                    if guard == "immutable" {"frozen: 'wrong'"} else {"amount: 0"}, if guard == "conditional" {" if .amount = 7"} else {""});
                let source = format!("{base}\ntable grants:\n  record: text <=80\n  principal: principal\n  unique byPair: record, principal\n  read <- allow\ntable work:\n  record: records\n  read <- exists grants[.record, viewer]\nmutation warm(pad: text <=4000, key: text <=80, target: records): server\n{prelude}  return null\nmutation pressure(pad: text <=4000, key: text <=80, target: records): server\n{prelude}  {statement}\n");
                // A rule's key types match target IDs, including serialized caller IDs.
                let source = source.replace("record: text <=80", "record: records");
                let input = json!({"pad":"x".repeat(4000),"key":"lookup","target":"target"});
                let mut observations = Vec::new();
                for hidden in [false, true] {
                    let mut e = world(&source, hidden, 7);
                    seed(&mut e, "records", vec![row(if hidden {"target"} else {"decoy"}, if hidden {"lookup"} else {"elsewhere"}, "alice", 7, &"s".repeat(4000))]);
                    seed(&mut e, "work", vec![json!({"id":"work","record":"work"})]);
                    seed(&mut e, "grants", vec![json!({"id":"grant","record":"work","principal":"bob"})]);
                    let warm = call(&mut e, "warm", "bob", input.clone(), "warm");
                    assert!(matches!(warm.state, WriteState::Sent { .. }), "{resource}: {:?}", warm.state);
                    if resource == "heap" { e.set_ceilings(snapback4_core::meter::Ceilings { heap_bytes: warm.metered.heap_bytes + 1024, ..e.ceilings() }); }
                    else { assert_eq!(warm.metered.rule_probes, 8192); }
                    let (_, observation) = observed(&mut e, "pressure", "bob", input.clone(), "same");
                    assert_eq!(observation.body()["why"]["code"], "E_BOUND", "{resource}/{address}/{guard}: {:?}", observation.body());
                    assert!(observation.body()["why"]["message"].as_str().unwrap().contains(if resource == "heap" {"heap"} else {"rule"}));
                    if resource == "probes" { assert_eq!(observation.meter.rule_probes, 8192); }
                    else { assert!((warm.metered.heap_bytes..e.ceilings().heap_bytes).contains(&observation.meter.heap_bytes)); }
                    observations.push(observation);
                }
                equal_observations(&observations);
            }
        }
    }
}

#[test]
fn w3_hidden_maintain_overflow_never_serializes_the_retained_contribution() {
    let source = format!("{SOURCE}\nmaintain totals: sum records of amount by secret\n  read <- deny\nmutation move(key: text <=80):\n  update records[key] {{secret: 'B'}}\n");
    let mut observations = Vec::new();
    for contribution in [1, 2] {
        let mut e = engine(&source);
        seed(&mut e, "records", vec![row("target", "lookup", "alice", contribution, "A"), row("balance", "balance", "alice", snapback4_core::value::I53_MAX, "B")]);
        let (_, observation) = observed(&mut e, "move", "bob", json!({"key":"lookup"}), "same");
        assert_eq!(observation.body()["why"]["code"], "E_OVERFLOW");
        assert_eq!(observation.body()["why"]["message"], "E_OVERFLOW: maintain totals.value overflowed");
        observation.assert_unchanged();
        observations.push(observation);
    }
    equal_observations(&observations);
    let mut e = engine(&source);
    seed(&mut e, "records", vec![row("target", "lookup", "alice", 2, "A"), row("balance", "balance", "alice", snapback4_core::value::I53_MAX - 2, "B")]);
    let (result, _) = observed(&mut e, "move", "bob", json!({"key":"lookup"}), "positive");
    assert!(matches!(result.state, WriteState::Sent { .. }));
}

#[test]
fn w3_explicit_foreign_asset_guess_does_not_test_hidden_placement() {
    let source = format!("{SOURCE}\nmutation asset(key: text <=80, photo: image <=1000):\n  update records[key] {{photo}}\n");
    for explicit in [true, false] {
        let mut observations = Vec::new();
        for held in ["G", "H"] {
            let mut e = engine(&source);
            let mut png = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR".to_vec(); png.extend(1u32.to_be_bytes()); png.extend(1u32.to_be_bytes());
            let mut asset = e.store_asset("alice", &png, 1000).unwrap();
            e.store().forget_asset(&asset.id).unwrap();
            for id in ["G", "H"] { asset.id = id.into(); e.store().record_asset(&asset).unwrap(); }
            asset.id = held.into();
            let mut r = row("target", "lookup", "alice", 7, "PRIVATE"); r["photo"] = wire::to_json(&asset.column_value());
            seed(&mut e, "records", vec![r]);
            let (name, input) = if explicit { ("asset", json!({"key":"lookup","photo":{"id":"G"}})) } else { ("edit", json!({"key":"lookup"})) };
            let (_, observation) = observed(&mut e, name, "bob", input, "same");
            if explicit { assert_eq!(observation.body()["why"]["code"], "E_ASSET_UNKNOWN"); observation.assert_unchanged(); }
            else { assert_eq!(observation.body()["state"], "sent"); }
            assert_eq!(value(&mut e, "alice").field("photo"), Ok(&asset.column_value()));
            observations.push(observation);
        }
        equal_observations(&observations);
    }
    // An explicit upload owned by the writer remains a permitted assignment.
    let mut e = world(&source, true, 7);
    let mut png = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR".to_vec(); png.extend(1u32.to_be_bytes()); png.extend(1u32.to_be_bytes());
    let asset = e.store_asset("bob", &png, 1000).unwrap();
    let (result, _) = observed(&mut e, "asset", "bob", json!({"key":"lookup","photo":{"id":asset.id}}), "positive");
    assert!(matches!(result.state, WriteState::Sent { .. }));
}

#[test]
fn w3_historical_w_receipt_is_resanitized_on_replay() {
    let mut observations = Vec::new();
    for secret in ["REVOKED1", "REVOKED2"] {
        let mut e = world(SOURCE, true, 7);
        let (_, observation) = observation::observe_with_historical_receipt(&mut e, "conditional", "alice", json!({"key":"lookup","expected":0}), "historical", ("one", json!({"key":"lookup"})), |first| {
            let mut historical = first.reply(Some("historical")); // W stored current and the old why.
            historical["why"]["message"] = json!("row-derived PRIVATE diagnostic");
            historical["why"]["detail"] = json!("row-derived PRIVATE detail");
            historical
        }, |e| {
            seed(e, "records", vec![row("target", "lookup", "carol", 7, secret)]);
            assert_eq!(value(e, "alice"), Value::Null);
        });
        assert!(observation.receipt.contains("PRIVATE"));
        let replay: Json = serde_json::from_slice(&observation.retry_http_body).unwrap();
        assert_eq!(replay["why"]["message"], "the program refused with E_CONFLICT");
        assert!(replay.get("current").is_none() && replay.get("result").is_none());
        assert!(!replay.to_string().contains("PRIVATE"));
        for device in &observation.devices { assert_eq!(device["settled"]["query"]["data"], Json::Null); }
        observations.push(observation);
    }
    equal_observations(&observations);
}

#[test]
fn w3_hidden_upsert_ignores_immutables_and_absent_upsert_inserts_them() {
    for guess in ["fixed", "wrong"] {
        let source = format!("{SOURCE}\nmutation profile(key: text <=80):\n  return upsert records[key] {{owner: viewer, secret: 'supplied', frozen: '{guess}', amount: 0}}\n");
        let mut observations = Vec::new();
        for hidden in [true, false] {
            let mut e = world(&source, hidden, 7);
            let (_, observation) = observed(&mut e, "profile", "bob", json!({"key":"lookup"}), "same");
            let body = observation.body();
            assert_eq!(body["state"], "sent");
            assert_eq!(body["result"]["owner"], "bob"); // This patch explicitly grants read authority.
            assert_eq!(body["result"]["frozen"], if hidden {"fixed"} else {guess});
            assert_eq!(body["result"]["id"], if hidden {"target"} else {"fresh"});
            assert_eq!(body["result"], wire::to_json(&value(&mut e, "bob")));
            for device in &observation.devices {
                assert!(device["settled"]["outbox"].as_array().unwrap().is_empty());
                assert_eq!(device["settled"]["query"]["data"], body["result"]);
            }
            observations.push(observation);
        }
        // Preserve the actual bodies. Only the explicitly granted row (including
        // its id/frozen), committed write, stream/device row, and admitted work differ.
        let mut bodies = observations.iter().map(Observation::body).collect::<Vec<_>>();
        for body in &mut bodies { body.as_object_mut().unwrap().remove("result"); }
        assert_eq!(bodies[0], bodies[1]);
        assert_eq!(observations[0].receipt, observations[1].receipt);
        assert_eq!(observations[0].retry_http_body, observations[1].retry_http_body);
        assert_eq!(observations[0].effects, observations[1].effects);
        assert_eq!(observations[0].meter.rows_written, observations[1].meter.rows_written);
        assert_eq!(observations[0].meter.rule_probes, observations[1].meter.rule_probes);
    }
}

#[test]
fn w3_live_aggregate_overflow_uses_the_same_value_free_refusal() {
    let source = "table items:\n  group: text <=10\n  amount: int\n  until: time ?\n  by byGroup: group, id\n  by byExpiry: until\n  expire at .until\n  read <- deny\nmaintain sums: sum items of amount by group\n  read <- allow\n  online only\nmutation live(): server\n  return sums['g'] by byGroup\nquery one(key: text <=80):\n  return null\n";
    let mut observations = Vec::new();
    for contribution in [1, 2] {
        let mut e = engine(source);
        seed(&mut e, "items", vec![json!({"id":"c","group":"g","amount":-contribution,"until":1}),
            json!({"id":"a","group":"g","amount":snapback4_core::value::I53_MAX,"until":null}), json!({"id":"b","group":"g","amount":contribution,"until":null})]);
        let (_, observation) = observed(&mut e, "live", "bob", json!({}), "same");
        assert_eq!(observation.body()["why"]["code"], "E_OVERFLOW");
        assert_eq!(observation.body()["why"]["message"], "E_OVERFLOW: maintain sums.value overflowed");
        observations.push(observation);
    }
    equal_observations(&observations);
    let mut e = engine(source);
    seed(&mut e, "items", vec![json!({"id":"a","group":"g","amount":snapback4_core::value::I53_MAX,"until":null})]);
    let (result, _) = observed(&mut e, "live", "bob", json!({}), "positive");
    assert!(matches!(result.state, WriteState::Sent { result: Value::Int(snapback4_core::value::I53_MAX), .. }));
}


#[test]
fn w4_created_equality_upsert_reserves_before_lookup() {
    use snapback4_core::ir::{Expr, Program, Stmt};
    for serialized in [false, true] {
        for work in [0, 8192] {
            let source = format!("table permits:\n  owner: principal\n  enabled: bool\n  unique byOwner: owner\n  insert <- allow\ntable work:\n  read <- exists work[.id]\ntable targets:\n  amount: int\n  read <- deny\n  update <- deny\n  insert <- created permits[owner = viewer, enabled = true]\nmutation pressure(): server\n  insert permits {{owner: viewer, enabled: false}}\n  for i in range(0, {work}):\n    r = work[id = 'work']\n  upsert targets[id = 'target'] {{amount: 0}}\n  return null\nquery one(key: text <=80):\n  return null\n");
            let build = |source: &str| {
                let b = compile(source);
                let programs = b.programs.into_iter().map(|p| {
                    let mut p = p.program;
                    if serialized && p.name == "pressure" {
                        let write = p.body.iter_mut().find(|s| matches!(s, Stmt::WriteTarget { .. })).unwrap();
                        let Stmt::WriteTarget { target, patch: Expr::Object(fields), upsert: true, .. } = write else { panic!("{write:?}") };
                        let mut fields = fields.clone();
                        fields.insert("id".into(), target.key[0].clone());
                        *write = Stmt::Upsert { table: target.table.clone(), key: target.key[0].clone(), row: Expr::Object(fields) };
                    }
                    serde_json::from_str::<Program>(&serde_json::to_string(&p).unwrap()).unwrap()
                }).collect::<Vec<_>>();
                Engine::memory(b.schema, programs).unwrap()
            };
            let mut observations = Vec::new();
            for hidden in [false, true] {
                let mut e = build(&source);
                let rows = [("work", json!({"id":"work"})), ("targets", json!({"id":if hidden {"target"} else {"decoy"},"amount":7}))];
                e.seed(rows.into_iter().map(|(t,r)| (t.into(), wire::row_from_json(e.schema().table(t).unwrap(), &r).unwrap())).collect::<Vec<_>>()).unwrap();
                let (_, observation) = observed(&mut e, "pressure", "bob", json!({}), "same");
                assert_eq!(observation.body()["why"]["code"], if work == 0 {"NOT_FOUND"} else {"E_BOUND"}, "serialized={serialized}");
                assert_eq!(observation.meter.rule_probes, work);
                observation.assert_unchanged();
                observations.push(observation);
            }
            equal_observations(&observations);
            if work == 0 {
                let mut e = build(&source.replace("enabled: false", "enabled: true").replace("update <- deny", "update <- allow"));
                let (result, _) = observed(&mut e, "pressure", "bob", json!({}), "positive");
                assert!(matches!(result.state, WriteState::Sent { .. }), "{:?}", result.state);
                assert_eq!(e.store().rows("targets").unwrap()[0].field("amount"), Ok(&Value::Int(0)));
                assert_eq!(result.metered.rule_probes, 2, "insert authority is checked twice");
            }
        }
    }
}

#[test]
fn w4_ignored_immutable_patch_preserves_maintains_and_delivery() {
    for expiring in [false, true] {
        let base = SOURCE.replace("  immutable frozen", "  until: time ?\n  by byExpiry: until\n  immutable frozen");
        let base = if expiring { base.replace("  immutable frozen", "  expire at .until\n  immutable frozen") } else { base };
        let mut observations = Vec::new();
        for ignored in [false, true] {
            let patch = if ignored {"amount: 0, frozen: 'wrong'"} else {"amount: 0"};
            let source = format!("{base}\nmaintain totals: sum records of amount by frozen\n  read <- allow\n  online only\nmutation change(key: text <=80):\n  update records[key] {{{patch}}}\n");
            let mut e = engine(&source);
            let mut target = row("target", "lookup", "alice", 7, "PRIVATE");
            let mut sibling = row("sibling", "sibling", "alice", 3, "PRIVATE");
            target["until"] = Json::Null;
            sibling["until"] = Json::Null;
            seed(&mut e, "records", vec![target, sibling]);
            let (result, observation) = observed(&mut e, "change", "bob", json!({"key":"lookup"}), "same");
            assert!(matches!(result.state, WriteState::Sent { .. }));
            assert_eq!(value(&mut e, "bob"), Value::Null);
            assert_eq!(value(&mut e, "alice").field("frozen"), Ok(&Value::String("fixed".into())));
            assert_eq!(value(&mut e, "alice").field("amount"), Ok(&Value::Int(0)));
            assert_eq!(e.store().rows("totals").unwrap()[0].field("value"), Ok(&Value::Int(3)));
            assert_eq!(observation.changes["records/target"], json!({"amount":0}));
            observations.push(observation);
        }
        // Caller-authored patches differ; their evaluation work is not a hidden-state
        // comparison. Bodies, physical source/maintain results and delivery must agree.
        assert_eq!(observations[0].first_http_body, observations[1].first_http_body);
        assert_eq!(observations[0].receipt, observations[1].receipt);
        assert_eq!(observations[0].retry_http_body, observations[1].retry_http_body);
        assert_eq!(observations[0].before, observations[1].before);
        assert_eq!(observations[0].committed, observations[1].committed);
        assert_eq!(observations[0].changes, observations[1].changes);
        assert_eq!(observations[0].effects, observations[1].effects);
        assert_eq!(observations[0].stream, observations[1].stream);
        assert_eq!(observations[0].snapshot, observations[1].snapshot);
        assert_eq!(observations[0].devices, observations[1].devices);
        assert_eq!(observations[0].meter.rows_written, observations[1].meter.rows_written);
    }
}
