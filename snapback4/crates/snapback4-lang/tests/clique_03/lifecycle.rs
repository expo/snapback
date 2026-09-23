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
        let p = e
            .snapshot_acquisition_page_at(who, after.as_deref(), 1000, now)
            .unwrap();
        let next = p.next.map(|n| n.encode());
        rows += p.events.len();
        let wire = json!({"snapshot":true,"after":after,"held":p.held,"acquisitions":p.acquisitions,
            "events":p.events.iter().map(|r|json!({"table":r.table,"kind":r.kind.word(),"id":r.id,"data":r.data.as_ref().map(snapback4_core::wire::to_json)})).collect::<Vec<_>>(),
            "watermark":p.watermark,"more":next.is_some(),"next":next,"generation":e.generation()});
        bytes += serde_json::to_vec(&wire).unwrap().len();
        let page: StreamPage = serde_json::from_value(wire).unwrap();
        d.apply(&page, after.is_none()).unwrap();
        match next {
            Some(c) => after = Some(c),
            None => break,
        }
    }
    (rows, bytes)
}
fn compare(e: &mut Engine, d: &mut Device<Store>, now: i64) {
    for (op, args) in [
        ("following", json!({})),
        ("trending", json!({})),
        ("thread", json!({"postId":"sp0001"})),
    ] {
        let got = d.query(op, "u0005", &args, now).unwrap();
        assert!(got.complete, "device {op}: {got:?}");
        let args = if op == "thread" {
            vec![("postId", id("sp0001"))]
        } else {
            vec![]
        };
        let want = e.query(op, ctx("u0005", &args, now)).unwrap();
        assert_eq!(got.data, want.data, "device {op}");
    }
}
// @ref LLP 3000.007.001#311-adoption — populated activation is event-free; device images are reacquired behind the generation barrier.
pub fn adopt(e: &mut Engine, m: &Model) -> (Device<Store>, PathBuf) {
    let path = dir().join("device.sqlite");
    let mut d = Device::open(&path, Some(backend(e, &prior()))).unwrap();
    let start = Instant::now();
    let (rows, bytes) = acquire(e, &mut d, "u0005", m.now);
    println!(
        "CLIQUE_COLD {}",
        json!({"generation":"prior","rows":rows,"wire_bytes":bytes,"elapsed_s":start.elapsed().as_secs_f64()})
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
    compare(e, &mut d, m.now);
    // Full authoritative parent values are compared, not just the first ranking page.
    let expected = m.like_counts();
    for row in d.store().rows("posts").unwrap() {
        let count = match row.field("likeCount") {
            Ok(Value::Int(n)) => *n,
            _ => 0,
        };
        assert_eq!(count, expected.get(field(&row, "id")).copied().unwrap_or(0));
    }
    println!(
        "CLIQUE_ADOPTION {}",
        json!({"old_generation":old,"generation":e.generation(),"activation_s":activation,"activation_row_events":events,"reacquired_rows":rows,"reacquired_wire_bytes":bytes,"reacquisition_s":start.elapsed().as_secs_f64(),"device":"pass"})
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
    for (n, q) in queued.iter().enumerate() {
        let args: Vec<(&str, Value)> = match n {
            0 => vec![("body", text("offline post"))],
            1 => vec![("postId", id("sp0001"))],
            2 => vec![("postId", id("sp0001")), ("body", text("offline reply"))],
            3 => vec![("authorId", id(&followed))],
            _ => vec![("authorId", id(&new_author))],
        };
        let from = e.seq().unwrap();
        let at = m.now + n as i64;
        let out = e
            .mutate(
                &q.op,
                Some(&q.id),
                ctx("u0005", &args, at).with_ids(q.new_ids.clone()),
            )
            .unwrap();
        let seq = match out.state {
            WriteState::Sent { seq, .. } => seq,
            _ => panic!("settlement {out:?}"),
        };
        d.settle(&q.id, Some(seq)).unwrap();
        let p = e.stream_at("u0005", from, 10000, at).unwrap();
        let page:StreamPage=serde_json::from_value(json!({"snapshot":false,"requested_watermark":from,"images_at":p.images_at,"joined":p.joined,"acquisitions":p.acquisitions,
            "events":p.events.iter().map(|r|json!({"table":r.table,"kind":r.kind,"id":r.id,"data":r.data.as_ref().map(snapback4_core::wire::to_json)})).collect::<Vec<_>>(),"watermark":p.watermark,"more":p.more,"generation":e.generation()})).unwrap();
        assert!(!p.more);
        d.apply(&page, false).unwrap();
        match n {
            0 => {
                let key = &q.new_ids[0];
                m.posts.insert(
                    key.clone(),
                    model::Post {
                        author: "u0005".into(),
                        at,
                        body: "offline post".into(),
                    },
                );
                m.event(key, key, "u0005", at, false);
            }
            1 => {
                m.likes.insert(("sp0001".into(), "u0005".into()));
            }
            2 => {
                m.replies
                    .insert(q.new_ids[0].clone(), ("sp0001".into(), "u0005".into(), at));
            }
            3 => m.unfollow("u0005", &followed),
            _ => m.follow("u0005", &new_author),
        }
    }
    m.now += 10;
    assert!(d.queued().unwrap().is_empty());
    compare(e, &mut d, m.now);
    println!(
        "CLIQUE_RESTART {}",
        json!({"queued":queued.len(),"posting_predicts":true,"follow_unfollow_queue":true,"two_native_processes":true,"settlement":"pass"})
    );
    drop(d);
    fs::remove_dir_all(path.parent().unwrap()).unwrap();
}

pub fn removals(e: &mut Engine, m: &mut Model) {
    m.now += 1000;
    // Reposts are independent events and survive removal of their original.
    sent(
        e,
        "repost",
        "u0005",
        &[("postId", id("rank-003"))],
        m.now,
        "lifecycle-repost",
    );
    m.event("lifecycle-repost-event", "rank-003", "u0005", m.now, true);
    sent(
        e,
        "repost",
        "u0005",
        &[("postId", id("rank-003"))],
        m.now,
        "lifecycle-repeat",
    );
    sent(
        e,
        "remove",
        "alice",
        &[("postId", id("rank-003"))],
        m.now,
        "lifecycle-remove",
    );
    m.events.remove("rank-003");
    m.check_following(e);
    for who in ["bob", "carol"] {
        sent(
            e,
            "unlike",
            who,
            &[("postId", id("rank-003"))],
            m.now,
            &format!("unlike-{who}"),
        );
        m.likes.remove(&("rank-003".into(), who.into()));
    }
    sent(
        e,
        "unrepost",
        "u0005",
        &[("postId", id("rank-003"))],
        m.now,
        "lifecycle-unrepost",
    );
    m.events.remove("lifecycle-repost-event");
    let job = e
        .schema()
        .schedules
        .iter()
        .find(|s| s.target.ends_with("PurgeRemoved"))
        .unwrap()
        .target
        .clone();
    let out = e.run_job(&job, Default::default(), m.now).unwrap();
    assert!(
        matches!(out.state, snapback4_core::JobState::Done),
        "{out:?}"
    );
    assert!(e.store().rows("feedRemovedEvents").unwrap().is_empty());
    println!(
        "CLIQUE_TRANSITIONS {}",
        json!({"duplicate_repost":"idempotent","original_removal":"repost preserved","unlike":"zero","unrepost_and_cleanup":"pass"})
    );
}
