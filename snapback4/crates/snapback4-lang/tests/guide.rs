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

// A relocated assertion checks the actual orientation door as well as its destination.
fn readme_reference(name: &str) -> &'static str {
    let map = include_str!("../../../packages/snapback4/README.md").split_once("## Reference map").unwrap().1;
    assert!(map.contains(&format!("`guide {name}`")), "orientation omits guide {name}");
    card(name).unwrap()
}

#[test]
fn feeds_card_preserves_promotion_refusals_and_orientation() {
    let feeds = card("feeds").unwrap();
    assert_eq!(feeds, readme_reference("feeds"));
    for fact in ["51st follower permanently promotes", "FEED_PULL_CAP", "FEED_PROMOTION_PULL_CAP",
        "no follower is silently skipped", "50 followers indefinitely", "51 reads",
        "1,023 total writes including the app edge", "865-event window", "1,001 private copies",
        "tables empty and at most the declared number of existing profiles", "size authors 1008, edges 5921",
        "follow and promotion roll back, including the app edge", "Every saturated follower must free a slot",
        "retry the refused follow with a new write ID", "server-run query", "public `follows` and `feedPullCounts`", "`used = 32`"] {
        assert!(feeds.contains(fact), "missing {fact}");
    }
    for bad in ["skips a follower", "skip saturated readers", "A skipped follower", "not skipped\nauthors"] {
        assert!(!feeds.contains(bad), "{bad}");
    }
    for code in ["FEED_PULL_CAP", "FEED_PROMOTION_PULL_CAP", "E_RECIPE_RETIRED"] {
        assert_eq!(snapback4_lang::diag::guide_for(code), "feeds");
        assert!(explain_code(code).unwrap().contains("snapback4 guide feeds"));
        assert!(codes().contains(&code));
    }
    for (code, facts) in [
        ("E_RECIPE_RETIRED", vec!["maintain feed: timeline", "size authors 1008, edges 5921"]),
        ("FEED_PULL_CAP", vec!["32 shared authors", "rolled back", "new write ID"]),
        ("FEED_PROMOTION_PULL_CAP", vec!["32 shared-author slots", "rolled back", "public", "pullCounts", "server-run query", "used = 32"]),
    ] {
        let explanation = explain_code(code).unwrap();
        for fact in facts { assert!(explanation.contains(fact), "{code}: missing {fact}"); }
    }
    for retired in ["E_RECIPE_BRIDGE", "E_RECIPE_CAPS"] { assert!(!codes().contains(&retired)); }
}

#[test]
fn w11r1c_residency_fact_cards_require_verbose() {
    for name in ["residency", "sync", "services"] {
        let text = card(name).unwrap();
        assert!(text.contains("check --residency --verbose"), "{name}");
        if name == "sync" { assert!(text.contains("`check --residency` names the proven")); }
        else { assert!(!text.contains("`check --residency`"), "{name}: bare command promises facts"); }
    }
}

#[test]
fn w11r1c_first_screen_generates_types_and_starts_the_backend() {
    let path = README.split_once("### 1. Create and run the backend").unwrap().1.split_once("### 2.").unwrap().0;
    for text in ["npx snapback4 check", "npx snapback4 dev", "npm install"] {
        assert!(path.contains(text), "step 1 omits {text}");
    }
}

// Inspect authored `else CODE` tokens, independently of the reserved-prefix census.
fn recipe_refusals(source: &str) -> Vec<String> {
    let (tokens, diagnostics) = snapback4_lang::lexer::lex("recipe.q", source);
    assert!(diagnostics.is_empty(), "{diagnostics:?}");
    tokens.windows(2).filter(|pair| pair[0].value == "else" && pair[1].kind == snapback4_lang::lexer::Kind::Word)
        .map(|pair| pair[1].value.clone()).collect()
}

#[test]
fn w11r2_recipe_refusals_have_reserved_names_and_dedicated_sections() {
    let unknown = "UNREGISTERED_RECIPE_REFUSAL";
    let source = format!("mutation probe():\n  require false else {unknown}\n");
    assert!(compile(&source).diagnostics.is_empty());
    assert_eq!(recipe_refusals(&source), [unknown]);
    assert!(explain_code(unknown).is_none(), "the census detects an unprefixed new refusal too");
    let source = snapback4_lang::recipe::following("feed", "social").unwrap();
    let mut refusals = recipe_refusals(&source);
    refusals.sort(); refusals.dedup();
    assert_eq!(refusals.len(), 9);
    for code in &refusals {
        assert!(explain_code(code).is_some(), "unregistered recipe code: {code}");
        assert_eq!(snapback4_lang::diag::guide_for(code), "feeds");
        assert!(snapback4_lang::Diagnostic::new(&Default::default(), code, "", "").explanation_section().is_some(), "no dedicated section: {code}");
        assert!(code.starts_with("FEED_"), "recipe claims a generic name: {code}");
    }
}

#[test]
fn w11r2_native_boundary_sentence_matches_both_published_copies() {
    fn sentence(text: &str) -> String {
        let normalized = text.split_whitespace().collect::<Vec<_>>().join(" ");
        normalized.split_once("Quarry still declares ").unwrap().1.split_once(". Anything").unwrap().0.to_owned()
    }
    let expected = "the table, its rules and its `sync`; a mutation cannot be native, because a device predicts Quarry and the server replays it";
    assert_eq!(sentence(card("native").unwrap()), expected);
    assert_eq!(sentence(readme_reference("native")), expected);
}

#[test]
fn w14b_first_account_screen_is_self_contained() {
    let readme = include_str!("../../../packages/snapback4/README.md");
    let path = readme.split_once("## Reference map").expect("one optional reference map").0;
    for text in [
        "npx snapback4 init --expo", "npm install", "npx snapback4 check", "npx snapback4 dev",
        "use identity password", "table profiles:", "unique byHandle:", "avatar: image",
        "query handleAvailable(", "query myProfile(", "mutation saveProfile(",
        "signup(", "login(", "keepSession(", "restoreSession(", "sessionStore",
        "nativeDevice", "webDevice()", "createClient(", "createLocalClient(", "acquired",
        "client.upload(", "avatar: { id:", "client.mutate(api.saveProfile", "client.write(",
        "\"pending\"", "\"denied\"", "\"sent\"", "\"failed\"", "\"loading\"",
        "post-signup", "terminal", "cold-offline", "1,024 UTF-8 bytes", "8 characters",
        "// src/account.ts", "// src/client.ts", "// App.tsx",
    ] { assert!(path.contains(text), "in-file first-screen path omits {text}"); }
    assert!(!path.contains("]("), "required setup is in-file; external lookups belong in the reference map");
    assert!(!path.contains("guest("), "the first account is password-only");
    assert!(path.find("client.upload(").unwrap() < path.find("avatar: { id: uploaded.asset.id }").unwrap());
    let source = quarry(path).into_iter().find(|block| block.contains("table profiles:")).unwrap();
    let bound = clean("first account", &source);
    assert!(bound.schema.auth.password && !bound.schema.auth.guests);
    let schema = &bound.schema;
    assert!(schema.operations.contains_key("saveProfile") && schema.operations.contains_key("myProfile"));
    // Validate the optional map's actual destinations too, including all local anchors.
    let package = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../packages/snapback4");
    for link in readme.split("](").skip(1) {
        let target = link.split_once(')').unwrap().0;
        if !target.starts_with("./") { continue; }
        let (file, anchor) = target.split_once('#').map_or((target, None), |(file, anchor)| (file, Some(anchor)));
        let doc = std::fs::read_to_string(package.join(file)).unwrap();
        if let Some(anchor) = anchor {
            let slug = |heading: &str| heading.trim_start_matches('#').trim().to_lowercase().chars()
                .filter(|c| c.is_alphanumeric() || c.is_whitespace() || *c == '-').collect::<String>().replace(' ', "-");
            assert!(doc.lines().filter(|line| line.starts_with('#')).any(|heading| slug(heading) == anchor), "dead anchor: {target}");
        }
    }
    for command in readme.split("guide ").skip(1) {
        let name = command.split(|c: char| !c.is_ascii_alphabetic()).next().unwrap();
        if !name.is_empty() { assert!(card(name).is_some(), "dead card: {name}"); }
    }
}

#[test]
fn w10a_readme_opening_is_one_way_into_the_published_surface() {
    let readme = include_str!("../../../packages/snapback4/README.md");
    let opening = readme;
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
    for (name, doc) in [("jobs", card("jobs").unwrap()), ("effects", card("effects").unwrap()), ("orientation destination", readme_reference("effects"))] {
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

/// The core and server fences together exercise every form; the program binds
/// clean and every operation on it does what its comment says.
#[test]
fn the_language_card_compiles_and_runs() {
    let source = in_context(&quarry(LANGUAGE)[1]);
    let bound = clean("the language card", &source);
    let names: Vec<&str> = bound.programs.iter().map(|p| p.program.name.as_str()).filter(|name| !name.starts_with("timeline")).collect();
    assert_eq!(names, ["daily", "today", "calendar", "anchoredKeys", "digestToday", "mostLiked", "chips", "heldRoom", "room", "helperRows", "thread", "inbox", "ancestors", "digest", "mentions", "tokenDigest", "search", "everywhere", "wholeRoster", "memberTotal", "hasMessages", "groupedMessages", "online", "pagePass", "registerProfile", "createRoom", "sendBrief", "edit", "join", "leave", "react", "post", "split", "nightly", "rescoreNative", "personalizeNative", "roomHour", "roomWindow", "checkin", "summarizeRoom", "scheduledSummary"]);
    assert_eq!(bound.schema.effects, ["notify", "sendDigest"]);
    assert!(bound.server);
    assert_eq!(bound.schema.schedules.len(), 3);
    assert_eq!(bound.schema.routes.keys().map(String::as_str).collect::<Vec<_>>(), ["providerEvent", "roomExport"]);
    assert_eq!(bound.schema.routes["providerEvent"].service.as_deref(), Some("service:reporter"));
    assert_eq!(bound.schema.routes["roomExport"].service, None);
    assert!(!bound.schema.operations.contains_key("roomExport"));
    assert_eq!(bound.personas, ["alice", "bob", "carol"]);
    let mut engine = Engine::memory(bound.schema.clone(), bound.programs.iter().map(|p| p.program.clone())).unwrap();
    let (alice, bob) = ("dev:alice", "dev:bob");

    engine.seed((0..4).map(|h| ("roomEntries".into(), snapback4_core::value::object([
        ("id", id(&format!("entry{h}"))), ("roomId", id("calendar-room")), ("at", Value::Int(h * 3_600_000)),
    ])))).unwrap();
    let calendar_context = || Context::new(alice, args(&[("roomId", id("calendar-room"))])).at(3 * 3_600_000);
    let hour = engine.query("roomHour", calendar_context()).unwrap();
    assert_eq!(hour.data.as_array().unwrap().len(), 1);
    let window = engine.query("roomWindow", calendar_context()).unwrap();
    assert_eq!(window.data.as_array().unwrap().len(), 4);
    assert!(window.complete);
    for (write, at, allowed) in [("checkin1", 86_399_999, true), ("checkin2", 86_399_999, false), ("checkin3", 86_400_000, true)] {
        let outcome = engine.mutate("checkin", Some(write), Context::new(alice, args(&[])).at(at).with_ids([write.into()])).unwrap();
        if allowed { sent(&outcome); } else { assert_eq!(failed(&outcome), "ALREADY_CHECKED_IN"); }
    }

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
    let roster = engine.query("wholeRoster", Context::new(bob, args(&[("roomId", id("r1"))])).at(2_200)).unwrap();
    assert!(roster.complete && roster.next.is_none());
    assert_eq!(roster.data.as_array().unwrap().len(), 2);
    assert_eq!(engine.query("memberTotal", Context::new(bob, args(&[]))).unwrap().data, Value::Int(1));
    assert_eq!(engine.query("hasMessages", Context::new(bob, args(&[("roomId", id("r1"))])).at(2_200)).unwrap().data, Value::Bool(true));
    let grouped = engine.query("groupedMessages", Context::new(bob, args(&[("q", text("keep"))])).at(2_200)).unwrap();
    assert!(grouped.complete);
    assert_eq!(grouped.data.as_array().unwrap().len(), 1);
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
    assert_eq!(engine.query("tokenDigest", Context::new(alice, args(&[("token", text("abc"))])).at(2_200)).unwrap().data,
        text("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"));
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
    // post: a loop over a bounded list argument.
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
    assert_eq!(engine.fire_schedules(2 * day + three + 1_000).unwrap(), vec!["everyNight".to_owned(), "summariesEveryDay".to_owned(), "timelinePurgeRemovedEvery".to_owned()]);
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
            if *keyword == "feeds" && n == 0 {
                feeds::assert_stream_note(&compile(block));
                continue;
            }
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
    // The relocation preserves compiling adoption instructions for already installed apps.
    let adoption = quarry(include_str!("../src/recipe/ADOPTION.md"));
    assert!(!adoption.is_empty(), "installed-app adoption must remain executable");
    for (index, block) in adoption.iter().enumerate() {
        clean(&format!("existing feed adoption block {}", index + 1), &format!("{}\n{block}", snapback4_lang::recipe::following("feed", "").unwrap()));
    }
    assert_eq!(card("grammar"), Some(LANGUAGE));
    assert_eq!(card("quarry"), Some(LANGUAGE));
    assert_eq!(card("nonsense"), None);
    assert_eq!(quarry(LANGUAGE).len(), 4, "the language card also teaches intent reads");
}

#[test]
fn w13e_every_chat_search_has_two_single_cursor_forms_without_a_protocol() {
    let text = card("search").unwrap();
    let section = text.split_once("## Search every chat I'm in").expect("the search forms").1.split("\n## ").next().unwrap();
    let blocks = quarry(section);
    assert_eq!(blocks.len(), 1);
    let block = &blocks[0];
    let (document, errors) = snapback4_lang::parse_document("schema.q", block);
    assert!(errors.is_empty(), "{errors:?}");
    assert_eq!(document.programs.len(), 3);
    for form in ["searchHeld", "searchGrouped", "searchNewest"] {
        let declaration = document.programs.iter().find(|query| query.name == form).expect(form);
        assert_eq!(declaration.args.iter().filter(|arg| arg.type_.kind == snapback4_lang::ast::TypeKind::Cursor).count(), 1, "{form}");
    }
    for sentence in ["do not exchange them", "change both", "never advance past it", "Server batches", "Install the bounded server walk"] {
        assert!(!section.contains(sentence), "obsolete protocol: {sentence}");
    }
    let server = block.lines().map(|line| if line.trim_start().starts_with("sync to ") { "  online only" } else { line }).collect::<Vec<_>>().join("\n");
    clean("both server search forms", &server);
}

/// The package README's Quarry binds clean, and no Quarry hides in an
/// unlabelled fence.
#[test]
fn the_readme_quarry_compiles_clean() {
    let blocks = quarry(README);
    assert!(blocks.len() >= 3, "the package documents carry the first-account schema and complete reference programs");
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
            } else if path.extension().is_some_and(|e| e == "rs" || e == "ts" || e == "tsx" || e == "md") {
                files.push(path);
            }
        }
    }
    for dir in ["crates", "packages/snapback4/src", "packages/snapback4-expo/src"] {
        walk(&root.join(dir), &mut files);
    }
    files.push(root.join("packages/snapback4/README.md"));
    assert!(files.len() > 40, "{} source files", files.len());
    files
}

/// Product and feed-recipe codes at identifier boundaries, including extracted Markdown cards.
fn code_words(text: &str) -> Vec<String> {
    let bytes = text.as_bytes();
    let ident = |b: u8| b.is_ascii_alphanumeric() || b == b'_';
    let mut out = Vec::new();
    let mut i = 0;
    while i + 2 < bytes.len() {
        let prefix = [b"E_".as_slice(), b"N_".as_slice(), b"FEED_".as_slice()].into_iter().find(|p| bytes[i..].starts_with(p));
        if let Some(prefix) = prefix.filter(|p| bytes.get(i + p.len()).is_some_and(u8::is_ascii_uppercase) && (i == 0 || !ident(bytes[i - 1]))) {
            let start = i;
            let mut end = i + prefix.len();
            while end < bytes.len() && (bytes[end].is_ascii_uppercase() || bytes[end] == b'_' || bytes[end].is_ascii_digit()) {
                end += 1;
            }
            if (end >= bytes.len() || !ident(bytes[end])) && bytes[end - 1] != b'_' {
                out.push(text[start..end].to_owned());
            }
            i = end;
        } else {
            i += 1;
        }
    }
    out
}

/// Every refusal code the engine, the compiler and the client emit is one
/// `snapback4 why` explains — the orientation's promise, tested.
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
fn w10r2_common_refusal_examples_have_clean_repairs() {
    for (code, bad, good) in [
        ("E_QUARRY_SYNTAX", "query answer:\n  return 42\n", "query answer():\n  return 42\n"),
        ("E_QUARRY_UNKNOWN", "query answer():\n  message = 'hello'\n  return mesage\n", "query answer():\n  message = 'hello'\n  return message\n"),
        ("E_QUARRY_PLACEMENT", "table notes:\n  body: text <=100\n  insert <- allow\nquery add():\n  insert notes { body: 'hello' }\n", "table notes:\n  body: text <=100\n  insert <- allow\nmutation add():\n  insert notes { body: 'hello' }\n"),
        ("E_EMIT_IN_QUERY", "effect notify\nquery send():\n  emit notify { body: 'hello' }\n", "effect notify\nmutation send():\n  emit notify { body: 'hello' }\n"),
    ] {
        let bound = compile(bad);
        assert!(bound.diagnostics.iter().any(|d| d.code == code), "{code}: {:?}", bound.diagnostics);
        clean(code, good);
    }
}

#[test]
// @ref LLP 3000.007#20.19 — every registered diagnostic must have prose that repeated check output can carry.
fn w11_every_registered_code_has_a_dedicated_section() {
    let mut missing = BTreeMap::<&str, Vec<&str>>::new();
    let mut covered = 0;
    for code in codes() {
        let diagnostic = snapback4_lang::Diagnostic::new(&Default::default(), code, "", "");
        if let Some(text) = diagnostic.explanation_section() {
            let section = text.split_once("\n\n").unwrap().1;
            assert!(section.split(|c: char| !c.is_ascii_alphanumeric() && c != '_').any(|word| word == code), "{text}");
            assert_eq!(explain_code(code).as_deref(), Some(text.as_str()), "why and inline help must select the same dedicated section for {code}");
            assert!(!text.contains("No dedicated section"), "{text}");
            covered += 1;
        } else {
            missing.entry(snapback4_lang::diag::guide_for(code)).or_default().push(code);
        }
    }
    println!("W11 section census: registered={} with={covered} without={}", codes().len(), codes().len() - covered);
    for (card, codes) in &mut missing { codes.sort_unstable(); println!("{card}: {}", codes.join(", ")); }
    assert!(missing.is_empty(), "every registered code needs a dedicated prose paragraph on its default card: {missing:?}");
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
    let source = in_context(&quarry(LANGUAGE)[1]).replace(": nightly ", ": timeline.nightly ").replace(": scheduledSummary\n", ": timeline.scheduledSummary\n");
    assert!(source.contains(": timeline.nightly "));
    assert!(source.contains(": timeline.scheduledSummary\n"));
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
    sent(&engine.mutate("createConversation", Some("create"), Context::new("dev:alice", args(&[])).with_ids(["room".into(), "member".into()])).unwrap());
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
    let outsider = || Context::new("dev:bob", args(&[("conversationId", id("room")), ("body", text("hello"))])).at(1001).with_ids(["bob-message".into()]);
    assert_eq!(failed(&engine.mutate("send", None, outsider()).unwrap()), "E_RULE");
    sent(&engine.mutate("addMember", None, Context::new("dev:alice", args(&[("conversationId", id("room")), ("principal", id("dev:bob"))])).with_ids(["bob-member".into()])).unwrap());
    assert_eq!(sent(&engine.mutate("send", None, outsider()).unwrap()).field("ordinal").unwrap(), &Value::Int(52));
}

#[test]
fn onboarding_recipe_recovers_a_taken_handle_for_the_same_principal() {
    let source = quarry(include_str!("../../../packages/snapback4/CLIENT-AND-OPERATIONS.md")).into_iter().find(|block| block.contains("query handleAvailable(")).unwrap();
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
    for (name, doc) in [("feeds", card("feeds").unwrap()), ("orientation destination", readme_reference("feeds"))] {
        assert!(doc.contains("A merge cursor from generation N"), "{name} must scope cross-generation continuation to merge cursors");
        assert!(!doc.contains("A cursor from generation N"), "{name} must not promise it for direct pages");
    }
    assert!(readme_reference("maintains").contains("A direct page cursor binds its evaluated prefix and active\ngeneration"));
}

#[test]
fn language_following_uses_the_declaration() {
    let bound = clean("language", &language());
    assert_eq!(bound.schema.timelines.len(), 1);
    assert_eq!(bound.schema.operations["timelineHome"].runs.as_deref(), Some("device"));
    let sites = &bound.schema.operations["timelineHome"].sites;
    for table in ["timelineFeed", "timelinePulls", "timelineBroadcast", "timelineRemovedEvents"] {
        assert!(sites.iter().any(|site| site.table == table), "missing {table}: {sites:?}");
    }
    assert!(!sites.iter().any(|site| site.table == "timelineFollows" || site.table == "follows"));
    assert_eq!(bound.schema.operations["timelineFollow"].predicts.as_deref(), Some("never"));
    assert!(bound.schema.tables["timelinePulls"].constraints.iter().any(|constraint|
        matches!(constraint, snapback4_core::schema::Constraint::Cap { by, max: 32 } if by == &["readerId"])));
    assert!(LANGUAGE.contains("guide feeds"));
    assert!(!language().contains("table feed:"));
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
    for (name, doc) in [("feeds", card("feeds").unwrap()), ("orientation destination", readme_reference("feeds"))] {
        assert!(doc.contains("82 examinations"), "{name} must count examinations, including lookups");
        assert!(doc.contains("41 tombstone probes"), "{name} must pin the tombstone work");
    }
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
    for doc in [card("reads").unwrap(), readme_reference("reads")] {
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
    assert!(prose.contains("Runtime meter cuts, the non-uniform scope's 32-word limit and page continuation still apply; `complete` describes each returned page, and `fresh` separately describes sync freshness."));
    assert!(prose.contains("The local clients never fall back to the server for a held query, even at a horizon, meter cut or word cut."));
    let wide = explain_code("N_WIDE_MERGE").unwrap();
    assert!(wide.contains("Inspect structural costs with `snapback4 check --cost`; if a held query answers this read, delete the merge."));
}

#[test]
fn w14a_compact_reads_and_wide_note_qualify_word_expansion_and_continuation() {
    let reads = card("reads").unwrap();
    assert!(!reads.contains("at most 32 words per scope"));
    let compact = reads.split_once("Unknown widths print").unwrap().1;
    assert!(compact.contains("A resumable read-meter cut"));
    assert!(compact.contains("Heap exhaustion clears the whole page"));
    assert!(compact.contains("uniform matching scan is always lazy"));
    let why = explain_code("N_WIDE_MERGE").unwrap();
    assert!(why.contains("subject to final-answer eligibility"));
    assert!(why.contains("Heap exhaustion clears the whole page even during the drain"));
    let search = card("search").unwrap();
    assert!(search.contains("an interrupted existence predicate retries its membership inclusively"));
    assert!(search.contains("same membership again with nothing emitted"));
}

#[test]
fn composition_card_is_reachable_and_keeps_the_routing_boundary() {
    let sync = card("sync").unwrap();
    let paragraph = |text: &str| text.split("A device query returning\n").nth(1).unwrap().split("answer offline.").next().unwrap().to_owned();
    assert_eq!(paragraph(sync), paragraph(readme_reference("sync")));
    for text in [sync, readme_reference("sync")] {
        for word in ["`check --residency` names", "at most one read", "no reading `require`", "found point read", "Composition is never entered while a predictable write is unobserved; the whole local answer stands until it settles.", "every locally kept component"] {
            assert!(text.contains(word), "missing {word}");
        }
    }
}

#[test]
fn structural_admission_cards_name_every_host_and_the_web_trust_boundary() {
    let boundary = "and a native device checks again; the web device trusts that admission and does not repeat the check, so a hand-built or corrupted backend can still run there.";
    for name in ["bounds", "programs"] {
        assert!(card(name).unwrap().contains(boundary), "{name}: missing the web trust boundary");
    }
    for code in ["E_STRUCTURAL_FANOUT", "E_UNBOUND_SCAN"] {
        assert!(explain_code(code).unwrap().contains(boundary), "{code}: missing the web trust boundary");
    }
    for text in [card("prediction").unwrap(), readme_reference("reads")] {
        assert!(text.contains("the backend compiler's structural admission") && text.contains("hand-built or corrupted backend"));
    }
}

#[test]
fn digest_recipe_is_atomic_bounded_and_reachable_from_the_orientation() {
    let jobs = card("jobs").unwrap();
    let digest = quarry(jobs).into_iter().find(|b| b.contains("job digest(")).expect("a complete digest recipe");
    let recipes = quarry(readme_reference("jobs")).into_iter().filter(|b| b.contains("job digest(")).collect::<Vec<_>>();
    assert_eq!(recipes, [digest.clone()], "one intact digest, reached from the orientation");
    clean("digest", &digest);
    assert!(!quarry(jobs).iter().any(|b| b.contains("job digestLarge(")), "no live paged accumulator");
    assert!(digest.contains("at >= periodStart, at < periodEnd"));
    assert!(digest.contains(".ordinal > readOrdinal"));
    assert!(digest.contains("require n <= 100 else DIGEST_CHAT_BOUND"));
    assert!(digest.contains("insert digestMarkers { principal: p.principal, periodEnd }"));
    assert_eq!(snapback4_lang::diag::guide_for("DIGEST_CHAT_BOUND"), "jobs");
    assert!(explain_code("DIGEST_CHAT_BOUND").unwrap().contains("without an effect or marker"));
    let remind = quarry(jobs).into_iter().find(|b| b.contains("job remind(")).unwrap();
    assert!(remind.contains("immutable sentAt"));
    assert!(remind.contains("invites[sentAt >= periodStart, sentAt < periodEnd] first 100 by bySentAt"));
    // `why` names the job door too, and neither text promises a backfill:
    // missed boundaries coalesce into one run for the latest period.
    assert!(explain_code("E_STRUCTURAL_FANOUT").unwrap().contains("or use a job chunk, which may read a table with expiry"));
    for text in [jobs, readme_reference("jobs")] {
        assert!(text.contains("never twice for the\nsame boundary") || text.contains("never twice for the same boundary"));
        assert!(!text.contains("exactly once across restarts") && !text.contains("exactly once per\nboundary"));
    }
}

#[test]
fn host_unicode_refusal_explains_the_repair_and_search_contract() {
    let why = explain_code("E_HOST_UNICODE").unwrap();
    assert!(why.contains("family store"));
    assert!(why.contains("standard String.prototype.normalize"));
    assert!(why.contains("will not index text differently from the server"));
    assert_eq!(snapback4_lang::diag::guide_for("E_HOST_UNICODE"), "search");
    for text in [card("search").unwrap(), readme_reference("search")] {
        assert!(text.contains("browser's normalization"));
        assert!(text.contains("refuses to open"));
        assert!(text.contains("E_HOST_UNICODE"));
    }
}

#[path = "guide/feeds.rs"]
mod feeds;

#[test]
fn maintained_column_notes_do_not_spread_to_existing_cards_recipes_or_templates() {
    let docs = std::iter::once(("language", LANGUAGE)).chain(std::iter::once(("README",README)))
        .chain(KEYWORDS.iter().filter_map(|name|card(name).map(|text|(*name,text))));
    for (name,text) in docs {
        for (index, source) in quarry(text).into_iter().enumerate() {
            let bound=compile(&in_context(&source));
            if name == "feeds" && index == 0 { feeds::assert_stream_note(&bound); continue; }
            assert!(bound.notes.iter().all(|n|!n.code.starts_with("N_MAINTAINED_COLUMN")),"{name}: {:?}",bound.notes);
        }
    }
    for source in [guide::TEMPLATE,guide::TEMPLATE_ONLINE] {
        let bound=compile(source);
        assert!(bound.notes.iter().all(|n|!n.code.starts_with("N_MAINTAINED_COLUMN")),"{:?}",bound.notes);
    }
}
