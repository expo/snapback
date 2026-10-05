import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import assert from 'node:assert/strict';
// Separate process keeps the listener healthy while this client cannot run.
const child=spawn(process.execPath,['-e',`require('http').createServer((q,s)=>s.end('ready')).listen(0,'127.0.0.1',function(){console.log(this.address().port)})`],{stdio:['ignore','pipe','inherit']});
const exited=once(child,'exit');
try {
 const [line]=await once(child.stdout,'data');const url=`http://127.0.0.1:${Number(String(line).trim())}`;
 const began=performance.now();const pending=fetch(url);
 const until=performance.now()+11000;while(performance.now()<until){}
 try {console.log(JSON.stringify({outcome:'success',status:(await pending).status,ms:performance.now()-began}));}
 catch(error) {console.log(JSON.stringify({outcome:'error',error:error.message,cause:error.cause?.code,ms:performance.now()-began}));}
 console.log(JSON.stringify({independentLiveness:(await fetch(url)).status}));
} finally {child.kill('SIGTERM');await exited;}
