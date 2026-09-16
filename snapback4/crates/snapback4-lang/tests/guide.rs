//! The guide is compiled. Every ```quarry block in the language card, the
//! keyword cards and the package README binds with no diagnostic and no
//! note; the language card runs against the engine; every refusal code the
//! system emits is one `why` explains; every guide keyword a diagnostic
//! names is a card; the numbers the cards state are the engine's. A card
//! cannot promise a form the parser refuses (LLP 3000 §7, 2026-09-13).

use snapback4_core::JobState;
use snapback4_core::error::RuntimeError;
use snapback4_core::meter::Ceilings;
use snapback4_core::{Context, Engine, Value, WriteState};
use snapback4_lang::guide::{self, KEYWORDS, LANGUAGE, card, codes, explain_code, language, quarry};
use std::collections::BTreeMap;

#[test]
fn time_waiting_cards_point_to_cli_and_http_clock_controls() {
    for name in ["expire", "jobs", "effects"] {
        let card = snapback4_lang::guide::card(name).unwrap();
        assert!(card.contains("snapback4 clock advance <dur>"), "{name}: missing test pointer");
        assert!(card.contains("POST /dev/clock/advance"), "{name}: missing HTTP pointer");
        assert!(card.contains("snapback4 clock advance 36s\ncurl"), "{name}: missing two-line example");
    }
    assert!(snapback4_lang::guide::card("presence").unwrap().contains("In tests: `snapback4 clock advance 36s`"));
    let readme = README;
    assert!(readme.contains("snapback4 clock advance <dur>"));
    assert!(readme.contains("snapback4 clock advance 36s\n  curl"));
}
use std::path::{Path, PathBuf};

const README: &str = concat!(include_str!("../../../packages/snapback4/README.md"), "\n", include_str!("../../../packages/snapback4/CLIENT-AND-OPERATIONS.md"), "\n", include_str!("../../../packages/snapback4/SERVER.md"));

#[test]
fn w10a_readme_opening_is_one_way_into_the_published_surface() {
    let readme = include_str!("../../../packages/snapback4/README.md");
    let opening = readme.split("## 1.").next().unwrap();
    for text in ["README.md", "CLIENT-AND-OPERATIONS.md", "./CLIENT-AND-OPERATIONS.md#4-the-client", "./CLIENT-AND-OPERATIONS.md#8-not-in-this-release", "Start here", "snapback4 guide <card>", "snapback4 why <code>", "terminal", "cold-offline"] {
        assert!(opening.contains(text), "the first page omits {text}");
    }
    for card in ["language", "rules", "sync", "residency", "prediction", "reads", "writes", "effects", "jobs", "personas", "assets", "actions", "clock", "routes"] {
        assert!(opening.contains(&format!("guide {card}")), "start path omits {card}");
    }
    assert!(!readme.to_lowercase().contains("there is no other documentation"));
    assert!(include_str!("../../../packages/snapback4/CLIENT-AND-OPERATIONS.md").contains("## 4. The client"));
}

#[test]
fn w10a_effect_and_job_names_are_explained_where_a_module_declares_both() {
    let source = "effect notify\ntable notices:\n  body: text <=100\n  read <- allow\njob daily():\n  chunk n in notices first 50 by byId:\n    emit notify { body: n.body }\nschedule dailyDigest every 1d: digest.daily\n";
    let bound = snapback4_lang::compile(&[("digest.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    assert!(bound.notes.is_empty(), "{:?}", bound.notes);
    assert_eq!(bound.schema.effects, ["notify"]);
    assert_eq!(bound.schema.schedules[0].target, "digest.daily");
    let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    engine.seed([("notices".into(), snapback4_core::value::object([("id", id("n1")), ("body", text("hello"))]))]).unwrap();
    let run = engine.run_job("digest.daily", BTreeMap::new(), 1000).unwrap();
    assert_eq!(run.state, JobState::Done);
    let effects = engine.effects(Some("queued"), 10).unwrap();
    assert_eq!(effects.len(), 1);
    assert_eq!(effects[0].effect, "notify");
    for (name, doc) in [("jobs", card("jobs").unwrap()), ("effects", card("effects").unwrap()), ("README", README)] {
        let prose = doc.split_whitespace().collect::<Vec<_>>().join(" ");
        for phrase in ["Effects are global declarations", "jobs are module-qualified operations", "digest.q", "emit notify", "effects: { notify:", "digest.daily"] {
            assert!(prose.contains(phrase), "{name} omits {phrase}");
        }
    }
}

#[test]
fn w10b_typing_card_compiles_and_expires_at_the_deadline() {
    let reads = card("reads").unwrap();
    let source = quarry(reads).into_iter().find(|block| block.contains("table typing:")).expect("typing needs a worked expiry example");
    let bound = clean("typing", &in_context(&source));
    let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    engine.seed([
        ("rooms".into(), snapback4_core::value::object([("id", id("room"))])),
        ("members".into(), snapback4_core::value::object([("id", id("member")), ("roomId", id("room")), ("principal", id("alice"))])),
    ]).unwrap();
    sent(&engine.mutate("setTyping", None, Context::new("alice", args(&[("roomId", id("room"))])).at(1000)).unwrap());
    let query = |now| Context::new("alice", args(&[("roomId", id("room"))])).at(now);
    let before = engine.query("typingNow", query(5499)).unwrap();
    assert_eq!(before.data.as_array().unwrap().len(), 1);
    assert_eq!(before.data.as_array().unwrap()[0].field("expiresAt").unwrap(), &Value::Int(5500));
    assert!(engine.query("typingNow", query(5500)).unwrap().data.as_array().unwrap().is_empty());
}

fn compile(source: &str) -> snapback4_lang::Bound {
    snapback4_lang::compile(&[("schema.q".to_owned(), source.to_owned())])
}

/// A block that declares a table stands alone; another compiles beside the
/// language card's schema.
fn in_context(block: &str) -> String {
    // This card block is explicitly a second file beside the installed recipe.
    if block.starts_with("-- After: snapback4 init --recipe feeds --prefix feed\n") {
        return format!("{}\n{block}", snapback4_lang::recipe::following("feed", "").unwrap());
    }
    if block.lines().any(|line| line.starts_with("table ")) { block.to_owned() } else { format!("{}\n{block}", language()) }
}

fn clean(label: &str, source: &str) -> snapback4_lang::Bound {
    let bound = compile(source);
    let list = |items: &[snapback4_lang::Diagnostic]| items.iter().map(ToString::to_string).collect::<Vec<_>>().join("\n");
    assert!(bound.diagnostics.is_empty(), "{label} does not compile:\n{}", list(&bound.diagnostics));
    assert!(bound.notes.is_empty(), "{label} compiles with notes:\n{}", list(&bound.notes));
    bound
}

fn id(s: &str) -> Value {
    Value::Id(s.into())
}

fn text(s: &str) -> Value {
    Value::String(s.into())
}

fn args(pairs: &[(&str, Value)]) -> BTreeMap<String, Value> {
    pairs.iter().map(|(k, v)| ((*k).to_owned(), v.clone())).collect()
}

fn sent(outcome: &snapback4_core::MutationOutcome) -> &Value {
    match &outcome.state {
        WriteState::Sent { result, .. } => result,
        WriteState::Failed { why, .. } => panic!("failed: {} {}", why.code, why.message),
    }
}

fn failed(outcome: &snapback4_core::MutationOutcome) -> &str {
    match &outcome.state {
        WriteState::Failed { why, .. } => &why.code,
        WriteState::Sent { result, .. } => panic!("sent: {result:?}"),
    }
}

/// The language card is one program that exercises every form; it binds
/// clean and every operation on it does what its comment says.
#[test]
fn the_language_card_compiles_and_runs() {
    let source = language();
    let bound = clean("the language card", &source);
    let names: Vec<&str> = bound.programs.iter().map(|p| p.program.name.as_str()).collect();
    assert_eq!(names, ["daily", "today", "calendar", "anchoredKeys", "digestToday", "mostLiked", "chips", "heldRoom", "room", "helperRows", "thread", "inbox", "following", "ancestors", "digest", "mentions", "search", "everywhere", "online", "pagePass", "registerProfile", "createRoom", "sendBrief", "edit", "join", "leave", "react", "post", "split", "nightly", "rescoreNative", "personalizeNative", "summarizeRoom", "scheduledSummary"]);
    assert_eq!(bound.schema.effects, ["notify", "sendDigest"]);
    assert_eq!(bound.schema.schedules.len(), 2);
    assert_eq!(bound.schema.routes.keys().map(String::as_str).collect::<Vec<_>>(), ["providerEvent", "roomExport"]);
    assert_eq!(bound.schema.routes["providerEvent"].service.as_deref(), Some("service:reporter"));
    assert_eq!(bound.schema.routes["roomExport"].service, None);
    assert!(!bound.schema.operations.contains_key("roomExport"));
    assert_eq!(bound.personas, ["alice", "bob", "carol"]);
    let mut engine = Engine::memory(bound.schema.clone(), bound.programs.iter().map(|p| p.program.clone())).unwrap();
    let (alice, bob) = ("dev:alice", "dev:bob");

    let registered = engine.mutate("registerProfile", Some("profile1"), Context::new(alice, args(&[("handle", text("alice"))])).with_ids(["profile1".into()])).unwrap();
    assert_eq!(sent(&registered).field("handle").unwrap(), &text("alice"));
    let duplicate = engine.mutate("registerProfile", Some("profile2"), Context::new(bob, args(&[("handle", text("alice"))])).with_ids(["profile2".into()])).unwrap();
    assert_eq!(failed(&duplicate), "HANDLE_TAKEN");
    let WriteState::Failed { why, .. } = duplicate.state else { unreachable!() };
    assert_eq!(why.message, "That handle is taken.");
    assert_eq!(why.detail.as_deref(), Some("profiles.byHandle already has a row where handle = 'alice'"));

    // createRoom: `new` takes the first minted id; the second insert the next; `after insert` holds.
    let created = engine.mutate("createRoom", Some("c1"), Context::new(alice, args(&[("name", text("General")), ("kind", text("open")), ("tags", Value::Array(vec![text("new")]))])).at(1_000).with_ids(["r1".to_owned(), "m1".to_owned()])).unwrap();
    let room = sent(&created);
    assert_eq!(room.field("id").unwrap(), &id("r1"));
    assert_eq!(room.field("owner").unwrap(), &id(alice));
    assert_eq!(room.field("kind").unwrap(), &text("open"));
    assert_eq!(room.field("tagCount").unwrap(), &Value::Int(1));
    let held = bound.programs.iter().find(|p| p.program.name == "heldRoom").unwrap();
    let tx = engine.store_mut().read_transaction().unwrap();
    let local = snapback4_core::engine::local::query(&tx, &bound.schema, &held.program,
        Context::new(alice, args(&[("roomId", id("r1"))])).at(1_000), Ceilings::default()).unwrap();
    assert_eq!(local.data.field("name").unwrap(), &text("General"));
    drop(tx);
    assert_eq!(engine.query("heldRoom", Context::new(alice, args(&[("roomId", id("r1"))]))).unwrap_err().code, "E_QUERY_HELD");
    // join: `insert .. if absent` yields the row, then null on the clash.
    let joined = engine.mutate("join", Some("j1"), Context::new(alice, args(&[("roomId", id("r1")), ("principal", id(bob))])).at(1_100).with_ids(["m2".to_owned()])).unwrap();
    assert_eq!(sent(&joined).field("principal").unwrap(), &id(bob));
    let again = engine.mutate("join", Some("j2"), Context::new(alice, args(&[("roomId", id("r1")), ("principal", id(bob))])).at(1_200).with_ids(["m3".to_owned()])).unwrap();
    assert_eq!(sent(&again), &Value::Null);
    assert_eq!(failed(&engine.mutate("join", Some("j3"), Context::new(bob, args(&[("roomId", id("r1")), ("principal", id("dev:carol"))])).at(1_300)).unwrap()), "NOT_ADMIN");
    // sendBrief: the conditional value, narrowing, `??`, tokens, a helper fn.
    let brief = engine.mutate("sendBrief", Some("s1"), Context::new(bob, args(&[("roomId", id("r1")), ("body", text("hi @alice")), ("ttl", Value::Int(500))])).at(2_000).with_ids(["msg1".to_owned()])).unwrap();
    assert_eq!(sent(&brief).field("brief").unwrap(), &Value::Bool(true));
    assert_eq!(sent(&brief).field("mentions").unwrap(), &Value::Int(1));
    let kept = engine.mutate("sendBrief", Some("s2"), Context::new(bob, args(&[("roomId", id("r1")), ("body", text("keep"))])).at(2_100).with_ids(["msg2".to_owned()])).unwrap();
    assert_eq!(sent(&kept).field("brief").unwrap(), &Value::Bool(false));
    let pass = engine.mutate("pagePass", Some("pass"), Context::new(bob, args(&[("roomId", id("r1"))])).at(2_200)).unwrap();
    assert_eq!(sent(&pass), &Value::Int(2));
    assert_eq!(bound.schema.operations["pagePass"].predicts.as_deref(), Some("never"));
    // thread: a cursor page with a shape, the maintain as a number, expiry as absence.
    let thread = engine.query("thread", Context::new(alice, args(&[("roomId", id("r1"))])).at(2_200)).unwrap();
    let rows = thread.data.as_array().unwrap();
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0].field("body").unwrap(), &text("keep"));
    assert_eq!(rows[0].field("count").unwrap(), &Value::Int(2));
    assert_eq!(rows[0].field("room").unwrap().field("name").unwrap(), &text("General"));
    assert!(thread.complete);
    assert_eq!(engine.query("thread", Context::new(alice, args(&[("roomId", id("r1"))])).at(2_600)).unwrap().data.as_array().unwrap().len(), 1, "the brief message expired at 2,500");
    assert_eq!(engine.query("thread", Context::new("dev:mallory", args(&[("roomId", id("r1"))])).at(2_200)).unwrap_err().code, "NOT_MEMBER");
    let helper = engine.query("helperRows", Context::new(bob, args(&[("messageId", id("msg2"))])).at(2_200)).unwrap();
    assert_eq!(helper.data.field("body"), helper.data.field("byId"));
    assert_eq!(helper.data.field("body").unwrap(), &text("keep"));
    // inbox and room: shapes over a page and over a row.
    let inbox = engine.query("inbox", Context::new(bob, args(&[])).at(2_200)).unwrap();
    assert_eq!(inbox.data.as_array().unwrap()[0].field("unread").unwrap(), &Value::Int(2));
    assert_eq!(engine.query("room", Context::new(bob, args(&[("roomId", id("r1"))])).at(2_200)).unwrap().data.field("name").unwrap(), &text("General"));
    assert_eq!(engine.query("room", Context::new("dev:mallory", args(&[("roomId", id("r1"))])).at(2_200)).unwrap().data, Value::Null, "hidden is null");
    // digest: divmod, sorted, min, max, slice, sort, a helper with null.
    let digest = engine.query("digest", Context::new(alice, args(&[("roomId", id("r1"))])).at(2_200)).unwrap().data;
    assert_eq!(digest.field("total").unwrap(), &Value::Int(2));
    assert_eq!(digest.field("grouped").unwrap().as_array().unwrap()[0].field("count").unwrap(), &Value::Int(2));
    assert_eq!(digest.field("first").unwrap().field("id").unwrap(), &id("msg2"));
    assert_eq!(digest.field("last").unwrap().field("id").unwrap(), &id("msg1"));
    assert_eq!(digest.field("at").unwrap().field("id").unwrap(), &id("msg1"));
    assert_eq!(digest.field("counter").unwrap(), &Value::Int(2));
    assert_eq!(digest.field("offsets").unwrap(), &Value::Array(vec![Value::Int(0), Value::Int(1)]));
    assert_eq!(digest.field("label").unwrap(), &text("digest: room / messages"));
    assert_eq!(digest.field("labelSize").unwrap(), &Value::Int(23));
    assert_eq!(digest.field("doubled").unwrap(), &Value::Int(4));
    assert_eq!((digest.field("quotient").unwrap(), digest.field("remainder").unwrap()), (&Value::Int(0), &Value::Int(2)));
    assert_eq!((digest.field("weeks").unwrap(), digest.field("days").unwrap()), (&Value::Int(0), &Value::Int(2)));
    assert_eq!((digest.field("lo").unwrap(), digest.field("hi").unwrap()), (&Value::Int(0), &Value::Int(2)));
    assert_eq!((digest.field("smaller").unwrap(), digest.field("larger").unwrap()), (&Value::Int(0), &Value::Int(2)));
    assert_eq!(digest.field("brief").unwrap(), &Value::Bool(false));
    let oldest = digest.field("oldest").unwrap().as_array().unwrap();
    assert_eq!(oldest.iter().map(|m| m.field("at").unwrap().as_int().unwrap()).collect::<Vec<_>>(), [2_000, 2_100], "sorted ascending by at");
    // mentions: tokens.
    assert_eq!(engine.query("mentions", Context::new(alice, args(&[("body", text("hey @bob and @carol"))])).at(2_200)).unwrap().data, Value::Array(vec![text("bob"), text("carol")]));
    // search: a word prefix over the room's messages, newest first; online: nobody is connected here.
    let found = engine.query("search", Context::new(alice, args(&[("roomId", id("r1")), ("q", text("KEE"))])).at(2_200)).unwrap();
    assert_eq!(found.data.as_array().unwrap().iter().map(|m| m.field("body").unwrap().clone()).collect::<Vec<_>>(), vec![text("keep")]);
    assert!(found.complete);
    let everywhere = engine.query("everywhere", Context::new(alice, args(&[("q", text("KEE"))])).at(2_200)).unwrap();
    assert_eq!(everywhere.data, found.data);
    assert!(everywhere.complete);
    assert_eq!(engine.query("online", Context::new(alice, args(&[("p", id(bob))])).at(2_200)).unwrap().data, Value::Int(0));
    // sendBrief emitted for the members with no connection: bob, once per send.
    assert_eq!(engine.effects(Some("queued"), 10).unwrap().len(), 2, "one effect per send, for the one other member");
    // post: a loop over a bounded list argument; following: a merge over lanes, shaped.
    let posted = engine.mutate("post", Some("p1"), Context::new(alice, args(&[("bodies", Value::Array(vec![text("a"), text("b")]))])).at(3_000).with_ids(["post1".to_owned(), "post2".to_owned()])).unwrap();
    assert_eq!(sent(&posted), &Value::Int(2));
    // Calendar maintains share scalar keys with ordinary expressions; pages retain their group fields.
    assert_eq!(engine.query("today", Context::new(alice, args(&[])).at(3_000)).unwrap().data, Value::Int(2));
    assert_eq!(engine.query("today", Context::new(alice, args(&[])).at(86_400_000)).unwrap().data, Value::Int(0));
    let daily = engine.query("daily", Context::new(alice, args(&[])).at(3_000)).unwrap();
    assert_eq!(daily.data.as_array().unwrap()[0].field("day").unwrap(), &Value::Int(0));
    assert_eq!(daily.data.as_array().unwrap()[0].field("count").unwrap(), &Value::Int(2));
    assert!(daily.complete);
    let calendar = engine.query("calendar", Context::new(alice, args(&[])).at(-1)).unwrap().data;
    assert_eq!(calendar.field("hour").unwrap(), &Value::Int(-1));
    assert_eq!(calendar.field("bucket").unwrap(), &Value::Int(-1));
    engine.seed([("follows".to_owned(), snapback4_core::value::object([("id", id("f1")), ("followerId", id(bob)), ("followedId", id(alice))]))]).unwrap();
    // The full delivery lifecycle is on the feeds card; exercise both projected lanes here.
    let projected = |row_id: &str, event: &str, reader: &str| snapback4_core::value::object([
        ("id", id(row_id)), ("eventId", id(event)), ("readerId", id(reader)), ("authorId", id(alice)), ("body", text(event)), ("at", Value::Int(3_000)),
    ]);
    engine.seed([
        ("feed".into(), projected("private1", "post1", bob)),
        ("feed".into(), projected("hidden", "hiddenPost", alice)),
        ("broadcast".into(), projected("shared2", "post2", alice)),
        ("pulls".into(), snapback4_core::value::object([("id", id("pull1")), ("readerId", id(bob)), ("authorId", id(alice))])),
    ]).unwrap();
    let following = engine.query("following", Context::new(bob, args(&[])).at(3_100)).unwrap();
    let posts = following.data.as_array().unwrap();
    assert_eq!(posts.len(), 2);
    assert_eq!(posts[0].field("mine").unwrap(), &Value::Null);
    // react: a refusal with the program's code; upsert as the implicit return.
    assert_eq!(failed(&engine.mutate("react", Some("x1"), Context::new(bob, args(&[("postId", id("post1")), ("direction", Value::Int(2))])).at(3_200)).unwrap()), "BAD_DIRECTION");
    let reacted = engine.mutate("react", Some("x2"), Context::new(bob, args(&[("postId", id("post1")), ("direction", Value::Int(-1))])).at(3_300).with_ids(["react1".to_owned()])).unwrap();
    assert_eq!(sent(&reacted).field("direction").unwrap(), &Value::Int(-1));
    let chips = engine.query("chips", Context::new(bob, args(&[("postId", id("post1"))])).at(3_300)).unwrap();
    assert_eq!(chips.data.as_array().unwrap()[0].field("emoji").unwrap(), &text("like"));
    assert_eq!(chips.data.as_array().unwrap()[0].field("count").unwrap(), &Value::Int(1));
    assert_eq!(engine.query("anchoredKeys", Context::new(bob, args(&[])).at(28_800_000)).unwrap().data,
        snapback4_core::value::object([("day", Value::Int(0)), ("hour", Value::Int(7)), ("bucket", Value::Int(0))]));
    assert_eq!(engine.query("digestToday", Context::new(alice, args(&[])).at(3_300)).unwrap().data, Value::Int(2));
    // A value index grants no read authority over a private vote aggregate.
    assert!(engine.query("mostLiked", Context::new(bob, args(&[])).at(3_300)).unwrap().data.as_array().unwrap().is_empty());
    let following = engine.query("following", Context::new(bob, args(&[])).at(3_400)).unwrap();
    assert!(following.data.as_array().unwrap().iter().any(|p| p.field("mine").unwrap() != &Value::Null));
    // edit: the presence assertion, a conditional update refused with the current row, then accepted.
    assert_eq!(failed(&engine.mutate("edit", Some("e1"), Context::new(bob, args(&[("messageId", id("msg2")), ("body", text("kept")), ("expected", text("nope"))])).at(3_500)).unwrap()), "E_CONFLICT");
    assert_eq!(failed(&engine.mutate("edit", Some("e2"), Context::new(alice, args(&[("messageId", id("msg2")), ("body", text("kept")), ("expected", text("keep"))])).at(3_500)).unwrap()), "NOT_AUTHOR");
    assert_eq!(failed(&engine.mutate("edit", Some("e3"), Context::new(bob, args(&[("messageId", id("nope")), ("body", text("kept"))])).at(3_500)).unwrap()), "NOT_FOUND");
    assert_eq!(sent(&engine.mutate("edit", Some("e4"), Context::new(bob, args(&[("messageId", id("msg2")), ("body", text("kept")), ("expected", text("keep"))])).at(3_600)).unwrap()), &Value::Null);
    // split: share.
    let split = engine.mutate("split", Some("l1"), Context::new(alice, args(&[("total", Value::Int(10)), ("people", Value::Array(vec![id(alice), id(bob)]))])).at(3_700).with_ids(["ledger1".to_owned()])).unwrap();
    assert_eq!(sent(&split).field("amount").unwrap().as_int().unwrap(), 5);
    // ancestors: walk.
    let chain = engine.query("ancestors", Context::new(alice, args(&[("roomId", id("r1"))])).at(3_800)).unwrap().data;
    assert_eq!(chain.as_array().unwrap().len(), 1);
    assert_eq!(chain.as_array().unwrap()[0].field("name").unwrap(), &text("General"));
    // leave: a named full unique key; NOT_FOUND the second time.
    assert_eq!(sent(&engine.mutate("leave", Some("v1"), Context::new(bob, args(&[("roomId", id("r1"))])).at(3_900)).unwrap()), &Value::Null);
    assert_eq!(failed(&engine.mutate("leave", Some("v2"), Context::new(bob, args(&[("roomId", id("r1"))])).at(3_950)).unwrap()), "NOT_FOUND");
    // nightly: chunks, `break` on the first room past the period, a helper call, `range`.
    let later = engine.mutate("createRoom", Some("c2"), Context::new(alice, args(&[("name", text("Later")), ("kind", text("closed")), ("tags", Value::Array(vec![]))])).at(6_000).with_ids(["r2".to_owned(), "m4".to_owned()])).unwrap();
    assert_eq!(sent(&later).field("id").unwrap(), &id("r2"));
    let run = engine.run_job("nightly", args(&[("periodStart", Value::Int(0)), ("periodEnd", Value::Int(5_000))]), 7_000).unwrap();
    assert_eq!(run.state, JobState::Done, "{run:?}");
    let rooms = engine.store().rows("rooms").unwrap();
    let created_at = |name: &str| rooms.iter().find(|r| r.field("name").unwrap() == &text(name)).unwrap().field("createdAt").unwrap().as_int().unwrap();
    assert_eq!(created_at("General"), 7_000, "stamped by the helper");
    assert_eq!(created_at("Later"), 6_000, "`break` ended the sweep before it");
    assert!(engine.store().rows("posts").unwrap().iter().all(|p| p.field("score").unwrap() == &Value::Int(1)), "range(0, 2) added 0 then 1 to a score read once");
    // everyNight: the schedule fires from its next boundary, once.
    let (day, three) = (86_400_000, 10_800_000);
    assert_eq!(engine.fire_schedules(day + three + 1_000).unwrap(), Vec::<String>::new());
    assert_eq!(engine.fire_schedules(2 * day + three + 1_000).unwrap(), vec!["everyNight".to_owned(), "summariesEveryDay".to_owned()]);
    assert_eq!(engine.action_counts().unwrap().get("queued"), Some(&1));
    assert!(engine.fire_schedules(2 * day + three + 1_000).unwrap().is_empty());
}

/// Every keyword card's blocks bind clean, alone or beside the language card.
#[test]
fn every_card_compiles_clean() {
    for keyword in KEYWORDS {
        let text = card(keyword).unwrap_or_else(|| panic!("no card for {keyword}"));
        let blocks = quarry(text);
        for (n, block) in blocks.iter().enumerate() {
            if *keyword == "search" && n == 1 {
                // The lane brief explicitly permits notes documented by this section.
                // Keep the exception on this block and this exact site; every
                // other card and every server operation must still compile silently.
                let bound = compile(block);
                assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
                assert_eq!(bound.notes.iter().map(|note| (note.code.as_str(), note.site.line, note.guide.as_str())).collect::<Vec<_>>(),
                    [("N_NO_HORIZON", 10, "sync")]);
                assert!(bound.notes[0].message.starts_with("table messages:"));
                assert!(text.contains("This block intentionally emits N_NO_HORIZON"));
                continue;
            }
            clean(&format!("card {keyword}, block {}", n + 1), &in_context(block));
        }
    }
    assert_eq!(card("grammar"), Some(LANGUAGE));
    assert_eq!(card("quarry"), Some(LANGUAGE));
    assert_eq!(card("nonsense"), None);
    assert_eq!(quarry(LANGUAGE).len(), 1, "the language card is one program");
}

#[test]
fn w7d_every_chat_search_is_on_the_card() {
    let text = card("search").unwrap();
    let section = text.split_once("## Search every chat I'm in").expect("the 100–1,000 membership recipe").1;
    assert!(!quarry(section).is_empty(), "the recommendation includes compiled Quarry");
    for form in ["searchHeld", "searchChats", "searchChatBatch"] { assert!(section.contains(form), "missing {form}"); }
}

/// The package README's Quarry binds clean, and no Quarry hides in an
/// unlabelled fence.
#[test]
fn the_readme_quarry_compiles_clean() {
    let blocks = quarry(README);
    assert!(blocks.len() >= 3, "the README carries the app schema, the feed and the sync forms");
    for (n, block) in blocks.iter().enumerate() {
        clean(&format!("README block {} starting `{}`", n + 1, block.lines().next().unwrap_or_default()), &in_context(block));
    }
    let mut fence: Option<(String, usize)> = None;
    for (index, line) in README.lines().enumerate() {
        match &fence {
            Some((tag, opened)) if line.trim_end() == "```" => {
                let _ = (tag, opened);
                fence = None;
            }
            Some((tag, opened)) if *opened == index - 1 && tag != "quarry" => {
                let first = line.trim_start();
                assert!(!["table ", "query ", "mutation ", "job ", "maintain ", "use ", "schedule "].iter().any(|word| first.starts_with(word)), "README line {}: Quarry in a ```{tag} fence; fence it as ```quarry so the suite compiles it", index + 1);
            }
            Some(_) => {}
            None if line.starts_with("```") => fence = Some((line[3..].trim().to_owned(), index)),
            None => {}
        }
    }
}

/// One list of keywords: every card is listed on the language card and in
/// the README, and every listed keyword is a card.
#[test]
fn the_keywords_are_one_list() {
    let listed = |text: &str, after: &str| -> String {
        let start = text.find(after).unwrap_or_else(|| panic!("no `{after}` in the text"));
        text[start..].chars().take(400).collect()
    };
    let on_card = listed(LANGUAGE, "Cards: `snapback4 guide <keyword>`");
    let in_readme = listed(README, "**`guide [keyword]`**");
    for keyword in KEYWORDS {
        assert!(card(keyword).is_some(), "{keyword} has no card");
        if *keyword != "language" {
            assert!(on_card.contains(keyword), "the language card does not list {keyword}");
        }
        assert!(in_readme.contains(keyword), "the README's guide line does not list {keyword}");
    }
}

/// The sources a scan of literals covers: the Rust crates and the client.
fn sources() -> Vec<PathBuf> {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let mut files = Vec::new();
    fn walk(dir: &Path, files: &mut Vec<PathBuf>) {
        for entry in std::fs::read_dir(dir).unwrap_or_else(|e| panic!("{}: {e}", dir.display())) {
            let path = entry.unwrap().path();
            if path.is_dir() {
                if path.file_name().is_some_and(|n| n == "node_modules" || n == "target" || n == "dist" || n == "tests" || n == "test") {
                    continue;
                }
                walk(&path, files);
            } else if path.file_name().is_some_and(|n| n.to_string_lossy().ends_with("_tests.rs") || n.to_string_lossy().ends_with(".test.mjs")) {
                // A test module inside `src/` invents refusal codes for fixtures;
                // this check is about the codes the product itself emits.
                continue;
            } else if path.extension().is_some_and(|e| e == "rs" || e == "ts" || e == "tsx") {
                files.push(path);
            }
        }
    }
    for dir in ["crates", "packages/snapback4/src", "packages/snapback4-expo/src"] {
        walk(&root.join(dir), &mut files);
    }
    assert!(files.len() > 40, "{} source files", files.len());
    files
}

/// The words matching `E_UPPER` or `N_UPPER` in a text, at identifier boundaries.
fn code_words(text: &str) -> Vec<String> {
    let bytes = text.as_bytes();
    let ident = |b: u8| b.is_ascii_alphanumeric() || b == b'_';
    let mut out = Vec::new();
    let mut i = 0;
    while i + 2 < bytes.len() {
        if (bytes[i] == b'E' || bytes[i] == b'N') && bytes[i + 1] == b'_' && bytes[i + 2].is_ascii_uppercase() && (i == 0 || !ident(bytes[i - 1])) {
            let start = i;
            let mut end = i + 2;
            while end < bytes.len() && (bytes[end].is_ascii_uppercase() || bytes[end] == b'_' || bytes[end].is_ascii_digit()) {
                end += 1;
            }
            if end >= bytes.len() || !ident(bytes[end]) {
                out.push(text[start..end].trim_end_matches('_').to_owned());
            }
            i = end;
        } else {
            i += 1;
        }
    }
    out
}

/// Every refusal code the engine, the compiler and the client emit is one
/// `snapback4 why` explains — README §1's promise, tested.
#[test]
fn every_emitted_code_is_explained() {
    let known = codes();
    // The placeholder in `why`'s usage line.
    let not_codes = ["E_CODE"];
    let mut unexplained = BTreeMap::<String, Vec<String>>::new();
    for file in sources() {
        let text = std::fs::read_to_string(&file).unwrap();
        for word in code_words(&text) {
            if !known.contains(&word.as_str()) && !not_codes.contains(&word.as_str()) {
                unexplained.entry(word).or_default().push(file.strip_prefix(Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")).unwrap().display().to_string());
            }
        }
    }
    for (code, files) in &mut unexplained {
        files.sort();
        files.dedup();
        let _ = code;
    }
    assert!(unexplained.is_empty(), "codes `why` cannot explain (add them to guide::CODES):\n{}", unexplained.iter().map(|(code, files)| format!("  {code}: {}", files.join(", "))).collect::<Vec<_>>().join("\n"));
    for code in &known {
        assert!(explain_code(code).is_some_and(|text| text.starts_with(&format!("{code}: "))), "{code}");
    }
    assert!(explain_code("E_NOPE").is_none());
}

#[test]
fn w9b_every_code_has_bounded_card_context_and_a_full_card_command() {
    let mut largest = (0, "");
    for code in codes() {
        let text = explain_code(code).unwrap();
        let keyword = snapback4_lang::diag::guide_for(code);
        assert!(text.ends_with(&format!("Full card: snapback4 guide {keyword}")), "{code}");
        assert!(text.len() + 1 <= guide::WHY_MAX_BYTES, "{code}: {} bytes", text.len() + 1);
        assert!(text.lines().any(|line| line.starts_with('#') && card(keyword).unwrap().lines().any(|heading| heading == line)), "{text}");
        assert!(!text.contains("```"), "{code}: a prose excerpt must not cut a Quarry example");
        largest = largest.max((text.len() + 1, code));
    }
    println!("why: {} codes, maximum {} bytes ({}) / {}", codes().len(), largest.0, largest.1, guide::WHY_MAX_BYTES);
}

#[test]
fn w9r1b_diagnostic_card_overrides_the_code_default() {
    let note = snapback4_lang::diag::Diagnostic::new(&Default::default(), "N_WIDE_MERGE", "wide merge", "bound the lanes");
    for (keyword, expected) in [("feeds", "feeds"), ("search", "search"), ("", "search")] {
        let text = note.clone().guide(keyword).explanation().unwrap();
        assert!(text.ends_with(&format!("Full card: snapback4 guide {expected}")));
        assert!(text.len() + 1 <= guide::WHY_MAX_BYTES);
        assert!(!text.contains("```"));
    }
}

/// Every guide keyword a diagnostic or a refusal carries names a card.
#[test]
fn every_guide_keyword_a_diagnostic_names_is_a_card() {
    let aliases = ["grammar", "quarry"];
    for code in codes() {
        let keyword = snapback4_lang::diag::guide_for(code);
        assert!(card(keyword).is_some(), "{code} points at `{keyword}`, which is not a card");
        if code.starts_with(concat!("E_", "EFFECT_")) { assert_eq!(keyword, "effects", "{code}"); }
    }
    let mut named = Vec::new();
    for file in sources() {
        let text = std::fs::read_to_string(&file).unwrap();
        for marker in ["guide(\"", "guide = Some(\"", "guide: \""] {
            for (at, _) in text.match_indices(marker) {
                let rest = &text[at + marker.len()..];
                let keyword: String = rest.chars().take_while(|c| c.is_ascii_lowercase()).collect();
                if !keyword.is_empty() && rest[keyword.len()..].starts_with('"') {
                    named.push((keyword, file.display().to_string()));
                }
            }
        }
    }
    assert!(named.len() > 10, "{} guide keywords found in the sources", named.len());
    for (keyword, file) in named {
        assert!(card(&keyword).is_some() || aliases.contains(&keyword.as_str()), "{file} points at guide `{keyword}`, which is not a card");
    }
}

/// The bounds card states the engine's ceilings, and the refusals card the
/// engine's families.
#[test]
fn the_cards_state_the_engines_numbers_and_families() {
    fn commas(n: u64) -> String {
        let digits = n.to_string();
        let mut out = String::new();
        for (i, c) in digits.chars().enumerate() {
            if i > 0 && (digits.len() - i) % 3 == 0 {
                out.push(',');
            }
            out.push(c);
        }
        out
    }
    // Prose wraps; match on one line.
    let bounds = card("bounds").unwrap().split_whitespace().collect::<Vec<_>>().join(" ");
    let ceilings = Ceilings::default();
    for (number, unit) in [(ceilings.examined, "rows examined"), (ceilings.index_entries, "index entries"), (ceilings.rule_probes, "rule probes"), (ceilings.steps, "steps"), (ceilings.rows_written, "rows written")] {
        assert!(bounds.contains(&format!("{} {unit}", commas(number))), "the bounds card does not state {} {unit}", commas(number));
    }
    assert!(bounds.contains(&format!("{} MiB heap", ceilings.heap_bytes >> 20)));
    assert!(bounds.contains(&format!("{} MiB output", ceilings.output_bytes >> 20)));
    let job = Ceilings::job();
    assert!(bounds.contains(&format!("examine {} rows and write {}", commas(job.examined), commas(job.rows_written))));
    let refusals = card("refusals").unwrap();
    for family in RuntimeError::FAMILIES {
        assert!(refusals.contains(family), "the refusals card does not name the {family} family");
    }
    let sync = card("sync").unwrap().split_whitespace().collect::<Vec<_>>().join(" ");
    assert!(sync.contains("4,000 events") && sync.contains("2,000 by default") && sync.contains("10,000 at"), "the sync card states the snapshot page sizes");
    let _ = guide::TEMPLATE;
}

/// `snapback4 init`'s template is a card too.
#[test]
fn the_template_compiles_clean() {
    clean("the init template", guide::TEMPLATE);
    clean("the online init template", guide::TEMPLATE_ONLINE);
}

#[test]
fn the_language_card_also_compiles_as_a_module_with_qualified_schedules() {
    let source = language().replace(": nightly ", ": timeline.nightly ").replace(": scheduledSummary\n", ": timeline.scheduledSummary\n");
    let bound = snapback4_lang::compile(&[("timeline.q".into(), source)]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    assert!(bound.notes.is_empty(), "{:?}", bound.notes);
    assert_eq!(bound.schema.schedules[0].target, "timeline.nightly");
    assert_eq!(bound.schema.schedules[1].target, "timeline.scheduledSummary");
}

#[test]
fn natural_words_find_their_cards() {
    for (word, target) in [("predict", "prediction"), ("offline", "prediction"), ("pagination", "reads"), ("migration", "evolution"), ("sql", "personas"), ("push", "effects"), ("auth", "personas"), ("upload", "assets"), ("live", "reads"), ("ordinal", "writes")] {
        assert!(card(word).is_some(), "{word} must find {target}");
        assert_eq!(card(word), card(target), "{word}");
    }
}

#[test]
fn prediction_card_compiles_clean() {
    let text = card("prediction").expect("prediction has a card");
    let blocks = quarry(text);
    assert!(!blocks.is_empty());
    for (i, block) in blocks.iter().enumerate() { clean(&format!("prediction block {i}"), &in_context(block)); }
    let bound = clean("prediction sites", &blocks[0]);
    for name in ["saveDraft", "post", "guardedPost", "notifyPost"] {
        assert_eq!(bound.schema.operations[name].predicts.as_deref(), Some("eligible"), "{name}");
    }
    for name in ["countedPost", "falliblePost"] {
        assert_eq!(bound.schema.operations[name].predicts.as_deref(), Some("never"), "{name}");
    }
    for (name, class) in [("saveDraft", snapback4_core::schema::SiteClass::Held), ("guardedPost", snapback4_core::schema::SiteClass::Horizon), ("countedPost", snapback4_core::schema::SiteClass::Server)] {
        assert!(bound.schema.operations[name].sites.iter().any(|site| site.class == class), "{name}");
    }
}

#[test]
fn every_alias_targets_a_keyword_and_nearest_uses_aliases() {
    let mut seen = std::collections::BTreeSet::new();
    for &(word, target) in guide::ALIASES {
        assert!(seen.insert(word), "duplicate alias {word}");
        assert!(!KEYWORDS.contains(&word), "alias shadows keyword {word}");
        assert!(KEYWORDS.contains(&target), "{word} targets unknown card {target}");
        assert_eq!(card(word), card(target));
    }
    assert_eq!(guide::nearest("pagintion")[0], "reads");
    assert_eq!(guide::nearest("redict")[0], "prediction");
    assert_eq!(guide::nearest("migratio")[0], "evolution");
    assert_eq!(guide::nearest("σ").len(), 3);
    assert_eq!(guide::nearest("banana").iter().collect::<std::collections::BTreeSet<_>>().len(), 3);
}

#[test]
fn arrival_recipe_orders_ties_and_retries_then_pages() {
    let source = quarry(card("writes").unwrap()).into_iter().find(|block| block.contains("table conversations:")).unwrap();
    let bound = clean("arrival recipe", &source);
    let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    sent(&engine.mutate("createConversation", Some("create"), Context::new("dev:alice", args(&[])).with_ids(["room".into()])).unwrap());
    for i in 1..=51 {
        let context = || Context::new("dev:alice", args(&[("conversationId", id("room")), ("body", text("hello"))])).at(1000).with_ids([format!("message-{:03}", 52 - i)]);
        let write = format!("write-{i}");
        let first = engine.mutate("send", Some(&write), context()).unwrap();
        assert_eq!(sent(&first).field("ordinal").unwrap(), &Value::Int(i));
        let retry = engine.mutate("send", Some(&write), context()).unwrap();
        assert!(matches!(retry.state, WriteState::Sent { .. }));
    }
    let first = engine.query("history", Context::new("dev:alice", args(&[("conversationId", id("room"))]))).unwrap();
    let Value::Array(rows) = first.data else { panic!("history is a page") };
    assert_eq!(rows.len(), 50);
    for (i, row) in rows.iter().enumerate() { assert_eq!(row.field("ordinal").unwrap(), &Value::Int(51 - i as i64)); }
    let next = first.next.expect("51 rows have a second page");
    let second = engine.query("history", Context::new("dev:alice", args(&[("conversationId", id("room")), ("c", text(&next))]))).unwrap();
    let Value::Array(rows) = second.data else { panic!("history is a page") };
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].field("ordinal").unwrap(), &Value::Int(1));
}

#[test]
fn onboarding_recipe_recovers_a_taken_handle_for_the_same_principal() {
    let source = quarry(README).into_iter().find(|block| block.contains("query handleAvailable(")).unwrap();
    let bound = clean("onboarding recipe", &source);
    let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    assert_eq!(engine.query("handleAvailable", Context::new("guest:visitor", args(&[("handle", text("alice"))]))).unwrap().data, Value::Bool(true));
    sent(&engine.mutate("createProfile", Some("alice-profile"), Context::new("user:alice", args(&[("handle", text("alice"))])).with_ids(["a".into()])).unwrap());
    assert_eq!(engine.query("handleAvailable", Context::new("guest:visitor", args(&[("handle", text("alice"))]))).unwrap().data, Value::Bool(false));
    let raced = engine.mutate("createProfile", Some("bob-taken"), Context::new("user:bob", args(&[("handle", text("alice"))])).with_ids(["b".into()])).unwrap();
    assert_eq!(failed(&raced), "E_CONSTRAINT");
    assert_eq!(engine.query("myProfile", Context::new("user:bob", args(&[]))).unwrap().data, Value::Null);
    sent(&engine.mutate("createProfile", Some("bob-profile"), Context::new("user:bob", args(&[("handle", text("bobby"))])).with_ids(["b2".into()])).unwrap());
    assert_eq!(engine.query("myProfile", Context::new("user:bob", args(&[]))).unwrap().data.field("handle").unwrap(), &text("bobby"));
}

#[test]
fn set_state_recipe_predicts_first_like_and_repeated_set_and_clear() {
    let source = quarry(card("prediction").unwrap()).into_iter().find(|block| block.contains("table likes:")).unwrap();
    let bound = clean("set-state recipe", &source);
    let program = &bound.programs.iter().find(|p| p.program.name == "setLike").unwrap().program;
    let rows = snapback4_core::rows::MemoryRows::new();
    let mut engine = Engine::memory(bound.schema.clone(), bound.programs.iter().map(|p| p.program.clone())).unwrap();
    for (i, liked) in [false, true, true, false, false, true].into_iter().enumerate() {
        let context = || Context::new("dev:alice", args(&[("postId", id("post")), ("liked", Value::Bool(liked))])).with_ids([format!("like-{i}")]);
        snapback4_core::engine::local::predict(&rows, &bound.schema, program, context(), Ceilings::default()).unwrap();
        assert_eq!(rows.rows("likes").len(), usize::from(liked));
        sent(&engine.mutate("setLike", Some(&format!("set-{i}")), context()).unwrap());
        assert_eq!(engine.store().rows("likes").unwrap().len(), usize::from(liked));
    }
}

#[test]
fn expire_card_explains_maintained_value_order_refusal_and_rewrites() {
    let expire = card("expire").unwrap();
    for phrase in ["Value-order indexes over expiring sources", "E_QUARRY_MAINTAIN_EXPIRE", "live bounded query", "scheduled ranked-table recipe"] {
        assert!(expire.contains(phrase), "expiry diagnostic's destination omits {phrase}");
    }
}

#[test]
fn writes_card_explains_the_whole_upsert_insert_proof() {
    let writes = card("writes").unwrap().split_whitespace().collect::<Vec<_>>().join(" ");
    assert!(!writes.contains("predict only updates of rows the device holds"));
    for text in ["held", "no horizon", "insert image", "unique", "cap", "guide prediction"] {
        assert!(writes.contains(text), "writes card omits {text}");
    }
}

#[test]
fn direct_and_merged_cursor_generation_contracts_are_distinct() {
    let source = "table events:\n  owner: principal\n  at: time\n  selected: bool\n  by byOwnerAt: owner, at, id\n  cap 10\n  public 'events'\n  sync\nmaintain daily: count events where .selected by owner, day(.at)\n  read <- allow\n  online only\nquery direct(c: cursor ?):\n  return events[viewer] after c first 1 by byOwnerAt\nquery grouped(c: cursor ?):\n  return daily[viewer] after c first 1 by byGroup\nquery merged(c: cursor ?):\n  return merge events after c first 1 by byOwnerAt:\n    [viewer]\n";
    let bound = clean("cursor contracts", source);
    let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    engine.seed([1, 2].map(|day| ("events".into(), snapback4_core::value::object([
        ("id", id(&format!("e{day}"))), ("owner", id("alice")), ("at", Value::Int(day * 86_400_000)), ("selected", Value::Bool(true)),
    ])))).unwrap();
    let cursors: Vec<_> = ["direct", "grouped", "merged"].into_iter().map(|name| {
        let read = engine.query(name, Context::new("alice", BTreeMap::new())).unwrap();
        assert!(read.complete);
        (name, read.next.unwrap())
    }).collect();
    let successor = clean("cursor successor", &source.replace("  selected: bool", "  selected: bool\n  label: text <=10 default 'new'"));
    engine.adopt(successor.schema, successor.programs.into_iter().map(|p| p.program)).unwrap();
    for (name, cursor) in cursors {
        let read = engine.query(name, Context::new("alice", args(&[("c", text(&cursor))])));
        if name == "merged" {
            let read = read.unwrap();
            assert!(read.complete);
            assert_eq!(read.data.as_array().unwrap()[0].field("id").unwrap(), &id("e2"));
            assert!(read.next.is_none());
        } else {
            let refusal = read.unwrap_err();
            assert_eq!(refusal.code, "E_INPUT");
            assert_eq!(refusal.message, "E_INPUT: cursor: cursor token describes a different prefix or generation");
        }
    }
    for (name, doc) in [("feeds", card("feeds").unwrap()), ("README", README)] {
        assert!(doc.contains("A merge cursor from generation N"), "{name} must scope cross-generation continuation to merge cursors");
        assert!(!doc.contains("A cursor from generation N"), "{name} must not promise it for direct pages");
    }
    assert!(README.contains("A direct page cursor binds the\nevaluated prefix and active generation"));
}

#[test]
fn language_following_uses_private_inbox_and_capped_pulls() {
    let source = language();
    let bound = clean("language", &source);
    let fact = &bound.schema.operations["following"];
    assert!(fact.sites.iter().any(|s| s.table == "feed"), "{:?}", fact.sites);
    assert!(!fact.sites.iter().any(|s| s.table == "follows"));
    assert_eq!(fact.runs.as_deref(), Some("device"));
    assert!(source.contains("broadcast[p.authorId] for p in pulls[viewer] first 32 by byReaderAuthor"));
    assert!(LANGUAGE.contains("guide feeds"));
    assert!(source.lines().any(|line| line.trim_start().starts_with("online only") && line.contains("mutations reading this maintain never predict")));
}

#[test]
fn calibration_guide_words_and_replay_holds_are_discoverable() {
    for (word, target) in [("maintain", "maintains"), ("maintains", "maintains"), ("time", "language"), ("clock", "jobs"), ("replay", "personas"), ("seed", "personas")] {
        assert_eq!(card(word), card(target), "{word}");
    }
    for word in ["divmod", "immutable", "return", "arithmetic", "a"] {
        assert!(guide::nearest(word).contains(&"language"), "{word}: {:?}", guide::nearest(word));
    }
}

#[test]
fn calibration_effects_jobs_and_seed_cards_explain_replay_flags() {
    for word in ["effects", "jobs", "personas", "replay", "README"] {
        let text = if word == "README" { README } else { card(word).unwrap() };
        assert!(text.contains("--hold-effects") && text.contains("--hold-schedules"), "{word}");
        assert!(text.contains("snapback4 dev --replay") && text.contains("never delivered"), "{word}");
        assert!(text.contains("claimable after restarting without"), "{word}");
        assert!(!text.contains("without an app replay flag"), "{word}");
        assert!(!text.contains("Ordinary and ordered batch"), "{word}");
    }
}

#[test]
fn following_cards_pin_examinations() {
    for (name, doc) in [("feeds", card("feeds").unwrap()), ("README", README)] {
        assert!(doc.contains("82 examinations"), "{name} must count examinations, including lookups");
        assert!(doc.contains("41 tombstone probes"), "{name} must pin the tombstone work");
    }
}

#[test]
fn following_language_card_labels_the_syntax_example() {
    assert!(LANGUAGE.contains("syntax example"), "Following's body predicate is syntax, not removal");
    assert!(LANGUAGE.contains("removal recipe"));
}

#[test]
fn password_policy_and_guest_choice_are_on_the_card() {
    for (name, doc) in [("personas", card("personas").unwrap()), ("README", README)] {
        let prose = doc.split_whitespace().collect::<Vec<_>>().join(" ");
        assert!(prose.contains("at least 8 characters (Unicode scalar values)"), "{name}");
        assert!(prose.contains("at most 1,024 UTF-8 bytes"), "{name}");
        assert!(prose.contains("An email-and-password product declares `use identity password`; plain `use identity` also mints guest sessions."), "{name}");
    }
    let starter = include_str!("../../../apps/chat/snapback/schema.q");
    assert!(starter.lines().any(|line| line.starts_with("use identity --") && line.contains("use identity password") && line.contains("guest")));
    let bound = snapback4_lang::compile(&[("schema.q".into(), starter.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    assert!(bound.schema.auth.guests && bound.schema.auth.password, "the Expo opener still needs guests");
    for template in [guide::TEMPLATE, guide::TEMPLATE_ONLINE] {
        let bound = snapback4_lang::compile(&[("schema.q".into(), template.into())]);
        assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
        assert!(!bound.schema.auth.guests && !bound.schema.auth.password, "persona-only starters do not opt into identity");
    }
}

#[test]
fn w7c_meter_store_readiness_and_aggregate_discovery_are_on_the_cards() {
    assert_eq!(card("aggregates"), card("maintains"));
    for doc in [card("reads").unwrap(), README] {
        for text in ["meter: true", "x-snapback-meter: 1", "heapBytes", "probes", "principal id", "ignores"] { assert!(doc.contains(text), "missing {text}"); }
    }
    for doc in [card("services").unwrap(), README] {
        for text in [".snapback4/store.sqlite", "--release", "store.sqlite", "each isolated", "first stdout line"] { assert!(doc.contains(text), "missing {text}"); }
    }
}

#[test]
fn w9a_expiry_cards_explain_and_select_the_readers_deadline() {
    for name in ["expire", "reads"] {
        let text = card(name).unwrap();
        let prose = text.split_whitespace().collect::<Vec<_>>().join(" ");
        for sentence in [
            "A row already returned stays in that answer until the next answer; a live reader that must hide it at its deadline drops it locally by `expiresAt`.",
            "The server will not return the row again after expiry, but does not push a removal at the instant of expiry.",
            "The local client reschedules its watch at `Read.nextExpiry`; keep the render filter so the row hides at its deadline rather than at the refetch.",
        ] { assert!(prose.contains(sentence), "{name}: missing {sentence}"); }
        assert!(text.contains("const paint = () => render(rows.filter(row => row.expiresAt === null || row.expiresAt > Date.now()));\npaint(); const timers = rows.flatMap(row => row.expiresAt === null ? [] : [setTimeout(paint, Math.max(0, row.expiresAt - Date.now()))]);"), "{name}: missing two-line client form");
        let block = quarry(text).into_iter().find(|block| block.contains("query expiring")).expect("compiled expiry query");
        let bound = clean(name, &in_context(&block));
        let query = bound.programs.iter().find(|p| p.program.name.starts_with("expiring")).unwrap();
        assert!(snapback4_lang::emit::typescript(&bound).contains("expiresAt: number | null"));
        assert!(block.contains("{ id, body, expiresAt }"), "{} selects its deadline", query.program.name);
    }
}

#[test]
fn w9a_reads_and_refusals_explain_hidden_pages_and_readable_membership() {
    for name in ["reads", "refusals"] {
        let text = card(name).unwrap().split_whitespace().collect::<Vec<_>>().join(" ");
        assert!(text.contains("A read denied by a table's rule answers as an empty page, not a refusal, and a client cannot tell it apart from an empty readable page — by design, so that a hidden row cannot be probed."), "{name}");
        assert!(text.contains("For access UI, use a membership query the viewer may read, such as a conversation lookup readable by its members: a member gets the conversation even when its message page is empty."), "{name}");
        assert!(text.contains("An explicit `require … else CODE` still refuses with the program's code."), "{name}");
    }
}

#[test]
fn w9a_held_search_leads_with_coverage_then_cost_then_refusal() {
    let text = card("search").unwrap().split_once("## Search every chat I'm in").unwrap().1;
    let prose = text.split_whitespace().collect::<Vec<_>>().join(" ");
    let coverage = prose.find("With horizon-free sources, `check` reports horizon-free source coverage for `searchHeld`: it reads one unscoped words index over the messages this device holds, with no membership merge or per-reader copy.").expect("positive source coverage");
    let cost = prose.find("Cold acquisition costs every live message in every held chat").unwrap();
    let refusal = prose.find("refuses E_QUERY_HELD").unwrap();
    assert!(coverage < cost && cost < refusal);
    assert!(prose.contains("Expiring memberships require runtime audience checks; an unscoped matching read can remain non-uniform and `complete: false` below every meter and word limit."));
    assert!(prose.contains("Runtime meter cuts, the 32-word limit and page continuation still apply; `complete` describes each returned page, and `fresh` separately describes sync freshness."));
    assert!(prose.contains("The local clients never fall back to the server for a held query, even at a horizon, meter cut or word cut."));
    let wide = explain_code("N_WIDE_MERGE").unwrap();
    assert!(wide.contains("Inspect structural costs with `snapback4 check --cost`; if a held query answers this read, delete the merge."));
}
