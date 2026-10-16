//! Public CLI contracts from the builder's entry point.
use std::{fs, path::PathBuf, process::{Command, Output}, sync::atomic::{AtomicUsize, Ordering}};
const BIN: &str = env!("CARGO_BIN_EXE_snapback4");
static SERIAL: AtomicUsize = AtomicUsize::new(0);
struct App(PathBuf);
impl App {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!("surf4-{}-{}", std::process::id(), SERIAL.fetch_add(1, Ordering::Relaxed)));
        fs::create_dir_all(&path).unwrap(); Self(path)
    }
    fn run(&self, args: &[&str]) -> Output { Command::new(BIN).current_dir(&self.0).args(args).env_remove("PORT_LO").env_remove("PORT_HI").output().unwrap() }
}
impl Drop for App { fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); } }
fn success(output: Output) -> String {
    assert!(output.status.success(), "{output:?}"); String::from_utf8(output.stdout).unwrap()
}
#[test]
fn run_clock_reset_port_help_describes_only_supported_ports() {
    let app = App::new();
    for verb in ["run", "clock", "reset"] {
        let help = success(app.run(&[verb, "--help"]));
        assert!(help.contains("--port N") && help.contains("1–65535"), "{help}");
        assert!(!help.contains("0 chooses") && !help.contains("A-B tries"), "{help}");
        let output = app.run(&[verb, "--port", "0"]);
        assert!(!output.status.success(), "{verb}: {output:?}");
    }
}
#[test]
fn clock_does_not_advertise_an_always_refused_release_flag() {
    let app = App::new(); let help = success(app.run(&["clock", "--help"]));
    assert!(!help.contains("--release"), "{help}");
    let output = app.run(&["clock", "advance", "1h", "--release", "missing"]);
    assert_eq!(output.status.code(), Some(2));
    assert!(String::from_utf8_lossy(&output.stderr).contains("takes no --release"));
    assert_eq!(fs::read_dir(&app.0).unwrap().count(), 0);
}
#[test]
fn web_shell_help_includes_base_and_upgrade_includes_positional_version() {
    let app = App::new();
    assert!(success(app.run(&["web-shell", "--help"])).contains("[--base /]"));
    assert!(success(app.run(&["upgrade", "--help"])).starts_with("snapback4 upgrade [version]"));
}
#[test]
fn new_help_is_about_templates_and_social_dry_run_writes_nothing() {
    let app = App::new();
    let new = success(app.run(&["new", "--help"])); let init = success(app.run(&["init", "--help"]));
    assert!(new.contains("Choose a full reference template")); assert_ne!(new, init);
    let top = success(app.run(&["--help"]));
    assert!(top.contains("Create a full reference app:"));
    let preview = success(app.run(&["new", "social", "--template", "social", "--dry-run"]));
    assert!(preview.contains("preview only") && preview.contains("app/_layout.tsx"), "{preview}");
    assert!(!app.0.join("social").exists());
    let actual = success(app.run(&["new", "social", "--template", "social"]));
    assert!(actual.contains("wrote")); assert!(app.0.join("social/app/_layout.tsx").is_file());
}
#[test]
fn init_redirected_output_has_no_ansi() {
    let app = App::new(); let output = success(app.run(&["init", "web", "--web"]));
    assert!(!output.contains('\u{1b}')); assert!(output.contains("npm install"));
}
#[test]
fn every_public_verb_help_matches_the_shared_parser_table_and_wrapper_synopsis() {
    let app = App::new();
    let table: serde_json::Value = serde_json::from_str(include_str!("../../../packages/snapback4/bin/cli-commands.json")).unwrap();
    for command in table.as_array().unwrap() {
        let verb = command["verb"].as_str().unwrap(); let help = success(app.run(&[verb, "--help"]));
        let flags = help.split("Flags (validated before any project or store work):\n").nth(1).unwrap();
        let printed: Vec<_> = flags.lines().filter_map(|line| line.trim().strip_prefix("--")).map(|line| line.split_whitespace().next().unwrap()).collect();
        let mut expected: Vec<_> = command["flags"].as_array().unwrap().iter().map(|flag| flag["name"].as_str().unwrap()).collect(); expected.push("help");
        assert_eq!(printed, expected, "{verb}");
        let wrapper = Command::new("node").args(["--input-type=module", "-e", "import {synopsis} from './packages/snapback4/bin/cli-usage.js'; console.log(synopsis(process.argv[1]))", verb]).current_dir(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")).output().unwrap();
        assert!(wrapper.status.success(), "{wrapper:?}"); assert_eq!(help.lines().next(), String::from_utf8(wrapper.stdout).unwrap().lines().next(), "{verb}");
        let invalid = app.run(&[verb, "--surf4-unknown"]);
        assert_eq!(invalid.status.code(), Some(2), "{verb}: {invalid:?}");
    }
}
#[test]
fn guide_testing_index_selects_the_exact_numbered_heading() {
    let app = App::new(); let index = success(app.run(&["guide", "testing", "--sections"]));
    let card = success(app.run(&["guide", "testing", "--full"]));
    for (n, (_, heading, _, _)) in snapback4_lang::guide::sections(&card).iter().enumerate() {
        assert!(index.contains(&format!("{}. {heading}", n + 1)), "{index}");
        let selected = success(app.run(&["guide", "testing", "--section", &(n + 1).to_string()]));
        assert!(selected.lines().skip(1).find(|line| line.starts_with("##")).unwrap().ends_with(heading), "{selected}");
    }
}
#[test]
fn runtime_error_code_is_printed_once() {
    let refusal = snapback4_core::RuntimeError::Schema("no table unknown".into()).refusal();
    assert_eq!(refusal.code, "E_SCHEMA"); assert_eq!(refusal.message, "no table unknown");
    assert!(!refusal.to_string().contains("E_SCHEMA: E_SCHEMA"));
}
#[test]
fn releases_json_uses_the_documented_field_names() {
    let app = App::new(); fs::create_dir(app.0.join("snapback")).unwrap();
    fs::write(app.0.join("snapback/schema.q"), "query alive():\n  return true\n").unwrap();
    success(app.run(&["deploy", "deployment"]));
    let status: serde_json::Value = serde_json::from_str(&success(app.run(&["releases", "deployment", "latest", "--json"]))).unwrap();
    for field in ["release", "previous_active", "latest", "generation", "revision", "native_digest", "events", "events_after", "items", "items_after", "event", "workers", "selected"] { assert!(status.get(field).is_some(), "missing {field}: {status}"); }
    assert_eq!(status["release"], 1); assert_eq!(status["selected"]["current"], true);
}
