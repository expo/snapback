"""Select declared whole-lane setup corrections, retaining superseded attempts.

Creates a private analysis view with links to unchanged raw logs. It never
modifies a measurement row or combines revisions within a lane.
"""
import argparse,json,pathlib

ap=argparse.ArgumentParser()
ap.add_argument('--primary',type=pathlib.Path,required=True)
ap.add_argument('--correction',type=pathlib.Path,required=True)
ap.add_argument('--out',type=pathlib.Path,required=True)
a=ap.parse_args()
def read(root):
 return [json.loads(line)for p in sorted(root.glob('results-*.jsonl'))for line in p.read_text().splitlines()]
primary=read(a.primary);correction=read(a.correction)
assert all('script'in r for r in correction),'correction must contain completed pairs only'
keys={(r['wave'],r['lane'])for r in correction}
for wave,lane in keys:
 old=[r for r in primary if (r['wave'],r['lane'])==(wave,lane)]
 assert old and all('setupError'in r for r in old),'only complete setup refusals may be superseded'
selected=[r for r in primary if (r['wave'],r['lane'])not in keys]+correction
assert len({(r['wave'],r['lane'],r.get('script'))for r in selected})==len(selected),'duplicate pairs'
a.out.mkdir(parents=True,exist_ok=False,mode=0o700)
(a.out/'logs').mkdir()
for r in selected:
 root=a.correction if (r['wave'],r['lane'])in keys else a.primary
 name=f"w{r['wave']}-{r['lane']}";dest=a.out/'logs'/name
 if not dest.exists():dest.symlink_to((root/'logs'/name).resolve(),target_is_directory=True)
(a.out/'results-0.jsonl').write_text(''.join(json.dumps(r)+'\n'for r in selected))
(a.out/'selection.json').write_text(json.dumps({'primary':str(a.primary),'correction':str(a.correction),'correctedWholeLanes':sorted(keys),'supersededAttempts':[r for r in primary if (r['wave'],r['lane'])in keys],'pairs':len(selected)},indent=2)+'\n')
print(len(selected),'selected pairs;',len(keys),'explicit setup corrections')
