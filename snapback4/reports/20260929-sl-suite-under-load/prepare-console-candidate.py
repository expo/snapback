"""Prepare a deterministic stderr-interleaving regression and its product fix.

Only ignored candidates are written. Apply between completed whole-suite runs.
"""
import hashlib,json,subprocess
from pathlib import Path
root=Path(__file__).resolve().parents[2]
path='crates/snapback4/src/dev_refusal_console.rs'
base='38abb89b8e0b206644b9e2619c6f2d159a981d23'
original=subprocess.check_output(['git','show',f'{base}:snapback4/{path}'],cwd=root,text=True)
test='''    #[test]
    fn shutdown_diagnostic_cannot_split_a_counted_refusal_line() {
        // Lifecycle diagnostics bypass Rust's stderr mutex. Simulate one
        // arriving after the writer's first fragment, as observed at shutdown.
        struct Interrupted { bytes: Vec<u8>, inserted: bool }
        impl std::io::Write for Interrupted {
            fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
                self.bytes.extend_from_slice(bytes);
                if !self.inserted {
                    self.inserted = true;
                    self.bytes.extend_from_slice(b"SNAPBACK4_THREAD_EXIT verb=dev generation=1 thread=\\\"worker\\\" reason=\\\"shutdown\\\"\\n");
                }
                Ok(bytes.len())
            }
            fn flush(&mut self) -> std::io::Result<()> { Ok(()) }
        }
        let mut out = Interrupted { bytes: Vec::new(), inserted: false };
        let mut console = Console::default();
        let now = Instant::now();
        let identity = json!({"storeId":"store", "instance":"instance"});
        let record = json!({"operation":"add", "code":"E_RULE", "table":"rows",
            "clause":"insert rule", "phase":"insert rule", "site":"schema.q:5:3",
            "executionSite":"add:3", "generation":1, "requestId":2});
        for _ in 0..8 { console.push_at(record.clone(), now, &identity, &mut out); }
        assert!(out.bytes.is_empty(), "the aggregation window is still open");
        console.flush_all(&identity, &mut out);
        let text = String::from_utf8(out.bytes).unwrap();
        let lines: Vec<_> = text.lines().collect();
        assert_eq!(lines.len(), 2, "{text}");
        assert!(lines[0].starts_with("dev refusal: add: rows — insert rule at schema.q:5:3;"), "{text}");
        assert!(lines[0].contains("code \\\"E_RULE\\\"; count 8; window 1s; first request 2;"), "{text}");
        assert!(lines[0].ends_with("`snapback4 why recent --instance instance`"), "{text}");
        assert_eq!(lines[1], "SNAPBACK4_THREAD_EXIT verb=dev generation=1 thread=\\\"worker\\\" reason=\\\"shutdown\\\"", "{text}");
    }
'''
marker='    #[test]\n    fn counts_repeats_without_sliding_and_separates_causes()'
assert original.count(marker)==1
control=original.replace(marker,test+marker)
needle='        let _ = writeln!(out, "dev refusal:';assert control.count(needle)==1
candidate=control.replace(needle,'''        // @ref LLP 3000.015#2.1 — a counted refusal remains one line beside lifecycle diagnostics.
        // Raw signal/thread-exit writes do not share Rust's stderr lock. Format
        // the complete line before touching the descriptor, so they cannot
        // splice themselves between this message's formatting fragments.
        let line = format!("dev refusal:''')
needle='`snapback4 why recent --instance {}`",';assert candidate.count(needle)==1
candidate=candidate.replace(needle,'`snapback4 why recent --instance {}`\\n",',1)
needle='identity["instance"].as_str().unwrap_or(""));';assert candidate.count(needle)==1
candidate=candidate.replace(needle,needle+'\n        let _ = out.write_all(line.as_bytes());',1)
e={'path':path,'before_sha256':hashlib.sha256(original.encode()).hexdigest()}
for kind,text in [('control',control),('candidate',candidate)]:
 p=root/f'target/sl-load/console-{kind}.rs';p.write_text(text);e[kind]=str(p.relative_to(root));e[kind+'_sha256']=hashlib.sha256(p.read_bytes()).hexdigest()
(root/'target/sl-load/console-candidate.json').write_text(json.dumps(e,indent=2)+'\n')
print(json.dumps(e))
