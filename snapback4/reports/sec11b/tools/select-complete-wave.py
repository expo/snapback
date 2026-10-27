"""Select every completed case in one predeclared wave, never a parent PASS."""
import argparse,gzip,hashlib,json,pathlib
p=argparse.ArgumentParser();p.add_argument('--source',required=True);p.add_argument('--wave',type=int,required=True);p.add_argument('--out',required=True);a=p.parse_args()
source=pathlib.Path(a.source);out=pathlib.Path(a.out);measurement=json.loads((source/'measurement.json').read_text());baseline=json.load(gzip.open('snapback4/reports/sec11-item1/survey-all800.json.gz','rt'));expected={r['lane']:r['sha256']for r in baseline if r['wave']==a.wave};assert len(expected)==50
rows=[];digests={}
for path in sorted(source.glob(f'w{a.wave}-*.json')):
 raw=path.read_bytes();row=json.loads(raw);assert row['wave']==a.wave and row['sha256']==expected[row['lane']]
 assert all(field in row for field in ['defaultCheck','defaultDeploy','fresh','test','afterTest','reviews','notes','gates','checkExit']),('incomplete actual phase record',path)
 rows.append(row);digests[path.name]=hashlib.sha256(raw).hexdigest()
assert len(rows)==len(expected)and{r['lane']for r in rows}==set(expected),'entire declared wave must be complete; no metric-based selection'
out.mkdir(parents=True,exist_ok=True);(out/'results.json').write_text(json.dumps(rows,indent=2)+'\n');receipt=dict(kind='entire-completed-wave-selected-from-parent',binarySha256=measurement['binarySha256'],projects=len(rows),selectedWave=a.wave,originalMeasurement=measurement,originalDirectory=str(source),recordSha256=digests,parentRunPassClaim=False,scope='Every native case in this declared wave has actual recorded command attempts. No parent completion or test-subcampaign PASS is inferred.')
(out/'measurement.json').write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps(dict(wave=a.wave,projects=len(rows),parentRunPassClaim=False)))
