// Qualification observers: host telemetry is optional; fixture quiescence is not.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { loadavg, platform } from 'node:os';
const sleep = ms => new Promise(r => setTimeout(r, ms));

export function hostSample(pids, run = execFileSync) {
  const errors = [];
  const attempt = (name, read) => {
    try { return read(); } catch (error) {
      errors.push({sample:name, code:error.code ?? null, message:String(error.message).slice(0,300)});
      return null;
    }
  };
  // A bounded 16 MiB process table, 2 s timeout, only the busiest eight retained.
  // ENOBUFS, disappearing /proc entries, ps errors and timeouts lose telemetry,
  // never a latency result. No unbounded buffer on a multi-tenant Mac.
  const ps = args => run('ps', args, {encoding:'utf8', maxBuffer:16*1024*1024, timeout:2000});
  return {
    load:loadavg(),
    affinity:platform()==='linux' ? attempt('affinity',()=>readFileSync(`/proc/${pids[0]}/status`,'utf8').split('\n').find(s=>s.startsWith('Cpus_allowed_list:'))) : null,
    cpuCounters:platform()==='linux' ? attempt('cpuCounters',()=>readFileSync('/proc/stat','utf8').split('\n').filter(s=>/^cpu/.test(s))) : null,
    busiest:attempt('busiest',()=>ps(['-Ao','pid=,pcpu=,comm=']).trim().split('\n')
      .sort((a,b)=>Number(b.trim().split(/\s+/)[1])-Number(a.trim().split(/\s+/)[1])).slice(0,8)),
    processes:attempt('processes',()=>ps(['-o','pid=,ppid=,pcpu=,comm=','-p',pids.join(',')])),
    threads:platform()!=='linux' ? null : attempt('threads',()=>readdirSync(`/proc/${pids[1]}/task`).flatMap(tid=> {
      try { return [{tid:Number(tid),sched:readFileSync(`/proc/${pids[1]}/task/${tid}/sched`,'utf8')}]; } catch { return []; }
    })),
    samplingErrors:errors,
  };
}

export function maintenanceSnapshot(path) {
  const db = new DatabaseSync(path, {readOnly:true});
  try {
    db.exec('PRAGMA busy_timeout=1000; BEGIN');
    const schema = JSON.parse(db.prepare('SELECT schema FROM _generations ORDER BY generation DESC LIMIT 1').get().schema);
    const work=[];
    for(const t of schema.timelines ?? []) work.push([t.name+'Work','timeline']);
    for(const m of schema.maintains ?? []) if(m.row_key) work.push(['$recount:'+m.target,'recount']);
    const tables=work.map(([name,kind])=> {
      const catalog=db.prepare('SELECT num FROM _catalog WHERE name=?').get(name);
      assert(catalog,'missing maintenance table '+name);
      const states=kind==='timeline'
        ? db.prepare("SELECT json_extract(data,'$.Row.status.String') state,count(*) n FROM r WHERE t=? GROUP BY state").all(catalog.num)
        : db.prepare("SELECT CASE json_extract(data,'$.Row.parked.Bool') WHEN 1 THEN 'parked' ELSE 'pending' END state,count(*) n FROM r WHERE t=? GROUP BY state").all(catalog.num);
      return {name,kind,states,pending:states.filter(s=>s.state!=='done').reduce((n,s)=>n+s.n,0)};
    });
    const jobs=db.prepare("SELECT state,count(*) n FROM _jobs WHERE state != 'done' GROUP BY state").all();
    const lastCommit=db.prepare('SELECT seq,at,program FROM _commits ORDER BY seq DESC LIMIT 1').get();
    return {at:Date.now(),tables,jobs,lastCommit,pending:tables.reduce((n,t)=>n+t.pending,0)+jobs.reduce((n,j)=>n+j.n,0)};
  } finally { db.close(); }
}

export async function waitForMaintenance(path, record, server, timeoutMs=30*60*1000) {
  const started=Date.now(), samples=[];
  let emptySince, previousSeq, lastProgress=started;
  try {
    for(;;) {
      assert(server.exitCode===null && server.signalCode===null,'server exited during maintenance wait');
      const sample=maintenanceSnapshot(path);samples.push(sample);
      assert(!sample.tables.some(t=>t.states.some(s=>s.state==='parked'&&s.n>0)) && !sample.jobs.some(s=>s.state==='parked'),'maintenance is parked');
      if(sample.pending===0) {
        if(emptySince===undefined || previousSeq!==sample.lastCommit?.seq) emptySince=Date.now();
        if(Date.now()-emptySince>=1000) return {started,finished:Date.now(),waitMs:Date.now()-started,initial:samples[0],final:sample};
      } else emptySince=undefined;
      previousSeq=sample.lastCommit?.seq;
      assert(Date.now()-started<timeoutMs,'maintenance did not become idle within 30 minutes');
      if(Date.now()-lastProgress>=30000){console.log('waiting for maintenance',sample.pending,'pending',Date.now()-started,'ms');lastProgress=Date.now()}
      await sleep(250);
    }
  } finally {
    await writeFile(record,JSON.stringify({started,finished:Date.now(),waitMs:Date.now()-started,samples},null,2));
  }
}
