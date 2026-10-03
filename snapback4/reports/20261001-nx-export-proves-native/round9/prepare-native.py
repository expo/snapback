from pathlib import Path
import hashlib, json, os, shutil, subprocess
root = Path(__file__).resolve().parents[3]
report = Path(__file__).resolve().parent
base = root / 'target/nx/round9'
base.mkdir(exist_ok=True)
env = dict(os.environ, PATH=str(Path.home()/'.volta/bin')+':'+os.environ['PATH'])
def run(label, command, cwd):
    with (report / (label+'.log')).open('x') as log:
        subprocess.run(command, cwd=cwd, env=env, stdout=log, stderr=subprocess.STDOUT, check=True)
packages = base/'packages'; packages.mkdir(exist_ok=True)
for name in ['snapback4', 'snapback4-expo']:
    run('pack-'+name, ['npm','pack','--pack-destination',str(packages)], root/'packages'/name)
tarballs = sorted(packages.glob('*.tgz'))
(report/'native-packages.json').write_text(json.dumps([{'path':str(p),'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in tarballs],indent=2)+'\n')
for name, args in [('plain',['--expo']),('social',['--template','social'])]:
    project = base/name
    run(name+'-init', [str(root/'target/debug/snapback4'),'init',str(project),*args], root)
    # Reuse downloaded, already-pinned external dependencies; npm installs the
    # two freshly packed merged packages and reconciles the copied lock.
    old = root/'target/nx'/name
    subprocess.run(['cp','-cR',str(old/'node_modules'),str(project/'node_modules')],check=True)
    shutil.copy2(old/'package-lock.json',project/'package-lock.json')
    run(name+'-install',['npm','install','--ignore-scripts','--no-audit','--no-fund',*[str(p) for p in tarballs]],project)
    run(name+'-check',[str(root/'target/production/snapback4'),'check'],project)
