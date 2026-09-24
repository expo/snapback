use snapback4_core::schema::{ColumnType, Schema};
use snapback4_lang::{Bound, bind::rule_truth, compile, guide, recipe};
// Exercise schema-only constraints and isolate this pass's cost without adding
// a public compiler API. This is the production implementation, not a test twin.
use snapback4_lang::{ast, diag, print};
mod bind { pub use snapback4_lang::bind::{catalog, schema, rule_truth}; }
#[path = "../src/bind/aggregate_copies.rs"]
#[allow(dead_code, unused_imports)]
mod copies_impl;
use copies_impl::provenance;

const CODE: &str = "N_PUBLIC_AGGREGATE_COPY";
const README: &str = include_str!("../../../packages/snapback4/README.md");
const SOURCE: &str = r#"table posts:
  author: principal
  public 'posts'
table likes:
  postId: posts
  principal: principal
  unique byPair: postId, principal
  public 'likes'
  insert <- .principal = viewer
  delete <- .principal = viewer
maintain likeCounts: count likes by postId
  read <- allow
table ranked:
  postId: posts
  score: int
  at: time
  expiresAt: time
  unique byPost: postId
  by byScore: score, at, id
  public 'ranking'
  insert <- allow
  update <- allow
  sync public last 100 by byScore
fn refreshRank(postId: posts):
  upsert ranked[postId = postId] { postId, score: likeCounts[postId], at: now, expiresAt: now + 86400000 }
  return null
mutation refresh(postId: posts):
  refreshRank(postId)
"#;

fn bind(source: &str) -> Bound {
    let bound = compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    bound
}

fn copies(bound: &Bound) -> Vec<&snapback4_lang::Diagnostic> {
    bound.notes.iter().filter(|note| note.code == CODE).collect()
}

fn catalog_schema(source: &str) -> (bind::catalog::Catalog, Schema) {
    let (document, mut diagnostics) = snapback4_lang::parse_document("schema.q", source);
    let catalog = bind::catalog::Catalog::build(vec![document], &mut diagnostics);
    let schema = bind::schema::bind_schema(&catalog, &mut diagnostics);
    assert!(diagnostics.is_empty(), "{diagnostics:?}");
    (catalog, schema)
}

#[test]
fn three_calibration_write_shapes_report_the_copied_column_once() {
    // 0.2.25: helper; 0.2.26: backfill job (no principal-callable writer);
    // 0.2.27: direct mutation. All three contain an actual maintain copy.
    let job = SOURCE.split("fn refreshRank").next().unwrap().to_owned() +
        "job backfill():\n  chunk p in posts first 50 by byId:\n    upsert ranked[postId = p.id] { postId: p.id, score: likeCounts[p.id], at: now, expiresAt: now + 86400000 }\n";
    let direct = SOURCE.replace("fn refreshRank(postId: posts):", "mutation refreshRank(postId: posts):")
        .split("mutation refresh(postId:").next().unwrap().to_owned();
    for (version, source) in [("0.2.25", SOURCE.to_owned()), ("0.2.26", job.replace("ranked", "trendingRows")), ("0.2.27", direct.replace("ranked", "trendingPosts"))] {
        let bound = bind(&source);
        let all = copies(&bound);
        assert_eq!(all.len(), if version == "0.2.26" { 2 } else { 1 }, "{version}: {:?}", bound.notes);
        let notes: Vec<_> = all.into_iter().filter(|note| note.message.contains(".score ")).collect();
        assert_eq!(notes.len(), 1, "{version}: {:?}", bound.notes);
        assert_eq!(notes[0].site.line, 15);
        assert_eq!(notes[0].guide, "feeds");
        assert!(!notes[0].mechanical);
        assert!(notes[0].message.contains("likeCounts"));
        assert!(notes[0].message.ends_with("through any mutation that writes it"));
        println!("{version}: {}", notes[0]);
    }
}

#[test]
fn aggregate_only_restricted_private_immutable_and_ambient_writes_stay_silent() {
    let increment = SOURCE.split("fn refreshRank").next().unwrap().to_owned() +
        "mutation bump(postId: posts):\n  row = ranked[postId = postId] ! else ROW_MISSING\n  update ranked[id = row.id] { score: row.score + 1 }\n";
    for source in [
        SOURCE.split("table ranked:").next().unwrap().to_owned(),
        SOURCE.replace("insert <- allow", "insert <- deny").replace("update <- allow", "update <- deny"),
        SOURCE.replace("insert <- allow", "insert <- viewer = 'service:ranker'").replace("update <- allow", "update <- viewer = 'service:ranker'"),
        SOURCE.replace("insert <- allow", "insert <- exists posts[id = .postId, author = viewer]").replace("update <- allow", "update <- exists posts[id = .postId, author = viewer]"),
        SOURCE.replace("  public 'ranking'", "  read <- exists posts[id = .postId, author = viewer]").replace("  sync public last 100 by byScore\n", ""),
        SOURCE.replace("  score: int", "  score: int\n  immutable score"),
        SOURCE.replace("score: likeCounts[postId]", "score: 1"),
        SOURCE.replace("maintain likeCounts: count likes by postId\n  read <- allow\n", "").replace("score: likeCounts[postId]", "score: 1"),
        increment.replace("insert <- allow", "insert <- deny").replace("update <- allow", "update <- deny"),
    ] {
        assert!(copies(&bind(&source)).is_empty(), "{source}");
    }
}

#[test]
fn unrestricted_rule_spellings_and_public_online_tables_are_covered() {
    for rule in ["allow", "true", "not deny", "allow and true", "viewer = viewer", "viewer = 'service:ranker' or allow"] {
        for (insert, update, named) in [(rule, "deny", "insert"), ("deny", rule, "update")] {
            let source = SOURCE.replace("insert <- allow", &format!("insert <- {insert}"))
                .replace("update <- allow", &format!("update <- {update}")).replace("  sync public last 100 by byScore", "  online only");
            let bound = bind(&source);
            let notes = copies(&bound);
            assert_eq!(notes.len(), 1, "insert {insert}, update {update}");
            assert!(notes[0].message.contains(&format!("`{named} <-")), "{}", notes[0]);
            assert!(!notes[0].message.contains("<- deny"), "{}", notes[0]);
            println!("{named} {rule}: {}", notes[0].message);
        }
    }
    assert_eq!(copies(&bind(&SOURCE.replace("public 'ranking'", "read <- allow"))).len(), 1, "sync public with an allow read rule");
}

#[test]
fn installable_recipes_have_no_aggregate_copy_note() {
    for (name, source) in [("feeds bare", recipe::following("", "social").unwrap()), ("feeds prefixed", recipe::following("feed", "social").unwrap())] {
        let bound = compile(&[("social.q".into(), source)]);
        assert!(bound.diagnostics.is_empty(), "{name}: {:?}", bound.diagnostics);
        assert!(bound.notes.is_empty(), "{name}: {:?}", bound.notes);
        println!("recipe {name}: {} tables, 0 notes", bound.schema.tables.len());
    }
}

#[test]
fn every_card_and_published_quarry_block_has_no_aggregate_copy_note() {
    let mut blocks = 0;
    let mut tables = 0;
    let mut hits = Vec::new();
    for (name, source) in published_blocks() {
        let bound = compile(&[("schema.q".into(), source)]);
        assert!(bound.diagnostics.is_empty(), "{name}: {:?}", bound.diagnostics);
        blocks += 1;
        tables += bound.schema.tables.len();
        for note in copies(&bound) { hits.push(format!("{name}: {note}")); }
    }
    println!("card/README survey: {} cards, 3 documents, {blocks} blocks, {tables} bound table occurrences, {} aggregate-copy notes", guide::KEYWORDS.len(), hits.len());
    assert!(hits.is_empty(), "{}", hits.join("\n"));
}

#[test]
fn aggregate_copy_card_section_is_verbatim_and_discoverable() {
    let section = guide::card("feeds").unwrap().split_once("## N_PUBLIC_AGGREGATE_COPY:").unwrap().1;
    assert!(section.contains("Every write to a public or"));
    assert!(section.contains("p.score + 1"));
    assert!(section.contains("but may not supply the value itself or how many values contribute to it."));
    let column = section.find("likeCount: count likes by postId").unwrap();
    let pin = section.find("both insert and update rules").unwrap();
    assert!(column < pin, "lead with the maintained column, then pinning for other derivations");
    assert!(guide::card("feeds").unwrap().ends_with(section));
    assert_eq!(snapback4_lang::diag::guide_for(CODE), "feeds");
    let explanation = guide::explain_code(CODE).unwrap();
    assert!(explanation.contains("Every write to a public or"));
    assert!(explanation.ends_with("Full card: snapback4 guide feeds"));
}

#[test]
fn aggregate_copy_claim_is_reached_from_the_orientation() {
    // Wave 14 (W14b) moved every reference section out of the README into the cards;
    // the orientation's reference map must still lead a reader to the feeds card, and
    // the claim lives there in full (its wording is pinned by the card test above).
    assert!(README.split_once("## Reference map").unwrap().1.contains("`guide feeds`"));
    assert!(!README.contains("## N_PUBLIC_AGGREGATE_COPY:"), "the claim is no longer duplicated in the README");
    let claim = guide::card("feeds").unwrap().split_once("## N_PUBLIC_AGGREGATE_COPY:").expect("published aggregate-copy section").1;
    assert!(claim.contains("Every write to a public or") && claim.contains("likeCount: count likes by postId"));
}

#[test]
fn copies_of_sums_and_repeated_cross_file_writes_are_not_name_heuristics() {
    let source = SOURCE.replace("  principal: principal", "  principal: principal\n  weight: int")
        .replace("count likes by postId", "sum likes of weight by postId")
        .replace("score", "amount").replace("likeCounts", "totals").replace("ranked", "catalog");
    let (schema, program) = source.split_once("fn refreshRank").unwrap();
    let bound = compile(&[("schema.q".into(), schema.into()), ("writes.q".into(), format!("fn refreshRank{program}\nmutation again(postId: posts):\n  refreshRank(postId)\n"))]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let notes = copies(&bound);
    assert_eq!(notes.len(), 1);
    assert_eq!(notes[0].site.file, "schema.q");
    assert_eq!(notes[0].message, "column catalog.amount copies maintain totals, an aggregate of likes the engine already keeps; `insert <- allow` and `update <- allow` let any principal set this public column through any mutation that writes it");
}

#[test]
#[ignore = "requires the retained calibration packets; set SNAPBACK4_CALIBRATION_PACKETS to their parent"]
fn survey_retained_calibration_schemas() {
    let root = std::path::PathBuf::from(std::env::var_os("SNAPBACK4_CALIBRATION_PACKETS").expect("calibration packet parent"));
    let mut differences = Vec::new();
    // L26 restores caller-selected derivations, including cal10's toggle and
    // cal11's read-or-null parent author. Names pin the measured census, not a suppression list.
    for (cal, version, expected) in [(9, "0.2.25", vec!["feedPullCounts.used", "ranked.score"]), (10, "0.2.26", vec!["feedPullCounts.used", "trendingRows.score"]), (11, "0.2.27", vec!["feedPullCounts.used", "posts.parentAuthorId", "posts.score", "trendingPosts.score"]), (12, "0.2.28", vec!["feedPullCounts.used", "posts.parentAuthor", "posts.score"])] {
        let date = if cal == 12 { "20260917" } else { "20260916" };
        let dir = root.join(format!("clique-sb4-{date}-astra-cal{cal}/lanes/astra-snapback4/snapback"));
        let mut files: Vec<_> = std::fs::read_dir(dir).unwrap().map(|entry| entry.unwrap().path()).filter(|path| path.extension().is_some_and(|ext| ext == "q")).collect();
        files.sort();
        let sources: Vec<_> = files.iter().map(|path| (path.file_name().unwrap().to_string_lossy().to_string(), std::fs::read_to_string(path).unwrap())).collect();
        let bound = compile(&sources);
        assert!(bound.diagnostics.is_empty(), "{version}: {:?}", bound.diagnostics);
        let notes = copies(&bound);
        let columns: Vec<_> = notes.iter().map(|note| if note.message.starts_with("column ") { note.message.split_whitespace().nth(1).unwrap() } else { note.message.split_whitespace().nth(3).unwrap() }).collect();
        println!("calibration {version}: {} files, {} tables, {} aggregate-copy notes: {columns:?}", sources.len(), bound.schema.tables.len(), notes.len());
        for note in &notes { println!("{note}"); }
        if columns != expected { differences.push(format!("{version}: {columns:?}, expected {expected:?}")); }
    }
    assert!(differences.is_empty(), "{}", differences.join("\n"));
}

#[test]
fn no_published_indexed_int_table_has_unrestricted_writes() {
    let mut blocks = 0;
    let mut ranked = 0;
    let mut hits = Vec::new();
    for (name, source) in published_blocks().into_iter().chain([
        ("feeds recipe".into(), recipe::following("feed", "").unwrap()),
    ]) {
        let bound = compile(&[("schema.q".into(), source)]);
        assert!(bound.diagnostics.is_empty(), "{name}: {:?}", bound.diagnostics);
        blocks += 1;
        ranked += indexed_int_tables(&bound.schema).len();
        hits.extend(unrestricted_rankings(&bound.schema).into_iter().map(|hit| format!("{name}: {hit}")));
    }
    println!("ranking authority survey: {} cards, 3 documents, 1 recipe, {blocks} blocks, {ranked} indexed-int table occurrences, {} unrestricted rules", guide::KEYWORDS.len(), hits.len());
    assert!(hits.is_empty(), "{}", hits.join("\n"));
}

fn published_blocks() -> Vec<(String, String)> {
    let client = include_str!("../../../packages/snapback4/CLIENT-AND-OPERATIONS.md");
    let server = include_str!("../../../packages/snapback4/SERVER.md");
    guide::KEYWORDS.iter().map(|name| (*name, guide::card(name).unwrap()))
        .chain([("README", README), ("CLIENT-AND-OPERATIONS", client), ("SERVER", server)])
        .flat_map(|(name, doc)| guide::quarry(doc).into_iter().enumerate().map(move |(index, block)| {
            let source = if block.lines().any(|line| line.starts_with("table ")) { block }
            else { format!("{}\n{block}", guide::language()) };
            (format!("{name} block {}", index + 1), source)
        })).collect()
}

fn indexed_int_tables(schema: &Schema) -> Vec<(&String, &snapback4_core::schema::Table)> {
    schema.visible_tables().filter(|(_, table)| table.indexes.values().any(|index|
        index.columns().iter().any(|column| !table.maintained.contains_key(column) && table.columns.get(column).is_some_and(|ty| *ty.required() == ColumnType::Int)))).collect()
}

fn unrestricted_rankings(schema: &Schema) -> Vec<String> {
    indexed_int_tables(schema).into_iter().flat_map(|(name, table)| {
        [("insert", &table.rules.insert), ("update", &table.rules.update)].into_iter()
            .filter(|(_, rule)| rule_truth(rule) == Some(true)).map(move |(arm, rule)| format!("{name}: {arm} <- {}", rule.quarry()))
    }).collect()
}

#[test]
fn ranking_guard_checks_bound_rules_for_both_upsert_arms() {
    // The review's caller-supplied score, indexed so the ranking invariant applies.
    let source = "table leaderboard:\n  postId: id\n  score: int\n  unique byPost: postId\n  by byScore: score, id\n  public 'the ranking is public'\n  insert <- allow\n  update <- allow\nmutation setScore(postId: id, score: int):\n  upsert leaderboard[postId = postId] { postId, score }\n";
    assert!(copies(&bind(source)).is_empty(), "this is not a maintain-copy heuristic");
    assert_eq!(unrestricted_rankings(&bind(source).schema).len(), 2);
    for rule in ["allow", "true", "not deny", "allow and true", "viewer = viewer", "viewer = 'service:ranker' or allow"] {
        for (insert, update, named) in [(rule, "deny", "insert"), ("deny", rule, "update")] {
            let source = source.replace("insert <- allow", &format!("insert <- {insert}"))
                .replace("update <- allow", &format!("update <- {update}"));
            let hits = unrestricted_rankings(&bind(&source).schema);
            assert_eq!(hits.len(), 1, "{source}");
            assert!(hits[0].contains(named), "{hits:?}");
        }
    }
    for rule in ["deny", "viewer = 'service:ranker'", ".postId = viewer"] {
        assert!(unrestricted_rankings(&bind(&source.replace("<- allow", &format!("<- {rule}"))).schema).is_empty());
    }
    // Neither column nor table names, expiry, public residency or int nullability
    // decide whether an index orders an integer column.
    let renamed = source.replace("leaderboard", "catalog").replace("score", "amount").replace("amount: int\n", "amount: int ?\n")
        .replace("public 'the ranking is public'", "read <- deny");
    assert_eq!(unrestricted_rankings(&bind(&renamed).schema).len(), 2);
}

const INCREMENT: &str = "table posts:\n  score: int\n  public 'posts'\n  insert <- allow\n  update <- allow\nmutation create():\n  return insert posts { score: 0 }\nmutation like(postId: posts):\n  p = posts[id = postId] ! else NOT_FOUND\n  update posts[id = p.id] { score: p.score + 1 }\n";

#[test]
fn every_write_from_reads_including_prior_image_reports_once() {
    let bound = bind(INCREMENT);
    let notes = copies(&bound);
    assert_eq!(notes.len(), 1, "{:?}", bound.notes);
    assert_eq!(notes[0].guide, "feeds");
    assert_eq!(notes[0].message, "every write to posts.score is computed from reads (`p.score + 1` in `like`); `insert <- allow` and `update <- allow` let any principal run any mutation that writes it");
    println!("{}", notes[0]);
}

#[test]
fn templates_and_apps_census() {
    let mut materials = vec![
        ("init local".to_owned(), vec![("schema.q".into(), guide::TEMPLATE.into())]),
        ("init online".to_owned(), vec![("schema.q".into(), guide::TEMPLATE_ONLINE.into())]),
        ("init expo".to_owned(), app_sources("apps/chat/snapback")),
    ];
    let apps = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../apps");
    fn directories(path: &std::path::Path, found: &mut Vec<std::path::PathBuf>) {
        let mut has_quarry = false;
        for entry in std::fs::read_dir(path).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() && !matches!(path.file_name().unwrap().to_str(), Some("node_modules" | "target" | "generated" | ".git" | ".snapback4")) { directories(&path, found); }
            has_quarry |= path.extension().is_some_and(|ext| ext == "q");
        }
        if has_quarry { found.push(path.to_owned()); }
    }
    let mut paths = Vec::new();
    directories(&apps, &mut paths);
    paths.sort();
    for path in paths { materials.push((format!("apps/{}", path.strip_prefix(&apps).unwrap().display()), app_sources(path.to_str().unwrap()))); }
    for (name, sources) in materials {
        let after = compile(&sources);
        assert!(after.diagnostics.is_empty(), "{name}: {:?}", after.diagnostics);
        println!("{name}: {} blocks, {} tables, {} notes", sources.len(), after.schema.tables.len(), copies(&after).len());
        for note in copies(&after) { println!("{name}: {note}"); }
        assert!(copies(&after).is_empty());
    }
}

fn app_sources(dir: &str) -> Vec<(String, String)> {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..").join(dir);
    let mut files: Vec<_> = std::fs::read_dir(root).unwrap().map(|entry| entry.unwrap().path()).filter(|path| path.extension().is_some_and(|ext| ext == "q")).collect();
    files.sort();
    files.iter().map(|path| (path.file_name().unwrap().to_string_lossy().to_string(), std::fs::read_to_string(path).unwrap())).collect()
}

#[test]
fn corpus_aggregate_copy_sites_are_pinned() {
    let mut hits = Vec::new();
    let (mut blocks, mut tables, mut refused) = (0, 0, 0);
    for line in include_str!("lowering/r1p-sources.jsonl").lines() {
        let (name, sources): (String, Vec<(String, String)>) = serde_json::from_str(line).unwrap();
        let bound = compile(&sources);
        blocks += sources.len();
        tables += bound.schema.tables.len();
        refused += usize::from(!bound.diagnostics.is_empty());
        for note in copies(&bound) { hits.push(format!("{name}: {}: {}", note.site, note.message.split_whitespace().nth(3).unwrap())); }
    }
    println!("corpus: 740 bundles, {blocks} blocks, {tables} tables, {refused} refused, {} aggregate-copy notes", hits.len());
    for hit in &hits { println!("{hit}"); }
    assert_eq!(hits, [
        "10ad23600c1148fe6b3e09303dada6b3394b8c6b3758655df79b14e4ae35829e: schema.q:3:3: items.n",
        "13a6fe30eb4d29c0a49fee087b67d6b8394bdce1eb212b44fdef068058e2268c: schema.q:2:3: items.n",
        "217e2fd78229359384c5ac4c5bb84b0d5ccda507a4b371119c5e62314d4b3774: schema.q:3:3: notes.n",
        "4d91ac27297b399b30a21b34804b66d8dd7c3c78befb2d49256d0bb034535668: schema.q:3:3: items.n",
        "56b57bca0fb142113c08ec242639506fccbcaccdb50dcf48ee3282e03527a476: schema.q:4:3: items.body",
        "6f4a24cfe8c8e07993869bb37938a3c838723726594742aea048af672a6722d3: schema.q:2:3: items.value",
        "a6c418dad38017d6b8a5c1045b88088e76c0de97261bec467fa8eb7b62c9759c: schema.q:3:3: notes.n",
        "abac58b5071aa7a78b3c81be694c6badb05c8786a9ca3a24127bf5df581ebfc0: schema.q:3:3: notes.n",
        "b379c824f4530bc2804beeccd783cff81658dd3693ecc083d3c55a1c5668c5e7: schema.q:2:3: items.n",
        "c36b97a6be6dbfc475c58dce1d3859f725ab84e85fff2b477999c5ff081e5a75: schema.q:3:3: items.n",
    ]);
}

#[test]
fn provenance_flows_through_helpers_shapes_aliases_sums_and_jobs() {
    let prefix = INCREMENT.split("mutation create").next().unwrap();
    for (name, suffix) in [
        ("alias", "mutation like(postId: posts):\n  p = posts[id = postId] ! else NOT_FOUND\n  score = p.score + 1\n  value = { score, unrelated: postId }\n  update posts[id = p.id] { score: value.score }\n"),
        ("helper", "fn bump(p: posts):\n  return { score: p.score + 1 }\nmutation like(postId: posts):\n  p = posts[id = postId] ! else NOT_FOUND\n  value = bump(p)\n  update posts[id = p.id] { score: value.score }\n"),
        ("shape", "shape projection = { score: .score + 1 }\nmutation like(postId: posts):\n  p = posts[id = postId] ! else NOT_FOUND\n  value = p projection\n  update posts[id = p.id] { score: value.score }\n"),
        ("count", "mutation like(postId: posts):\n  update posts[id = postId] { score: count(posts[] first 5 by byId) }\n"),
        ("sum", "mutation like(postId: posts):\n  update posts[id = postId] { score: sum(posts[] first 5 by byId, .score) }\n"),
        ("group", "mutation like(postId: posts):\n  g = first(group(posts[] first 5 by byId, 'score')) ! else EMPTY\n  update posts[id = postId] { score: count(g.items) }\n"),
        ("job prelude", "job refresh():\n  total = count(posts[] first 5 by byId)\n  chunk p in posts first 5 by byId:\n    update posts[id = p.id] { score: total }\n"),
        ("uninvoked helper", "fn refresh(postId: posts):\n  p = posts[id = postId] ! else NOT_FOUND\n  update posts[id = p.id] { score: p.score + 1 }\n  return null\n"),
    ] {
        let source = format!("{prefix}{suffix}");
        let bound = compile(&[("schema.q".into(), source)]);
        assert!(bound.diagnostics.is_empty(), "{name}: {:?}", bound.diagnostics);
        assert_eq!(copies(&bound).len(), 1, "{name}: {:?}", bound.notes);
    }
}

#[test]
fn argument_or_ambient_writer_disqualifies_across_the_catalog() {
    for (name, writer) in [
        ("argument alias", "mutation choose(postId: posts, amount: int):\n  alias = amount\n  update posts[id = postId] { score: alias }\n"),
        ("argument arithmetic", "mutation choose(postId: posts, amount: int):\n  p = posts[id = postId] ! else NOT_FOUND\n  update posts[id = postId] { score: p.score + amount }\n"),
        ("helper argument", "fn identity(value: int): value\nmutation choose(postId: posts, amount: int):\n  update posts[id = postId] { score: identity(amount) }\n"),
        ("helper writer", "fn save(postId: posts, value: int):\n  update posts[id = postId] { score: value }\n  return null\nmutation choose(postId: posts, amount: int):\n  save(postId, amount)\n"),
        ("shape argument", "mutation choose(postId: posts, amount: int):\n  p = posts[id = postId] ! else NOT_FOUND\n  s = p { score: amount }\n  update posts[id = postId] { score: s.score }\n"),
        ("literal update", "mutation choose(postId: posts):\n  update posts[id = postId] { score: 0 }\n"),
        ("literal upsert", "mutation choose(postId: posts):\n  upsert posts[id = postId] { score: 0 }\n"),
        ("job argument", "job choose(amount: int):\n  chunk p in posts first 5 by byId:\n    update posts[id = p.id] { score: amount }\n"),
        ("write result argument", "mutation choose(amount: int):\n  p = insert posts { score: amount }\n  update posts[id = p.id] { score: p.score + 1 }\n"),
    ] {
        let bound = compile(&[("schema.q".into(), INCREMENT.into()), ("other.q".into(), writer.into())]);
        assert!(bound.diagnostics.is_empty(), "{name}: {:?}", bound.diagnostics);
        assert!(copies(&bound).is_empty(), "{name}: {:?}", bound.notes);
    }
}

#[test]
fn ordinals_receipts_ambient_edits_and_denied_jobs_are_silent() {
    let source = r#"table messages:
  ordinal: int
  readOrdinal: int
  editedAt: time
  done: bool
  lastSeen: time
  principal: principal
  immutable ordinal
  public 'messages'
  insert <- .principal = viewer
  update <- .principal = viewer
mutation send():
  last = first(messages[] last 1 by byId)
  insert messages { ordinal: (last.ordinal ?? 0) + 1, readOrdinal: 0, editedAt: now, done: true, lastSeen: now, principal: viewer }
mutation mark(id: messages):
  p = messages[id] ! else NOT_FOUND
  update messages[id] { readOrdinal: p.readOrdinal + 1, editedAt: now, done: true, lastSeen: now }
"#;
    for source in [source.to_owned(), INCREMENT.replace("insert <- allow", "insert <- deny").replace("update <- allow", "update <- deny").replace("mutation like(postId: posts):\n  p = posts[id = postId] ! else NOT_FOUND\n  update posts[id = p.id] { score: p.score + 1 }", "job like():\n  chunk p in posts first 5 by byId:\n    update posts[id = p.id] { score: p.score + 1 }")] {
        let bound = compile(&[("schema.q".into(), source)]);
        assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
        assert!(copies(&bound).is_empty(), "{:?}", bound.notes);
    }
    // With unrestricted authority, ambient-only fields still have no read evidence;
    // the ordinal remains immutable and a caller supplies the receipt ordinal.
    let public = source.replace(".principal = viewer", "allow")
        .replace("mutation mark(id: messages):", "mutation mark(id: messages, ordinal: int):")
        .replace("readOrdinal: p.readOrdinal + 1", "readOrdinal: max(p.readOrdinal, ordinal)");
    assert!(copies(&compile(&[("schema.q".into(), public)])).is_empty());
}

#[test]
fn literal_birth_defaults_and_instantiated_helpers_preserve_the_column_proof() {
    for source in [
        INCREMENT.replace("score: int", "score: int default 0").replace("insert posts { score: 0 }", "insert posts {}"),
        INCREMENT.replace("update posts[id = p.id] { score: p.score + 1 }", "(value, rest) = divmod(p.score, 2)\n  update posts[id = p.id] { score: value + rest }"),
        INCREMENT.replace("update posts[id = p.id] { score: p.score + 1 }", "score = 0\n  for row in posts[] first 5 by byId:\n    score = score + row.score\n  update posts[id = p.id] { score }"),
        format!("fn save(postId: posts, score: int):\n  update posts[id = postId] {{ score }}\n  return null\n{}", INCREMENT.replace("update posts[id = p.id] { score: p.score + 1 }", "save(p.id, p.score + 1)")),
    ] {
        let bound = bind(&source);
        assert_eq!(copies(&bound).len(), 1, "{source}\n{:?}", bound.notes);
    }
    let helper = format!("fn save(postId: posts, score: int):\n  update posts[id = postId] {{ score }}\n  return null\n{}\nmutation choose(postId: posts, score: int):\n  save(postId, score)\n", INCREMENT.replace("update posts[id = p.id] { score: p.score + 1 }", "save(p.id, p.score + 1)"));
    assert!(copies(&bind(&helper)).is_empty());
    let source = format!("{INCREMENT}\nmutation presence(postId: posts):\n  update posts[id = postId] {{ score: connected[viewer] }}\n");
    assert!(copies(&bind(&source)).is_empty());
    let presence = INCREMENT.replace("update posts[id = p.id] { score: p.score + 1 }", "n = 0\n  if exists connected[viewer]:\n    n = 1\n  update posts[id = p.id] { score: n }");
    assert!(copies(&bind(&presence)).is_empty());
}

#[test]
fn a_named_upsert_key_is_a_written_value_on_insert() {
    let source = INCREMENT.replace("  score: int", "  score: int\n  unique byScore: score") + "mutation choose(score: int):\n  upsert posts[score = score] {}\n";
    assert!(copies(&bind(&source)).is_empty());
}

#[test]
fn published_pinning_rule_accepts_zero_and_true_count_and_refuses_forgery() {
    use snapback4_core::{Context, Engine, Value, WriteState};
    let source = guide::quarry(guide::card("feeds").unwrap()).into_iter().find(|block| block.contains("table ranked:") && block.contains("update (old, next) <- exists likeCounts")).unwrap();
    let source = format!("{source}\nmutation setScore(postId: posts, score: int):\n  upsert ranked[postId = postId] {{ postId, score }}\nmutation like(postId: posts):\n  insert likes {{ postId, principal: viewer }} if absent\n");
    let bound = bind(&source);
    assert!(bound.notes.is_empty(), "{:?}", bound.notes);
    let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    engine.seed([("posts".into(), snapback4_core::value::object([("id", Value::Id("p".into())), ("author", Value::Id("alice".into()))]))]).unwrap();
    for (index, (score, valid)) in [(999, false), (0, true), (999, false), (1, true)].into_iter().enumerate() {
        if index == 3 {
            let context = Context::new("alice", [("postId".into(), Value::Id("p".into()))].into()).with_ids(["like".into()]);
            assert!(matches!(engine.mutate("like", None, context).unwrap().state, WriteState::Sent { .. }));
        }
        let context = Context::new("alice", [("postId".into(), Value::Id("p".into())), ("score".into(), Value::Int(score))].into()).with_ids([format!("rank{index}")]);
        let state = engine.mutate("setScore", None, context).unwrap().state;
        if valid { assert!(matches!(state, WriteState::Sent { .. }), "{state:?}"); }
        else {
            let expected = if index == 0 { "NOT_FOUND" } else { "E_RULE" };
            assert!(matches!(state, WriteState::Failed { ref why, .. } if why.code == expected), "{state:?}");
        }
    }
}

#[test]
fn a_native_writer_makes_the_all_writers_proof_unknown() {
    assert!(copies(&bind(&format!("{INCREMENT}\njob rebuild(): native\n"))).is_empty());
    assert_eq!(copies(&bind(&format!("{INCREMENT}\nquery nativeRead(): native\n"))).len(), 1);
}

#[test]
fn l26_statement_constants_and_read_loop_counts_choose_deltas_without_supplying_data() {
    for body in [
        "delta = 0\n  if choice:\n    delta = 1\n  else:\n    delta = 2\n  update posts[id = p.id] { score: p.score + delta }",
        "delta = 0\n  for i in range(0, p.score):\n    delta = delta + 1\n  update posts[id = p.id] { score: p.score + delta }",
        "delta = 0\n  for row in posts[] first 5 by byId:\n    if choice:\n      break\n    delta = delta + row.score\n  update posts[id = p.id] { score: p.score + delta }",
    ] {
        let source = INCREMENT.replace("mutation like(postId: posts):", "mutation like(postId: posts, choice: bool, amount: int):")
            .replace("update posts[id = p.id] { score: p.score + 1 }", body);
        assert_eq!(copies(&bind(&source)).len(), 1, "{source}");
    }
    let source = format!("fn choose(amount: int):\n  for i in range(0, amount):\n    return 1\n  return 2\n{}", INCREMENT.replace("mutation like(postId: posts):", "mutation like(postId: posts, amount: int):")
        .replace("p.score + 1", "p.score + choose(amount)"));
    assert_eq!(copies(&bind(&source)).len(), 1, "{source}");
}

#[test]
fn loop_carried_recursive_shapes_have_a_finite_provenance() {
    let source = format!("{INCREMENT}\nfn wrap(previous: json <=100000 ?, payload: json <=100000):\n  return {{ previous, payload }}\nquery wrapped():\n  page = posts[] first 1 by byId\n  wrapped = null\n  for i in range(0, 1):\n    wrapped = wrap(wrapped, page)\n  return wrapped\n");
    let (send, receive) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let bound = bind(&source);
        send.send(copies(&bound).len()).unwrap();
    });
    assert_eq!(receive.recv_timeout(std::time::Duration::from_secs(5)).expect("a finite program must not grow its abstract object shape forever"), 1);
}

#[test]
fn malformed_helper_calls_never_panic_or_supply_read_evidence() {
    let mut panicked = Vec::new();
    for call in ["at()", "at([1])", "slice()", "slice([1])", "slice([1], 0)", "group()", "group([1])"] {
        for called in [false, true] {
            let source = format!("fn unused(): {call}\nquery ok():\n  return {}\n", if called { "unused()" } else { "0" });
            match std::panic::catch_unwind(|| compile(&[("schema.q".into(), source)])) {
                Ok(bound) => {
                    assert_eq!(bound.diagnostics.is_empty(), !called, "{call}, called={called}: {:?}", bound.diagnostics);
                    assert!(copies(&bound).is_empty(), "{call}, called={called}: {:?}", bound.notes);
                }
                Err(_) => panicked.push((call, called)),
            }
        }
    }
    assert!(panicked.is_empty(), "malformed calls panicked: {panicked:?}");
    for value in ["at(p.score)", "slice(p.score)", "group(p.score)", "first(p.score, 0)", "count(p.score, 0)", "unknown(p.score)", "identity(p.score, 0)",
        "(first(sort([p], postId)) ! else EMPTY).score", "count((first(group([p], postId)) ! else EMPTY).items)"] {
        let source = INCREMENT.replace("mutation like(postId: posts):", "fn like(postId: posts):")
            .replace("p.score + 1", value) + "  return null\nfn identity(value: int): value\nquery ok():\n  return 0\n";
        assert!(copies(&bind(&source)).is_empty(), "{value} must remain unknown");
    }
    let source = format!("{INCREMENT}\nfn unused(postId: posts, amount: int):\n  return at(update posts[id = postId] {{ score: amount }})\n");
    assert!(copies(&bind(&source)).is_empty(), "a malformed call must still visit writes in its arguments");
    assert_eq!(copies(&bind(INCREMENT)).len(), 1);
}

fn bounded_provenance(label: &str, source: String, expected: usize) {
    bounded_analysis(label, move || copies(&bind(&source)).len(), expected);
}

fn bounded_analysis(label: &str, check: impl FnOnce() -> usize + Send + 'static, expected: usize) {
    let budget = std::env::var("SNAPBACK4_PROVENANCE_TEST_MS").map(|ms| ms.parse().unwrap()).unwrap_or(5000);
    let (send, receive) = std::sync::mpsc::channel();
    let start = std::time::Instant::now();
    std::thread::spawn(move || {
        let _ = send.send(check());
    });
    let result = receive.recv_timeout(std::time::Duration::from_millis(budget));
    println!("{label}: {:.3} ms, budget {budget} ms, {result:?}", start.elapsed().as_secs_f64() * 1000.0);
    assert_eq!(result.expect("provenance analysis exceeded its wall-clock budget"), expected);
}

#[test]
fn provenance_joins_thirty_nested_fields_with_an_unrelated_branch() {
    let object = format!("{}0{}", "{ a: ".repeat(30), " }".repeat(30));
    bounded_provenance("30 nested fields", format!("query nested(flag: bool):\n  x = {object}\n  if flag:\n    ignored = 1\n  return x\n"), 0);
    bounded_provenance("30 nested fields, assigned on one arm", format!("query nested(flag: bool):\n  x = {object}\n  if flag:\n    x = x\n  return x\n"), 0);
}

#[test]
fn provenance_scales_with_two_thousand_bindings_and_sibling_branches() {
    let mut source = String::from("query siblings(flag: bool):\n");
    for i in 0..2000 { source.push_str(&format!("  x{i} = 0\n")); }
    for i in 0..2000 { source.push_str(&format!("  if flag:\n    x{i} = 1\n")); }
    source.push_str("  return x1999\n");
    // Time parsing, catalog/schema construction and the note pass, excluding
    // ordinary binding's unrelated per-branch type-environment copies.
    bounded_analysis("2000 bindings + 2000 sibling ifs", move || {
        let (catalog, schema) = catalog_schema(&source);
        provenance::notes(&catalog, &schema).len()
    }, 0);
}

#[test]
fn repeated_helper_provenance_is_cached_without_losing_writes() {
    // Uncalled helpers belong to the census, without the ordinary binder's
    // per-call inlining cost hiding the cost of the provenance pass itself.
    let mut source = String::from("fn expensive(value: int):\n");
    for i in 0..2000 { source.push_str(&format!("  x{i} = value\n")); }
    source.push_str("  update posts[new] { score: value }\n  return value\nfn callers():\n");
    for _ in 0..2000 { source.push_str("  expensive(1)\n"); }
    source.push_str("  return null\n");
    source.push_str(INCREMENT);
    bounded_provenance("2000 calls to a 2000-binding helper", source, 0);
    let source = format!("fn save(postId: posts, score: int):\n  update posts[id = postId] {{ score }}\n  return score\n{}\nmutation chosen(postId: posts, score: int):\n  save(postId, score)\n", INCREMENT.replace("update posts[id = p.id] { score: p.score + 1 }", "save(p.id, p.score + 1)"));
    assert!(copies(&bind(&source)).is_empty(), "the cache must distinguish read and argument provenance");
}

#[test]
fn l26_slice_positions_choose_ambient_deltas_without_supplying_data() {
    for selection in [
        "delta = first(slice([1, -1], offset, offset + 1)) ! else BAD_OFFSET",
        "selected = first(slice([{ nested: { delta: 1 } }, { nested: { delta: -1 } }], offset, offset + 1)) ! else BAD_OFFSET\n  delta = selected.nested.delta",
        "selected = first(slice([[1], [-1]], offset, offset + 1)) ! else BAD_OFFSET\n  delta = first(selected) ! else EMPTY",
    ] {
        let source = INCREMENT.replace("mutation like(postId: posts):", "mutation like(postId: posts, offset: int):")
            .replace("update posts[id = p.id] { score: p.score + 1 }", &format!("{selection}\n  update posts[id = p.id] {{ score: p.score + delta }}"));
        let bound = bind(&source);
        for note in copies(&bound) { println!("{note}"); }
        assert_eq!(copies(&bound).len(), 1, "{source}");
    }
    let source = INCREMENT.replace("p.score + 1", "p.score + (first(slice([1, -1], 0, 1)) ! else EMPTY)");
    assert_eq!(copies(&bind(&source)).len(), 1, "constant bounds still qualify");
}

#[test]
fn a_loop_carried_table_row_count_is_derived() {
    let source = INCREMENT.replace("update posts[id = p.id] { score: p.score + 1 }",
        "total = 0\n  for row in posts[] first 5 by byId:\n    total = total + 1\n  update posts[id = postId] { score: total }");
    let bound = bind(&source);
    let notes = copies(&bound);
    assert_eq!(notes.len(), 1, "{:?}", bound.notes);
    println!("{}", notes[0]);
    let ambient = source.replace("for row in posts[] first 5 by byId:", "for row in range(0, 5):");
    assert!(copies(&bind(&ambient)).is_empty(), "an ambient count has no read evidence");
}

#[test]
fn l26_break_chooses_how_many_read_values_are_summed() {
    for exit in ["if choice:\n      break", "if row.score > 0:\n      if choice:\n        break"] {
        let source = INCREMENT.replace("mutation like(postId: posts):", "mutation like(postId: posts, choice: bool):")
            .replace("update posts[id = p.id] { score: p.score + 1 }", &format!("delta = 0\n  for row in posts[] first 5 by byId:\n    delta = delta + row.score\n    {exit}\n  update posts[id = p.id] {{ score: p.score + delta }}"));
        let bound = bind(&source);
        for note in copies(&bound) { println!("{note}"); }
        assert_eq!(copies(&bound).len(), 1, "{source}");
        assert_eq!(copies(&bind(&source.replace("if choice:", "if row.score > 1:"))).len(), 1, "a read-dependent break still qualifies");
    }
}

#[test]
fn append_only_derived_insertions_are_silent() {
    for source in [
        "table log:\n  n: int\n  public 'log'\n  insert <- allow\nmutation append():\n  last = first(log[] last 1 by byId)\n  insert log { n: (last.n ?? 0) + 1 }\n".to_owned(),
        format!("{}table log:\n  n: int\n  public 'log'\n  insert <- allow\nmutation append(postId: posts):\n  p = posts[id = postId] ! else MISSING\n  insert log {{ n: p.score }}\n", INCREMENT.split("mutation create").next().unwrap()),
    ] {
        assert_eq!(copies(&bind(&source)).len(), 1, "the insertion otherwise qualifies");
        let (catalog, mut schema) = catalog_schema(&source);
        // AppendOnly is an existing IR constraint with no Quarry spelling.
        // Attach it here; admitting a new declaration is outside this lane.
        schema.tables.get_mut("log").unwrap().constraints.push(snapback4_core::schema::Constraint::AppendOnly);
        assert!(provenance::notes(&catalog, &schema).is_empty(), "{source}");
    }
}

#[test]
fn a_public_write_of_a_widened_recursive_value_is_silent() {
    let prefix = INCREMENT.split("mutation create").next().unwrap();
    let source = format!("{prefix}table snapshots:\n  payload: json <=100000 ?\n  public 'snapshots'\n  insert <- allow\nfn wrap(previous: json <=100000 ?, payload: json <=100000):\n  return {{ previous, payload }}\nmutation snapshot():\n  page = posts[] first 1 by byId\n  wrapped = null\n  for i in range(0, 1):\n    wrapped = wrap(wrapped, page)\n  insert snapshots {{ payload: wrapped }}\n");
    bounded_provenance("public widened recursive write", source.clone(), 0);
    let read = source.replace("payload: wrapped", "payload: page");
    assert_eq!(copies(&bind(&read)).len(), 1, "a known read-derived payload still qualifies");
}

#[test]
fn l26_statement_helper_and_loop_control_choose_read_derived_writes() {
    let mut failures = Vec::new();
    for (label, helpers, body) in [
        ("statement", "", "if choice:\n    update posts[id = p.id] { score: p.score + 1 }\n  else:\n    update posts[id = p.id] { score: p.score - 1 }"),
        ("helper cache", "fn save(postId: posts, score: int):\n  update posts[id = postId] { score }\n  return score\n", "save(p.id, p.score + 1)\n  if choice:\n    save(p.id, p.score + 1)\n  else:\n    save(p.id, p.score - 1)"),
        ("loop branch", "", "for row in posts[] first 5 by byId:\n    if choice:\n      update posts[row.id] { score: row.score + 1 }"),
        ("loop count", "", "for i in range(0, offset):\n    update posts[id = p.id] { score: p.score + 1 }"),
        ("break after write", "", "for row in posts[] first 5 by byId:\n    update posts[row.id] { score: row.score + 1 }\n    if choice:\n      break"),
        ("cached helper before break", "fn save(postId: posts, score: int):\n  update posts[id = postId] { score }\n  return score\n", "for row in posts[] first 5 by byId:\n    save(row.id, row.score + 1)\n  for row in posts[] first 5 by byId:\n    save(row.id, row.score + 1)\n    if choice:\n      break"),
        ("expression helper", "fn save(postId: posts, score: int):\n  update posts[id = postId] { score }\n  return score\n", "value = save(p.id, p.score + 1) if choice else save(p.id, p.score - 1)"),
        ("short circuit", "fn save(postId: posts, score: int):\n  update posts[id = postId] { score }\n  return true\n", "value = choice or save(p.id, p.score + 1)"),
        ("guarded return helper", "fn save(postId: posts, score: int):\n  update posts[id = postId] { score }\n  return null\n", "if choice:\n    return save(p.id, p.score + 1)\n  return save(p.id, p.score - 1)"),
    ] {
        let source = format!("{helpers}{}", INCREMENT.replace("mutation like(postId: posts):", "mutation like(postId: posts, choice: bool, offset: int):")
            .replace("update posts[id = p.id] { score: p.score + 1 }", body));
        let bound = bind(&source);
        for note in copies(&bound) { println!("{label}: {note}"); }
        if copies(&bound).len() != 1 { failures.push(label); }
        let positive = source.replace("if choice:", "if p.score > 0:").replace("if choice else", "if p.score > 0 else").replace("range(0, offset)", "range(0, p.score)").replace("choice or", "p.score > 0 or");
        assert_eq!(copies(&bind(&positive)).len(), 1, "read control: {label}");
    }
    assert!(failures.is_empty(), "read-derived choice was silenced: {failures:?}");
}

#[test]
fn review_control_does_not_turn_ambient_writes_into_read_evidence() {
    for body in [
        "if p.score > 0:\n    update posts[id = p.id] { score: 1 }",
        "for row in posts[] first 5 by byId:\n    update posts[row.id] { score: 1 }",
        "for row in posts[] first 5 by byId:\n    update posts[row.id] { score: 1 }\n    if row.score > 0:\n      break",
    ] {
        let source = INCREMENT.replace("update posts[id = p.id] { score: p.score + 1 }", body);
        assert!(copies(&bind(&source)).is_empty(), "{source}");
        assert_eq!(copies(&bind(&source.replace("{ score: 1 }", "{ score: p.score + 1 }"))).len(), 1);
    }
    let guarded = INCREMENT.replace("mutation like(postId: posts):", "mutation like(postId: posts, choice: bool):")
        .replace("update posts[id = p.id] { score: p.score + 1 }", "if choice:\n    return null\n  update posts[id = p.id] { score: p.score + 1 }");
    assert_eq!(copies(&bind(&guarded)).len(), 1, "a no-write early return only guards the remaining write");
    let initialized = INCREMENT.replace("mutation create():\n  return insert posts { score: 0 }", "mutation create(choice: bool):\n  if choice:\n    insert posts { score: 0 }");
    assert_eq!(copies(&bind(&initialized)).len(), 1, "a literal birth value remains initialization under control");
}

#[test]
fn l26_sort_and_group_keys_choose_elements_without_supplying_their_fields() {
    let mut failures = Vec::new();
    for selection in [
        "(first(sort(choices, 'key')) ! else EMPTY).delta",
        "(last(sort(choices, '-key')) ! else EMPTY).delta",
        "(at(sort(choices, 'key'), 0) ! else EMPTY).delta",
        "(first(sort(choices, '-key')) ! else EMPTY).nested.delta",
        "(first(sort(choices, 'delta', '-key')) ! else EMPTY).nested.delta",
        "(last((first(group(choices, 'key')) ! else EMPTY).items) ! else EMPTY).delta",
        "count(group(choices, 'key'))",
        "sum(group(choices, 'key'), 1)",
    ] {
        let body = format!("choices = [{{ key: offset, delta: 1, nested: {{ delta: 1 }} }}, {{ key: 0, delta: -1, nested: {{ delta: -1 }} }}]\n  delta = {selection}\n  update posts[id = p.id] {{ score: p.score + delta }}");
        let source = INCREMENT.replace("mutation like(postId: posts):", "mutation like(postId: posts, offset: int):")
            .replace("update posts[id = p.id] { score: p.score + 1 }", &body);
        let bound = bind(&source);
        for note in copies(&bound) { println!("{selection}: {note}"); }
        if copies(&bound).len() != 1 { failures.push(selection); }
        assert_eq!(copies(&bind(&source.replace("key: offset", "key: p.score"))).len(), 1, "read key: {selection}");
    }
    assert!(failures.is_empty(), "selection was mistaken for supplied data: {failures:?}");
}

#[test]
fn review_scalar_selection_and_projection_keep_dependence() {
    for expression in ["min(offset, p.score)", "max(p.score, offset)", "(offset ?? p.score)"] {
        let source = INCREMENT.replace("mutation like(postId: posts):", "mutation like(postId: posts, offset: int):").replace("p.score + 1", expression);
        assert!(copies(&bind(&source)).is_empty(), "{expression}");
        assert_eq!(copies(&bind(&source.replace(expression, &expression.replace("offset", "p.score")))).len(), 1);
    }
    for pair in ["sorted", "divmod"] {
        let source = INCREMENT.replace("mutation like(postId: posts):", "mutation like(postId: posts, offset: int):")
            .replace("update posts[id = p.id] { score: p.score + 1 }", &format!("(left, right) = {pair}(offset, p.score)\n  update posts[id = p.id] {{ score: left + right }}"));
        assert!(copies(&bind(&source)).is_empty());
    }
    let source = INCREMENT.replace("mutation like(postId: posts):", "mutation like(postId: posts, offset: int):")
        .replace("p.score + 1", "({ unrelated: offset, value: p.score }).value");
    assert_eq!(copies(&bind(&source)).len(), 1, "an unrelated object field is not a selection key");
}

#[test]
fn review_unknown_forms_stay_silent() {
    let mut failures = Vec::new();
    for expression in ["p.score + missing[postId]", "p.score + (1 if created posts[id = postId] else -1)"] {
        let source = INCREMENT.replace("mutation like(postId: posts):", "fn like(postId: posts):").replace("p.score + 1", expression) + "  return null\n";
        let bound = bind(&source);
        for note in copies(&bound) { println!("{expression}: {note}"); }
        if !copies(&bound).is_empty() { failures.push(expression); }
    }
    assert!(failures.is_empty(), "lost unknown/selection: {failures:?}");
    assert_eq!(copies(&bind(INCREMENT)).len(), 1);
}

#[test]
fn review_thirty_branching_unused_helper_is_bounded() { branching_bindings(false); }

#[test]
fn review_thirty_branching_called_helper_is_bounded() { branching_bindings(true); }

fn branching_bindings(used: bool) {
    let mut source = String::from("fn grow():\n  x0 = 0\n");
    for i in 1..=30 { source.push_str(&format!("  x{i} = {{ a: x{}, b: x{} }}\n", i - 1, i - 1)); }
    source.push_str(&format!("  return 0\nquery ok():\n  return {}\n", if used { "grow()" } else { "0" }));
    let compiled = source.clone();
    // Isolate the exact note-pass input from ordinary binding's independent
    // structural-type expansion; the unused helper also goes through compile().
    bounded_analysis(&format!("30 branching bindings, used={used}"), move || {
        let (catalog, schema) = catalog_schema(&source);
        let (notes, (peak, work, widened)) = provenance::measured_notes(&catalog, &schema);
        println!("used={used}: peak {peak} expanded nodes/value, {work} work units, {widened} widenings");
        assert!(peak <= 4096 && work <= 262_144 && widened > 0);
        notes.len()
    }, 0);
    if !used { bounded_provenance("30 branching bindings, unused helper full compile", compiled, 0); }
}

#[test]
fn review_expansion_and_total_budget_abandon_read_proofs() {
    let prefix = "table snapshots:\n  payload: json <=100000\n  public 'snapshots'\n  insert <- allow\n";
    let mut body = String::from("  x0 = posts[] first 1 by byId\n");
    for i in 1..=30 { body.push_str(&format!("  x{i} = {{ a: x{}, b: x{} }}\n", i - 1, i - 1)); }
    for written in ["x30", "x30.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a", "x11 { payload: posts[] first 1 by byId }"] {
        let source = format!("{}{prefix}fn grow():\n{body}  insert snapshots {{ payload: {written} }}\n  return 0\n", INCREMENT.split("mutation create").next().unwrap());
        let (catalog, schema) = catalog_schema(&source);
        let (notes, stats) = provenance::measured_notes(&catalog, &schema);
        println!("widened write {written}: {stats:?}");
        assert!(notes.is_empty(), "{written}: {notes:?}");
    }
    let mut expensive = String::from("fn noise():\n  x0 = 0\n");
    for i in 1..=11 { expensive.push_str(&format!("  x{i} = {{ a: x{}, b: x{} }}\n", i - 1, i - 1)); }
    for i in 0..100 { expensive.push_str(&format!("  y{i} = x11 if true else x11\n")); }
    expensive.push_str("  return 0\n");
    let source = format!("{INCREMENT}{expensive}");
    let (catalog, schema) = catalog_schema(&source);
    let (notes, (peak, work, widened)) = provenance::measured_notes(&catalog, &schema);
    println!("total budget: peak {peak}, work {work}, widenings {widened}");
    assert!(notes.is_empty() && work <= 262_144 && widened > 0);
    assert_eq!(copies(&bind(INCREMENT)).len(), 1, "the same catalog without exhausted analysis qualifies");
}

#[test]
fn l26_optional_shape_presence_selects_a_read_derived_field() {
    for projection in ["{ delta: p.score }", "choiceShape"] {
        let source = format!("shape choiceShape = {{ delta: posts[id = postId].score }}\n{}", INCREMENT.replace("mutation like(postId: posts):", "mutation like(postId: posts, choice: bool):")
            .replace("update posts[id = p.id] { score: p.score + 1 }", &format!("selected = ({{ a: 0 }} if choice else null) {projection}\n  update posts[id = p.id] {{ score: selected.delta ?? 0 }}")));
        let bound = bind(&source);
        for note in copies(&bound) { println!("{projection}: {note}"); }
        assert_eq!(copies(&bound).len(), 1, "{projection}: caller chooses presence, not field data");
    }
}

#[test]
fn l26_conditional_delta_is_control_and_toggle_message_names_both_arms() {
    let expression = INCREMENT.replace("mutation like(postId: posts):", "mutation like(postId: posts, value: bool):")
        .replace("p.score + 1", "p.score + (1 if value else -1)");
    let bound = bind(&expression);
    let notes = copies(&bound);
    assert_eq!(notes.len(), 1);
    assert!(notes[0].message.contains("`p.score + (1 if value else -1)`, chosen by `value` in `like`"), "{}", notes[0]);
    println!("expression: {}", notes[0]);
    let source = INCREMENT.replace("mutation like(postId: posts):", "mutation setLike(postId: posts, liked: bool):")
        .replace("update posts[id = p.id] { score: p.score + 1 }", "if liked:\n    update posts[id = p.id] { score: p.score + 1 }\n  else:\n    update posts[id = p.id] { score: p.score - 1 }");
    let bound = bind(&source);
    let notes = copies(&bound);
    assert_eq!(notes.len(), 1);
    assert_eq!(notes[0].message, "every write to posts.score is computed from reads (`p.score + 1` or `p.score - 1`, chosen by `liked` in `setLike`); `insert <- allow` and `update <- allow` let any principal run any mutation that writes it");
    println!("statement: {}", notes[0]);
}

#[test]
fn l26_control_alone_does_not_manufacture_read_data() {
    for body in [
        "delta = 1 if p.score > 0 else -1\n  update posts[id = p.id] { score: delta }",
        "for row in posts[] first 5 by byId:\n    delta = 0\n    delta = delta + 1\n    update posts[id = p.id] { score: delta }",
        "choices = [{ key: p.score, delta: 1 }, { key: 0, delta: -1 }]\n  update posts[id = p.id] { score: (first(sort(choices, 'key')) ! else EMPTY).delta }",
    ] {
        let source = INCREMENT.replace("update posts[id = p.id] { score: p.score + 1 }", body);
        assert!(copies(&bind(&source)).is_empty(), "{source}");
    }
}

#[test]
fn l26_selected_argument_fields_still_supply_data() {
    for expression in [
        "amount",
        "p.score + amount",
        "({ field: amount }).field",
        "(({ field: amount }) { copied: .field }).copied",
        "p.score + (first(sort([{ key: choice, delta: amount }, { key: false, delta: 1 }], 'key')) ! else EMPTY).delta",
        "p.score + (first(slice([amount, 1], 0, 1)) ! else EMPTY)",
        "p.score + (first(group([{ key: amount, delta: 1 }], 'key')) ! else EMPTY).key",
    ] {
        let source = INCREMENT.replace("mutation like(postId: posts):", "mutation like(postId: posts, amount: int, choice: bool):").replace("p.score + 1", expression);
        assert!(copies(&bind(&source)).is_empty(), "{expression}");
        assert_eq!(copies(&bind(&source.replace(&format!("score: {expression}"), &format!("score: {}", expression.replace("amount", "p.score"))))).len(), 1, "{expression}");
    }
}

#[test]
#[ignore = "L29: loops prefer silence"]
fn l26_a_constant_helper_called_in_a_read_loop_has_no_read_data() {
    let source = format!("fn constant():\n  x = 0\n  x = x + 1\n  return x\n{}", INCREMENT.replace("update posts[id = p.id] { score: p.score + 1 }",
        "delta = 0\n  for row in posts[] first 5 by byId:\n    delta = constant()\n  update posts[id = p.id] { score: delta }"));
    assert!(copies(&bind(&source)).is_empty());
    assert_eq!(copies(&bind(&source.replace("score: delta", "score: p.score + delta"))).len(), 1);
}

const UPSERT_ID: &str = r#"table source:
  n: int
  public 'source'
table scratch:
  n: int default 0
  public 'scratch'
  insert <- allow
  update <- allow
table copies:
  value: json <=1024
  public 'copies'
  insert <- allow
mutation copy(requestId: id):
  r = upsert scratch[id = requestId] {}
  require r != null else MISSING
  p = source['seed'] ! else MISSING
  insert copies { value: { requestId: r.id, n: p.n } }
"#;

#[test]
fn review_f12_upsert_id_keeps_argument_data_through_helpers_and_cache() {
    for source in [UPSERT_ID.to_owned(), UPSERT_ID.replace("scratch[id = requestId]", "scratch[requestId]"),
        format!("fn ensure(requestId: id):\n  return upsert scratch[id = requestId] {{}}\n{}", UPSERT_ID.replace(
            "r = upsert scratch[id = requestId] {}", "firstResult = ensure(requestId)\n  r = ensure(requestId)"))] {
        let bound = bind(&source);
        for note in copies(&bound) { println!("F12: {note}"); }
        assert!(copies(&bound).is_empty(), "the caller supplies the ID in the mixed object: {source}");
    }
}

#[test]
fn review_f12_read_and_minted_upsert_ids_keep_distinct_data() {
    let read_source = UPSERT_ID.replace("table source:\n", "table source:\n  requestId: id\n");
    let prefix = read_source.replace("  n: int default 0", "  n: int default 0\n  unique byN: n");
    for (key, expected_id_only) in [("id = (source['seed'] ! else MISSING).requestId", 1), ("n = 0", 0)] {
        let source = prefix.replace("id = requestId", key);
        let bound = bind(&source);
        assert_eq!(copies(&bound).len(), 1, "READ or AMBIENT ID plus p.n is derived: {key}");
        let id_only = bind(&source.replace(", n: p.n", ""));
        assert_eq!(copies(&id_only).len(), expected_id_only, "a minted ID alone has no READ data: {key}");
    }
    let positional = read_source.replace("id = requestId", "(source['seed'] ! else MISSING).requestId");
    assert_eq!(copies(&bind(&positional.replace(", n: p.n", ""))).len(), 1, "the sole positional index is byId");
    let ambiguous = prefix.replace("id = requestId", "(source['seed'] ! else MISSING).requestId");
    let (catalog, schema) = catalog_schema(&ambiguous);
    assert!(provenance::notes(&catalog, &schema).is_empty(), "unresolved positional candidates keep UNKNOWN");
}

#[test]
fn review_f13_different_conditions_of_the_same_arguments_name_both_arms() {
    for (args, yes, no, choice) in [
        ("set: bool", "set and not exists likes[postId, viewer]", "not set", "set"),
        ("set: bool, enabled: bool", "set and enabled and not exists likes[postId, viewer]", "enabled and not set", "enabled, set"),
    ] {
        let source = INCREMENT.replace("mutation like(postId: posts):", &format!("mutation like(postId: posts, {args}):"))
            .replace("update posts[id = p.id] { score: p.score + 1 }", &format!("if {yes}:\n    update posts[id = p.id] {{ score: p.score + 1 }}\n  else:\n    if {no}:\n      update posts[id = p.id] {{ score: max(0, p.score - 1) }}"))
            + "table likes:\n  postId: posts\n  principal: principal\n  unique byPair: postId, principal\n  public 'likes'\n";
        let bound = bind(&source);
        let notes = copies(&bound);
        assert_eq!(notes.len(), 1);
        println!("F13: {}", notes[0]);
        assert_eq!(notes[0].message, format!("every write to posts.score is computed from reads (`p.score + 1` or `max(0, p.score - 1)`, chosen by `{choice}` in `like`); `insert <- allow` and `update <- allow` let any principal run any mutation that writes it"));
    }
}

#[test]
fn review_f14_rewrite_only_offers_maintains_for_supported_value_types() {
    for ty in ["principal ?", "text <=40", "bool", "time", "json <=1024", "int", "decimal 2", "money USD 2"] {
        let source = format!("table source:\n  value: {ty}\n  public 'source'\ntable copies:\n  value: {ty}\n  public 'copies'\n  insert <- allow\nmutation copy():\n  p = source['seed'] ! else MISSING\n  insert copies {{ value: p.value }}\n");
        let bound = bind(&source);
        let notes = copies(&bound);
        assert_eq!(notes.len(), 1, "{ty}");
        println!("F14 {ty}: {}", notes[0]);
        if matches!(ty, "int" | "decimal 2" | "money USD 2") {
            assert!(notes[0].rewrite.starts_with("declare likeCount: count likes by postId"), "{ty}: {}", notes[0]);
        } else {
            assert_eq!(notes[0].rewrite, "pin copies.value to its source in both insert and update rules; see guide feeds for the rule", "{ty}");
        }
    }
    let why = guide::CODES.iter().find(|(code, _)| *code == CODE).unwrap().1;
    assert!(why.contains("An argument may choose which derived value is written; it may not supply the value itself or how many values contribute to it."), "{why}");
}

#[test]
#[ignore = "F15: helper-mediated carried increments do not yet receive READ cardinality evidence"]
fn review_f15_helper_increment_over_read_rows_should_supply_cardinality_evidence() {
    let source = format!("fn increment(n: int):\n  return n + 1\n{}", INCREMENT.replace("update posts[id = p.id] { score: p.score + 1 }",
        "total = 0\n  for row in posts[] first 5 by byId:\n    total = increment(total)\n  update posts[id = p.id] { score: total }"));
    assert_eq!(copies(&bind(&source.replace("total = increment(total)", "total = total + 1"))).len(), 1, "direct carried addition supplies READ cardinality evidence");
    assert_eq!(copies(&bind(&source)).len(), 1, "equivalent addition through a helper should also supply it");
}


fn cardinality_source(helpers: &str, body: &str) -> String {
    format!("{helpers}{}", INCREMENT.replace("mutation like(postId: posts):", "mutation like(postId: posts, xs: [int] <=10, amount: int, choice: bool):")
        .replace("update posts[id = p.id] { score: p.score + 1 }", body))
}

#[test]
fn review_f16_shaped_argument_cardinality_is_supplied_even_when_every_item_is_read() {
    let helpers = "shape mapped = { ignored: posts['seed'].score }\nfn identity(xs: [json <=1024] <=10): xs\nfn mappedCount(xs: [int] <=10, n: int):\n  mapped = xs { ignored: n }\n  return count(mapped)\n";
    let mut failures = Vec::new();
    for (label, value) in [
        ("direct count", "count(xs)"),
        ("inline shape", "count(xs { ignored: p.score })"),
        ("named shape", "count(xs mapped)"),
        ("projection sum", "sum(xs { ignored: p.score }, 1)"),
        ("read sum", "sum(xs { ignored: p.score }, .ignored)"),
        ("first", "(first(xs { ignored: p.score }) ! else EMPTY).ignored"),
        ("last", "(last(xs { ignored: p.score }) ! else EMPTY).ignored"),
        ("at", "(at(xs { ignored: p.score }, 0) ! else EMPTY).ignored"),
        ("slice sort", "count(sort(slice(xs { ignored: p.score }, 0, 1), 'ignored'))"),
        ("group", "count(group(xs { ignored: p.score }, 'ignored'))"),
        ("group items", "count((first(group(xs { ignored: p.score }, 'ignored')) ! else EMPTY).items)"),
        ("helper return", "count(identity(xs { ignored: p.score }))"),
        ("helper cache", "mappedCount(xs, p.score) + mappedCount(xs, p.score)"),
        ("conditional", "count((xs { ignored: p.score }) if choice else [{ ignored: p.score }])"),
        ("coalesce", "count((xs { ignored: p.score }) ?? [{ ignored: p.score }])"),
    ] {
        let source = cardinality_source(helpers, &format!("update posts[id = p.id] {{ score: {value} }}"));
        let bound = bind(&source);
        for note in copies(&bound) { println!("{label}: {note}"); }
        if !copies(&bound).is_empty() { failures.push(label); }
    }
    assert!(failures.is_empty(), "caller supplied cardinality: {failures:?}");
}

#[test]
fn review_f16_accumulations_consume_argument_read_and_literal_cardinality() {
    let mut failures = Vec::new();
    for (domain, expected) in [("range(0, amount)", 0), ("xs", 0), ("xs { ignored: p.score }", 0),
        ("range(0, p.score)", 1), ("posts[] first 5 by byId", 1), ("[1, -1]", 1)] {
        let body = format!("delta = 0\n  for i in {domain}:\n    delta = delta + 1\n  update posts[id = p.id] {{ score: p.score + delta }}");
        let bound = bind(&cardinality_source("", &body));
        for note in copies(&bound) { println!("{domain}: {note}"); }
        if copies(&bound).len() != expected { failures.push(domain); }
    }
    assert!(failures.is_empty(), "wrong accumulation cardinality: {failures:?}");
    let body = "delta = 0\n  for i in range(0, p.score):\n    delta = delta + 1\n  update posts[id = p.id] { score: delta }";
    assert_eq!(copies(&bind(&cardinality_source("", body))).len(), 1, "read range alone supplies READ");
}

#[test]
fn review_f16_read_and_literal_collections_keep_cardinality_separate_from_items() {
    for value in ["count(posts[] first 5 by byId)", "sum(posts[] first 5 by byId, .score)",
        "count((posts[] first 5 by byId) { ignored: amount })", "sum((posts[] first 5 by byId) { ignored: 1 }, 1)",
        "p.score + count([amount, amount])", "p.score + count([{ ignored: amount }])"] {
        assert_eq!(copies(&bind(&cardinality_source("", &format!("update posts[id = p.id] {{ score: {value} }}")))).len(), 1, "{value}");
    }
    for value in ["count([p.score])", "count([{ ignored: p.score }])", "sum((posts[] first 5 by byId) { ignored: amount }, .ignored)"] {
        assert!(copies(&bind(&cardinality_source("", &format!("update posts[id = p.id] {{ score: {value} }}")))).is_empty(), "{value}");
    }
    // A capped prefix is a collection even without an explicit first/last range.
    let source = SOURCE.replace("  unique byPair: postId, principal", "  unique byPair: postId, principal\n  cap 10 by postId")
        .replace("score: likeCounts[postId]", "score: count(likes[postId = postId])");
    assert_eq!(copies(&bind(&source)).len(), 1);
}

#[test]
fn review_f17_tokens_and_stored_lists_preserve_both_provenances() {
    let helpers = "fn size(xs: [json <=1024] <=10): count(xs)\n";
    for (base, expected) in [("tokens(text)", 0), ("tokens(p.body)", 1), ("p.numbers", 1)] {
        for projection in [format!("count({base} {{ ignored: p.score }})"), format!("sum({base}, p.score)")] {
            let source = cardinality_source(helpers, &format!("update posts[id = p.id] {{ score: {projection} }}"))
                .replace("score: int", "score: int\n  body: text <=100 default ''\n  numbers: [int] <=10")
                .replace("xs: [int] <=10", "text: text <=100, xs: [int] <=10")
                .replace("insert posts { score: 0 }", "insert posts { score: 0, numbers: [] }");
            assert_eq!(copies(&bind(&source)).len(), expected, "{base}: {projection}");
        }
    }
}

#[test]
fn review_f17_opaque_shapes_and_unmodelled_recurrences_stay_unknown() {
    for body in [
        "update posts[id = p.id] { score: count(raw { ignored: p.score }) }",
        "opaque = { ignored: p.score }\n  mixed = opaque if choice else xs\n  update posts[id = p.id] { score: count(mixed { ignored: p.score }) }",
        "delta = 0\n  for i in range(0, amount):\n    delta = increment(delta)\n  update posts[id = p.id] { score: p.score + delta }",
    ] {
        // The heterogeneous shape is an uncalled-helper audit case: ordinary
        // binding rejects it, but every catalog writer still needs a safe proof.
        let source = cardinality_source("fn increment(n: int): n + 1\n", body).replace("mutation like(", "fn like(")
            .replace("xs: [int] <=10", "raw: json <=1024, xs: [int] <=10") + "  return null\n";
        assert!(copies(&bind(&source)).is_empty(), "{source}");
    }
    assert_eq!(copies(&bind(&cardinality_source("", "update posts[id = p.id] { score: p.score + (1 if choice else 2) }"))).len(), 1);
}


#[test]
fn review_f16_exact_shaped_count_review_program_stays_silent() {
    let source = "table source:\n  n: int\n  public 'source'\ntable copies:\n  n: int\n  public 'copies'\n  insert <- allow\nmutation copy(xs: [int] <=10):\n  p = source['seed'] ! else MISSING\n  mapped = xs { ignored: p.n }\n  insert copies { n: count(mapped) }\n";
    let bound = bind(source);
    for note in copies(&bound) { println!("GPT counterexample: {note}"); }
    assert!(copies(&bound).is_empty());
    assert_eq!(copies(&bind(&source.replace("mapped = xs", "mapped = (source[] first 5 by byId)"))).len(), 1);
}

#[test]
fn review_f17_implicit_prefix_projection_is_unknown_until_its_collection_shape_is_known() {
    let implicit = SOURCE.replace("  unique byPair: postId, principal", "  unique byPair: postId, principal\n  cap 10 by postId")
        .replace("score: likeCounts[postId]", "score: count(likes[postId = postId] { ignored: likeCounts[postId] })");
    let explicit = implicit.replace("count(likes[postId = postId] {", "count((likes[postId = postId] first 10 by byPair) {");
    assert_eq!(copies(&bind(&implicit)).len(), 1, "a planned named scan has a known collection shape");
    assert_eq!(copies(&bind(&explicit)).len(), 1, "the same page with a known collection shape");
}

#[test]
fn review_f17_loop_recurrence_aliases_helpers_and_nonadditive_forms_stay_unknown() {
    for recurrence in ["delta = increment(delta)", "next = increment(delta)\n    delta = next",
        "next = delta + 1\n    delta = next", "delta = delta * 2", "(next, rest) = sorted(delta + 1, delta + 2)\n    delta = next",
        "next = delta + 1\n    if choice:\n      delta = next\n    else:\n      delta = next + 1"] {
        for domain in ["range(0, amount)", "posts[] first 5 by byId"] {
            let body = format!("delta = 1\n  for row in {domain}:\n    {recurrence}\n  update posts[id = p.id] {{ score: p.score + delta }}");
            assert!(copies(&bind(&cardinality_source("fn increment(n: int): n + 1\n", &body))).is_empty(), "{body}");
        }
    }
    let body = "delta = 0\n  for row in posts[] first 5 by byId:\n    delta = delta + 1\n  update posts[id = p.id] { score: delta }";
    assert_eq!(copies(&bind(&cardinality_source("", body))).len(), 1);
}

#[test]
fn review_f17_collection_choices_cache_keys_and_consumers_keep_cardinality() {
    let helper = "fn save(xs: [json <=1024] <=10):\n  update posts['seed'] { score: count(xs) }\n  return count(xs)\n";
    let body = "save((posts[] first 5 by byId) { ignored: p.score })\n  save(xs { ignored: p.score })";
    assert!(copies(&bind(&cardinality_source(helper, body))).is_empty(), "cache must distinguish equal item data with READ versus ARGUMENT cardinality");
    assert_eq!(copies(&bind(&cardinality_source(helper, &body.replace("save(xs {", "save((posts[] first 5 by byId) {")))).len(), 1);
    for selector in ["min", "max", "sorted"] {
        let body = if selector == "sorted" {
            "(left, right) = sorted(xs, [p.score])\n  update posts[id = p.id] { score: count(left { ignored: p.score }) }".to_owned()
        } else { format!("values = {selector}(xs, [p.score])\n  update posts[id = p.id] {{ score: count(values {{ ignored: p.score }}) }}") };
        assert!(copies(&bind(&cardinality_source("", &body))).is_empty(), "{selector}: caller collection length survives selection");
        assert_eq!(copies(&bind(&cardinality_source("", &body.replace("xs, [p.score]", "[p.score], [p.score]").replace("score: count(", "score: p.score + count(")))).len(), 1, "{selector}: a finite ambient cardinality choice");
    }
}

#[test]
fn review_f17_text_length_and_filter_cardinality_use_the_consumed_channel() {
    for (value, expected) in [("count(p.body)", 1), ("count(sha256(p.body))", 0), ("p.score + count(sha256(p.body))", 1),
        ("count(slice(p.body, amount, amount + 1))", 1), ("count(tokens(p.body))", 1), ("count(tokens(text))", 0)] {
        let source = cardinality_source("", &format!("update posts[id = p.id] {{ score: {value} }}"))
            .replace("score: int", "score: int\n  body: text <=100 default ''")
            .replace("xs: [int] <=10", "text: text <=100, xs: [int] <=10");
        assert_eq!(copies(&bind(&source)).len(), expected, "{value}");
    }
    for (predicate, expected) in [(".score > amount", 0), (".score > 0", 1)] {
        let body = format!("update posts[id = p.id] {{ score: count(posts[] first 5 by byId where {predicate}) }}");
        assert_eq!(copies(&bind(&cardinality_source("", &body))).len(), expected, "filter: {predicate}");
    }
}


#[test]
fn review_f17_appended_and_write_returned_lists_keep_cardinality() {
    for (domain, expected) in [("xs", 0), ("range(0, amount)", 0), ("posts[] first 5 by byId", 1), ("[1, -1]", 1)] {
        let body = format!("values = [p.score]\n  for row in {domain}:\n    values = values + [p.score]\n  update posts[id = p.id] {{ score: p.score + count(values {{ ignored: p.score }}) }}");
        assert_eq!(copies(&bind(&cardinality_source("", &body))).len(), expected, "append over {domain}");
    }
    for (input, expected) in [("xs", 0), ("[p.score]", 1)] {
        let schema = "table scratch:\n  values: [int] <=10\n  public 'scratch'\n  insert <- allow\n";
        let body = format!("written = insert scratch {{ values: {input} }}\n  update posts[id = p.id] {{ score: p.score + count(written.values {{ ignored: p.score }}) }}");
        let bound = bind(&cardinality_source(schema, &body));
        let hits = copies(&bound).into_iter().filter(|note| note.message.contains("posts.score ")).count();
        assert_eq!(hits, expected, "write result from {input}");
    }
}

#[test]
fn review_f19_conditional_reset_cannot_hide_argument_cardinality() {
    let source = "table posts:\n  score: int\n  public 'posts'\n  update <- allow\n\nmutation setScore(amount: int, reset: bool):\n  p = posts['seed'] ! else MISSING\n  delta = 0\n  for i in range(0, amount):\n    if reset:\n      delta = 0\n    delta = delta + 1\n  update posts[id = p.id] { score: p.score + delta }\n";
    let bound = bind(source);
    for note in copies(&bound) { println!("F19 conditional reset: {note}"); }
    assert!(copies(&bound).is_empty());
}

#[test]
fn review_f19_every_nested_assignment_consumes_argument_cardinality() {
    let mut failures = Vec::new();
    for (label, assignments) in [
        ("direct accumulation", "delta = delta + 1"),
        ("conditional reset", "if choice:\n      delta = 0\n    delta = delta + 1"),
        ("nested branch", "if choice:\n      if p.score > 0:\n        delta = 0\n    delta = delta + 1"),
        ("both arms reset", "if choice:\n      delta = 0\n    else:\n      delta = 1\n    delta = delta + 1"),
        ("unconditional reset", "delta = 0\n    delta = delta + 1"),
        ("before break", "delta = 0\n    break"),
        ("after break", "break\n    delta = 0"),
        ("after continue", "continue\n    delta = 0"),
        ("nested branch after break", "break\n    if choice:\n      if p.score > 0:\n        delta = 0"),
        ("nested loop", "for j in [1, 2]:\n      if choice:\n        delta = 0\n      delta = delta + 1"),
        ("nested loop after break", "break\n    for j in [1, 2]:\n      delta = 0"),
        ("break in nested loop", "for j in [1, 2]:\n      break\n      delta = 0"),
    ] {
        for domain in ["range(0, amount)", "xs", "xs { ignored: p.score }"] {
            let body = format!("delta = p.score\n  for i in {domain}:\n    {assignments}\n  update posts[id = p.id] {{ score: p.score + delta }}");
            let bound = bind(&cardinality_source("", &body));
            if !copies(&bound).is_empty() { failures.push(format!("{label}: {domain}")); }
        }
    }
    assert!(failures.is_empty(), "loop assignment lost cardinality: {failures:?}");
}

#[test]
fn review_f19_inner_argument_loop_survives_a_read_loop_join() {
    let body = "delta = 0\n  for row in posts[] first 5 by byId:\n    for i in range(0, amount):\n      if choice:\n        delta = 0\n      delta = delta + 1\n  update posts[id = p.id] { score: p.score + delta }";
    assert!(copies(&bind(&cardinality_source("", body))).is_empty());
    assert_eq!(copies(&bind(&cardinality_source("", &body.replace("range(0, amount)", "range(0, p.score)")))).len(), 1);
}

#[test]
fn review_f19_read_cardinality_still_notes_and_outside_assignments_stay_precise() {
    for domain in ["posts[] first 5 by byId", "range(0, p.n)"] {
        for assignments in ["delta = delta + 1", "if choice:\n      delta = 0\n    delta = delta + 1"] {
            let body = format!("delta = 0\n  for i in {domain}:\n    {assignments}\n  update posts[id = p.id] {{ score: delta }}");
            let source = cardinality_source("", &body).replace("score: int", "score: int\n  n: int default 0");
            assert_eq!(copies(&bind(&source)).len(), 1, "{domain}: {assignments}");
        }
    }
    for body in [
        "delta = 0\n  if choice:\n    delta = 0\n  delta = delta + 1\n  update posts[id = p.id] { score: p.score + delta }",
        "delta = 0\n  for i in range(0, amount):\n    delta = delta + 1\n  delta = 1\n  update posts[id = p.id] { score: p.score + delta }",
        "delta = p.score\n  for i in range(0, amount):\n    unused = 0\n  update posts[id = p.id] { score: delta }",
    ] {
        assert_eq!(copies(&bind(&cardinality_source("", body))).len(), 1, "{body}");
    }
    let source = cardinality_source("", "delta = 0\n  for i in missing:\n    if choice:\n      delta = 0\n    delta = delta + 1\n  update posts[id = p.id] { score: p.score + delta }");
    let (catalog, schema) = catalog_schema(&source);
    assert!(provenance::notes(&catalog, &schema).is_empty(), "an unknown domain cannot supply a proof");
    let helper = "fn constant():\n  x = 0\n  x = x + 1\n  return x\n";
    let body = "delta = 0\n  for row in posts[] first 5 by byId:\n    delta = constant()\n  update posts[id = p.id] { score: p.score + delta }";
    assert_eq!(copies(&bind(&cardinality_source(helper, body))).len(), 1, "the constant-helper positive remains noted");
}

#[test]
#[ignore = "L29: loops prefer silence"]
fn l29_unconditional_reset_precision() {
    for body in [
        "delta = 0\n  for row in posts[] first 5 by byId:\n    delta = 1\n  update posts[id = p.id] { score: delta }",
        "delta = 0\n  for row in posts[] first 5 by byId:\n    delta = 0\n    delta = delta + 1\n  update posts[id = p.id] { score: delta }",
    ] {
        assert!(copies(&bind(&cardinality_source("", body))).is_empty(), "{body}");
    }
    let body = "delta = 0\n  for i in range(0, amount):\n    delta = 0\n    delta = delta + 1\n  update posts[id = p.id] { score: p.score + delta }";
    assert_eq!(copies(&bind(&cardinality_source("", body))).len(), 1, "superseded precision: the loop stores at most one");
}

#[test]
fn round6_seek_bounds_and_matching_text_shape_a_pages_cardinality_but_keys_only_select() {
    // Round 6 (Grok): a seek bound or `matching` text the caller supplies decides HOW MANY rows a
    // page holds, so a count of it is caller-controlled (silent); a key selects WHICH group,
    // whose size is a fact about the data, so `count(likes[postId = postId])` stays the footgun (noted).
    let schema = "table posts:\n  body: text <=200\n  score: int\n  by byBodyWords: words(body), id\n  by byScore: score, id\n  public 'posts'\n  insert <- allow\n  update <- allow\n";
    // A `matching` page inside a mutation is refused by admission (E_STRUCTURAL_FANOUT), so the
    // pass's `matching` cardinality rule is defensive; the seek bound is the reachable case.
    let matching = compile(&[("schema.q".into(), format!("{schema}mutation setHits(q: text <=100):\n  update posts['seed'] {{ score: count(posts[] matching q first 50 by byBodyWords) }}\n"))]);
    assert!(matching.diagnostics.iter().any(|d| d.code == "E_STRUCTURAL_FANOUT"), "{:?}", matching.diagnostics);
    for (label, mutation, notes) in [
        ("seek bound", "mutation setHits(lo: int):\n  update posts['seed'] { score: count(posts[score >= lo] first 50 by byScore) }\n", 0),
        ("read-derived seek bound", "mutation setHits():\n  p = posts['seed'] ! else MISSING\n  update posts['seed'] { score: count(posts[score >= p.score] first 50 by byScore) }\n", 1),
    ] {
        let bound = bind(&format!("{schema}{mutation}"));
        assert_eq!(copies(&bound).len(), notes, "{label}: {:?}", bound.notes);
    }
    let keyed = bind(&SOURCE.replace("score: likeCounts[postId]", "score: count(likes[postId = postId] first 100 by byPair)"));
    assert_eq!(copies(&keyed).len(), 1, "a key selects the group; its count is derived: {:?}", keyed.notes);
}

#[test]
fn round6_helpers_named_like_syntactic_builtins_are_unknown_where_the_binder_bypasses_them() {
    // `(q, r) = divmod(a, b)`, `(lo, hi) = sorted(a, b)` and `for i in range(a, b)` are syntax the
    // binder handles itself, ignoring a same-named helper; the pass must not lend that helper's
    // provenance to the binding (round 6, GPT). Each is silent (UNKNOWN), never noted.
    let schema = "table posts:\n  score: int\n  public 'posts'\n  update <- allow\n";
    for (label, program) in [
        ("divmod", "fn divmod(a: int, b: int): 0\nmutation setScore(amount: int):\n  p = posts['seed'] ! else MISSING\n  (q, r) = divmod(amount, 1)\n  update posts[id = p.id] { score: p.score + q }\n"),
        ("sorted", "fn sorted(a: int, b: int): 0\nmutation setScore(amount: int):\n  p = posts['seed'] ! else MISSING\n  (lo, hi) = sorted(amount, 1)\n  update posts[id = p.id] { score: p.score + lo }\n"),
        ("range", "fn range(a: int, b: int): [0]\nmutation setScore(amount: int):\n  p = posts['seed'] ! else MISSING\n  delta = 0\n  for i in range(0, amount):\n    delta = delta + 1\n  update posts[id = p.id] { score: p.score + delta }\n"),
    ] {
        let bound = compile(&[("schema.q".into(), format!("{schema}{program}"))]);
        assert!(copies(&bound).is_empty(), "{label}: {:?} {:?}", bound.diagnostics, bound.notes);
    }
}
