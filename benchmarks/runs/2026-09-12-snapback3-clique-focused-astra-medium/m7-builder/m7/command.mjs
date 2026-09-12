import {spawn} from 'node:child_process';import fs from 'node:fs';
const [label,...args]=process.argv.slice(2),start=Date.now();fs.appendFileSync('m7/commands.jsonl',JSON.stringify({label,args,start})+'\n');
const out=fs.openSync(`m7/${label}.log`,'a');const p=spawn(args[0],args.slice(1),{stdio:['ignore',out,out]});p.on('exit',code=>{fs.appendFileSync('m7/commands.jsonl',JSON.stringify({label,pid:p.pid,start,end:Date.now(),code})+'\n');process.exitCode=code??1;});
