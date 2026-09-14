//! LLP 3000.007 §15: paired hidden worlds, complete /m envelopes, durable
//! retries, effects and partition observations. Physical timing is not asserted.
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
        let mut receipt = result.reply(Some(op));
        assert_eq!(recorded(e, viewer, op), receipt);
        receipt.as_object_mut().unwrap().remove("result");
        receipt.as_object_mut().unwrap().remove("current");
        receipt["replayed"] = Json::Bool(true);
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
fn unchanged_pair(source: &str, name: &str, values: Json, hidden_amount: i64) -> Json {
    let mut worlds = [world(source, false, 7), world(source, true, hidden_amount)];
    let mut bodies = Vec::new();
    let mut retries = Vec::new();
    for e in &mut worlds {
        assert_eq!(value(e, "bob"), Value::Null);
        let before = e.store().rows("records").unwrap();
        let seq = e.seq().unwrap();
        let result = call(e, name, "bob", values.clone(), "same");
        let body = result.reply(Some("same"));
        assert_eq!(recorded(e, "bob", "same"), body);
        assert_eq!(e.store().rows("records").unwrap(), before);
        assert_eq!(e.seq().unwrap(), seq);
        assert!(e.stream_at("bob", seq, 100, 1000).unwrap().events.is_empty());
        assert!(e.snapshot_at("bob", 1000).unwrap().0.is_empty());
        assert!(e.effects(None, 100).unwrap().is_empty());
        retries.push(call(e, name, "bob", values.clone(), "same").reply(Some("same")));
        bodies.push(body);
    }
    assert_eq!(bodies[0], bodies[1]);
    assert_eq!(retries[0], retries[1]);
    assert_eq!(bodies[0]["why"]["code"], "NOT_FOUND");
    assert!(bodies[0].get("current").is_none());
    bodies.remove(0)
}

#[test]
fn s05_insert_and_insert_if_absent_on_a_hidden_unique_clash_stay_e_rule() {
    for name in ["add", "quiet"] {
        let mut replies = Vec::new();
        for hidden_secret in ["FIRST", "SECOND"] {
            let mut e = engine(SOURCE);
            seed(&mut e, "records", vec![row("target", "lookup", "alice", 7, hidden_secret)]);
            let before = e.store().rows("records").unwrap();
            let result = call(&mut e, name, "bob", json!({"key":"lookup"}), "same");
            assert_eq!(result.reply(Some("same"))["why"]["code"], "E_RULE");
            assert_eq!(e.store().rows("records").unwrap(), before);
            replies.push(result.reply(Some("same")));
        }
        assert_eq!(replies[0], replies[1]);
        let mut e = engine(SOURCE);
        assert!(matches!(call(&mut e, name, "bob", json!({"key":"free"}), "positive").state, WriteState::Sent { .. }));
    }
}
#[test]
fn s05_a_readable_clash_still_names_the_index() {
    let mut e = world(SOURCE, true, 7);
    let body = call(&mut e, "add", "alice", json!({"key":"lookup"}), "clash").reply(Some("clash"));
    assert_eq!(body["why"]["code"], "E_CONSTRAINT");
    assert!(body["why"]["message"].as_str().unwrap().contains("key"));
    assert!(body["why"]["message"].as_str().unwrap().contains("lookup"));
    assert!(matches!(call(&mut e, "quiet", "alice", json!({"key":"lookup"}), "quiet").state, WriteState::Sent { result: Value::Null, .. }));
}
#[test]
fn s05_upsert_on_a_hidden_row_succeeds_when_the_update_rule_admits_and_returns_no_row() {
    let mut replies = Vec::new();
    for amount in [7, 19] {
        let mut e = world(SOURCE, true, amount);
        let result = call(&mut e, "put", "bob", json!({"key":"lookup"}), "same");
        assert!(matches!(result.state, WriteState::Sent { result: Value::Null, .. }));
        assert_eq!(value(&mut e, "alice").field("amount"), Ok(&Value::Int(0)));
        assert_eq!(value(&mut e, "bob"), Value::Null);
        assert_eq!(e.store().rows("records").unwrap().len(), 1);
        replies.push(result.reply(Some("same")));
    }
    assert_eq!(replies[0], replies[1]);
}
#[test]
fn s05_upsert_on_a_hidden_row_is_e_rule_when_the_update_rule_refuses() {
    // Historical reviewer name; ruling 15 revises the hidden refusal to NOT_FOUND.
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
    assert!(matches!(call(&mut e, "conditional", "bob", json!({"key":"lookup","expected":7}), "yes").state, WriteState::Sent { result: Value::Null, .. }));
}
#[test]
fn w1_an_immutable_mismatch_on_a_hidden_row_is_not_a_searchable_constraint() {
    let takeover = format!("{SOURCE}\nmutation takeover(key: text <=80):\n  update records[key] {{owner: viewer, frozen: 'wrong'}}\n");
    unchanged_pair(&takeover, "takeover", json!({"key":"lookup"}), 7);
    unchanged_pair(SOURCE, "immutable", json!({"key":"lookup","guess":"different"}), 7);
    let mut e = world(SOURCE, true, 7);
    assert!(matches!(call(&mut e, "immutable", "bob", json!({"key":"lookup","guess":"fixed"}), "yes").state, WriteState::Sent { .. }));
    assert_eq!(call(&mut e, "immutable", "alice", json!({"key":"lookup","guess":"different"}), "no").reply(Some("no"))["why"]["code"], "E_CONSTRAINT");
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
    for amount in [7, 19] {
        let mut e = world(&source, true, amount);
        let body = call(&mut e, "shape", "bob", json!({"key":"lookup"}), "shape").reply(Some("shape"));
        assert_eq!(body["result"], json!({"written":null,"read":null}));
        assert_eq!(body["state"], "sent");
        assert!(body.get("current").is_none());
    }
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
        let result = call(&mut e, "put", "bob", json!({"key":"lookup"}), "same");
        let WriteState::Sent { seq, .. } = result.state else { panic!("{result:?}") };
        let page = e.stream_at("bob", before, 100, 1000).unwrap();
        assert!(page.events.is_empty());
        assert_eq!(page.watermark, seq);
        assert!(e.snapshot_at("bob", 1000).unwrap().0.is_empty());
        assert_eq!(e.snapshot_at("alice", 1000).unwrap().0.len(), 1);
        assert_eq!(e.acknowledged("bob", &["same".into()], seq).unwrap()["same"], seq);
        observations.push(serde_json::to_value(page).unwrap());
    }
    assert_eq!(observations[0], observations[1]);
}
#[test]
fn w1_replayed_ops_returns_the_withheld_body() {
    let mut e = world(SOURCE, true, 7);
    let first = call(&mut e, "put", "bob", json!({"key":"lookup"}), "same");
    assert_eq!(recorded(&e, "bob", "same"), first.reply(Some("same")));
    let before = e.store().rows("records").unwrap();
    let replay = call(&mut e, "put", "bob", json!({"key":"lookup"}), "same");
    assert_eq!(replay.reply(Some("same")), json!({"state":"sent","id":"same","seq":e.seq().unwrap(),"replayed":true}));
    assert_eq!(e.store().rows("records").unwrap(), before);
}
#[test]
fn wa2_secondary_hidden_collision_does_not_borrow_target_authority() {
    let source = SOURCE.replace("  immutable frozen", "  unique byAmount: amount\n  immutable frozen");
    let mut replies = Vec::new();
    for secret in ["FIRST", "SECOND"] {
        let mut e = engine(&source);
        seed(&mut e, "records", vec![row("target", "lookup", "bob", 7, "visible"), row("other", "other", "alice", 0, secret)]);
        let before = e.store().rows("records").unwrap();
        let body = call(&mut e, "edit", "bob", json!({"key":"lookup"}), "same").reply(Some("same"));
        assert_eq!(body["why"]["code"], "NOT_FOUND");
        assert_eq!(e.store().rows("records").unwrap(), before);
        replies.push(body);
    }
    assert_eq!(replies[0], replies[1]);
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
        let body = call(&mut e, "edit", "bob", json!({"key":"lookup"}), "same").reply(Some("same"));
        assert_eq!(body["why"]["code"], "NOT_FOUND");
        replies.push(body);
    }
    assert_eq!(replies[0], replies[1]);
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
        let result = call(&mut e, "put", "bob", json!({"key":"lookup"}), "same");
        assert!(matches!(result.state, WriteState::Sent { result: Value::Null, .. }));
        assert_eq!(value(&mut e, "alice").field("photo"), Ok(&asset.column_value()));
        replies.push(result.reply(Some("same")));
    }
    assert_eq!(replies[0], replies[1]);
    let source = format!("{}\nmutation asset(key: text <=80, photo: image <=1000):\n  update records[key] {{amount: 0, photo}}\n", SOURCE.replace("update <- allow", "update <- deny"));
    unchanged_pair(&source, "asset", json!({"key":"lookup","photo":{"id":"foreign-upload"}}), 7);
}
#[test]
fn wa5_hidden_write_replay_returns_only_sanitized_receipt() {
    w1_replayed_ops_returns_the_withheld_body();
    let mut e = world(SOURCE, true, 7);
    let first = call(&mut e, "conditional", "bob", json!({"key":"lookup","expected":0}), "same");
    let body = recorded(&e, "bob", "same");
    assert_eq!(body, first.reply(Some("same")));
    for field in ["current", "result", "metered", "tables", "events"] { assert!(body.get(field).is_none(), "{body}"); }
    assert!(e.replay("bob", "same").unwrap().unwrap().reply(Some("same")).get("current").is_none());
}
#[test]
fn wa5_revoked_result_and_conflict_current_are_not_retrievable() {
    for (name, a) in [("edit", json!({"key":"lookup"})), ("conditional", json!({"key":"lookup","expected":0}))] {
        let mut e = world(SOURCE, true, 7);
        let first = call(&mut e, name, "alice", a.clone(), "lost"); // response dropped
        let original = first.reply(Some("lost"));
        assert!(original.get("result").or_else(|| original.get("current")).is_some());
        seed(&mut e, "records", vec![row("target", "lookup", "carol", 7, "REVOKED")]);
        assert_eq!(value(&mut e, "alice"), Value::Null);
        let before = e.store().rows("records").unwrap();
        let replay = call(&mut e, name, "alice", a, "lost").reply(Some("lost"));
        for field in ["result", "current", "metered", "tables", "events"] { assert!(replay.get(field).is_none(), "{replay}"); }
        assert_eq!(replay["state"], original["state"]);
        assert_eq!(e.store().rows("records").unwrap(), before);
        assert!(e.replay("bob", "lost").unwrap().is_none());
    }
    // Arbitrary scalar results cannot be reauthorized as rows; replay withholds them too.
    let mut e = world(&format!("{SOURCE}\nmutation scalar(key: text <=80):\n  r = records[key] ! else NOT_FOUND\n  return r.secret\n"), true, 7);
    assert_eq!(call(&mut e, "scalar", "alice", json!({"key":"lookup"}), "scalar").reply(Some("scalar"))["result"], "PRIVATE");
    assert!(e.replay("alice", "scalar").unwrap().unwrap().reply(Some("scalar")).get("result").is_none());
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
    let helper = format!("{SOURCE}\nfn countVisible():\n  n = 0\n  for r in records[viewer] first 10 by byOwner:\n    n = n + 1\n  return n\nmutation checked(key: text <=80): server\n  return update records[key] {{amount: 0}} if countVisible() = 0\n");
    let mut e = world(&helper, true, 7);
    assert_eq!(call(&mut e, "checked", "bob", json!({"key":"lookup"}), "helper").reply(Some("helper"))["state"], "sent");
    let unpinned = helper.replace("records[viewer] first 10", "records[] first 10");
    assert!(snapback4_lang::compile(&[("schema.q".into(), unpinned)]).diagnostics.iter().any(|d| d.code == "E_STRUCTURAL_FANOUT"));
    let mut bodies = Vec::new();
    for hidden in [0, 100, 10_000] {
        let mut e = page_world(PAGE, 1, hidden);
        let result = call(&mut e, "pass", "bob", json!({"owner":"alice"}), "same");
        assert!(matches!(result.state, WriteState::Sent { result: Value::Int(0), .. }));
        let query = e.query("page", Context::new("bob", args(&e, "page", json!({"owner":"alice","c":null})))).unwrap();
        assert_eq!(query.data, Value::Array(vec![]));
        assert_eq!(result.metered.rows_written, 0);
        bodies.push(result.reply(Some("same")));
    }
    assert!(bodies.windows(2).all(|w| w[0] == w[1]));
}
#[test]
fn m3_visible_count_in_the_program_matches_a_query_of_the_same_prefix() {
    let mut bodies = Vec::new();
    for hidden in [0, 10_000] {
        let mut e = page_world(PAGE, 3, hidden);
        let query = e.query("page", Context::new("bob", args(&e, "page", json!({"owner":"bob","c":null})))).unwrap();
        let result = call(&mut e, "pass", "bob", json!({"owner":"bob"}), "same");
        assert!(matches!(result.state, WriteState::Sent { result: Value::Int(n), .. } if n == query.data.as_array().unwrap().len() as i64));
        assert_eq!(result.metered.rows_written, 3);
        assert_eq!(call(&mut e, "pass", "bob", json!({"owner":"bob"}), "same").reply(Some("same"))["replayed"], true);
        bodies.push(result.reply(Some("same")));
    }
    assert_eq!(bodies[0], bodies[1]);
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
        let result = call(&mut e, "pass", "bob", json!({"owner":"bob"}), "over");
        let body = result.reply(Some("over"));
        assert_eq!(body["why"]["code"], "E_BOUND", "{body}");
        assert!(body["why"]["message"].as_str().unwrap().contains("1024"));
        assert_eq!(result.metered.rows_written, 1025);
        assert_eq!(e.store().rows("items").unwrap(), before);
        failed.push(body);
    }
    assert_eq!(failed[0], failed[1]);
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
        let body = call(&mut e, "pass", "bob", json!({"owner":"bob"}), "same").reply(Some("same"));
        assert_eq!(body["why"]["code"], "STOP");
        assert_eq!(e.store().rows("items").unwrap(), rows);
        assert_eq!(e.store().rows("totals").unwrap(), totals);
        assert_eq!(e.seq().unwrap(), seq);
        assert!(e.effects(None, 100).unwrap().is_empty());
        assert!(e.stream_at("bob", seq, 100, 1000).unwrap().events.is_empty());
        replies.push(body);
    }
    assert_eq!(replies[0], replies[1]);
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
        assert_eq!(body["result"], json!({"sentinel":"caller","written":null}));
        bodies.push(body);
    }
    assert_eq!(bodies[0], bodies[1]);
}
