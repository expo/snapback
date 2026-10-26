#!/usr/bin/env python3
"""Read-only wave-30 inputs; execute only copied schemas and remove every store."""
import concurrent.futures, hashlib, json, os, pathlib, shutil, statistics, subprocess, time
ROOT=pathlib.Path(__file__).resolve().parents[1]
INPUT=pathlib.Path.home()/'sb4-loop/wave30/apps'
SCRATCH=pathlib.Path('/tmp/dx13-replay/schemas')
OUT=ROOT/'reports/20261026-dx13/survey.json'
BIN=pathlib.Path(os.environ.get('SNAPBACK4_BIN',ROOT/'target/debug/snapback4')).resolve()

def run(app):
    target=SCRATCH/app.name; (target/'snapback').mkdir(parents=True)
    originals={}
    for source in (app/'snapback').glob('*.q'):
        originals[str(source)]=hashlib.sha256(source.read_bytes()).hexdigest();shutil.copyfile(source,target/'snapback'/source.name)
    for name in ['package.json','snapback/security-reviews.json']:
        if (app/name).is_file():shutil.copyfile(app/name,target/name)
    results={}
    try:
        for label,args in [('default',['check']),('review',['check','--review']),('json',['check','--json']),('deploy',['deploy','release'])]:
            began=time.monotonic();result=subprocess.run([str(BIN),*args],cwd=target,capture_output=True,text=True,timeout=180)
            text=result.stdout+result.stderr
            results[label]={'exit':result.returncode,'ms':round((time.monotonic()-began)*1000),'lines':len(text.splitlines()),'chars':len(text),'witnesses':text.count('  Witness:'),'fixNotes':text.count('fix: '),'hint':'React setup:' in text}
            if label=='default':results[label]['approvalWitness']='N_APPROVAL_NOT_ENFORCED' in text and 'dampApproved' in text and '  Witness:' in text
            if label=='json':
                data=json.loads(result.stdout);reviews=data.get('securityReviews',[])
                results[label]['gates']=sum(bool(d['gated'] and not d['acknowledged']) for d in reviews)
                results[label]['witnessCodes']=[{'code':d['code'],'site':d['site'],'acknowledged':d['acknowledged']} for d in reviews if d.get('witness')]
        assert all(hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()==h for p,h in originals.items())
        return {'lane':app.name,'sourceDigests':originals,'results':results}
    finally:shutil.rmtree(target)

def main():
    SCRATCH.mkdir(parents=True,exist_ok=False)
    try:
        apps=sorted(INPUT.glob('*-snapback-*'));assert len(apps)==50
        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool: rows=list(pool.map(run,apps))
        lines=sorted(r['results']['default']['lines'] for r in rows)
        summary={'schemas':len(rows),'medianLines':statistics.median(lines),'p90Lines':lines[44],'maxLines':max(lines),'checkPass':sum(r['results']['default']['exit']==0 for r in rows),'deployPass':sum(r['results']['deploy']['exit']==0 for r in rows),'coldMedianMs':statistics.median(r['results']['default']['ms'] for r in rows),'coldP90Ms':sorted(r['results']['default']['ms'] for r in rows)[44],'exactRealHoleDefaultWitnesses':sum(r['results']['default']['approvalWitness'] for r in rows),'originalsUnchanged':True}
        OUT.parent.mkdir(parents=True,exist_ok=True);OUT.write_text(json.dumps({'binarySha256':hashlib.sha256(BIN.read_bytes()).hexdigest(),'summary':summary,'rows':rows},indent=2)+'\n')
        print(json.dumps(summary));assert summary['medianLines']<=5
        assert next(r for r in rows if r['lane'].startswith('033-'))['results']['default']['approvalWitness']
    finally:shutil.rmtree(SCRATCH)
if __name__=='__main__':main()
