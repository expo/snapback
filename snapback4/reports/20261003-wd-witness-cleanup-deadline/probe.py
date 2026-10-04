"""Measure the checked-out recovery functions and real supervisor; no source edits.

Run from snapback4: python3 reports/.../probe.py baseline [idle] [cpu] [runs]
The extracted Rust functions are byte-for-byte source, compiled in a tiny harness.
Raw logs stay in target/wd; compact JSON goes beside this script.
The label names evidence only: it does not select a source revision. Baseline
cohorts were collected on the original checkout before any product edit.
"""
import hashlib, json, os, pathlib, statistics, subprocess, sys, time
from concurrent.futures import ThreadPoolExecutor

ROOT = pathlib.Path.cwd()
REPORT = pathlib.Path(__file__).resolve().parent
WORK = ROOT / 'target/wd'
WORK.mkdir(parents=True, exist_ok=True)

def build_probe(label):
    source = (ROOT/'crates/snapback4/src/verbs/witness/recovery.rs').read_text()
    identity = source[source.index('pub(super) fn identity'):source.index('fn alive(')]
    members = source[source.index('pub(super) fn members'):source.index('fn stop_group(')]
    text = '''use serde_json::{json, Value};
use std::{fs, process::Command, time::Instant};
type Result<T> = std::result::Result<T, String>;
fn error(code: &str, e: impl std::fmt::Display) -> String { format!("{code}: {e}") }
mod measured { use super::*;
''' + identity + members + '''}
fn main() {
 let args: Vec<String> = std::env::args().collect();
 let group = args[1].parse().unwrap();
 for _ in 0..args[2].parse::<usize>().unwrap() {
   let start = Instant::now(); let members = measured::members(group).unwrap();
   println!("{}", json!({"ms": start.elapsed().as_secs_f64()*1000.0, "members": members.len()}));
 }
}
'''
    src = WORK/f'{label}-members.rs'; src.write_text(text)
    deps = ROOT/'target/debug/deps'
    # Both rlibs must belong to the same build profile; rustc chooses transitive deps.
    command = ['rustc', '--edition=2024', '-O', str(src), '-L', f'dependency={deps}', '-o', str(WORK/f'{label}-members')]
    for name in ['serde_json', 'libc']:
        lib = max(deps.glob(f'lib{name}-*.rlib'), key=lambda p:p.stat().st_mtime)
        command += ['--extern', f'{name}={lib}']
    subprocess.run(command, check=True, stdout=subprocess.DEVNULL)
    return hashlib.sha256(source.encode()).hexdigest()

def stats(values):
    values = sorted(values)
    return dict(n=len(values), min=values[0], median=statistics.median(values), p95=values[min(len(values)-1, int(len(values)*.95))], max=values[-1])

def main():
    label = sys.argv[1]; idle, cpu, runs = map(int, sys.argv[2:] or ['3000', '36', '10'])
    digest = build_probe(label)
    subprocess.run(['cc', '-O2', str(REPORT/'process-load.c'), '-o', str(WORK/'process-load')], check=True)
    load = subprocess.Popen([str(WORK/'process-load'), str(idle), str(cpu)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True, text=True)
    ownership = json.loads(load.stdout.readline())
    (WORK/f'{label}-owner.json').write_text(json.dumps(dict(harness=os.getpid(), load=ownership))+'\n')
    rows = []
    try:
        probe_group = subprocess.Popen(['/bin/sleep', '3600'], start_new_session=True)
        try:
            members = [json.loads(s) for s in subprocess.check_output([str(WORK/f'{label}-members'), str(probe_group.pid), '100'], text=True).splitlines()]
        finally:
            probe_group.terminate(); probe_group.wait()
        binary = ROOT/'target/debug/snapback4'
        for i in range(runs):
            folder = WORK/f'{label}-supervisor-{i}'; folder.mkdir(exist_ok=True)
            ready, status = folder/'group.json', folder/'status.json'
            ready.unlink(missing_ok=True); status.unlink(missing_ok=True)
            with (folder/'stderr.log').open('w') as log:
                child = subprocess.Popen([str(binary), '--internal-witness-process', 'supervisor', str(os.getpid()), str(ready), str(status), '/bin/sleep', '60'], stdin=subprocess.PIPE, stderr=log, start_new_session=True)
                started = time.monotonic()
                while not ready.exists():
                    if child.poll() is not None or time.monotonic()-started > 10: raise RuntimeError('supervisor startup')
                    time.sleep(.01)
                group = json.loads(ready.read_text())
                child.stdin.write(b's'); child.stdin.flush(); time.sleep(.1)
                start = time.monotonic(); child.stdin.close()
                # Same polling cadence as PreparationProcess::cleanup().
                while child.poll() is None and time.monotonic()-start < 60: time.sleep(.02)
                rows.append(dict(ms=(time.monotonic()-start)*1000, status=child.poll(), group=group['group']))
                if child.poll() is None: raise RuntimeError('supervisor stalled')
        tests = list((ROOT/'target/debug/deps').glob('snapback4-*'))
        test = None
        for candidate in sorted(tests, key=lambda p:p.stat().st_mtime, reverse=True):
            if not (candidate.is_file() and os.access(candidate, os.X_OK) and candidate.suffix == ''): continue
            listing = subprocess.run([str(candidate), '--list'], capture_output=True, text=True)
            if listing.returncode == 0 and 'verbs::witness::preparation::tests::' in listing.stdout:
                test = candidate; break
        if test is None: raise RuntimeError('Build the snapback4 unit-test executable first')
        def run_unit(i):
            with (WORK/f'{label}-unit-{i}.log').open('w') as log:
                start=time.monotonic()
                result=subprocess.run([str(test), 'verbs::witness::', '--nocapture', '--test-threads='+os.environ.get('WD_TEST_THREADS','1')], stdout=log, stderr=log)
                return dict(run=i, ms=(time.monotonic()-start)*1000, status=result.returncode, hostLoad=os.getloadavg())
        parallel = int(os.environ.get('WD_PARALLEL_RUNS','1'))
        with ThreadPoolExecutor(max_workers=parallel) as pool:
            unit = list(pool.map(run_unit, range(runs)))
        result=dict(label=label, sourceSha256=digest, load=ownership, hostLoad=os.getloadavg(), processCount=len(subprocess.check_output(['/bin/ps','-axo','pid=']).splitlines()), members=members, supervisor=rows, unit=unit,
                    parallelRuns=parallel, testThreads=int(os.environ.get('WD_TEST_THREADS','1')), testBinary=str(test), testSha256=hashlib.sha256(test.read_bytes()).hexdigest(),
                    summary=dict(membersMs=stats([r['ms'] for r in members]), supervisorMs=stats([r['ms'] for r in rows]), unitMs=stats([r['ms'] for r in unit]), failures=sum(r['status']!=0 for r in unit)))
        (REPORT/f'{label}.json').write_text(json.dumps(result, indent=2)+'\n')
        print(json.dumps(result['summary']), flush=True)
    finally:
        load.stdin.close(); load.wait(timeout=30)
        print(load.stderr.read(), flush=True)

if __name__ == '__main__': main()
