"""Run the actual starter export command; keep bulky artifacts in target/wd."""
import hashlib, json, os, pathlib, shutil, subprocess, sys, time
ROOT = pathlib.Path.cwd()
REPORT = pathlib.Path(__file__).resolve().parent
WORK = ROOT/'target/wd'
ARCHIVE = pathlib.Path.home()/'sb4-np/evidence-archive/20261003-wd-witness-cleanup-deadline/blobs'
ARCHIVE.mkdir(parents=True, exist_ok=True)
phase = sys.argv[1]
label = os.environ.get('WD_COHORT', phase)
projects = pathlib.Path(os.environ.get('WD_PROJECTS', str(WORK/'audited')))
binary = WORK/('baseline-production' if phase == 'before' else 'candidate-production')
NODE = '/Users/ccheever/.volta/tools/image/node/24.18.0/bin'
env = dict(os.environ, PATH=NODE+':'+os.environ['PATH'], SNAPBACK4_BIN=str(binary), SNAPBACK4_SMOKE_DEVICE_PREFIX='sb4-wd-20261003-', XDG_STATE_HOME=str(WORK/'state'), CI='1')
rows = []
for i in range(int(os.environ.get('WD_SAMPLES','4'))):
    for starter in ['plain', 'social']:
        project = projects/starter
        # A harmless runtime marker survives bundling, so the loaded/exported
        # hash comparison covers a distinct JS payload for each warm sample.
        entry = project/('App.tsx' if starter == 'plain' else 'app/index.tsx')
        if not entry.exists(): entry = project/'src/client.ts'
        marker = json.dumps(f'WD {label} {starter} sample {i}')
        entry.write_text(entry.read_text()+f'\nObject.defineProperty(globalThis, "__wdSample", {{ configurable: true, value: {marker} }});\n')
        log = WORK/f'{label}-{starter}-{i}.log'
        start = time.monotonic(); load = os.getloadavg()
        with log.open('w') as output:
            run = subprocess.run(['npm', 'run', 'export:ios'], cwd=project, env=env, stdout=output, stderr=output)
        elapsed = time.monotonic()-start
        paths = sorted((project/'artifacts/native-smoke').glob('*/smoke-ios-run.json'), key=lambda p:p.stat().st_mtime)
        receipt = json.loads(paths[-1].read_text()) if paths else {}
        row = dict(phase=phase, cohort=label, project=str(project), starter=starter, sample=i, warm=i>0, seconds=elapsed, status=run.returncode, hostLoadBefore=load, hostLoadAfter=os.getloadavg(),
                   receiptPath=str(paths[-1]) if paths else None, nativeCache=receipt.get('nativeCache'), error=receipt.get('error'),
                   segments={k:v.get('status') for k,v in receipt.get('segments',{}).items()}, simulator=receipt.get('simulator'), nativeDurationMs=receipt.get('durationMs'),
                   loadedHash=receipt.get('installed',{}).get('javascript',{}).get('sha256'))
        if run.returncode == 0 and (project/'dist/metadata.json').exists():
            meta=json.loads((project/'dist/metadata.json').read_text())
            row['exportHash']=hashlib.sha256((project/'dist'/meta['fileMetadata']['ios']['bundle']).read_bytes()).hexdigest()
        # Preserve proof before a later export's normal retention compresses it.
        # This copying is outside the timed command, identically for both cohorts.
        evidence = [log]
        if paths:
            folder = paths[-1].parent
            evidence += [p for p in folder.iterdir() if p.is_file() and
                         (p.name in ['smoke-ios-run.json','proof.json','build.json','publication.json','live.json']
                          or p.suffix in ['.mp4','.png','.jsonl'])]
        row['evidence'] = []
        for path in evidence:
            digest=hashlib.sha256(path.read_bytes()).hexdigest(); dest=ARCHIVE/digest
            if not dest.exists(): shutil.copyfile(path,dest)
            row['evidence'].append(dict(path=str(path),sha256=digest,bytes=path.stat().st_size))
        rows.append(row)
        (REPORT/f'exports-{label}.json').write_text(json.dumps(rows,indent=2)+'\n')
        print(json.dumps(row),flush=True)
        if run.returncode or len(row['segments'])!=3 or any(s!='passed' for s in row['segments'].values()):
            raise RuntimeError(f'export failed: {log}')
