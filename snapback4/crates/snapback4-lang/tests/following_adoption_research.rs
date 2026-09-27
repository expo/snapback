//! Branch-only research probe; no production adoption path is enabled.
//! @ref LLP 3000.026#5-prototype-and-measurements — actual metered writes into a staged database, not in-place activation.
use snapback4_core::{Context, Engine, Store, Value, WriteState, value::object};
use std::{
    alloc::{GlobalAlloc, Layout, System},
    collections::BTreeMap,
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicUsize, Ordering},
    },
    time::{Duration, Instant},
};

struct Heap;
static LIVE: AtomicUsize = AtomicUsize::new(0);
static PEAK: AtomicUsize = AtomicUsize::new(0);
unsafe impl GlobalAlloc for Heap {
    unsafe fn alloc(&self, l: Layout) -> *mut u8 {
        let p = unsafe { System.alloc(l) };
        if !p.is_null() {
            let n = LIVE.fetch_add(l.size(), Ordering::Relaxed) + l.size();
            PEAK.fetch_max(n, Ordering::Relaxed);
        }
        p
    }
    unsafe fn dealloc(&self, p: *mut u8, l: Layout) {
        LIVE.fetch_sub(l.size(), Ordering::Relaxed);
        unsafe { System.dealloc(p, l) }
    }
    unsafe fn realloc(&self, p: *mut u8, l: Layout, n: usize) -> *mut u8 {
        let q = unsafe { System.realloc(p, l, n) };
        if !q.is_null() {
            let live = if n >= l.size() {
                LIVE.fetch_add(n - l.size(), Ordering::Relaxed) + n - l.size()
            } else {
                LIVE.fetch_sub(l.size() - n, Ordering::Relaxed) - (l.size() - n)
            };
            PEAK.fetch_max(live, Ordering::Relaxed);
        }
        q
    }
}
#[global_allocator]
static HEAP: Heap = Heap;
const Q: &str = include_str!("../../../experiments/following-adoption/probe.q");
const CONTROL: &str = r#"
table probeProgress:
  phase: text <=20
  lastKey: text <=135
  read <- deny
  insert <- deny
  update <- deny
  online only
query progress():
  return probeProgress['cursor']
mutation probePosts(ids: [id] <=32, author: principal, stamp: time, end: text <=135):
  for key in ids:
    insert posts { id: key, authorId: author, parentId: null, body: 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', at: stamp }
  upsert probeProgress['cursor'] { phase: 'posts', lastKey: end }
mutation probeRepost(key: id, actor: principal, postId: posts, stamp: time, end: text <=135):
  insert reposts { id: key, actorId: actor, postId, at: stamp }
  upsert probeProgress['cursor'] { phase: 'reposts', lastKey: end }
mutation probeFollow(key: id, reader: principal, actor: principal, end: text <=135):
  insert follows { id: key, followerId: reader, followedId: actor }
  upsert probeProgress['cursor'] { phase: 'follows', lastKey: end }
mutation phase(phase: text <=20):
  upsert probeProgress['cursor'] { phase, lastKey: '' }
"#;
fn id(s: impl Into<String>) -> Value {
    Value::Id(s.into())
}
fn s(s: impl Into<String>) -> Value {
    Value::String(s.into())
}
fn bound(q: &str) -> snapback4_lang::Bound {
    let b = snapback4_lang::compile(&[("schema.q".into(), q.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    assert!(
        b.programs.iter().any(|p| p.program.name == "follow"),
        "programs={:?}; notes={:?}",
        b.programs
            .iter()
            .map(|p| &p.program.name)
            .collect::<Vec<_>>(),
        b.notes
    );
    b
}
fn bare() -> String {
    Q.replace(
        "view following: activity where .actor = viewer or exists follows[viewer, .actor]\n",
        "",
    )
    .replace(
        "  return following last 20 by .at after c",
        "  return activity last 20 by .at after c",
    )
}
fn memory(q: &str) -> Engine {
    let b = bound(q);
    Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap()
}
fn run(
    e: &mut Engine,
    op: &str,
    viewer: &str,
    args: Vec<(&str, Value)>,
    at: i64,
    minted: Vec<String>,
) -> snapback4_core::MutationOutcome {
    let c = if viewer == snapback4_core::SYSTEM_PRINCIPAL {
        Context::system()
    } else {
        Context::new(viewer, BTreeMap::new())
    };
    let mut c = c.at(at).with_ids(minted);
    c.args = args.into_iter().map(|(k, v)| (k.into(), v)).collect();
    let out = e.mutate(op, None, c).unwrap();
    assert!(
        matches!(out.state, WriteState::Sent { .. }),
        "{op}: {out:?}"
    );
    out
}
fn post(e: &mut Engine, who: &str, key: &str, at: i64) {
    run(
        e,
        "post",
        who,
        vec![("postId", id(key)), ("parentId", Value::Null)],
        at,
        vec![],
    );
}
fn follow(e: &mut Engine, who: &str, actor: &str) {
    run(
        e,
        "follow",
        who,
        vec![("actor", id(actor))],
        9999,
        vec![format!("edge-{who}-{actor}")],
    );
}
fn drain(e: &mut Engine) {
    while e.run_timeline_chunk(9999).unwrap().is_some() {}
}
fn query(e: &mut Engine, op: &str, who: &str) -> snapback4_core::QueryOutcome {
    e.query(
        op,
        Context::new(who, [("c".into(), Value::Null)].into()).at(9999),
    )
    .unwrap()
}
fn copies(e: &Engine, who: &str) -> usize {
    e.store()
        .rows("followingFeed")
        .unwrap()
        .iter()
        .filter(|r| r.field("readerId").unwrap() == &id(who))
        .count()
}
#[test]
fn counterexamples_and_planned_escape() {
    bound(&format!("{Q}\n{CONTROL}"));
    let mut early = memory(Q);
    let mut late = memory(Q);
    follow(&mut early, "reader", "author");
    for n in 0..1001 {
        let key = format!("p{n:04}");
        post(&mut early, "author", &key, 1);
        post(&mut late, "author", &key, 1);
    }
    follow(&mut late, "reader", "author");
    drain(&mut early);
    drain(&mut late);
    assert_eq!(
        (copies(&early, "reader"), copies(&late, "reader")),
        (1001, 1000)
    );
    assert_eq!(
        early.store().rows("posts").unwrap(),
        late.store().rows("posts").unwrap()
    );
    assert_eq!(
        early.store().rows("follows").unwrap(),
        late.store().rows("follows").unwrap()
    );
    for (e, event) in [(&mut early, "event-a"), (&mut late, "event-z")] {
        run(
            e,
            "repost",
            "b",
            vec![("postId", id("p0000"))],
            2,
            vec!["same-source".into(), event.into()],
        );
    }
    // Visible source images are equal after dropping the engine-owned slots.
    let strip = |e: &Engine| {
        let mut r = e.store().rows("reposts").unwrap()[0]
            .as_object()
            .unwrap()
            .clone();
        r.retain(|k, _| !k.starts_with("$timeline:"));
        r
    };
    assert_eq!(strip(&early), strip(&late));
    assert_ne!(
        query(&mut early, "home", "b").data,
        query(&mut late, "home", "b").data
    );
    run(
        &mut early,
        "remove",
        "author",
        vec![("postId", id("p0000"))],
        3,
        vec![],
    );
    assert_eq!(
        query(&mut early, "home", "b")
            .data
            .as_array()
            .unwrap()
            .len(),
        1,
        "independent repost survives original removal"
    );
    let failed = early
        .mutate(
            "repost",
            None,
            Context::new("c", [("postId".into(), id("p0000"))].into()).at(4),
        )
        .unwrap();
    assert!(
        matches!(failed.state, WriteState::Failed { .. }),
        "ordinary repost replay cannot import the retained independent repost"
    );
    let mut retained = memory(&bare());
    post(&mut retained, "author", "old", 1);
    follow(&mut retained, "reader", "author");
    let page = query(&mut retained, "planned", "reader");
    assert!(page.complete);
    assert_eq!(page.data.as_array().unwrap().len(), 1);
    let b = bound(Q);
    assert_eq!(
        retained
            .adopt(b.schema, b.programs.into_iter().map(|p| p.program))
            .unwrap_err()
            .code(),
        "E_TIMELINE_ACTIVATE"
    );
    // A globally newest unrelated suffix cuts the residual before the wanted row.
    retained
        .seed((0..9000).map(|n| {
            (
                "posts".into(),
                object([
                    ("id", id(format!("noise{n:05}"))),
                    ("authorId", id("noise")),
                    ("parentId", Value::Null),
                    ("body", s("noise")),
                    ("at", Value::Int(n + 2)),
                    ("removed", Value::Bool(false)),
                ]),
            )
        }))
        .unwrap();
    let sparse = query(&mut retained, "planned", "reader");
    assert!(!sparse.complete);
    assert!(sparse.unavailable);
    assert!(sparse.next.is_none());
    assert!(sparse.data == Value::Null || sparse.data.as_array().is_ok_and(|a| a.is_empty()));
    println!("SPARSE {sparse:?}");
    println!(
        "COUNTEREXAMPLES early=1001 fresh=1000; equal repost sources/different event ids; planned populated read=1; sparse 9000-row suffix data=0 complete=false next={} examined={}",
        sparse.next.is_some(),
        sparse.metered.examined
    );
}

fn open(path: &std::path::Path, q: &str) -> Engine {
    let b = bound(q);
    Engine::new(
        Store::open(path).unwrap(),
        b.schema,
        b.programs.into_iter().map(|p| p.program),
    )
    .unwrap()
}
fn field(r: &Value, k: &str) -> Value {
    r.field(k).unwrap().clone()
}
fn rows_after(e: &Engine, table: &str, after: &str) -> Vec<Value> {
    e.store().conn().prepare("SELECT data FROM r WHERE t=(SELECT num FROM _catalog WHERE name=?1) AND id>?2 ORDER BY id LIMIT 32").unwrap().query_map([table,after],|r|r.get::<_,String>(0)).unwrap().map(|r|serde_json::from_str(&r.unwrap()).unwrap()).collect()
}
fn cursor(e: &mut Engine) -> (String, String) {
    let r = e.query("progress", Context::system()).unwrap().data;
    if r == Value::Null {
        ("posts".into(), String::new())
    } else {
        (
            r.field("phase").unwrap().as_str().unwrap().into(),
            r.field("lastKey").unwrap().as_str().unwrap().into(),
        )
    }
}
fn stats(mut xs: Vec<f64>) -> serde_json::Value {
    xs.sort_by(f64::total_cmp);
    let n = xs.len();
    serde_json::json!({"n":n,"p50_ms":xs[n/2],"p95_ms":xs[((n-1)*95)/100],"max_ms":xs[n-1]})
}

#[test]
#[ignore = "research measurement: FA_SCALE=1 or 10, FA_DIR is an isolated output directory"]
fn staged_replay_measurement() {
    let scale: usize = std::env::var("FA_SCALE")
        .unwrap_or("1".into())
        .parse()
        .unwrap();
    let dir = std::path::PathBuf::from(std::env::var("FA_DIR").expect("FA_DIR"));
    std::fs::create_dir_all(&dir).unwrap();
    let np = 48000 * scale;
    let nr = 1000 * scale;
    let nf = 6000 * scale;
    let nu = 1008 * scale;
    let predecessor = dir.join("sources.sqlite");
    let candidate = dir.join("candidate.sqlite");
    assert!(
        !predecessor.exists() && !candidate.exists(),
        "use a fresh FA_DIR"
    );
    let mut source = open(&predecessor, &bare());
    let init = Instant::now();
    for first in (0..np).step_by(256) {
        source
            .seed((first..(first + 256).min(np)).map(|n| {
                let actor = n % nu;
                (
                    "posts".into(),
                    object([
                        ("id", id(format!("p{actor:06}-{:06}", n / nu))),
                        ("authorId", id(format!("u{actor:06}"))),
                        ("parentId", Value::Null),
                        ("body", s("x".repeat(200))),
                        ("at", Value::Int(actor as i64)),
                        ("removed", Value::Bool(false)),
                    ]),
                )
            }))
            .unwrap();
    }
    for first in (0..nr).step_by(256) {
        source
            .seed((first..(first + 256).min(nr)).map(|n| {
                (
                    "reposts".into(),
                    object([
                        ("id", id(format!("r{n:08}"))),
                        ("actorId", id(format!("u{:06}", (n + 7) % nu))),
                        ("postId", id(format!("p{:06}-{:06}", n % nu, n / nu))),
                        ("at", Value::Int(100 + n as i64)),
                    ]),
                )
            }))
            .unwrap();
    }
    for first in (0..nf).step_by(256) {
        source
            .seed((first..(first + 256).min(nf)).map(|n| {
                let reader = n % nu;
                let actor = (reader + 1 + n / nu) % nu;
                (
                    "follows".into(),
                    object([
                        ("id", id(format!("f{n:08}"))),
                        ("followerId", id(format!("u{reader:06}"))),
                        ("followedId", id(format!("u{actor:06}"))),
                    ]),
                )
            }))
            .unwrap();
    }
    println!(
        "SEEDED scale={scale} seconds={:.3}",
        init.elapsed().as_secs_f64()
    );
    // The source set is now frozen. The staging facade is intentionally separate
    // from shipping generation publication; actual core reads/writes are used.
    let q = format!("{Q}\n{CONTROL}");
    let mut e = open(&candidate, &q);
    let mut original_reader = source.reader().unwrap();
    let mut candidate_reader = e.reader().unwrap();
    let mut baseline = Vec::new();
    for _ in 0..100 {
        let t = Instant::now();
        let page = query(&mut original_reader, "exportPosts", "u000000");
        assert!(!page.unavailable && page.data.as_array().unwrap().len() == 32);
        baseline.push(t.elapsed().as_secs_f64() * 1000.);
    }
    let stop = Arc::new(AtomicBool::new(false));
    let stop2 = stop.clone();
    PEAK.store(LIVE.load(Ordering::Relaxed), Ordering::Relaxed);
    let baseline_heap = LIVE.load(Ordering::Relaxed);
    let reads = std::thread::spawn(move || {
        let mut old = Vec::new();
        let mut new = Vec::new();
        let mut pending = 0;
        while !stop2.load(Ordering::Relaxed) {
            let t = Instant::now();
            let page = query(&mut original_reader, "exportPosts", "u000000");
            assert!(!page.unavailable && page.data.as_array().unwrap().len() == 32);
            old.push(t.elapsed().as_secs_f64() * 1000.);
            let t = Instant::now();
            let p = staged_home(&mut candidate_reader, "u000000");
            if !p.complete {
                pending += 1;
            }
            new.push(t.elapsed().as_secs_f64() * 1000.);
            std::thread::sleep(Duration::from_millis(10));
        }
        (old, new, pending)
    });
    let start = Instant::now();
    let mut written = 0u64;
    let mut meter_heap = 0u64;
    let mut batches = 0;
    let mut reopen_ms = 0.;
    let mut phases = BTreeMap::new();
    let mut mark = Instant::now();
    let mut reopened = false;
    loop {
        let (phase, after) = cursor(&mut e);
        if phase == "delivery" {
            break;
        }
        let rows = rows_after(&source, &phase, &after);
        if rows.is_empty() {
            phases.insert(phase.clone(), mark.elapsed().as_secs_f64());
            mark = Instant::now();
            let next = match phase.as_str() {
                "posts" => "reposts",
                "reposts" => "follows",
                "follows" => "delivery",
                _ => panic!("bad phase"),
            };
            let out = run(
                &mut e,
                "phase",
                snapback4_core::SYSTEM_PRINCIPAL,
                vec![("phase", s(next))],
                1000000,
                vec![],
            );
            written += out.metered.rows_written;
            continue;
        }
        if phase == "posts" {
            // Group only equal actor AND time. No image is invented by batching.
            let mut a = 0;
            while a < rows.len() {
                let mut z = a + 1;
                while z < rows.len()
                    && field(&rows[z], "authorId") == field(&rows[a], "authorId")
                    && field(&rows[z], "at") == field(&rows[a], "at")
                {
                    z += 1;
                }
                let out = run(
                    &mut e,
                    "probePosts",
                    snapback4_core::SYSTEM_PRINCIPAL,
                    vec![
                        (
                            "ids",
                            Value::Array(rows[a..z].iter().map(|r| field(r, "id")).collect()),
                        ),
                        ("author", field(&rows[a], "authorId")),
                        ("stamp", field(&rows[a], "at")),
                        ("end", s(rows[z - 1].field("id").unwrap().as_str().unwrap())),
                    ],
                    1000000,
                    vec![],
                );
                written += out.metered.rows_written;
                meter_heap = meter_heap.max(out.metered.heap_bytes);
                batches += 1;
                a = z;
            }
        } else {
            for row in &rows {
                let key = row.field("id").unwrap().as_str().unwrap();
                let out = if phase == "reposts" {
                    let event = snapback4_core::schema::timeline::owned_id(
                        "following",
                        "AdoptEvent",
                        &[id("experiment-epoch-1"), s("reposts"), id(key)],
                    );
                    run(
                        &mut e,
                        "probeRepost",
                        snapback4_core::SYSTEM_PRINCIPAL,
                        vec![
                            ("key", id(key)),
                            ("actor", field(row, "actorId")),
                            ("postId", field(row, "postId")),
                            ("stamp", field(row, "at")),
                            ("end", s(key)),
                        ],
                        1000000,
                        vec![event],
                    )
                } else {
                    run(
                        &mut e,
                        "probeFollow",
                        snapback4_core::SYSTEM_PRINCIPAL,
                        vec![
                            ("key", id(key)),
                            ("reader", field(row, "followerId")),
                            ("actor", field(row, "followedId")),
                            ("end", s(key)),
                        ],
                        1000000,
                        vec![],
                    )
                };
                written += out.metered.rows_written;
                meter_heap = meter_heap.max(out.metered.heap_bytes);
                batches += 1;
            }
        }
        if !reopened && batches >= 1000 {
            let before = cursor(&mut e);
            let t = Instant::now();
            drop(e);
            e = Engine::open(Store::open(&candidate).unwrap()).unwrap();
            reopen_ms = t.elapsed().as_secs_f64() * 1000.;
            assert_eq!(cursor(&mut e), before);
            reopened = true;
        }
        if batches % 5000 == 0 {
            println!(
                "PROGRESS scale={scale} phase={phase} batches={batches} elapsed_s={:.1}",
                start.elapsed().as_secs_f64()
            );
        }
    }
    let mut chunks = 0;
    while let Some(m) = e.run_timeline_chunk(1000000).unwrap() {
        written += m.rows_written;
        meter_heap = meter_heap.max(m.heap_bytes);
        chunks += 1;
        if chunks % 10000 == 0 {
            println!(
                "DELIVERY scale={scale} chunks={chunks} elapsed_s={:.1}",
                start.elapsed().as_secs_f64()
            );
        }
    }
    phases.insert("delivery".into(), mark.elapsed().as_secs_f64());
    assert_eq!(
        e.timeline_work_counts().unwrap(),
        [("following".into(), 0, 0)]
    );
    written += run(
        &mut e,
        "phase",
        snapback4_core::SYSTEM_PRINCIPAL,
        vec![("phase", s("done"))],
        1000000,
        vec![],
    )
    .metered
    .rows_written;
    let elapsed = start.elapsed().as_secs_f64();
    let peak = PEAK.load(Ordering::Relaxed);
    stop.store(true, Ordering::Relaxed);
    let (old, new, pending) = reads.join().unwrap();
    let count = |name: &str| e.store().count(name).unwrap();
    let events_for = |actor: usize| {
        let originals = (np + nu - 1 - actor) / nu;
        let first_repost = (actor + nu - 7) % nu;
        let reposts = if first_repost < nr {
            (nr + nu - 1 - first_repost) / nu
        } else {
            0
        };
        originals + reposts
    };
    let expected_copies = np
        + nr
        + (0..nf)
            .map(|n| events_for((n % nu + 1 + n / nu) % nu).min(1000))
            .sum::<usize>();
    assert_eq!(count("followingPosts"), (np + nr) as u64);
    assert_eq!(count("followingFeed"), expected_copies as u64);
    assert_eq!(count("followingEdges"), nf as u64);
    let result = serde_json::json!({"scale":scale,"posts":np,"reposts":nr,"follows":nf,"principals":nu,"adoption_construction_s":elapsed,"phases_s":phases,"logical_rows_written":written,"final_events":count("followingPosts"),"final_copies":count("followingFeed"),"final_edges":count("followingEdges"),"retained_work":count("followingWork"),"batches":batches,"delivery_chunks":chunks,"rust_heap_at_start_bytes":baseline_heap,"rust_heap_peak_bytes":peak,"max_reported_chunk_heap_bytes":meter_heap,"source_read_baseline":stats(baseline),"source_reads_during":stats(old),"candidate_reads_during":stats(new),"pending_samples":pending,"reopen_ms":reopen_ms,"sqlite_sizes":e.store().sizes().unwrap()});
    println!("RESULT {result}");
    std::fs::write(
        dir.join("result.json"),
        serde_json::to_string_pretty(&result).unwrap(),
    )
    .unwrap();
}

#[test]
fn committed_checkpoint_survives_process_exit() {
    let dir = std::env::temp_dir().join(format!("fa-crash-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("stage.sqlite");
    assert!(!path.exists());
    let status = std::process::Command::new(std::env::current_exe().unwrap())
        .args(["--exact", "crash_child", "--ignored", "--nocapture"])
        .env("FA_CRASH_STORE", &path)
        .status()
        .unwrap();
    assert_eq!(status.code(), Some(73));
    let mut e = Engine::open(Store::open(&path).unwrap()).unwrap();
    assert_eq!(cursor(&mut e), ("posts".into(), "p1".into()));
    assert_eq!(e.store().count("followingPosts").unwrap(), 2);
    run(
        &mut e,
        "probePosts",
        snapback4_core::SYSTEM_PRINCIPAL,
        vec![
            ("ids", Value::Array(vec![id("p2")])),
            ("author", id("a")),
            ("stamp", Value::Int(1)),
            ("end", s("p2")),
        ],
        2,
        vec![],
    );
    assert_eq!(cursor(&mut e), ("posts".into(), "p2".into()));
    assert_eq!(e.store().count("followingPosts").unwrap(), 3);
    drop(e);
    std::fs::remove_dir_all(dir).unwrap();
}
#[test]
#[ignore = "child of committed_checkpoint_survives_process_exit"]
fn crash_child() {
    let path = std::path::PathBuf::from(std::env::var("FA_CRASH_STORE").unwrap());
    let mut e = open(&path, &format!("{Q}\n{CONTROL}"));
    run(
        &mut e,
        "probePosts",
        snapback4_core::SYSTEM_PRINCIPAL,
        vec![
            ("ids", Value::Array(vec![id("p0"), id("p1")])),
            ("author", id("a")),
            ("stamp", Value::Int(1)),
            ("end", s("p1")),
        ],
        1,
        vec![],
    );
    std::process::exit(73); // no Engine/Store destructor or clean connection close
}

#[test]
fn identical_feed_with_unrelated_literal_default_is_not_an_incarnation_fence() {
    let old = bound(Q).schema.public_projection();
    let new = bound(&Q.replace(
        "table posts:\n",
        "table posts:\n  decoration: bool default false\n",
    ))
    .schema
    .public_projection();
    assert!(snapback4_core::successor::keeps_literal_default_images(
        &old, &new
    ));
    let fresh = bound(&Q.replace("following", "followingNext").replace(
        "table posts:\n",
        "table posts:\n  decoration: bool default false\n",
    ))
    .schema
    .public_projection();
    assert!(!snapback4_core::successor::keeps_literal_default_images(
        &old, &fresh
    ));
}

// The control snapshot must precede the page: seeing done after an older page
// would falsely certify that page. Construction's phase only advances to done.
fn staged_home(e: &mut Engine, who: &str) -> snapback4_core::QueryOutcome {
    let pending = cursor(e).0 != "done";
    let mut page = query(e, "home", who);
    if pending {
        page.complete = false;
    }
    page
}
#[test]
fn undiscovered_reader_is_pending_even_without_edge_work() {
    let mut e = memory(&format!("{Q}\n{CONTROL}"));
    assert!(query(&mut e, "home", "reader").complete);
    assert!(!staged_home(&mut e, "reader").complete);
    run(
        &mut e,
        "phase",
        snapback4_core::SYSTEM_PRINCIPAL,
        vec![("phase", s("done"))],
        1,
        vec![],
    );
    assert!(staged_home(&mut e, "reader").complete);
}
