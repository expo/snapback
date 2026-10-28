"""Numeric-only day-two command costs and final production phase distributions."""
import argparse,collections,json,pathlib
from summarize import command_summary,stats
ap=argparse.ArgumentParser()
ap.add_argument('--primary',type=pathlib.Path,required=True)
ap.add_argument('--deploy',type=pathlib.Path,required=True)
ap.add_argument('--out',type=pathlib.Path,required=True)
a=ap.parse_args()
rows=[json.loads(line)for p in a.primary.glob('results-*.jsonl')for line in p.read_text().splitlines()]
targets=set(json.loads((pathlib.Path(__file__).parent/'primary-summary.json').read_text())['LAT3TargetLanes'])
selected=[r for r in rows if r['wave']==33 and r['script']=='day2:proof'and r['lane']in targets and r['before']['code']==r['after']['code']==0]
commands={};calls={};sample={}
for variant in ['before','after']:
 groups=collections.defaultdict(list);counts=[]
 for row in selected:
  values=command_summary(a.primary,row,variant);counts.append(len(values))
  for c in values:
   if c['verb']not in ['serve','dev']:groups[c['verb']].append(c)
  if row['lane'].startswith('025-'):
   sample[variant]={'wallSeconds':row[variant]['seconds'],'securitySeconds':row[variant]['preflightSeconds'],'withoutSecuritySeconds':row[variant]['withoutPreflightSeconds'],'nativeInvocations':len(values),'counts':dict(collections.Counter(c['verb']for c in values)),'finiteCommandWallSeconds':sum(c['seconds']for c in values if c['verb']not in ['serve','dev'])}
 commands[variant]={verb:{'count':len(values),'wallSeconds':stats([c['seconds']for c in values]),'outsideSecuritySeconds':stats([c['outsideSecuritySeconds']for c in values])}for verb,values in groups.items()}
 calls[variant]=stats(counts)
deploy=[json.loads(line)for p in a.deploy.glob('results-*.jsonl')for line in p.read_text().splitlines()]
phases={};totals={}
for variant in ['before','after']:
 groups=collections.defaultdict(list)
 chosen=[r for r in deploy if 'scenario'in r and r[variant]['code']==0 and r[variant].get('activationAttempted',True)]
 totals[variant]=stats([r[variant]['withoutPreflightSeconds']for r in chosen])
 for r in chosen:
  for phase,seconds in r[variant]['phases'].items():
   if phase.startswith(('cli.','store.','deploy.','release.')) and phase not in ['deploy.security','deploy.report','deploy.witnesses','deploy.restored_questions','deploy.note_prediction']:
    groups[phase].append(seconds)
  if 'cli.total'in r[variant]['phases']:groups['process_wall_outside_main_and_trace_flush'].append(r[variant]['seconds']-r[variant]['phases']['cli.total'])
 phases[variant]={phase:stats(values)for phase,values in sorted(groups.items())}
result={'qualification':False,'matchedLAT3TargetLanes':len(selected),'nativeInvocationCountsPerDay2':calls,'day2Commands':commands,'selected025':sample,'productionNonSecuritySeconds':totals,'productionPhases':phases,'notes':['Native children owned by proof-command are counted once; app wrapper spawns are not extra invocations.','Serve/dev lifetime spans other commands and is excluded from finite per-command costs.','Primary .44 vs .45 timings include pre-existing version differences. Security/token improvements cannot be attributed to LAT4. Production before/after use same-version .45 controls.','Phase intervals nest; do not add medians or subtract arbitrary child intervals. Security complement subtracts only the enclosing measured security interval.','Startup inside main excludes loader/process setup. The residual includes process startup, scheduling, trace serialization/drain and final exit; it is not pure loader CPU.']}
a.out.write_text(json.dumps(result,indent=2)+'\n')
