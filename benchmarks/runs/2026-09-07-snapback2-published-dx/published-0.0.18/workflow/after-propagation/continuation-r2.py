from workflow import ROOT,NODE,cli,execute,h,checks
from pathlib import Path
import json,time,os,shutil
project=ROOT/'consumer/todos';consumer=ROOT/'consumer'
report={'phase':'edit-after-explicit-index-correction','checks':checks,'ok':False,'startEpoch':time.time(),'correction':'Adding a second owner-prefix index made the existing list query ambiguous; named byOwnerId as the diagnostic instructed.'}
try:
 cli('check-explicit-index',['check','--json'],project)
 cli('dev-restart',['dev'],project)
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
 try:cli('dev-stop-r2',['dev','--stop','--json'],project)
 except BaseException as exc:report['cleanupFailure']={'type':type(exc).__name__,'message':str(exc)}
 report['endEpoch']=time.time();h.write_json(ROOT/'continuation-r2-report.json',report)
