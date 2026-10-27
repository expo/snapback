//! Concrete SQLite handles above the port, including aliases on the export
//! surface. The historical spelling census was 123/37; the target stays zero.
//! This is a conservative lexical guard, not Rust name or macro resolution.
//! Known limits: macros can generate concrete aliases, raw calls or MemberTx
//! methods without spelling their types here; cross-crate/procedural expansion
//! and arbitrary type inference are not resolved. Associated-type assignments
//! and aliases in member signatures are followed by name (not Rust scope).
//! Non-test compiled checks in crates/snapback4-core/tests/store_handle_traits.rs cover
//! macro-generated and cfg(not(test)) owning Deref/AsRef/Borrow implementations;
//! the private preparation/member traits also have library unit checks.
//! @ref LLP 3000.009.001.000#3.4 — server handles stay neutral across imports and exports.
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::{Path, PathBuf},
};

#[path = "support/rust_tokens.rs"]
mod rust_tokens;
use rust_tokens::{Token, starts, tokens};

fn test_file(path: &Path) -> bool {
    let name = path.file_name().unwrap().to_string_lossy();
    path.components()
        .any(|p| matches!(p.as_os_str().to_str(), Some("tests" | "test_cases")))
        || name == "tests.rs"
        || name.ends_with("_tests.rs")
        || name == "test_cases.rs"
}

fn in_scope(path: &Path) -> bool {
    (path.starts_with("crates/snapback4-core/src/engine")
        || path.starts_with("crates/snapback4/src"))
        && !adapter(path)
        && !test_file(path)
}

fn adapter(path: &Path) -> bool {
    path == Path::new("crates/snapback4-core/src/store.rs")
        || path.starts_with("crates/snapback4-core/src/store")
        || path == Path::new("crates/snapback4-core/src/store_port.rs")
        || path.starts_with("crates/snapback4-core/src/engine/postgres")
}

fn production_tokens(source: &str) -> Vec<Token<'_>> {
    let mut tokens = tokens(source);
    let mut i = 0;
    while i < tokens.len() {
        // Skip test items, including imports/functions, not just modules.
        if starts(&tokens[i..], &["#", "[", "cfg", "(", "test", ")", "]"])
            || starts(
                &tokens[i..],
                &["#", "[", "cfg", "(", "all", "(", "test", ","],
            )
        {
            let start = i;
            i = test_item_end(&tokens, i);
            tokens.drain(start..i);
            i = start;
        } else {
            i += 1;
        }
    }
    tokens
}

fn test_item_end(tokens: &[Token<'_>], mut i: usize) -> usize {
    while starts(&tokens[i..], &["#", "["]) {
        i += tokens[i..].iter().position(|t| t.text == "]").unwrap() + 1;
    }
    let mut head = i;
    if tokens.get(head).is_some_and(|t| t.text == "pub") {
        head += 1;
        if tokens.get(head).is_some_and(|t| t.text == "(") {
            head += tokens[head..].iter().position(|t| t.text == ")").unwrap() + 1;
        }
    }
    let item = tokens.get(head).is_some_and(|t| {
        matches!(
            t.text,
            "async"
                | "unsafe"
                | "const"
                | "extern"
                | "fn"
                | "mod"
                | "use"
                | "struct"
                | "enum"
                | "union"
                | "trait"
                | "impl"
                | "static"
                | "type"
                | "macro_rules"
        )
    });
    let (mut parens, mut brackets, mut angles) = (0usize, 0usize, 0usize);
    while i < tokens.len() {
        let text = tokens[i].text;
        // Const-generic blocks can contain comparisons; they are opaque to
        // type-angle tracking, just like literals. Never cross a field's owner.
        if !item && text == "{" && (angles != 0 || parens != 0 || brackets != 0) {
            i = block_end(tokens, i);
            continue;
        }
        if parens == 0 && brackets == 0 && text == "}" {
            return i;
        }
        if parens == 0 && brackets == 0 && angles == 0 {
            match text {
                "{" => return block_end(tokens, i),
                ";" => return i + 1,
                "," if !item => return i + 1,
                "}" => return i,
                _ => {}
            }
        }
        match text {
            "(" => parens += 1,
            ")" => parens = parens.saturating_sub(1),
            "[" => brackets += 1,
            "]" => brackets = brackets.saturating_sub(1),
            "<" if !item && parens == 0 && brackets == 0 => angles += 1,
            ">" if !item
                && parens == 0
                && brackets == 0
                && !i.checked_sub(1).is_some_and(|j| tokens[j].text == "-") =>
            {
                angles = angles.saturating_sub(1)
            }
            _ => {}
        }
        i += 1;
    }
    i
}

fn block_end(tokens: &[Token<'_>], open: usize) -> usize {
    let mut depth = 0;
    for (i, token) in tokens.iter().enumerate().skip(open) {
        match token.text {
            "{" => depth += 1,
            "}" => depth -= 1,
            _ => {}
        }
        if depth == 0 {
            return i + 1;
        }
    }
    panic!("unclosed Rust block");
}

fn concrete_tokens(source: &str, names: &BTreeSet<String>) -> usize {
    let tokens = production_tokens(source);
    let shadowed: BTreeSet<_> = bindings(source)
        .into_iter()
        .filter(|b| {
            matches!(b.name.as_str(), "RuntimeError" | "wasmi") && b.path.last() != Some(&b.name)
        })
        .map(|b| b.name)
        .collect();
    tokens
        .iter()
        .enumerate()
        .filter(|(i, token)| {
            // Exempt the exact error variant/foreign type only when an import does
            // not shadow its namespace (including `extern crate ... as ...`).
            let exempt = token.text == "Store"
                && i.checked_sub(3).is_some_and(|start| {
                    ["RuntimeError", "wasmi"].iter().any(|owner| {
                        !shadowed.contains(*owner) && starts(&tokens[start..*i], &[owner, ":", ":"])
                    })
                });
            names.contains(token.text) && !exempt
        })
        .count()
}

#[derive(Debug)]
struct Binding {
    path: Vec<String>,
    name: String,
    exported: bool,
    line: usize,
}

// Flatten use trees so each original path stays separate from its `as` name.
fn use_tree(
    tokens: &[Token<'_>],
    i: &mut usize,
    prefix: &[String],
    out: &mut Vec<(Vec<String>, String)>,
) {
    let mut path = prefix.to_vec();
    while *i < tokens.len() {
        match tokens[*i].text {
            ":" => *i += 1,
            "{" => {
                *i += 1;
                while *i < tokens.len() && tokens[*i].text != "}" {
                    let before = *i;
                    use_tree(tokens, i, &path, out);
                    if tokens.get(*i).is_some_and(|t| t.text == ",") {
                        *i += 1;
                    }
                    // A `;` inside braces is not a use tree. Consume it rather
                    // than re-reading the same token forever (unbounded `out`).
                    if *i == before {
                        *i += 1;
                    }
                }
                *i += 1;
                return;
            }
            "," | "}" | ";" => break,
            "as" => {
                *i += 1;
                let name = tokens[*i].text.to_owned();
                *i += 1;
                if path.len() > 1 && path.last().is_some_and(|s| s == "self") {
                    path.pop();
                }
                out.push((path, name));
                return;
            }
            name => {
                path.push(name.to_owned());
                *i += 1;
            }
        }
    }
    if path.len() > 1 && path.last().is_some_and(|s| s == "self") {
        path.pop();
    }
    if let Some(name) = path.last() {
        out.push((path.clone(), name.clone()));
    }
}

fn bindings(source: &str) -> Vec<Binding> {
    let tokens = production_tokens(source);
    let mut out = Vec::new();
    for (i, token) in tokens.iter().enumerate() {
        // Include restricted exports, ordinary aliases and associated types.
        let boundary = tokens[..i]
            .iter()
            .rposition(|t| matches!(t.text, ";" | "{" | "}"))
            .map_or(0, |j| j + 1);
        let exported = tokens[boundary..i].iter().any(|t| t.text == "pub");
        // `impl Trait + use<..>` is a precise-capturing bound, never a use declaration.
        let declaration = token.text == "use" && tokens.get(i + 1).is_none_or(|t| t.text != "<");
        if declaration || starts(&tokens[i..], &["extern", "crate"]) {
            let mut paths = Vec::new();
            use_tree(
                &tokens,
                &mut (i + if token.text == "use" { 1 } else { 2 }),
                &[],
                &mut paths,
            );
            out.extend(paths.into_iter().map(|(path, name)| Binding {
                path,
                name,
                exported,
                line: token.line,
            }));
        } else if token.text == "type" {
            let end = tokens[i..]
                .iter()
                .position(|t| t.text == ";")
                .map_or(tokens.len(), |j| i + j);
            if let Some(equal) = tokens[i..end].iter().position(|t| t.text == "=") {
                out.push(Binding {
                    path: tokens[i + equal + 1..end]
                        .iter()
                        .map(|t| t.text.to_owned())
                        .collect(),
                    name: tokens[i + 1].text.to_owned(),
                    exported,
                    line: token.line,
                });
            }
        }
    }
    out
}

fn concrete_path(path: &[String], names: &BTreeSet<String>) -> bool {
    path.first().is_none_or(|name| name != "wasmi") && path.iter().any(|name| names.contains(name))
}

fn census(sources: &[(PathBuf, String)]) -> BTreeMap<PathBuf, usize> {
    let declarations: Vec<_> = sources.iter().map(|(_, source)| bindings(source)).collect();
    let mut names: BTreeSet<String> = ["Store", "Tx"].map(String::from).into();
    // Follow renamed imports and type aliases even when declared outside engine
    // and host, or privately inside an adapter before a public re-export.
    loop {
        let previous = names.len();
        for binding in declarations.iter().flatten() {
            if concrete_path(&binding.path, &names) {
                names.insert(binding.name.clone());
            }
        }
        if names.len() == previous {
            break;
        }
    }
    let mut counts = BTreeMap::new();
    for ((path, source), bindings) in sources.iter().zip(declarations) {
        if test_file(path) {
            continue;
        }
        let mut count = if in_scope(path) {
            concrete_tokens(source, &names)
        } else {
            0
        };
        for binding in bindings {
            // The one existing public SQLite spelling serves devices/fixtures.
            let canonical = path == Path::new("crates/snapback4-core/src/lib.rs")
                && binding.path == ["store", "Store"]
                && binding.name == "Store";
            let concrete = concrete_path(&binding.path, &names)
                || binding.path.last().is_some_and(|name| name == "store")
                || binding.path.ends_with(&["store".into(), "*".into()]);
            if concrete && !canonical && (!adapter(path) || binding.exported) {
                eprintln!(
                    "{}:{}: concrete handle import/export/alias: {binding:?}",
                    path.display(),
                    binding.line
                );
                count += 1;
            }
        }
        if count != 0 {
            counts.insert(path.clone(), count);
        }
    }
    counts
}

// No owning handle may acquire implicit backend access, including through an
// imported trait/type alias. MemberTx has its separate, stricter facade guard.
// @ref LLP 3000.009.001.000#3.4 — S10b removes all owning dereference bridges.
fn owning_dereferences(sources: &[(PathBuf, String)]) -> BTreeMap<PathBuf, usize> {
    let mut handles: BTreeSet<String> =
        ["AnyStore", "AnyTx", "ReadSnapshot", "AnyInspection", "AnyPreparation"]
            .map(String::from).into();
    let mut traits: BTreeSet<String> = ["Deref", "DerefMut"].map(String::from).into();
    loop {
        let before = (handles.len(), traits.len());
        for (_, source) in sources {
            for binding in bindings(source) {
                for names in [&mut handles, &mut traits] {
                    if binding.path.iter().any(|part| names.contains(part)) {
                        names.insert(binding.name.clone());
                    }
                }
            }
        }
        if before == (handles.len(), traits.len()) { break; }
    }
    let mut counts = BTreeMap::new();
    for (path, source) in sources {
        let tokens = production_tokens(source);
        let count = tokens.iter().enumerate().filter(|(_, t)| t.text == "impl")
            .filter(|(i, _)| {
                let header = &tokens[*i..];
                let end = header.iter().position(|t| t.text == "{").unwrap_or(header.len());
                let header = &header[..end];
                let Some(for_at) = header.iter().position(|t| t.text == "for") else { return false; };
                header[..for_at].iter().any(|t| traits.contains(t.text))
                    && header[for_at + 1..].iter().any(|t| handles.contains(t.text))
            }).count();
        if count != 0 { counts.insert(path.clone(), count); }
    }
    counts
}

fn walk(root: &Path, dir: &Path, sources: &mut Vec<(PathBuf, String)>) {
    for entry in fs::read_dir(dir).unwrap() {
        let path = entry.unwrap().path();
        if path.is_dir() {
            walk(root, &path, sources);
        } else if path.extension().is_some_and(|ext| ext == "rs") {
            let relative = path.strip_prefix(root).unwrap();
            if !test_file(relative) {
                sources.push((relative.into(), fs::read_to_string(&path).unwrap()));
            }
        }
    }
}

#[test]
fn engine_and_host_use_neutral_handles() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .parent()
        .unwrap();
    let mut sources = Vec::new();
    for dir in ["crates/snapback4-core/src", "crates/snapback4/src"] {
        walk(root, &root.join(dir), &mut sources);
    }
    let counts = census(&sources);
    println!(
        "S10a concrete SQLite handle census: {} tokens/declarations in {} files (target 0)",
        counts.values().sum::<usize>(),
        counts.len()
    );
    assert!(
        counts.is_empty(),
        "LLP 3000.009.001.000 §3.4: concrete SQLite handles above the port: {counts:?}"
    );
    let dereferences = owning_dereferences(&sources);
    println!("S10b owning dereference bridge census: {} (target 0)", dereferences.values().sum::<usize>());
    assert!(dereferences.is_empty(), "owning dereference bridges: {dereferences:?}");
}

#[test]
fn owning_dereference_matcher_follows_aliases_and_ignores_test_items() {
    let source = |s: &str| vec![(PathBuf::from("store_port.rs"), s.to_string())];
    for handle in ["AnyStore", "AnyTx<'a>", "ReadSnapshot<'a>", "AnyInspection", "AnyPreparation<'a>"] {
        for trait_name in ["std::ops::Deref", "DerefMut", "r#Deref"] {
            let attack = format!("impl<'a> {trait_name} for {handle} {{ type Target = sqlite::Store; }}");
            assert!(!owning_dereferences(&source(&attack)).is_empty(), "{attack}");
        }
    }
    let aliased = "use std::ops::Deref as View; use crate::store_port::AnyStore as Owner; type Handle = Owner; impl View for Handle { type Target = sqlite::Store; }";
    assert!(!owning_dereferences(&source(aliased)).is_empty());
    assert!(owning_dereferences(&source("#[cfg(test)] impl Deref for AnyStore { type Target = Store; } // impl Deref for AnyTx {}")).is_empty());
    assert!(owning_dereferences(&source("impl Rows for AnyTx<'_> {} impl Deref for Other { type Target = AnyStore; }")).is_empty());
}

#[test]
fn matcher_keeps_types_and_excludes_tests_errors_and_wasm() {
    let count = |s| concrete_tokens(s, &["Store", "Tx"].map(String::from).into());
    assert_eq!(
        count("use crate::store::{Store, Tx}; fn f(tx: &Tx<'_>) -> Store {}"),
        4
    );
    assert_eq!(
        count("r#Store::memory(); r#Tx<'_>; Error::Store::memory(); Self::Tx;"),
        4
    );
    assert_eq!(
        count(
            "// Store\nlet a = \"Tx\"; let b = r###\"Store\"###; RuntimeError::Store(e); wasmi::Store::new();"
        ),
        0
    );
    assert_eq!(
        count(
            "#[cfg(test)] mod fixtures { fn f(tx: Tx) { Store::memory(); } } type T = Tx<'static>;"
        ),
        1
    );
    assert_eq!(
        count(
            "#[cfg(test)] use crate::Store; #[cfg(all(test, feature = \"sqlite\"))] fn f(tx: Tx) {} type T = Store;"
        ),
        1
    );
    assert_eq!(count("AnyStore::memory(); fn f(tx: &AnyTx<'_>) {}"), 0);
    for source in [
        "struct X { #[cfg(test)] failed: Option<Result<Tx<'static>, Store>>, } impl X { fn after(tx: Tx) {} }",
        "struct X { #[cfg(test)] pub(crate) failed: Tx<'static> } impl X { fn after(tx: Tx) {} }",
        "enum X { #[cfg(test)] Failed(Tx<'static>), Kept } fn after(tx: Tx) {}",
        "#[cfg(test)] const LESS: bool = 1 < 2; fn after(tx: Tx) {}",
        "struct X { #[cfg(test)] failed: Marker<{ 1 < 2 }>, } impl X { fn after(tx: Tx) {} }",
        "struct X { #[cfg(test)] failed: Marker<fn() -> Tx, Store>, } impl X { fn after(tx: Tx) {} }",
    ] {
        assert_eq!(
            count(source),
            1,
            "test field/variant swallowed production: {source}"
        );
    }
    assert!(in_scope(Path::new("crates/snapback4/src/contests.rs")));
}

#[test]
fn precise_capturing_bounds_are_not_use_declarations() {
    // engine/postgres/ownership.rs returns `impl Fn() -> bool + Send + Sync + use<>`;
    // reading that bound as a use tree looped forever on the body's `;`.
    let source = "pub fn watch(&self) -> impl Fn() -> bool + Send + Sync + use<> {\n    let grant = self.grant.clone();\n    move || grant.load()\n}\npub use crate::store::Store as Kept;\n";
    let found: Vec<_> = bindings(source).into_iter().map(|b| (b.path.join("::"), b.name, b.exported)).collect();
    assert_eq!(found, vec![("crate::store::Store".to_string(), "Kept".to_string(), true)]);
    // A malformed brace tree still terminates instead of growing without bound.
    assert!(bindings("use crate::{store; Store};").len() < 8);
}

#[test]
fn renamed_error_module_and_renamed_exports_cannot_bypass_census() {
    let engine = "crates/snapback4-core/src/engine/attack.rs";
    let lib = "crates/snapback4-core/src/lib.rs";
    let sources = |items: &[(&str, &str)]| {
        items
            .iter()
            .map(|(p, s)| (PathBuf::from(p), s.to_string()))
            .collect::<Vec<_>>()
    };
    for owner in ["Error", "RuntimeError", "wasmi"] {
        let attack = format!(
            "use snapback4_core::store as {owner}; pub fn open() -> Result<{owner}::Store, snapback4_core::RuntimeError> {{ {owner}::Store::memory() }}"
        );
        assert!(
            !census(&sources(&[(engine, &attack)])).is_empty(),
            "{attack}"
        );
    }
    for import in [
        "use snapback4_core::store::{self as RuntimeError};",
        "use snapback4_core as RuntimeError;",
        "extern crate snapback4_core as RuntimeError;",
    ] {
        let attack = format!(
            "{import} pub fn open() -> Result<RuntimeError::Store, snapback4_core::RuntimeError> {{ RuntimeError::Store::memory() }}"
        );
        assert!(
            !census(&sources(&[(engine, &attack)])).is_empty(),
            "{attack}"
        );
    }
    for export in [
        "pub use store::Store as PhysicalStore;",
        "pub use crate::store::{Store as PhysicalStore};",
        "use crate::store as sqlite; pub type PhysicalStore = sqlite::Store;",
        "pub use store::*;",
    ] {
        assert!(
            census(&sources(&[
                (lib, export),
                (
                    engine,
                    "fn open() -> PhysicalStore { PhysicalStore::memory() }"
                )
            ]))
            .contains_key(Path::new(lib)),
            "{export}"
        );
    }
    let port = "crates/snapback4-core/src/store_port.rs";
    let attack = sources(&[
        (
            port,
            "use crate::store::Tx as Hidden; pub type Handle<'a> = Hidden<'a>;",
        ),
        (engine, "fn f(tx: &crate::store_port::Handle<'_>) {}"),
    ]);
    let counts = census(&attack);
    assert!(counts.contains_key(Path::new(port)) && counts.contains_key(Path::new(engine)));
    assert!(
        census(&sources(&[
            (lib, "pub use store::Store;"),
            (
                engine,
                "use crate::store_port::AnyStore; fn f(s: AnyStore) {}"
            )
        ]))
        .is_empty()
    );
    assert!(
        census(&sources(&[(
            lib,
            "#[cfg(test)] pub use store::Store as PhysicalStore;"
        )]))
        .is_empty()
    );
}

// Complements core's compile-time Deref/AsRef/Borrow and named-method negatives:
// inspect private fields and arbitrary getter names, including forwarding macros.
// @ref LLP 3000.009.001.000.000#3.7 — a member never receives the physical transaction handle.
fn member_handle_names(sources: &[(PathBuf, String)]) -> BTreeSet<String> {
    let mut names: BTreeSet<String> = ["AnyTx", "Tx", "Connection"].map(String::from).into();
    loop {
        let before = names.len();
        for (_, source) in sources {
            for binding in bindings(source) {
                if binding.path.iter().any(|part| names.contains(part)) {
                    names.insert(binding.name);
                }
            }
        }
        if names.len() == before { return names; }
    }
}

fn closed_member_facade(source: &str, names: &BTreeSet<String>) -> bool {
    let tokens = production_tokens(source);
    for (i, token) in tokens.iter().enumerate() {
        if token.text != "impl" && !starts(&tokens[i..], &["struct", "MemberTx"]) {
            continue;
        }
        let Some(open) = tokens[i..]
            .iter()
            .position(|t| t.text == "{")
            .map(|j| i + j)
        else {
            continue;
        };
        if !tokens[i..open].iter().any(|t| t.text == "MemberTx") {
            continue;
        }
        let body = &tokens[open + 1..block_end(&tokens, open) - 1];
        if token.text == "struct" {
            if body.iter().any(|t| t.text == "pub") {
                return false;
            }
        } else {
            for (j, _) in body.iter().enumerate().filter(|(_, t)| t.text == "fn") {
                let end = body[j..]
                    .iter()
                    .position(|t| matches!(t.text, "{" | ";"))
                    .map_or(body.len(), |k| j + k);
                // Inspect the entire signature: a callback parameter can lend
                // the owner just as a return value can. Include where clauses.
                if body[j + 1..end].iter().any(|t| names.contains(t.text)) {
                    return false;
                }
            }
        }
    }
    true
}

#[test]
fn member_facade_field_visibility_and_arbitrary_getters_are_closed() {
    let core = Path::new(env!("CARGO_MANIFEST_DIR")).join("../snapback4-core/src/engine");
    let source = fs::read_to_string(core.join("committer.rs")).unwrap();
    assert!(source.contains("    tx: &'member AnyTx<'store>,"));
    let core_src = core.parent().unwrap();
    let mut sources = Vec::new();
    walk(core_src, core_src, &mut sources);
    let names = member_handle_names(&sources);
    for (path, source) in sources {
        assert!(
            closed_member_facade(&source, &names),
            "{} exposes a member handle",
            path.display()
        );
    }
    for visibility in ["pub", "pub(crate)", "pub(super)"] {
        let attack = source.replace(
            "    tx: &'member AnyTx",
            &format!("    {visibility} tx: &'member AnyTx"),
        );
        assert!(!closed_member_facade(&attack, &names), "{visibility}");
    }
    for returned in [
        "&AnyTx<'_>",
        "&'store AnyTx<'store>",
        "&crate::store::Tx<'_>",
        "&sqlite::Tx<'_>",
        "&mut AnyTx<'_>",
    ] {
        let attack = format!(
            "impl MemberTx<'_, '_> {{ pub(crate) fn arbitrary_name(&self) -> {returned} {{ self.tx }} }}"
        );
        assert!(!closed_member_facade(&attack, &names), "{returned}");
        let forwarding_attack = format!(
            "impl MemberTx<'_, '_> {{ methods! {{ fn arbitrary_name(&self) -> {returned}; }} }}"
        );
        assert!(!closed_member_facade(&forwarding_attack, &names), "{returned}");
    }
}

#[test]
fn associated_handles_and_member_alias_or_callback_escapes_are_counted() {
    let port = PathBuf::from("crates/snapback4-core/src/store_port.rs");
    let engine = PathBuf::from("crates/snapback4-core/src/engine/attack.rs");
    let sources = vec![
        (port, "impl Factory for Provider { type Handle = sqlite::Store; }".into()),
        (engine.clone(), "fn open() -> <Provider as Factory>::Handle {}".into()),
    ];
    assert!(census(&sources).contains_key(&engine));
    for signature in [
        "fn arbitrary(&self) -> Alias<'_>",
        "fn arbitrary(&self, callback: impl FnOnce(&AnyTx<'_>))",
        "fn arbitrary<F: FnOnce(Alias<'_>)>(&self, callback: F)",
        "fn arbitrary<F>(&self, callback: F) where F: FnOnce(Alias<'_>)",
    ] {
        let aliases = "type Hidden<'a> = &'a AnyTx<'a>; type Alias<'a> = Hidden<'a>;";
        let source = format!("{aliases} impl MemberTx<'_, '_> {{ {signature} {{}} }}");
        let names = member_handle_names(&[(engine.clone(), source.clone())]);
        assert!(!closed_member_facade(&source, &names), "{signature}");
    }
    let names = member_handle_names(&[
        (engine.clone(), "use crate::hidden::Alias;".into()),
        (PathBuf::from("hidden.rs"), "pub type Alias<'a> = &'a AnyTx<'a>;".into()),
    ]);
    assert!(!closed_member_facade("impl MemberTx<'_, '_> { fn escape(&self) -> Alias<'_> {} }", &names));
}
