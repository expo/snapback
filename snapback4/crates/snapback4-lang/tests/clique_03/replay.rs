use super::*;
use model::Post;
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{BufRead, BufReader},
    path::Path,
};

// The action grammar quotes strings as JSON; no shell is invoked.
fn words(line: &str) -> Vec<String> {
    let mut result = Vec::new();
    let mut rest = line.trim();
    while !rest.is_empty() {
        if rest.starts_with('"') {
            let mut end = 1;
            let mut escaped = false;
            for (i, c) in rest.char_indices().skip(1) {
                if c == '"' && !escaped {
                    end = i + 1;
                    break;
                }
                escaped = c == '\\' && !escaped;
            }
            result.push(serde_json::from_str(&rest[..end]).unwrap());
            rest = rest[end..].trim_start();
        } else {
            let n = rest.find(char::is_whitespace).unwrap_or(rest.len());
            result.push(rest[..n].into());
            rest = rest[n..].trim_start();
        }
    }
    result
}
fn kept(who: &str) -> bool {
    !who.starts_with('u')
        || who[1..]
            .parse::<usize>()
            .is_ok_and(|n| n <= 62 || [500, 900, 901].contains(&n))
}
pub fn seed(e: &mut Engine, m: &mut Model, full: bool) -> serde_json::Value {
    let root =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../benchmarks/fixtures/social-messenger");
    assert_eq!(
        fs::read_to_string(root.join("VERSION")).unwrap().trim(),
        "0.2.2-m8"
    );
    let bytes = fs::read(root.join("scale.log")).unwrap();
    assert_eq!(
        format!("{:x}", Sha256::digest(&bytes)),
        "b26bf1ae8ccf2d64c8ca34bca6562b63a5174956a40c33c123aff8050b6abba9"
    );
    let mut count = BTreeMap::<String, usize>::new();
    let mut skipped = BTreeMap::<String, usize>::new();
    let mut ordinal = 0;
    let mut per_author = BTreeMap::<String, usize>::new();
    for file in [
        "starter-m1.log",
        "starter-m2.log",
        "starter-m3.log",
        "scale.log",
    ] {
        for line in BufReader::new(fs::File::open(root.join(file)).unwrap()).lines() {
            let line = line.unwrap();
            if line.starts_with('#') || line.is_empty() {
                continue;
            }
            let w = words(&line);
            ordinal += 1;
            let who = &w[1];
            let op = w[2].as_str();
            let a = &w[3..];
            // Arrival clock follows replay order, including out-of-scope actions.
            m.now = BASE_TIME + ordinal * 1000;
            let key = format!("action-{ordinal:06}");
            if !full && !kept(who) {
                continue;
            }
            match op {
                "register" => {
                    sent(e, "register", who, &[("name", text(who))], m.now, &key);
                    m.profiles.insert(who.clone());
                }
                "follow" => {
                    if !full && !kept(&a[0]) {
                        continue;
                    }
                    let set = a[1] == "set";
                    sent(
                        e,
                        if set { "follow" } else { "unfollow" },
                        who,
                        &[("authorId", id(&a[0]))],
                        m.now,
                        &a[2],
                    );
                    if set {
                        m.follow(who, &a[0]);
                    } else {
                        m.unfollow(who, &a[0]);
                    }
                }
                "post" => {
                    let n = per_author.entry(who.clone()).or_default();
                    *n += 1;
                    if !full && who.starts_with('u') && *n > 5 {
                        continue;
                    }
                    sent(e, "post", who, &[("body", text(&a[2]))], m.now, &a[0]);
                    m.posts.insert(
                        a[0].clone(),
                        Post {
                            author: who.clone(),
                            at: m.now,
                            body: a[2].clone(),
                        },
                    );
                    m.event(&a[0], &a[0], who, m.now, false);
                }
                "reply" => {
                    if !m.posts.contains_key(&a[1]) {
                        assert!(!full);
                        continue;
                    }
                    sent(
                        e,
                        "reply",
                        who,
                        &[("postId", id(&a[1])), ("body", text(&a[2]))],
                        m.now,
                        &a[0],
                    );
                    m.replies
                        .insert(a[0].clone(), (a[1].clone(), who.clone(), m.now));
                }
                "like" | "repost" => {
                    if !m.posts.contains_key(&a[0]) {
                        assert!(!full);
                        continue;
                    }
                    let set = a[1] == "set";
                    let verb = match (op, set) {
                        ("like", true) => "like",
                        ("like", false) => "unlike",
                        (_, true) => "repost",
                        _ => "unrepost",
                    };
                    sent(e, verb, who, &[("postId", id(&a[0]))], m.now, &a[2]);
                    if op == "like" {
                        if set {
                            m.like(&a[0], who, m.now).unwrap();
                        } else {
                            m.likes.remove(&(a[0].clone(), who.clone()));
                        }
                    } else if set {
                        m.event(&format!("{}-event", a[2]), &a[0], who, m.now, true);
                    } else {
                        m.events
                            .retain(|_, v| !(v.repost && v.post == a[0] && v.actor == *who));
                    }
                }
                _ => {
                    *skipped.entry(op.into()).or_default() += 1;
                    continue;
                }
            }
            *count.entry(op.into()).or_default() += 1;
            if count.values().sum::<usize>() % 5000 == 0 {
                println!(
                    "CLIQUE_REPLAY {}",
                    json!({"operations":count.values().sum::<usize>(),"line":ordinal})
                );
            }
        }
    }
    if full {
        assert_eq!(
            (
                m.profiles.len(),
                m.edges.len(),
                m.posts.len(),
                m.likes.len(),
                m.replies.len()
            ),
            (1008, 5921, 48224, 5008, 2004)
        );
        assert_eq!(
            m.posts.values().filter(|p| p.author == "u0900").count(),
            200
        );
        for (who, n) in [("u0005", 5), ("u0500", 500), ("u0901", 5)] {
            assert_eq!(m.edges.iter().filter(|(r, _)| r == who).count(), n);
        }
        assert_eq!(m.edges.iter().filter(|(_, a)| a == "u0900").count(), 900);
        assert_eq!(m.events.values().filter(|e| e.repost).count(), 1004);
    }
    // More than two pages of replies at exactly one timestamp; lexicographic ids
    // deliberately arrive in reverse order to test the tie-break and continuation.
    m.now += 1000;
    for n in (0..45).rev() {
        let key = format!("thread-equal-{n:03}");
        sent(
            e,
            "reply",
            "alice",
            &[
                ("postId", id("sp0001")),
                ("body", text("same-time continuation")),
            ],
            m.now,
            &key,
        );
        m.replies
            .insert(key, ("sp0001".into(), "alice".into(), m.now));
    }
    // Recent zero-like, equal-time and exact 24-hour boundary parents make
    // ranking non-vacuous in the reduced run as well as the full fixture.
    for n in 0..32 {
        let key = format!("rank-{n:03}");
        let at = match n {
            0 => m.now - 86400000,
            1 => m.now - 86400000 + 1,
            2 => m.now + 1,
            _ => m.now - 1000,
        };
        sent(
            e,
            "post",
            "alice",
            &[("body", text("ranking boundary"))],
            at,
            &key,
        );
        m.posts.insert(
            key.clone(),
            Post {
                author: "alice".into(),
                at,
                body: "ranking boundary".into(),
            },
        );
        m.event(&key, &key, "alice", at, false);
        for who in ["bob", "carol"]
            .into_iter()
            .take(if n % 3 == 0 { 2 } else { 0 })
        {
            sent(
                e,
                "like",
                who,
                &[("postId", id(&key))],
                m.now,
                &format!("rank-like-{n:03}-{who}"),
            );
            m.like(&key, who, m.now).unwrap();
        }
    }
    json!({"pack":"0.2.2-m8","operations":count,"out_of_scope":skipped,"profiles":m.profiles.len(),"posts":m.posts.len(),"edges":m.edges.len(),"additional_equal_time_replies":m.replies.keys().filter(|k| k.starts_with("thread-equal-")).count()})
}
