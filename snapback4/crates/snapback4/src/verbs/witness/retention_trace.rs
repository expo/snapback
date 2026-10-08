//! @ref LLP 3000.030#15 — debug evidence must never wait on native custody's thread.
use super::*;
use std::os::{fd::AsRawFd, unix::fs::OpenOptionsExt};
use std::sync::{OnceLock, mpsc::{SyncSender, sync_channel}};

const LIMIT: u64 = 256 * 1024;
const LINE_LIMIT: usize = 4096;
struct Event { root: PathBuf, step: &'static str, detail: Value, at: u128 }
static WRITER: OnceLock<Option<SyncSender<Event>>> = OnceLock::new();

pub(super) fn emit(root: &Path, step: &'static str, detail: Value) {
    let sender = WRITER.get_or_init(|| {
        let (sender, events) = sync_channel::<Event>(32);
        // Never join this writer, flush it, or pass it custody descriptors. A
        // stalled filesystem can occupy this one thread; it cannot hold a lease
        // or make the producer wait. Saturation/exit may lose diagnostic events.
        std::thread::Builder::new().name("retention-trace".into()).spawn(move || {
            for event in events { let _ = append(event); }
        }).ok().map(|_| sender)
    });
    if let Some(sender) = sender {
        let _ = sender.try_send(Event { root: root.into(), step, detail, at: now() });
    }
}

fn append(event: Event) -> std::io::Result<()> {
    let mut file = OpenOptions::new().create(true).append(true).mode(0o600)
        .custom_flags(libc::O_NONBLOCK | libc::O_NOFOLLOW | libc::O_CLOEXEC)
        .open(event.root.join("retention-trace.jsonl"))?;
    let metadata = file.metadata()?;
    if !metadata.is_file() || metadata.nlink() != 1 || metadata.uid() != unsafe { libc::geteuid() } { return Ok(()); }
    // A nonblocking diagnostic-only flock makes the size bound collective across
    // processes. It is never a maintenance lease and never waits for a writer.
    if unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) } != 0 { return Ok(()); }
    let size = file.metadata()?.len();
    if size >= LIMIT { return Ok(()); }
    file.set_permissions(std::os::unix::fs::PermissionsExt::from_mode(0o600))?;
    let mut line = serde_json::to_vec(&json!({ "at": event.at, "pid": std::process::id(), "step": event.step, "detail": event.detail }))?;
    if line.len() >= LINE_LIMIT {
        line = serde_json::to_vec(&json!({ "at": event.at, "pid": std::process::id(), "step": event.step, "detailTruncated": true }))?;
    }
    line.push(b'\n');
    if size + line.len() as u64 + 128 > LIMIT {
        // Fill the tail using at most two bounded terminal records. The reserve
        // can exceed LINE_LIMIT by 127 bytes; never pad one line past its cap.
        // Subsequent writers skip the full file using only its length.
        let remaining = ((LIMIT - size) as usize).min(LINE_LIMIT);
        let marker = b"{\"step\":\"trace-truncated\",\"limitBytes\":262144}";
        if remaining >= marker.len() + 1 {
            let mut tail = vec![b' '; remaining];
            tail[..marker.len()].copy_from_slice(marker);
            tail[remaining - 1] = b'\n';
            file.write_all(&tail)?;
        }
        return Ok(());
    }
    file.write_all(&line)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn trace_sink_refuses_links_and_bounds_a_regular_file() {
        let root = std::env::temp_dir().join(format!("sb4-trace-{}-{}", std::process::id(), now()));
        fs::create_dir(&root).unwrap();
        let event = || Event { root: root.clone(), step: "test", detail: json!("x".repeat(5000)), at: now() };
        let sink = root.join("retention-trace.jsonl");
        let outside = root.join("outside"); fs::write(&outside, "unchanged").unwrap();
        std::os::unix::fs::symlink(&outside, &sink).unwrap();
        assert!(append(event()).is_err());
        assert_eq!(fs::read_to_string(&outside).unwrap(), "unchanged");
        fs::remove_file(&sink).unwrap();
        fs::write(&sink, vec![b' '; LIMIT as usize - 256]).unwrap();
        for _ in 0..20 { append(event()).unwrap(); }
        let bytes = fs::read(&sink).unwrap();
        assert_eq!(bytes.len(), LIMIT as usize);
        assert!(String::from_utf8(bytes).unwrap().contains("trace-truncated"));
        assert_eq!(fs::metadata(&sink).unwrap().mode() & 0o777, 0o600);
        // The reserve branch can have more than 4 KiB remaining even though
        // the ordinary event fits in one line. Include that boundary explicitly.
        let prefix = LIMIT as usize - LINE_LIMIT - 64;
        fs::write(&sink, vec![b'\n'; prefix]).unwrap();
        for _ in 0..3 {
            append(Event { root: root.clone(), step: "test", detail: json!("x".repeat(LINE_LIMIT - 100)), at: now() }).unwrap();
        }
        let bytes = fs::read(&sink).unwrap();
        assert_eq!(bytes.len(), LIMIT as usize);
        for line in bytes[prefix..].split_inclusive(|b| *b == b'\n') {
            assert!(line.len() <= LINE_LIMIT, "terminal line exceeded 4 KiB: {}", line.len());
            let record: Value = serde_json::from_slice(line).unwrap();
            assert_eq!(record["step"], "trace-truncated");
        }
        fs::remove_dir_all(root).unwrap();
    }
}
