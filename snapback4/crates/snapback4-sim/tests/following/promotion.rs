#[path = "../common/following_promotion.rs"]
mod case;
use snapback4_core::Engine;

fn scenario(reader: &str, slots: usize) {
    let bound = case::app::built();
    let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    case::seed(&mut engine, reader, slots);
    if slots == 32 { case::refused(&mut engine); }
    else { case::promoted(&mut engine); }
    case::post(&mut engine, "new-post", 6);
    case::check_deliveries(&mut engine, slots < 32);
    if slots == 32 {
        case::free_slot(&mut engine, reader);
        case::promoted(&mut engine);
        case::shared_follow_still_refuses(&mut engine, reader);
        case::post(&mut engine, "after-retry", 8);
        for n in 0..51 {
            assert_eq!(case::posts(&case::app::query(&mut engine, &format!("reader{n:02}"))), ["after-retry", "new-post", "old-push"]);
        }
    }
}

#[test]
fn w11a_promotion_refuses_saturated_first_follower() { scenario("reader00", 32); }

#[test]
fn w11a_promotion_rolls_back_other_followers_routes() { scenario("reader49", 32); }

#[test]
fn w11a_promotion_with_one_free_slot_continues_delivery() { scenario("reader00", 31); }

#[test]
fn w11r1c_later_newcomers_refuse_until_the_publicly_identifiable_blocker_frees_a_slot() {
    let probe = "query slots(authorId: principal):\n  return feedFollows[authorId] first 1000 by byFollowed { followerId, slots: feedPullCounts[readerId = .followerId] }\n";
    let bound = snapback4_lang::compile(&[
        ("feed.q".into(), snapback4_lang::recipe::following("feed", "feed").unwrap()),
        ("social.q".into(), case::app::app()), ("probe.q".into(), probe.into()),
    ]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    assert!(bound.notes.is_empty(), "{:?}", bound.notes);
    assert_eq!(bound.schema.operations["probe.slots"].runs.as_deref(), Some("server"));
    let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    case::seed(&mut engine, "reader00", 32);
    let before = case::rows(&engine);
    for newcomer in ["carol", "dave"] {
        let result = engine.mutate("social.follow", None, case::app::context(newcomer, &[("authorId", case::app::id(case::AUTHOR))])).unwrap();
        let snapback4_core::WriteState::Failed { why, .. } = result.state else { panic!("{newcomer} must refuse"); };
        assert_eq!(why.code, case::CODE);
        assert_eq!(case::rows(&engine), before);
        assert!(!case::shared(&engine));
    }
    let found = engine.query("probe.slots", case::app::context(case::AUTHOR, &[("authorId", case::app::id(case::AUTHOR))])).unwrap();
    assert!(found.complete);
    let followers = found.data.as_array().unwrap();
    assert_eq!(followers.len(), 50);
    let blocked: Vec<_> = followers.iter().filter(|f| f.field("slots").unwrap() != &snapback4_core::Value::Null)
        .filter(|f| f.field("slots").unwrap().field("used").unwrap() == &snapback4_core::Value::Int(32))
        .map(|f| f.field("followerId").unwrap().clone()).collect();
    assert_eq!(blocked, [case::app::id("reader00")]);
    println!("W11R1c blocker discovery: followers={} read_operations={} examined={} probes={} blocked={}",
        followers.len(), 1 + followers.len(), found.metered.examined, found.metered.rule_probes, blocked.len());
    case::free_slot(&mut engine, "reader00");
    let result = engine.mutate("social.follow", None, case::app::context("carol", &[("authorId", case::app::id(case::AUTHOR))])).unwrap();
    assert!(matches!(result.state, snapback4_core::WriteState::Sent { .. }), "{:?}", result.state);
    assert!(case::shared(&engine));
}
