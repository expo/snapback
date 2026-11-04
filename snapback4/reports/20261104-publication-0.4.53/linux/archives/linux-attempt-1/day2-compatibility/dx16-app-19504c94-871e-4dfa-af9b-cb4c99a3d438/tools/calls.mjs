// Don't replace the historical handles.
import {check} from '../helpers/check.mjs';
import {readFileSync} from 'node:fs';
import {createClient} from 'snapback4/client';
import {api} from '../snapback/generated/api.ts';
const users=JSON.parse(readFileSync(process.env.CALLS_USERS));const client=createClient({url:process.env.BACKEND_URL,session:users.member[0]});try {const read=await client.query(api.list,{});if(!check()||read.data?.length!==1)throw Error('frozen v1 read failed '+JSON.stringify(read));console.log(JSON.stringify({ok:true,rows:read.data.length}));}finally{client.close();}
