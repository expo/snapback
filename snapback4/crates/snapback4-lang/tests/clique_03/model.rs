use super::*;

// @ref LLP 3000.007.003#33-f3-the-following-recipes-contract-as-a-declaration — independent oracle for permanent promotion and bounded follow-time copies.

#[derive(Clone)]
pub struct Post {
    pub author: String,
    pub at: i64,
    pub body: String,
}
#[derive(Clone)]
pub struct Event {
    pub post: String,
    pub actor: String,
    pub at: i64,
    pub shared: bool,
    pub repost: bool,
}
#[derive(Default)]
pub struct Model {
    pub profiles: BTreeSet<String>,
    pub posts: BTreeMap<String, Post>,
    pub events: BTreeMap<String, Event>,
    pub replies: BTreeMap<String, (String, String, i64)>,
    pub likes: BTreeSet<(String, String)>,
    pub edges: BTreeSet<(String, String)>,
    pub promoted: BTreeSet<String>,
    pub copies: BTreeMap<String, BTreeSet<String>>,
    pub now: i64,
}
impl Model {
    pub fn event(&mut self, key: &str, post: &str, actor: &str, at: i64, repost: bool) {
        let shared = self.promoted.contains(actor);
        self.events.insert(
            key.into(),
            Event {
                post: post.into(),
                actor: actor.into(),
                at,
                shared,
                repost,
            },
        );
        self.copies
            .entry(actor.into())
            .or_default()
            .insert(key.into());
        if !shared {
            for (reader, a) in &self.edges {
                if a == actor {
                    self.copies
                        .entry(reader.clone())
                        .or_default()
                        .insert(key.into());
                }
            }
        }
    }
    pub fn follow(&mut self, reader: &str, author: &str) {
        if !self.edges.insert((reader.into(), author.into())) {
            return;
        }
        if self.edges.iter().filter(|(_, a)| a == author).count() >= 51 {
            self.promoted.insert(author.into());
        }
        let mut events: Vec<_> = self
            .events
            .iter()
            .filter(|(_, v)| v.actor == author)
            .collect();
        events.sort_by(|(ka, a), (kb, b)| (b.at, kb).cmp(&(a.at, ka)));
        for (key, event) in events.into_iter().take(865) {
            if !event.shared {
                self.copies
                    .entry(reader.into())
                    .or_default()
                    .insert(key.clone());
            }
        }
    }
    pub fn unfollow(&mut self, reader: &str, author: &str) {
        self.edges.remove(&(reader.into(), author.into()));
        if let Some(c) = self.copies.get_mut(reader) {
            c.retain(|key| self.events.get(key).is_some_and(|e| e.actor != author));
        }
    }
    fn following(&self, reader: &str) -> Vec<String> {
        let mut rows: Vec<_> = self
            .events
            .iter()
            .filter(|(key, e)| {
                self.copies.get(reader).is_some_and(|c| c.contains(*key))
                    || (e.shared && self.edges.contains(&(reader.into(), e.actor.clone())))
            })
            .collect();
        rows.sort_by(|(ka, a), (kb, b)| (b.at, kb).cmp(&(a.at, ka)));
        rows.into_iter().map(|(k, _)| k.clone()).collect()
    }
    pub fn check_following(&self, e: &mut Engine) {
        for who in ["u0005", "u0500", "u0901"] {
            let got = pages(e, "following", who, &[], self.now);
            let ids: Vec<_> = got.iter().map(|r| field(r, "id").to_string()).collect();
            assert_eq!(ids, self.following(who), "Following {who}");
            for row in &got {
                let event = &self.events[field(row, "id")];
                let post = &self.posts[&event.post];
                assert_eq!(field(row, "postId"), event.post);
                assert_eq!(field(row, "actorId"), event.actor);
                assert_eq!(field(row, "authorId"), post.author);
                assert_eq!(row.field("repost").unwrap(), &Value::Bool(event.repost));
                assert_eq!(field(row.field("post").unwrap(), "body"), post.body);
            }
            println!(
                "CLIQUE_FOLLOWING {}",
                json!({"reader":who,"rows":got.len(),"pages":got.len().div_ceil(20),"oracle":"pass"})
            );
        }
    }
    pub fn check(&self, e: &mut Engine) {
        self.check_following(e);
        let counts = self.like_counts();
        let mut ranked: Vec<_> = self
            .posts
            .iter()
            .filter(|(_, p)| p.at > self.now - 86400000 && p.at <= self.now)
            .collect();
        ranked.sort_by(|(ka, a), (kb, b)| {
            (counts.get(*kb).copied().unwrap_or(0), b.at, kb).cmp(&(
                counts.get(*ka).copied().unwrap_or(0),
                a.at,
                ka,
            ))
        });
        let expected: Vec<_> = ranked.iter().map(|(k, _)| (*k).clone()).collect();
        let got = pages(e, "trending", "u0005", &[], self.now);
        assert_eq!(
            got.iter()
                .map(|r| field(r, "id").to_string())
                .collect::<Vec<_>>(),
            expected,
            "Trending, all cursor pages including zero likes"
        );
        for row in &got {
            assert_eq!(
                row.field("likeCount").unwrap(),
                &Value::Int(counts.get(field(row, "id")).copied().unwrap_or(0))
            );
        }
        let day = self.now / 86400000;
        for author in &self.profiles {
            let p = e
                .query(
                    "insights",
                    ctx(
                        author,
                        &[("authorId", id(author)), ("d", Value::Int(day))],
                        self.now,
                    ),
                )
                .unwrap();
            for (name, is_reply, daily) in [
                ("likes", false, false),
                ("replies", true, false),
                ("dailyLikes", false, true),
                ("dailyReplies", true, true),
            ] {
                let targets: Vec<&String> = if is_reply {
                    self.replies.values().map(|(p, _, _)| p).collect()
                } else {
                    self.likes.iter().map(|(p, _)| p).collect()
                };
                let want = targets
                    .into_iter()
                    .filter(|key| {
                        let p = &self.posts[*key];
                        p.author == *author && (!daily || p.at / 86400000 == day)
                    })
                    .count() as i64;
                let value = p.data.field(name).unwrap();
                let count = match value {
                    Value::Null => 0,
                    Value::Int(n) => *n,
                    v => panic!("count {v:?}"),
                };
                assert_eq!(count, want, "{author} {name}");
            }
        }
        let rows = pages(e, "thread", "u0005", &[("postId", id("sp0001"))], self.now);
        let mut want: Vec<_> = self
            .replies
            .iter()
            .filter(|(_, r)| r.0 == "sp0001")
            .collect();
        want.sort_by(|(ka, a), (kb, b)| (a.2, ka).cmp(&(b.2, kb)));
        assert!(want.len() > 20);
        assert_eq!(
            rows.iter()
                .map(|r| field(r, "id").to_string())
                .collect::<Vec<_>>(),
            want.iter().map(|(k, _)| (*k).clone()).collect::<Vec<_>>()
        );
        println!(
            "CLIQUE_CORRECT {}",
            json!({"trending_rows":got.len(),"authors_with_four_counts_checked":self.profiles.len(),"thread_rows":rows.len(),"equal_timestamp_cursor":"pass"})
        );
    }
    pub fn like_counts(&self) -> BTreeMap<String, i64> {
        let mut out = BTreeMap::new();
        for (p, _) in &self.likes {
            *out.entry(p.clone()).or_default() += 1;
        }
        out
    }
}
