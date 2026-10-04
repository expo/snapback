//! @ref LLP 3000.030#15 — recover abandoned exports only under leases and process birth identities.
use super::*;

pub(super) fn identity(pid: u32) -> Option<Value> { process_identity(pid, false) }
pub(super) fn birth(pid: u32) -> Option<Value> { process_identity(pid, true) }
fn process_identity(pid: u32, include_zombie: bool) -> Option<Value> {
    if pid == 0 { return None; }
    #[cfg(target_os = "macos")]
    {
        let mut info: libc::proc_bsdinfo = unsafe { std::mem::zeroed() };
        let size = std::mem::size_of_val(&info) as i32;
        if include_zombie { return darwin_birth(pid); }
        if unsafe { libc::proc_pidinfo(pid as i32, libc::PROC_PIDTBSDINFO, 0, &mut info as *mut _ as *mut _, size) } != size || info.pbi_status == 5 { return None; }
        Some(json!({ "pid": pid, "start": [info.pbi_start_tvsec, info.pbi_start_tvusec] }))
    }
    #[cfg(target_os = "linux")]
    {
        let bytes = fs::read(format!("/proc/{pid}/stat")).ok()?;
        let fields = linux_stat_fields(&bytes)?;
        if !include_zombie && fields.first() == Some(&b"Z".as_slice()) { return None; }
        Some(json!({ "pid": pid, "start": [fs::read_to_string("/proc/sys/kernel/random/boot_id").ok()?, linux_start(&fields)?] }))
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    { None }
}
#[cfg(target_os = "linux")]
fn linux_stat_fields(bytes: &[u8]) -> Option<Vec<&[u8]>> {
    // comm is arbitrary bytes, including spaces, newlines and parentheses.
    // Only the fields after its LAST ')' have an ASCII numeric contract.
    let end = bytes.iter().rposition(|b| *b == b')')?;
    Some(bytes[end + 1..].split(u8::is_ascii_whitespace).filter(|s| !s.is_empty()).collect())
}
#[cfg(target_os = "linux")]
fn linux_start<'a>(fields: &[&'a [u8]]) -> Option<&'a str> {
    let start = std::str::from_utf8(fields.get(19)?).ok()?;
    if start.is_empty() || !start.bytes().all(|b| b.is_ascii_digit()) { return None; }
    start.parse::<u64>().ok()?;
    Some(start)
}
// PROC_PIDTBSDINFO excludes zombies on Darwin. KERN_PROC_PID includes the
// unreaped leader. This is the stable prefix of SDK sys/proc.h's extern_proc,
// the first field of kinfo_proc; the oversized buffer accepts its opaque tail.
#[cfg(target_os = "macos")]
fn darwin_birth(pid: u32) -> Option<Value> {
    #[repr(C)]
    struct Prefix { start: libc::timeval, vm: *mut libc::c_void, signals: *mut libc::c_void, flags: i32, state: i8, pid: i32 }
    let mut mib = [libc::CTL_KERN, libc::KERN_PROC, libc::KERN_PROC_PID, pid as i32];
    let mut buffer = [0u64; 256];
    let mut size = std::mem::size_of_val(&buffer);
    if unsafe { libc::sysctl(mib.as_mut_ptr(), 4, buffer.as_mut_ptr().cast(), &mut size, std::ptr::null_mut(), 0) } != 0 || size < std::mem::size_of::<Prefix>() { return None; }
    let info = unsafe { &*buffer.as_ptr().cast::<Prefix>() };
    if info.pid != pid as i32 { return None; }
    Some(json!({ "pid": pid, "start": [info.start.tv_sec, info.start.tv_usec] }))
}
fn alive(record: &Value) -> bool {
    record["pid"].as_u64().and_then(|pid| identity(pid as u32)).as_ref() == Some(record) && !record.is_null()
}
fn read(path: &Path) -> Value { fs::read(path).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or(Value::Null) }
fn write(path: &Path, value: &Value) -> Result<()> {
    let temp = path.with_extension("json.tmp");
    let mut file = File::create(&temp).map_err(|e| error("E_WITNESS_ARTIFACT", e))?;
    file.write_all(&serde_json::to_vec(value).unwrap()).and_then(|_| file.sync_all()).map_err(|e| error("E_WITNESS_ARTIFACT", e))?;
    fs::rename(temp, path).map_err(|e| error("E_WITNESS_ARTIFACT", e))
}
fn update(options: &Options, change: impl FnOnce(&mut Value)) -> Result<()> {
    if options.export.is_none() { return Ok(()); }
    let path = options.artifacts.join("live.json");
    let mut value = read(&path);
    if value.is_null() { return Err(error("E_WITNESS_ARTIFACT", "export has no process ownership record")); }
    change(&mut value); write(&path, &value)
}
pub(super) fn child(options: &Options, label: &str, pid: u32) -> Result<()> {
    let id = identity(pid);
    update(options, |value| value["children"][label] = id.map_or(Value::Null, |id| id))
}
pub(super) fn group_record(options: &Options, label: &str, record: &Value) -> Result<()> {
    let pid = record["group"].as_u64().ok_or_else(|| error("E_WITNESS_PROCESS", "missing native process group"))? as u32;
    if birth(pid).as_ref() != Some(&record["leader"]) || unsafe { libc::getpgid(pid as i32) } != pid as i32 {
        return Err(error("E_WITNESS_PROCESS", "native process group birth differs"));
    }
    update(options, |value| value["children"][label] = record.clone())
}
pub(super) fn simulator(options: &Options, simulator: &Value) -> Result<()> {
    update(options, |value| value["simulator"] = simulator.clone())
}
pub(super) fn app(options: &Options, pid: Option<u32>, udid: &str, bundle: &str, dir: &Path) -> Result<()> {
    update(options, |value| {
        value["app"] = pid.and_then(identity).unwrap_or(Value::Null);
        value["udid"] = json!(udid); value["bundle"] = json!(bundle); value["staging"] = json!(dir);
    })
}
pub(super) fn begin_wrapper(dir: &Path) -> Result<()> {
    write(&dir.join("live.json"), &json!({ "owner": null, "wrapper": std::env::var("SNAPBACK4_EXPORT_WRAPPER_PID").ok().and_then(|s| s.parse().ok()).and_then(identity), "children": {}, "startedAt": now() }))
}
pub(super) fn begin(options: &Options) -> Result<Option<File>> {
    if options.export.is_none() { return Ok(None); }
    if let Some(root) = options.artifacts.parent() {
        cleanup(root, None)?;
    }
    let lease = preparation::lease(&options.artifacts.join("run.lock"))?;
    let owner = identity(std::process::id()).ok_or_else(|| error("E_WITNESS_PROCESS", "cannot record driver process start time"))?;
    let wrapper = std::env::var("SNAPBACK4_EXPORT_WRAPPER_PID").ok().and_then(|s| s.parse().ok()).and_then(identity);
    write(&options.artifacts.join("live.json"), &json!({ "owner": owner, "wrapper": wrapper, "children": {}, "startedAt": now() }))?;
    Ok(Some(lease))
}
fn stop(record: &Value, signal: i32) -> Result<()> {
    if record["group"].is_number() { return stop_group(record); }
    recorded_process::stop(record, signal)
}
pub(super) fn members(group: u32) -> Result<Vec<Value>> {
    if group == 0 || group > i32::MAX as u32 { return Err(error("E_WITNESS_PROCESS", "invalid process group")); }
    // @ref LLP 3000.030#15 — inspect the owned group without launching ps;
    // each returned member still binds its birth and current group membership.
    #[cfg(target_os = "macos")]
    {
        let mut pids = vec![0i32; 32];
        loop {
            // libproc returns a PID COUNT, takes a BYTE capacity, and maps
            // syscall errors to zero. Clear errno to distinguish empty/error.
            unsafe { *libc::__error() = 0; }
            let count = unsafe { libc::proc_listpgrppids(group as i32, pids.as_mut_ptr().cast(), (pids.len() * std::mem::size_of::<i32>()) as i32) };
            let errno = std::io::Error::last_os_error();
            if count < 0 || (count == 0 && errno.raw_os_error() != Some(0)) {
                return Err(error("E_WITNESS_PROCESS", format!("cannot inspect process group: {errno}")));
            }
            if (count as usize) < pids.len() { pids.truncate(count as usize); break; }
            // A full buffer can be truncated, including when the group grows
            // between calls. Retry with room; never turn truncation into empty.
            if pids.len() >= 1 << 20 { return Err(error("E_WITNESS_PROCESS", "process group enumeration kept growing")); }
            pids.resize(pids.len() * 2, 0);
        }
        let mut live = Vec::new();
        for pid in pids.into_iter().filter(|p| *p > 0) {
            let mut info: libc::proc_bsdinfo = unsafe { std::mem::zeroed() };
            let size = std::mem::size_of_val(&info) as i32;
            let read = unsafe { libc::proc_pidinfo(pid, libc::PROC_PIDTBSDINFO, 0, &mut info as *mut _ as *mut _, size) };
            if read != size {
                let errno = std::io::Error::last_os_error();
                if read == 0 && errno.raw_os_error() == Some(libc::ESRCH) { continue; }
                return Err(error("E_WITNESS_PROCESS", format!("cannot inspect group member: {errno}")));
            }
            if info.pbi_pgid == group && info.pbi_status != 5 {
                live.push(json!({ "pid": pid, "start": [info.pbi_start_tvsec, info.pbi_start_tvusec] }));
            }
        }
        Ok(live)
    }
    #[cfg(target_os = "linux")]
    {
        let mut live = Vec::new();
        let boot = fs::read_to_string("/proc/sys/kernel/random/boot_id").map_err(|e| error("E_WITNESS_PROCESS", e))?;
        for entry in fs::read_dir("/proc").map_err(|e| error("E_WITNESS_PROCESS", e))? {
            let entry = entry.map_err(|e| error("E_WITNESS_PROCESS", e))?;
            let Some(pid) = entry.file_name().to_str().and_then(|s| s.parse::<u32>().ok()) else { continue; };
            let member = linux_member(pid, group, &boot, fs::read(entry.path().join("stat")), || {
                let pgid = unsafe { libc::getpgid(pid as i32) };
                if pgid < 0 { Err(std::io::Error::last_os_error()) } else { Ok(pgid as u32) }
            })?;
            if let Some(member) = member { live.push(member); }
        }
        Ok(live)
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    { Err(error("E_WITNESS_PROCESS", "process group inspection is unsupported")) }
}
#[cfg(target_os = "linux")]
fn linux_member(pid: u32, group: u32, boot: &str, stat: std::io::Result<Vec<u8>>, get_group: impl FnOnce() -> std::io::Result<u32>) -> Result<Option<Value>> {
    let bytes = match stat {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound || e.raw_os_error() == Some(libc::ESRCH) => return Ok(None),
        Err(e) => {
            // hidepid may deny stat even though getpgid can identify an
            // unrelated group. Unknown or in-group processes still fail closed.
            match get_group() {
                Ok(pgid) if pgid > 0 && pgid != group => return Ok(None),
                Err(gone) if gone.raw_os_error() == Some(libc::ESRCH) => return Ok(None),
                _ => return Err(error("E_WITNESS_PROCESS", e)),
            }
        }
    };
    let fields = linux_stat_fields(&bytes).unwrap_or_default();
    let pgid = fields.get(2).and_then(|s| std::str::from_utf8(s).ok())
        .filter(|s| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit()))
        .and_then(|s| s.parse::<u32>().ok()).filter(|pgid| *pgid <= i32::MAX as u32)
        .ok_or_else(|| error("E_WITNESS_PROCESS", "invalid /proc process group"))?;
    // Once the row unambiguously names another group, none of its other
    // fields can fail this inspection. Decode/validate member details below.
    if pgid != group { return Ok(None); }
    let state = fields[0];
    if state.len() != 1 || !state[0].is_ascii_alphabetic() {
        return Err(error("E_WITNESS_PROCESS", "invalid /proc process state"));
    }
    let start = linux_start(&fields).ok_or_else(|| error("E_WITNESS_PROCESS", "invalid /proc process birth"))?;
    if state == b"Z" { return Ok(None); }
    Ok(Some(json!({ "pid": pid, "start": [boot, start] })))
}

#[cfg(all(test, target_os = "linux"))]
mod linux_tests {
    use super::*;
    use std::io::{BufRead, BufReader};
    use std::os::unix::process::CommandExt;

    fn row(group: u32, state: &[u8], start: &[u8]) -> Vec<u8> {
        let mut bytes = b"42 (odd \xff ) (name) ".to_vec();
        bytes.extend_from_slice(state);
        bytes.extend_from_slice(format!(" 1 {group} {} ", vec!["0"; 16].join(" ")).as_bytes());
        bytes.extend_from_slice(start);
        bytes
    }
    fn inspect(bytes: Vec<u8>) -> Result<Option<Value>> {
        linux_member(42, 123, "boot", Ok(bytes), || panic!("a readable stat must supply its own group"))
    }

    #[test]
    fn outside_group_non_utf8_comm_does_not_break_enumeration() {
        let mut selected = Owned::spawn(Command::new("sleep").arg("60").process_group(0)).unwrap();
        // The shell changes its own comm, then blocks in a builtin without an
        // exec that would reset it. The ready pipe proves the bytes are installed.
        let mut outside = Owned::spawn(Command::new("sh").args(["-c", "printf '\\377 bad) (x)' > /proc/self/comm; printf 'ready\\n'; read line"])
            .process_group(0).stdin(Stdio::piped()).stdout(Stdio::piped())).unwrap();
        let mut ready = String::new();
        BufReader::new(outside.0.stdout.take().unwrap()).read_line(&mut ready).unwrap();
        assert_eq!(ready, "ready\n");
        let raw = fs::read(format!("/proc/{}/stat", outside.0.id())).unwrap();
        assert!(std::str::from_utf8(&raw).is_err());
        assert_eq!(members(selected.0.id()).unwrap(), vec![identity(selected.0.id()).unwrap()]);
        // The same arbitrary comm is valid inside the selected group too,
        // and enumeration must retain the ordinary birth identity shape.
        assert_eq!(members(outside.0.id()).unwrap(), vec![identity(outside.0.id()).unwrap()]);
        assert!(outside.status().unwrap().is_none());
        outside.0.kill().unwrap(); outside.0.wait().unwrap();
        selected.0.kill().unwrap(); selected.0.wait().unwrap();
    }

    #[test]
    fn outside_group_details_cannot_fail_a_readable_row() {
        for (state, start) in [(b"S".as_slice(), b"".as_slice()), (b"\xff", b"bad"), (b"bad-state", b"\xff"), (b"Z", b"18446744073709551616")] {
            assert!(inspect(row(456, state, start)).unwrap().is_none());
            assert!(inspect(row(123, state, start)).unwrap_err().contains("E_WITNESS_PROCESS"));
        }
        assert!(inspect(b"42 (name) S 1 456".to_vec()).unwrap().is_none());
        assert!(inspect(b"42 (name) S 1 123".to_vec()).is_err());
        assert_eq!(inspect(row(123, b"S", b"987")).unwrap(), Some(json!({"pid": 42, "start": ["boot", "987"]})));
        assert!(inspect(row(123, b"Z", b"987")).unwrap().is_none());
    }

    #[test]
    fn unknown_group_fails_closed() {
        for bytes in [b"42 no closing comm".as_slice(), b"42 (name) S 1", b"42 (name) S 1 \xff", b"42 (name) S 1 -1", b"42 (name) S 1 2147483648"] {
            assert!(inspect(bytes.to_vec()).unwrap_err().contains("invalid /proc process group"));
        }
    }

    #[test]
    fn stat_read_errors_only_skip_known_outside_groups_or_disappearance() {
        for errno in [libc::EACCES, libc::EPERM, libc::EIO] {
            let inspect_error = |pgid| linux_member(42, 123, "boot", Err(std::io::Error::from_raw_os_error(errno)), || pgid);
            assert!(inspect_error(Ok(456)).unwrap().is_none());
            assert!(inspect_error(Ok(123)).unwrap_err().contains("E_WITNESS_PROCESS"));
            assert!(inspect_error(Ok(0)).is_err());
            assert!(inspect_error(Err(std::io::Error::from_raw_os_error(libc::EPERM))).is_err());
            assert!(inspect_error(Err(std::io::Error::from_raw_os_error(libc::ESRCH))).unwrap().is_none());
        }
        for errno in [libc::ENOENT, libc::ESRCH] {
            assert!(linux_member(42, 123, "boot", Err(std::io::Error::from_raw_os_error(errno)), || panic!("already gone")).unwrap().is_none());
        }
    }
}
fn stop_group(record: &Value) -> Result<()> { stop_group_with(record, || {}) }
pub(super) fn stop_group_with(record: &Value, mut after_snapshot: impl FnMut()) -> Result<()> {
    let group = record["group"].as_u64().unwrap() as u32;
    let mut deadline = cleanup::Deadline::new(Instant::now());
    let initial = members(group)?;
    deadline.observe(Instant::now(), initial.len());
    if initial.is_empty() {
        sleep(Duration::from_millis(20));
        if members(group)?.is_empty() { return Ok(()); }
    }
    // The native guardian retains its child as a zombie after leader exit.
    // This lock forbids it from reaping while recovery signals/inspects. The
    // birth must still match AFTER taking the lock; a number alone grants none.
    let _reap = record["reapLock"].as_str().map(|p| -> Result<File> {
        let file = File::options().read(true).write(true).open(p).map_err(|e| error("E_WITNESS_PROCESS", e))?;
        deadline.lock(&file)?; Ok(file)
    }).transpose()?;
    let ours = || birth(group).as_ref() == Some(&record["leader"]) &&
        (unsafe { libc::getpgid(group as i32) } == group as i32 ||
         // Darwin getpgid also hides zombies. Their birth plus the live
         // retaining parent and held reaping lock bind the original group.
         (identity(group).is_none() && _reap.is_some() && alive(&record["guardian"])));
    if !ours() { return Err(error("E_WITNESS_PROCESS", "abandoned process group has no matching birth record; workspace cleanup refused")); }
    let mut empty = 0;
    loop {
        let live = members(group)?;
        deadline.observe(Instant::now(), live.len());
        if live.is_empty() {
            empty += 1;
            if empty == 2 { return Ok(()); }
        } else {
            empty = 0;
            after_snapshot();
            if !ours() { return Err(error("E_WITNESS_PROCESS", "lost custody while inspecting abandoned process group")); }
            // Signal the GROUP, including members joining the final snapshot.
            // STOP inhibits new forks before KILL; the retained leader permits
            // another group KILL when kernel delivery/exit is still in flight.
            for signal in [libc::SIGSTOP, libc::SIGKILL] {
                if !ours() { return Err(error("E_WITNESS_PROCESS", "lost custody of abandoned process group")); }
                if unsafe { libc::kill(-(group as i32), signal) } < 0 && std::io::Error::last_os_error().raw_os_error() != Some(libc::ESRCH) {
                    return Err(error("E_WITNESS_PROCESS", std::io::Error::last_os_error()));
                }
            }
        }
        deadline.check(Instant::now(), "abandoned process group cleanup")?;
        sleep(Duration::from_millis(20));
    }
}

fn recover(dir: &Path) -> Result<bool> {
    let mut record = read(&dir.join("live.json"));
    if alive(&record["owner"]) {
        // A wrapper killed with SIGKILL cannot forward cancellation. Request
        // cleanup from its still-live driver, by its recorded birth identity.
        if record["wrapper"].is_null() || alive(&record["wrapper"]) { return Ok(false); }
        stop(&record["owner"], libc::SIGTERM)?;
    }
    let Ok(_run) = preparation::lease(&dir.join("run.lock")) else { return Ok(false); };
    record = read(&dir.join("live.json"));
    if alive(&record["owner"]) { return Ok(false); }
    if record.is_null() {
        // Legacy runs have no start-time record: never infer process ownership
        // from a PID in a directory name. Leave them alone unless completed.
        return Ok(false);
    }
    // If the driver died during create, its isolated child may have printed
    // the identity after the last journal update. Stop that exact child first,
    // then recover the printed identity together with the pre-create intent.
    if record["simulator"]["selection"] == "created" && record["simulator"]["udid"].is_null() {
        stop(&record["children"]["create"], libc::SIGTERM)?;
        let text = fs::read_to_string(dir.join("simulator-create.stdout")).unwrap_or_default();
        let id = match simulator::created_udid(&text) { Some(id) => Some(id.to_owned()), None => simulator::reconcile_created(&record["simulator"])? };
        if let Some(id) = id {
            record["simulator"]["udid"] = json!(id);
            // Keep the journal unchanged while a wrapper has custody.
            if let Ok(_export) = preparation::lease(&dir.join("export.lock")) {
                write(&dir.join("live.json"), &record)?;
            }
        }
    }
    let simulator = &record["simulator"];
    let mut owners = ownership::Records::open(simulator::owners()?);
    let udid = simulator["udid"].as_str().filter(|s| name(s));
    let _simulator_lease = match udid { Some(id) => Some(owners.lease(id)?), None => None };
    // Do not stop a replacement app, even on our simulator. Both PID and birth
    // time must match, and the simulator lease stays held through shutdown.
    let mut active = alive(&record["app"]);
    if let Some(children) = record["children"].as_object() {
        for process in children.values() {
            active |= if let Some(group) = process["group"].as_u64() { !members(group as u32)?.is_empty() } else { alive(process) };
        }
        for process in children.values() { stop(process, libc::SIGTERM)?; }
    }
    if let Some(udid) = udid {
        let mut owned = owners.read(udid);
        if simulator["selection"] == "created" && simulator["ready"] == false {
            match simulator::reconcile_created(simulator)? {
                Some(id) if id == udid => {
                    if owned.is_null() { owners.write(udid, simulator)?; owned = simulator.clone(); }
                }
                None => {
                    // Normal rollback may already have deleted it before the
                    // driver exited. Do not recreate an ownership tombstone.
                    if owned["udid"] == udid && owned["name"] == simulator["name"] && owned["ready"] == false { owners.remove(udid)?; }
                    owned = Value::Null;
                }
                _ => return Err(error("E_WITNESS_SIMULATOR", "creation identity differs from its journal; leaving devices untouched")),
            }
        }
        if owned["udid"] == udid && owned["name"] == simulator["name"] && owned["runtime"] == simulator["runtime"] && !owned["prefix"].is_null() {
            if owned["ready"] == false {
                simctl(&["delete", udid], Duration::from_secs(10))?;
                owners.remove(udid)?;
            } else if active {
            // Respect the legacy simulator-home lease as well as the lease
            // available before boot. If HOME cannot be resolved, no shutdown.
            let home = simctl(&["getenv", udid, "HOME"], Duration::from_secs(10))?;
            {
                let _home_lease = preparation::lease(&Path::new(&home).join(".snapback4-witness-owner.lock"))?;
                if alive(&record["app"]) {
                    let bundle = record["bundle"].as_str().unwrap_or_default();
                    if app_pid(&simctl(&["spawn", udid, "launchctl", "list"], Duration::from_secs(10))?, bundle)? == record["app"]["pid"].as_u64().map(|n| n as u32) {
                        recorded_process::stop(&record["app"], libc::SIGTERM)?;
                    }
                }
                // Staging is nested in a recorded tool-owned simulator. Refuse
                // any other path even if a damaged journal supplies one.
                if let Some(staging) = record["staging"].as_str() {
                    let path = Path::new(staging);
                    if path.starts_with(Path::new(&home)) && staging.contains("/Documents/.snapback4-witness/") { let _ = fs::remove_dir_all(path); }
                }
                if alive(&record["app"]) { return Err(error("E_WITNESS_PROCESS", "recorded app survived recovery")); }
                simctl(&["shutdown", udid], Duration::from_secs(10))?;
            }
            }
        }
    }
    if alive(&record["app"]) { return Err(error("E_WITNESS_PROCESS", "cannot clean up recorded app without simulator custody")); }
    // Process recovery is independent of wrapper custody. A surviving wrapper
    // owns the export and journal through publication, even after driver exit.
    let Ok(_export) = preparation::lease(&dir.join("export.lock")) else { return Ok(false); };
    if !publication::reconcile_orphan(dir)? {
        eprintln!("witness: interrupted publication preserved at {}; publication recovery required (see publication-pending.json)", dir.display());
        return Ok(false);
    }
    for entry in fs::read_dir(dir).map_err(|e| error("E_WITNESS_ARTIFACT", e))? {
        let entry = entry.map_err(|e| error("E_WITNESS_ARTIFACT", e))?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.ends_with(".app") || name.ends_with(".xcresult") || name.ends_with(".tmp") || name == "preparation-tmp" {
            remove(&entry.path())?;
        }
    }
    write(&dir.join("finished.json"), &json!({ "finishedAt": now(), "abandoned": true, "recovered": true }))?;
    eprintln!("witness: recovered abandoned export {}", dir.display());
    Ok(true)
}
pub(super) fn remove(path: &Path) -> Result<()> {
    let result = if path.is_dir() && !path.is_symlink() { fs::remove_dir_all(path) } else { fs::remove_file(path) };
    result.or_else(|e| if e.kind() == std::io::ErrorKind::NotFound { Ok(()) } else { Err(e) }).map_err(|e| error("E_WITNESS_ARTIFACT", e))
}
const RECEIPTS: &[&str] = &["smoke-ios-run.json", "smoke-ios-receipts.jsonl", "proof.json", "build.json", "installed.json", "preparation-failure.json", "native-base.json", "live.json", "publication.json"];
pub(super) fn cleanup(root: &Path, completed: Option<&Path>) -> Result<()> {
    fs::create_dir_all(root).map_err(|e| error("E_WITNESS_ARTIFACT", e))?;
    // Blocking OS lock: no PID-file takeover race, and SIGKILL releases it.
    let lock = OpenOptions::new().read(true).write(true).create(true).truncate(false).open(root.join("retention.lock")).map_err(|e| error("E_WITNESS_ARTIFACT", e))?;
    lock.lock().map_err(|e| error("E_WITNESS_ARTIFACT", e))?;
    // A wrapper reporting driver exit does not establish cleanup. In particular
    // SIGKILL leaves owned backend/compilers and app copies behind.
    if let Some(dir) = completed { recover(dir)?; }
    let mut runs = Vec::new();
    for entry in fs::read_dir(root).map_err(|e| error("E_WITNESS_ARTIFACT", e))? {
        let entry = entry.map_err(|e| error("E_WITNESS_ARTIFACT", e))?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if !entry.file_type().is_ok_and(|t| t.is_dir()) || !name.split_once('-').is_some_and(|(a,b)| a.parse::<u128>().is_ok() && b.parse::<u32>().is_ok()) { continue; }
        let dir = entry.path();
        let run = read(&dir.join("smoke-ios-run.json"));
        let finished = dir.join("finished.json").exists() || (read(&dir.join("live.json")).is_null() && run["exitStatus"].is_number() && (run["endedAt"].is_number() || run["finishedAt"].is_number()));
        // Even a finalized receipt may precede a driver's last cleanup/drop.
        if alive(&read(&dir.join("live.json"))["owner"]) && finished { continue; }
        // Also reconcile prematurely finished runs and the five full-evidence
        // slots, which otherwise bypass recover() and the compression loop.
        if finished && dir.join("publication-pending.json").exists() {
            let Ok(_run) = preparation::lease(&dir.join("run.lock")) else { continue; };
            let Ok(_export) = preparation::lease(&dir.join("export.lock")) else { continue; };
            if !publication::reconcile_orphan(&dir)? { continue; }
        }
        if finished || recover(&dir)? { runs.push(dir); }
    }
    runs.sort_by_key(|p| std::cmp::Reverse(p.file_name().unwrap().to_string_lossy().split('-').next().unwrap().parse::<u128>().unwrap()));
    // Five full runs plus at most twenty compressed receipt sets. Pin the
    // current native producer separately in the cache (saveBase owns its copy).
    for (index, dir) in runs.iter().enumerate().skip(5) {
        let Ok(_run) = preparation::lease(&dir.join("run.lock")) else { continue; };
        let Ok(_export) = preparation::lease(&dir.join("export.lock")) else { continue; };
        if dir.join("publication-pending.json").exists() { continue; }
        if index >= 25 { remove(dir)?; continue; }
        if dir.join("retention.json").exists() { continue; }
        let mut retained = Vec::new(); let mut removed = Vec::new();
        for entry in fs::read_dir(dir).map_err(|e| error("E_WITNESS_ARTIFACT", e))? {
            let entry = entry.map_err(|e| error("E_WITNESS_ARTIFACT", e))?;
            let name = entry.file_name().to_string_lossy().into_owned();
            if ["finished.json", "run.lock", "export.lock"].contains(&name.as_str()) { continue; }
            if name.ends_with(".gz") && RECEIPTS.contains(&name.trim_end_matches(".gz")) { retained.push(name); continue; }
            if RECEIPTS.contains(&name.as_str()) && entry.file_type().is_ok_and(|t| t.is_file()) {
                let compressed = Command::new("gzip").args(["-n", "-c"]).arg(entry.path()).output().map_err(|e| error("E_WITNESS_ARTIFACT", e))?;
                if !compressed.status.success() { return Err(error("E_WITNESS_ARTIFACT", "receipt compression failed")); }
                let target = dir.join(format!("{name}.gz"));
                let temporary = dir.join(format!("{name}.gz.tmp"));
                fs::write(&temporary, compressed.stdout).and_then(|_| fs::rename(temporary, target)).map_err(|e| error("E_WITNESS_ARTIFACT", e))?;
                retained.push(format!("{name}.gz"));
            } else { removed.push(name); }
            remove(&entry.path())?;
        }
        write(&dir.join("retention.json"), &json!({ "retained": retained, "removed": removed }))?;
    }
    Ok(())
}
pub(super) fn command(args: &[String]) -> i32 {
    let result = if args.len() == 1 || args.len() == 2 {
        cleanup(Path::new(&args[0]), args.get(1).map(Path::new))
    } else { Err(error("E_WITNESS_INPUT", "export-cleanup requires the export artifact root and optional completed run")) };
    match result { Ok(()) => 0, Err(e) => { eprintln!("witness: evidence cleanup deferred: {e}"); 1 } }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn abandoned_bulk_and_backend_wait_for_the_run_lease_and_reject_a_reused_pid() {
        let root = std::env::temp_dir().join(format!("sb4-abandoned-{}-{}", std::process::id(), now()));
        let dir = root.join("1-123"); fs::create_dir_all(dir.join("export.app")).unwrap();
        fs::create_dir_all(dir.join("build.xcresult")).unwrap();
        fs::create_dir_all(dir.join("preparation-tmp")).unwrap();
        let mut backend = Owned::spawn(Command::new("sleep").arg("60")).unwrap();
        let mut owner = identity(std::process::id()).unwrap(); owner["start"] = json!([0, 0]);
        write(&dir.join("live.json"), &json!({ "owner": owner, "children": { "backend": identity(backend.0.id()).unwrap() } })).unwrap();
        let lease = preparation::lease(&dir.join("run.lock")).unwrap();
        cleanup(&root, None).unwrap();
        assert!(dir.join("export.app").exists()); assert!(backend.status().unwrap().is_none());
        drop(lease);
        cleanup(&root, None).unwrap();
        assert!(!dir.join("export.app").exists()); assert!(!dir.join("build.xcresult").exists()); assert!(!dir.join("preparation-tmp").exists());
        assert_eq!(read(&dir.join("finished.json"))["abandoned"], true);
        assert!(backend.status().unwrap().is_some());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn recovery_drains_a_live_preparation_descendant_before_finishing_even_with_a_live_wrapper() {
        use std::os::unix::process::CommandExt;
        let root = std::env::temp_dir().join(format!("sb4-group-recover-{}-{}", std::process::id(), now()));
        let dir = root.join("1-123"); fs::create_dir_all(dir.join("export.app")).unwrap();
        let runner = dir.join("runner.mjs"); fs::write(&runner, include_str!("preparation-runner.mjs")).unwrap();
        let heartbeat = dir.join("heartbeat");
        let code = "const fs=require('fs');process.on('SIGTERM',()=>{});setInterval(()=>fs.appendFileSync(process.argv[1],'x'),20)";
        let args: Vec<String> = ["ios", "--build", ".", "--smoke", "--artifacts", dir.to_str().unwrap()].into_iter().map(String::from).collect();
        let options = Options::parse(&args).unwrap();
        let runtime = preparation::node_runtime(&options, std::ffi::OsStr::new("node")).unwrap();
        let mut keeper = Command::new(&runtime).arg(runner).arg(dir.join("status.json")).arg(&runtime).args(["-e", code]).arg(&heartbeat)
            .process_group(0).stdin(Stdio::piped()).stdout(Stdio::null()).stderr(Stdio::null()).spawn().unwrap();
        let leader = identity(keeper.id()).unwrap();
        let group = json!({ "group": keeper.id(), "leader": leader });
        let mut invalid = group.clone(); invalid["leader"]["start"] = json!([0,0]);
        assert!(stop_group(&invalid).is_err(), "recycled leader must not authorize group signals");
        write(&dir.join("live.json"), &json!({ "owner": null, "wrapper": identity(std::process::id()), "children": { "preparation": group } })).unwrap();
        keeper.stdin.take().unwrap().write_all(b"start\n").unwrap();
        let end = Instant::now() + Duration::from_secs(5);
        while !heartbeat.exists() && Instant::now() < end { sleep(Duration::from_millis(20)); }
        assert!(heartbeat.exists());
        let lease = preparation::lease(&dir.join("export.lock")).unwrap();
        let journal = fs::read(dir.join("live.json")).unwrap();
        cleanup(&root, Some(&dir)).unwrap();
        keeper.wait().unwrap();
        assert!(!dir.join("finished.json").exists());
        assert!(dir.join("export.app").exists());
        assert_eq!(fs::read(dir.join("live.json")).unwrap(), journal);
        drop(lease);
        cleanup(&root, Some(&dir)).unwrap();
        assert!(members(keeper.id()).unwrap().is_empty());
        assert!(!dir.join("export.app").exists());
        assert_eq!(read(&dir.join("finished.json"))["recovered"], true);
        let bytes = fs::read(&heartbeat).unwrap(); sleep(Duration::from_millis(100));
        assert_eq!(bytes, fs::read(&heartbeat).unwrap());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn witness_group_leader_exit_during_member_snapshot_revokes_custody() {
        use std::os::unix::process::CommandExt;
        let mut leader = Owned::spawn(Command::new("sleep").arg("60").process_group(0)).unwrap();
        let record = json!({ "group": leader.0.id(), "leader": identity(leader.0.id()).unwrap() });
        let result = stop_group_with(&record, || { leader.stop(libc::SIGKILL).unwrap(); });
        assert!(result.unwrap_err().contains("lost custody while inspecting"));
    }

    #[test]
    fn pid_reuse_does_not_keep_an_abandoned_run_alive() {
        let mut id = identity(std::process::id()).unwrap();
        assert!(alive(&id)); id["start"] = json!([0, 0]); assert!(!alive(&id));
    }

    #[test]
    fn live_wrapper_lease_preserves_export_and_journal_after_driver_exit() {
        let root = std::env::temp_dir().join(format!("sb4-wrapper-{}-{}", std::process::id(), now()));
        let dir = root.join("1-123"); fs::create_dir_all(dir.join("export")).unwrap();
        fs::write(dir.join("export/bundle"), "proved bytes").unwrap();
        let mut driver = Owned::spawn(Command::new("sleep").arg("60")).unwrap();
        let owner = identity(driver.0.id()).unwrap(); driver.stop(libc::SIGTERM).unwrap();
        let journal = json!({ "owner": owner, "wrapper": identity(std::process::id()), "children": {} });
        write(&dir.join("live.json"), &journal).unwrap();
        let before = fs::read(dir.join("live.json")).unwrap();
        let lease = preparation::lease(&dir.join("export.lock")).unwrap();
        for i in 2..=6 {
            let newer = root.join(format!("{i}-123")); fs::create_dir_all(&newer).unwrap();
            write(&newer.join("finished.json"), &json!({ "finishedAt": now() })).unwrap();
        }
        cleanup(&root, Some(&dir)).unwrap();
        assert_eq!(fs::read(dir.join("live.json")).unwrap(), before);
        assert_eq!(fs::read_to_string(dir.join("export/bundle")).unwrap(), "proved bytes");
        assert!(!dir.join("finished.json").exists());
        // Even a prematurely finalized/legacy record cannot bypass custody.
        write(&dir.join("finished.json"), &json!({ "finishedAt": now() })).unwrap();
        cleanup(&root, None).unwrap();
        assert!(dir.join("export/bundle").exists());
        drop(lease);
        cleanup(&root, None).unwrap();
        assert!(!dir.join("export").exists());
        fs::remove_dir_all(root).unwrap();
    }
}
