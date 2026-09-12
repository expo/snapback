import fs from 'node:fs';
const pid=Number(process.argv[2]);const rows=fs.readFileSync('evidence/server-pids.jsonl','utf8').trim().split('\n').map(JSON.parse);if(!rows.some(x=>x.pid===pid))throw Error('Not recorded owned PID');try{process.kill(pid,'SIGTERM')}catch(e){if(e.code!=='ESRCH')throw e}fs.appendFileSync('run-log.md',`\n${Date.now()/1000} stop requested for recorded owned PID ${pid}.\n`);
