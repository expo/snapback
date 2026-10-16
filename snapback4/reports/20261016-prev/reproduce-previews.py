import pathlib, shutil, subprocess, json
root=pathlib.Path('/home/ccheever/projects/sb4-w13-prev')
base=pathlib.Path('/tmp/prev-farm-repro');base.mkdir(exist_ok=True)
apps=pathlib.Path('/home/ccheever/sb4-loop/wave13/apps')
for n in ['006','014','016','020','084']:
    lane=next(apps.glob(n+'-*')); out=base/n;out.mkdir(exist_ok=True)
    # SQLite backup avoids copying inconsistent WAL files; originals are read-only.
    import sqlite3
    for version,binary in [('before','/tmp/sb4-prev-0.4.29'),('after',str(root/'snapback4/target/debug/snapback4'))]:
        copy=out/version;copy.mkdir(exist_ok=True)
        if (copy/'releases').exists():shutil.rmtree(copy/'releases')
        shutil.copytree(lane/'deploy/releases',copy/'releases',symlinks=True)
        source=sqlite3.connect('file:'+str(lane/'deploy/store.sqlite')+'?mode=ro',uri=True)
        target=sqlite3.connect(copy/'store.sqlite');source.backup(target);target.close();source.close()
        for name in ['current','releases.jsonl']:
            if (lane/'deploy'/name).exists():shutil.copyfile(lane/'deploy'/name,copy/name)
        for direction,flags in [('rollback',['rollback',str(copy),'--to','1','--check']),('deploy',['deploy',str(copy),'--schema',str(lane/'versions/v2.q'),'--check','--restore-dormant'])]:
            # Saved sources are staged by the CLI; no original files are modified.
            if direction=='deploy':
                reset=subprocess.run([binary,'rollback',str(copy),'--to','1'],cwd=out,capture_output=True,text=True,timeout=90)
                assert reset.returncode==0,reset.stderr
            r=subprocess.run([binary]+flags,cwd=out,capture_output=True,text=True,timeout=90)
            (out/(version+'-'+direction+'.txt')).write_text(r.stdout+r.stderr)
            print(n,version,direction,r.returncode,r.stdout.count('WARNING'),flush=True)
