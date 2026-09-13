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
use std::path::{Path, PathBuf};

const README: &str = include_str!("../../../packages/snapback4/README.md");

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

/// The language card is one program that exercises every form; it binds
/// clean and every operation on it does what its comment says.
#[test]
fn the_language_card_compiles_and_runs() {
    let source = language();
    let bound = clean("the language card", &source);
    let names: Vec<&str> = bound.programs.iter().map(|p| p.program.name.as_str()).collect();
    assert_eq!(names, ["room", "thread", "inbox", "following", "ancestors", "digest", "mentions", "createRoom", "sendBrief", "edit", "join", "leave", "react", "post", "split", "nightly"]);
    assert_eq!(bound.schema.schedules.len(), 1);
    assert_eq!(bound.personas, ["alice", "bob", "carol"]);
    let mut engine = Engine::memory(bound.schema.clone(), bound.programs.iter().map(|p| p.program.clone())).unwrap();
    let (alice, bob) = ("dev:alice", "dev:bob");

    // createRoom: `new` takes the first minted id; the second insert the next; `after insert` holds.
    let created = engine.mutate("createRoom", Some("c1"), Context::new(alice, args(&[("name", text("General")), ("kind", text("open")), ("tags", Value::Array(vec![text("new")]))])).at(1_000).with_ids(["r1".to_owned(), "m1".to_owned()])).unwrap();
    let room = sent(&created);
    assert_eq!(room.field("id").unwrap(), &id("r1"));
    assert_eq!(room.field("owner").unwrap(), &id(alice));
    assert_eq!(room.field("tagCount").unwrap(), &Value::Int(1));
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
    // inbox and room: shapes over a page and over a row.
    let inbox = engine.query("inbox", Context::new(bob, args(&[])).at(2_200)).unwrap();
    assert_eq!(inbox.data.as_array().unwrap()[0].field("unread").unwrap(), &Value::Int(2));
    assert_eq!(engine.query("room", Context::new(bob, args(&[("roomId", id("r1"))])).at(2_200)).unwrap().data.field("name").unwrap(), &text("General"));
    assert_eq!(engine.query("room", Context::new("dev:mallory", args(&[("roomId", id("r1"))])).at(2_200)).unwrap().data, Value::Null, "hidden is null");
    // digest: divmod, sorted, min, max, slice, sort, a helper with null.
    let digest = engine.query("digest", Context::new(alice, args(&[("roomId", id("r1"))])).at(2_200)).unwrap().data;
    assert_eq!(digest.field("total").unwrap(), &Value::Int(2));
    assert_eq!((digest.field("weeks").unwrap(), digest.field("days").unwrap()), (&Value::Int(0), &Value::Int(2)));
    assert_eq!((digest.field("lo").unwrap(), digest.field("hi").unwrap()), (&Value::Int(0), &Value::Int(2)));
    assert_eq!((digest.field("smaller").unwrap(), digest.field("larger").unwrap()), (&Value::Int(0), &Value::Int(2)));
    assert_eq!(digest.field("brief").unwrap(), &Value::Bool(false));
    let oldest = digest.field("oldest").unwrap().as_array().unwrap();
    assert_eq!(oldest.iter().map(|m| m.field("at").unwrap().as_int().unwrap()).collect::<Vec<_>>(), [2_000, 2_100], "sorted ascending by at");
    // mentions: tokens.
    assert_eq!(engine.query("mentions", Context::new(alice, args(&[("body", text("hey @bob and @carol"))])).at(2_200)).unwrap().data, Value::Array(vec![text("bob"), text("carol")]));
    // post: a loop over a bounded list argument; following: a merge over lanes, shaped.
    let posted = engine.mutate("post", Some("p1"), Context::new(alice, args(&[("bodies", Value::Array(vec![text("a"), text("b")]))])).at(3_000).with_ids(["post1".to_owned(), "post2".to_owned()])).unwrap();
    assert_eq!(sent(&posted), &Value::Int(2));
    engine.seed([("follows".to_owned(), snapback4_core::value::object([("id", id("f1")), ("followerId", id(bob)), ("followedId", id(alice))]))]).unwrap();
    let following = engine.query("following", Context::new(bob, args(&[])).at(3_100)).unwrap();
    let posts = following.data.as_array().unwrap();
    assert_eq!(posts.len(), 2);
    assert_eq!(posts[0].field("mine").unwrap(), &Value::Null);
    // react: a refusal with the program's code; upsert as the implicit return.
    assert_eq!(failed(&engine.mutate("react", Some("x1"), Context::new(bob, args(&[("postId", id("post1")), ("direction", Value::Int(2))])).at(3_200)).unwrap()), "BAD_DIRECTION");
    let reacted = engine.mutate("react", Some("x2"), Context::new(bob, args(&[("postId", id("post1")), ("direction", Value::Int(-1))])).at(3_300).with_ids(["react1".to_owned()])).unwrap();
    assert_eq!(sent(&reacted).field("direction").unwrap(), &Value::Int(-1));
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
    // nightly: chunks, `break` on the first room past the period, a proc call, `range`.
    let later = engine.mutate("createRoom", Some("c2"), Context::new(alice, args(&[("name", text("Later")), ("kind", text("closed")), ("tags", Value::Array(vec![]))])).at(6_000).with_ids(["r2".to_owned(), "m4".to_owned()])).unwrap();
    assert_eq!(sent(&later).field("id").unwrap(), &id("r2"));
    let run = engine.run_job("nightly", args(&[("periodStart", Value::Int(0)), ("periodEnd", Value::Int(5_000))]), 7_000).unwrap();
    assert_eq!(run.state, JobState::Done, "{run:?}");
    let rooms = engine.store().rows("rooms").unwrap();
    let created_at = |name: &str| rooms.iter().find(|r| r.field("name").unwrap() == &text(name)).unwrap().field("createdAt").unwrap().as_int().unwrap();
    assert_eq!(created_at("General"), 7_000, "stamped by the proc");
    assert_eq!(created_at("Later"), 6_000, "`break` ended the sweep before it");
    assert!(engine.store().rows("posts").unwrap().iter().all(|p| p.field("score").unwrap() == &Value::Int(1)), "range(0, 2) added 0 then 1 to a score read once");
    // everyNight: the schedule fires from its next boundary, once.
    let (day, three) = (86_400_000, 10_800_000);
    assert_eq!(engine.fire_schedules(day + three + 1_000).unwrap(), Vec::<String>::new());
    assert_eq!(engine.fire_schedules(2 * day + three + 1_000).unwrap(), vec!["everyNight".to_owned()]);
}

/// Every keyword card's blocks bind clean, alone or beside the language card.
#[test]
fn every_card_compiles_clean() {
    for keyword in KEYWORDS {
        let text = card(keyword).unwrap_or_else(|| panic!("no card for {keyword}"));
        let blocks = quarry(text);
        for (n, block) in blocks.iter().enumerate() {
            clean(&format!("card {keyword}, block {}", n + 1), &in_context(block));
        }
    }
    assert_eq!(card("grammar"), Some(LANGUAGE));
    assert_eq!(card("quarry"), Some(LANGUAGE));
    assert_eq!(card("nonsense"), None);
    assert_eq!(quarry(LANGUAGE).len(), 1, "the language card is one program");
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

/// Every guide keyword a diagnostic or a refusal carries names a card.
#[test]
fn every_guide_keyword_a_diagnostic_names_is_a_card() {
    let aliases = ["grammar", "quarry"];
    for code in codes() {
        let keyword = snapback4_lang::diag::guide_for(code);
        assert!(card(keyword).is_some(), "{code} points at `{keyword}`, which is not a card");
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
}
