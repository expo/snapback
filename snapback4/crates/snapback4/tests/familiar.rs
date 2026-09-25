//! Replay the recorded builder guesses through the CLI, including repaired files.
use serde::Deserialize;
use serde_json::Value;
use std::{fs, process::Command};

#[derive(Deserialize)]
struct Guess { name: String, source: String, repaired: String, code: Option<String>, repair: Option<String>, module: Option<String>, #[serde(default)] exact_repair: bool }

#[test]
fn builder_guesses_have_one_step_check_repairs() {
    let directory = Directory::new();
    let snapback = directory.path().join("snapback");
    fs::create_dir(&snapback).unwrap();
    let guesses: Vec<Guess> = serde_json::from_str(include_str!("familiar/guesses.json")).unwrap();
    for guess in guesses {
        let module = snapback.join("m.q");
        if let Some(source) = &guess.module { fs::write(&module, source).unwrap(); }
        else if module.exists() { fs::remove_file(&module).unwrap(); }
        for (repaired, source) in [(false, &guess.source), (true, &guess.repaired)] {
            fs::write(snapback.join("schema.q"), source).unwrap();
            let result = Command::new(env!("CARGO_BIN_EXE_snapback4")).args(["check", "--json"]).current_dir(directory.path()).output().unwrap();
            let text = String::from_utf8(result.stdout).unwrap();
            let checked: Value = serde_json::from_str(&text).unwrap_or_else(|_| panic!("{}: {text}; {:?}", guess.name, result.stderr));
            let problems = checked["problems"].as_array().cloned().unwrap_or_default();
            if !repaired && let Some(code) = &guess.code {
                assert!(!result.status.success(), "{} unexpectedly compiled", guess.name);
                let diag = problems.iter().find(|p| p["code"] == *code).unwrap_or_else(|| panic!("{}: {checked}", guess.name));
                if guess.exact_repair {
                    assert_eq!(diag["rewrite"], guess.repair.as_deref().unwrap(), "{}: {diag}", guess.name);
                    assert_eq!(guess.source.replace("count(*)", diag["rewrite"].as_str().unwrap()), guess.repaired,
                        "the next check must compile the actual emitted replacement");
                } else {
                    assert!(diag["rewrite"].as_str().unwrap().contains(guess.repair.as_deref().unwrap()), "{}: {diag}", guess.name);
                }
                assert!(diag["site"]["line"].as_u64().unwrap() > 0);
                assert!(diag["site"]["col"].as_u64().unwrap() > 0);
                let why = Command::new(env!("CARGO_BIN_EXE_snapback4")).args(["why", code]).current_dir(directory.path()).output().unwrap();
                assert!(why.status.success());
                assert!(why.stdout.len() <= 4096);
                assert!(String::from_utf8(why.stdout).unwrap().contains("Full card:"));
            } else {
                assert!(result.status.success(), "{} repaired={repaired}: {checked}", guess.name);
                assert!(problems.is_empty(), "{}: {checked}", guess.name);
            }
        }
    }
}

#[test]
fn len_retains_its_mechanical_check_fix() {
    let directory = Directory::new();
    fs::create_dir(directory.path().join("snapback")).unwrap();
    let path = directory.path().join("snapback/schema.q");
    fs::write(&path, "query size(x: text):\n  return len(x)\n").unwrap();
    let result = Command::new(env!("CARGO_BIN_EXE_snapback4")).args(["check", "--fix"]).current_dir(directory.path()).output().unwrap();
    assert!(result.status.success(), "{}", String::from_utf8_lossy(&result.stderr));
    assert_eq!(fs::read_to_string(path).unwrap(), "query size(x: text):\n  return count(x)\n");
}

#[test]
fn round_one_diagnostic_rewrites_paste_through_check() {
    let directory = Directory::new();
    fs::create_dir(directory.path().join("snapback")).unwrap();
    let path = directory.path().join("snapback/schema.q");
    let model = "table members:\n  conversation: id\n  active: bool\n  public\n";
    let check = |source: &str| -> Value {
        fs::write(&path, source).unwrap();
        let result = Command::new(env!("CARGO_BIN_EXE_snapback4")).args(["check", "--json"]).current_dir(directory.path()).output().unwrap();
        serde_json::from_slice(&result.stdout).unwrap()
    };
    for op in ["=", "!=", "<", "<=", ">", ">=", "in"] {
        let predicate = if op == "in" { ".conversation in [.conversation]".into() } else { format!(".conversation {op} .conversation") };
        let original = format!("{model}query q(conversation: id, c: cursor ?):\n  return members where {predicate} first 20 after c\n");
        let output = check(&original);
        assert_eq!(output["ok"], false, "{output}");
        let d = output["problems"].as_array().unwrap().iter().find(|d| d["code"] == "E_QUARRY_SELF_EQUALITY").unwrap();
        let repaired = original.replace(&format!("where {predicate}"), d["rewrite"].as_str().unwrap());
        let output = check(&repaired);
        assert_eq!(output["ok"], true, "{output}");
    }
    for (declaration, code, entire) in [
        ("query q():\n  return count(*)\n", "E_QUARRY_UNSUPPORTED", false),
        ("query q(c: cursor ?):\n  return members where .active = .active first 20 after c\n", "E_QUARRY_SELF_EQUALITY", true),
        ("view counts: count members where .conversation = .conversation by .conversation\n", "E_QUARRY_SELF_EQUALITY", true),
        ("query q(c: cursor ?):\n  return members where exists members[active = (.conversation = .conversation)] first 20 after c\n", "E_QUARRY_SELF_EQUALITY", true),
    ] {
        let original = format!("{model}{declaration}");
        let output = check(&original);
        assert_eq!(output["ok"], false, "{output}");
        let d = output["problems"].as_array().unwrap().iter().find(|d| d["code"] == code).unwrap();
        let rewrite = d["rewrite"].as_str().unwrap();
        let repaired = if entire { format!("{model}{rewrite}") } else { original.replace("count(*)", rewrite) };
        let output = check(&repaired);
        assert_eq!(output["ok"], true, "{output}");
    }
}

struct Directory(std::path::PathBuf);
impl Directory {
    fn new() -> Self {
        use std::sync::atomic::{AtomicUsize, Ordering};
        static NEXT: AtomicUsize = AtomicUsize::new(0);
        let path = std::env::temp_dir().join(format!("sb4-familiar-{}-{}", std::process::id(), NEXT.fetch_add(1, Ordering::Relaxed)));
        fs::create_dir(&path).unwrap();
        Self(path)
    }
    fn path(&self) -> &std::path::Path { &self.0 }
}
impl Drop for Directory { fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); } }
