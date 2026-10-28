"""Explicit whole-lane observation view; never replaces primary timing evidence."""
import argparse,json,pathlib
ap=argparse.ArgumentParser();ap.add_argument('--primary',type=pathlib.Path,required=True);ap.add_argument('--supplement',type=pathlib.Path,action='append',required=True);ap.add_argument('--out',type=pathlib.Path,required=True);a=ap.parse_args()
def read(root):return [json.loads(line)for p in sorted(root.glob('results-*.jsonl'))for line in p.read_text().splitlines()]
selected={};superseded=[]
for root in [a.primary,*a.supplement]:
 rows=read(root);assert all('script'in r for r in rows),'incomplete setup must be resolved explicitly'
 grouped={}
 for r in rows:grouped.setdefault((r['wave'],r['lane']),[]).append(r)
 for lane,replacement in grouped.items():
  keys={(r['wave'],r['lane'],r['script'])for r in replacement}
  assert len(keys)==len(replacement),'duplicate pair'
  old={k for k in selected if k[:2]==lane}
  if root!=a.primary:assert old==keys,'replacement must cover the entire ordered lane'
  for r in replacement:
   key=(r['wave'],r['lane'],r['script'])
   if key in selected:
    oldroot,oldrow=selected[key]
    superseded.append({'key':key,'root':str(oldroot),'revision':oldrow.get('measurementRevision'),'beforeCode':oldrow['before']['code'],'afterCode':oldrow['after']['code']})
   selected[key]=(root,r)
a.out.mkdir(parents=True,exist_ok=False,mode=0o700);(a.out/'logs').mkdir()
for root,r in selected.values():
 name=f"w{r['wave']}-{r['lane']}";link=a.out/'logs'/name
 if not link.exists():link.symlink_to((root/'logs'/name).resolve(),target_is_directory=True)
(a.out/'results-0.jsonl').write_text(''.join(json.dumps(r)+'\n'for root,r in selected.values()))
(a.out/'selection.json').write_text(json.dumps({'qualification':False,'purpose':'Complete tail-boundary coverage only; primary timing rows remain unchanged.','orderedRoots':[str(p)for p in [a.primary,*a.supplement]],'superseded':superseded,'pairs':len(selected)},indent=2)+'\n')
print(len(selected),'selected whole-lane pairs;',len(superseded),'retained superseded observations')
