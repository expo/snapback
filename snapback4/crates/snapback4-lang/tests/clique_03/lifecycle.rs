use super::*;
use snapback4_core::Store;
use snapback4_device::device::{Backend, Device, Queued, StreamPage};
use std::{
    fs,
    io::Write,
    path::PathBuf,
    process::{Command, Stdio},
};

pub fn backend(e: &Engine, source: &str) -> Backend {
    Backend {
        generation: e.generation(),
        schema: e.schema().public_projection(),
        programs: bound(source)
            .programs
            .into_iter()
            .map(|p| p.program)
            .collect(),
    }
}
fn dir() -> PathBuf {
    let p = std::env::temp_dir().join(format!(
        "sb4-clique-{}-{}",
        std::process::id(),
        snapback4_core::now_ms()
    ));
    fs::create_dir_all(&p).unwrap();
    p
}
pub fn acquire(e: &mut Engine, d: &mut Device<Store>, who: &str, now: i64) -> (usize, usize) {
    let mut after = None::<String>;
    let mut rows = 0;
    let mut bytes = 0;
    loop {
        let wire = transport::snapshot(e, who, after.clone(), now);
        bytes += wire.len();
        let page: StreamPage = serde_json::from_slice(&wire).unwrap();
        rows += page.events.len();
        let next = page.next.clone();
        d.apply(&page, after.is_none()).unwrap();
        match next {
            Some(c) => after = Some(c),
            None => break,
        }
    }
    (rows, bytes)
}
fn compare(e: &mut Engine, d: &mut Device<Store>, m: &Model) -> serde_json::Value {
    let mut checks = serde_json::Map::new();
    for (op, args) in [
        ("following", json!({})),
        ("trending", json!({})),
        ("thread", json!({"postId":"sp0001"})),
    ] {
        let mut args = args;
        let mut rows = Vec::new();
        let mut cursors = BTreeSet::new();
        let mut page_count = 0;
        loop {
            let p = d.query(op, "u0005", &args, m.now).unwrap();
            assert!(p.complete && p.cut.is_none(), "device {op}: {p:?}");
            rows.extend(p.data.as_array().unwrap().iter().cloned());
            page_count += 1;
            match p.next {
                Some(c) => {
                    assert!(cursors.insert(c.clone()), "device cursor repeats");
                    args["c"] = json!(c);
                }
                None => break,
            }
            assert!(page_count < 5000);
        }
        let args = if op == "thread" {
            vec![("postId", id("sp0001"))]
        } else {
            vec![]
        };
        let (server, _) = walk(e, op, "u0005", &args, m.now);
        assert_eq!(rows, server, "device {op} all cursor pages");
        m.check_rows(op, "u0005", &rows);
        checks.insert(
            op.into(),
            json!({"rows":rows.len(),"pages":page_count,"server_equal":rows==server}),
        );
    }
    checks.into()
}
// @ref LLP 3000.007.001#311-adoption — populated activation is event-free; device images are reacquired behind the generation barrier.
pub fn adopt(e: &mut Engine, m: &Model) -> (Device<Store>, PathBuf) {
    let path = dir().join("device.sqlite");
    let mut d = Device::open(&path, Some(backend(e, &prior()))).unwrap();
    let start = Instant::now();
    let (rows, bytes) = acquire(e, &mut d, "u0005", m.now);
    println!(
        "CLIQUE_COLD {}",
        json!({"generation":e.generation(),"rows":rows,"wire_bytes":bytes,"elapsed_s":start.elapsed().as_secs_f64()})
    );
    let old = e.generation();
    let seq = e.seq().unwrap();
    let b = bound(APP);
    let start = Instant::now();
    e.adopt(b.schema, b.programs.into_iter().map(|p| p.program))
        .unwrap();
    let activation = start.elapsed().as_secs_f64();
    assert!(e.generation() > old);
    let events: i64 = e
        .store()
        .conn()
        .query_row(
            "SELECT count(*) FROM _log WHERE seq > ?1",
            [seq as i64],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(events, 0, "activation emits no row events");
    d.adopt(backend(e, APP)).unwrap();
    let start = Instant::now();
    let (rows, bytes) = acquire(e, &mut d, "u0005", m.now);
    let reacquisition_s = start.elapsed().as_secs_f64();
    let device_queries = compare(e, &mut d, m);
    let server_counts = m.check_store(e.store());
    let device_counts = m.check_store(d.store());
    println!(
        "CLIQUE_ADOPTION {}",
        json!({"old_generation":old,"generation":e.generation(),"activation_s":activation,"activation_row_events":events,"reacquired_rows":rows,"reacquired_wire_bytes":bytes,"reacquisition_s":reacquisition_s,"device_queries":device_queries,"server_counts":server_counts,"device_counts":device_counts})
    );
    if let Ok(out) = std::env::var("SNAPBACK4_CLIQUE_BACKEND") {
        fs::write(out, serde_json::to_vec(&backend(e, APP)).unwrap()).unwrap();
    }
    (d, path)
}
fn process(path: &PathBuf, requests: &[serde_json::Value]) -> Vec<serde_json::Value> {
    let bin = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../target/debug/snapback4");
    let mut child = Command::new(bin)
        .arg("device")
        .arg(path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let mut input = child.stdin.take().unwrap();
    for r in requests {
        writeln!(input, "{r}").unwrap();
    }
    drop(input);
    let output = child.wait_with_output().unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let replies: Vec<serde_json::Value> = String::from_utf8(output.stdout)
        .unwrap()
        .lines()
        .map(|s| serde_json::from_str(s).unwrap())
        .collect();
    assert_eq!(replies.len(), requests.len() + 1);
    for r in &replies {
        assert!(r.get("ok").is_some(), "{r}");
    }
    replies
}
pub fn pending_restart(e: &mut Engine, m: &mut Model, d: Device<Store>, path: PathBuf) {
    drop(d);
    m.now += 1000;
    // Free a fixture edge before the offline follow, keeping the declared full cap.
    let followed = m
        .edges
        .iter()
        .find(|(r, _)| r == "u0005")
        .unwrap()
        .1
        .clone();
    let new_author = m
        .profiles
        .iter()
        .find(|a| a.as_str() != "u0005" && !m.edges.contains(&("u0005".into(), (*a).clone())))
        .unwrap()
        .clone();
    let ops = [
        ("post", json!({"body":"offline post"})),
        ("like", json!({"postId":"sp0001"})),
        ("reply", json!({"postId":"sp0001","body":"offline reply"})),
        ("unfollow", json!({"authorId":followed})),
        ("follow", json!({"authorId":new_author})),
    ];
    let requests:Vec<_>=ops.iter().enumerate().map(|(n,(op,args))|json!({"op":"admit","entry":{"id":format!("offline-{n}"),"seq":n+1,"op":op,"viewer":"u0005","args":args,"now":m.now+n as i64,"predictable":true}})).collect();
    let replies = process(&path, &requests);
    let queued: Vec<Queued> = replies[1..]
        .iter()
        .map(|r| serde_json::from_value(r["ok"].clone()).unwrap())
        .collect();
    assert_eq!(queued.len(), requests.len());
    for (q, request) in queued.iter().zip(&requests) {
        let admitted = &request["entry"];
        assert_eq!(q.id, admitted["id"].as_str().unwrap());
        assert_eq!(q.op, admitted["op"].as_str().unwrap());
        assert_eq!(q.viewer, admitted["viewer"].as_str().unwrap());
        assert_eq!(q.seq, admitted["seq"].as_u64().unwrap());
        assert_eq!(q.now, admitted["now"].as_i64().unwrap());
        assert_eq!(q.args, admitted["args"]);
        let expected_prediction = matches!(q.op.as_str(), "post" | "like" | "reply");
        assert_eq!(q.predictable, expected_prediction, "{} prediction", q.op);
        assert_eq!(!q.predicted.is_empty(), expected_prediction);
    }
    assert!(
        queued[0].predictable && !queued[0].predicted.is_empty(),
        "post predicts"
    );
    for q in &queued[3..] {
        assert!(
            !q.predictable && q.predicted.is_empty(),
            "follow and unfollow queue"
        );
    }
    // The first child exited. A second process reopens exactly the kept store.
    let reopened = process(
        &path,
        &[
            json!({"op":"queued"}),
            json!({"op":"query","name":"following","viewer":"u0005","args":{},"now":m.now+10}),
        ],
    );
    assert_eq!(reopened[1]["ok"], serde_json::to_value(&queued).unwrap());
    assert!(
        reopened[2]["ok"]["data"]
            .as_array()
            .unwrap()
            .iter()
            .any(|r| r["post"]["body"] == "offline post")
    );
    let mut d = Device::open(&path, None).unwrap();
    let stored = d.queued().unwrap();
    assert_eq!(stored, queued, "settle the durable records");
    for q in &stored {
        let program = e.program(&q.op).unwrap();
        let args = q
            .args
            .as_object()
            .unwrap()
            .iter()
            .map(|(name, value)| {
                (
                    name.clone(),
                    snapback4_core::wire::from_json(&program.args[name], value).unwrap(),
                )
            })
            .collect();
        let from = e.seq().unwrap();
        let at = q.now;
        let out = e
            .mutate(
                &q.op,
                Some(&q.id),
                Context::new(&q.viewer, args)
                    .at(at)
                    .with_ids(q.new_ids.clone()),
            )
            .unwrap();
        let seq = match out.state {
            WriteState::Sent { seq, .. } => seq,
            _ => panic!("settlement {out:?}"),
        };
        d.settle(&q.id, Some(seq)).unwrap();
        let mut page: StreamPage =
            serde_json::from_slice(&transport::stream(e, &q.viewer, from, at)).unwrap();
        // This is local request metadata, deliberately not part of encoded response bytes.
        page.requested_watermark = Some(from);
        assert!(!page.more);
        d.apply(&page, false).unwrap();
        match q.op.as_str() {
            "post" => {
                let key = &q.new_ids[0];
                m.posts.insert(
                    key.clone(),
                    model::Post {
                        author: q.viewer.clone(),
                        at,
                        body: q.args["body"].as_str().unwrap().into(),
                    },
                );
                m.event(key, key, &q.viewer, at, false);
            }
            "like" => {
                m.like(q.args["postId"].as_str().unwrap(), &q.viewer, at)
                    .unwrap();
            }
            "reply" => {
                m.replies.insert(
                    q.new_ids[0].clone(),
                    (
                        q.args["postId"].as_str().unwrap().into(),
                        q.viewer.clone(),
                        at,
                    ),
                );
            }
            "unfollow" => m.unfollow(&q.viewer, q.args["authorId"].as_str().unwrap()),
            "follow" => m.follow(&q.viewer, q.args["authorId"].as_str().unwrap()),
            op => panic!("unmodelled queued op {op}"),
        }
    }
    m.now += 10;
    assert!(d.queued().unwrap().is_empty());
    let device_queries = compare(e, &mut d, m);
    let counts = m.check_store(d.store());
    m.check_store(e.store());
    let reply = stored.iter().find(|q| q.op == "reply").unwrap();
    let like = stored.iter().find(|q| q.op == "like").unwrap();
    let (thread, _) = walk(
        e,
        "thread",
        &reply.viewer,
        &[("postId", id("sp0001"))],
        m.now,
    );
    let reply_position = thread
        .iter()
        .position(|r| field(r, "id") == reply.new_ids[0])
        .unwrap()
        + 1;
    assert_eq!(reply_position, 47);
    for store in [e.store(), d.store()] {
        let row = stored_row(store, "replies", &reply.new_ids[0]).unwrap();
        assert_eq!(field(&row, "body"), reply.args["body"].as_str().unwrap());
        assert_eq!(field(&row, "authorId"), reply.viewer);
        let row = stored_row(store, "likes", &like.new_ids[0]).unwrap();
        assert_eq!(field(&row, "postId"), "sp0001");
        assert_eq!(field(&row, "principal"), like.viewer);
        assert_eq!(
            stored_row(store, "posts", "sp0001")
                .unwrap()
                .field("likeCount")
                .unwrap(),
            &Value::Int(m.like_counts()["sp0001"])
        );
    }
    let posting_predicts = queued[0].predictable && !queued[0].predicted.is_empty();
    let edges_queue = queued[3..]
        .iter()
        .all(|q| !q.predictable && q.predicted.is_empty());
    let persisted = reopened[1]["ok"] == serde_json::to_value(&queued).unwrap();
    let settled_post_like_count = stored_int(d.store(), "posts", "sp0001", "likeCount");
    println!(
        "CLIQUE_RESTART {}",
        json!({"queued":stored.len(),"posting_predicts":posting_predicts,
        "follow_unfollow_queue":edges_queue,"intents_survived_process_exit":persisted,
        "outbox_empty":d.queued().unwrap().is_empty(),"device_queries":device_queries,
        "settled_reply_position":reply_position,"settled_post_like_count":settled_post_like_count,"store_checks":counts})
    );
    drop(d);
    fs::remove_dir_all(path.parent().unwrap()).unwrap();
}

fn refused(e: &mut Engine, op: &str, post: &str, code: &str, now: i64) -> String {
    let out = e
        .mutate(op, None, ctx("bob", &[("postId", id(post))], now))
        .unwrap();
    let WriteState::Failed {
        why: ref refusal, ..
    } = out.state
    else {
        panic!("expected refusal: {out:?}")
    };
    assert_eq!(refusal.code, code);
    refusal.code.clone()
}

pub fn removals(e: &mut Engine, m: &mut Model) {
    m.now += 1000;
    let args = [("postId", id("rank-003"))];
    sent(e, "repost", "u0005", &args, m.now, "lifecycle-repost");
    m.event("lifecycle-repost-event", "rank-003", "u0005", m.now, true);
    let before = e.store().rows("reposts").unwrap();
    let events_before = e.store().rows("feedPosts").unwrap();
    sent(e, "repost", "u0005", &args, m.now, "lifecycle-repeat");
    let duplicate_idempotent = before == e.store().rows("reposts").unwrap()
        && events_before == e.store().rows("feedPosts").unwrap();
    assert!(duplicate_idempotent);
    assert!(m.like_counts()["rank-003"] > 0);
    sent(e, "remove", "alice", &args, m.now, "lifecycle-remove");
    m.events.remove("rank-003");
    m.removed.insert("rank-003".into());
    m.check_following(e);
    let (following, _) = walk(e, "following", "u0005", &[], m.now);
    let repost_preserved = following.iter().any(|r| {
        field(r, "id") == "lifecycle-repost-event"
            && field(r.field("post").unwrap(), "id") == "rank-003"
    });
    assert!(repost_preserved);
    let (trending, _) = walk(e, "trending", "u0005", &[], m.now);
    m.check_rows("trending", "u0005", &trending);
    let removed_not_trending = trending.iter().all(|r| field(r, "id") != "rank-003");
    assert!(removed_not_trending);
    let expected_refusal = m.contribution_target("rank-003").unwrap_err();
    assert_eq!(m.like("rank-003", "bob", m.now), Err(expected_refusal));
    let like_refusal = refused(e, "like", "rank-003", expected_refusal, m.now);
    let repost_refusal = refused(e, "repost", "rank-003", expected_refusal, m.now);
    for op in ["like", "repost"] {
        refused(e, op, "missing-post", "FEED_APP_NOT_FOUND", m.now);
    }
    for who in ["bob", "carol"] {
        sent(e, "unlike", who, &args, m.now, &format!("unlike-{who}"));
        m.likes.remove(&("rank-003".into(), who.into()));
        m.check_store(e.store());
        m.check_received_store(e.store());
    }
    let unlike_zero = stored_row(e.store(), "posts", "rank-003")
        .unwrap()
        .field("likeCount")
        .unwrap()
        == &Value::Int(0);
    assert!(unlike_zero);
    sent(e, "unrepost", "u0005", &args, m.now, "lifecycle-unrepost");
    m.events.remove("lifecycle-repost-event");
    let following_after_unrepost = m.check_following(e);
    let timeline = e
        .schema()
        .timelines
        .iter()
        .find(|t| t.name == "feed")
        .unwrap()
        .clone();
    let table = timeline.table("RemovedEvents");
    let tombstones = e.store().rows(&table).unwrap();
    let tombstone_ids: Vec<_> = tombstones
        .iter()
        .map(|r| field(r, "id").to_owned())
        .collect();
    let event_ids: BTreeSet<_> = tombstones
        .iter()
        .map(|r| field(r, "eventId").to_owned())
        .collect();
    assert!(event_ids.contains("rank-003") && event_ids.contains("lifecycle-repost-event"));
    assert_eq!(tombstone_ids.len(), 2);
    assert!(!tombstone_ids.is_empty(), "purge must have real tombstones");
    let tombstones_present = tombstone_ids
        .iter()
        .all(|id| stored_row(e.store(), &table, id).is_some());
    assert!(tombstones_present);
    let schedule = e
        .schema()
        .schedules
        .iter()
        .find(|s| s.target == timeline.purge)
        .unwrap()
        .clone();
    // Do not let a prior run with the same target stand in for this firing.
    let job_ids = |e: &Engine| -> BTreeSet<String> {
        let mut statement = e.store().conn().prepare("SELECT id FROM _jobs").unwrap();
        statement
            .query_map([], |r| r.get(0))
            .unwrap()
            .map(Result::unwrap)
            .collect()
    };
    let jobs_before = job_ids(e);
    assert!(e.fire_schedules(m.now).unwrap().is_empty());
    assert_eq!(job_ids(e), jobs_before);
    let fired = e.fire_schedules(m.now + schedule.every_ms as i64).unwrap();
    assert_eq!(fired, vec![schedule.name.clone()]);
    let jobs_after = job_ids(e);
    let new_ids: Vec<_> = jobs_after.difference(&jobs_before).collect();
    assert_eq!(new_ids.len(), 1, "schedule enqueues one new purge");
    let job = e.job(new_ids[0]).unwrap().unwrap();
    assert_eq!(job.name, timeline.purge);
    assert_eq!(job.state, snapback4_core::JobState::Queued);
    let mut chunks = 0;
    while let Some(run) = e.run_job_chunk(m.now + schedule.every_ms as i64).unwrap() {
        assert_eq!(run.name, timeline.purge);
        assert_eq!(run.id, job.id, "run the newly scheduled purge");
        assert_ne!(run.state, snapback4_core::JobState::Parked, "{run:?}");
        chunks += 1;
        assert!(chunks < 100);
    }
    assert!(chunks > 0, "the new purge must execute a chunk");
    assert_eq!(
        e.job(&job.id).unwrap().unwrap().state,
        snapback4_core::JobState::Done
    );
    let purged = tombstone_ids
        .iter()
        .all(|id| stored_row(e.store(), &table, id).is_none());
    assert!(purged);
    m.check_following(e);
    println!(
        "CLIQUE_TRANSITIONS {}",
        json!({"duplicate_repost_idempotent":duplicate_idempotent,
        "original_removal_preserves_repost":repost_preserved,"removed_not_trending":removed_not_trending,
        "removed_like_refusal":like_refusal,"removed_repost_refusal":repost_refusal,
        "unlike_zero":unlike_zero,"following_after_unrepost":following_after_unrepost,
        "tombstone_table":table,"tombstone_ids":tombstone_ids,"tombstones_present_before":tombstones_present,
        "tombstoned_events":event_ids,"schedule":schedule.name,
        "jobs_before":jobs_before,"purge_job_id":job.id,"purge_target":job.name,
        "purge_chunks":chunks,"recorded_tombstones_gone":purged})
    );
}

pub fn arrival_days(e: &mut Engine, m: &mut Model) {
    let post = "rank-001"; // Older than one day, kept outside the main thread fixture.
    let at = m.now;
    let post_day = m.posts[post].at / 86400000;
    let arrival_day = at / 86400000;
    assert!(arrival_day > post_day);
    let author = m.posts[post].author.clone();
    let daily = |e: &mut Engine, day| -> [i64; 2] {
        let p = e
            .query(
                "insights",
                ctx(
                    &author,
                    &[("authorId", id(&author)), ("d", Value::Int(day))],
                    at,
                ),
            )
            .unwrap();
        assert!(p.complete && p.cut.is_none());
        ["dailyLikes", "dailyReplies"].map(|field| {
            let Value::Int(n) = p.data.field(field).unwrap() else {
                panic!("non-integer {field}")
            };
            *n
        })
    };
    let post_before = daily(e, post_day);
    let arrival_before = daily(e, arrival_day);
    sent(
        e,
        "like",
        "alice",
        &[("postId", id(post))],
        at,
        "later-day-like",
    );
    m.like(post, "alice", at).unwrap();
    sent(
        e,
        "reply",
        "alice",
        &[("postId", id(post)), ("body", text("later day reply"))],
        at,
        "later-day-reply",
    );
    m.replies
        .insert("later-day-reply".into(), (post.into(), "alice".into(), at));
    let post_after = daily(e, post_day);
    let arrival_after = daily(e, arrival_day);
    let post_unchanged = post_after == post_before;
    let arrival_gained_both = arrival_after == arrival_before.map(|n| n + 1);
    assert!(post_unchanged, "post-day buckets changed");
    assert!(
        arrival_gained_both,
        "arrival-day buckets did not gain both contributions"
    );
    let like_at = stored_int(e.store(), "likes", "later-day-like", "at");
    let reply_at = stored_int(e.store(), "replies", "later-day-reply", "at");
    assert_eq!(like_at, at);
    assert_eq!(reply_at, at);
    // check() queries every author over the seven-day window, post days, and an empty day.
    m.check(e);
    println!(
        "CLIQUE_ARRIVAL_DAYS {}",
        json!({"post":post,"author":author,"post_day":post_day,"arrival_day":arrival_day,
        "post_before":post_before,"post_after":post_after,
        "arrival_before":arrival_before,"arrival_after":arrival_after,
        "post_unchanged":post_unchanged,"arrival_gained_both":arrival_gained_both,
        "like_at":like_at,"reply_at":reply_at})
    );
}

fn stored_row(store: &Store, table: &str, key: &str) -> Option<Value> {
    store
        .rows(table)
        .unwrap()
        .into_iter()
        .find(|r| field(r, "id") == key)
}

fn stored_int(store: &Store, table: &str, key: &str, column: &str) -> i64 {
    let row = stored_row(store, table, key).unwrap();
    let Value::Int(value) = row.field(column).unwrap() else {
        panic!("{table}.{column}: expected stored integer")
    };
    *value
}
