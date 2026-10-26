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
fn clock_release_help_describes_staging_and_missing_store_stays_read_only() {
    let app = App::new(); let help = success(app.run(&["clock", "--help"]));
    assert!(help.contains("--release") && help.contains("staging") && help.contains("Production refuses"), "{help}");
    let output = app.run(&["clock", "advance", "1h", "--release", "missing"]);
    assert!(!output.status.success());
    assert!(!app.0.join("missing").exists());
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
    assert!(!output.contains('\u{1b}')); assert!(output.contains("node scripts/install.mjs"));
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
    assert_eq!(status["release"], 1); assert_eq!(status["current"], status["release"]); assert_eq!(status["selected"]["current"], true);
}

#[test]
fn release_consumers_refuse_without_creating_any_files() {
    let app = App::new();
    for existing in [false, true] {
        let dir = app.0.join(if existing { "empty" } else { "missing" });
        if existing { fs::create_dir(&dir).unwrap(); }
        let path = dir.to_str().unwrap();
        for args in [vec!["serve", path], vec!["token", "--release", path, "--service", "ops"],
            vec!["rollback", path], vec!["rollback", path, "--check"], vec!["prune", path], vec!["releases", path, "--json"],
            vec!["data", "notes", "--release", path], vec!["sql", "select 1", "--release", path],
            vec!["doctor", "--release", path, "--json"], vec!["run", "alive", "--release", path],
            vec!["why", "E_SCHEMA", "--release", path]] {
            let output = app.run(&args);
            assert!(!output.status.success(), "{args:?}: {output:?}");
            assert!(output.stdout.is_empty(), "{output:?}");
            assert!(String::from_utf8_lossy(&output.stderr).contains("no current release"), "{output:?}");
            if existing { assert_eq!(fs::read_dir(&dir).unwrap().count(), 0, "{args:?}"); }
            else { assert!(!dir.exists(), "{args:?}"); }
        }
    }
}
#[test]
fn release_preflight_uses_database_selection_without_convenience_pointer() {
    let app = App::new(); fs::create_dir(app.0.join("snapback")).unwrap();
    fs::write(app.0.join("snapback/schema.q"), "query alive():\n  return true\n").unwrap();
    success(app.run(&["deploy", "deployment"]));
    fs::remove_file(app.0.join("deployment/current")).unwrap();
    success(app.run(&["token", "--release", "deployment", "--service", "ops", "--quiet"]));
    let value: serde_json::Value = serde_json::from_str(&success(app.run(&["releases", "deployment", "--json"]))).unwrap();
    assert_eq!(value["release"], 1);
    fs::write(app.0.join("deployment/current"), "999\n").unwrap();
    success(app.run(&["token", "--release", "deployment", "--service", "ops", "--quiet"]));
}

#[test]
fn discovery_names_directory_roles_seed_and_current_release() {
    let app = App::new();
    let help = success(app.run(&["deploy", "--help"]));
    assert!(help.contains("deployment directory") && help.contains("file.q|source-dir"), "{help}");
    let seed = success(app.run(&["seed", "--help"]));
    assert!(seed.starts_with("snapback4 seed <fixtures-dir|seed.json>") && seed.contains("POST /seed"), "{seed}");
    let missing = app.run(&["seed"]); assert!(!missing.status.success());
    assert!(!String::from_utf8_lossy(&missing.stderr).contains("unknown verb"));
    assert_eq!(fs::read_dir(&app.0).unwrap().count(), 0);
    assert!(success(app.run(&["guide", "bootstrap"])).contains("Production"));
    let guide = success(app.run(&["guide", "testing"]));
    assert!(guide.lines().nth(1).unwrap().contains("Truncated:"), "{guide}");
    assert!(guide.contains("## ") && guide.contains("--full"), "{guide}");
}
#[test]
fn init_port_note_is_conditional_and_preview_rules_are_indented() {
    let app = App::new();
    assert!(!success(app.run(&["init", "web", "--web"])).contains("PORT_LO/PORT_HI set at init"));
    let output = Command::new(BIN).current_dir(&app.0).args(["init", "ranged", "--web"]).env("PORT_LO", "25000").env("PORT_HI", "25009").output().unwrap();
    assert!(success(output).contains("PORT_LO/PORT_HI set at init"));
    fs::create_dir(app.0.join("snapback")).unwrap();
    fs::write(app.0.join("snapback/schema.q"), "use personas alice\ntable members:\n  principal: principal\n  unique principal\n  read <- .principal = viewer -- own seat\n  insert <- deny\n  online only\n").unwrap();
    let preview = success(app.run(&["init", "--adapt", "--production"]));
    assert!(preview.contains("  read <- (\n    .principal = viewer -- own seat\n  ) or viewer = 'service:ops'"), "{preview}");
    assert!(preview.contains("  insert <- (\n    deny\n  ) or viewer = 'service:ops'"), "{preview}");
}

#[test]
fn release_consumers_refuse_a_development_store_without_new_sidecars() {
    let app = App::new();let dir=app.0.join("development");fs::create_dir(&dir).unwrap();
    { let _store=snapback4_core::Store::open(&dir.join("store.sqlite")).unwrap(); }
    drop(snapback4_core::private_fs::owner_file(&dir.join("store.sqlite")).unwrap());
    let names=|| { let mut names=fs::read_dir(&dir).unwrap().map(|e|e.unwrap().file_name()).collect::<Vec<_>>();names.sort();names };
    // Reproduce a checkpointed WAL database whose sidecars have been removed.
    for suffix in ["-wal", "-shm"] { let _=fs::remove_file(dir.join(format!("store.sqlite{suffix}"))); }
    let before=names();let path=dir.to_str().unwrap();
    for args in [vec!["serve",path],vec!["token","--release",path,"--service","ops"],vec!["rollback",path],vec!["prune",path],
        vec!["data","notes","--release",path],vec!["sql","select 1","--release",path],
        vec!["doctor","--release",path,"--json"],vec!["run","alive","--release",path],vec!["why","E_SCHEMA","--release",path]] {
        let output=app.run(&args);assert!(!output.status.success(),"{output:?}");assert_eq!(names(),before,"{args:?}");
    }
}

#[test]
fn current_selector_keeps_legacy_pointer_fallback() {
    let app=App::new();fs::create_dir(app.0.join("snapback")).unwrap();
    fs::write(app.0.join("snapback/schema.q"),"query alive():\n  return true\n").unwrap();
    success(app.run(&["deploy","deployment"]));
    let conn=rusqlite::Connection::open(app.0.join("deployment/store.sqlite")).unwrap();
    conn.execute("DELETE FROM _meta WHERE key='release'",[]).unwrap();drop(conn);
    let value:serde_json::Value=serde_json::from_str(&success(app.run(&["releases","deployment","current","--json"]))).unwrap();
    assert_eq!(value["current"],1);assert_eq!(value["release"],1);assert_eq!(value["selected"]["release"],1);
}

#[test]
fn administrative_release_consumers_can_inspect_damaged_retained_source() {
    let app=App::new();fs::create_dir(app.0.join("snapback")).unwrap();
    fs::write(app.0.join("snapback/schema.q"),"table notes:\n  body: text <=50\n  public 'test'\n  online only\n").unwrap();
    success(app.run(&["deploy","deployment"]));
    fs::write(app.0.join("deployment/releases/1/snapback/schema.q"),"broken retained source\n").unwrap();
    assert_eq!(success(app.run(&["data","notes","--release","deployment","--json"])).trim(),"{\"limit\":50,\"more\":false,\"rows\":[]}");
    success(app.run(&["token","--release","deployment","--service","ops","--quiet"]));
    let doctor=app.run(&["doctor","--release","deployment","--json"]);
    assert!(!doctor.status.success());
    let value:serde_json::Value=serde_json::from_slice(&doctor.stdout).unwrap();
    assert_eq!(value["storage"]["row_count"],0);
}

#[test]
fn failed_seed_discovery_does_not_open_a_legacy_store_or_create_sidecars() {
    let app=App::new();fs::create_dir(app.0.join("snapback")).unwrap();
    fs::write(app.0.join("snapback/schema.q"),"query alive():\n  return true\n").unwrap();
    let dir=app.0.join(".snapback4");fs::create_dir(&dir).unwrap();
    { let _store=snapback4_core::Store::open(&dir.join("store.sqlite")).unwrap(); }
    let listener=std::net::TcpListener::bind("127.0.0.1:0").unwrap();let address=listener.local_addr().unwrap();drop(listener);
    fs::write(dir.join("serve.lock"),format!("{}\nhttp://{address}\n",address.port())).unwrap();
    fs::write(app.0.join("seed.json"),"[]").unwrap();
    for suffix in ["-wal","-shm"] {let _=fs::remove_file(dir.join(format!("store.sqlite{suffix}")));}
    let snapshot=|| {let mut files=fs::read_dir(&dir).unwrap().map(|e| {let path=e.unwrap().path();(path.file_name().unwrap().to_owned(),path.is_file().then(||fs::read(&path).unwrap()))}).collect::<Vec<_>>();files.sort();files};
    let before=snapshot();let result=app.run(&["seed","seed.json"]);
    assert!(!result.status.success(),"{result:?}");assert!(String::from_utf8_lossy(&result.stderr).contains("no running dev discovered"),"{result:?}");
    assert_eq!(snapshot(),before);
}

#[test]
fn data_json_reports_default_truncation_empty_and_explicit_limits() {
    let app=App::new();fs::create_dir(app.0.join("snapback")).unwrap();
    fs::write(app.0.join("snapback/schema.q"),"use personas alice\ntable notes:\n  body: text <=50\n  public 'test'\n  insert <- allow\nmutation add():\n  return insert notes {body: 'row'}\n").unwrap();
    success(app.run(&["run","add","--as","alice"]));
    for _ in 1..51 {success(app.run(&["run","add","--as","alice"]));}
    for (flags,count,more,limit) in [(vec![],50,true,50),(vec!["--limit","51"],51,false,51),(vec!["--limit","0"],0,true,0)] {
        let mut args=vec!["data","notes","--json"];args.extend(flags);
        let output=success(app.run(&args));let page:serde_json::Value=serde_json::from_str(&output).unwrap();
        assert_eq!(page["rows"].as_array().unwrap().len(),count);assert_eq!(page["more"],more);assert_eq!(page["limit"],limit);
    }
}

#[test]
fn wait_stopped_is_read_only_and_flags_refuse_before_project_work() {
    let app=App::new();let missing=app.0.join("missing");
    let out=app.run(&["serve","missing","--wait-stopped"]);assert!(!out.status.success());assert!(!missing.exists());
    let out=app.run(&["serve","missing","--wait-stopped","--worker","worker.mjs"]);assert_eq!(out.status.code(),Some(2));assert!(!missing.exists());
    fs::create_dir(app.0.join("snapback")).unwrap();fs::write(app.0.join("snapback/schema.q"),"query alive():\n  return true\n").unwrap();
    success(app.run(&["deploy","deployment"]));
    let dir=app.0.join("deployment");let names=||{let mut files=fs::read_dir(&dir).unwrap().map(|e|e.unwrap().file_name()).collect::<Vec<_>>();files.sort();files};
    let before=names();let db=fs::read(dir.join("store.sqlite")).unwrap();
    success(app.run(&["serve","deployment","--wait-stopped"]));assert_eq!(names(),before);assert_eq!(fs::read(dir.join("store.sqlite")).unwrap(),db);
}

#[cfg(unix)]
#[test]
fn deploy_and_rollback_wait_before_admission_even_with_a_closing_listener_hint() {
    use std::{thread,time::Duration,process::Stdio};
    let app=App::new();fs::create_dir(app.0.join("snapback")).unwrap();
    let source=app.0.join("snapback/schema.q");fs::write(&source,"query version():\n  return 1\n").unwrap();success(app.run(&["deploy","deployment"]));
    fs::write(&source,"query version():\n  return 2\n").unwrap();success(app.run(&["deploy","deployment"]));
    for (n,args) in [(3,vec!["rollback","deployment","--to","1"]),(4,vec!["deploy","deployment"])] {
        fs::write(&source,format!("query version():\n  return {n}\n")).unwrap();
        let database=app.0.join("deployment/store.sqlite");let lock=snapback4_core::private_fs::owner_file(&database).unwrap();lock.try_lock().unwrap();
        // A TCP listener can still be open after its private control endpoint
        // goes away. It is a hint, never permission to replay activation.
        let listener=std::net::TcpListener::bind("127.0.0.1:0").unwrap();let address=listener.local_addr().unwrap();
        fs::write(app.0.join("deployment/serve.lock"),format!("{}\nhttp://{address}\n",address.port())).unwrap();
        let child=Command::new(BIN).current_dir(&app.0).args(args).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().unwrap();
        thread::sleep(Duration::from_millis(150));drop(lock);
        let output=child.wait_with_output().unwrap();success(output);drop(listener);
    }
    let status:serde_json::Value=serde_json::from_str(&success(app.run(&["releases","deployment","--json"]))).unwrap();
    assert_eq!(status["generation"],4); // exactly one activation per command
}
