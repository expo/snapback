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
