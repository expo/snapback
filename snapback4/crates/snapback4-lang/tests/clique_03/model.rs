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
    pub likes: BTreeMap<(String, String), i64>,
    pub removed: BTreeSet<String>,
    pub edges: BTreeSet<(String, String)>,
    pub promoted: BTreeSet<String>,
    pub copies: BTreeMap<String, BTreeSet<String>>,
    pub now: i64,
}
impl Model {
    pub fn contribution_target(&self, post: &str) -> Result<(), &'static str> {
        if !self.posts.contains_key(post) {
            return Err("FEED_APP_NOT_FOUND");
        }
        if self.removed.contains(post) {
            return Err("FEED_POST_REMOVED");
        }
        Ok(())
    }
    pub fn like(&mut self, post: &str, who: &str, at: i64) -> Result<(), &'static str> {
        self.contribution_target(post)?;
        self.likes.entry((post.into(), who.into())).or_insert(at);
        Ok(())
    }
    pub fn event(&mut self, key: &str, post: &str, actor: &str, at: i64, repost: bool) {
        if repost {
            self.contribution_target(post).unwrap();
        }
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
    pub fn check_rows(&self, op: &str, who: &str, got: &[Value]) {
        let ids: Vec<_> = got.iter().map(|r| field(r, "id").to_string()).collect();
        match op {
            "following" => {
                assert_eq!(ids, self.following(who), "Following {who}");
                for row in got {
                    let event = &self.events[field(row, "id")];
                    let post = &self.posts[&event.post];
                    assert_eq!(field(row, "postId"), event.post);
                    assert_eq!(field(row, "actorId"), event.actor);
                    assert_eq!(field(row, "authorId"), post.author);
                    assert_eq!(row.field("at").unwrap(), &Value::Int(event.at));
                    assert_eq!(row.field("repost").unwrap(), &Value::Bool(event.repost));
                    assert_eq!(field(row.field("post").unwrap(), "body"), post.body);
                    assert_eq!(
                        row.field("post").unwrap().field("removed").unwrap(),
                        &Value::Bool(self.removed.contains(&event.post))
                    );
                }
            }
            "trending" => {
                let counts = self.like_counts();
                let mut ranked: Vec<_> = self
                    .posts
                    .iter()
                    .filter(|(k, p)| {
                        !self.removed.contains(*k) && p.at > self.now - 86400000 && p.at <= self.now
                    })
                    .collect();
                ranked.sort_by(|(ka, a), (kb, b)| {
                    (counts[*kb], b.at, kb).cmp(&(counts[*ka], a.at, ka))
                });
                assert_eq!(
                    ids,
                    ranked.iter().map(|(k, _)| (*k).clone()).collect::<Vec<_>>(),
                    "Trending all pages including zero likes and removal filter"
                );
                for row in got {
                    assert_eq!(
                        row.field("likeCount").unwrap(),
                        &Value::Int(counts[field(row, "id")])
                    );
                }
            }
            "thread" => {
                let mut want: Vec<_> = self
                    .replies
                    .iter()
                    .filter(|(_, r)| r.0 == "sp0001")
                    .collect();
                want.sort_by(|(ka, a), (kb, b)| (a.2, ka).cmp(&(b.2, kb)));
                assert!(want.len() > 20);
                assert_eq!(
                    ids,
                    want.iter().map(|(k, _)| (*k).clone()).collect::<Vec<_>>()
                );
                for row in got {
                    let (post, author, at) = &self.replies[field(row, "id")];
                    assert_eq!(field(row, "postId"), post);
                    assert_eq!(field(row, "authorId"), author);
                    assert_eq!(row.field("at").unwrap(), &Value::Int(*at));
                }
            }
            _ => panic!("missing model for {op}"),
        }
    }
    pub fn check_following(&self, e: &mut Engine) -> bool {
        let mut agreements = Vec::new();
        for who in ["u0005", "u0500", "u0901"] {
            let (got, count) = walk(e, "following", who, &[], self.now);
            self.check_rows("following", who, &got);
            let agrees = got
                .iter()
                .map(|r| field(r, "id").to_string())
                .collect::<Vec<_>>()
                == self.following(who);
            assert!(agrees);
            agreements.push(agrees);
            println!(
                "CLIQUE_FOLLOWING {}",
                json!({"reader":who,"rows":got.len(),"pages":count,"oracle":agrees})
            );
        }
        agreements.iter().all(|agrees| *agrees)
    }
    pub fn received_likes(&self) -> BTreeMap<String, i64> {
        let mut counts = BTreeMap::new();
        for (post, _) in self.likes.keys() {
            *counts.entry(self.posts[post].author.clone()).or_default() += 1;
        }
        counts
    }
    pub fn check(&self, e: &mut Engine) {
        self.check_following(e);
        self.check_store(e.store());
        self.check_received_store(e.store());
        let (got, trending_pages) = walk(e, "trending", "u0005", &[], self.now);
        self.check_rows("trending", "u0005", &got);
        // Seven arrival days plus the post days and the empty following day.
        let day = self.now / 86400000;
        let mut days: BTreeSet<_> = (day - 6..=day + 1).collect();
        days.extend(self.posts.values().map(|p| p.at / 86400000));
        let mut counts_checked = 0;
        for author in &self.profiles {
            for day in &days {
                let p = e
                    .query(
                        "insights",
                        ctx(
                            author,
                            &[("authorId", id(author)), ("d", Value::Int(*day))],
                            self.now,
                        ),
                    )
                    .unwrap();
                assert!(p.complete && p.cut.is_none());
                for (name, is_reply, daily) in [
                    ("likes", false, false),
                    ("replies", true, false),
                    ("dailyLikes", false, true),
                    ("dailyReplies", true, true),
                ] {
                    let arrivals: Vec<_> = if is_reply {
                        self.replies.values().map(|(p, _, at)| (p, at)).collect()
                    } else {
                        self.likes.iter().map(|((p, _), at)| (p, at)).collect()
                    };
                    let want = arrivals
                        .into_iter()
                        .filter(|(key, at)| {
                            self.posts[*key].author == *author
                                && (!daily || **at / 86400000 == *day)
                        })
                        .count() as i64;
                    // Scalar count reads return an integer, including a missing group's zero.
                    assert_eq!(
                        p.data.field(name).unwrap(),
                        &Value::Int(want),
                        "{author} {name} day={day}"
                    );
                    counts_checked += 1;
                }
            }
        }
        let (rows, thread_pages) =
            walk(e, "thread", "u0005", &[("postId", id("sp0001"))], self.now);
        self.check_rows("thread", "u0005", &rows);
        let expected_equal: BTreeMap<_, _> = self
            .replies
            .iter()
            .filter(|(id, _)| id.starts_with("thread-equal-"))
            .map(|(id, r)| (id.clone(), Value::Int(r.2)))
            .collect();
        let actual_equal: BTreeMap<_, _> = rows
            .iter()
            .filter(|r| field(r, "id").starts_with("thread-equal-"))
            .map(|r| (field(r, "id").to_owned(), r.field("at").unwrap().clone()))
            .collect();
        assert_eq!(expected_equal.len(), 45);
        let same_time = actual_equal
            .values()
            .all(|v| Some(v) == actual_equal.values().next());
        let equal_timestamp_cursor =
            actual_equal == expected_equal && same_time && thread_pages >= 3;
        assert!(equal_timestamp_cursor);
        println!(
            "CLIQUE_CORRECT {}",
            json!({"trending_rows":got.len(),"trending_pages":trending_pages,
            "authors_with_four_counts_checked":self.profiles.len(),"days":days,"count_values_checked":counts_checked,
            "thread_rows":rows.len(),"thread_pages":thread_pages,"equal_timestamp_cursor":equal_timestamp_cursor})
        );
    }
    pub fn check_edges(&self, store: &snapback4_core::Store) -> BTreeSet<(String, String)> {
        let rows = store.rows("follows").unwrap();
        let edges: BTreeSet<_> = rows
            .iter()
            .map(|r| {
                (
                    field(r, "followerId").to_owned(),
                    field(r, "followedId").to_owned(),
                )
            })
            .collect();
        assert_eq!(edges.len(), rows.len(), "no duplicate stored follow edges");
        assert_eq!(edges, self.edges, "complete stored follows set");
        edges
    }
    pub fn source_counts(&self, store: &snapback4_core::Store) -> serde_json::Value {
        let mut counts = serde_json::Map::new();
        for (table, expected) in [
            ("profiles", self.profiles.len()),
            ("posts", self.posts.len()),
            ("replies", self.replies.len()),
            ("likes", self.likes.len()),
            ("follows", self.edges.len()),
        ] {
            let actual = store.rows(table).unwrap().len();
            assert_eq!(actual, expected, "{table}: stored source cardinality");
            counts.insert(table.into(), json!(actual));
        }
        counts.into()
    }
    pub fn like_counts(&self) -> BTreeMap<String, i64> {
        let mut out: BTreeMap<_, _> = self.posts.keys().map(|p| (p.clone(), 0)).collect();
        for (p, _) in self.likes.keys() {
            *out.get_mut(p).expect("like has unknown model parent") += 1;
        }
        out
    }
    pub fn check_received_store(&self, store: &snapback4_core::Store) {
        for (table, is_reply, daily) in [
            ("receivedLikes", false, false),
            ("receivedReplies", true, false),
            ("dailyReceivedLikes", false, true),
            ("dailyReceivedReplies", true, true),
        ] {
            let arrivals: Vec<_> = if is_reply {
                self.replies.values().map(|(p, _, at)| (p, at)).collect()
            } else {
                self.likes.iter().map(|((p, _), at)| (p, at)).collect()
            };
            let mut expected = BTreeMap::new();
            for (post, at) in arrivals {
                let mut group = vec![id(&self.posts[post].author)];
                if daily {
                    group.push(Value::Int(at / 86400000));
                }
                *expected
                    .entry(snapback4_core::schema::maintained_id(&group))
                    .or_insert(0) += 1;
            }
            let mut actual = BTreeMap::new();
            for row in store.rows(table).unwrap() {
                let Value::Int(value) = row.field("value").unwrap() else {
                    panic!("{table}: missing value")
                };
                assert!(
                    actual
                        .insert(field(&row, "id").to_owned(), *value)
                        .is_none()
                );
            }
            assert_eq!(
                actual, expected,
                "{table}: every nonzero received group by id"
            );
        }
    }
    pub fn check_store(&self, store: &snapback4_core::Store) -> serde_json::Value {
        let expected = self.like_counts();
        let mut counts = BTreeMap::new();
        let mut implicit_zeros = 0;
        for row in store.rows("posts").unwrap() {
            let key = field(&row, "id");
            let want = expected.get(key).expect("unknown stored post");
            let value = match row.as_object().unwrap().get("likeCount") {
                Some(Value::Int(n)) => *n,
                None => {
                    // guide maintains: activation's initial zero stays absent in storage.
                    assert_eq!(*want, 0, "missing nonzero likeCount {key}");
                    implicit_zeros += 1;
                    0
                }
                v => panic!("invalid likeCount {key}: {v:?}"),
            };
            assert!(counts.insert(key.to_owned(), value).is_none());
        }
        assert_eq!(counts, expected, "every model post is visited");
        let mut received = BTreeMap::new();
        let expected_received: BTreeMap<_, _> = self
            .received_likes()
            .into_iter()
            .map(|(author, count)| (snapback4_core::schema::maintained_id(&[id(&author)]), count))
            .collect();
        for row in store.rows("receivedLikes").unwrap() {
            let author = field(&row, "postId.authorId");
            assert!(
                self.profiles.contains(author),
                "unknown received-like author"
            );
            let Value::Int(value) = row.field("value").unwrap() else {
                panic!("missing received count")
            };
            let key = field(&row, "id");
            assert_eq!(key, snapback4_core::schema::maintained_id(&[id(author)]));
            assert!(received.insert(key.to_owned(), *value).is_none());
        }
        assert_eq!(
            received, expected_received,
            "sparse nonzero received groups by row id"
        );
        let mut likes = BTreeMap::new();
        for row in store.rows("likes").unwrap() {
            let Value::Int(at) = row.field("at").unwrap() else {
                panic!("missing like arrival")
            };
            assert!(
                likes
                    .insert(
                        (
                            field(&row, "postId").into(),
                            field(&row, "principal").into()
                        ),
                        *at
                    )
                    .is_none()
            );
        }
        assert_eq!(likes, self.likes);
        json!({"posts_checked":counts.len(),"received_like_groups_checked":received.len(),
            "likes_checked":likes.len(),"implicit_zero_posts":implicit_zeros})
    }
}
