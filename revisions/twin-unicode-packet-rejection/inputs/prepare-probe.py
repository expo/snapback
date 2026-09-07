from pathlib import Path
import hashlib,json,sys
root=Path(sys.argv[1]).resolve(); stage=Path(sys.argv[2]).resolve(); dest=stage/'candidate-probe';dest.mkdir(exist_ok=True)
files=['snapback2/packages/evaluator/src/unicode-tables.ts','snapback2/packages/evaluator/unicode-build.mjs','snapback2/packages/evaluator/dist/unicode-tables.ts','snapback2/packages/evaluator/src/unicode.ts']
receipt=[]
for f in files:
 p=root/f;copy=dest/Path(f).name
 if f.endswith('src/unicode-tables.ts'): copy=dest/'production-decoder.ts'
 copy.write_bytes(p.read_bytes());receipt.append({'origin':str(p),'copy':str(copy),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()})
text=(dest/'production-decoder.ts').read_text().replace("'../dist/unicode-tables'", "'./unicode-tables.ts'")+'\nexport { PacketReader };\n'
(dest/'inspection.ts').write_text(text)
(stage/'probe-source.json').write_text(json.dumps(receipt,indent=2)+'\n')
