import {spawn} from 'node:child_process';
import {readFile, mkdir, rm} from 'node:fs/promises';
import {createServer} from 'node:net';
import {resolve} from 'node:path';
import postgres from 'postgres';
import {Zero, mustGetMutator, mustGetQuery} from '@rocicorp/zero';
import {handleMutateRequest, handleQueryRequest} from '@rocicorp/zero/server';
import {zeroPostgresJS} from '@rocicorp/zero/server/adapters/postgresjs';
import {mutators} from './mutators.mjs';
import {queries} from './queries.mjs';
import {schema} from './schema.mjs';

const programRoot = resolve(import.meta.dirname, '../../..');
const freePort = () => new Promise((resolvePort, reject) => { const s = createServer(); s.on('error', reject); s.listen(0, '127.0.0.1', () => { const a = s.address(); s.close(() => resolvePort(a.port)); }); });
const databaseURL = (base, name) => { const url = new URL(base); url.pathname = `/${name}`; return url.toString(); };
const actor = (request) => request.headers.get('authorization')?.replace(/^Bearer /, '') ?? null;

export async function startIncidentZeroRuntime() {
  const ready = JSON.parse(await readFile(resolve(programRoot, '.runtime/postgres/ready.json'), 'utf8'));
  const baseURL = process.env.ZERO_BAKEOFF_POSTGRES_URL ?? ready.url;
  const runID = `${process.pid}_${Date.now()}`;
  const database = `ir_bakeoff_${runID}`;
  const runtimeDir = resolve(import.meta.dirname, '..', '.runtime', runID);
  await mkdir(runtimeDir, {recursive: true});
  const admin = postgres(baseURL, {max: 1});
  await admin.unsafe(`CREATE DATABASE ${database}`); await admin.end();
  const sql = postgres(databaseURL(baseURL, database), {max: 20});
  await sql.unsafe(await readFile(resolve(import.meta.dirname, 'schema.sql'), 'utf8'));
  for (let i = 1; i <= 10; i += 1) {
    const id = `incident-${String(i).padStart(2, '0')}`;
    await sql`INSERT INTO incident ${sql({id, title: `Incident ${i}`, severity: i % 2 ? 'sev1':'sev2', created_by: 'alice', next_sequence: 2})}`;
    await sql`INSERT INTO incident_member ${sql([
      {id: `${id}-alice`, incident_id: id, user_id: 'alice', role: 'commander'},
      {id: `${id}-bob`, incident_id: id, user_id: 'bob', role: 'responder'},
      {id: `${id}-oscar`, incident_id: id, user_id: 'oscar', role: 'observer'},
    ])}`;
    await sql`INSERT INTO message ${sql({id: `${id}-m1`, incident_id: id, sequence: 1, author_id: 'alice', body: 'Incident opened'})}`;
  }
  const dbProvider = zeroPostgresJS(schema, sql);
  const api = Bun.serve({hostname: '127.0.0.1', port: 0, async fetch(request) {
    const userID = actor(request);
    if (!['alice','bob','oscar','mallory'].includes(userID)) return new Response('unauthorized', {status: 401});
    const ctx = {userID}; const path = new URL(request.url).pathname;
    if (path === '/query') return Response.json(await handleQueryRequest({handler: (name,args) => mustGetQuery(queries,name).fn({args,ctx}), request, schema, userID}));
    if (path === '/mutate') return Response.json(await handleMutateRequest({dbProvider, request, userID,
      handler: (transact) => transact((tx,name,args) => mustGetMutator(mutators,name).fn({tx,args,ctx}))}));
    return new Response('not found', {status: 404});
  }});
  const port = await freePort(); const cacheURL = `http://127.0.0.1:${port}`;
  const cache = spawn(resolve(programRoot, 'node_modules/.bin/zero-cache-dev'), ['--port', String(port), '--replica-file', resolve(runtimeDir,'zero.db'), '--log-level','warn'], {
    cwd: programRoot, detached: true, stdio: ['ignore','pipe','pipe'], env: {...process.env,
      PATH: `${resolve(programRoot, 'node_modules/.bin')}:${process.env.PATH ?? ''}`,
      ZERO_UPSTREAM_DB: databaseURL(baseURL,database), ZERO_APP_ID:`ir_${runID}`,
      ZERO_QUERY_URL:`${api.url}query`, ZERO_MUTATE_URL:`${api.url}mutate`, ZERO_NUM_SYNC_WORKERS:'1', ZERO_CVR_MAX_CONNS:'2', ZERO_UPSTREAM_MAX_CONNS:'2'},
  });
  let logs=''; cache.stdout.on('data',(c)=>{logs+=c}); cache.stderr.on('data',(c)=>{logs+=c});
  const clients=[]; const client=(userID,suffix='')=>{ const z=new Zero({schema,mutators,queries,cacheURL,auth:userID,userID,context:{userID},kvStore:'mem',storageKey:`${runID}-${userID}-${suffix}-${clients.length}`}); clients.push(z); return z; };
  const deadline=Date.now()+30000; while(Date.now()<deadline){ if(cache.exitCode!==null) throw new Error(`zero-cache exited: ${logs.slice(-2000)}`); try{if((await fetch(`${cacheURL}/keepalive`)).ok)break}catch{} await Bun.sleep(100); }
  const close=async()=>{ for(const z of clients.reverse()){try{await z.close()}catch(error){if(!String(error?.message??error).includes('Connection not found'))throw error}} if(cache.exitCode===null){process.kill(-cache.pid,'SIGTERM'); await Bun.sleep(300);} api.stop(true); await sql.end(); const a=postgres(baseURL,{max:1}); const slots=await a`SELECT slot_name,active_pid FROM pg_replication_slots WHERE database=${database}`; for(const s of slots){if(s.active_pid) await a`SELECT pg_terminate_backend(${s.active_pid})`;} await Bun.sleep(100); for(const s of slots) await a`SELECT pg_drop_replication_slot(${s.slot_name}) WHERE EXISTS (SELECT 1 FROM pg_replication_slots WHERE slot_name=${s.slot_name})`; await a.unsafe(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`); await a.end(); await rm(runtimeDir,{recursive:true,force:true}); };
  return {client,sql,close,cacheURL,logs:()=>logs};
}
