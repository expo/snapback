//! Postgres runs the same rule evaluator: an unnamed update rule judges old and next.
// @ref LLP 3000.007#8 — item 7(a): the takeover regression on the Postgres adapter.
use super::super::*;

const SOURCE: &str = r#"table notes:
  owner: principal
  body: text <=100
  READ
  insert <- .owner = viewer
  update <- .owner = viewer
  online only
mutation seed(key: id, owner: principal):
  upsert notes[key] { owner, body: 'mine' }
  return true
mutation take(key: id, body: text <=100):
  update notes[key] { owner: viewer, body }
  return true
mutation grab(key: id, body: text <=100):
  upsert notes[key] { owner: viewer, body }
  return true
mutation edit(key: id, body: text <=100):
  update notes[key] { body }
  return true
query peek(key: id):
  return notes[key]
"#;

fn context(who: Option<&str>, body: &str) -> Context {
    let mut context = who.map_or_else(Context::system, |who| Context::new(who, Default::default()));
    context.args = [("key".to_owned(), Value::Id("n1".into())), ("body".to_owned(), Value::String(body.into())), ("owner".to_owned(), Value::Id("bob".into()))]
        .into_iter().collect();
    context.at(1_000)
}

#[test]
#[ignore = "requires isolated local Postgres; scripts/test-postgres.sh"]
fn another_principal_cannot_take_over_a_row_on_postgres() {
    for (read, code) in [("read <- allow", "E_RULE"), ("read <- .owner = viewer", "NOT_FOUND")] {
        let bound = snapback4_lang::compile(&[("schema.q".into(), SOURCE.replace("READ", read))]);
        assert!(bound.diagnostics.iter().all(|d| d.code.starts_with("N_")), "{:?}", bound.diagnostics);
        let client = Client::connect(&std::env::var("SNAPBACK4_EVAL_POSTGRES").expect("private test-postgres.sh database"), postgres::NoTls).unwrap();
        let name = format!("sb4_eval_update_images_{:x}", crate::ids::seed());
        let mut engine = PostgresEngine::create(client, &name,
            serde_json::from_str(&serde_json::to_string(&bound.schema).unwrap()).unwrap(),
            bound.programs.into_iter().map(|p| serde_json::from_str(&serde_json::to_string(&p.program).unwrap()).unwrap())).unwrap();
        // Drop the seed's extra `body` and `owner` arguments per program.
        let mut seed = context(None, "");
        seed.args.remove("body");
        assert!(matches!(engine.mutate("seed", None, seed).unwrap().state, WriteState::Sent { .. }));
        for op in ["take", "grab", "edit"] {
            let mut attempt = context(Some("alice"), "mine now");
            attempt.args.remove("owner");
            match engine.mutate(op, None, attempt).unwrap().state {
                WriteState::Failed { why, .. } => assert_eq!(why.code, code, "{read}: {op}"),
                other => panic!("{read}: {op} committed: {other:?}"),
            }
        }
        let mut owner = context(Some("bob"), "edited");
        owner.args.remove("owner");
        assert!(matches!(engine.mutate("edit", None, owner).unwrap().state, WriteState::Sent { .. }), "{read}: the owner still edits");
        let mut peek = context(None, "");
        peek.args.retain(|k, _| k == "key");
        let row = engine.query("peek", peek).unwrap().data;
        assert_eq!(row.field("owner"), Ok(&Value::Id("bob".into())), "{read}");
        assert_eq!(row.field("body"), Ok(&Value::String("edited".into())), "{read}");
        engine.store.client.batch_execute(&format!("DROP SCHEMA {name} CASCADE")).unwrap();
    }
}
