import pathlib,subprocess,re,json,hashlib,difflib
root=pathlib.Path('/home/ccheever/projects/sb4-b32-dx15/snapback4');cwd=pathlib.Path('/tmp/dx17/guide-compare');cwd.mkdir(exist_ok=True)
a='/tmp/dx17/packs-route/platform/snapback4';b=str(root/'target/x86_64-unknown-linux-musl/production/snapback4')
s=(root/'crates/snapback4-lang/src/guide.rs').read_text();body=re.search(r'pub const KEYWORDS: &\[&str\] = &\[(.*?)\];',s).group(1);cards=re.findall(r'"([^"]+)"',body)
rows=[]
for card in cards:
 outputs=[subprocess.run([exe,'guide',card,'--repeat'],cwd=cwd,capture_output=True).stdout for exe in [a,b]]
 if outputs[0]!=outputs[1]:
  rows.append({'card':card,'oldSha256':hashlib.sha256(outputs[0]).hexdigest(),'newSha256':hashlib.sha256(outputs[1]).hexdigest(),'diff':list(difflib.unified_diff(outputs[0].decode().splitlines(),outputs[1].decode().splitlines()))})
pathlib.Path('/tmp/dx17/evidence/rebuild-guide-comparison.json').write_text(json.dumps({'cards':len(cards),'differences':rows},indent=2))
print(json.dumps({'cards':len(cards),'changed':[r['card'] for r in rows]}))
