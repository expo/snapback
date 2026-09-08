from workflow import ROOT,NODE,cli,execute,h,checks
from pathlib import Path
import json,time,os,shutil
project=ROOT/'consumer/todos';consumer=ROOT/'consumer'
report={'phase':'edit-diagnostics-tests-types','checks':checks,'ok':False,'startEpoch':time.time()}
try:
 original=(project/'snapback/todos.q').read_text();schema=(project/'snapback/schema.q').read_text()
 h.write_json(ROOT/'before-edit.json',{'todos.q':original,'schema.q':schema})
 # Change the add response to expose its typed inserted row and add a merged-row query.
 edited=original.replace('return { id: row.id }','return { id: row.id, row }')+'\nquery merged():\n  page = merge todos first 3 by byOwner:\n    [viewer]\n  return page\n'
 assert edited!=original
 (project/'snapback/schema.q').write_text(schema.replace('  by ownerId\n','  by ownerId\n  by byOwner: ownerId, id\n'))
 (project/'snapback/todos.q').write_text(edited.replace('done: false','done: 42'))
 try:cli('intentional-diagnostic',['check','--json'],project)
 except RuntimeError:
  r=checks[-1];assert r['exitCode']==1 and r['actualReturnCode']==1 and not r.get('timedOut')
  raw=(ROOT/'receipts/intentional-diagnostic.log').read_text();assert 'bool' in raw and 'number' in raw
  report['expectedDiagnosticObserved']=True
 else:raise AssertionError('Invalid boolean field accepted')
 (project/'snapback/todos.q').write_text(edited)
 cli('check-corrected',['check','--json'],project)
 journey='''import { api } from "snapback2/client";
import { journey } from "snapback2/test";
journey("published row types", async ({ as }) => {
  const alice = as("alice");
  const added = await alice.mutation(api.todos.add, { title: "Published type proof" });
  if (added.state !== "committed") throw new Error(`add was ${added.state}`);
  if (added.data.row.done !== false || added.data.row.title !== "Published type proof") throw new Error("insert row response mismatch");
  const merged = await alice.query(api.todos.merged, {});
  if (merged.state !== "complete" && merged.state !== "capped") throw new Error("merged rows incomplete");
  if (!merged.data.some(row => row.title === "Published type proof" && row.done === false)) throw new Error("merged row missing");
});
'''
 (project/'snapback/tests/published-types.test.ts').write_text(journey)
 cli('focused-test',['test','--journey','published row types','--json'],project)
 cli('full-test',['test','--json'],project)
 cli('verified-run',['run','todos.add','{"title":"Verified published change"}','--as','alice','--json'],project)
 for name in ['published-declaration-consumer.ts','type-probe.mjs']:shutil.copyfile(ROOT/name,consumer/name)
 execute('installed-type-probes',[NODE,str(consumer/'type-probe.mjs'),str(project)],consumer)
 report['ok']=True
except BaseException as exc:
 report['failure']={'type':type(exc).__name__,'message':str(exc)};raise
finally:
 try:cli('dev-stop',['dev','--stop','--json'],project)
 except BaseException as exc:report['cleanupFailure']={'type':type(exc).__name__,'message':str(exc)}
 report['endEpoch']=time.time();h.write_json(ROOT/'continuation-report.json',report)
