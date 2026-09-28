"""Exercise the two additional review-test gaps; always restore source bytes."""
from pathlib import Path
import subprocess
out=Path(__file__).resolve().parent
root=out.parents[2]
def run(log, name):
 with (out/log).open('w') as f:
  result=subprocess.run(['cargo','test','-p','snapback4-lang','--test','mp_reproduction',name,'--','--nocapture'],cwd=root,stdout=f,stderr=subprocess.STDOUT)
 print(log,result.returncode,flush=True)
p=root/'crates/snapback4-lang/src/bind/refusals.rs';original=p.read_bytes()
try:
 p.write_text(p.read_text().replace('witness != name || ',''))
 run('mutation-witness-table.log','sequence_note_uses_declared')
finally: p.write_bytes(original)
paths=[root/'crates/snapback4-core/src/engine'/name for name in ['read.rs','through_read.rs']]
saved={p:p.read_bytes() for p in paths}
try:
 p=paths[0];p.write_text(p.read_text().replace('if aggregate_parent == Some(false) { return Ok((Vec::new(), Vec::new())); }','if aggregate_parent == Some(false) { aggregate_scope.emit(); page_expiry.emit(); return Ok((Vec::new(), Vec::new())); }'))
 p=paths[1];p.write_text(p.read_text().replace('let live = row.as_ref().filter(|row| !self.expired(parent, row));','''let live = row.as_ref().filter(|row| !self.expired(parent, row));
        if live.is_none() {
            if let Some(row) = &row {
                if let Some(column) = parent.expiry_column() {
                    if let Ok(Value::Int(at)) = row.field(column) { self.next_expiry.note(*at); }
                }
            }
        }'''))
 run('mutation-expired-deadline.log','missing_hidden_and_expired_aggregate')
finally:
 for p,contents in saved.items(): p.write_bytes(contents)
