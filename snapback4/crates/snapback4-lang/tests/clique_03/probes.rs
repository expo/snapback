use super::*;

// Small, explicit review regressions before spending the full-fixture run.
#[test]
fn review_lifecycle_probe() {
    let mut e = engine(&prior());
    let mut m = Model {
        now: BASE_TIME + 2 * 86400000 + 100000,
        ..Default::default()
    };
    for who in ["alice", "bob", "carol", "u0005", "u0500", "u0901"] {
        sent(
            &mut e,
            "register",
            who,
            &[("name", text(who))],
            m.now,
            &format!("profile-{who}"),
        );
        m.profiles.insert(who.into());
    }
    sent(
        &mut e,
        "follow",
        "u0005",
        &[("authorId", id("alice"))],
        m.now,
        "edge",
    );
    m.follow("u0005", "alice");
    for key in ["sp0001", "rank-001", "rank-003"] {
        let at = if key == "rank-001" {
            m.now - 86400000
        } else {
            m.now
        };
        sent(&mut e, "post", "alice", &[("body", text(key))], at, key);
        m.posts.insert(
            key.into(),
            model::Post {
                author: "alice".into(),
                at,
                body: key.into(),
            },
        );
        m.event(key, key, "alice", at, false);
    }
    for n in 0..46 {
        let key = if n == 0 {
            "initial-reply".into()
        } else {
            format!("thread-equal-{n:03}")
        };
        sent(
            &mut e,
            "reply",
            "alice",
            &[("postId", id("sp0001")), ("body", text("reply"))],
            m.now,
            &key,
        );
        m.replies
            .insert(key, ("sp0001".into(), "alice".into(), m.now));
    }
    for who in ["bob", "carol"] {
        sent(
            &mut e,
            "like",
            who,
            &[("postId", id("rank-003"))],
            m.now,
            &format!("like-{who}"),
        );
        m.like("rank-003", who, m.now).unwrap();
    }
    let (d, path) = lifecycle::adopt(&mut e, &m);
    lifecycle::pending_restart(&mut e, &mut m, d, path);
    lifecycle::removals(&mut e, &mut m);
    lifecycle::arrival_days(&mut e, &mut m);
    measure::amplification();
}
