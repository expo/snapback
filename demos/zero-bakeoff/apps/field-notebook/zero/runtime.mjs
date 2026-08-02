import 'fake-indexeddb/auto';
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

const programRoot=resolve(import.meta.dirname,'../../..');
const freePort=()=>new Promise((res,rej)=>{const s=createServer();s.on('error',rej);s.listen(0,'127.0.0.1',()=>{const a=s.address();s.close(()=>res(a.port))})});
const databaseURL=(base,name)=>{const u=new URL(base);u.pathname=`/${name}`;return u.toString()};
export async function startNotebookZeroRuntime(){
  const ready=JSON.parse(await readFile(resolve(programRoot,'.runtime/postgres/ready.json'),'utf8')); const baseURL=process.env.ZERO_BAKEOFF_POSTGRES_URL??ready.url;
  const runID=`${process.pid}_${Date.now()}`,database=`fn_zero_${runID}`,runtimeDir=resolve(import.meta.dirname,'..','.runtime',runID);await mkdir(runtimeDir,{recursive:true});
  const admin=postgres(baseURL,{max:1});await admin.unsafe(`CREATE DATABASE ${database}`);await admin.end();const sql=postgres(databaseURL(baseURL,database),{max:20});await sql.unsafe(await readFile(resolve(import.meta.dirname,'schema.sql'),'utf8'));
  const rows=[];for(let i=1;i<=200;i++)rows.push({id:`record-${String(i).padStart(3,'0')}`,assignment_id:'north',assigned_to:'alice',title:`Record ${String(i).padStart(3,'0')}`,body:`Seed observation ${String(i).padStart(3,'0')}`,checklist_done:0,revision:1,conflict:null});await sql`INSERT INTO field_record ${sql(rows)}`;
  const dbProvider=zeroPostgresJS(schema,sql);const api=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(request){const userID=request.headers.get('authorization')?.replace(/^Bearer /,'');if(!['alice','bob','mallory'].includes(userID))return new Response('unauthorized',{status:401});const ctx={userID},path=new URL(request.url).pathname;if(path==='/query')return Response.json(await handleQueryRequest({handler:(name,args)=>mustGetQuery(queries,name).fn({args,ctx}),request,schema,userID}));if(path==='/mutate')return Response.json(await handleMutateRequest({dbProvider,request,userID,handler:(transact)=>transact((tx,name,args)=>mustGetMutator(mutators,name).fn({tx,args,ctx}))}));return new Response('not found',{status:404})}});
  const port=await freePort(),cacheURL=`http://127.0.0.1:${port}`,replica=resolve(runtimeDir,'zero.db');let cache=null,logs='';
  const spawnCache=()=>{cache=spawn(resolve(programRoot,'node_modules/.bin/zero-cache-dev'),['--port',String(port),'--replica-file',replica,'--log-level','warn'],{cwd:programRoot,detached:true,stdio:['ignore','pipe','pipe'],env:{...process.env,PATH:`${resolve(programRoot,'node_modules/.bin')}:${process.env.PATH??''}`,ZERO_UPSTREAM_DB:databaseURL(baseURL,database),ZERO_APP_ID:`fn_${runID}`,ZERO_QUERY_URL:`${api.url}query`,ZERO_MUTATE_URL:`${api.url}mutate`,ZERO_NUM_SYNC_WORKERS:'1',ZERO_CVR_MAX_CONNS:'2',ZERO_UPSTREAM_MAX_CONNS:'2'}});cache.stdout.on('data',c=>{logs+=c});cache.stderr.on('data',c=>{logs+=c});};
  const waitReady=async()=>{const deadline=Date.now()+30000;while(Date.now()<deadline){if(cache.exitCode!==null)throw new Error(`zero-cache exited: ${logs.slice(-2000)}`);try{if((await fetch(`${cacheURL}/keepalive`)).ok)return}catch{}await Bun.sleep(100)}throw new Error('zero-cache readiness timeout')};
  const stopCache=async()=>{const owned=cache;if(!owned)return;cache=null;if(owned.exitCode===null){try{process.kill(-owned.pid,'SIGTERM')}catch(error){if(error?.code!=='ESRCH')throw error}if(owned.exitCode===null)await Promise.race([new Promise(r=>owned.once('exit',r)),Bun.sleep(5000)])}};
  const restartCache=async()=>{if(cache)await stopCache();spawnCache();await waitReady()};spawnCache();await waitReady();
  const clients=[];const client=(userID,storageKey='field-notebook-browser')=>{const z=new Zero({schema,mutators,queries,cacheURL,auth:userID,userID,context:{userID},kvStore:'idb',storageKey});clients.push(z);return z};
  const close=async()=>{for(const z of clients.reverse()){try{await z.close()}catch(e){if(!String(e?.message??e).includes('Connection not found'))throw e}}await stopCache();api.stop(true);await sql.end();const a=postgres(baseURL,{max:1});const slots=await a`SELECT slot_name,active_pid FROM pg_replication_slots WHERE database=${database}`;for(const s of slots)if(s.active_pid)await a`SELECT pg_terminate_backend(${s.active_pid})`;await Bun.sleep(100);for(const s of slots)await a`SELECT pg_drop_replication_slot(${s.slot_name}) WHERE EXISTS(SELECT 1 FROM pg_replication_slots WHERE slot_name=${s.slot_name})`;await a.unsafe(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);await a.end();await rm(runtimeDir,{recursive:true,force:true})};
  return{client,stopCache,restartCache,sql,close,cacheURL,logs:()=>logs};
}
