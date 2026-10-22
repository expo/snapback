//! Compile examples and audit source diagnostic coverage.
use super::*;

pub(super) fn compile(source: &str) -> snapback4_lang::Bound {
    snapback4_lang::compile(&[("schema.q".to_owned(), source.to_owned())])
}

pub(super) fn clean(label: &str, source: &str) -> snapback4_lang::Bound {
    let bound = compile(source);
    let list = |items: &[snapback4_lang::Diagnostic]| items.iter().map(ToString::to_string).collect::<Vec<_>>().join("\n");
    assert!(bound.diagnostics.is_empty(), "{label} does not compile:\n{}", list(&bound.diagnostics));
    // DX5 makes reader-only gates and private named conflicts visible in
    // existing examples. They remain runnable; pin the source and repair of
    // each advisory rather than calling an intentional privacy gate unclean.
    for note in bound.notes.iter().filter(|n| matches!(n.code.as_str(), "N_LOOKUP_FILTERED" | "N_UNIQUE_HIDDEN")) {
        let line = source.lines().nth(note.site.line.saturating_sub(1) as usize).expect("located source advice");
        assert_eq!(note.guide, "rules");
        assert!(note.rewrite.contains("private rows") && !note.rewrite.is_empty(), "{note}");
        if note.code == "N_UNIQUE_HIDDEN" { assert!(line.contains("unique"), "{line}: {note}"); }
        else { assert!(line.contains('[') || line.trim_start().starts_with("receipts "), "{line}: {note}"); }
    }
    let notes = if source.contains(&guide::language()) { guide_context::without_grouped_shape_note(&bound, "groupedMessages") }
        else { bound.notes.iter().collect::<Vec<_>>() };
    let notes: Vec<_> = notes.into_iter().filter(|n| !matches!(n.code.as_str(), "N_LOOKUP_FILTERED" | "N_UNIQUE_HIDDEN")).collect();
    // The populated-store feed deliberately teaches its sparse-scan limit.
    // Pin the actual card block and its one note; other examples stay clean.
    if quarry(card("feeds").unwrap()).iter().any(|block| block == source && block.contains("query home(") && !block.contains("view following:")) {
        assert_eq!(notes.len(), 1, "{label}: {:?}", bound.notes);
        assert_eq!(notes[0].code, "N_SPARSE_FILTER");
        return bound;
    }
    if quarry(card("offline-interactions").unwrap()).iter().any(|block| block == source && block.contains("view ownLikes:")) {
        assert_eq!((notes.len(), notes.first().map(|n| n.code.as_str())), (1, Some("N_MAINTAIN_SYNCED")), "{label}: {:?}", bound.notes);
        return bound;
    }
    // These exact published ordinary-search examples teach both coverage notes.
    // Keep their codes, counts and query site pinned; no general note exemption.
    let search_examples = quarry(card("search").unwrap());
    let package_examples = quarry(include_str!("../../../../packages/snapback4/README.md"));
    if search_examples.iter().skip(1).chain(package_examples.iter())
        .any(|block| block == source && block.contains("query search(q: text <=100, c: cursor ?):")) {
        let notes = if source.contains("query searchGrouped(") { guide_context::without_grouped_shape_note(&bound, "searchGrouped") } else { notes };
        let mut codes = notes.iter().map(|note| note.code.as_str()).collect::<Vec<_>>();
        codes.sort_unstable();
        assert_eq!(codes, ["N_NEVER_COMPLETE", "N_SYNC_ORDER"], "{label}: {:?}", bound.notes);
        assert!(notes.iter().all(|note| note.message.starts_with("query search")), "{label}: {:?}", bound.notes);
        return bound;
    }
    // The timed-peer recipe intentionally preserves a hidden-target upsert's
    // runtime deadline equality. Pin its one documented uncertainty, not a
    // general immutable-note exemption.
    if quarry(card("rule-recipes").unwrap()).iter().any(|block| block == source
        && block.contains("mutation reportWords(") && block.contains("table peerCounts:")) {
        assert_eq!(notes.len(), 1, "{label}: {:?}", bound.notes);
        let note = &notes[0];
        assert_eq!(note.code, "N_IMMUTABLE_PATCH");
        assert!(note.message.contains("peerCounts.opensAt"), "{note:?}");
        assert!(note.message.contains("equals the stored value"), "{note:?}");
        assert!(card("rule-recipes").unwrap().contains("runtime equality"));
        return bound;
    }
    // @ref LLP 3000.036.002#14 — caller-visible existence is the lesson, not global absence.
    // This exact ladder example intentionally contrasts a hidden rule probe
    // with caller-visible existence; its one advisory note is part of the lesson.
    if quarry(card("rules").unwrap()).iter().any(|block| block == source && block.contains("query canReadLadderGrant(")) {
        assert_eq!(notes.len(), 1, "{label}: {:?}", bound.notes);
        assert_eq!(notes[0].code, "N_UNREADABLE_PROBE");
        assert!(notes[0].message.contains("canReadLadderGrant"));
        assert!(card("rules").unwrap().contains("caller-visible existence is intended here"));
        return bound;
    }
    // DX7 deliberately demonstrates both hidden positive guards and query probes.
    if quarry(card("rule-recipes").unwrap()).iter().any(|block| block == source && block.contains("mutation dxCustomerGuard(")) {
        let codes = notes.iter().map(|n|n.code.as_str()).collect::<Vec<_>>();
        assert_eq!(codes, ["N_REQUIRE_HIDDEN", "N_UNREADABLE_PROBE"], "{label}: {:?}", bound.notes);
        assert!(notes.iter().all(|n|n.message.contains("dxRoles") && n.message.contains(".principal = viewer")));
        return bound;
    }
    // The live recipe deliberately teaches its full-current acquisition note.
    if source.contains("table liveRosterFiles:") {
        assert_eq!(notes.len(),1,"{label}: {:?}",bound.notes);
        assert_eq!(notes[0].code,"N_NO_HORIZON");
        assert!(notes[0].rewrite.contains("online only") && !notes[0].rewrite.contains("last 500"));
        return bound;
    }
    let unexpected: Vec<_> = notes.into_iter().filter(|note| !matches!(note.code.as_str(), "N_LOOKUP_FILTERED" | "N_UNIQUE_HIDDEN") && !(source.contains("ephemeral ") && note.code == "N_EPHEMERAL_SERVER")).cloned().collect();
    assert!(unexpected.is_empty(), "{label} compiles with notes:\n{}", list(&unexpected));
    bound
}

/// The sources a scan of literals covers: the Rust crates and the client.
pub(super) fn sources() -> Vec<PathBuf> {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let mut files = Vec::new();
    fn walk(dir: &Path, files: &mut Vec<PathBuf>) {
        for entry in std::fs::read_dir(dir).unwrap_or_else(|e| panic!("{}: {e}", dir.display())) {
            let path = entry.unwrap().path();
            if path.is_dir() {
                if path.file_name().is_some_and(|n| n == "node_modules" || n == "target" || n == "dist" || n == "tests" || n == "test") {
                    continue;
                }
                // Differential-test records quote the Lean model's own
                // refusals (`E_MODEL_TYPE`), which no product path emits.
                if path.ends_with("snapback4-difftest/cases") {
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
