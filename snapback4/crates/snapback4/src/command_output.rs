//! Presentation-only transcript custody. Execution never reads this history.
// @ref LLP 3000.037.000#9-repeat-command-output-budgets-tok2 — complete details, bounded verdicts and disposable deltas.
use std::{cell::RefCell, collections::BTreeMap, fmt, io::{Read, Write}, path::{Path, PathBuf}};
use serde_json::Value;
use sha2::{Digest, Sha256};

#[derive(Default)]
struct Transcript {
    text: String,
    details: String,
    summary: String,
    facts: BTreeMap<String, String>,
    state: Option<Value>,
    machine: Vec<Value>,
    streams: Vec<(String, bool)>,
}
thread_local! { static ACTIVE: RefCell<Option<Transcript>> = const { RefCell::new(None) }; }

/// Verb-local print macros delegate here only during a budgeted command.
pub(crate) fn write(args: fmt::Arguments<'_>, stderr: bool, newline: bool) {
    let captured = ACTIVE.with_borrow_mut(|active| {
        if let Some(t) = active {
            use std::fmt::Write;
            let _ = t.text.write_fmt(args);
            if newline { t.text.push('\n'); }
            t.streams.push((format!("{args}{}",if newline {"\n"} else {""}),stderr));
            true
        } else { false }
    });
    if !captured {
        let mut out: Box<dyn Write> = if stderr { Box::new(std::io::stderr()) } else { Box::new(std::io::stdout()) };
        let _ = out.write_fmt(args);
        if newline { let _ = out.write_all(b"\n"); }
    }
}
pub(crate) fn summary(text: impl Into<String>) {
    ACTIVE.with_borrow_mut(|t| if let Some(t) = t { t.summary = text.into(); });
}
pub(crate) fn fact(key: impl Into<String>, text: impl Into<String>) {
    ACTIVE.with_borrow_mut(|t| if let Some(t) = t { t.facts.insert(key.into(), text.into()); });
}
pub(crate) fn evidence(value: &impl serde::Serialize) {
    ACTIVE.with_borrow_mut(|t| if let Some(t) = t {
        t.details.push_str(&serde_json::to_string_pretty(value).unwrap_or_default());
        t.details.push('\n');
        if let Ok(value) = serde_json::to_value(value) { t.machine.push(value); }
    });
}
pub(crate) fn state(value: Value) {
    ACTIVE.with_borrow_mut(|t| if let Some(t) = t { t.state = Some(value); });
}
fn single(text: &str) -> String { text.trim_end_matches('\n').replace('\n', " ") }
fn hash(text: impl AsRef<[u8]>) -> String { format!("{:x}", Sha256::digest(text.as_ref())) }

fn private_write(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let parent = path.parent().unwrap();
    snapback4_core::private_fs::directory(parent)?;
    static SERIAL: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let tmp = parent.join(format!(".output-{}-{}.tmp", std::process::id(), SERIAL.fetch_add(1, std::sync::atomic::Ordering::Relaxed)));
    let result = (|| {
        let mut f = snapback4_core::private_fs::file(&tmp, true)?;
        f.write_all(bytes)?;
        std::fs::rename(&tmp, path)
    })();
    if result.is_err() { let _ = std::fs::remove_file(tmp); }
    result
}

fn root() -> PathBuf {
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    crate::project::Project::locate(&cwd).map_or(cwd, |p| p.root)
}
pub(crate) fn retain(verb: &str, text: &str) -> std::io::Result<PathBuf> {
    let private = root().join(".snapback4");
    snapback4_core::private_fs::directory(&private)?;
    let path = private.join("last").join(format!("{verb}.txt"));
    private_write(&path,text.as_bytes())?;
    Ok(path)
}
fn history(path: &Path) -> BTreeMap<String,String> {
    let read = || -> std::io::Result<_> {
        use std::os::unix::fs::OpenOptionsExt;
        let file=std::fs::OpenOptions::new().read(true).custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK).open(path)?;
        let metadata=file.metadata()?;
        const LIMIT:u64=8*1024*1024;
        if !metadata.is_file() || metadata.len()>LIMIT {return Err(std::io::Error::other("nonregular or oversized presentation history"));}
        let mut bytes=Vec::new();file.take(LIMIT+1).read_to_end(&mut bytes)?;
        if bytes.len() as u64>LIMIT {return Err(std::io::Error::other("presentation history grew beyond its bound"));}
        Ok(serde_json::from_slice(&bytes).unwrap_or_default())
    };
    read().unwrap_or_default()
}

pub(crate) fn display_path(path: &Path) -> String {
    std::env::current_dir().ok().and_then(|cwd|path.strip_prefix(cwd).ok().map(|p|p.display().to_string())).unwrap_or_else(||path.display().to_string())
}

pub(crate) fn run(verb: &str, options: &crate::verbs::Options, body: impl FnOnce() -> i32) -> i32 {
    // Existing machine protocols remain byte-for-byte complete. test previously
    // emitted prose for --json; it now supplies a complete transcript envelope.
    if options.json && verb != "test" { return body(); }
    ACTIVE.with_borrow_mut(|t| *t = Some(Transcript::default()));
    let code = body();
    finish(verb, options, code);
    code
}

pub(crate) fn flush_exit(code: i32) {
    if ACTIVE.with_borrow(Option::is_some) {
        let args: Vec<_> = std::env::args().skip(1).collect();
        finish(args.first().map(String::as_str).unwrap_or("test"), &crate::verbs::parse(&args), code);
    }
}

pub(crate) fn released(verb: &str, release: u64, generation: &impl fmt::Display, live: &Value, adoption: &str) {
    summary(format!("{verb}: release {release} current, generation {generation}; {adoption}"));
    if live["exact"] == false {
        fact("source", format!("rollback view of release {} (registered by {}); --exact selects original source", live["target"], live["parent"]));
    }
    if live["rowShape"]["matchesTarget"] == false { fact("row shape",crate::output_facts::row_shape(&live["rowShape"])); }
}

pub(crate) fn preview_decisions(preview: &Value) {
    let hazards=preview["hazards"].as_array().into_iter().flatten().filter_map(Value::as_str).map(str::to_owned).collect::<Vec<_>>();
    let hazards=snapback4_lang::client_contracts::compact(&hazards);
    if !hazards.is_empty() {fact("hazards",format!("WARNING {}; next: prove affected cases before activation",hazards.join("; WARNING ")));}
    backfills(&preview["backfills"]);
    if preview["rowShape"]["matchesTarget"]==false {
        fact("row shape",crate::output_facts::row_shape(&preview["rowShape"]));
    }
    for key in ["rollbackVisibility","rollbackViewEffects"] {
        let value=&preview[key];
        let effects=value.as_array().map(|a|a.iter().map(|v|&v["visibility"]).collect::<Vec<_>>()).unwrap_or_else(||vec![value]);
        if effects.iter().any(|v|["hiddenRows","emptyCells","newerOnlyRows"].iter().any(|k|v[*k].as_u64().unwrap_or(0)>0)) {
            fact(key,format!("{key}: {value}; dormant images are retained, not deleted; prove affected real-account reads"));
        }
    }
}
pub(crate) fn backfills(value:&Value) {
    let lines=value.as_array().into_iter().flatten().filter_map(Value::as_str).map(|s|format!("backfill: {s}")).collect::<Vec<_>>();
    if lines.is_empty() {ACTIVE.with_borrow_mut(|t|if let Some(t)=t {t.facts.remove("backfills");});}
    else {fact("backfills",lines.join("; "));}
}

pub(crate) fn finish(verb: &str, options: &crate::verbs::Options, code: i32) {
    let Some(t) = ACTIVE.with_borrow_mut(Option::take) else { return; };
    if options.json {
        println!("{}", serde_json::json!({"ok":code==0,"code":code,"report":t.text,"evidence":t.machine}));
        return;
    }
    let directory = root().join(".snapback4/last");
    let path = directory.join(format!("{verb}.txt"));
    let detail = format!("{}{}", t.text, t.details);
    if let Err(error) = retain(verb, &detail) {
        // Loss of detail custody must never hide evidence or change the
        // command's already-decided exit status (activation may have committed).
        for (text,stderr) in t.streams {write(format_args!("{text}"),stderr,false);}
        if !t.details.is_empty() {eprint!("{}",t.details);}
        eprintln!("{verb}: details unavailable: {error}; full output shown");
        return;
    }
    if options.flags.contains_key("verbose") || options.flags.contains_key("explain") || options.flags.contains_key("review") {
        for (text,stderr) in t.streams {write(format_args!("{text}"),stderr,false);}
        println!("details: {}", display_path(&path));
        return;
    }
    // Keep gate answer commands independently copyable. Refusals have room for
    // six command lines plus verdict, grouped facts and detail path. Additional
    // commands remain in the complete grouped refusal and retained transcript.
    let mut actions=Vec::new();
    if code!=0 {
        for line in t.text.lines().map(str::trim).filter(|l|l.starts_with("Intended: snapback4 ")) {
            let command=line.strip_suffix(" (required before check can pass)").unwrap_or(line);
            if !actions.contains(&command.to_owned()) {actions.push(command.to_owned());}
        }
    }
    let mut parts = t.facts;
    parts.insert("verdict".into(), if code == 0 && !t.summary.is_empty() { t.summary } else {
        format!("{verb}: {}", if code == 0 {"completed"} else {"REFUSED / failed"})
    });
    if code != 0 {
        // Keep refusal wording and all diagnostics, including multiline compiler
        // rewrites, intact apart from whitespace. No first-N truncation.
        parts.insert("refusal".into(), single(&t.text));
    }
    let repeat = code == 0 && (verb == "releases" || verb == "data" || verb == "deploy" && options.flags.contains_key("check"));
    let scope = hash(serde_json::to_vec(&(verb, std::env::current_dir().ok(), &options.positionals, &options.flags)).unwrap());
    let cache = directory.join(format!("{verb}-{scope}.json"));
    let old = if repeat { history(&cache) } else { BTreeMap::new() };
    let mut fingerprints: BTreeMap<_, _> = parts.iter().map(|(k,v)| (k.clone(),hash(v))).collect();
    let mut state_parts = BTreeMap::new();
    if let Some(state) = t.state {
        fingerprints.insert("state".into(),hash(serde_json::to_vec(&state).unwrap()));
        if let Some(object) = state.as_object() {
            for (key, value) in object {
                if key == "rows" {
                    for (n,row) in value.as_array().into_iter().flatten().enumerate() {
                        let id=row["id"].as_str().map(str::to_owned).unwrap_or_else(||n.to_string());
                        state_parts.insert(format!("state/row {id}"),row.clone());
                    }
                } else {state_parts.insert(format!("state/{key}"),value.clone());}
            }
        }
        for (key,value) in &state_parts {fingerprints.insert(key.clone(),hash(serde_json::to_vec(value).unwrap()));}
    }
    let unchanged = repeat && fingerprints == old;
    // A failed history write reprints everything. History only follows a
    // successfully retained complete transcript; losing it cannot hide a fact.
    let saved = !repeat || private_write(&cache, &serde_json::to_vec(&fingerprints).unwrap()).is_ok();
    if unchanged && saved {
        println!("{verb}: unchanged; details: {}",display_path(&path));
        return;
    }
    let changed = |key: &str| !repeat || !saved || old.get(key) != fingerprints.get(key);
    let emit = |text:String| write(format_args!("{text}"),code!=0,true);
    if changed("verdict") { emit(single(&parts["verdict"])); }
    let mut facts = parts.iter().filter(|(k,_)| k.as_str() != "verdict" && changed(k)).map(|(_,v)|single(v)).collect::<Vec<_>>();
    for key in old.keys().filter(|k| k.as_str() != "state" && !fingerprints.contains_key(*k)) { facts.push(format!("resolved: {}",key.trim_start_matches("state/"))); }
    if !old.is_empty() {
        let changes=state_parts.iter().filter(|(k,_)|changed(k)).map(|(k,v)| {
            let name=k.trim_start_matches("state/");
            if v.is_object() || v.is_array() {format!("{name} changed (details)")} else {format!("{name}={v}")}
        }).collect::<Vec<_>>();
        if !changes.is_empty() {facts.push(format!("changed: {}",changes.join(", ")));}
    }
    if !facts.is_empty() { emit(facts.join(" | ")); }
    for action in actions.into_iter().take(6) {emit(action);}
    if !old.is_empty() && changed("state") && facts.is_empty() { emit(format!("{verb}: result changed; inspect details")); }
    emit(format!("details: {}; --explain for full output",display_path(&path)));
}

#[cfg(all(test,unix))]
mod tests {
    use super::*;
    #[test]
    fn history_rejects_fifo_symlink_corrupt_and_oversized_files_without_waiting() {
        use std::os::unix::{ffi::OsStrExt,fs::symlink};
        let root=std::env::temp_dir().join(format!("tok2-history-files-{}",std::process::id()));
        let _=std::fs::remove_dir_all(&root);std::fs::create_dir(&root).unwrap();
        let fifo=root.join("fifo");let c=std::ffi::CString::new(fifo.as_os_str().as_bytes()).unwrap();
        assert_eq!(unsafe{libc::mkfifo(c.as_ptr(),0o600)},0);
        let start=std::time::Instant::now();assert!(history(&fifo).is_empty());assert!(start.elapsed()<std::time::Duration::from_secs(1));
        let regular=root.join("regular");std::fs::write(&regular,b"{\"verdict\":\"a hash\"}").unwrap();
        let link=root.join("link");symlink(&regular,&link).unwrap();assert!(history(&link).is_empty());assert_eq!(history(&regular)["verdict"],"a hash");
        std::fs::write(&regular,b"corrupt").unwrap();assert!(history(&regular).is_empty());
        std::fs::File::create(&regular).unwrap().set_len(8*1024*1024+1).unwrap();assert!(history(&regular).is_empty());
        std::fs::remove_dir_all(root).unwrap();
    }
}
