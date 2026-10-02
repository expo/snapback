#!/usr/bin/env python3
"""Temporary post-commit and sync-certification stamps; restore every source."""
from pathlib import Path
import os, shutil, subprocess
root=Path(__file__).resolve().parents[3]
originals={}
def patch(rel, old, new):
    p=root/rel
    originals[p]=p.read_text()
    assert originals[p].count(old)==1,rel
    p.write_text(originals[p].replace(old,new))
try:
    patch('crates/snapback4-core/src/engine/runner.rs','pub(super) rebuilt_source_rows:', 'pub(crate) rebuilt_source_rows:')
    patch('crates/snapback4-core/src/engine/mod.rs','        tx.commit()?;\n        Ok(outcome)', '''        tx.commit()?;
        if std::env::var_os("LL_COMMIT_TRACE").is_some() {
            if let WriteState::Sent { seq, .. } = &outcome.state {
                let at = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs_f64() * 1000.0;
                eprintln!("LL_COMMIT {} {} {:.3}", name, seq, at);
            }
        }
        Ok(outcome)''')
    patch('crates/snapback4-core/src/partition/counts.rs',
        '            let images = reader.live_aggregate_batch(&m.target, &rows)?;',
        '''            let bg_start=std::time::Instant::now();
            let bg_before=reader.rebuilt_source_rows;
            let images = reader.live_aggregate_batch(&m.target, &rows)?;
            if std::env::var_os("LL_COMMIT_TRACE").is_some() {
                let at=std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs_f64()*1000.0;
                eprintln!("BG_COUNTS {:.3} {:.3} {} {}",at,bg_start.elapsed().as_secs_f64()*1000.0,reader.rebuilt_source_rows-bg_before,rows.len());
            }''')
    profile=os.environ.get('BG_PROFILE','dev')
    folder='debug' if profile=='dev' else profile
    subprocess.run(['cargo','build','-p','snapback4','--profile',profile],cwd=root,env={**os.environ,'LIBSQLITE3_FLAGS':'-USQLITE_ENABLE_MEMORY_MANAGEMENT'},check=True)
    shutil.copy2(root/f'target/{folder}/snapback4',root/'target/debug/snapback4-bg-new')
    (root/'target/debug/snapback4-bg-new').replace(root/'target/debug/snapback4-ll-measure')
finally:
    for p,text in originals.items():p.write_text(text)
