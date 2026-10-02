#!/usr/bin/env python3
"""Require the round-3 lifetime proofs to fail on exact round-2 dispatch."""
import os, subprocess
from pathlib import Path
root=Path(__file__).resolve().parents[3]
out=root/'reports/20261001-bg-busy-group-render/round3'
files=[root/'crates/snapback4-core/src'/name for name in ['maintain.rs','engine/row_views.rs','engine/row_views/batch.rs','engine/row_views/certification.rs','partition.rs','partition/counts.rs']]
saved={p:p.read_bytes() for p in files}
try:
    for p in files:
        p.write_bytes(subprocess.check_output(['git','show','fcc4b644f9:'+str(p.relative_to(root.parent))],cwd=root))
    r=subprocess.run(['cargo','test','-p','snapback4-core','--lib','certification_tests::lifetimes','--','--nocapture'],cwd=root,
        env={**os.environ,'LIBSQLITE3_FLAGS':'-USQLITE_ENABLE_MEMORY_MANAGEMENT'},stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
    log=r.stdout.decode(); (out/'round2-negative.log').write_text(log); (out/'round2-negative.exit').write_text(str(r.returncode)+'\n')
    assert r.returncode==101 and '8 failed' in log and 'error[E' not in log,log
    for name in ['literal Direct same-query authorized sources','literal Inherited same-query authorized sources','generated review prefix','device exposed stored poison','forward extension at 1,11,12']:
        assert name in log,name
    r=subprocess.run(['cargo','test','-p','snapback4-core','--lib','malformed_required_evidence','--','--nocapture'],cwd=root,
        env={**os.environ,'LIBSQLITE3_FLAGS':'-USQLITE_ENABLE_MEMORY_MANAGEMENT'},stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
    log=r.stdout.decode(); (out/'round2-malformed-negative.log').write_text(log); (out/'round2-malformed-negative.exit').write_text(str(r.returncode)+'\n')
    assert r.returncode==101 and '1 failed' in log and 'stream versus full acquisition' in log,log
    print('Exact fcc4b644f9 dispatch: eight expected assertion failures; both same-query reproductions, three generated topologies, device poison.')
finally:
    for p,data in saved.items():p.write_bytes(data)
