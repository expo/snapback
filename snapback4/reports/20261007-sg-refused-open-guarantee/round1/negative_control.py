from pathlib import Path
import subprocess
paths=[Path('crates/snapback4-core/src/engine/mod.rs'),Path('crates/snapback4-core/src/engine/ephemeral.rs')]
kept={p:p.read_bytes() for p in paths}
try:
    for p in paths:
        p.write_bytes(subprocess.check_output(['git','show',f'daaa28c47e6a9fa951410ee3d2e20c885e924811:snapback4/{p}']))
    with open('target/sg-r1/round0-negative-control.log','w') as log:
        result=subprocess.run(['cargo','test','-p','snapback4-core','--test','refused_open','adoption_with_an_in_flight_ephemeral_reader_commits_in_delete_and_wal','--','--nocapture'],stdout=log,stderr=subprocess.STDOUT)
    assert result.returncode != 0, 'round-0 lock inversion must fail this regression'
finally:
    for p,data in kept.items(): p.write_bytes(data)
