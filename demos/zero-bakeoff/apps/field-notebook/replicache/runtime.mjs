import 'fake-indexeddb/auto';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import postgres from 'postgres';
import {Replicache, dropDatabase} from 'replicache';

const programRoot=resolve(import.meta.dirname,'../../..');
const dbURL=(base,name)=>{const url=new URL(base);url.pathname=`/${name}`;return url.toString()};
const ok=(response)=>({response,httpRequestInfo:{httpStatusCode:200,errorMessage:''}});
const unavailable=()=>({httpRequestInfo:{httpStatusCode:503,errorMessage:'deterministic offline fixture'}});

const mutators={
  async create(tx,args){await tx.put(`record/${args.id}`,{...args,assignedTo:'alice',checklistDone:0,revision:1,conflict:null})},
  async update(tx,args){const key=`record/${args.id}`;const current=await tx.get(key);if(current)await tx.put(key,{...current,body:args.body,revision:Number(current.revision)+1})}
};

export async function startNotebookReplicacheRuntime(){
  const ready=JSON.parse(await readFile(resolve(programRoot,'.runtime/postgres/ready.json'),'utf8'));
  const baseURL=process.env.ZERO_BAKEOFF_POSTGRES_URL??ready.url;
  const database=`fn_replicache_${process.pid}_${Date.now()}`;
  const admin=postgres(baseURL,{max:1});await admin.unsafe(`CREATE DATABASE ${database}`);await admin.end();
  const sql=postgres(dbURL(baseURL,database),{max:12});
  await sql.unsafe(`
    CREATE TABLE field_record(id text PRIMARY KEY,assignment_id text NOT NULL,assigned_to text NOT NULL,title text NOT NULL,body text NOT NULL,checklist_done integer NOT NULL,revision integer NOT NULL,conflict text);
    CREATE TABLE replicache_client(client_id text PRIMARY KEY,last_mutation_id bigint NOT NULL);
    CREATE TABLE replicache_meta(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),version bigint NOT NULL);
    INSERT INTO replicache_meta(singleton,version) VALUES(true,1);
  `);
  const seed=[];for(let i=1;i<=200;i++)seed.push({id:`record-${String(i).padStart(3,'0')}`,assignment_id:'north',assigned_to:'alice',title:`Record ${String(i).padStart(3,'0')}`,body:`Seed observation ${String(i).padStart(3,'0')}`,checklist_done:0,revision:1,conflict:null});await sql`INSERT INTO field_record ${sql(seed)}`;
  let backendOnline=true,lastPushRequest=null,closed=false;
  const applyMutation=async(tx,mutation)=>{
    const state=await tx`SELECT last_mutation_id::int AS id FROM replicache_client WHERE client_id=${mutation.clientID} FOR UPDATE`;
    const last=state.length?Number(state[0].id):0;
    if(mutation.id<=last)return false;
    if(mutation.id!==last+1)throw new Error(`REPLICACHE_MUTATION_GAP:${mutation.clientID}:${last}->${mutation.id}`);
    if(mutation.name==='create'){
      const a=mutation.args;await tx`INSERT INTO field_record(id,assignment_id,assigned_to,title,body,checklist_done,revision,conflict) VALUES(${a.id},${a.assignmentID},'alice',${a.title},${a.body},0,1,NULL) ON CONFLICT(id) DO NOTHING`;
    }else if(mutation.name==='update'){
      const a=mutation.args,current=(await tx`SELECT body,revision FROM field_record WHERE id=${a.id} FOR UPDATE`)[0];
      if(current){
        if(Number(current.revision)===Number(a.expectedRevision))await tx`UPDATE field_record SET body=${a.body},revision=revision+1,conflict=NULL WHERE id=${a.id}`;
        else await tx`UPDATE field_record SET body=${a.body},revision=revision+1,conflict=${JSON.stringify({remote:current.body,local:a.body,expectedRevision:a.expectedRevision,remoteRevision:Number(current.revision)})} WHERE id=${a.id}`;
      }
    }else throw new Error(`REPLICACHE_UNKNOWN_MUTATOR:${mutation.name}`);
    await tx`INSERT INTO replicache_client(client_id,last_mutation_id) VALUES(${mutation.clientID},${mutation.id}) ON CONFLICT(client_id) DO UPDATE SET last_mutation_id=EXCLUDED.last_mutation_id`;
    await tx`UPDATE replicache_meta SET version=version+1 WHERE singleton=true`;
    return true;
  };
  const applyPush=async(request)=>{if(request.pushVersion!==1)throw new Error('REPLICACHE_V0_UNSUPPORTED');for(const mutation of request.mutations)await sql.begin(tx=>applyMutation(tx,mutation));return ok(undefined)};
  const pusher=async(request)=>{if(!backendOnline)return unavailable();lastPushRequest=structuredClone(request);return applyPush(request)};
  const pullResponse=async cookie=>{
    const [rows,clients,meta]=await Promise.all([
      sql`SELECT id,assignment_id AS "assignmentID",assigned_to AS "assignedTo",title,body,checklist_done::int AS "checklistDone",revision::int,conflict FROM field_record WHERE assigned_to='alice' ORDER BY id`,
      sql`SELECT client_id,last_mutation_id::int AS last_mutation_id FROM replicache_client`,
      sql`SELECT version::int FROM replicache_meta WHERE singleton=true`
    ]);
    const version=Number(meta[0].version),unchanged=cookie===version,changes=unchanged?{}:Object.fromEntries(clients.map(row=>[row.client_id,Number(row.last_mutation_id)]));
    const patch=unchanged?[]:[{op:'clear'},...rows.map(row=>({op:'put',key:`record/${row.id}`,value:{...row,conflict:row.conflict?JSON.parse(row.conflict):null}}))];
    return {cookie:version,lastMutationIDChanges:changes,patch};
  };
  const puller=async(request)=>{if(!backendOnline)return unavailable();if(request.pullVersion!==1)throw new Error('REPLICACHE_V0_UNSUPPORTED');return ok(await pullResponse(request.cookie))};
  const instances=[];
  const client=(name='field-notebook-alice')=>{const rep=new Replicache({name,schemaVersion:'1',mutators,pusher,puller,pullInterval:null,pushDelay:60_000,kvStore:'idb',logLevel:'error'});rep.onClientStateNotFound=null;rep.onUpdateNeeded=null;instances.push(rep);return rep};
  const setOnline=value=>{backendOnline=Boolean(value)};
  const remoteEdit=async(id,body)=>{await sql.begin(async tx=>{await tx`UPDATE field_record SET body=${body},revision=revision+1 WHERE id=${id}`;await tx`UPDATE replicache_meta SET version=version+1 WHERE singleton=true`})};
  const replayLastPush=async()=>lastPushRequest?applyPush(lastPushRequest):null;
  const poke=async(rep,baseCookie)=>{const response=await pullResponse(baseCookie);await rep.poke({baseCookie,pullResponse:response});return response.cookie};
  const eraseClient=async rep=>{const name=rep.idbName;if(!rep.closed)await rep.close();await dropDatabase(name,{kvStore:'idb',logLevel:'error'})};
  const close=async()=>{if(closed)return;closed=true;for(const rep of instances.reverse())if(!rep.closed)await rep.close();await sql.end();const a=postgres(baseURL,{max:1});await a.unsafe(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);await a.end()};
  return{client,setOnline,remoteEdit,replayLastPush,poke,eraseClient,sql,close,get online(){return backendOnline}};
}
