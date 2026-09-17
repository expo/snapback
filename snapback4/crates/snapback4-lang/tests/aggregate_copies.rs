use snapback4_lang::{Bound, compile, guide, recipe};

const CODE: &str = "N_PUBLIC_AGGREGATE_COPY";
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
  upsert ranked[postId] { postId, score: likeCounts[postId], at: now, expiresAt: now + 86400000 }
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

#[test]
fn three_calibration_write_shapes_report_the_copied_column_once() {
    // 0.2.25: helper; 0.2.26: backfill job (the mutation increments);
    // 0.2.27: direct mutation. All three contain an actual maintain copy.
    let job = SOURCE.split("fn refreshRank").next().unwrap().to_owned() +
        "job backfill():\n  chunk p in posts first 50 by byId:\n    upsert ranked[p.id] { postId: p.id, score: likeCounts[p.id], at: now, expiresAt: now + 86400000 }\n";
    let direct = SOURCE.replace("fn refreshRank(postId: posts):", "mutation refreshRank(postId: posts):")
        .split("mutation refresh(postId:").next().unwrap().to_owned();
    for (version, source) in [("0.2.25", SOURCE.to_owned()), ("0.2.26", job.replace("ranked", "trendingRows")), ("0.2.27", direct.replace("ranked", "trendingPosts"))] {
        let bound = bind(&source);
        let notes = copies(&bound);
        assert_eq!(notes.len(), 1, "{version}: {:?}", bound.notes);
        assert_eq!(notes[0].site.line, 15);
        assert_eq!(notes[0].guide, "feeds");
        assert!(!notes[0].mechanical);
        assert!(notes[0].message.contains("likeCounts"));
        println!("{version}: {}", notes[0]);
    }
}

#[test]
fn aggregate_only_restricted_private_immutable_and_unrelated_counters_stay_silent() {
    let increment = SOURCE.split("fn refreshRank").next().unwrap().to_owned() +
        "mutation bump(postId: posts):\n  row = ranked[postId] ! else ROW_MISSING\n  update ranked[row.id] { score: row.score + 1 }\n";
    for source in [
        SOURCE.split("table ranked:").next().unwrap().to_owned(),
        SOURCE.replace("update <- allow", "update <- deny"),
        SOURCE.replace("update <- allow", "update <- viewer = 'service:ranker'"),
        SOURCE.replace("update <- allow", "update <- exists posts[id = .postId, author = viewer]"),
        SOURCE.replace("  public 'ranking'", "  read <- exists posts[id = .postId, author = viewer]").replace("  sync public last 100 by byScore\n", ""),
        SOURCE.replace("  score: int", "  score: int\n  immutable score"),
        SOURCE.replace("score: likeCounts[postId]", "score: 1"),
        SOURCE.replace("maintain likeCounts: count likes by postId\n  read <- allow\n", "").replace("score: likeCounts[postId]", "score: 1"),
        increment.replace("maintain likeCounts: count likes by postId\n  read <- allow\n", ""),
        increment,
    ] {
        assert!(copies(&bind(&source)).is_empty(), "{source}");
    }
}

#[test]
fn unrestricted_rule_spellings_and_public_online_tables_are_covered() {
    for rule in ["allow", "true", "not deny", "allow and true", "viewer = viewer", "viewer = 'service:ranker' or allow"] {
        let source = SOURCE.replace("update <- allow", &format!("update <- {rule}")).replace("  sync public last 100 by byScore", "  online only");
        assert_eq!(copies(&bind(&source)).len(), 1, "{rule}");
    }
    assert_eq!(copies(&bind(&SOURCE.replace("public 'ranking'", "read <- allow"))).len(), 1, "sync public with an allow read rule");
}

#[test]
fn installable_recipes_have_no_aggregate_copy_note() {
    for (name, source) in [("feeds", recipe::following("feed", "social").unwrap()), ("search", recipe::search("search", "social").unwrap())] {
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
    let readme = include_str!("../../../packages/snapback4/README.md");
    let client = include_str!("../../../packages/snapback4/CLIENT-AND-OPERATIONS.md");
    let server = include_str!("../../../packages/snapback4/SERVER.md");
    let docs: Vec<_> = guide::KEYWORDS.iter().map(|name| (*name, guide::card(name).unwrap()))
        .chain([("README", readme), ("CLIENT-AND-OPERATIONS", client), ("SERVER", server)]).collect();
    for (name, doc) in docs {
        for (index, block) in guide::quarry(doc).into_iter().enumerate() {
            let source = if block.starts_with("-- After: snapback4 init --recipe feeds --prefix feed\n") {
                format!("{}\n{block}", recipe::following("feed", "").unwrap())
            } else if block.lines().any(|line| line.starts_with("table ")) { block }
            else { format!("{}\n{block}", guide::language()) };
            let bound = bind(&source);
            blocks += 1;
            tables += bound.schema.tables.len();
            for note in copies(&bound) { hits.push(format!("{name} block {}: {note}", index + 1)); }
        }
    }
    println!("card/README survey: {} cards, 3 documents, {blocks} blocks, {tables} bound table occurrences, {} aggregate-copy notes", guide::KEYWORDS.len(), hits.len());
    assert!(hits.is_empty(), "{}", hits.join("\n"));
}

#[test]
fn aggregate_copy_card_section_is_verbatim_and_discoverable() {
    let section = "## N_PUBLIC_AGGREGATE_COPY: a public copy keeps ordinary write authority\n\n\
N_PUBLIC_AGGREGATE_COPY is a note, not an error. A public column is assigned\n\
directly from a declared `maintain`, but `update <- allow` (or a provably\n\
unrestricted equivalent) lets any principal set it through a mutation that\n\
writes it. The column duplicates an aggregate the engine already keeps.\n\
Read the maintain directly, or restrict the update rule; check the insert\n\
rule too if a caller can supply the initial value.\n\n\
The client calls declared operations, not arbitrary table writes. This note\n\
identifies latent table permission, not proof that a current mutation accepts\n\
an arbitrary score. It covers direct scalar maintain-to-column assignments in\n\
programs and helpers, including jobs, once per column and maintain. It does not\n\
infer copies from names, matching group keys, increments, aliases or arithmetic.\n\
Restricted rules, private targets and immutable columns do not receive it;\n\
absence of the note is not a proof that a ranking cannot be forged. Sync and\n\
`online only` do not change write authority.\n";
    assert!(guide::card("feeds").unwrap().ends_with(section));
    assert_eq!(snapback4_lang::diag::guide_for(CODE), "feeds");
    let explanation = guide::explain_code(CODE).unwrap();
    assert!(explanation.contains(section.split("\n\nThe client").next().unwrap()));
    assert!(explanation.ends_with("Full card: snapback4 guide feeds"));
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
    assert_eq!(notes[0].message, "column catalog.amount copies maintain totals, an aggregate of likes the engine already keeps; `update <- allow` lets any principal set this public column through a mutation that writes it");
}

#[test]
#[ignore = "requires the retained calibration packets; set SNAPBACK4_CALIBRATION_PACKETS to their parent"]
fn survey_retained_calibration_schemas() {
    let root = std::path::PathBuf::from(std::env::var_os("SNAPBACK4_CALIBRATION_PACKETS").expect("calibration packet parent"));
    for (cal, version, expected) in [(9, "0.2.25", vec!["ranked"]), (10, "0.2.26", vec!["trendingRows"]), (11, "0.2.27", vec!["posts", "trendingPosts"])] {
        let dir = root.join(format!("clique-sb4-20260916-astra-cal{cal}/lanes/astra-snapback4/snapback"));
        let mut files: Vec<_> = std::fs::read_dir(dir).unwrap().map(|entry| entry.unwrap().path()).filter(|path| path.extension().is_some_and(|ext| ext == "q")).collect();
        files.sort();
        let sources: Vec<_> = files.iter().map(|path| (path.file_name().unwrap().to_string_lossy().to_string(), std::fs::read_to_string(path).unwrap())).collect();
        let bound = compile(&sources);
        assert!(bound.diagnostics.is_empty(), "{version}: {:?}", bound.diagnostics);
        let notes = copies(&bound);
        let tables: Vec<_> = notes.iter().map(|note| note.message.split_whitespace().nth(1).unwrap().split('.').next().unwrap()).collect();
        println!("calibration {version}: {} files, {} tables, {} aggregate-copy notes: {tables:?}", sources.len(), bound.schema.tables.len(), notes.len());
        for note in &notes { println!("{note}"); }
        assert_eq!(tables, expected);
    }
}

#[test]
fn no_card_ships_a_principal_writable_ranking() {
    // This replaces a test that asserted the handwritten fresh-ranking recipe
    // *rejected* a forged score. W12a withdrew that recipe for a server-scored
    // one, so the stronger property now holds by construction: no card ships a
    // ranking a principal can write, and there is no `refreshRank` to copy.
    // Asserting the absence is what keeps it true.
    for name in guide::KEYWORDS {
        let card = guide::card(name).unwrap();
        assert!(!card.contains("fn refreshRank("), "{name} still ships the withdrawn writable ranking helper");
        for block in guide::quarry(card) {
            if block.contains("table ranked:") || (block.contains("score: int") && block.contains("expiresAt")) {
                assert!(!block.contains("update <- allow"),
                    "{name} ships a ranking table with update <- allow:\n{block}");
            }
        }
    }
}
