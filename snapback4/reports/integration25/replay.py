import concurrent.futures as cf,json,os,re,shutil,sqlite3,subprocess,tempfile,time
from pathlib import Path
HOME=Path.home();OUT=Path('/home/ccheever/sb4-loop/reports/integration25/replay');BASE=OUT/'baseline/package/snapback4';NEW=Path(os.environ.get('REL_BIN','/home/ccheever/projects/sb4-b27-rel/snapback4/target/debug/snapback4'))
def invoke(binary,root,args):
    try:
        p=subprocess.run([str(binary),*args],cwd=root,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,timeout=180)
        return {'code':p.returncode,'stdout':p.stdout,'stderr':p.stderr}
    except subprocess.TimeoutExpired:return {'code':124,'stdout':'','stderr':'timeout after 180s'}
def parse(out):
    try:return json.loads(out['stdout'])
    except:return {}
def inventory(root):
    db=sqlite3.connect(f'file:{root}/deploy/store.sqlite?mode=ro',uri=True)
    rows={(t,id) for t,id in db.execute('select t,id from r')};cat=dict(db.execute('select name,num from _catalog'));db.close();return rows,cat
def one(wave,lane,label,binary):
    with tempfile.TemporaryDirectory(prefix=f'rel-w{wave}-{lane.name[:3]}-{label}-') as tmp:
        root=Path(tmp);shutil.copytree(lane/'deploy',root/'deploy',symlinks=True,ignore=shutil.ignore_patterns('store.sqlite-owner','store.sqlite-token','store.sqlite-shm','.release-command','.snapback4'))
        for release in (root/'deploy/releases').iterdir():
            if release.is_dir():
                (release/'.snapback4').mkdir(exist_ok=True);(release/'.snapback4/store.sqlite').symlink_to(os.path.relpath(root/'deploy/store.sqlite',release/'.snapback4'))
        (root/'snapback').mkdir();
        for source in (lane/'snapback').glob('*.q'):shutil.copyfile(source,root/'snapback'/source.name)
        # Capture review rationale only; no account/token/owner material.
        for name in ['security-reviews.json','client-compatibility.json']:
            if (lane/'snapback'/name).exists() and name!='client-compatibility.json':shutil.copyfile(lane/'snapback'/name,root/'snapback'/name)
        # Preserve the authored saved-client baseline without linking any original store.
        config=lane/'snapback/client-compatibility.json'
        if config.is_file():
            metadata=json.loads(config.read_text());relative=Path(metadata['baseline'])
            assert not relative.is_absolute() and '..' not in relative.parts
            shutil.copyfile(config,root/'snapback/client-compatibility.json')
            original=lane/relative;copied=root/relative
            if original.is_dir():
                copied.mkdir(parents=True,exist_ok=True)
                for q in original.glob('*.q'):shutil.copyfile(q,copied/q.name)
            else:
                copied.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(original,copied)
        initial,cat=inventory(root)
        v1=''.join(p.read_text() for p in (root/'deploy/releases/1/snapback').glob('*.q'))
        names=set(re.findall(r'^table\s+(\w+)',v1,re.M));all_sources='\n'.join(p.read_text() for p in (root/'deploy/releases').glob('*/snapback/*.q'))
        for _ in range(20):
            before=len(names)
            for new,old in re.findall(r'^table\s+(\w+)\s+renamed from\s+(\w+)',all_sources,re.M):
                if old in names:names.add(new)
            if len(names)==before:break
        nums={cat[n] for n in names if n in cat};old_ids={(t,id) for t,id in initial if t in nums}
        r={'wave':wave,'lane':lane.name[:3],'build':label,'steps':[],'initialOldRows':len(old_ids),'hidden':0,'liveLineCorrect':True,'refused':0}
        steps=[('deploy',['deploy','deploy']),('rollback1',['rollback','deploy','--to','1']),('forward1',['deploy','deploy']),('rollback2',['rollback','deploy','--to','1']),('forward2',['deploy','deploy'])]
        for name,args in steps:
            result=invoke(binary,root,args);state=parse(invoke(binary,root,['releases','deploy','--json']))
            entry={'move':name,'exit':result['code'],'release':state.get('release'),'live':state.get('live'),'liveLine':next((l for l in result['stdout'].splitlines() if l.startswith('live: ')),None)}
            if result['code']:
                r['refused']+=1
                entry['reason']=next((l for l in reversed(result['stderr'].splitlines()) if l.startswith(('deploy:','rollback:'))),'refused (see private log)')
            else:
                live=state.get('live',{});line=entry['liveLine'];correct=bool(line and live and f"release {state.get('release')} =" in line and (('exact source' in line)==live.get('exact')))
                entry['liveLineCorrect']=correct;r['liveLineCorrect'] &= correct
                if name.startswith('rollback'):
                    active,_=inventory(root);entry['hiddenOldRows']=len(old_ids-active);r['hidden']=max(r['hidden'],entry['hiddenOldRows'])
            r['steps'].append(entry)
            # Raw output stays local; do not print credentials or lane material.
            safe=OUT/'logs'/f'w{wave}-{lane.name[:3]}-{label}';safe.mkdir(parents=True,exist_ok=True)
            (safe/f'{name}.stdout').write_text(result['stdout']);(safe/f'{name}.stderr').write_text(result['stderr'])
        return r
if __name__=='__main__':
    import sys
    label=sys.argv[1];binary=BASE if label=='0.4.40' else NEW
    jobs=[]
    for wave in [25,27]:
        for lane in sorted((HOME/f'sb4-loop/wave{wave}/apps').glob('*-snapback-*')):
            if (lane/'deploy/store.sqlite').is_file() and (not os.environ.get('REL_ONLY_CONFIG') or (lane/'snapback/client-compatibility.json').is_file()):jobs.append((wave,lane,label,binary))
    results=[]
    with cf.ThreadPoolExecutor(max_workers=int(os.environ.get("REL_WORKERS","3"))) as pool:
        for future in cf.as_completed([pool.submit(one,*job) for job in jobs]):
            results.append(future.result());(OUT/f'{label}.json').write_text(json.dumps(sorted(results,key=lambda r:(r['wave'],r['lane'])),indent=2));print(f'{label}: {len(results)}/{len(jobs)} copied lanes complete',flush=True)
