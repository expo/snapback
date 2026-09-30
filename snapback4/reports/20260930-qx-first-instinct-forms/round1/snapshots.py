"""Render the two reviewed CLI snapshots, using the generated schema fixture."""
from pathlib import Path
import tempfile, subprocess, sys, re
root=Path(__file__).resolve().parents[3]
fixture=(root/'crates/snapback4-lang/tests/membership_paths/fixture.rs').read_text().split('format!(r#"',1)[1].split('"#)',1)[0]
for k,v in dict(field='group',middle='',parent='messages',read='read <- exists members[.parent.group, viewer]',retain='retain until-revoked',audience='sync to members[.parent.group]',window='').items():fixture=fixture.replace('{'+k+'}',v)
fixture=fixture.replace('{{','{').replace('}}','}').replace('upsert reactions[parent, viewer]','upsert reactions[parent = parent, principal = viewer]')
binary=Path(sys.argv[1]).resolve() if len(sys.argv)>1 else root/'target/debug/snapback4'
for shape in ['natural','secondary-unique']:
 source=fixture if shape=='natural' else fixture.replace('  emoji: text <=32','  emoji: text <=32\n  unique principal, emoji')
 with tempfile.TemporaryDirectory() as d:
  p=Path(d)/'snapback';p.mkdir();(p/'schema.q').write_text(source)
  r=subprocess.run([binary,'check','--residency'],cwd=d,text=True,capture_output=True)
  assert r.returncode==0,(r.stdout,r.stderr)
  text='\n'.join(r.stdout.splitlines()[1:])+'\n'
  target=root/f'crates/snapback4/tests/check/fixtures/qx-{shape}.txt'
  if len(sys.argv)>1:
   expected=target.read_text()
   assert text!=expected,f'{shape}: baseline unexpectedly matches'
   inverse=re.sub(r'; held updates — .*?(?= \(site )','',expected).replace('predicts: conditional updates','predicts: updates only')
   assert text==inverse,f'{shape}: unexpected baseline difference'
   (Path(__file__).parent/f'before-{shape}.txt').write_text(text)
   print(f'{shape}: round-0 snapshot differs as expected')
  else:target.write_text(text)
