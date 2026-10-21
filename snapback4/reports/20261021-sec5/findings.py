"""Seven-lane comparison; no app source/store or credentials are changed."""
import concurrent.futures,gzip,hashlib,json,pathlib,re,subprocess,tempfile,time,sys
HERE=pathlib.Path(__file__).resolve().parent
BIN=pathlib.Path(sys.argv[1]).resolve()
def stripped(text):return ''.join(l for l in text.splitlines(keepends=True) if not l.lstrip().startswith('invariant '))
def run(number):
    source=next(pathlib.Path('/home/ccheever/sb4-loop/wave20/apps').glob(f'{number}-snapback-*/snapback/schema.q'))
    original=source.read_text(); spec=[]
    if number!='025':
        for q in sorted(pathlib.Path(f'/home/ccheever/sb4-loop/wave20-repro/q1/{number}/snapback').glob('*.q')):
            spec += [l for l in q.read_text().splitlines() if l.lstrip().startswith('invariant ')]
    else:
        # The scoped target is deadline advice. No invented transition language.
        spec=["invariant boxers.physicianNotes read only exists roles[principal = viewer, role = 'physician'] or exists roles[principal = viewer, role = 'inspector']",
              "invariant boxers.suspensionReason read only exists roles[principal = viewer, role = 'physician'] or exists roles[principal = viewer, role = 'inspector']"]
    records=[]
    for mode,text in [('none',stripped(original)),('own',original),('spec',stripped(original)+'\n'+'\n'.join(spec)+'\n')]:
        with tempfile.TemporaryDirectory(prefix=f'sec5-findings-{number}-{mode}-') as scratch:
            project=pathlib.Path(scratch);(project/'snapback').mkdir();(project/'snapback/schema.q').write_text(text);(project/'package.json').write_text('{"private":true,"type":"module"}\n')
            stem=HERE/'findings'/f'{number}-{mode}';stem.parent.mkdir(exist_ok=True)
            (stem.with_suffix('.q')).write_text(text)
            start=time.monotonic()
            c=subprocess.run(['timeout','90s',str(BIN),'check','--json'],cwd=project,text=True,capture_output=True,timeout=95)
            with gzip.open(str(stem)+'.check.json.gz','wt') as f:json.dump({'exit':c.returncode,'stdout':c.stdout,'stderr':c.stderr},f)
            try:check=json.loads(c.stdout)
            except ValueError:check={}
            test=None;violations=[];coverage=[]
            if mode!='none':
                t=subprocess.run(['timeout','240s',str(BIN),'test'],cwd=project,text=True,capture_output=True,timeout=245)
                with gzip.open(str(stem)+'.test.txt.gz','wt') as f:f.write(t.stdout+'\n'+t.stderr)
                for line in t.stdout.splitlines():
                    if line.startswith('security violation: '):
                        try:violations.append(json.loads(line[len('security violation: '):]))
                        except ValueError:pass
                    if line.startswith('security not covered: '):coverage.append(line[len('security not covered: '):])
                test={'exit':t.returncode,'summary':[l for l in t.stdout.splitlines() if l.startswith(('security tests:','security histories:','test:'))],'violations':violations,'coverage':coverage}
            records.append({'lane':number,'mode':mode,'source':str(source),'original_sha256':hashlib.sha256(original.encode()).hexdigest(),'input_sha256':hashlib.sha256(text.encode()).hexdigest(),'binary_sha256':hashlib.sha256(BIN.read_bytes()).hexdigest(),'seconds':round(time.monotonic()-start,3),'check_exit':c.returncode,'notes':check.get('security',{}).get('notes',[]),'invariants':check.get('security',{}).get('invariants',[]),'test':test})
            (HERE/'findings'/f'{number}-results.json').write_text(json.dumps(records,indent=2)+'\n')
    return records
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:records=list(pool.map(run,['001','006','025','033','036','048','050']))
(HERE/'findings'/'results.json').write_text(json.dumps([r for group in records for r in group],indent=2)+'\n')
for group in records:
    print(json.dumps([{'lane':r['lane'],'mode':r['mode'],'check':r['check_exit'],'notes':len(r['notes']),'test':r['test'] and r['test']['exit'],'violations':r['test'] and len(r['test']['violations'])} for r in group]),flush=True)
