use super::{args, card, clean, quarry, Context, Engine, JobState, Value};
use snapback4_core::wire;
use serde_json::json;

#[test]
fn wave30_018r_035e_headline_sweep_catches_rows_before_the_coalesced_period() {
    let recipe = quarry(card("jobs").unwrap()).remove(0);
    let bound = clean("wave30 headline sweep", &recipe);
    let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    let rows = [("old", 1), ("latest", 25), ("future", 40)].into_iter().map(|(id, sent)| {
        ("invites".into(), wire::row_from_json(engine.schema().table("invites").unwrap(),
            &json!({"id":id,"inviteeId":"alice","sentAt":sent,"reminded":false})).unwrap())
    }).collect::<Vec<_>>();
    engine.seed_at(rows, 0).unwrap();
    let window = || args(&[("periodStart",Value::Int(20)),("periodEnd",Value::Int(30))]);
    for _ in 0..2 {
        assert_eq!(engine.run_job("remind", window(), 30).unwrap().state, JobState::Done);
        for (id, expected) in [("old",true),("latest",true),("future",false)] {
            let row = engine.store().rows("invites").unwrap().into_iter().find(|row| row.field("id").unwrap() == &super::id(id)).unwrap();
            assert_eq!(row.field("reminded").unwrap(), &Value::Bool(expected), "{id}");
        }
    }
}

#[test]
fn wave30_001r_004r_dense_guide_content_and_functions_have_a_direct_door() {
    use snapback4_lang::guide;
    assert_eq!(guide::resolve("functions"), Some("programs"));
    assert_eq!(guide::nearest("functons")[0], "programs");
    let recipe = "query alive():\n  return true\n";
    let card = format!("# Dense card\n\nA runnable query.\n\n```quarry\n{recipe}```\n\n{}", "Details with long lines. ".repeat(1000));
    let printed = guide::piped("dense", &card);
    assert!(printed.contains("Truncated:") && printed.contains(recipe));
    assert_eq!(quarry(&printed), [recipe]);
    let bound = clean("printed dense guide", &quarry(&printed)[0]);
    let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    assert_eq!(engine.query("alive",Context::new("alice", args(&[]))).unwrap().data, Value::Bool(true));
}
