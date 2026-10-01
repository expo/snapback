"""Capture the changed test closure and bind every test/helper input, including new files."""
from pathlib import Path
import hashlib,json,re,subprocess
root=Path(__file__).resolve().parents[2];report=Path(__file__).resolve().parent
base=json.loads((report/'environment.json').read_text())['head']
changed={root.parent/p for p in subprocess.check_output(['git','diff',base,'--name-only'],cwd=root,text=True).splitlines()}
changed.add(root/'packages/snapback4/test/helpers/wait.mjs')
files=list((root/'packages/snapback4/test').rglob('*.mjs'))+[root/'witness/lib.mjs']
deps={p:{(p.parent/m).resolve() for m in re.findall(r'''(?:from\s*|import\(\s*)['"](\.[^'"\n]+)['"]''',p.read_text())} for p in files}
affected=set(changed)
while True:
 more={p for p,imports in deps.items() if imports & affected}-affected
 if not more:break
 affected.update(more)
# Keep the full-count session model as an explicit non-regression control.
affected.add(root/'packages/snapback4/test/app-session-model.test.mjs')
tests=sorted(str(p.relative_to(root)) for p in affected if p.name.endswith('.test.mjs'))
(report/'converted-files.json').write_text(json.dumps(tests,indent=2)+'\n')
inputs=sorted([p for p in (root/'packages/snapback4/test').rglob('*') if p.is_file()]+[root/'witness/lib.mjs'])
manifest={str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest() for p in inputs}
(report/'source-manifest-repaired.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(len(tests),'affected test files;',len(manifest),'source inputs')

initial=json.loads((report/'source-manifest.json').read_text())
late={p for p in manifest if initial.get(p)!=manifest[p]}
(report/'late-files.json').write_text(json.dumps(sorted(late),indent=2)+'\n')
affected_late={root/p for p in late}
while True:
 more={p for p,imports in deps.items() if imports & affected_late}-affected_late
 if not more:break
 affected_late.update(more)
late_tests=sorted(str(p.relative_to(root)) for p in affected_late if p.name.endswith('.test.mjs'))
(report/'late-tests.json').write_text(json.dumps(late_tests,indent=2)+'\n')
print(len(late_tests),'final follow-up scopes')
