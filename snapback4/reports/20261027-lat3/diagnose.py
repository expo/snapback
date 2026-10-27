"""Fresh repeated control/candidate copies for the observed day-two UI mismatch.
Diagnostic runs never supersede the original paired performance observation.
"""
import sys
sys.dont_write_bytecode = True
from replay import copy_source, install, ROOT, HERE, SCRATCH
import pathlib, shutil, subprocess, os, time, json, signal

src = next(pathlib.Path('/home/ccheever/sb4-loop/wave33/apps').glob('009-snapback-*'))
out = SCRATCH/'diagnostic-w33-009'
out.mkdir(exist_ok=True)
for index, variant in enumerate(['before', 'after', 'after', 'before']):
    case = out/f'{index}-{variant}'
    cwd = case/'app'
    case.mkdir()
    copy_source(src, cwd)
    install(cwd)
    if variant == 'after':
        for name in ['dist', 'bin']:
            shutil.copytree(ROOT/'snapback4/packages/snapback4'/name, cwd/'node_modules/snapback4'/name, dirs_exist_ok=True)
    env = {**os.environ, 'NODE_OPTIONS':'--import='+str(HERE/'trace.mjs'),
           'LAT3_TRACE':str(case/'node.jsonl'), 'SNAPBACK4_LATENCY_TRACE':str(case/'native.jsonl'),
           'SNAPBACK4_BIN':str(cwd/'node_modules/snapback4-linux-x64/snapback4'),
           'CHROME':str(pathlib.Path.home()/'.cache/ms-playwright/chromium-1193/chrome-linux/chrome'),
           'PORT_LO':'51000', 'PORT_HI':'52999', 'npm_config_cache':str(SCRATCH/'npm-cache')}
    # Match the original ordered lane preparation; no assertion/source edits.
    for script in ['acceptance', 'frontend:proof', 'day2:proof']:
        start = time.monotonic()
        with (case/(script.replace(':', '-')+'.log')).open('w') as f:
            child = subprocess.Popen(['npm', 'run', script], cwd=cwd, env=env, stdout=f, stderr=subprocess.STDOUT, start_new_session=True)
            try:
                code = child.wait(timeout=600)
            except BaseException:
                os.killpg(child.pid, signal.SIGTERM)
                try:child.wait(timeout=10)
                except subprocess.TimeoutExpired:os.killpg(child.pid, signal.SIGKILL);child.wait()
                raise
        record = {'iteration':index, 'variant':variant, 'script':script, 'code':code, 'seconds':time.monotonic()-start}
        with (out/'results.jsonl').open('a') as f:f.write(json.dumps(record)+'\n')
        print(json.dumps(record), flush=True)
    # Logs stay private for attribution, separate from primary benchmark data.
