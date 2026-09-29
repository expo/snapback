"""Run unchanged pre-LV tests against each SDK; isolated builds, no live edits."""
from pathlib import Path
import io,tarfile,subprocess,shutil,json,os
root=Path.cwd(); report=Path(__file__).resolve().parent; base='ee514de11^1'
paths=subprocess.check_output(['git','ls-tree','-r','--name-only',base,'--','packages/snapback4/test'],text=True).splitlines()
scopes=['retention','fencing','footprint','ephemeral','read','query','keep','presence','expiry','prediction-routing','remembered']
exclude=['types','mock','adoption','readme-examples']
files=[p for p in paths if p.endswith('.test.mjs') and any(s in Path(p).name for s in scopes) and not any(s in Path(p).name for s in exclude)]
(report/'census-files.json').write_text(json.dumps(files,indent=2)+'\n')
results=[]
for name in ['pre-lv','round11']:
    out=root/'target/lv-round11'/('census-'+name);out.mkdir(parents=True,exist_ok=True)
    archive=subprocess.check_output(['git','-C',str(root.parent),'archive',base,'snapback4/packages/snapback4'])
    with tarfile.open(fileobj=io.BytesIO(archive)) as tar:tar.extractall(out,filter='data')
    sb=out/'snapback4';pkg=sb/'packages/snapback4'
    sdk=root/'target/lv-round11/pre-lv/snapback4/packages/snapback4' if name=='pre-lv' else root/'packages/snapback4'
    shutil.rmtree(pkg/'src');(pkg/'src').symlink_to(sdk/'src',target_is_directory=True)
    (pkg/'dist').symlink_to(sdk/'dist',target_is_directory=True)
    (pkg/'node_modules').symlink_to(root/'packages/snapback4/node_modules',target_is_directory=True)
    for p in root.iterdir():
        if not (sb/p.name).exists():(sb/p.name).symlink_to(p,target_is_directory=p.is_dir())
    for p in (root/'packages').iterdir():
        if not (sb/'packages'/p.name).exists():(sb/'packages'/p.name).symlink_to(p,target_is_directory=p.is_dir())
    cmd=['node','--test','--test-concurrency=4',*files]
    with (report/('census-'+name+'.log')).open('w') as log:
        run=subprocess.run(cmd,cwd=sb,stdout=log,stderr=subprocess.STDOUT)
    results.append({'sdk':name,'base':base,'command':cmd,'exit':run.returncode})
    (report/'census-results.json').write_text(json.dumps(results,indent=2)+'\n')
    print(name,run.returncode,flush=True)
