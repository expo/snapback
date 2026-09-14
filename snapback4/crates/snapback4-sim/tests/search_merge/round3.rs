use super::*;

const SOURCE: &str = include_str!("round3.q");

#[test]
fn r3_admitted_hidden_words_do_not_starve_later_lanes() {
    let mut worlds = Vec::new();
    for population in [0, 33] {
        let mut engine = engine(SOURCE);
        for room in ["r1", "r2"] { seed_member(&mut engine, room, "alice"); }
        let mut seed = vec![("messages".into(), object([("id", id("shown")), ("roomId", id("r2")), ("authorId", id("alice")), ("body", text("coffee"))]))];
        for n in 0..population {
            seed.push(("messages".into(), object([("id", id(&format!("hidden{n}"))), ("roomId", id("r1")), ("authorId", id("bob")), ("body", text(&format!("cof{n:02}")))])));
        }
        engine.seed(seed).unwrap();
        let page = engine.query("matching", Context::new("alice", BTreeMap::new()).at(100)).unwrap();
        println!("R3 admitted population={population}: {}", serde_json::to_string(&page).unwrap());
        worlds.push(page);
    }
    assert_eq!(ids(&worlds[0]), ["shown"]);
    assert!(worlds[0].next.is_some());
    assert_eq!((&worlds[0].data, &worlds[0].next, worlds[0].complete), (&worlds[1].data, &worlds[1].next, worlds[1].complete));
    assert!(!worlds[0].complete);
    assert!(worlds.iter().all(|page| page.capped_at.is_none()));
}
