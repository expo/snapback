"""Read frozen schema inputs; run only on owned, automatically removed copies."""
import collections, concurrent.futures, gzip, hashlib, json, pathlib, subprocess, sys, tempfile, time

ROOT = pathlib.Path(__file__).resolve().parents[3]
HERE = pathlib.Path(__file__).resolve().parent
def digest(data): return hashlib.sha256(data).hexdigest()
def manifest():
    result = []
    for wave in (15,16,18,19,20,21):
        for schema in sorted(pathlib.Path(f'/home/ccheever/sb4-loop/wave{wave}/apps').glob('*/snapback/schema.q')):
            sources = [{'path':str(p),'sha256':digest(p.read_bytes())} for p in sorted(schema.parent.glob('*.q'))]
            result.append({'wave':wave,'lane':schema.parent.parent.name,'sources':sources})
    (HERE/'inputs.json').write_text(json.dumps(result,indent=2)+'\n')
    return result

def run(binary, label):
    output=HERE/label; output.mkdir(exist_ok=True)
    inputs=json.loads((HERE/'inputs.json').read_text()) if (HERE/'inputs.json').exists() else manifest()
    if label.startswith('wave21'): inputs=json.loads((HERE/'wave21-inputs.json').read_text())
    stripped=label.startswith('stripped')
    if stripped: inputs=[i for i in inputs if i['wave']!=21]
    def one(item):
        with tempfile.TemporaryDirectory(prefix='sec5-survey-') as scratch:
            project=pathlib.Path(scratch); (project/'snapback').mkdir()
            hashes=[]
            for src in item['sources']:
                data=pathlib.Path(src['path']).read_bytes()
                hashes.append({'path':src['path'],'sha256':digest(data),'unchanged':digest(data)==src['sha256']})
                if stripped: data=''.join(line for line in data.decode().splitlines(keepends=True) if not line.lstrip().startswith('invariant ')).encode()
                (project/'snapback'/pathlib.Path(src['path']).name).write_bytes(data)
            (project/'package.json').write_text('{"name":"sec5-survey","private":true,"type":"module"}\n')
            start=time.monotonic()
            try:
                p=subprocess.run(['timeout','120s',str(binary),'check','--json'],cwd=project,text=True,capture_output=True,timeout=125)
                raw={'exit':p.returncode,'stdout':p.stdout,'stderr':p.stderr}
                try: result=json.loads(p.stdout)
                except ValueError: result={}
                entry={'wave':item['wave'],'lane':item['lane'],'exit':p.returncode,'seconds':round(time.monotonic()-start,3),'sources':hashes,
                    'diagnostics':result.get('problems',[]),'security_notes':result.get('security',{}).get('notes',[]),
                    'verdicts':[{k:v.get(k) for k in ('invariant','status','counterexample')} for v in result.get('security',{}).get('invariants',[])],
                    'compiler_notes':result.get('notes',[])}
            except Exception as e: entry={'wave':item['wave'],'lane':item['lane'],'error':str(e),'sources':hashes}; raw=entry
            with gzip.open(output/f"{item['wave']}-{item['lane']}.check.json.gz",'wt') as f: json.dump(raw,f)
            return entry
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool: results=list(pool.map(one,inputs))
    (output/'survey.json').write_text(json.dumps({'binary_sha256':digest(binary.read_bytes()),'apps':results},indent=2)+'\n')
    summary={'apps':len(results),'by_wave':dict(collections.Counter(x['wave'] for x in results)),
        'failures':[{'wave':x['wave'],'lane':x['lane'],'exit':x.get('exit'),'error':x.get('error'),'diagnostics':x.get('diagnostics')} for x in results if x.get('exit')!=0],
        'security_notes':dict(collections.Counter(n['code'] for x in results for n in x.get('security_notes',[]))),
        'all_sources_unchanged':all(s['unchanged'] for x in results for s in x['sources'])}
    (output/'summary.json').write_text(json.dumps(summary,indent=2)+'\n'); print(json.dumps(summary),flush=True)

if __name__=='__main__':run(pathlib.Path(sys.argv[1]).resolve(),sys.argv[2])
